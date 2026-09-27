// One multiplayer room: a shared market ticking once a second, the players in it, and the current round.
// The market code is the same the single-player game runs; browsers keep their own wallets and send trades here.
import type { WebSocket } from 'ws'
import { createMarket, candleStore, applyPlayerTrade, quoteBuy, quoteSell, secPerTickOf, setCandleLog, setClock, tickMarket, type CandlePoint } from '../src/game/marketEngine'
import { rollEvents } from '../src/game/eventEngine'
import { createWallets, tickWallets } from '../src/game/walletEngine'
import { POST_COOLDOWN_TICKS, shill, tickSocial } from '../src/game/socialEngine'
import { flagBundle, runBotTick, sleuthBundle } from '../src/game/devTools'
import { MODES } from '../src/game/progression'
import { Rng } from '../src/utils/rng'
import type { GameMode, MarketEngine, MarketEvent, MarketState, SimWallet, SocialPost, VolumeBot } from '../src/types'
import type { BotRun, ClientMsg, NetMarket, NetToken, RoomPlayer, RoundInfo, ServerMsg, TickMsg, TokenDiff, TransferMsg, WalletDiff } from '../src/net/protocol'

const POSTS_KEPT = 60
const EVENTS_KEPT = 60
const KEYFRAME_TICKS = 30 // a full market refresh every ~30s; ticks in between only carry what changed
const live = (t: { status: string }) => t.status === 'bonding' || t.status === 'graduated'

// Numbers go over the wire with 6 significant digits (3 for volumes on chart points): plenty for prices and
// balances, and a third of the bytes of a raw double.
const r6 = (x: number) => (Number.isInteger(x) ? x : Number(x.toPrecision(6)))
const r3 = (x: number) => (Number.isInteger(x) ? x : Number(x.toPrecision(3)))
function round(v: unknown): unknown {
  if (typeof v === 'number') return Number.isFinite(v) ? r6(v) : v
  if (Array.isArray(v)) return v.map(round)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) o[k] = round(x)
    return o
  }
  return v
}

interface Member {
  info: RoomPlayer
  ws: WebSocket | null
  protect: string[]
  lastPostTick?: number
  addrs?: string[] // their wallet addresses (private: only used to route transfers sent to an address)
  inbox?: TransferMsg[] // transfers that arrived while they were offline
}

export class Room {
  readonly code: string
  hostId = ''
  members = new Map<string, Member>()
  market!: MarketState
  wallets: SimWallet[] = []
  posts: SocialPost[] = []
  events: MarketEvent[] = []
  round!: RoundInfo
  emptySince: number | null = null

  private pending = new Map<string, CandlePoint[]>() // chart points since the last tick
  private freshIds = new Set<string>() // coins cooked since the last tick (others need their candles)
  private playerEvents: MarketEvent[] = [] // cooks, dev sells… announced with the next tick
  private playerPosts: SocialPost[] = [] // players' posts on the timeline, sent with the next tick
  private bots = new Map<string, VolumeBot>() // tokenId → a player's volume bot on their own coin
  private lastTapeId = 0
  private lastWalletTradeId = 0
  private sentTokens = new Map<string, Record<string, string>>() // coin → field → JSON last sent (for diffs)
  private sentWallets = new Map<string, string>() // wallet → JSON last sent (without trades)
  private playersDirty = false
  private timer: ReturnType<typeof setInterval>

  constructor(code: string) {
    this.code = code
    this.newMarket({ id: 0, state: 'lobby', mode: 'practice', durationTicks: null, startTick: 0, seed: 0, startTime: 0 })
    this.timer = setInterval(() => this.tick(), 1000)
  }

  dispose() {
    clearInterval(this.timer)
    for (const t of this.market.tokens) candleStore.delete(t.id)
  }

  // ─── Players ───────────────────────────────────────────────────────────────
  join(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>) {
    const existing = this.members.get(msg.playerId)
    const info: RoomPlayer = existing
      ? { ...existing.info, name: msg.name, avatar: msg.avatar, level: msg.level, online: true }
      : { id: msg.playerId, name: msg.name, avatar: msg.avatar, level: msg.level, online: true, equity: 0, startEquity: 0, trades: 0, wins: 0 }
    existing?.ws?.close(4000, 'Joined from another tab')
    this.members.set(msg.playerId, { info, ws, protect: existing?.protect ?? [], addrs: existing?.addrs })
    if (!this.hostId) this.hostId = msg.playerId
    this.emptySince = null
    this.send(ws, {
      t: 'welcome', you: msg.playerId, code: this.code, hostId: this.hostId, players: this.playerList(), round: this.round,
      market: this.netMarket(), wallets: round(this.wallets) as SimWallet[], posts: this.posts, events: this.events,
    })
    for (const tr of existing?.inbox ?? []) this.send(ws, tr) // transfers that came in while they were away
    this.broadcastPlayers()
  }

  leave(playerId: string, ws: WebSocket) {
    const m = this.members.get(playerId)
    if (!m || m.ws !== ws) return // an old socket closing after a reconnect
    m.ws = null
    m.info.online = false
    // The host keeps the crown through a quick reload; after 20s away it passes to someone still here.
    if (this.hostId === playerId) {
      setTimeout(() => {
        if (this.hostId !== playerId || this.members.get(playerId)?.info.online) return
        const next = [...this.members.values()].find((x) => x.info.online)
        if (next) {
          this.hostId = next.info.id
          this.broadcastPlayers()
        }
      }, 20_000)
    }
    if (![...this.members.values()].some((x) => x.info.online)) this.emptySince = Date.now()
    this.broadcastPlayers()
  }

  handle(playerId: string, msg: ClientMsg) {
    const me = this.members.get(playerId)
    if (!me) return
    switch (msg.t) {
      case 'start':
        if (playerId !== this.hostId) return this.sendTo(playerId, { t: 'error', message: 'Only the host can start a round' })
        return this.startRound(msg.mode, msg.durationTicks, msg.engine === 'realistic' ? 'realistic' : 'classic')
      case 'trade':
        return this.trade(me, msg)
      case 'cook':
        return this.cook(me, msg)
      case 'patch': {
        const t = this.market.tokens.find((x) => x.id === msg.tokenId) as NetToken | undefined
        if (t && t.creatorId === playerId) Object.assign(t, msg.patch)
        return
      }
      case 'bot': {
        const t = this.market.tokens.find((x) => x.id === msg.tokenId) as NetToken | undefined
        if (!t || t.creatorId !== playerId) return
        if (msg.bot?.on) this.bots.set(msg.tokenId, msg.bot)
        else this.bots.delete(msg.tokenId)
        return
      }
      case 'status':
        me.info = {
          ...me.info, equity: msg.equity, startEquity: msg.startEquity, trades: msg.trades, wins: msg.wins, level: msg.level, finished: msg.finished,
          ...(Number.isFinite(msg.seasonPoints) ? { seasonPoints: Math.max(0, Math.round(msg.seasonPoints!)) } : {}),
          ...(Array.isArray(msg.holdings)
            ? { holdings: msg.holdings.slice(0, 30).filter((h) => h && typeof h.tokenId === 'string' && h.qty > 0).map((h) => ({ tokenId: h.tokenId, qty: +h.qty || 0, cost: +h.cost || 0, openedAt: +h.openedAt || 0 })) }
            : {}),
        }
        me.protect = msg.protect.slice(0, 200)
        if (Array.isArray(msg.addrs)) me.addrs = msg.addrs.filter((a) => typeof a === 'string').slice(0, 12).map((a) => a.slice(0, 24))
        this.playersDirty = true
        return
      case 'candles':
        return this.sendTo(playerId, { t: 'candles', tokenId: msg.tokenId, candles: candleStore.get(msg.tokenId) ?? null })
      case 'event': {
        const t = this.market.tokens.find((x) => x.id === msg.event.tokenId)
        if (!t || t.creatorId !== playerId) return
        this.playerEvents.push({ ...msg.event, by: playerId, text: msg.event.text.replace('(you)', `(${me.info.name})`).slice(0, 200) })
        return
      }
      case 'post':
        return this.post(me, msg)
      case 'send':
        return this.transfer(me, msg)
      case 'chat': {
        const text = msg.text.trim().slice(0, 200)
        if (text) this.broadcast({ t: 'chat', from: playerId, name: me.info.name, avatar: me.info.avatar, text, time: Date.now() })
        return
      }
    }
  }

  // ─── Rounds ────────────────────────────────────────────────────────────────
  private newMarket(round: RoundInfo) {
    if (this.market) for (const t of this.market.tokens) candleStore.delete(t.id)
    const seed = (Math.random() * 2 ** 32) >>> 0
    const startTime = Math.floor(Date.now() / 1000)
    setCandleLog(null) // the opening history is rebuilt in every browser from the same seed
    this.market = createMarket(seed, startTime, round.engine ?? 'classic', { keepCandles: true })
    this.wallets = createWallets(new Rng((seed ^ 0xa11ce) >>> 0))
    this.posts = []
    this.events = []
    this.bots.clear()
    this.freshIds.clear()
    this.sentTokens?.clear() // new market: the next tick sends every coin in full
    this.sentWallets?.clear()
    this.pending = new Map()
    this.lastTapeId = this.market.nextTradeId - 1
    this.lastWalletTradeId = this.market.nextTradeId - 1
    this.round = { ...round, seed, startTime, startTick: this.market.tick }
  }

  private startRound(mode: GameMode, durationTicks: number | null, engine: MarketEngine) {
    if (!MODES[mode]) return
    this.newMarket({ id: this.round.id + 1, state: 'running', mode, durationTicks, startTick: 0, seed: 0, startTime: 0, engine })
    for (const m of this.members.values()) m.info = { ...m.info, equity: 0, startEquity: 0, trades: 0, wins: 0, finished: false }
    this.broadcast({ t: 'round', round: this.round, market: this.netMarket(), wallets: round(this.wallets) as SimWallet[] })
    this.broadcastPlayers()
  }

  // ─── Player actions on the shared market ───────────────────────────────────
  private trade(me: Member, msg: Extract<ClientMsg, { t: 'trade' }>) {
    const t = this.market.tokens.find((x) => x.id === msg.tokenId)
    if (!t || !live(t) || !(msg.usd > 0)) return
    setClock(secPerTickOf(this.market))
    setCandleLog(this.pending)
    const newPrice = msg.side === 'buy' ? quoteBuy(t, msg.usd).newPrice : Math.max(1e-13, quoteSell(t, Math.max(0, msg.qty)).newPrice)
    // Main wallet: public, shows the player's name. Side wallets: only the address, so nobody knows it's them.
    const addr = typeof msg.addr === 'string' ? msg.addr.slice(0, 24) : undefined
    const who = msg.main !== false || !addr ? { name: me.info.name, pid: me.info.id, addr } : { name: addr, addr }
    this.market = applyPlayerTrade(this.market, t.id, msg.side, msg.usd, newPrice, who)
  }

  /** Coins from one player to another (to their main wallet, or to a wallet by address). */
  private transfer(me: Member, msg: Extract<ClientMsg, { t: 'send' }>) {
    const fail = (error: string) => this.sendTo(me.info.id, { t: 'sendResult', ref: msg.ref, ok: false, error })
    if (this.round.state !== 'running') return fail('Transfers work during a round')
    if (!['sol', 'bsc', 'hood', 'usdc'].includes(msg.asset) || !(msg.amount > 0) || !Number.isFinite(msg.amount)) return fail('Bad amount')
    let target: Member | undefined
    let toAddr: string | undefined
    if (msg.to) target = this.members.get(msg.to)
    else if (msg.toAddr) {
      toAddr = msg.toAddr.trim().slice(0, 24)
      target = [...this.members.values()].find((m) => m.addrs?.includes(toAddr!))
    }
    if (!target) return fail(msg.toAddr ? 'No wallet in this room has that address' : 'That player isn’t in this room')
    if (target === me) return fail('That’s your own wallet — move coins between your wallets in Wallets')
    const fromAddr = String(msg.fromAddr ?? '').slice(0, 24)
    const recv: TransferMsg = {
      t: 'recv', asset: msg.asset, amount: msg.amount, usd: Math.max(0, +msg.usd || 0),
      ...(msg.main ? { from: me.info.name, fromPid: me.info.id } : { from: fromAddr || 'unknown wallet' }),
      ...(toAddr ? { toAddr } : {}),
    }
    this.sendTo(me.info.id, { t: 'sendResult', ref: msg.ref, ok: true, toName: toAddr ?? target.info.name })
    if (target.ws) this.send(target.ws, recv)
    else target.inbox = [...(target.inbox ?? []), recv].slice(-50)
  }

  private cook(me: Member, msg: Extract<ClientMsg, { t: 'cook' }>) {
    if (this.market.tokens.some((x) => x.id === msg.token.id)) return
    const token: NetToken = { ...msg.token, creator: 'you', creatorId: me.info.id, creatorName: me.info.name, tape: msg.token.tape ?? [] }
    this.market = { ...this.market, tokens: [token, ...this.market.tokens] }
    if (msg.candles) candleStore.set(token.id, msg.candles)
    this.freshIds.add(token.id)
    this.playerEvents.push({ by: me.info.id, id: this.market.tick * 100 + 97, tick: this.market.tick, time: this.market.time, kind: 'cook', tokenId: token.id, ticker: token.ticker, text: `${me.info.avatar} ${me.info.name} cooked $${token.ticker}`, icon: '🍳', tone: 'info' })
  }

  /** A player's post on the timeline: the crowd reacts on the shared market; everyone sees it next tick. */
  private post(me: Member, msg: Extract<ClientMsg, { t: 'post' }>) {
    const text = String(msg.text ?? '').trim().slice(0, 200)
    if (!text || this.market.tick - (me.lastPostTick ?? -999) < POST_COOLDOWN_TICKS) return
    me.lastPostTick = this.market.tick
    setClock(secPerTickOf(this.market))
    const t = msg.tokenId ? this.market.tokens.find((x) => x.id === msg.tokenId) : undefined
    const author = {
      name: me.info.name, handle: me.info.name.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'player', avatar: me.info.avatar, pid: me.info.id,
      followers: Math.max(0, Math.min(5_000_000, Math.round(msg.followers) || 0)), rep: Math.max(0, Math.min(100, Math.round(msg.rep) || 0)),
    }
    const res = shill(this.market, new Rng((Math.random() * 2 ** 32) >>> 0), t, author, text, Math.max(0, Math.min(10, msg.repeats | 0)))
    this.market.shillQueue = [...(this.market.shillQueue ?? []), ...res.queue]
    this.playerPosts.push({
      id: this.market.tick * 1000 + 900 + this.playerPosts.length, tick: this.market.tick, time: this.market.time, accountId: 'player', author, text,
      tokenId: t?.id, ticker: t?.ticker, mcapAtPost: t?.mcap, peakMcap: t?.mcap, isCall: !!t, likes: res.likes, rts: res.rts, replies: res.replies, buyers: res.buyers,
    })
  }

  // ─── The clock ─────────────────────────────────────────────────────────────
  private tick() {
    if (![...this.members.values()].some((m) => m.info.online)) return // nobody watching: freeze
    setClock(secPerTickOf(this.market)) // rooms can run different clocks (Classic 6s / Realistic 1s per tick)
    setCandleLog(this.pending)
    const rng = new Rng(this.market.seed)
    const prevIds = new Set(this.market.tokens.map((t) => t.id))
    const protectedIds = new Set([...this.members.values()].flatMap((m) => m.protect))
    for (const id of this.bots.keys()) protectedIds.add(id)
    const { market, events: e1 } = tickMarket(this.market, rng, { rugMult: MODES[this.round.mode].rugMult, protectedIds })
    const e2 = rollEvents(market, rng)
    const wr = tickWallets(this.wallets, market, rng)
    const posts = [...tickSocial(market, rng, wr.actions, [...e1, ...e2]), ...this.playerPosts]
    this.playerPosts = []

    // Players' dev tools: volume bots on their coins, and sleuths hunting bundles.
    const bots: Record<string, BotRun> = {}
    const devEvents: MarketEvent[] = []
    for (const [tokenId, bot] of this.bots) {
      const t = market.tokens.find((x) => x.id === tokenId)
      if (!t || !live(t)) {
        this.bots.delete(tokenId)
        continue
      }
      const res = runBotTick(t, bot, market, rng)
      bots[tokenId] = res
      if (res.event) devEvents.push(res.event)
    }
    for (const t of market.tokens as NetToken[]) {
      if (t.creatorId && sleuthBundle(t, rng)) devEvents.push(flagBundle(t, market, t.bundleWallets ?? 0))
    }
    devEvents.forEach((e, i) => (e.id = market.tick * 100 + 90 + i))
    market.seed = rng.s
    this.market = market
    this.wallets = wr.wallets

    // Coins that appeared this tick: send their whole chart instead of points.
    const newCandles: TickMsg['newCandles'] = {}
    for (const t of market.tokens) {
      if (!prevIds.has(t.id) || this.freshIds.has(t.id)) {
        const c = candleStore.get(t.id)
        if (c) newCandles[t.id] = c
        this.pending.delete(t.id)
      }
    }
    this.freshIds.clear()
    // Coins that were delisted: free their candles.
    const nowIds = new Set(market.tokens.map((t) => t.id))
    for (const id of prevIds) if (!nowIds.has(id)) candleStore.delete(id)

    const events = [...e1, ...e2, ...devEvents, ...this.playerEvents]
    this.playerEvents = []
    this.events = [...events.slice().reverse(), ...this.events].slice(0, EVENTS_KEPT)
    this.posts = [...posts.slice().reverse(), ...this.posts].slice(0, POSTS_KEPT)

    // Every ~30s, forget what was sent so this tick is a full refresh (repairs anything a client missed).
    if (market.tick % KEYFRAME_TICKS === 0) {
      this.sentTokens.clear()
      this.sentWallets.clear()
    }
    const points: TickMsg['points'] = {}
    for (const [id, pts] of this.pending) points[id] = pts.map(([time, price, prev, vol]) => [time, r6(price), r6(prev), r3(vol)])
    const msg: TickMsg = {
      t: 'tick', market: this.tickMarketDiff(), wallets: this.walletDiff(), events, posts, actions: wr.actions,
      points, newCandles, bots,
    }
    this.pending = new Map()
    setCandleLog(null)

    if (this.round.state === 'running' && this.round.durationTicks && market.tick - this.round.startTick >= this.round.durationTicks) {
      this.round = { ...this.round, state: 'ended' }
      this.broadcast(msg)
      this.broadcast({ t: 'round', round: this.round })
    } else this.broadcast(msg)
    if (this.playersDirty) this.broadcastPlayers()
  }

  // ─── Wire formats ──────────────────────────────────────────────────────────
  /** The whole market, numbers rounded (welcome / round start). */
  private netMarket(): NetMarket {
    let max = this.lastTapeId
    for (const t of this.market.tokens) for (const e of t.tape) if (e.id > max) max = e.id
    return round({ ...this.market, tokens: this.market.tokens }) as NetMarket
  }

  /**
   * This tick's market: every coin as `id` + only the fields that changed since the last tick (rounded), plus its new
   * trades. `sim` (the hidden simulation state) goes out once per coin: browsers only read its constant archetype.
   */
  private tickMarketDiff(): TickMsg['market'] {
    const since = this.lastTapeId
    let max = since
    const tokens: TokenDiff[] = this.market.tokens.map((t) => {
      const prev = this.sentTokens.get(t.id)
      const snap: Record<string, string> = prev ?? {}
      const out: TokenDiff = { id: t.id }
      for (const [k, v] of Object.entries(t)) {
        if (k === 'id' || k === 'tape' || (k === 'sim' && prev)) continue
        const rv = round(v)
        const js = JSON.stringify(rv)
        if (!prev || prev[k] !== js) {
          ;(out as Record<string, unknown>)[k] = rv
          snap[k] = js
        }
      }
      this.sentTokens.set(t.id, snap)
      const tape = t.tape.filter((e) => e.id > since)
      for (const e of tape) if (e.id > max) max = e.id
      if (tape.length) out.tape = round(tape) as TokenDiff['tape']
      return out
    })
    for (const id of this.sentTokens.keys()) if (!this.market.tokens.some((t) => t.id === id)) this.sentTokens.delete(id)
    this.lastTapeId = max
    const { tokens: _all, ...rest } = this.market
    void _all
    return { ...(round(rest) as Omit<NetMarket, 'tokens'>), tokens }
  }

  /** Only wallets that changed (a trade, a position) go out; `trades` carries just the new ones. */
  private walletDiff(): WalletDiff[] {
    const since = this.lastWalletTradeId
    let max = since
    const out: WalletDiff[] = []
    for (const w of this.wallets) {
      const trades = w.trades.filter((tr) => tr.id > since)
      for (const tr of trades) if (tr.id > max) max = tr.id
      const { trades: _t, ...rest } = w
      void _t
      const rw = round(rest) as Omit<SimWallet, 'trades'>
      const js = JSON.stringify(rw)
      if (this.sentWallets.get(w.id) === js && !trades.length) continue
      this.sentWallets.set(w.id, js)
      out.push({ ...rw, trades: round(trades) as SimWallet['trades'] })
    }
    this.lastWalletTradeId = max
    return out
  }

  private playerList(): RoomPlayer[] {
    return [...this.members.values()].map((m) => m.info)
  }

  private broadcastPlayers() {
    this.playersDirty = false
    this.broadcast({ t: 'players', hostId: this.hostId, players: this.playerList() })
  }

  private send(ws: WebSocket | null, msg: ServerMsg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
  }

  private sendTo(playerId: string, msg: ServerMsg) {
    this.send(this.members.get(playerId)?.ws ?? null, msg)
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg)
    for (const m of this.members.values()) if (m.ws && m.ws.readyState === 1) m.ws.send(data)
  }
}
