// One multiplayer room: a shared market ticking once a second, the players in it, and the current round.
// The market code is the same the single-player game runs. The server is the judge of every player's wallets: orders,
// cooking, airdrops, bots, creator fees and cashback all run here (the game just shows the result instantly).
import type { WebSocket } from 'ws'
import { createHash } from 'node:crypto'
import { blockUsd, demoAnswer, postLaunchFee, SPARK, watchOf } from '../src/game/sparks'
import { adminMarket, type AdminMarketAction, rebuildCandlesFor, shortTfsFrom1m, createMarket, candleStore, COOK_COOLDOWN_TICKS, COOK_FEE, cookAllowance, cookToken, GRAD_BONUS, launchBlock, secPerTickOf, setCandleLog, setClock, SUPPLY, tickMarket, walletName, type CandlePoint } from '../src/game/marketEngine'
import { BOT_BUST_USD, BOT_BY_ID, BOT_RESTART_USD, BOT_ROSTER, chatLine, freshBrain, inVoice, mirrorWallet, pickCoin, STYLE, type BotBrain, type BotSpec } from './bots'
import { tickStories } from '../src/game/storyEngine'
import { trendSource } from './trendSource'
import { BUY_PACE, buysPerMinute, DEV_DUMP_CHANCE, devDumpAfter, draw, eye, safety, TREND_SHARE, trendCoin, groupFor, PILE_ON_LIMIT, planExit, SIZE_SCALE, situation, type BrainGroup } from './brainBots'
import { generatedLaunch } from '../src/data/tokens'
import { valuePortfolio } from '../src/game/portfolioEngine'
import { rollEvents } from '../src/game/eventEngine'
import { createWallets, tickWallets } from '../src/game/walletEngine'
import { addFollowers, CALL_SETTLE_TICKS, copyBuys, copySells, type CallResult, type CopyBook, FOLLOWER_CEILING, freshSocial, judgeCalls, POST_COOLDOWN_TICKS, shill, tickSocial } from '../src/game/socialEngine'
import { seasonNumber } from '../src/game/season'
import { dayKey, worldSeason } from '../src/game/worldSeason'
import { AUTO_MUTE_MS, coinLook, embeddedImage, moderate, rateCheck, strike, type ChatMeter } from './moderation'
import { NARRATIVES } from '../src/data/narratives'
import { addFunds, applyLayout, freshWallet, fundsIn, payNative, runBuy, runConvert, runGiveAway, runSell, runSwap, runTransfer, walletStateOf, type WalletLayout } from '../src/game/orders'
import { accountOf, DEV_EMOJI } from '../src/game/accounts'
import { nativePrice, setTradeImages } from '../src/game/tradingEngine'
import { cashbackUsd } from '../src/game/rewardsEngine'
import { claimGifts } from './persist'
import { CHAINS } from '../src/data/chains'
import { LAUNCHPADS } from '../src/data/launchpads'
import { walletAddress } from '../src/utils/address'
import { airdropFeePerWallet, BOT_RATES, botTickCost, BUNDLE_WALLET_FEE, flagBundle, runBotTick, sleuthBundle, STAGGER_FEE } from '../src/game/devTools'
import { MODES } from '../src/game/progression'
import { Rng } from '../src/utils/rng'
import type { Candle, Chain, CookSpec, Narrative, SocialProfile, Token, WalletAction, WalletActionKind, GameMode, MarketEngine, MarketEvent, MarketState, Portfolio, SimWallet, SocialPost, TapeTrade, Timeframe, Trade, VolumeBot } from '../src/types'
import { WORLD_BROKE_BELOW, WORLD_RESTART_BALANCE, WORLD_RESTART_EVERY_MS, WORLD_START_BALANCE, WORLD_START_MAX, WORLD_START_MIN, worldStartOf, type AdminWallets, type BoardList, type BoardMsg, type BoardRow, type PlayerCard, type DevStats, type HallEntry, type ChatReport, type BotRun, type ClientMsg, type NetMarket, type NetToken, type RoomPlayer, type RoundInfo, type ServerMsg, type TickMsg, type TokenDiff, type TransferMsg, type WalletDiff } from '../src/net/protocol'

const POSTS_KEPT = 60
const EVENTS_KEPT = 60
const KEYFRAME_TICKS = 120 // each coin and public wallet is re-sent in full every ~2 min (each on its own tick, so no tick is a big one); ticks in between only carry what changed
// World: a coin's on-screen statistics (rolling windows, % changes, momentum, counters) go out every few seconds
// instead of every second. They were most of what a browser received; price, market cap, liquidity, curve progress
// and everything a trade quote reads still go out the moment they change.
const SLOW_FIELD_TICKS = 5
const SLOW_FIELDS = new Set(['win', 'change', 'hype', 'momentum', 'momentumScore', 'volMark', 'volume', 'buys', 'sells', 'creatorFees', 'feesPaid', 'holders', 'devTrades'])
/** A steady number per id, to give every coin and wallet its own turn. */
const turnOf = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h }
// World: what a browser is told of a coin's hidden state: nothing true. (A joining browser sketches placeholder charts
// until a coin's real one is fetched, and the sketch wants a kind of coin: every coin is given the same one.)
const WIRE_SIM = { archetype: 'chaotic' } as Token['sim']
const WORLD_PLAYERS_TICKS = 5 // World: the player list is broadcast at most this often (seconds)
setTradeImages(false) // the server's trade records carry no copy of the coin's picture (see tradingEngine)

/**
 * The line everyone sees for something a player did to their own coin, written here from the numbers in the game's
 * own line. The text used to be passed on as it came: a way to put any words (links, slurs, a fake "going parabolic"
 * alert) in front of every player, muted or not. Null for anything the game doesn't send.
 */
function ownCoinEvent(kind: unknown, text: string, t: Token, name: string): { kind: 'devsell' | 'bundle' | 'airdrop'; slot: number; text: string; icon: string; tone: MarketEvent['tone'] } | null {
  const pct = (s: string) => Math.min(100, Math.max(0, Math.round(Number(s))))
  let m: RegExpExecArray | null
  if (kind === 'devsell' && (m = /^Dev \(you\) sold (\d{1,3})% of their \$/.exec(text))) return { kind, slot: 98, text: `Dev (${name}) sold ${pct(m[1])}% of their $${t.ticker} bag`, icon: '🧑‍💻', tone: 'down' }
  if (kind === 'bundle' && (m = /^Flagged bundle wallets are dumping \$\S+ \((\d{1,3})% of the bundle sold\)$/.exec(text))) return { kind, slot: 95, text: `Flagged bundle wallets are dumping $${t.ticker} (${pct(m[1])}% of the bundle sold)`, icon: '📦', tone: 'down' }
  if (kind === 'airdrop' && (m = /^Dev airdropped (\d{1,3}(?:\.\d{1,2})?)% of supply of \$\S+ to (\d{1,3}) (fresh wallets|holders)$/.exec(text))) return { kind, slot: 93, text: `Dev airdropped ${Math.min(100, Number(m[1])).toFixed(2)}% of supply of $${t.ticker} to ${Math.min(999, Number(m[2]))} ${m[3]}`, icon: '🪂', tone: 'info' }
  return null
}
const WORLD_TRADES_KEPT = 300 // World wallets live forever: keep their recent trade history only
const BOT_TRADES_KEPT = 20 // bots: nobody reads their own wallet's history (their public wallet shows their trades), and 100 × 300 trades is most of the save
const WORLD_DEAD_COIN_SEC = 3600 // World: dead player-cooked coins leave the market after an hour
const CARD_EVERY_MS = 150 // a player's card is built at most this often per asker…
const CARD_ROWS = 40 // …and carries at most this many bags and trades
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
  focus?: string // World: the coin this player has open (the last one they asked the chart of): they get its live chart points and its whole tape
  seat?: string // guests: a hash of the private key they first joined with; only that key gets back in
  ws: WebSocket | null
  protect: string[]
  lastPostTick?: number
  addrs?: string[] // their wallet addresses (private: only used to route transfers sent to an address)
  cardAt?: number // real time they last asked for somebody's card (not saved)
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
  cookTicks?: number[] // the World: when their recent launches were (the hourly limit)
  copyBook?: CopyBook // KOLs: what their followers' copy bots hold, per coin
  social?: SocialProfile // their followers, reputation and open calls, kept here (see socialOf)
  socialMissed?: CallResult[] // calls judged while they were away: shown when they are back
  eventsAt?: { tick: number; n: number } // how many own-coin events they sent this tick (not saved)
  brain?: BotBrain // World bots only
  // World leaderboards: where this week's profit is measured from, and bankruptcy restarts.
  weekBase?: { week: number; pnl: number }
  dayBase?: { key: string; pnl: number } // World boards: profit at the start of today / this season
  seasonBase?: { key: string; pnl: number }
  chainPnl?: Record<Chain, number> // realized profit on each chain's coins, all time
  chainBase?: { key: string } & Record<Chain, number> // …and where it stood when this season began
  dev?: DevStats // coins they launched here
  trophies?: string[] // season awards
  lastRestart?: number // real time (ms)
  restarts?: number
  pnlCarry?: number // profit / loss from before their last restart (a restart doesn't wipe your record)
  // Chat safety
  mutedUntil?: number // real time (ms): can't chat or post until then
  meter?: ChatMeter // rate limit and strikes (not saved)
  lastReportAt?: number
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
  reports?: ChatReport[]
  hall?: HallEntry[] // World: finished seasons
  seasonKey?: string | null
}

const hashCode = (str: string) => [...str].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261)

const fmtUsdShort = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${Math.round(n)}`)

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
  private chatLog: { from: string; name: string; text: string; time: number }[] = [] // recent chat, to check reports against
  reports: ChatReport[] = [] // chat messages players reported, newest first (for the admin)
  private lastTapeId = 0
  private lastWalletTradeId = 0
  private sentTokens = new Map<string, Record<string, string>>() // coin → field → JSON last sent (for diffs)
  private sentWallets = new Map<string, string>() // wallet → JSON last sent (without trades)
  private sentImages = new Map<string, string | undefined>() // coin → the picture already sent to everyone (it goes out once)
  private playersDirty = false
  private lastBotChat = -999 // tick of the last bot chat line (the crowd doesn't all talk at once)
  private botActions: WalletAction[] = [] // the bots' trades of the last tick (for the story engine)
  private lastBeatSeq = 0 // beats already sent to browsers (see tickMarketDiff)
  private lastSparkSeq = 0 // …and the story market's posts (new ones and changed ones go out, by `seq`)
  private freshTape = new Map<string, TapeTrade[]>() // World: this tick's new trades per coin, for the players who have that coin open
  private sentTrends: unknown = null // the trend list browsers have (it goes out again only when the source hands over a new one)
  private botReply: { at: number; text: string } | null = null // a bot's answer to a real player, a few seconds later
  private botLines: string[] = [] // what the crowd said lately (nobody says the line somebody just said)
  // Lines the crowd owes the room, a few seconds from now: a reaction to something that just happened (a coin bonded,
  // a dev dumped, a player launched or bought big) or one bot answering another. `not`: the bot that mustn't say it.
  private botSay: { at: number; text: string; not?: string }[] = []
  private eyesOn = new Map<string, number>() // coins the crowd is looking at right now (coin id → until which tick)
  private timer: ReturnType<typeof setInterval>

  /** The public World: one round that never ends, never pauses, and keeps everyone's wallet. */
  readonly world: boolean

  /** Every room on this server (charts are kept in one store for all of them, by coin id: see cook). */
  private static all = new Set<Room>()

  constructor(code: string, world = false) {
    Room.all.add(this)
    this.code = code
    this.world = world
    this.newMarket(world
      ? { id: 1, state: 'running', mode: 'practice', durationTicks: null, startTick: 0, seed: 0, startTime: 0, engine: 'realistic', world: true }
      : { id: 0, state: 'lobby', mode: 'practice', durationTicks: null, startTick: 0, seed: 0, startTime: 0 })
    this.ensureBots()
    this.timer = setInterval(() => this.timedTick(), 1000)
  }

  /**
   * The once-a-second tick, as the timer runs it. An error thrown in a tick would otherwise be outside any try: Node
   * would exit and drop every player in every room. It is logged and counted instead, and the next tick still runs.
   */
  private timedTick() {
    const t0 = performance.now()
    try {
      this.tick()
      Room.onTick?.(this, performance.now() - t0)
    } catch (e) {
      console.error(`[room ${this.code}] tick failed:`, e)
      Room.onTick?.(this, performance.now() - t0, e)
    }
  }
  /** Run this many ticks at once, with no real time passing (load tests grow a fresh World with it). */
  fastForward(ticks: number) {
    for (let i = 0; i < ticks; i++) this.tick()
  }
  /** Told about every timed tick: how long it took, and the error if it threw (the health watch listens). */
  static onTick: ((room: Room, ms: number, error?: unknown) => void) | null = null
  /** The owner's `cooking` switch as the server last read it (see server/index.ts). Without a database: on. */
  static playersCook = true
  /**
   * The owner's `sparks` switch as the server last read it: the story market (posts that coins get launched on, see
   * src/game/sparks.ts) in every room on the real-time engine, the World first of all. Without a database: off.
   */
  static storyMarket = false
  /** …and the `larps` switch: some posts are not what they look like (stage 2). Only with the story market on. */
  static larps = false
  /** …and the `tech` switch: posts that announce a tool, whose coins have a site with a demo (stage 3). */
  static tech = false

  dispose() {
    Room.all.delete(this)
    clearInterval(this.timer)
    for (const t of this.market?.tokens ?? []) candleStore.delete(t.id)
  }

  // ─── Saving (Phase 2): a room survives server restarts / updates ─────────────
  /** Everything needed to bring this room back after a restart (players reconnect to it). */
  snapshot(): RoomSnapshot {
    return {
      v: 1, code: this.code, world: this.world || undefined, hostId: this.hostId, round: this.round, market: this.market, wallets: this.wallets,
      posts: this.posts.slice(0, 80), events: this.events.slice(0, 80), bots: [...this.bots.entries()],
      lastTapeId: this.lastTapeId, lastWalletTradeId: this.lastWalletTradeId, cooked: [...this.cooked.entries()], reports: this.reports.slice(0, 100), hall: this.hall, seasonKey: this.seasonKey,
      members: [...this.members.values()].filter((m) => !m.info.spectator).map((m) => ({
        info: { ...m.info, online: m.info.bot ? m.info.online : false }, seat: m.seat, protect: m.protect, addrs: m.addrs, inbox: m.inbox, wallet: m.wallet, layout: m.layout, lastPostTick: m.lastPostTick,
        cashback: m.cashback, cbVolume: m.cbVolume, cbAuto: m.cbAuto, cooks: m.cooks, lastCookTick: m.lastCookTick, cookTicks: m.cookTicks, copyBook: m.copyBook, social: m.social, socialMissed: m.socialMissed, brain: m.brain,
        weekBase: m.weekBase, dayBase: m.dayBase, seasonBase: m.seasonBase, chainPnl: m.chainPnl, chainBase: m.chainBase, dev: m.dev, trophies: m.trophies, lastRestart: m.lastRestart, restarts: m.restarts, pnlCarry: m.pnlCarry, mutedUntil: m.mutedUntil,
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
    try {
      Room.fill(r, s, charts)
    } catch (e) {
      // A save that can't be brought to life must not leave its half-built room behind: the constructor has already
      // started its 1-second timer, and it would tick (or throw) for ever, outside any list of rooms.
      r.dispose()
      throw e
    }
    return r
  }

  private static fill(r: Room, s: RoomSnapshot, charts?: Record<string, Partial<Record<Timeframe, PackedCandle[]>>> | null) {
    for (const t of r.market.tokens) candleStore.delete(t.id) // the placeholder market's charts
    r.hostId = s.hostId
    r.round = s.round
    // Coins saved before picture links were refused (see coinLook) lose the link and show their emoji instead.
    r.market = s.market.tokens.some((t) => t.image && !embeddedImage(t.image)) ? { ...s.market, tokens: s.market.tokens.map((t) => (t.image && !embeddedImage(t.image) ? { ...t, image: undefined } : t)) } : s.market
    r.wallets = s.wallets ?? []
    r.posts = s.posts ?? []
    r.events = s.events ?? []
    r.bots = new Map(s.bots ?? [])
    r.cooked = new Map(s.cooked ?? [])
    r.reports = s.reports ?? []
    r.hall = s.hall ?? []
    r.seasonKey = s.seasonKey ?? null
    r.lastTapeId = s.lastTapeId ?? r.market.nextTradeId - 1
    r.lastWalletTradeId = s.lastWalletTradeId ?? r.market.nextTradeId - 1
    r.members.clear() // the placeholder World's bots; the saved ones come back below
    r.wallets = s.wallets ?? []
    for (const m of s.members ?? []) {
      // Trades saved before the server stopped copying coin pictures into them (see tradingEngine) lose the copies.
      const trades = m.wallet?.trades
      const wallet = m.wallet && trades?.some((t) => t.image !== undefined) ? { ...m.wallet, trades: trades.map(({ image: _copy, ...t }) => t) } : m.wallet
      r.members.set(m.info.id, { ...m, wallet, ws: null, ack: 0, info: { ...m.info, online: m.info.bot ? m.info.online : false } })
    }
    r.ensureBots()
    r.unlabelBots()
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
      // The short charts weren't saved (too big): rebuild them from the real 1m candles, not from a made-up curve.
      if (tfs['1m']?.length) shortTfsFrom1m(c, new Rng(hashCode(id)))
    }
    r.sentTokens.clear() // first tick after restore sends every coin in full
    r.sentImages.clear()
    r.sentWallets.clear()
  }

  // ─── Players ───────────────────────────────────────────────────────────────
  /** Returns false (and lets nobody in) when a guest's seat is claimed by a browser without its key. */
  join(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }> & { verified?: boolean }): boolean {
    const existing = this.members.get(msg.playerId)
    // Guest ids are public (the player list shows them), so a guest's seat, and the wallet in it, opens only for the
    // key it was first taken with. Signed-in players are proven by their login instead.
    const seat = !msg.verified && typeof msg.key === 'string' && msg.key ? createHash('sha256').update(msg.key).digest('hex') : undefined
    if (!msg.verified && existing?.seat && existing.seat !== seat) return false
    // World: you need an account to play; guests watch (WORLD_GUESTS_PLAY=1 lets guests play, for local testing only).
    const spectator = this.world && !msg.verified && process.env.WORLD_GUESTS_PLAY !== '1'
    const info: RoomPlayer = existing
      ? { ...existing.info, name: msg.name, avatar: msg.avatar, level: msg.level, online: true, verified: !!msg.verified, spectator: spectator || undefined }
      : { id: msg.playerId, name: msg.name, avatar: msg.avatar, level: msg.level, online: true, equity: 0, startEquity: 0, trades: 0, wins: 0, verified: !!msg.verified, spectator: spectator || undefined }
    existing?.ws?.close(4000, 'Joined from another tab')
    this.members.set(msg.playerId, { ...existing, info, ws, protect: existing?.protect ?? [], inbox: undefined, ack: 0, seat: existing?.seat ?? seat }) // a new connection restarts the wallet message count (the game does too)
    if (!this.hostId && !this.world) this.hostId = msg.playerId
    this.emptySince = null
    this.send(ws, {
      t: 'welcome', you: msg.playerId, code: this.code, hostId: this.hostId, players: this.playerList(), round: this.round, spectator: spectator || undefined,
      market: this.netMarket(), wallets: round(this.wallets) as SimWallet[], posts: this.posts, events: this.events,
    })
    for (const tr of existing?.inbox ?? []) this.send(ws, tr) // transfers that came in while they were away
    const joined = this.members.get(msg.playerId)!
    if (this.walletOf(joined)) this.sendWallet(joined)
    if (!spectator && (this.world || joined.social)) {
      this.sendSocial(joined, this.socialOf(joined), joined.socialMissed, true)
      joined.socialMissed = undefined
    }
    this.broadcastPlayers()
    return true
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
    if (me.info.spectator && msg.t !== 'candles' && msg.t !== 'board' && msg.t !== 'card') return // watching only
    switch (msg.t) {
      case 'start':
        if (this.world) return this.sendTo(playerId, { t: 'error', message: 'The World never stops: no new rounds here' })
        if (playerId !== this.hostId) return this.sendTo(playerId, { t: 'error', message: 'Only the host can start a round' })
        return this.startRound(msg.mode, msg.durationTicks, msg.engine === 'realistic' ? 'realistic' : 'classic')
      case 'cook':
        return this.cook(me, msg)
      case 'patch': {
        const t = this.market.tokens.find((x) => x.id === msg.tokenId) as NetToken | undefined
        if (!t || t.creatorId !== playerId || !msg.patch) return
        // Only the fields the game's dev tools change, within their ranges: anything else (price, liquidity, the
        // hidden sim) would let a modified game rewrite its own coin's market.
        const p = msg.patch
        const pct = (n: unknown, cur: number) => (Number.isFinite(n) ? Math.min(100, Math.max(0, Number(n))) : cur)
        const count = (n: unknown, cur: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(Number(n)))) : cur)
        if ('devPct' in p) t.devPct = pct(p.devPct, t.devPct)
        if ('bundlePct' in p) t.bundlePct = pct(p.bundlePct, t.bundlePct ?? 0)
        if ('top10Pct' in p) t.top10Pct = pct(p.top10Pct, t.top10Pct)
        if ('hype' in p) t.hype = pct(p.hype, t.hype)
        if ('holders' in p) t.holders = count(p.holders, t.holders, 1_000_000)
        if ('bundleWallets' in p) t.bundleWallets = count(p.bundleWallets, t.bundleWallets ?? 0, 50)
        if ('bundleFlagged' in p) t.bundleFlagged = !!p.bundleFlagged
        return
      }
      case 'bot': {
        const t = this.market.tokens.find((x) => x.id === msg.tokenId) as NetToken | undefined
        if (!t || t.creatorId !== playerId) return
        // What it has spent is counted here (the bot is paid on the server), not taken from the game.
        const was = this.bots.get(msg.tokenId)
        // Only the fields a bot has are kept, each one checked, and the speed must be one the game offers. A speed that
        // was not a number broke the coin for everyone (a $50M market cap in seconds, a NaN wallet for sellers).
        const b = msg.bot as Partial<VolumeBot> | null | undefined
        const amount = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1e9, Math.max(0, n)) : 0)
        if (b?.on && typeof b.rate === 'number' && BOT_RATES.includes(b.rate)) this.bots.set(msg.tokenId, { on: true, rate: b.rate, budget: amount(b.budget), spent: amount(was?.spent ?? b.spent), volume: amount(was?.volume ?? b.volume), startedTick: amount(b.startedTick) })
        else this.bots.delete(msg.tokenId)
        return
      }
      case 'status': {
        // The room ranks players by these, so in a round they come from the wallet the server holds, not from what
        // the game reports (a modified game could claim any score). Before a round, only sane numbers are kept.
        const w = this.walletOf(me)
        const num = (n: unknown) => (Number.isFinite(n) ? Math.max(0, Number(n)) : 0)
        const score = w
          ? { equity: valuePortfolio(w, new Map(this.market.tokens.map((t) => [t.id, t])), this.market).equity, startEquity: w.startBalance, trades: w.trades.length, wins: w.trades.filter((x) => x.side === 'sell' && (x.pnl ?? 0) > 0).length }
          : { equity: num(msg.equity), startEquity: num(msg.startEquity), trades: Math.round(num(msg.trades)), wins: Math.round(num(msg.wins)) }
        me.info = {
          ...me.info, ...score, level: Math.min(999, Math.max(1, Math.round(num(msg.level)) || 1)), finished: !!msg.finished,
          ...(Number.isFinite(msg.seasonPoints) ? { seasonPoints: Math.max(0, Math.round(msg.seasonPoints!)) } : {}),
          ...(Array.isArray(msg.holdings)
            ? { holdings: msg.holdings.slice(0, 30).filter((h) => h && typeof h.tokenId === 'string' && h.tokenId.length <= 64 && h.qty > 0).map((h) => ({ tokenId: h.tokenId, qty: +h.qty || 0, cost: +h.cost || 0, openedAt: +h.openedAt || 0 })) }
            : {}),
        }
        if (Array.isArray(msg.protect)) me.protect = msg.protect.filter((id) => typeof id === 'string' && id.length <= 64).slice(0, 200)
        if (Array.isArray(msg.addrs)) me.addrs = msg.addrs.filter((a) => typeof a === 'string').slice(0, 12).map((a) => a.slice(0, 24))
        if (Number.isFinite(msg.cbVolume)) me.cbVolume = Math.max(0, Number(msg.cbVolume))
        if (msg.cbAuto === 'off' || msg.cbAuto === 'coin' || msg.cbAuto === 'usdc') me.cbAuto = msg.cbAuto
        this.playersDirty = true
        return
      }
      case 'board':
        return this.sendBoard(me, msg.list)
      case 'card':
        return this.sendCard(me, msg.id)
      case 'demo': {
        // Somebody tries the demo on a tech coin's site. What it really does is the server's to know: only the answer goes back.
        const t = typeof msg.tokenId === 'string' ? this.market.tokens.find((x) => x.id === msg.tokenId) : undefined
        if (!t?.site || typeof msg.input !== 'string') return
        const input = msg.input.slice(0, 60)
        return this.sendTo(playerId, { t: 'demo', tokenId: t.id, input, ...demoAnswer(t.site.tool, t.sim.demo, input) })
      }
      case 'candles':
        // (World: that coin is now the one this player follows closely. Its tape goes with the chart: the ticks they
        // were sent while looking elsewhere carried only real players' trades.)
        if (this.world && typeof msg.tokenId === 'string') me.focus = msg.tokenId
        return this.sendTo(playerId, { t: 'candles', tokenId: msg.tokenId, candles: candleStore.get(msg.tokenId) ?? null, ...(this.world ? { tape: round(this.market.tokens.find((t) => t.id === msg.tokenId)?.tape ?? []) as TapeTrade[] } : {}) })
      case 'event': {
        // Something the player did to their own coin (a dev sell, a bundle dump, an airdrop). Only those three, at
        // most a few a second, and the words are the server's own (see ownCoinEvent).
        const ev = msg.event as Partial<MarketEvent> | null | undefined
        const t = ev && typeof ev.tokenId === 'string' ? (this.market.tokens.find((x) => x.id === ev.tokenId) as NetToken | undefined) : undefined
        if (!ev || !t || t.creatorId !== playerId) return
        const line = ownCoinEvent(ev.kind, typeof ev.text === 'string' ? ev.text.slice(0, 200) : '', t, me.info.name)
        if (!line) return
        const n = me.eventsAt?.tick === this.market.tick ? me.eventsAt.n + 1 : 1
        me.eventsAt = { tick: this.market.tick, n }
        if (n > 4) return
        this.playerEvents.push({ id: this.market.tick * 100 + line.slot, tick: this.market.tick, time: this.market.time, kind: line.kind, tokenId: t.id, ticker: t.ticker, text: line.text, icon: line.icon, tone: line.tone, by: playerId })
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
      case 'chat':
        return this.chat(me, msg.text)
      case 'report':
        return this.report(me, msg)
    }
  }

  // ─── Chat safety ─────────────────────────────────────────────────────────────
  /** Whether this player may talk right now; tells them (and returns false) if they're muted. */
  private canTalk(me: Member): boolean {
    const left = (me.mutedUntil ?? 0) - Date.now()
    if (left <= 0) return true
    this.sendTo(me.info.id, { t: 'error', message: `You're muted for another ${left > 3600_000 ? `${Math.ceil(left / 3600_000)}h` : `${Math.ceil(left / 60_000)} min`}.` })
    return false
  }

  /** A filtered message, or null if it was refused (the sender is told why; repeated offences mute them). */
  private screen(me: Member, raw: unknown): string | null {
    if (!this.canTalk(me)) return null
    const meter = (me.meter ??= { times: [], strikes: [] })
    const now = Date.now()
    const m = moderate(raw, { noLinks: this.world })
    if (m.strike && strike(meter, now)) {
      me.mutedUntil = now + AUTO_MUTE_MS
      meter.strikes = []
      this.sendTo(me.info.id, { t: 'error', message: 'You’ve been muted for 10 minutes for breaking the chat rules.' })
      return null
    }
    if (!m.ok) {
      if (m.reason) this.sendTo(me.info.id, { t: 'error', message: m.reason })
      return null
    }
    return m.text
  }

  private chat(me: Member, raw: unknown) {
    const text = this.screen(me, raw)
    if (!text) return
    const meter = me.meter!
    const now = Date.now()
    const slow = rateCheck(meter, text, now)
    if (slow) return this.sendTo(me.info.id, { t: 'error', message: slow })
    meter.times.push(now)
    meter.last = text
    meter.lastAt = now
    this.chatLog = [...this.chatLog, { from: me.info.id, name: me.info.name, text, time: now }].slice(-120)
    this.broadcast({ t: 'chat', from: me.info.id, name: me.info.name, avatar: me.info.avatar, text, time: now })
    // The World: a bot often answers a real player a few seconds later (a greeting, the coin they named, a question).
    if (this.world && !me.brain && !this.botReply && Math.random() < 0.6) {
      const rng = new Rng((Math.random() * 2 ** 32) >>> 0)
      const named = text.match(/\$([A-Za-z0-9]{2,12})/)?.[1]?.toUpperCase()
      const coin = named && this.market.tokens.find((t) => t.ticker.toUpperCase() === named)
      const line = /\b(gm|good morning|hello|hey|hi|yo|sup)\b/i.test(text) ? this.say('gm', rng) : coin ? this.say('coin', rng, coin.ticker) : text.includes('?') ? this.say('ask', rng) : this.say('reply', rng)
      this.botReply = { at: this.market.tick + rng.int(2, 7), text: line }
    }
  }

  /** A player reports a chat message: it must be a real recent one; repeat reports of it are counted together. */
  private report(me: Member, msg: Extract<ClientMsg, { t: 'report' }>) {
    const now = Date.now()
    if (now - (me.lastReportAt ?? 0) < 5000) return
    const line = this.chatLog.find((l) => l.from === msg.from && l.time === msg.time && l.text === String(msg.text))
    if (!line || line.from === me.info.id) return
    me.lastReportAt = now
    const old = this.reports.find((r) => r.target.id === line.from && r.at === line.time)
    if (old) {
      if (old.by.id !== me.info.id) old.count++
      return
    }
    const context = this.chatLog.filter((l) => l.from === line.from).slice(-6).map((l) => l.text)
    this.reports = [{ id: now, at: line.time, by: { id: me.info.id, name: me.info.name }, target: { id: line.from, name: line.name }, text: line.text, context, count: 1 }, ...this.reports].slice(0, 100)
  }

  /** Admin: stop a player chatting and posting for a while (0 minutes = unmute). */
  mute(playerId: string, minutes: number): boolean {
    const m = this.members.get(playerId)
    if (!m) return false
    m.mutedUntil = minutes > 0 ? Date.now() + minutes * 60_000 : undefined
    this.sendTo(playerId, { t: 'error', message: minutes > 0 ? `An admin muted you for ${minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes} min`}.` : 'You can chat again.' })
    return true
  }

  /** Admin: clear a report (or all of a player's). */
  dismissReport(id: number) {
    const n = this.reports.length
    this.reports = this.reports.filter((r) => r.id !== id)
    return this.reports.length < n
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
      m.cookTicks = undefined
      m.copyBook = undefined
    }
    this.broadcast({ t: 'round', round: this.round, market: this.netMarket(), wallets: round(this.wallets) as SimWallet[] })
    for (const m of this.members.values()) this.sendWallet(m)
    this.broadcastPlayers()
  }

  // ─── Wallets (Phase 2: the server is the judge of every player's wallets) ──
  /** This player's wallets in the running round (created fresh when they first need them). */
  private walletOf(m: Member): Portfolio | null {
    if (this.round.state !== 'running' || m.info.spectator) return null
    if (!m.wallet) m.wallet = freshWallet(this.startBalanceOf(m), m.layout)
    return m.wallet
  }

  /** What a fresh wallet starts with here (in the World: what the admin set, see setStartBalance). */
  private startBalance() {
    return this.world ? worldStartOf(this.round) : MODES[this.round.mode].startBalance
  }

  /** …and what this member's does: the World's bots always start with the usual balance, whatever players are given (the market was measured with them at that size). */
  private startBalanceOf(m: Member) {
    return this.world && m.brain ? WORLD_START_BALANCE : this.startBalance()
  }

  /** The World's starting balance right now (public: the World card shows it before anybody joins). */
  get worldStart() {
    return worldStartOf(this.round)
  }

  /**
   * Admin: what a new World wallet starts with from now on (a new player, or one who is reset). Wallets that exist
   * are not touched. Saved with the World (it is part of the round), and every browser in it is told.
   */
  setStartBalance(usd: number): number | null {
    if (!this.world || !Number.isFinite(usd)) return null
    const v = Math.round(Math.max(WORLD_START_MIN, Math.min(WORLD_START_MAX, usd)))
    this.round = { ...this.round, startBalance: v === WORLD_START_BALANCE ? undefined : v }
    this.broadcast({ t: 'round', round: this.round })
    return v
  }

  /** Tell a player their wallets as the server has them (after the wallet message numbered `m.ack`). */
  private sendWallet(m: Member, extra: { ref?: number; fills?: Trade[]; failures?: string[]; note?: string } = {}) {
    if (!m.wallet) return
    if (this.world && m.wallet.trades.length > WORLD_TRADES_KEPT) m.wallet = { ...m.wallet, trades: m.wallet.trades.slice(0, WORLD_TRADES_KEPT) }
    const vaults: Record<string, number> = {}
    for (const [id, c] of this.cooked) if (c.pid === m.info.id) vaults[id] = c.vault
    const state = { ...walletStateOf(m.wallet), cashback: m.cashback ?? { sol: 0, bsc: 0, hood: 0 }, vaults }
    this.sendTo(m.info.id, { t: 'wallet', ack: m.ack, state, ...extra })
  }

  /** Cashback on a player's fills (a share of the platform fee, tiered by their volume), paid now if they auto-claim. */
  private earn(m: Member, fills: Trade[]) {
    this.realized(m, fills)
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
    const mainId = w.accounts?.[0]?.id ?? 'w-main' // copy traders follow the KOL's main (public) wallet only
    const heldBefore = o.side === 'sell' ? (accountOf(w, mainId)?.positions[t.id]?.qty ?? 0) : 0
    const r = o.side === 'buy'
      ? runBuy(w, this.market, (o.walletIds ?? []).slice(0, 12), Math.max(0, Number(o.usdEach) || 0), t.id, { autoSwap: !!o.autoSwap, setting: o.setting, who })
      : runSell(w, this.market, (o.legs ?? []).slice(0, 12).map((l) => ({ walletId: String(l.walletId), qty: Math.max(0, Number(l.qty) || 0) })), t.id, { setting: o.setting, who })
    me.wallet = r.portfolio
    this.market = r.market
    this.earn(me, r.fills)
    // (Only the wallet that deployed the coin is its dev: a sell from another of the dev's wallets is anybody's sell.)
    const mineCooked = o.side === 'sell' ? this.cooked.get(t.id) : undefined
    if (mineCooked?.pid === me.info.id) this.devSold(t.id, accountOf(w, mineCooked.walletId)?.positions[t.id]?.qty ?? 0, accountOf(me.wallet, mineCooked.walletId)?.positions[t.id]?.qty ?? 0)
    // A real player's big buy gets noticed: the crowd looks at the coin, and somebody may say so.
    if (o.side === 'buy' && !me.info.bot) {
      const spent = r.fills.reduce((a, x) => a + x.value, 0)
      if (spent >= Math.max(150, t.liquidity * 0.01)) {
        this.lookAt(t.id, 45)
        this.react('bigbuy', t.ticker, 0.35, [3, 9])
      }
    }
    // KOLs: their followers' copy bots follow the trade a few seconds later.
    let note: string | undefined
    if (r.fills.length) {
      const nt = this.market.tokens.find((x) => x.id === t.id) ?? t
      const rng = new Rng((Math.random() * 2 ** 32) >>> 0)
      const book = (me.copyBook ??= {})
      // How many copy you depends on your followers as the server has them, never on what the message says.
      const kol = o.side === 'buy' && (this.world || me.social || o.kol) ? this.socialOf(me, o.kol) : null
      const mainFills = r.fills.filter((f) => (f.walletId ?? mainId) === mainId)
      const sold = mainFills.reduce((a, f) => a + f.qty, 0)
      const wave = o.side === 'buy'
        ? kol && copyBuys(this.market, rng, nt, kol, mainFills.reduce((a, f) => a + f.value, 0), book)
        : copySells(this.market, rng, nt, heldBefore > 0 ? sold / heldBefore : 0, book)
      if (wave) {
        this.market = { ...this.market, shillQueue: [...(this.market.shillQueue ?? []), ...wave.queue] }
        note = o.side === 'buy' ? `👥 ${wave.copiers} copy trader${wave.copiers > 1 ? 's are' : ' is'} following your buy of $${t.ticker} (~${fmtUsdShort(wave.usd)})` : `👥 Your copy traders are selling $${t.ticker} behind you`
      }
    }
    this.sendWallet(me, { ref: msg.ref, fills: r.fills.map((f) => ({ ...f, ref: msg.ref })), failures: r.failures, note })
  }

  /**
   * A dev sold some of their own coin: the crowd sees the dev wallet selling and part of it leaves (the game does the
   * same to a solo player's coin). `before` and `after` are what the coin's dev wallet holds (the one that deployed it).
   */
  private devSold(tokenId: string, before: number, after: number) {
    const frac = before > 0 ? Math.min(1, Math.max(0, (before - after) / before)) : 0
    if (!(frac > 0)) return
    this.market = { ...this.market, tokens: this.market.tokens.map((x) => (x.id === tokenId ? { ...x, hype: Math.max(0, x.hype - 30 * frac), sim: { ...x.sim, pressure: x.sim.pressure - 0.012 * frac } } : x)) }
  }

  private op(me: Member, msg: Extract<ClientMsg, { t: 'op' }>) {
    me.ack = Math.max(me.ack, msg.seq)
    const w = this.walletOf(me)
    const o = msg.op
    // Only the four real assets: anything else reaches the price lookup and throws.
    const ok = (a: unknown) => a === 'usd' || a === 'sol' || a === 'bsc' || a === 'hood'
    if (w && o) {
      if (o.kind === 'swap') {
        if (ok(o.from) && ok(o.to)) {
          const r = runSwap(w, this.market, o.from, o.to, Number(o.amount) || 0, String(o.walletId))
          if (r.ok) me.wallet = r.portfolio
        }
      } else if (o.kind === 'convert') {
        if (ok(o.from) && ok(o.to)) {
          const r = runConvert(w, this.market, o.from, o.to, Number(o.amount) || 0, String(o.fromWallet), String(o.toWallet), this.market.tick)
          if (r.ok) me.wallet = r.portfolio
        }
      } else if (o.kind === 'transfer') {
        if (o.chain === 'sol' || o.chain === 'bsc' || o.chain === 'hood') {
          const r = runTransfer(w, String(o.fromId), String(o.toId), o.chain, Number(o.amount) || 0, this.market.tick)
          if (r.ok) me.wallet = r.portfolio
        }
      } else if (o.kind === 'bankrupt') {
        return this.bankrupt(me)
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
    if (!Room.playersCook) return fail('Cooking is closed for now while it is being reworked')
    // The coin's id comes from the game too (the game already shows the coin under it). Only the shape the game
    // makes, "TICKER-xxxx", and only as text: a LIST holding a live coin's id reads the same as that id once it is
    // turned into text, and the new coin then took the old coin's place (its chart, its holders' bags); an id like
    // "constructor" breaks every lookup by id.
    const id: unknown = msg.token.id
    if (typeof id !== 'string' || !/^[A-Za-z0-9]{1,16}-[A-Za-z0-9]{1,16}$/.test(id)) return fail('That coin can’t be launched')
    if (this.market.tokens.some((x) => x.id === id)) return fail('That coin already exists')
    // Charts are kept in one store for the whole server, by coin id: an id that already has a chart is a live coin of
    // another room (the World, say), and this launch would replace that chart and later delete it. And a coin that
    // has left the market still has bags in wallets, and maybe creator fees waiting, under its id: a new coin under
    // that id would bring those bags back to life.
    if ([...Room.all].some((r) => r !== this && r.market?.tokens.some((x) => x.id === id)) || this.cooked.has(id) || this.bots.has(id) || [...this.members.values()].some((m) => (m.wallet?.accounts ?? []).some((a) => a.positions[id]))) return fail('That coin already exists')
    if (typeof msg.token.pad !== 'string' || typeof msg.token.chain !== 'string') return fail('Unknown chain or launchpad')
    const limit = cookAllowance(this.world, this.world ? (me.cookTicks ?? []) : Array(me.cooks ?? 0).fill(0), this.market.tick, secPerTickOf(this.market))
    if (limit.blocked) return fail(limit.blocked)
    if (this.market.tick - (me.lastCookTick ?? -999) < COOK_COOLDOWN_TICKS) return fail('Kitchen cooling down')
    const chain = msg.token.chain
    const pad = LAUNCHPADS[msg.token.pad]
    if (!(chain in CHAINS) || !pad || pad.chain !== chain) return fail('Unknown chain or launchpad')
    // The coin's look is checked before anything is charged: the same rules as the game's own form, plus the chat
    // filter and "no picture links" (see coinLook). A refused launch costs nothing.
    const look = coinLook(msg.token, { noLinks: this.world })
    if (typeof look === 'string') return fail(look)
    if (!NARRATIVES.some((n) => n.id === msg.token.narrative)) return fail('Unknown narrative')
    // Launched on a post (the story market, World only): the coin joins that post's coins. The post must still be open,
    // and not a tool's (a player's coin has no site). Several coins on a post may carry one ticker: that is the game.
    const openPost = this.world && Room.storyMarket && typeof money.onPost === 'string' ? this.market.sparkSim?.[money.onPost] : undefined
    const onPost = openPost && !openPost.tool ? (money.onPost as string) : undefined
    if (typeof money.onPost === 'string' && money.onPost && !onPost) return fail('That post is over: the timeline has moved on')
    // Tickers are unique among live coins, except a vamp may reuse the ticker of the coin it copies.
    if (!onPost && this.market.tokens.some((x) => x.ticker === look.ticker && x.status !== 'dead' && x.status !== 'rugged' && x.id !== msg.token.vampOf?.id)) return fail(`$${look.ticker} already exists`)
    const px = nativePrice(this.market, chain)
    const devWallet = typeof money.devWallet === 'string' && accountOf(w, money.devWallet) ? money.devWallet : w.accounts?.[0]?.id ?? 'w-main'
    const b = money.bundle && money.bundle.wallets > 0 ? { wallets: Math.min(50, Math.round(money.bundle.wallets)), perWallet: Math.max(0, Number(money.bundle.perWallet) || 0), stagger: !!money.bundle.stagger } : null
    const bundleUsd = b ? b.wallets * b.perWallet * px : 0
    const bundleFees = bundleUsd > 0 ? b!.wallets * BUNDLE_WALLET_FEE + (b!.stagger ? bundleUsd * STAGGER_FEE : 0) : 0
    const marketing = Math.max(0, Number(money.marketing) || 0)
    // (On a post the launch fee goes by the size of the account that posted: see postLaunchFee.)
    const launchFee = onPost ? postLaunchFee(this.market.sparks?.find((x) => x.id === onPost)?.by.followers ?? 0) : COOK_FEE
    const usdCosts = launchFee + marketing + bundleFees
    if (usdCosts > w.cash + 1e-9) return fail('Not enough USD for the launch fees')

    me.cooks = (me.cooks ?? 0) + 1
    me.lastCookTick = this.market.tick
    this.devStat(me, 'cooked', 1)
    if (this.world) me.cookTicks = [...(me.cookTicks ?? []).filter((t) => this.market.tick - t < 3600 / secPerTickOf(this.market)), this.market.tick]
    me.wallet = { ...w, cash: w.cash - usdCosts, feesPaid: w.feesPaid + launchFee + bundleFees }
    // The server builds the coin itself, the same way the game does, from the player's choices. Only the look comes
    // from the message: a coin sent whole could carry any price, liquidity or hidden "always pump, never rug" sim.
    const c0 = msg.token
    const taxPct = (n: unknown) => (Number.isFinite(n) ? Math.min(0.1, Math.max(0, Number(n))) : 0)
    const spec: CookSpec = {
      chain, pad: c0.pad, tax: { buy: taxPct(c0.tax?.buy), sell: taxPct(c0.tax?.sell) }, image: look.image,
      name: look.name, ticker: look.ticker, emoji: look.emoji, hue: look.hue, description: look.description,
      narrative: c0.narrative as Narrative, socials: { x: !!c0.socials?.x, tg: !!c0.socials?.tg, web: !!c0.socials?.web },
      style: money.style === 'hyped' || money.style === 'stealth' ? money.style : 'fair', marketing, devBuy: Math.max(0, Number(money.devBuy) || 0),
      bundle: b ?? { wallets: 0, perWallet: 0, stagger: false }, vampOf: c0.vampOf?.id,
    }
    const built = cookToken(this.market, new Rng((Math.random() * 2 ** 32) >>> 0), spec).token
    // In the World a player's coin plays by the simulated market's rules, as a bot chef's does (`flow.botDev`, see
    // TOPS in the market engine): left out of them, a well-made launch bonded half the time and paid its dev
    // hundreds of dollars in fees, launch after launch (scripts/cook-report.ts).
    const fairSim = this.world && built.sim.flow ? { ...built.sim, flow: { ...built.sim.flow, botDev: true } } : built.sim
    // On a post: its place in the rush, the post's theme, watched like the others while the story is open, and no pull
    // of its own yet (what it is called and how clean it reads is for the timeline to judge when it settles).
    let postBlock: number | undefined
    let story: Partial<NetToken> = {}
    let storySim = fairSim
    if (onPost && fairSim.flow) {
      const ps = this.market.sparkSim![onPost]
      const n = ps.n + 1
      this.market = { ...this.market, sparkSim: { ...this.market.sparkSim, [onPost]: { ...ps, n } } }
      const watch = watchOf(ps.tier, n)
      const theme = this.market.sparks?.find((x) => x.id === onPost)?.theme
      story = { spark: { id: onPost, n }, ...(theme ? { narrative: theme } : {}) }
      storySim = { ...fairSim, watch, rush: SPARK.rush[ps.tier] || undefined, flow: { ...fairSim.flow, q: SPARK.preQ, att: Math.max(fairSim.flow.att, watch), botDev: true } }
      postBlock = blockUsd(ps.tier, n, new Rng((Math.random() * 2 ** 32) >>> 0), ps.larp)
    }
    const token: NetToken = { ...built, ...story, sim: storySim, id, creator: 'you', creatorId: me.info.id, creatorName: me.info.name, devAddr: walletAddress(me.info.id, devWallet, 'sol'), status: 'bonding', creatorFees: 0 }
    this.market = { ...this.market, tokens: [token, ...this.market.tokens] }
    // cookToken drew the coin's first candle under its own id; move it to the id the game knows the coin by.
    const firstCandles = candleStore.get(built.id)
    candleStore.delete(built.id)
    if (firstCandles) candleStore.set(token.id, firstCandles)
    this.freshIds.add(token.id)
    this.cooked.set(token.id, { pid: me.info.id, walletId: devWallet, chain, vault: 0, feeMark: 0, grad: false })
    // A new coin from a real player: somebody in the room notices, and the snipers take a look.
    if (!me.info.bot) {
      this.lookAt(token.id, 90)
      this.react('fresh', token.ticker, 0.8, [4, 14])
    }

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
    // Its snipers are in before the coin is shown to anybody, as on every coin of the simulated market (see launchBlock).
    // (The more of the supply the dev took in the launch itself, the fewer of them: that bag is ahead of the block.)
    if (this.world) this.market = launchBlock(this.market, token.id, new Rng((Math.random() * 2 ** 32) >>> 0), ((me.wallet.positions[token.id]?.qty ?? 0) / SUPPLY) * 100, postBlock)
    const c = this.cooked.get(token.id)!
    c.feeMark = this.market.tokens.find((x) => x.id === token.id)?.creatorFees ?? 0
    this.playerEvents.push({ by: me.info.id, id: this.market.tick * 100 + 97, tick: this.market.tick, time: this.market.time, kind: 'cook', tokenId: token.id, ticker: token.ticker, text: `${me.info.avatar} ${me.info.name} cooked $${token.ticker}`, icon: '🍳', tone: 'info' })
    this.sendWallet(me, { ref: msg.ref, fills: fills.map((f) => ({ ...f, ref: msg.ref })), failures })
  }

  /** A player's post on the timeline: the crowd reacts on the shared market; everyone sees it next tick. */
  private post(me: Member, msg: Extract<ClientMsg, { t: 'post' }>) {
    // Bots write their own lines; players' posts go through the chat filter (and mutes).
    const text = me.info.bot ? String(msg.text ?? '').trim().slice(0, 200) : this.screen(me, msg.text)
    if (!text || this.market.tick - (me.lastPostTick ?? -999) < POST_COOLDOWN_TICKS) return
    me.lastPostTick = this.market.tick
    setClock(secPerTickOf(this.market))
    const t = msg.tokenId ? this.market.tokens.find((x) => x.id === msg.tokenId) : undefined
    // A player's reach comes from the followers the server has for them. (Bots are the server's own: theirs come
    // with the message.)
    const soc = me.info.bot ? null : this.socialOf(me, msg)
    const author = {
      name: me.info.name, handle: me.info.name.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'player', avatar: me.info.avatar, pid: me.info.id,
      followers: soc ? soc.followers : Math.max(0, Math.min(5_000_000, Math.round(msg.followers) || 0)), rep: soc ? soc.rep : Math.max(0, Math.min(100, Math.round(msg.rep) || 0)),
    }
    // Calling the same coin again and again reaches fewer people each time.
    const repeats = soc ? soc.calls.filter((c) => c.tokenId === t?.id && this.market.tick - c.tick < CALL_SETTLE_TICKS).length : Math.max(0, Math.min(10, msg.repeats | 0))
    const res = shill(this.market, new Rng((Math.random() * 2 ** 32) >>> 0), t, author, text, Math.min(10, repeats))
    this.market.shillQueue = [...(this.market.shillQueue ?? []), ...res.queue]
    const id = this.market.tick * 1000 + 900 + this.playerPosts.length
    this.playerPosts.push({
      id, tick: this.market.tick, time: this.market.time, accountId: 'player', author, text,
      tokenId: t?.id, ticker: t?.ticker, mcapAtPost: t?.mcap, peakMcap: t?.mcap, isCall: !!t, likes: res.likes, rts: res.rts, replies: res.replies, buyers: res.buyers,
    })
    if (soc) {
      // Likes bring a few followers now; a call is judged in tick() once it is CALL_SETTLE_TICKS old.
      me.social = {
        ...addFollowers(soc, res.likes * 0.1), posts: soc.posts + 1, lastPostTick: this.market.tick,
        calls: t ? [{ postId: id, tokenId: t.id, ticker: t.ticker, tick: this.market.tick, mcapAtPost: t.mcap, peak: t.mcap, likes: res.likes }, ...soc.calls].slice(0, 30) : soc.calls,
      }
      this.sendSocial(me, me.social)
    }
  }

  /**
   * A player's followers, reputation and open calls, kept by the server: followers decide how many people a post
   * reaches and how many copy a buy, which moves prices, so the count can't come from the browser. The World starts
   * everyone fresh and what a message claims is ignored. A friends room starts from the player's own profile the
   * first time it is needed (`claim`), then keeps count itself.
   */
  private socialOf(me: Member, claim?: { followers?: unknown; rep?: unknown }): SocialProfile {
    if (!me.social) {
      const fresh = freshSocial()
      const num = (v: unknown, lo: number, hi: number, or: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : or)
      me.social = this.world || !claim || typeof claim !== 'object' ? fresh : { ...fresh, followers: num(claim.followers, 10, FOLLOWER_CEILING, fresh.followers), rep: num(claim.rep, 0, 100, fresh.rep) }
    }
    return me.social
  }

  /** `joined`: sent because they (re)joined, not because something just changed. */
  private sendSocial(m: Member, social: SocialProfile, results?: CallResult[], joined?: boolean) {
    this.sendTo(m.info.id, { t: 'social', social, ...(results?.length ? { results } : {}), ...(joined ? { joined: true } : {}) })
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
    // The coins in real wallets (players on or off line, and the bots) and in the tracked wallets: the rest of the
    // simulated crowd can only sell what it bought itself, never these (see sellRoom in the market engine).
    const held = new Map<string, number>()
    for (const m of this.members.values()) for (const [id, p] of Object.entries(m.wallet?.positions ?? {})) held.set(id, (held.get(id) ?? 0) + p.qty)
    for (const w of this.wallets) if (!w.bot) for (const [id, p] of Object.entries(w.positions)) held.set(id, (held.get(id) ?? 0) + p.qty) // (a bot's public wallet mirrors its own)
    const { market, events: e1 } = tickMarket(this.market, rng, { rugMult: MODES[this.round.mode].rugMult, protectedIds, held, sparks: Room.storyMarket, larps: Room.larps, tech: Room.tech })
    // The crowd talks about what just happened: a coin that bonded, a dev that dumped.
    for (const e of e1) {
      if (e.kind === 'graduation' && e.ticker) this.react('grad', e.ticker, 0.45, [2, 8])
      else if (e.kind === 'rug' && e.ticker) this.react('rug', e.ticker, 0.45, [2, 7])
      else if (e.kind === 'devsell' && e.ticker && e.text.includes('whole bag')) this.react('rug', e.ticker, 0.2, [2, 7])
    }
    const e2 = rollEvents(market, rng)
    const wr = tickWallets(this.wallets.filter((w) => !w.bot), market, rng)
    const posts = [...tickSocial(market, rng, wr.actions, [...e1, ...e2]), ...this.playerPosts]
    this.playerPosts = []
    // The coins' stories: what the market just did, in words, and what the timeline makes of each coin. (The bots'
    // trades are the ones from the tick before: they trade after the market has moved.)
    // Outside data: whatever the server's source says now (a provider, the owner's recording), else what it had.
    if (this.world) market.trends = trendSource.current() ?? market.trends
    tickStories(market, { before: this.market, events: [...e1, ...e2, ...this.playerEvents], actions: [...wr.actions, ...this.botActions], posts, wallets: this.wallets })

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
      // (The World is kept for ever: a bot stored before its fields were checked is switched off here.)
      if (!BOT_RATES.includes(bot.rate) || !Number.isFinite(bot.budget) || !Number.isFinite(bot.spent)) { stop('Bot switched off'); continue }
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
      const dev = this.members.get(c.pid)
      // What the dev really holds shows on the coin's page and in how the crowd takes to it (see stepFlow). A bot
      // never reports its bag, and a game that understates one is put right here. The dev is the wallet that deployed
      // the coin, and only that one: what the same player buys with another wallet is not the dev's bag (it used to be
      // counted, so a side-wallet buy showed up as the dev buying).
      if (dev?.wallet && (t.status === 'bonding' || t.status === 'graduated')) {
        const held = (((dev.info.bot ? dev.wallet.positions[id] : accountOf(dev.wallet, c.walletId)?.positions[id])?.qty ?? 0) / SUPPLY) * 100
        if (dev.info.bot) t.devPct = held
        else if (t.devPct + (t.bundlePct ?? 0) < held - 0.05) t.devPct = Math.min(100, held - (t.bundlePct ?? 0))
      }
      if (!c.grad && t.status === 'graduated') {
        c.grad = true
        usd += GRAD_BONUS
        if (dev) this.devStat(dev, 'migrated', 1)
      }
      if (usd > 0) {
        c.vault += usd / nativePrice(market, c.chain)
        if (dev) this.devStat(dev, 'fees', usd)
      }
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
    const fromSim = wr.actions.length
    this.botTick(rng, wr.actions)
    this.botActions = wr.actions.slice(fromSim) // what the bots just did: the next tick's stories read it
    if (this.world && this.market.tick % 60 === 0) this.closeSeasonIfDue() // a new month closes the season even if nobody has the leaderboard open
    for (const m of billed) this.sendWallet(m)
    // Players' calls on the timeline: the server follows each called coin's best price and judges the call when it is
    // old enough (their followers and reputation live here: see socialOf).
    let coinOf: Map<string, Token> | null = null
    for (const m of this.members.values()) {
      if (!m.social?.calls.some((c) => !c.settled)) continue
      coinOf ??= new Map(this.market.tokens.map((t) => [t.id, t]))
      const j = judgeCalls(m.social, this.market.tick, (id) => coinOf!.get(id))
      m.social = j.social
      if (!j.results.length) continue
      if (m.ws) this.sendSocial(m, j.social, j.results)
      else m.socialMissed = [...(m.socialMissed ?? []), ...j.results].slice(-10) // away: told when they are back
    }

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

    const points: TickMsg['points'] = {}
    for (const [id, pts] of this.pending) points[id] = pts.map(([time, price, prev, vol]) => [time, r6(price), r6(prev), r3(vol)])
    this.freshTape.clear()
    const msg: TickMsg = {
      t: 'tick', market: this.tickMarketDiff(), wallets: this.walletDiff(), events, posts, actions: wr.actions,
      points: this.world ? {} : points, newCandles, bots,
    }
    // World: a browser draws one chart and one tape at a time, and those were a third of everything it received.
    // So the tick carries neither; each player is sent the chart points and trades of the coin they have open, just
    // before the tick (built once per coin, however many are looking at it).
    if (this.world) {
      const looking = new Map<string, Member[]>()
      for (const m of this.members.values()) if (m.focus && m.ws && m.ws.readyState === 1) looking.set(m.focus, [...(looking.get(m.focus) ?? []), m])
      for (const [id, who] of looking) {
        const pts = points[id]
        const tape = this.freshTape.get(id)
        if (!pts && !tape) continue
        const data = Buffer.from(JSON.stringify({ t: 'focus', tokenId: id, ...(pts ? { points: pts } : {}), ...(tape ? { tape: round(tape) as TapeTrade[] } : {}) } satisfies ServerMsg))
        for (const m of who) m.ws!.send(data, { binary: false })
      }
    }
    this.pending = new Map()
    setCandleLog(null)

    if (this.round.state === 'running' && this.round.durationTicks && market.tick - this.round.startTick >= this.round.durationTicks) {
      this.round = { ...this.round, state: 'ended' }
      this.broadcast(msg)
      this.broadcast({ t: 'round', round: this.round })
    } else this.broadcast(msg)
    // The player list goes to everyone, so its cost grows with the square of the players. In the World, where every
    // browser reports its status every 2 s, it was re-sent after almost every tick (45% of all data at 200 players):
    // there it goes out every few seconds instead. Joining and leaving still send it at once.
    if (this.playersDirty && (!this.world || this.market.tick % WORLD_PLAYERS_TICKS === 0)) this.broadcastPlayers()
  }

  // ─── Wire formats ──────────────────────────────────────────────────────────
  /** The whole market, numbers rounded (welcome / round start). */
  private netMarket(): NetMarket {
    let max = this.lastTapeId
    for (const t of this.market.tokens) for (const e of t.tape) if (e.id > max) max = e.id
    // (Not the engine's queues: orders and story beats that have not happened yet are nobody's to read.)
    // (Nor the story market's hidden side, in any room: which posts will run and which name is the right one.)
    const { shillQueue: _q, beatQueue: _b, beatTape: _t, lateEvents: _l, sparkSim: _s, ...all } = this.market
    void _q, void _b, void _t, void _l, void _s
    // (World: nor a coin's hidden state, nor the dice.)
    const open = this.world ? { ...all, seed: 0, tokens: all.tokens.map((t) => ({ ...t, sim: WIRE_SIM })) } : all
    return round(open) as NetMarket
  }

  /**
   * This tick's market: every coin as `id` + only the fields that changed since the last tick (rounded), plus its new
   * trades. `sim` (the hidden simulation state) goes out once per coin: browsers only read its constant archetype.
   */
  private tickMarketDiff(): TickMsg['market'] {
    const since = this.lastTapeId
    const sinceBeat = this.lastBeatSeq
    let max = since
    const tick = this.market.tick
    const tokens: TokenDiff[] = this.market.tokens.map((t) => {
      const turn = tick + turnOf(t.id)
      // On its refresh turn a coin is sent in full, as if new (repairs anything a browser missed).
      const prev = turn % KEYFRAME_TICKS === 0 ? undefined : this.sentTokens.get(t.id)
      const slowTurn = !this.world || turn % SLOW_FIELD_TICKS === 0
      const snap: Record<string, string> = prev ?? {}
      const out: TokenDiff = { id: t.id }
      for (const [k, v] of Object.entries(t)) {
        if (k === 'id' || k === 'tape' || k === 'beats' || (k === 'sim' && prev)) continue
        // World: a market cap is its price times the supply, so it rides on the price (the browser works it out).
        if (this.world && prev && k === 'mcap') continue
        // A coin's picture never changes and can be tens of KB. It goes out with the coin's first send (and in the
        // welcome of anyone who joins later), not again on every refresh turn, and it isn't re-read every tick.
        if (k === 'image') {
          if (this.sentImages.has(t.id) && this.sentImages.get(t.id) === v) continue
          this.sentImages.set(t.id, v as string | undefined)
        }
        if (prev && !slowTurn && SLOW_FIELDS.has(k)) continue
        // World: a coin's hidden state (its quality, its regime, where its story stands) is the server's alone.
        const rv = this.world && k === 'sim' ? WIRE_SIM : round(v)
        const js = JSON.stringify(rv)
        if (!prev || prev[k] !== js) {
          ;(out as Record<string, unknown>)[k] = rv
          snap[k] = js
        }
      }
      const known = this.sentTokens.has(t.id)
      this.sentTokens.set(t.id, snap)
      const tape = t.tape.filter((e) => e.id > since)
      for (const e of tape) if (e.id > max) max = e.id
      // World: a tick carries only real players' trades (friends are followed by them); a coin's whole tape goes to
      // the players who have it open (see `focus` in tick()).
      if (this.world) {
        if (tape.length) this.freshTape.set(t.id, tape)
        const named = tape.filter((e) => e.pid || e.addr)
        if (named.length) out.tape = round(named) as TokenDiff['tape']
      } else if (tape.length) out.tape = round(tape) as TokenDiff['tape']
      // Its story beats travel the same way: new ones whole, changed ones as what changed (a coin's first send has them all).
      const beats = known ? t.beats?.filter((b) => b.seq > sinceBeat).map((b) => (b.id > sinceBeat ? b : { id: b.id, seq: b.seq, move: b.move })) : t.beats
      if (beats?.length) out.beats = round(beats) as TokenDiff['beats']
      return out
    })
    for (const id of this.sentTokens.keys()) {
      if (this.market.tokens.some((t) => t.id === id)) continue
      this.sentTokens.delete(id)
      this.sentImages.delete(id)
    }
    this.lastTapeId = max
    this.lastBeatSeq = this.market.nextBeatId ?? 0
    // The market's own header goes out every tick: not the queues, and not the trend list (it is in the welcome, and
    // again only when the data source hands over a new one: a provider refreshed, or went out of date).
    // The story market's posts go out like beats: the new ones and the changed ones. Their hidden side never does.
    const { tokens: _all, shillQueue: _q, beatQueue: _b, beatTape: _t, trends: _tr, lateEvents: _l, sparks: _sp, sparkSim: _ss, ...rest } = this.market
    void _all, void _q, void _b, void _t, void _l, void _ss
    const sparks = _sp?.filter((s) => s.seq > this.lastSparkSeq)
    this.lastSparkSeq = this.market.sparkSeq ?? 0
    const fresh = _tr && this.sentTrends !== null && _tr !== this.sentTrends ? { trends: _tr } : {}
    this.sentTrends = _tr ?? this.sentTrends ?? null
    // (World: the market's dice stay on the server too.)
    return { ...(round(rest) as Omit<NetMarket, 'tokens'>), ...(this.world ? { seed: 0 } : {}), ...fresh, ...(sparks?.length ? { sparks } : {}), tokens }
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
      const refresh = (this.market.tick + turnOf(w.id)) % KEYFRAME_TICKS === 0
      if (!refresh && this.sentWallets.get(w.id) === js && !trades.length) continue
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
    // Bots no longer in the crowd (the original 20, or ones WORLD_BOTS turned off) leave the World with their wallets.
    for (const [id, m] of this.members) {
      if (m.info.bot && !BOT_BY_ID.has(id)) {
        this.members.delete(id)
        this.wallets = this.wallets.filter((x) => x.id !== id)
        this.playersDirty = true
      }
    }
    for (const spec of BOT_ROSTER) {
      if (!this.members.has(spec.id)) {
        this.members.set(spec.id, {
          info: { id: spec.id, name: spec.name, avatar: spec.avatar, level: rng.int(8, 40), online: spec.always, equity: WORLD_START_BALANCE, startEquity: WORLD_START_BALANCE, trades: 0, wins: 0, bot: true },
          ws: null, protect: [], ack: 0, wallet: freshWallet(WORLD_START_BALANCE), brain: freshBrain(spec, this.market.tick, rng),
        })
      }
      const m = this.members.get(spec.id)!
      if (m.info.name !== spec.name) {
        m.info = { ...m.info, name: spec.name }
        this.playersDirty = true
      }
      m.brain ??= freshBrain(spec, this.market.tick, rng)
      if (spec.always && !m.info.online) m.info = { ...m.info, online: true } // the always-on bots are back as soon as the World is
      if (!this.wallets.some((w) => w.id === spec.id)) this.wallets = [...this.wallets, mirrorWallet(spec, m.wallet?.startBalance ?? WORLD_START_BALANCE)]
      else if (this.wallets.some((w) => w.id === spec.id && w.name !== spec.name)) this.wallets = this.wallets.map((w) => (w.id === spec.id ? { ...w, name: spec.name } : w))
    }
  }

  /**
   * A World saved while bot names carried a robot still has that name on the coins they launched, on the tape and in
   * old posts and events. Put today's names there (found by the bot's id where there is one, else by the old name).
   */
  private unlabelBots() {
    if (!this.world) return
    const mark = ` ${String.fromCodePoint(0x1f916)}` // the label as the names carried it: a space, then the robot
    const plain = (text: string) => (text.includes(mark) ? text.split(mark).join('') : text)
    const tokens = this.market.tokens as NetToken[]
    if (tokens.some((t) => t.creatorName?.includes(mark) || t.tape.some((e) => e.wallet.includes(mark)))) {
      this.market = { ...this.market, tokens: tokens.map((t) => (t.creatorName?.includes(mark) || t.tape.some((e) => e.wallet.includes(mark)) ? ({ ...t, ...(t.creatorName ? { creatorName: plain(t.creatorName) } : {}), tape: t.tape.map((e) => (e.wallet.includes(mark) ? { ...e, wallet: plain(e.wallet) } : e)) } as NetToken) : t)) }
    }
    this.posts = this.posts.map((p) => (p.author?.name.includes(mark) ? { ...p, author: { ...p.author, name: plain(p.author.name) } } : p))
    this.events = this.events.map((e) => (e.text.includes(mark) ? { ...e, text: plain(e.text) } : e))
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
    m.brain!.fills = (m.brain!.fills ?? 0) + 1
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
    this.realized(m, r.fills)
    this.mirrorFill(m, nt, r.fills[0], all ? 'all' : 'partial', actions)
    m.brain!.fills = (m.brain!.fills ?? 0) + 1
    if ((r.fills[0].pnl ?? 0) > 0) m.brain!.wins = (m.brain!.wins ?? 0) + 1
    if (all) {
      delete m.brain!.entries[t.id]
      if (m.brain!.plans) delete m.brain!.plans[t.id]
    }
    return r.fills[0]
  }

  /** A bot's worthless bag (dead or delisted coin) leaves its wallet as a realized loss, and its public wallet too. */
  private botWriteOff(m: Member, tokenId: string, chain: Chain) {
    const main = m.wallet?.accounts?.[0]
    const pos = main?.positions[tokenId]
    if (!m.wallet || !main || !pos) return
    const r = runGiveAway(m.wallet, main.id, tokenId, pos.qty, chain, 0)
    if (!r.ok) return
    m.wallet = r.portfolio
    const cp = (m.chainPnl ??= { sol: 0, bsc: 0, hood: 0 })
    cp[chain] = (cp[chain] ?? 0) - pos.costBasis
    delete m.brain!.entries[tokenId]
    delete m.brain!.cooked[tokenId]
    if (m.brain!.plans) delete m.brain!.plans[tokenId]
    const i = this.wallets.findIndex((w) => w.id === m.info.id)
    const mine = i >= 0 ? this.wallets[i].positions[tokenId] : undefined
    if (!mine) return
    const w0 = this.wallets[i]
    const positions = { ...w0.positions }
    delete positions[tokenId]
    const w: SimWallet = { ...w0, positions, live: { ...w0.live, losses: w0.live.losses + 1, pnl24h: w0.live.pnl24h - mine.cost } }
    this.wallets = this.wallets.map((x, k) => (k === i ? w : x))
  }

  /** A chat line of this kind that nobody in the room said lately. */
  private say(kind: Parameters<typeof chatLine>[0], rng: Rng, ticker = '', pct = 0) {
    return chatLine(kind, rng, ticker, pct, this.botLines)
  }

  /** Something happened that people would talk about: maybe one of the crowd says so, a few seconds later. */
  private react(kind: Parameters<typeof chatLine>[0], ticker: string, chance: number, delay: [number, number], not?: string) {
    if (!this.world || Math.random() >= chance || this.botSay.length >= 8) return
    const rng = new Rng((Math.random() * 2 ** 32) >>> 0)
    this.botSay.push({ at: this.market.tick + rng.int(delay[0], delay[1]), text: this.say(kind, rng, ticker), not })
  }

  /** The crowd looks at this coin for a while: bots choosing what to buy are likelier to pick it. */
  private lookAt(tokenId: string, ticks: number) {
    if (!this.world) return
    this.eyesOn.set(tokenId, this.market.tick + ticks)
    if (this.eyesOn.size > 200) for (const [id, until] of this.eyesOn) if (until < this.market.tick) this.eyesOn.delete(id)
  }

  private botChat(m: Member, text: string, reply = false) {
    // Each bot keeps quiet for a while after talking, and the crowd leaves gaps between lines; answers skip the wait.
    if (!reply && (this.market.tick - (m.brain?.lastChat ?? -999) < 90 || this.market.tick - this.lastBotChat < 20)) return
    m.brain!.lastChat = this.market.tick
    this.lastBotChat = this.market.tick
    const said = inVoice(BOT_BY_ID.get(m.info.id), text, new Rng((Math.random() * 2 ** 32) >>> 0)) // each bot talks its own way
    this.broadcast({ t: 'chat', from: m.info.id, name: m.info.name, avatar: m.info.avatar, text: said, time: Date.now() })
    // Now and then somebody answers: a room where nobody ever replies to anybody reads as a wall of announcements.
    if (!reply) this.react('agree', '', 0.22, [4, 12], m.info.id)
  }

  /** A bot looks at the market and maybe buys, the way real traders of its style and level did (server/brainBots.ts). */
  private brainEntry(m: Member, spec: BotSpec, g: BrainGroup, held: number, rng: Rng, actions: WalletAction[]) {
    const b = m.brain!
    const p = spec.persona
    const every = Math.max(1, Math.round(p.react * rng.range(0.7, 1.3)))
    b.nextAct = this.market.tick + every
    const w = this.walletOf(m)
    if (!w || held >= STYLE[b.style].maxBags) return
    // Mood: a winning run makes anyone bolder; a losing run makes "chase" types bet bigger and "scared" ones smaller.
    const s = b.streak ?? 0
    const mood = s >= 3 ? 1.25 : s <= -3 ? (p.tilt === 'chase' ? 1.5 : 0.6) : 1
    // How likely a wallet like this opens a bag in this many seconds, from the recordings.
    if (!rng.chance(Math.min(0.9, (buysPerMinute(g) / 60) * every * mood * BUY_PACE))) return
    const solUsd = nativePrice(this.market, 'sol')
    const now = this.market.time
    const open = w.accounts?.[0]?.positions ?? {}
    const live = this.market.tokens.filter((t) => (t.status === 'bonding' || t.status === 'graduated') && t.liquidity > 1_000 && !open[t.id])
    if (!live.length) return
    let t: Token | undefined
    if (rng.chance(p.mistake)) t = [...live].sort((a, c) => c.change['5m'] - a.change['5m'])[0] // FOMO into whatever is already up the most
    else {
      // Weigh coins by how much more often real traders like this bought in that kind of moment.
      // (Coins the crowd is looking at, a player's fresh launch or a coin somebody just bought big, are always in view.)
      const watched = live.filter((x) => (this.eyesOn.get(x.id) ?? 0) > this.market.tick)
      const some = live.length > 40 ? [...live.slice(0, 20), ...Array.from({ length: 20 }, () => live[rng.int(0, live.length - 1)])] : live
      const pool = watched.length ? [...watched, ...some.filter((x) => !watched.includes(x))] : some
      const safe = pool.map(safety)
      const order = [...safe].sort((a, c) => a - c)
      const rank = (v: number) => (order.indexOf(v) + 1) / order.length // 1 = the safest coin in view
      const weights = pool.map((x, i) => (g.buyLift[situation(x, now, solUsd)] ?? 0.15) * eye(spec.tier, rank(safe[i]), x) * (watched.includes(x) ? 3 : 1))
      let r = rng.next() * weights.reduce((a, c) => a + c, 0)
      t = pool.find((_, i) => (r -= weights[i]) <= 0) ?? pool[pool.length - 1]
    }
    const cashLike = w.cash + Object.entries(w.balances).reduce((a, [c, n]) => a + n * nativePrice(this.market, c as Chain), 0)
    const usd = Math.min(draw(g.buySizeSol, rng) * SIZE_SCALE * p.size * mood * solUsd, cashLike * 0.35, t.liquidity * 0.03)
    if (usd < 20) return
    const f = this.botBuy(m, t, usd, actions)
    if (!f) return
    const plan = planExit(g, rng, p.patience)
    // Dumpers sell their whole bag into the first decent pump.
    if (b.style === 'dumper') Object.assign(plan, { target: Math.min(plan.target, rng.range(1.1, 1.5)), frac: 1, holdToEnd: false })
    ;(b.plans ??= {})[t.id] = plan
    if (rng.chance(0.25)) this.botChat(m, this.say(b.style === 'sniper' || b.style === 'dumper' ? 'snipe' : b.style === 'whale' ? 'whale' : 'buy', rng, t.ticker))
    if (rng.chance(0.06)) this.botPost(m, t, `${t.ticker} ${rng.chance(0.5) ? 'looks ready 🚀' : 'is the play today'}`)
  }

  /** A bag bought from the market brain: get out the way real traders like this one did. */
  private brainExit(m: Member, spec: BotSpec, t: Token, qty: number, pnl: number, age: number, plan: NonNullable<BotBrain['plans']>[string], rng: Rng, actions: WalletAction[]) {
    const b = m.brain!
    const x = pnl + 1
    const paperHands = rng.chance(spec.persona.mistake * 0.02) // now and then, out early for no good reason
    const due = x >= plan.target || (!plan.holdToEnd && age >= plan.after) || (plan.holdToEnd && age >= plan.after * 8) || (plan.cutsLoss && x <= (plan.stop ?? 0.5)) || paperHands
    if (!due) return
    const part = plan.frac >= 1 ? qty : qty * plan.frac
    // A big sell (a tenth of the coin's pool or more) waits if other bots just dumped this coin: real pile-ons happen,
    // but the bots mustn't all crash one coin together.
    const big = part * t.price >= t.liquidity * 0.1
    if (big && !this.mayDump(t.id)) {
      plan.after = age + rng.int(3, 10)
      return
    }
    if (!this.botSell(m, t, part, actions)) return
    if (big) this.noteDump(t.id)
    if (b.plans?.[t.id]) {
      // Sold part of it: the rest goes later, and only higher.
      Object.assign(plan, { frac: 1, after: age + Math.max(5, plan.after * rng.range(0.3, 1)), target: Math.max(plan.target, x * 1.15) })
      return
    }
    b.streak = x >= 1 ? Math.max(1, (b.streak ?? 0) + 1) : Math.min(-1, (b.streak ?? 0) - 1)
    if (rng.chance(0.3)) this.botChat(m, this.say(x >= 1 ? 'win' : 'loss', rng, t.ticker, pnl))
  }

  /** Bots' big sells per coin in the last 10 seconds (the pile-on limit). */
  private bigSells = new Map<string, number[]>()
  private mayDump(id: string) {
    const recent = (this.bigSells.get(id) ?? []).filter((at) => this.market.tick - at < 10)
    this.bigSells.set(id, recent)
    return recent.length < PILE_ON_LIMIT
  }
  private noteDump(id: string) {
    this.bigSells.set(id, [...(this.bigSells.get(id) ?? []), this.market.tick])
    if (this.bigSells.size > 300) for (const [k, v] of this.bigSells) if (!v.some((at) => this.market.tick - at < 10)) this.bigSells.delete(k)
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
    const byId = new Map(this.market.tokens.map((t) => [t.id, t]))
    // Chat that isn't about a bot's own trade: an answer owed to a real player, or a shout about a coin that's running.
    if ((this.botReply && tick >= this.botReply.at) || tick % 45 === 0) {
      const awake = BOT_ROSTER.map((s) => this.members.get(s.id)).filter((m): m is Member => !!m?.brain && m.info.online)
      const m = awake.length ? awake[rng.int(0, awake.length - 1)] : undefined
      if (m && this.botReply && tick >= this.botReply.at) this.botChat(m, this.botReply.text, true)
      else if (m && rng.chance(0.3)) {
        const hot = this.market.tokens.filter((t) => (t.status === 'bonding' || t.status === 'graduated') && t.change['5m'] > 40 && t.liquidity > 5_000).sort((a, b) => b.change['5m'] - a.change['5m'])[0]
        if (hot) this.botChat(m, this.say('hype', rng, hot.ticker, hot.change['5m'] / 100))
        else {
          const cold = this.market.tokens.filter((t) => t.status === 'graduated' && t.change['5m'] < -30 && t.liquidity > 5_000).sort((a, b) => a.change['5m'] - b.change['5m'])[0]
          if (cold) this.botChat(m, this.say('dip', rng, cold.ticker))
        }
      }
      if (this.botReply && tick >= this.botReply.at) this.botReply = null
    }
    // What the crowd owes the room (see botSay): one line at a time, a few seconds apart.
    const owed = this.botSay.findIndex((q) => tick >= q.at)
    if (owed >= 0 && tick - this.lastBotChat >= 4) {
      const q = this.botSay.splice(owed, 1)[0]
      const awake = BOT_ROSTER.map((x) => this.members.get(x.id)).filter((x): x is Member => !!x?.brain && x.info.online && x.info.id !== q.not)
      if (awake.length) this.botChat(awake[rng.int(0, awake.length - 1)], q.text, true)
    }
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
      const bags = Object.values(w.accounts?.[0]?.positions ?? {})

      // Exits (the chef handles its own coins below).
      for (const pos of bags) {
        const t = byId.get(pos.tokenId)
        // A bag in a coin that died, or that has left the market, can never be sold: take the loss and drop it (dev
        // bags too). Left in the wallet, every such bag keeps its dead coin listed while the bot is online and stays
        // in the save forever, so the World would grow without limit.
        if (!t || !live(t)) {
          if (b.entries[pos.tokenId]) {
            b.streak = Math.min(-1, (b.streak ?? 0) - 1)
            if (t && rng.chance(0.4)) this.botChat(m, this.say('loss', rng, t.ticker, -0.9))
          }
          this.botWriteOff(m, pos.tokenId, t?.chain ?? 'sol')
          continue
        }
        if (b.cooked[pos.tokenId]) continue
        const e = (b.entries[t.id] ??= { tick, peak: t.price })
        e.peak = Math.max(e.peak, t.price)
        const pnl = t.price / Math.max(1e-18, pos.avgEntry) - 1
        const plan = b.plans?.[t.id]
        if (plan) {
          this.brainExit(m, spec, t, pos.qty, pnl, tick - e.tick, plan, rng, actions)
          continue
        }
        const exit = pnl >= st.tp || (st.sl !== null && pnl <= -st.sl) || (st.hold !== null && tick - e.tick > st.hold)
        if (!exit || !rng.chance(0.5)) continue
        const f = this.botSell(m, t, pos.qty, actions)
        if (f && rng.chance(0.3)) this.botChat(m, this.say(pnl >= 0 ? 'win' : 'loss', rng, t.ticker, pnl))
      }

      const learned = b.style === 'chef' ? null : groupFor(b.style, spec.tier)
      if (b.style === 'chef') this.chefTick(m, rng, actions)
      // Only bags in coins still trading count toward a bot's limit: a bag in a dead coin can't be sold, and would
      // otherwise leave the bot unable to buy anything again.
      else if (learned && tick >= b.nextAct) this.brainEntry(m, spec, learned, bags.filter((p) => { const x = byId.get(p.tokenId); return x && (x.status === 'bonding' || x.status === 'graduated') }).length, rng, actions)
      else if (tick >= b.nextAct) {
        b.nextAct = tick + rng.int(st.every[0], st.every[1])
        if (bags.length < st.maxBags) {
          const t = pickCoin(b.style, this.market.tokens, this.market.time, new Set(bags.map((p) => p.tokenId)), rng)
          const cashLike = w.cash + Object.entries(w.balances).reduce((a, [c, n]) => a + n * nativePrice(this.market, c as Chain), 0)
          const usd = b.style === 'degen' ? cashLike * rng.range(0.2, st.share) : Math.min(rng.range(st.size[0], st.size[1]), cashLike * st.share)
          if (t && usd >= 20) {
            const f = this.botBuy(m, t, Math.min(usd, t.liquidity * 0.03), actions)
            if (f) {
              if (rng.chance(0.25)) this.botChat(m, this.say(b.style === 'sniper' ? 'snipe' : b.style === 'whale' ? 'whale' : 'buy', rng, t.ticker))
              if (rng.chance(0.12)) this.botPost(m, t, `${t.ticker} ${rng.chance(0.5) ? 'looks ready 🚀' : 'is the play today'}`)
            }
          }
        }
      }
      if (tick - b.lastChat > 600 && rng.chance(0.002)) this.botChat(m, this.say('idle', rng))

      // Scoreboard, public bags, coins to keep listed, and going broke.
      if (tick % 5 === 0) {
        const v = valuePortfolio(m.wallet!, byId, this.market)
        const trades = m.wallet!.trades
        m.info = {
          ...m.info, equity: v.equity, startEquity: m.wallet!.startBalance, trades: b.fills ?? trades.length, wins: b.wins ?? trades.filter((x) => x.side === 'sell' && (x.pnl ?? 0) > 0).length,
          holdings: Object.values(m.wallet!.accounts?.[0]?.positions ?? {}).slice(0, 30).map((p) => ({ tokenId: p.tokenId, qty: p.qty, cost: p.costBasis, openedAt: p.openedAt })),
        }
        m.protect = Object.keys(m.wallet!.positions)
        if (m.wallet!.trades.length > BOT_TRADES_KEPT) m.wallet = { ...m.wallet!, trades: m.wallet!.trades.slice(0, BOT_TRADES_KEPT) }
        this.playersDirty = true
        const liveBags = Object.keys(m.wallet!.positions).filter((id) => { const t = byId.get(id); return t && (t.status === 'bonding' || t.status === 'graduated') })
        if (!liveBags.length && v.equity < BOT_BUST_USD) {
          // Broke: start over small, like a real player would (the loss stays on their record).
          m.pnlCarry = (m.pnlCarry ?? 0) + (v.equity - m.wallet!.startBalance)
          m.wallet = freshWallet(BOT_RESTART_USD, m.layout)
          b.entries = {}
          b.cooked = {}
          b.busts++
          const i = this.wallets.findIndex((x) => x.id === spec.id)
          if (i >= 0) this.wallets = this.wallets.map((x, k) => (k === i ? { ...x, cash: BOT_RESTART_USD, positions: {} } : x))
          this.botChat(m, this.say('bust', rng))
        }
      }
    }
  }

  /** The chefs: each launches a coin every so often, shills it, dumps part of the dev bag when it runs, claims fees. */
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
      const dump = c.dumpAt !== undefined && tick >= c.dumpAt // the planned dev dump, timed like real devs'
      // The buyers have gone: a dev doesn't sit on a bag in a coin that is going quiet on its curve.
      const fading = !ran && !old && !dump && t.status === 'bonding' && !!t.sim.flow && t.sim.flow.att < 0.1 && tick - c.tick > 40 && rng.chance(0.2)
      if (!ran && !old && !dump && !fading) continue
      const frac = old || fading ? 1 : dump ? rng.range(0.5, 1) : rng.range(0.3, 0.6)
      if (dump && !this.mayDump(id)) {
        c.dumpAt = tick + rng.int(3, 10)
        continue
      }
      const f = this.botSell(m, t, held * frac, actions)
      if (!f) continue
      this.devSold(id, held, m.wallet?.accounts?.[0]?.positions[id]?.qty ?? 0)
      if (dump) {
        c.dumpAt = undefined
        this.noteDump(id)
      }
      if (old || fading) delete b.cooked[id]
      else c.mcap = t.mcap // next dump only after another run
      this.playerEvents.push({ by: m.info.id, id: tick * 100 + 96, tick, time: this.market.time, kind: 'devsell', tokenId: t.id, ticker: t.ticker, text: `Dev (${m.info.name}) sold ${Math.round(frac * 100)}% of their ${t.ticker} bag`, icon: '🧑‍💻', tone: 'down' })
      if (!fading && rng.chance(0.5)) this.botChat(m, this.say('devsell', rng, t.ticker))
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
    // Most launches ride what the real market is launching right now (approved themes only); the rest are random.
    const liveTickers = this.market.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated').map((t) => t.ticker)
    const trend = rng.chance(TREND_SHARE) ? trendCoin(rng, (x) => this.market.tokens.some((t) => t.ticker === x), liveTickers) : null
    const base = trend ?? generatedLaunch(this.market.launched + rng.int(50, 5000))
    let ticker = base.ticker
    for (let k = 2; k < 9 && this.market.tokens.some((t) => t.ticker === ticker); k++) ticker = `${base.ticker}${k}`
    const narratives: Narrative[] = ['dogs', 'cats', 'frogs', 'ai', 'food', 'space', 'absurd', 'retro']
    const marketing = rng.int(0, 150)
    const spec: CookSpec = {
      chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, name: base.name, ticker, emoji: base.emoji, hue: rng.int(0, 359), description: '',
      narrative: trend?.narrative ?? narratives[rng.int(0, narratives.length - 1)], socials: { x: true, tg: rng.chance(0.5), web: rng.chance(0.3) }, style: 'fair',
      marketing, devBuy: Math.min(rng.range(0.5, 2), (cashLike * 0.4) / px), bundle: { wallets: 0, perWallet: 0, stagger: false },
    }
    const cooked = cookToken(this.market, rng, spec)
    const id = cooked.token.id
    this.market = { ...cooked.market, tokens: cooked.market.tokens.map((t) => (t.id === id ? ({ ...t, creator: 'you', creatorId: m.info.id, creatorName: m.info.name, devAddr: walletAddress(m.info.id, main, 'sol'), sim: t.sim.flow ? { ...t.sim, flow: { ...t.sim.flow, botDev: true } } : t.sim } as NetToken) : t)) }
    m.wallet = { ...w, cash: Math.max(0, w.cash - COOK_FEE - marketing), feesPaid: w.feesPaid + COOK_FEE }
    this.freshIds.add(id)
    this.cooked.set(id, { pid: m.info.id, walletId: main, chain: 'sol', vault: 0, feeMark: 0, grad: false })
    this.devStat(m, 'cooked', 1)
    const t = this.market.tokens.find((x) => x.id === id)!
    this.botBuy(m, t, spec.devBuy * px, actions)
    const after = this.market.tokens.find((x) => x.id === id)!
    this.cooked.get(id)!.feeMark = after.creatorFees ?? 0
    // Some devs dump their bag soon after launch, as on pump.fun; the worse the chef, the likelier.
    const me = BOT_BY_ID.get(m.info.id)
    const dumps = me ? DEV_DUMP_CHANCE[me.tier] : 0.5
    b.cooked[id] = { mcap: after.mcap, tick, dumpAt: rng.chance(dumps) ? tick + Math.round(devDumpAfter(rng) * (me?.persona.patience ?? 1)) : undefined }
    this.playerEvents.push({ by: m.info.id, id: tick * 100 + 97, tick, time: this.market.time, kind: 'cook', tokenId: id, ticker, text: `${m.info.avatar} ${m.info.name} cooked ${ticker}`, icon: '🍳', tone: 'info' })
    this.botChat(m, trend && rng.chance(0.5) ? `${trend.theme} szn. just cooked $${ticker} 🍳` : this.say('cook', rng, ticker))
    b.lastPost = tick - 900 // always shills its own launch
    this.botPost(m, after, trend ? `${ticker} just launched, ${trend.theme} meta is running 🍳 early` : `${ticker} just launched on pump 🍳 early`)
    // Its snipers and that post's readers are in before the coin is shown to anybody (see launchBlock).
    this.market = launchBlock(this.market, id, rng)
  }

  // ─── Admin ─────────────────────────────────────────────────────────────────
  summary() {
    return {
      code: this.code, hostId: this.hostId, round: { state: this.round.state, mode: this.round.mode, engine: this.round.engine ?? 'classic', tick: this.market.tick, startBalance: this.world ? this.worldStart : undefined },
      players: this.playerList(), emptySince: this.emptySince,
      coins: this.market.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated').sort((a, b) => b.mcap - a.mcap).slice(0, 60)
        .map((t) => ({ id: t.id, ticker: t.ticker, emoji: t.emoji, chain: t.chain, mcap: t.mcap, status: t.status, creator: (t as NetToken).creatorName ?? null })),
      sentiment: this.market.sentiment,
      reports: this.reports.slice(0, 50),
      muted: [...this.members.values()].filter((m) => (m.mutedUntil ?? 0) > Date.now()).map((m) => ({ id: m.info.id, name: m.info.name, until: m.mutedUntil! })),
    }
  }

  /**
   * Admin only: every wallet this player has here, side and dev wallets too, with what each holds. (Players get the
   * public card, `sendCard`: the main wallet and nothing else.) Null: nobody by that id, or no wallet yet.
   */
  adminWallets(playerId: string): AdminWallets | null {
    const m = this.members.get(playerId)
    const w = m?.wallet
    if (!m || !w) return null
    const byId = new Map(this.market.tokens.map((t) => [t.id, t]))
    const accounts = w.accounts ?? []
    const mainId = accounts[0]?.id
    const wallets = accounts.map((a) => {
      const bags = Object.entries(a.positions).filter(([, p]) => p.qty > 0).map(([tokenId, p]) => {
        const t = byId.get(tokenId) as NetToken | undefined
        return { tokenId, ticker: t?.ticker ?? tokenId.split('-')[0], status: t?.status ?? 'gone', qty: p.qty, value: t && live(t) ? p.qty * t.price : 0, cost: p.costBasis, pct: (p.qty / SUPPLY) * 100, own: t?.creatorId === playerId }
      }).sort((x, y) => y.value - x.value)
      const coins = (Object.entries(a.balances) as [Chain, number][]).reduce((sum, [c, n]) => sum + n * nativePrice(this.market, c), 0)
      const devOf = [...this.cooked].filter(([, c]) => c.pid === playerId && c.walletId === a.id).map(([tokenId, c]) => ({ tokenId, ticker: byId.get(tokenId)?.ticker ?? tokenId.split('-')[0], vaultUsd: c.vault * nativePrice(this.market, c.chain) }))
      return {
        id: a.id, name: a.name, emoji: a.emoji, kind: a.id === mainId ? ('main' as const) : a.emoji === DEV_EMOJI ? ('dev' as const) : ('side' as const),
        addr: walletAddress(playerId, a.id, 'sol'), balances: { ...a.balances }, value: coins + bags.reduce((sum, b) => sum + b.value, 0), devOf, bags,
      }
    })
    return round({ id: playerId, name: m.info.name, cash: w.cash, equity: valuePortfolio(w, byId, this.market).equity, startBalance: w.startBalance, wallets }) as AdminWallets
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

  // ─── World leaderboards and bankruptcy ───────────────────────────────────────
  private boardCache: { at: number; rows: BoardRow[] } | null = null

  hall: HallEntry[] = [] // finished World seasons and their winners, newest first
  seasonKey: string | null = null // the season the boards are counting (saved, so a month that ends while the server is down still closes)

  /** Realized profit on each chain's coins (for the SOL / BNB / ETH boards). */
  private realized(m: Member, fills: Trade[]) {
    if (!this.world) return
    for (const f of fills) {
      if (f.side !== 'sell' || !f.pnl) continue
      const chain = f.chain ?? this.market.tokens.find((t) => t.id === f.tokenId)?.chain ?? 'sol'
      const cp = (m.chainPnl ??= { sol: 0, bsc: 0, hood: 0 })
      cp[chain] = (cp[chain] ?? 0) + f.pnl
    }
  }

  /** A dev's record: coins launched, migrations, fees earned (lifetime and this season). */
  private devStat(m: Member, k: 'cooked' | 'migrated' | 'fees', n: number) {
    if (!this.world) return
    const key = worldSeason().key
    const d = (m.dev ??= { cooked: 0, migrated: 0, fees: 0, bestAth: 0, season: { cooked: 0, migrated: 0, fees: 0 } })
    if ((d as DevStats & { key?: string }).key !== key) Object.assign(d, { key, season: { cooked: 0, migrated: 0, fees: 0 } })
    d[k] += n
    d.season[k] += n
  }

  /**
   * Every real player with a wallet here, valued now (kept for a few seconds: it's asked for often). The bots are
   * not on the boards: they launch coins all day and a leaderboard topped by them is nobody's to climb. They are
   * still in the room (who's online, the tape, their wallets), just never ranked.
   */
  private boardRows(force = false, seasonOf?: string): BoardRow[] {
    if (!force && !seasonOf && this.boardCache && Date.now() - this.boardCache.at < 8000) return this.boardCache.rows
    const byId = new Map(this.market.tokens.map((t) => [t.id, t]))
    const week = seasonNumber()
    const today = dayKey()
    const season = seasonOf ?? worldSeason().key // closing a season: count it to the end before anything resets
    // Best coin each dev has launched (from the coins still on the market).
    for (const c of this.cooked.values()) {
      const t = byId.get(this.cookedIdOf(c) ?? '')
      const m = this.members.get(c.pid)
      if (t && m?.dev && t.ath > m.dev.bestAth) Object.assign(m.dev, { bestAth: t.ath, bestTicker: t.ticker })
    }
    const rows: BoardRow[] = []
    for (const m of this.members.values()) {
      if (m.info.spectator || m.info.bot || !m.wallet) continue
      const equity = valuePortfolio(m.wallet, byId, this.market).equity
      // Deposits, gifts and transfers move startBalance, so this is trading profit; losses from before a restart carry over.
      const pnl = equity - m.wallet.startBalance + (m.pnlCarry ?? 0)
      // A new day / week / season (or a new player) starts counting from where they stand now.
      if (m.weekBase?.week !== week) m.weekBase = { week, pnl: m.weekBase ? pnl : 0 }
      if (m.dayBase?.key !== today) m.dayBase = { key: today, pnl: m.dayBase ? pnl : 0 }
      if (m.seasonBase?.key !== season) m.seasonBase = { key: season, pnl: m.seasonBase ? pnl : 0 }
      const cp = m.chainPnl ?? { sol: 0, bsc: 0, hood: 0 }
      if (m.chainBase?.key !== season) m.chainBase = { key: season, sol: m.chainBase ? cp.sol : 0, bsc: m.chainBase ? cp.bsc : 0, hood: m.chainBase ? cp.hood : 0 }
      const cb = m.chainBase
      const dev = m.dev && (m.dev as DevStats & { key?: string }).key !== season ? { ...m.dev, season: { cooked: 0, migrated: 0, fees: 0 } } : m.dev
      rows.push({
        id: m.info.id, name: m.info.name, avatar: m.info.avatar, level: m.info.level, online: m.info.online, verified: m.info.verified,
        equity, pnl, week: pnl - m.weekBase.pnl, day: pnl - m.dayBase.pnl, season: pnl - m.seasonBase.pnl,
        chains: { sol: cp.sol - cb.sol, bsc: cp.bsc - cb.bsc, hood: cp.hood - cb.hood },
        ...(dev ? { dev: { cooked: dev.cooked, migrated: dev.migrated, fees: dev.fees, bestAth: dev.bestAth, bestTicker: dev.bestTicker, season: dev.season } } : {}),
        ...(m.trophies?.length ? { trophies: m.trophies.slice(-6) } : {}),
        restarts: m.restarts ?? m.brain?.busts ?? 0,
      })
    }
    if (!seasonOf) this.boardCache = { at: Date.now(), rows }
    return rows
  }

  private cookedIdOf(c: Cooked) {
    for (const [id, x] of this.cooked) if (x === c) return id
    return undefined
  }

  /** What each list ranks by. */
  private static boardValue(list: BoardList, r: BoardRow): number {
    switch (list) {
      case 'worth': return r.equity
      case 'day': return r.day
      case 'week': return r.week
      case 'season': return r.season
      case 'sol': case 'bsc': case 'hood': return r.chains[list]
      case 'dev': return r.dev ? r.dev.season.fees + r.dev.season.migrated * 1000 + r.dev.season.cooked : -Infinity
    }
  }

  /**
   * A new month: close the season. Its top traders (season profit, and each chain), top dev and richest player get
   * a trophy that stays next to their name, and the season goes into the Hall of Fame.
   */
  private closeSeasonIfDue() {
    if (!this.world) return
    const now = worldSeason()
    if (this.seasonKey === null) this.seasonKey = now.key
    if (this.seasonKey === now.key) return
    const ending = worldSeason(new Date(Date.parse(`${this.seasonKey}-15T00:00:00Z`)))
    const rows = this.boardRows(true, this.seasonKey) // the ending season's numbers (its bases are still in place)
    const lists: [BoardList, string][] = [['season', '🏆'], ['sol', '◎'], ['bsc', '◆'], ['hood', '⟠'], ['dev', '🍳'], ['worth', '💰']]
    const winners: HallEntry['winners'] = []
    for (const [list, icon] of lists) {
      const sorted = rows.filter((r) => Room.boardValue(list, r) > 0).sort((a, b) => Room.boardValue(list, b) - Room.boardValue(list, a))
      sorted.slice(0, list === 'season' ? 3 : 1).forEach((r, i) => {
        winners.push({ list, name: r.name, avatar: r.avatar, value: Room.boardValue(list, r) })
        const m = this.members.get(r.id)
        if (m) m.trophies = [...(m.trophies ?? []), `${list === 'season' ? ['🏆', '🥈', '🥉'][i] : icon} S${ending.n}`]
      })
    }
    this.hall = [{ n: ending.n, name: ending.name, winners }, ...this.hall].slice(0, 24)
    this.seasonKey = now.key
    this.boardCache = null
    this.broadcast({ t: 'notice', text: `🏆 Season ${ending.n} (${ending.name}) is over! Winners are in the Hall of Fame. Season ${now.n} starts now.` } as never)
  }

  private sendBoard(me: Member, list: BoardList = 'worth') {
    if (!this.world) return
    this.closeSeasonIfDue()
    const rows = this.boardRows()
    const pick = ['worth', 'day', 'week', 'season', 'sol', 'bsc', 'hood', 'dev'].includes(list) ? list : 'worth'
    const ranked = [...rows].filter((r) => pick !== 'dev' || r.dev).sort((a, b) => Room.boardValue(pick, b) - Room.boardValue(pick, a))
    const mine = ranked.find((r) => r.id === me.info.id) ?? rows.find((r) => r.id === me.info.id)
    const next = (me.lastRestart ?? 0) + WORLD_RESTART_EVERY_MS
    const s = worldSeason()
    const msg: BoardMsg = {
      t: 'board', list: pick, week: seasonNumber(), season: { n: s.n, name: s.name, endsAt: s.endsAt }, total: ranked.length, rows: round(ranked.slice(0, 100)) as BoardRow[],
      // (Seasons closed while bots were still ranked have bot winners saved in them: not shown.)
      hall: this.hall.map((h) => (h.winners.some((x) => x.bot) ? { ...h, winners: h.winners.filter((x) => !x.bot) } : h)),
      ...(mine ? { me: { row: round(mine) as BoardRow, rank: ranked.indexOf(mine) + 1, restartAt: next > Date.now() ? next : null } } : {}),
    }
    this.sendTo(me.info.id, msg)
  }

  /**
   * One player's public card, for anyone in the World who asks (a watching guest too): how they stand, and what could
   * be read off the chain, which is their MAIN wallet's bags and latest trades. Side wallets stay hidden, as on the
   * tape. It is built from the wallet the server holds, not from what the player's game reports, so it works for a
   * player who is off line and a modified game can't dress it up.
   */
  private sendCard(me: Member, id: unknown) {
    if (!this.world || typeof id !== 'string' || id.length > 64) return
    const now = Date.now()
    if (now - (me.cardAt ?? 0) < CARD_EVERY_MS) return // a held-down key must not turn into work (the game asks again)
    me.cardAt = now
    const m = this.members.get(id)
    if (!m || m.info.spectator || !m.wallet) return this.sendTo(me.info.id, { t: 'card', id, card: null })
    const byId = new Map(this.market.tokens.map((t) => [t.id, t]))
    const rows = this.boardRows()
    const row = rows.find((r) => r.id === id) // (a bot has none: it is on no board)
    const equity = row?.equity ?? valuePortfolio(m.wallet, byId, this.market).equity
    const main = m.wallet.accounts?.[0]
    const mainId = main?.id ?? 'w-main'
    const worth = (h: { tokenId: string; qty: number }) => h.qty * (byId.get(h.tokenId)?.price ?? 0)
    const holdings = Object.values(main?.positions ?? m.wallet.positions).map((p) => ({ tokenId: p.tokenId, qty: p.qty, cost: p.costBasis, openedAt: p.openedAt })).sort((a, b) => worth(b) - worth(a)).slice(0, CARD_ROWS)
    const sells = m.wallet.trades.filter((t) => t.side === 'sell')
    const card: PlayerCard = {
      id, name: m.info.name, avatar: m.info.avatar, level: m.info.level, online: m.info.online, ...(m.info.verified ? { verified: true } : {}), ...(m.info.bot ? { bot: true } : {}),
      equity, pnl: row?.pnl ?? equity - m.wallet.startBalance + (m.pnlCarry ?? 0), season: row?.season ?? 0, day: row?.day ?? 0,
      ...(row ? { rank: [...rows].sort((a, b) => b.equity - a.equity).indexOf(row) + 1, ranked: rows.length } : {}),
      trades: m.wallet.trades.length, sells: sells.length, wins: sells.filter((t) => (t.pnl ?? 0) > 0).length,
      holdings,
      recent: m.wallet.trades.filter((t) => (t.walletId ?? mainId) === mainId).slice(0, CARD_ROWS).map((t) => ({ id: t.id, time: t.time, tokenId: t.tokenId, ticker: t.ticker, emoji: t.emoji, hue: t.hue, side: t.side, usd: t.value, ...(t.pnl !== undefined ? { pnl: t.pnl } : {}) })),
      ...(row?.trophies ? { trophies: row.trophies } : {}), ...(row?.dev ? { dev: row.dev } : {}), restarts: row?.restarts ?? m.restarts ?? m.brain?.busts ?? 0,
    }
    this.sendTo(me.info.id, { t: 'card', id, card: round(card) as PlayerCard })
  }

  /** Broke in the World: wipe the wallet and start over small. Only when nearly out, and once a day. */
  private bankrupt(me: Member) {
    const say = (message: string) => this.sendTo(me.info.id, { t: 'error', message })
    const w = this.walletOf(me)
    if (!this.world || !w) return say('Restarts are only for the World')
    const equity = valuePortfolio(w, new Map(this.market.tokens.map((t) => [t.id, t])), this.market).equity
    if (equity >= WORLD_BROKE_BELOW) {
      this.sendWallet(me)
      return say(`A restart is for when you're broke: your net worth has to be under $${WORLD_BROKE_BELOW}`)
    }
    const wait = (me.lastRestart ?? 0) + WORLD_RESTART_EVERY_MS - Date.now()
    if (wait > 0) {
      this.sendWallet(me)
      return say(`You can restart once every 24 hours. Next one in ${Math.ceil(wait / 3600_000)}h`)
    }
    me.pnlCarry = (me.pnlCarry ?? 0) + (equity - w.startBalance) // what you lost stays on your record
    me.wallet = freshWallet(WORLD_RESTART_BALANCE, me.layout)
    me.cashback = undefined
    me.lastRestart = Date.now()
    me.restarts = (me.restarts ?? 0) + 1
    for (const c of this.cooked.values()) if (c.pid === me.info.id) c.vault = 0
    this.boardCache = null
    this.sendTo(me.info.id, { t: 'wallet', ack: me.ack, state: { ...walletStateOf(me.wallet), cashback: { sol: 0, bsc: 0, hood: 0 } }, reset: true, note: `Fresh start: you're back in with $${WORLD_RESTART_BALANCE.toLocaleString('en-US')}. Next restart available in 24 hours.` })
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
      const start = this.startBalanceOf(m)
      m.wallet = freshWallet(start, m.layout)
      m.cashback = undefined
      m.weekBase = undefined
      m.pnlCarry = undefined
      this.boardCache = null
      for (const c of this.cooked.values()) if (c.pid === m.info.id) c.vault = 0
      if (m.brain) {
        // A bot starts over too: fresh memory, and its public wallet shows the reset.
        m.brain.entries = {}
        m.brain.cooked = {}
        this.wallets = this.wallets.map((w) => (w.id === m.info.id ? { ...w, cash: start, startValue: start, positions: {} } : w))
      }
      m.info = { ...m.info, equity: start, startEquity: start, trades: 0, wins: 0 }
      this.sendTo(m.info.id, { t: 'wallet', ack: m.ack, state: { ...walletStateOf(m.wallet), cashback: { sol: 0, bsc: 0, hood: 0 } }, reset: true })
      n++
    }
    if (n) this.playersDirty = true
    return n
  }

  /**
   * Admin: start the World's players over. Every wallet goes back to the starting balance (see resetWallets), the
   * coins real players launched leave the market (the bots' coins and the simulated market run on), and the World's
   * records start from zero: the boards, profit history, coin-maker stats, trophies, restarts and the hall of fame.
   * Accounts, XP, levels, followers and chat are not touched. Returns what it did.
   */
  resetWorld(): { wallets: number; coins: number } | null {
    if (!this.world || this.round.state !== 'running') return null
    const wallets = this.resetWallets()
    const bot = (pid?: string) => !!pid && !!this.members.get(pid)?.brain
    const gone = new Set<string>()
    for (const [id, c] of this.cooked) if (!bot(c.pid)) gone.add(id)
    for (const t of this.market.tokens as NetToken[]) if (t.creatorId && !bot(t.creatorId)) gone.add(t.id)
    if (gone.size) {
      this.market = { ...this.market, tokens: this.market.tokens.filter((t) => !gone.has(t.id)) }
      for (const id of gone) {
        candleStore.delete(id)
        this.cooked.delete(id)
        this.bots.delete(id)
        this.pending.delete(id)
        this.freshIds.delete(id)
      }
    }
    for (const m of this.members.values()) {
      if (m.info.spectator) continue
      m.weekBase = m.dayBase = m.seasonBase = m.chainBase = undefined
      m.chainPnl = undefined
      m.dev = undefined
      m.trophies = undefined
      m.lastRestart = undefined
      m.restarts = undefined
      m.cbVolume = undefined
      m.cooks = 0
      m.lastCookTick = undefined
      m.cookTicks = undefined
      m.copyBook = undefined
      if (m.focus && gone.has(m.focus)) m.focus = undefined
      if (m.protect.some((id) => gone.has(id))) m.protect = m.protect.filter((id) => !gone.has(id))
    }
    this.hall = []
    this.boardCache = null
    this.playersDirty = true
    return { wallets, coins: gone.size }
  }

  grant(playerId: string, amount: number, asset: 'usd' | 'sol' | 'bsc' | 'hood' = 'usd') {
    const m = this.members.get(playerId)
    if (!m) return false
    const w = this.walletOf(m)
    // A gift counts as money put in (like a deposit), so it doesn't show up as trading profit on the leaderboards.
    if (w) {
      const usd = asset === 'usd' ? amount : amount * nativePrice(this.market, asset)
      const next = addFunds(w, asset, amount)
      m.wallet = { ...next, startBalance: next.startBalance + usd }
    }
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
    // Turned into bytes once for everybody (as a string, every socket would encode it again). Still a text message.
    const data = Buffer.from(JSON.stringify(msg))
    for (const m of this.members.values()) if (m.ws && m.ws.readyState === 1) m.ws.send(data, { binary: false })
  }
}
