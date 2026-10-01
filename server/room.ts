// One multiplayer room: a shared market ticking once a second, the players in it, and the current round.
// The market code is the same the single-player game runs. The server is the judge of every player's wallets: orders,
// cooking, airdrops, bots, creator fees and cashback all run here (the game just shows the result instantly).
import type { WebSocket } from 'ws'
import { adminMarket, type AdminMarketAction, rebuildCandlesFor, createMarket, candleStore, COOK_COOLDOWN_TICKS, COOK_FEE, cookToken, GRAD_BONUS, MAX_COOKS_PER_ROUND, secPerTickOf, setCandleLog, setClock, tickMarket, walletName, type CandlePoint } from '../src/game/marketEngine'
import { BOT_BUST_USD, BOT_RESTART_USD, BOT_ROSTER, chatLine, freshBrain, mirrorWallet, pickCoin, STYLE, type BotBrain } from './bots'
import { generatedLaunch } from '../src/data/tokens'
import { valuePortfolio } from '../src/game/portfolioEngine'
import { rollEvents } from '../src/game/eventEngine'
import { createWallets, tickWallets } from '../src/game/walletEngine'
import { POST_COOLDOWN_TICKS, shill, tickSocial } from '../src/game/socialEngine'
import { addFunds, applyLayout, freshWallet, fundsIn, payNative, runBuy, runGiveAway, runSell, runSwap, runTransfer, walletStateOf, type WalletLayout } from '../src/game/orders'
import { accountOf } from '../src/game/accounts'
import { nativePrice } from '../src/game/tradingEngine'
import { cashbackUsd } from '../src/game/rewardsEngine'
import { claimGifts } from './persist'
import { CHAINS } from '../src/data/chains'
import { walletAddress } from '../src/utils/address'
import { airdropFeePerWallet, botTickCost, BUNDLE_WALLET_FEE, flagBundle, runBotTick, sleuthBundle, STAGGER_FEE } from '../src/game/devTools'
import { MODES } from '../src/game/progression'
import { Rng } from '../src/utils/rng'
import type { Candle, Chain, CookSpec, Narrative, Token, WalletAction, WalletActionKind, GameMode, MarketEngine, MarketEvent, MarketState, Portfolio, SimWallet, SocialPost, Timeframe, Trade, VolumeBot } from '../src/types'
import { WORLD_START_BALANCE, type BotRun, type ClientMsg, type NetMarket, type NetToken, type RoomPlayer, type RoundInfo, type ServerMsg, type TickMsg, type TokenDiff, type TransferMsg, type WalletDiff } from '../src/net/protocol'

const POSTS_KEPT = 60
const EVENTS_KEPT = 60
const KEYFRAME_TICKS = 30 // a full market refresh every ~30s; ticks in between only carry what changed
const WORLD_TRADES_KEPT = 300 // World wallets live forever: keep their recent trade history only
const WORLD_DEAD_COIN_SEC = 3600 // World: dead player-cooked coins leave the market after an hour
const WORLD_FADE_AFTER_SEC = 1800 // World: a graduated coin can fade out once it's been on the DEX for 30 min…
const WORLD_FADE_MCAP = 5_000 // …and has sunk below this market cap
const WORLD_MAX_OLD_GRADS = 60 // at most this many older graduated coins stay alive (the biggest ones)
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
  // Phase 2: the server's copy of this player's wallets in the round (the judge), and the wallet messages it has handled.
  wallet?: Portfolio
  layout?: WalletLayout
  ack: number
  cashback?: Record<Chain, number> // earned on their fills, not yet claimed (chain coin)
  cbVolume?: number // their lifetime trading volume (sets the cashback tier)
  cbAuto?: 'off' | 'coin' | 'usdc'
  cooks?: number // coins cooked this round
  lastCookTick?: number
  brain?: BotBrain // World bots only
}

/** A coin a player cooked: who, the dev wallet that pays its bot and earns its fees, and its creator-fee vault. */
interface Cooked {
  pid: string
  walletId: string
  chain: Chain
  vault: number // unclaimed creator fees (chain coin)
  feeMark: number // the coin's creatorFees (USD) already counted into the vault
  grad: boolean // graduation bonus already added
}

/** A chart candle as saved: [time, open, high, low, close, volume]. */
type PackedCandle = [number, number, number, number, number, number]
/** The chart timeframes saved with a room (the short ones are re-drawn on restore). */
const SAVED_TFS: Timeframe[] = ['1m', '5m', '15m', '1h', '4h']

export interface RoomSnapshot {
  v: 1
  code: string
  world?: boolean
  hostId: string
  round: RoundInfo
  market: MarketState
  wallets: SimWallet[]
  posts: SocialPost[]
  events: MarketEvent[]
  bots: [string, VolumeBot][]
  lastTapeId: number
  lastWalletTradeId: number
  members: Omit<Member, 'ws' | 'ack'>[]
  cooked?: [string, Cooked][]
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
  private cooked = new Map<string, Cooked>() // tokenId → players' coins
  private lastTapeId = 0
  private lastWalletTradeId = 0
  private sentTokens = new Map<string, Record<string, string>>() // coin → field → JSON last sent (for diffs)
  private sentWallets = new Map<string, string>() // wallet → JSON last sent (without trades)
  private playersDirty = false
  private timer: ReturnType<typeof setInterval>

  /** The public World: one round that never ends, never pauses, and keeps everyone's wallet. */
  readonly world: boolean

  constructor(code: string, world = false) {
    this.code = code
    this.world = world
    this.newMarket(world
      ? { id: 1, state: 'running', mode: 'practice', durationTicks: null, startTick: 0, seed: 0, startTime: 0, engine: 'realistic', world: true }
      : { id: 0, state: 'lobby', mode: 'practice', durationTicks: null, startTick: 0, seed: 0, startTime: 0 })
    this.ensureBots()
    this.timer = setInterval(() => this.tick(), 1000)
  }

  dispose() {
    clearInterval(this.timer)
    for (const t of this.market.tokens) candleStore.delete(t.id)
  }

  // ─── Saving (Phase 2): a room survives server restarts / updates ─────────────
  /** Everything needed to bring this room back after a restart (players reconnect to it). */
  snapshot(): RoomSnapshot {
    return {
      v: 1, code: this.code, world: this.world || undefined, hostId: this.hostId, round: this.round, market: this.market, wallets: this.wallets,
      posts: this.posts.slice(0, 80), events: this.events.slice(0, 80), bots: [...this.bots.entries()],
      lastTapeId: this.lastTapeId, lastWalletTradeId: this.lastWalletTradeId, cooked: [...this.cooked.entries()],
      members: [...this.members.values()].filter((m) => !m.info.spectator).map((m) => ({
        info: { ...m.info, online: m.info.bot ? m.info.online : false }, protect: m.protect, addrs: m.addrs, inbox: m.inbox, wallet: m.wallet, layout: m.layout, lastPostTick: m.lastPostTick,
        cashback: m.cashback, cbVolume: m.cbVolume, cbAuto: m.cbAuto, cooks: m.cooks, lastCookTick: m.lastCookTick, brain: m.brain,
      })),
    }
  }

  /** The longer chart timeframes (1m and up) of this room's live coins; the short ones are re-drawn on restore. */
  chartSnapshot(): Record<string, Partial<Record<Timeframe, PackedCandle[]>>> {
    const out: Record<string, Partial<Record<Timeframe, PackedCandle[]>>> = {}
    const sig = (n: number) => (n === 0 ? 0 : Number(n.toPrecision(6)))
    for (const t of this.market.tokens) {
      if (!live(t)) continue
      const c = candleStore.get(t.id)
      if (!c) continue
      const tfs: Partial<Record<Timeframe, PackedCandle[]>> = {}
      for (const tf of SAVED_TFS) tfs[tf] = (c[tf] ?? []).map((k) => [k.time, sig(k.open), sig(k.high), sig(k.low), sig(k.close), sig(k.volume)])
      out[t.id] = tfs
    }
    return out
  }

  /** Bring a saved room back: its market, round, players (offline until they reconnect) and their wallets. */
  static restore(s: RoomSnapshot, charts?: Record<string, Partial<Record<Timeframe, PackedCandle[]>>> | null): Room {
    const r = new Room(s.code, !!s.world)
    for (const t of r.market.tokens) candleStore.delete(t.id) // the placeholder market's charts
    r.hostId = s.hostId
    r.round = s.round
    r.market = s.market
    r.wallets = s.wallets ?? []
    r.posts = s.posts ?? []
    r.events = s.events ?? []
    r.bots = new Map(s.bots ?? [])
    r.cooked = new Map(s.cooked ?? [])
    r.lastTapeId = s.lastTapeId ?? r.market.nextTradeId - 1
    r.lastWalletTradeId = s.lastWalletTradeId ?? r.market.nextTradeId - 1
    r.members.clear() // the placeholder World's bots; the saved ones come back below
    r.wallets = s.wallets ?? []
    for (const m of s.members ?? []) r.members.set(m.info.id, { ...m, ws: null, ack: 0, info: { ...m.info, online: m.info.bot ? m.info.online : false } })
    r.ensureBots()
    r.emptySince = Date.now()
    // Charts: re-draw every coin to end at its price, then put back the real longer timeframes we saved.
    setClock(secPerTickOf(r.market))
    rebuildCandlesFor(r.market)
    for (const [id, tfs] of Object.entries(charts ?? {})) {
      const c = candleStore.get(id)
      if (!c) continue
      for (const [tf, arr] of Object.entries(tfs) as [Timeframe, PackedCandle[]][]) {
        if (Array.isArray(arr) && arr.length) c[tf] = arr.map(([time, open, high, low, close, volume]): Candle => ({ time, open, high, low, close, volume }))
      }
    }
    r.sentTokens.clear() // first tick after restore sends every coin in full
    r.sentWallets.clear()
    return r
  }

  // ─── Players ───────────────────────────────────────────────────────────────
  join(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }> & { verified?: boolean }) {
    const existing = this.members.get(msg.playerId)
    // World: you need an account to play; guests watch (WORLD_GUESTS_PLAY=1 lets guests play, for local testing only).
    const spectator = this.world && !msg.verified && process.env.WORLD_GUESTS_PLAY !== '1'
    const info: RoomPlayer = existing
      ? { ...existing.info, name: msg.name, avatar: msg.avatar, level: msg.level, online: true, verified: !!msg.verified, spectator: spectator || undefined }
      : { id: msg.playerId, name: msg.name, avatar: msg.avatar, level: msg.level, online: true, equity: 0, startEquity: 0, trades: 0, wins: 0, verified: !!msg.verified, spectator: spectator || undefined }
    existing?.ws?.close(4000, 'Joined from another tab')
    this.members.set(msg.playerId, { ...existing, info, ws, protect: existing?.protect ?? [], inbox: undefined, ack: 0 }) // a new connection restarts the wallet message count (the game does too)
    if (!this.hostId && !this.world) this.hostId = msg.playerId
    this.emptySince = null
    this.send(ws, {
      t: 'welcome', you: msg.playerId, code: this.code, hostId: this.hostId, players: this.playerList(), round: this.round, spectator: spectator || undefined,
      market: this.netMarket(), wallets: round(this.wallets) as SimWallet[], posts: this.posts, events: this.events,
    })
    for (const tr of existing?.inbox ?? []) this.send(ws, tr) // transfers that came in while they were away
    const joined = this.members.get(msg.playerId)!
    if (this.walletOf(joined)) this.sendWallet(joined)
    this.broadcastPlayers()
  }

  leave(playerId: string, ws: WebSocket) {
    const m = this.members.get(playerId)
    if (!m || m.ws !== ws) return // an old socket closing after a reconnect
    m.ws = null
    m.info.online = false
    if (m.info.spectator) this.members.delete(playerId)
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
    if (me.info.spectator && msg.t !== 'candles') return // watching only
    switch (msg.t) {
      case 'start':
        if (this.world) return this.sendTo(playerId, { t: 'error', message: 'The World never stops: no new rounds here' })
        if (playerId !== this.hostId) return this.sendTo(playerId, { t: 'error', message: 'Only the host can start a round' })
        return this.startRound(msg.mode, msg.durationTicks, msg.engine === 'realistic' ? 'realistic' : 'classic')
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
        // What it has spent is counted here (the bot is paid on the server), not taken from the game.
        const was = this.bots.get(msg.tokenId)
        if (msg.bot?.on) this.bots.set(msg.tokenId, { ...msg.bot, spent: was?.spent ?? Math.max(0, Number(msg.bot.spent) || 0), volume: was?.volume ?? Math.max(0, Number(msg.bot.volume) || 0) })
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
        if (Number.isFinite(msg.cbVolume)) me.cbVolume = Math.max(0, Number(msg.cbVolume))
        if (msg.cbAuto === 'off' || msg.cbAuto === 'coin' || msg.cbAuto === 'usdc') me.cbAuto = msg.cbAuto
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
      case 'order':
        return this.order(me, msg)
      case 'op':
        return this.op(me, msg)
      case 'layout': {
        me.layout = msg.layout
        const w = this.walletOf(me)
        if (w) me.wallet = applyLayout(w, msg.layout)
        me.ack = Math.max(me.ack, msg.seq)
        return this.sendWallet(me)
      }
      case 'airdrop':
        return this.airdrop(me, msg)
      case 'chat': {
        const text = msg.text.trim().slice(0, 200)
        if (text) this.broadcast({ t: 'chat', from: playerId, name: me.info.name, avatar: me.info.avatar, text, time: Date.now() })
        return
      }
    }
  }

  /** A player's airdrop: the tokens leave their dev wallet here, and recipients who'll dump go on the shared market. */
  private airdrop(me: Member, msg: Extract<ClientMsg, { t: 'airdrop' }>) {
    if (msg.seq !== undefined) me.ack = Math.max(me.ack, msg.seq)
    const t = this.market.tokens.find((x) => x.id === msg.tokenId) as NetToken | undefined
    const c = this.cooked.get(msg.tokenId)
    const w = this.walletOf(me)
    if (!t || !c || c.pid !== me.info.id || !w || !Array.isArray(msg.queue) || !live(t)) return this.sendWallet(me)
    const n = Math.max(1, Math.min(500, Math.round(Number(msg.wallets) || 1)))
    const fee = airdropFeePerWallet(t.chain, msg.target === 'fresh' ? 'fresh' : 'holders') * n
    const r = runGiveAway(w, c.walletId, t.id, Math.max(0, Number(msg.qty) || 0), t.chain, fee)
    if (!r.ok) return this.sendWallet(me)
    me.wallet = r.portfolio
    // Recipients who'll dump what they got (never more than was given away).
    const tick = this.market.tick
    let left = r.qty
    const queue = msg.queue.slice(0, 200).filter((q) => q && q.side === 'sell' && q.qty! > 0 && q.qty! < 1e12).map((q) => {
      const qty = Math.min(+q.qty!, left)
      left -= qty
      return { tokenId: t.id, atTick: Math.min(tick + 3600, Math.max(tick + 1, Math.round(+q.atTick || 0))), usd: 0, wallet: String(q.wallet ?? '').slice(0, 24), side: 'sell' as const, qty }
    }).filter((q) => q.qty > 0)
    this.market = { ...this.market, shillQueue: [...(this.market.shillQueue ?? []), ...queue] }
    this.sendWallet(me)
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
    this.cooked.clear()
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
    for (const m of this.members.values()) {
      m.info = { ...m.info, equity: 0, startEquity: 0, trades: 0, wins: 0, finished: false }
      m.wallet = freshWallet(this.startBalance(), m.layout)
      m.cashback = undefined
      m.cooks = 0
      m.lastCookTick = undefined
    }
    this.broadcast({ t: 'round', round: this.round, market: this.netMarket(), wallets: round(this.wallets) as SimWallet[] })
    for (const m of this.members.values()) this.sendWallet(m)
    this.broadcastPlayers()
  }

  // ─── Wallets (Phase 2: the server is the judge of every player's wallets) ──
  /** This player's wallets in the running round (created fresh when they first need them). */
  private walletOf(m: Member): Portfolio | null {
    if (this.round.state !== 'running' || m.info.spectator) return null
    if (!m.wallet) m.wallet = freshWallet(this.startBalance(), m.layout)
    return m.wallet
  }

  /** What a fresh wallet starts with here. */
  private startBalance() {
    return this.world ? WORLD_START_BALANCE : MODES[this.round.mode].startBalance
  }

  /** Tell a player their wallets as the server has them (after the wallet message numbered `m.ack`). */
  private sendWallet(m: Member, extra: { ref?: number; fills?: Trade[]; failures?: string[] } = {}) {
    if (!m.wallet) return
    if (this.world && m.wallet.trades.length > WORLD_TRADES_KEPT) m.wallet = { ...m.wallet, trades: m.wallet.trades.slice(0, WORLD_TRADES_KEPT) }
    const vaults: Record<string, number> = {}
    for (const [id, c] of this.cooked) if (c.pid === m.info.id) vaults[id] = c.vault
    const state = { ...walletStateOf(m.wallet), cashback: m.cashback ?? { sol: 0, bsc: 0, hood: 0 }, vaults }
    this.sendTo(m.info.id, { t: 'wallet', ack: m.ack, state, ...extra })
  }

  /** Cashback on a player's fills (a share of the platform fee, tiered by their volume), paid now if they auto-claim. */
  private earn(m: Member, fills: Trade[]) {
    if (!m.wallet || !fills.length) return
    const earned: [Chain, number][] = []
    for (const f of fills) {
      const usd = cashbackUsd(f, m.cbVolume ?? 0)
      m.cbVolume = (m.cbVolume ?? 0) + f.value
      const chain = f.chain ?? this.market.tokens.find((t) => t.id === f.tokenId)?.chain ?? 'sol'
      if (usd > 0) earned.push([chain, usd / nativePrice(this.market, chain)])
    }
    if (m.cbAuto === 'coin' || m.cbAuto === 'usdc') m.wallet = payNative(m.wallet, this.market, earned, m.cbAuto).portfolio
    else {
      const cb = { sol: 0, bsc: 0, hood: 0, ...(m.cashback ?? {}) }
      for (const [c, n] of earned) cb[c] += n
      m.cashback = cb
    }
  }

  /** How a wallet shows on the trades tape: the main wallet under the player's name, side wallets as a bare address. */
  private whoFor(m: Member) {
    const main = m.wallet?.accounts?.[0]?.id
    return (walletId: string) => {
      const addr = walletAddress(m.info.id, walletId, 'sol')
      return walletId === main ? { name: m.info.name, pid: m.info.id, addr } : { name: addr, addr }
    }
  }

  private order(me: Member, msg: Extract<ClientMsg, { t: 'order' }>) {
    me.ack = Math.max(me.ack, msg.seq)
    const w = this.walletOf(me)
    const o = msg.order
    if (!w || !o) return this.sendWallet(me, { ref: msg.ref, fills: [], failures: ['No round running'] })
    const t = this.market.tokens.find((x) => x.id === o.tokenId)
    if (!t) return this.sendWallet(me, { ref: msg.ref, fills: [], failures: ['Coin not found'] })
    setClock(secPerTickOf(this.market))
    setCandleLog(this.pending)
    const who = this.whoFor(me)
    const r = o.side === 'buy'
      ? runBuy(w, this.market, (o.walletIds ?? []).slice(0, 12), Math.max(0, Number(o.usdEach) || 0), t.id, { autoSwap: !!o.autoSwap, setting: o.setting, who })
      : runSell(w, this.market, (o.legs ?? []).slice(0, 12).map((l) => ({ walletId: String(l.walletId), qty: Math.max(0, Number(l.qty) || 0) })), t.id, { setting: o.setting, who })
    me.wallet = r.portfolio
    this.market = r.market
    this.earn(me, r.fills)
    this.sendWallet(me, { ref: msg.ref, fills: r.fills.map((f) => ({ ...f, ref: msg.ref })), failures: r.failures })
  }

  private op(me: Member, msg: Extract<ClientMsg, { t: 'op' }>) {
    me.ack = Math.max(me.ack, msg.seq)
    const w = this.walletOf(me)
    const o = msg.op
    if (w && o) {
      if (o.kind === 'swap') {
        const r = runSwap(w, this.market, o.from, o.to, Number(o.amount) || 0, String(o.walletId))
        if (r.ok) me.wallet = r.portfolio
      } else if (o.kind === 'transfer') {
        const r = runTransfer(w, String(o.fromId), String(o.toId), o.chain, Number(o.amount) || 0, this.market.tick)
        if (r.ok) me.wallet = r.portfolio
      } else if (o.kind === 'claimFees') {
        // Creator fees: each coin's vault goes to its dev wallet.
        const only = Array.isArray(o.tokenIds) ? new Set(o.tokenIds.map(String)) : null
        let p = w
        for (const [id, c] of this.cooked) {
          if (c.pid !== me.info.id || !(c.vault > 1e-12) || (only && !only.has(id))) continue
          p = payNative(p, this.market, [[c.chain, c.vault]], 'coin', c.walletId).portfolio
          c.vault = 0
        }
        me.wallet = p
      } else if (o.kind === 'cashback') {
        const cb = { sol: 0, bsc: 0, hood: 0, ...(me.cashback ?? {}) }
        const chains = (Array.isArray(o.chains) ? o.chains : []).filter((c): c is Chain => c === 'sol' || c === 'bsc' || c === 'hood')
        me.wallet = payNative(w, this.market, chains.map((c) => [c, cb[c]]), o.as === 'usdc' ? 'usdc' : 'coin').portfolio
        for (const c of chains) cb[c] = 0
        me.cashback = cb
      }
    }
    this.sendWallet(me)
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
    // The server moves the money in its own wallets too (it's the judge of both players' wallets).
    const sw = this.walletOf(me)
    const tw = this.walletOf(target)
    if (sw && fundsIn(sw, msg.asset, msg.fromWallet) < msg.amount - 1e-9) return fail('Not enough in that wallet')
    const usd = msg.asset === 'usdc' ? msg.amount : msg.amount * nativePrice(this.market, msg.asset)
    if (sw) {
      const w = addFunds(sw, msg.asset, -msg.amount, msg.fromWallet)
      me.wallet = { ...w, startBalance: Math.max(1, w.startBalance - usd) }
    }
    if (tw) {
      const toWallet = toAddr ? (tw.accounts ?? []).find((a) => walletAddress(target!.info.id, a.id, 'sol') === toAddr)?.id : undefined
      const w = addFunds(tw, msg.asset, msg.amount, toWallet)
      target.wallet = { ...w, startBalance: w.startBalance + usd }
    }
    const fromAddr = String(msg.fromAddr ?? '').slice(0, 24)
    const recv: TransferMsg = {
      t: 'recv', asset: msg.asset, amount: msg.amount, usd: Math.max(0, +msg.usd || 0),
      ...(msg.main ? { from: me.info.name, fromPid: me.info.id } : { from: fromAddr || 'unknown wallet' }),
      ...(toAddr ? { toAddr } : {}),
    }
    this.sendTo(me.info.id, { t: 'sendResult', ref: msg.ref, ok: true, toName: toAddr ?? target.info.name })
    if (target.ws) this.send(target.ws, recv)
    else target.inbox = [...(target.inbox ?? []), recv].slice(-50)
    this.sendWallet(me)
    this.sendWallet(target)
  }

  /**
   * A player launches a coin: the server charges the launch fee, marketing and bundle fees, puts the fresh coin on
   * the market, then runs the dev buy and the bundle from their dev wallet (the game showed all this instantly).
   */
  private cook(me: Member, msg: Extract<ClientMsg, { t: 'cook' }>) {
    if (msg.seq !== undefined) me.ack = Math.max(me.ack, msg.seq)
    const fail = (why: string) => this.sendWallet(me, { ref: msg.ref, fills: [], failures: [why] })
    const w = this.walletOf(me)
    const money = msg.money
    if (!w || !money || !msg.token?.id) return fail('No round running')
    if (this.market.tokens.some((x) => x.id === msg.token.id)) return fail('That coin already exists')
    if ((me.cooks ?? 0) >= MAX_COOKS_PER_ROUND) return fail(`Max ${MAX_COOKS_PER_ROUND} launches per round`)
    if (this.market.tick - (me.lastCookTick ?? -999) < COOK_COOLDOWN_TICKS) return fail('Kitchen cooling down')
    const chain = msg.token.chain
    const px = nativePrice(this.market, chain)
    const devWallet = accountOf(w, String(money.devWallet)) ? String(money.devWallet) : w.accounts?.[0]?.id ?? 'w-main'
    const b = money.bundle && money.bundle.wallets > 0 ? { wallets: Math.min(50, Math.round(money.bundle.wallets)), perWallet: Math.max(0, Number(money.bundle.perWallet) || 0), stagger: !!money.bundle.stagger } : null
    const bundleUsd = b ? b.wallets * b.perWallet * px : 0
    const bundleFees = bundleUsd > 0 ? b!.wallets * BUNDLE_WALLET_FEE + (b!.stagger ? bundleUsd * STAGGER_FEE : 0) : 0
    const marketing = Math.max(0, Number(money.marketing) || 0)
    const usdCosts = COOK_FEE + marketing + bundleFees
    if (usdCosts > w.cash + 1e-9) return fail('Not enough USD for the launch fees')

    me.cooks = (me.cooks ?? 0) + 1
    me.lastCookTick = this.market.tick
    me.wallet = { ...w, cash: w.cash - usdCosts, feesPaid: w.feesPaid + COOK_FEE + bundleFees }
    const token: NetToken = { ...msg.token, creator: 'you', creatorId: me.info.id, creatorName: me.info.name, tape: msg.token.tape ?? [], status: 'bonding', creatorFees: 0 }
    this.market = { ...this.market, tokens: [token, ...this.market.tokens] }
    if (msg.candles) candleStore.set(token.id, msg.candles)
    this.freshIds.add(token.id)
    this.cooked.set(token.id, { pid: me.info.id, walletId: devWallet, chain, vault: 0, feeMark: 0, grad: false })

    // Dev buy (shows as the dev wallet), then the bundle (shows as random wallets).
    setClock(secPerTickOf(this.market))
    setCandleLog(this.pending)
    const fills: Trade[] = []
    const failures: string[] = []
    const devUsd = Math.max(0, Number(money.devBuy) || 0) * px
    if (devUsd > 0) {
      const r = runBuy(me.wallet, this.market, [devWallet], devUsd, token.id, { autoSwap: !!money.autoSwap, who: this.whoFor(me) })
      me.wallet = r.portfolio
      this.market = r.market
      fills.push(...r.fills)
      failures.push(...r.failures)
    }
    if (bundleUsd > 0) {
      const rng = new Rng((Math.random() * 2 ** 32) >>> 0)
      const r = runBuy(me.wallet, this.market, [devWallet], bundleUsd, token.id, { autoSwap: !!money.autoSwap, who: () => ({ name: walletName(rng) }) })
      me.wallet = r.portfolio
      this.market = r.market
      fills.push(...r.fills.map((f) => ({ ...f, via: `Bundle ×${b!.wallets}` })))
      failures.push(...r.failures)
    }
    this.earn(me, fills)
    const c = this.cooked.get(token.id)!
    c.feeMark = this.market.tokens.find((x) => x.id === token.id)?.creatorFees ?? 0
    this.playerEvents.push({ by: me.info.id, id: this.market.tick * 100 + 97, tick: this.market.tick, time: this.market.time, kind: 'cook', tokenId: token.id, ticker: token.ticker, text: `${me.info.avatar} ${me.info.name} cooked $${token.ticker}`, icon: '🍳', tone: 'info' })
    this.sendWallet(me, { ref: msg.ref, fills: fills.map((f) => ({ ...f, ref: msg.ref })), failures })
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
    if (!this.world && ![...this.members.values()].some((m) => m.info.online)) return // nobody watching: freeze (the World never does)
    setClock(secPerTickOf(this.market)) // rooms can run different clocks (Classic 6s / Realistic 1s per tick)
    setCandleLog(this.pending)
    const rng = new Rng(this.market.seed)
    const prevIds = new Set(this.market.tokens.map((t) => t.id))
    // Coins players hold or watch aren't delisted (in the World: only players who are on right now).
    const protectedIds = new Set([...this.members.values()].filter((m) => !this.world || m.info.online).flatMap((m) => m.protect))
    for (const id of this.bots.keys()) protectedIds.add(id)
    const { market, events: e1 } = tickMarket(this.market, rng, { rugMult: MODES[this.round.mode].rugMult, protectedIds })
    const e2 = rollEvents(market, rng)
    const wr = tickWallets(this.wallets.filter((w) => !w.bot), market, rng)
    const posts = [...tickSocial(market, rng, wr.actions, [...e1, ...e2]), ...this.playerPosts]
    this.playerPosts = []

    // Players' dev tools: volume bots on their coins, and sleuths hunting bundles.
    const bots: Record<string, BotRun> = {}
    const devEvents: MarketEvent[] = []
    // A bot is paid for by its coin's dev wallet, here on the server; it stops when the money or budget runs out.
    const billed = new Set<Member>()
    for (const [tokenId, bot] of this.bots) {
      const t = market.tokens.find((x) => x.id === tokenId)
      const c = this.cooked.get(tokenId)
      const owner = c && this.members.get(c.pid)
      const w = owner && this.walletOf(owner)
      const stop = (why: string) => {
        this.bots.delete(tokenId)
        bots[tokenId] = { vol: 0, cost: 0, stop: why }
      }
      if (!t || !live(t)) {
        this.bots.delete(tokenId)
        continue
      }
      if (!c || !owner || !w) {
        stop('no dev wallet')
        continue
      }
      const px = nativePrice(market, t.chain)
      const have = (accountOf(w, c.walletId)?.balances[t.chain] ?? 0) * px
      if ((bot.spent ?? 0) >= bot.budget) {
        stop('budget used up')
        continue
      }
      if (have < botTickCost(t, bot.rate / 5)) {
        stop(`out of ${CHAINS[t.chain].native}`)
        continue
      }
      const res = runBotTick(t, bot, market, rng)
      const cost = Math.min(res.cost, have)
      owner.wallet = { ...addFunds(w, t.chain, -cost / px, c.walletId), feesPaid: w.feesPaid + cost }
      this.bots.set(tokenId, { ...bot, spent: (bot.spent ?? 0) + cost, volume: (bot.volume ?? 0) + res.vol })
      billed.add(owner)
      bots[tokenId] = res
      if (res.event) devEvents.push(res.event)
    }
    // Creator fees pile up in each player coin's vault (in its chain coin) until they claim them.
    for (const [id, c] of this.cooked) {
      const t = market.tokens.find((x) => x.id === id)
      if (!t) continue
      const fees = t.creatorFees ?? 0
      let usd = Math.max(0, fees - c.feeMark)
      c.feeMark = Math.max(c.feeMark, fees)
      if (!c.grad && t.status === 'graduated') {
        c.grad = true
        usd += GRAD_BONUS
      }
      if (usd > 0) c.vault += usd / nativePrice(market, c.chain)
    }
    for (const t of market.tokens as NetToken[]) {
      if (t.creatorId && sleuthBundle(t, rng)) devEvents.push(flagBundle(t, market, t.bundleWallets ?? 0))
    }
    devEvents.forEach((e, i) => (e.id = market.tick * 100 + 90 + i))
    market.seed = rng.s
    // The World runs forever: dead coins players cooked leave after an hour (unless someone on now holds or watches
    // them), and vaults of coins that are gone are dropped once claimed.
    if (this.world) {
      // Graduated coins that faded away get abandoned (like real ones), and only the biggest old ones stay alive:
      // otherwise a forever market would fill up with zombie coins.
      const old = market.tokens.filter((t) => t.status === 'graduated' && !protectedIds.has(t.id) && market.time - (t.graduatedAt ?? t.createdAt) > WORLD_FADE_AFTER_SEC)
      const kill = (t: (typeof old)[number]) => {
        t.status = 'dead'
        t.diedAt = market.time
      }
      for (const t of old) if (t.mcap < WORLD_FADE_MCAP) kill(t)
      const survivors = old.filter((t) => t.status === 'graduated').sort((a, b) => a.mcap - b.mcap)
      for (const t of survivors.slice(0, Math.max(0, survivors.length - WORLD_MAX_OLD_GRADS))) kill(t)
      market.tokens = market.tokens.filter((t) => !((t.status === 'dead' || t.status === 'rugged') && t.diedAt && market.time - t.diedAt > WORLD_DEAD_COIN_SEC && !protectedIds.has(t.id)))
      for (const [id, c] of this.cooked) if (c.vault < 1e-12 && !market.tokens.some((t) => t.id === id)) this.cooked.delete(id)
    }
    this.market = market
    this.wallets = [...wr.wallets, ...this.wallets.filter((w) => w.bot)]
    this.botTick(rng, wr.actions)
    for (const m of billed) this.sendWallet(m)

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


  // ─── World bots ──────────────────────────────────────────────────────────────
  /** Make sure every World bot exists (as a player with a real wallet, plus its public mirror wallet). */
  private ensureBots() {
    if (!this.world) return
    const rng = new Rng((Math.random() * 2 ** 32) >>> 0)
    for (const spec of BOT_ROSTER) {
      if (!this.members.has(spec.id)) {
        this.members.set(spec.id, {
          info: { id: spec.id, name: spec.name, avatar: spec.avatar, level: rng.int(8, 40), online: spec.always, equity: WORLD_START_BALANCE, startEquity: WORLD_START_BALANCE, trades: 0, wins: 0, bot: true },
          ws: null, protect: [], ack: 0, wallet: freshWallet(WORLD_START_BALANCE), brain: freshBrain(spec, this.market.tick, rng),
        })
      }
      const m = this.members.get(spec.id)!
      m.brain ??= freshBrain(spec, this.market.tick, rng)
      if (spec.always && !m.info.online) m.info = { ...m.info, online: true } // the always-on bots are back as soon as the World is
      if (!this.wallets.some((w) => w.id === spec.id)) this.wallets = [...this.wallets, mirrorWallet(spec, m.wallet?.startBalance ?? WORLD_START_BALANCE)]
    }
  }

  /** How a bot shows on the tape: its name, id and address, linked to its public wallet (track / copy it). */
  private botWho(m: Member) {
    const main = m.wallet?.accounts?.[0]?.id ?? 'w-main'
    return () => ({ name: m.info.name, pid: m.info.id, addr: walletAddress(m.info.id, main, 'sol'), walletId: m.info.id })
  }

  /** Keep a bot's public wallet in step with a fill (what trackers, copy traders and its wallet page see). */
  private mirrorFill(m: Member, t: Token, f: Trade, kind: WalletActionKind, actions: WalletAction[]) {
    const i = this.wallets.findIndex((w) => w.id === m.info.id)
    if (i < 0 || !m.wallet) return
    const w0 = this.wallets[i]
    const w: SimWallet = { ...w0, positions: { ...w0.positions }, live: { ...w0.live } }
    const pos = w.positions[t.id]
    let fraction = 1
    let pnl: number | undefined
    if (f.side === 'buy') {
      w.positions[t.id] = { qty: (pos?.qty ?? 0) + f.qty, cost: (pos?.cost ?? 0) + f.value, openedTick: pos?.openedTick ?? this.market.tick }
      w.live.buys++
      w.live.inflow -= f.value
    } else if (pos) {
      fraction = Math.min(1, f.qty / pos.qty)
      const costPart = pos.cost * fraction
      pnl = f.value - costPart
      if (fraction >= 0.999) delete w.positions[t.id]
      else w.positions[t.id] = { ...pos, qty: pos.qty - f.qty, cost: pos.cost - costPart, tookProfit: true }
      w.live.sells++
      w.live.inflow += f.value
      w.live.pnl24h += pnl
      if (pnl > 0) w.live.wins++
      else w.live.losses++
    }
    w.live.volume += f.value
    w.cash = m.wallet.cash + Object.entries(m.wallet.balances).reduce((a, [c, n]) => a + n * nativePrice(this.market, c as Chain), 0)
    w.lastActive = this.market.tick
    w.trades = [{ id: this.market.nextTradeId++, tick: this.market.tick, time: this.market.time, tokenId: t.id, ticker: t.ticker, emoji: t.emoji, hue: t.hue, side: f.side, usd: f.value, qty: f.qty, price: f.price, mcap: t.mcap, action: kind, ...(pnl !== undefined ? { pnl, pnlPct: pnl / Math.max(1e-9, f.value - pnl) } : {}) }, ...w.trades].slice(0, 60)
    this.wallets = this.wallets.map((x, k) => (k === i ? w : x))
    actions.push({ walletId: m.info.id, tokenId: t.id, side: f.side, usd: f.value, fraction, kind, mcap: t.mcap })
  }

  private botBuy(m: Member, t: Token, usd: number, actions: WalletAction[]): Trade | null {
    const w = this.walletOf(m)
    if (!w) return null
    const main = w.accounts?.[0]?.id ?? 'w-main'
    const had = !!w.accounts?.[0]?.positions[t.id]
    const r = runBuy(w, this.market, [main], usd, t.id, { autoSwap: true, who: this.botWho(m) })
    if (!r.fills.length) return null
    m.wallet = r.portfolio
    this.market = r.market
    const nt = this.market.tokens.find((x) => x.id === t.id) ?? t
    this.mirrorFill(m, nt, r.fills[0], had ? 'more' : 'first', actions)
    m.brain!.entries[t.id] ??= { tick: this.market.tick, peak: nt.price }
    return r.fills[0]
  }

  private botSell(m: Member, t: Token, qty: number, actions: WalletAction[]): Trade | null {
    const w = this.walletOf(m)
    if (!w) return null
    const main = w.accounts?.[0]?.id ?? 'w-main'
    const held = w.accounts?.[0]?.positions[t.id]?.qty ?? 0
    const r = runSell(w, this.market, [{ walletId: main, qty: Math.min(qty, held) }], t.id, { who: this.botWho(m) })
    if (!r.fills.length) return null
    m.wallet = r.portfolio
    this.market = r.market
    const nt = this.market.tokens.find((x) => x.id === t.id) ?? t
    const all = !m.wallet.accounts?.[0]?.positions[t.id]
    this.mirrorFill(m, nt, r.fills[0], all ? 'all' : 'partial', actions)
    if (all) delete m.brain!.entries[t.id]
    return r.fills[0]
  }

  private botChat(m: Member, text: string) {
    if (this.market.tick - (m.brain?.lastChat ?? -999) < 90) return
    m.brain!.lastChat = this.market.tick
    this.broadcast({ t: 'chat', from: m.info.id, name: m.info.name, avatar: m.info.avatar, text, time: Date.now() })
  }

  private botPost(m: Member, t: Token, text: string) {
    const b = m.brain!
    if (this.market.tick - b.lastPost < 900) return
    b.lastPost = this.market.tick
    this.post(m, { t: 'post', text, tokenId: t.id, followers: b.followers, rep: b.rep, repeats: 0 })
  }

  /** One second of the bots' lives: come and go, take profits / cut losses, find new coins, cook, chat, go broke. */
  private botTick(rng: Rng, actions: WalletAction[]) {
    if (!this.world) return
    const tick = this.market.tick
    for (const spec of BOT_ROSTER) {
      const m = this.members.get(spec.id)
      const b = m?.brain
      if (!m || !b) continue
      // People come and go (a few bots are always around so the World never feels empty).
      if (!spec.always && tick >= b.switchAt) {
        m.info = { ...m.info, online: !m.info.online }
        b.switchAt = tick + (m.info.online ? rng.int(1200, 3600) : rng.int(600, 2400))
        this.playersDirty = true
      }
      if (!m.info.online) continue
      const w = this.walletOf(m)
      if (!w) continue
      const st = STYLE[b.style]
      const byId = new Map(this.market.tokens.map((t) => [t.id, t]))
      const bags = Object.values(w.accounts?.[0]?.positions ?? {})

      // Exits (the chef handles its own coins below).
      for (const pos of bags) {
        const t = byId.get(pos.tokenId)
        if (!t || b.cooked[pos.tokenId]) continue
        if (t.status !== 'bonding' && t.status !== 'graduated') {
          if (b.entries[t.id]) {
            delete b.entries[t.id]
            if (rng.chance(0.4)) this.botChat(m, chatLine('loss', rng, t.ticker, -0.9))
          }
          continue
        }
        const e = (b.entries[t.id] ??= { tick, peak: t.price })
        e.peak = Math.max(e.peak, t.price)
        const pnl = t.price / Math.max(1e-18, pos.avgEntry) - 1
        const exit = pnl >= st.tp || (st.sl !== null && pnl <= -st.sl) || (st.hold !== null && tick - e.tick > st.hold)
        if (!exit || !rng.chance(0.5)) continue
        const f = this.botSell(m, t, pos.qty, actions)
        if (f && rng.chance(0.3)) this.botChat(m, chatLine(pnl >= 0 ? 'win' : 'loss', rng, t.ticker, pnl))
      }

      if (b.style === 'chef') this.chefTick(m, rng, actions)
      else if (tick >= b.nextAct) {
        b.nextAct = tick + rng.int(st.every[0], st.every[1])
        if (bags.length < st.maxBags) {
          const t = pickCoin(b.style, this.market.tokens, this.market.time, new Set(bags.map((p) => p.tokenId)), rng)
          const cashLike = w.cash + Object.entries(w.balances).reduce((a, [c, n]) => a + n * nativePrice(this.market, c as Chain), 0)
          const usd = b.style === 'degen' ? cashLike * rng.range(0.2, st.share) : Math.min(rng.range(st.size[0], st.size[1]), cashLike * st.share)
          if (t && usd >= 20) {
            const f = this.botBuy(m, t, Math.min(usd, t.liquidity * 0.03), actions)
            if (f) {
              if (rng.chance(0.25)) this.botChat(m, chatLine(b.style === 'sniper' ? 'snipe' : b.style === 'whale' ? 'whale' : 'buy', rng, t.ticker))
              if (rng.chance(0.12)) this.botPost(m, t, `${t.ticker} ${rng.chance(0.5) ? 'looks ready 🚀' : 'is the play today'}`)
            }
          }
        }
      }
      if (tick - b.lastChat > 600 && rng.chance(0.002)) this.botChat(m, chatLine('idle', rng))

      // Scoreboard, public bags, coins to keep listed, and going broke.
      if (tick % 5 === 0) {
        const v = valuePortfolio(m.wallet!, byId, this.market)
        const trades = m.wallet!.trades
        m.info = {
          ...m.info, equity: v.equity, startEquity: m.wallet!.startBalance, trades: trades.length, wins: trades.filter((x) => x.side === 'sell' && (x.pnl ?? 0) > 0).length,
          holdings: Object.values(m.wallet!.accounts?.[0]?.positions ?? {}).slice(0, 30).map((p) => ({ tokenId: p.tokenId, qty: p.qty, cost: p.costBasis, openedAt: p.openedAt })),
        }
        m.protect = Object.keys(m.wallet!.positions)
        if (m.wallet!.trades.length > WORLD_TRADES_KEPT) m.wallet = { ...m.wallet!, trades: m.wallet!.trades.slice(0, WORLD_TRADES_KEPT) }
        this.playersDirty = true
        const liveBags = Object.keys(m.wallet!.positions).filter((id) => { const t = byId.get(id); return t && (t.status === 'bonding' || t.status === 'graduated') })
        if (!liveBags.length && v.equity < BOT_BUST_USD) {
          // Broke: start over small, like a real player would.
          m.wallet = freshWallet(BOT_RESTART_USD, m.layout)
          b.entries = {}
          b.cooked = {}
          b.busts++
          const i = this.wallets.findIndex((x) => x.id === spec.id)
          if (i >= 0) this.wallets = this.wallets.map((x, k) => (k === i ? { ...x, cash: BOT_RESTART_USD, positions: {} } : x))
          this.botChat(m, chatLine('bust', rng))
        }
      }
    }
  }

  /** ChefCarl: launches a coin every so often, shills it, dumps part of the dev bag when it runs, claims fees. */
  private chefTick(m: Member, rng: Rng, actions: WalletAction[]) {
    const b = m.brain!
    const tick = this.market.tick
    const w = this.walletOf(m)!
    const main = w.accounts?.[0]?.id ?? 'w-main'
    // Their coins: take some off when it's running, dump the rest when it's old.
    for (const [id, c] of Object.entries(b.cooked)) {
      const t = this.market.tokens.find((x) => x.id === id)
      const held = w.accounts?.[0]?.positions[id]?.qty ?? 0
      if (!t || t.status === 'dead' || t.status === 'rugged' || held <= 0) {
        delete b.cooked[id]
        continue
      }
      const ran = t.mcap >= c.mcap * 2.5 && rng.chance(0.02)
      const old = tick - c.tick > 1800
      if (!ran && !old) continue
      const frac = old ? 1 : rng.range(0.3, 0.6)
      const f = this.botSell(m, t, held * frac, actions)
      if (!f) continue
      if (old) delete b.cooked[id]
      else c.mcap = t.mcap // next dump only after another run
      this.playerEvents.push({ by: m.info.id, id: tick * 100 + 96, tick, time: this.market.time, kind: 'devsell', tokenId: t.id, ticker: t.ticker, text: `Dev (${m.info.name}) sold ${Math.round(frac * 100)}% of their ${t.ticker} bag`, icon: '🧑‍💻', tone: 'down' })
      if (rng.chance(0.5)) this.botChat(m, chatLine('devsell', rng, t.ticker))
    }
    // Creator fees: claimed now and then.
    if (tick % 300 === 0) {
      let p = w
      for (const c of this.cooked.values()) {
        if (c.pid !== m.info.id || !(c.vault > 1e-12)) continue
        p = payNative(p, this.market, [[c.chain, c.vault]], 'coin', c.walletId).portfolio
        c.vault = 0
      }
      m.wallet = p
    }
    // A new launch.
    if (tick < b.nextAct) return
    b.nextAct = tick + rng.int(STYLE.chef.every[0], STYLE.chef.every[1])
    const px = nativePrice(this.market, 'sol')
    const cashLike = w.cash + (w.balances.sol ?? 0) * px
    if (cashLike < 300) return
    const base = generatedLaunch(this.market.launched + rng.int(50, 5000))
    let ticker = base.ticker
    for (let k = 2; k < 9 && this.market.tokens.some((t) => t.ticker === ticker); k++) ticker = `${base.ticker}${k}`
    const narratives: Narrative[] = ['dogs', 'cats', 'frogs', 'ai', 'food', 'space', 'absurd', 'retro']
    const marketing = rng.int(0, 150)
    const spec: CookSpec = {
      chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, name: base.name, ticker, emoji: base.emoji, hue: rng.int(0, 359), description: '',
      narrative: narratives[rng.int(0, narratives.length - 1)], socials: { x: true, tg: rng.chance(0.5), web: rng.chance(0.3) }, style: 'fair',
      marketing, devBuy: Math.min(rng.range(0.5, 2), (cashLike * 0.4) / px), bundle: { wallets: 0, perWallet: 0, stagger: false },
    }
    const cooked = cookToken(this.market, rng, spec)
    const id = cooked.token.id
    this.market = { ...cooked.market, tokens: cooked.market.tokens.map((t) => (t.id === id ? ({ ...t, creator: 'you', creatorId: m.info.id, creatorName: m.info.name } as NetToken) : t)) }
    m.wallet = { ...w, cash: Math.max(0, w.cash - COOK_FEE - marketing), feesPaid: w.feesPaid + COOK_FEE }
    this.freshIds.add(id)
    this.cooked.set(id, { pid: m.info.id, walletId: main, chain: 'sol', vault: 0, feeMark: 0, grad: false })
    const t = this.market.tokens.find((x) => x.id === id)!
    this.botBuy(m, t, spec.devBuy * px, actions)
    const after = this.market.tokens.find((x) => x.id === id)!
    this.cooked.get(id)!.feeMark = after.creatorFees ?? 0
    b.cooked[id] = { mcap: after.mcap, tick }
    this.playerEvents.push({ by: m.info.id, id: tick * 100 + 97, tick, time: this.market.time, kind: 'cook', tokenId: id, ticker, text: `${m.info.avatar} ${m.info.name} cooked ${ticker}`, icon: '🍳', tone: 'info' })
    this.botChat(m, chatLine('cook', rng, ticker))
    b.lastPost = tick - 900 // always shills its own launch
    this.botPost(m, after, `${ticker} just launched on pump 🍳 early`)
  }

  // ─── Admin ─────────────────────────────────────────────────────────────────
  summary() {
    return {
      code: this.code, hostId: this.hostId, round: { state: this.round.state, mode: this.round.mode, engine: this.round.engine ?? 'classic', tick: this.market.tick },
      players: this.playerList(), emptySince: this.emptySince,
      coins: this.market.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated').sort((a, b) => b.mcap - a.mcap).slice(0, 60)
        .map((t) => ({ id: t.id, ticker: t.ticker, emoji: t.emoji, chain: t.chain, mcap: t.mcap, status: t.status, creator: (t as NetToken).creatorName ?? null })),
      sentiment: this.market.sentiment,
    }
  }

  /** Remove a player (they're told why). */
  kick(playerId: string, reason: string) {
    const m = this.members.get(playerId)
    if (!m) return false
    if (m.ws) {
      this.send(m.ws, { t: 'kicked', reason })
      m.ws.close(4003, 'kicked')
    }
    this.members.delete(playerId)
    if (this.hostId === playerId) this.hostId = [...this.members.keys()][0] ?? ''
    this.playersDirty = true
    this.broadcastPlayers()
    return true
  }

  /** Gifts an admin sent to signed-in players here: claimed by the server and added to their round's wallet. */
  async pullGifts() {
    if (this.round.state !== 'running') return
    for (const m of this.members.values()) {
      if (!m.info.online || !m.info.verified || !m.info.id.startsWith('u-')) continue
      for (const g of await claimGifts(m.info.id.slice(2))) this.grant(m.info.id, g.amount, g.asset)
    }
  }

  notice(text: string) {
    this.broadcast({ t: 'notice', text: text.slice(0, 200) })
  }

  /**
   * Admin: wipe a player's wallet back to a fresh start (or everyone's, with no id). Their coins and cash are gone,
   * cashback too; coins they cooked stay on the market. Returns how many wallets were reset.
   */
  resetWallets(playerId?: string): number {
    if (this.round.state !== 'running') return 0
    let n = 0
    for (const m of this.members.values()) {
      if (m.info.spectator || (playerId && m.info.id !== playerId)) continue
      m.wallet = freshWallet(this.startBalance(), m.layout)
      m.cashback = undefined
      for (const c of this.cooked.values()) if (c.pid === m.info.id) c.vault = 0
      if (m.brain) {
        // A bot starts over too: fresh memory, and its public wallet shows the reset.
        m.brain.entries = {}
        m.brain.cooked = {}
        this.wallets = this.wallets.map((w) => (w.id === m.info.id ? { ...w, cash: this.startBalance(), startValue: this.startBalance(), positions: {} } : w))
      }
      m.info = { ...m.info, equity: this.startBalance(), startEquity: this.startBalance(), trades: 0, wins: 0 }
      this.sendTo(m.info.id, { t: 'wallet', ack: m.ack, state: { ...walletStateOf(m.wallet), cashback: { sol: 0, bsc: 0, hood: 0 } }, reset: true })
      n++
    }
    if (n) this.playersDirty = true
    return n
  }

  grant(playerId: string, amount: number, asset: 'usd' | 'sol' | 'bsc' | 'hood' = 'usd') {
    const m = this.members.get(playerId)
    if (!m) return false
    const w = this.walletOf(m)
    if (w) m.wallet = addFunds(w, asset, amount)
    this.sendTo(playerId, { t: 'grant', usd: asset === 'usd' ? amount : 0, asset, amount })
    this.sendWallet(m)
    return true
  }

  /** God mode on this room's market (hidden: it looks like normal trading). */
  adminMarket(a: AdminMarketAction) {
    setClock(secPerTickOf(this.market))
    setCandleLog(this.pending)
    const res = adminMarket(this.market, a, new Rng((Date.now() ^ this.market.seed) >>> 0))
    this.market = res.market
    if (res.tokenId) this.freshIds.add(res.tokenId)
    return res
  }

  private playerList(): RoomPlayer[] {
    // The World lists who's on right now; private rooms list everyone in the round.
    return [...this.members.values()].filter((m) => !m.info.spectator && (!this.world || m.info.online)).map((m) => m.info)
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
