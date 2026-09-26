// One multiplayer room: a shared market ticking once a second, the players in it, and the current round.
// The market code is the same the single-player game runs; browsers keep their own wallets and send trades here.
import type { WebSocket } from 'ws'
import { createMarket, candleStore, applyPlayerTrade, quoteBuy, quoteSell, secPerTickOf, setCandleLog, setClock, tickMarket, type CandlePoint } from '../src/game/marketEngine'
import { rollEvents } from '../src/game/eventEngine'
import { createWallets, tickWallets } from '../src/game/walletEngine'
import { tickSocial } from '../src/game/socialEngine'
import { flagBundle, runBotTick, sleuthBundle } from '../src/game/devTools'
import { MODES } from '../src/game/progression'
import { Rng } from '../src/utils/rng'
import type { GameMode, MarketEngine, MarketEvent, MarketState, SimWallet, SocialPost, VolumeBot } from '../src/types'
import type { BotRun, ClientMsg, NetMarket, NetToken, RoomPlayer, RoundInfo, ServerMsg, TickMsg } from '../src/net/protocol'

const POSTS_KEPT = 60
const EVENTS_KEPT = 60
const live = (t: { status: string }) => t.status === 'bonding' || t.status === 'graduated'

interface Member {
  info: RoomPlayer
  ws: WebSocket | null
  protect: string[]
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
  private bots = new Map<string, VolumeBot>() // tokenId → a player's volume bot on their own coin
  private lastTapeId = 0
  private lastWalletTradeId = 0
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
    this.members.set(msg.playerId, { info, ws, protect: existing?.protect ?? [] })
    if (!this.hostId) this.hostId = msg.playerId
    this.emptySince = null
    this.send(ws, {
      t: 'welcome', you: msg.playerId, code: this.code, hostId: this.hostId, players: this.playerList(), round: this.round,
      market: this.netMarket(false), wallets: this.wallets, posts: this.posts, events: this.events,
    })
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
        me.info = { ...me.info, equity: msg.equity, startEquity: msg.startEquity, trades: msg.trades, wins: msg.wins, level: msg.level, finished: msg.finished }
        me.protect = msg.protect.slice(0, 200)
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
    this.pending = new Map()
    this.lastTapeId = this.market.nextTradeId - 1
    this.lastWalletTradeId = this.market.nextTradeId - 1
    this.round = { ...round, seed, startTime, startTick: this.market.tick }
  }

  private startRound(mode: GameMode, durationTicks: number | null, engine: MarketEngine) {
    if (!MODES[mode]) return
    this.newMarket({ id: this.round.id + 1, state: 'running', mode, durationTicks, startTick: 0, seed: 0, startTime: 0, engine })
    for (const m of this.members.values()) m.info = { ...m.info, equity: 0, startEquity: 0, trades: 0, wins: 0, finished: false }
    this.broadcast({ t: 'round', round: this.round, market: this.netMarket(false), wallets: this.wallets })
    this.broadcastPlayers()
  }

  // ─── Player actions on the shared market ───────────────────────────────────
  private trade(me: Member, msg: Extract<ClientMsg, { t: 'trade' }>) {
    const t = this.market.tokens.find((x) => x.id === msg.tokenId)
    if (!t || !live(t) || !(msg.usd > 0)) return
    setClock(secPerTickOf(this.market))
    setCandleLog(this.pending)
    const newPrice = msg.side === 'buy' ? quoteBuy(t, msg.usd).newPrice : Math.max(1e-13, quoteSell(t, Math.max(0, msg.qty)).newPrice)
    this.market = applyPlayerTrade(this.market, t.id, msg.side, msg.usd, newPrice, { name: me.info.name, pid: me.info.id })
  }

  private cook(me: Member, msg: Extract<ClientMsg, { t: 'cook' }>) {
    if (this.market.tokens.some((x) => x.id === msg.token.id)) return
    const token: NetToken = { ...msg.token, creator: 'you', creatorId: me.info.id, creatorName: me.info.name, tape: msg.token.tape ?? [] }
    this.market = { ...this.market, tokens: [token, ...this.market.tokens] }
    if (msg.candles) candleStore.set(token.id, msg.candles)
    this.freshIds.add(token.id)
    this.playerEvents.push({ by: me.info.id, id: this.market.tick * 100 + 97, tick: this.market.tick, time: this.market.time, kind: 'cook', tokenId: token.id, ticker: token.ticker, text: `${me.info.avatar} ${me.info.name} cooked $${token.ticker}`, icon: '🍳', tone: 'info' })
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
    const posts = tickSocial(market, rng, wr.actions, [...e1, ...e2])

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

    const msg: TickMsg = {
      t: 'tick', market: this.netMarket(true), wallets: this.walletDiff(), events, posts, actions: wr.actions,
      points: Object.fromEntries(this.pending), newCandles, bots,
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
  /** The market; with `diff`, each coin's tape only carries trades new since the last tick. */
  private netMarket(diff: boolean): NetMarket {
    const since = this.lastTapeId
    let max = since
    const tokens = this.market.tokens.map((t) => {
      for (const e of t.tape) if (e.id > max) max = e.id
      return diff ? { ...t, tape: t.tape.filter((e) => e.id > since) } : t
    })
    if (diff) this.lastTapeId = max
    return { ...this.market, tokens }
  }

  private walletDiff(): SimWallet[] {
    const since = this.lastWalletTradeId
    let max = since
    const out = this.wallets.map((w) => {
      const trades = w.trades.filter((tr) => tr.id > since)
      for (const tr of trades) if (tr.id > max) max = tr.id
      return { ...w, trades }
    })
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
