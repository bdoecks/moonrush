// Core domain types for the MOONRUSH simulation. Everything here is fictional game state.

export type Chain = 'sol' | 'bsc' | 'hood'
export type PadId = 'pump' | 'bonk' | 'stonk' | 'bags' | 'mayhem' | 'four' | 'flap' | 'pons' | 'long'
export interface Tax {
  buy: number // fraction, e.g. 0.03
  sell: number
}
/** A dev-wallet trade, kept for chart markers. */
export interface DevTrade {
  time: number
  side: 'buy' | 'sell'
  usd: number
}
export interface NativeQuote {
  price: number // USD per native coin (simulated)
  open: number // price at the start of the session, for change %
}

export type Timeframe = '1s' | '5s' | '30s' | '1m' | '5m' | '15m' | '1h' | '4h'
export const TIMEFRAMES: Timeframe[] = ['1s', '5s', '30s', '1m', '5m', '15m', '1h', '4h']
export const TF_SECONDS: Record<Timeframe, number> = { '1s': 1, '5s': 5, '30s': 30, '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 }

/** Stats windows for volume / txns (1h lives in Token.volume / buys / sells). */
export type Win = '1m' | '5m' | '1h' | '24h'
export interface WinStats {
  v1m: number
  v5m: number
  v24h: number
  b1m: number
  s1m: number
  b5m: number
  s5m: number
  b24h: number
  s24h: number
}

export interface Candle {
  time: number // sim seconds, aligned to timeframe
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Regime = 'sideways' | 'accumulation' | 'pump' | 'moon' | 'distribution' | 'dump' | 'recovery' | 'rug'
export type TokenStatus = 'bonding' | 'graduated' | 'rugged' | 'dead'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME'
export type Archetype = 'bluechip' | 'runner' | 'grinder' | 'bleeder' | 'chaotic' | 'rugger' | 'sleeper'

export interface TapeTrade {
  id: number
  time: number
  side: 'buy' | 'sell'
  usd: number
  price: number
  wallet: string
  tag?: 'whale' | 'smart' | 'sniper' | 'dev' | 'you' | 'kol' | 'agent'
  walletId?: string // set when the trade came from a simulated trader wallet
  pid?: string // multiplayer: the player who made this trade (only for their public main wallet)
  addr?: string // multiplayer: the player wallet's address (side wallets trade under this alone)
}

// ─── Copy trading ────────────────────────────────────────────────────────────
export type WalletStyle = 'smart' | 'sniper' | 'kol' | 'whale' | 'degen' | 'fresh'

export interface WalletPosition {
  qty: number
  cost: number
  openedTick: number
  tookProfit?: boolean
}

export interface WalletTrade {
  id: number
  tick: number
  time: number
  tokenId: string
  ticker: string
  emoji: string
  hue: number
  side: 'buy' | 'sell'
  usd: number
  qty: number
  price: number
  pnl?: number
  pnlPct?: number
  mcap?: number // token market cap right after the fill
  action?: WalletActionKind
}

export type WalletActionKind = 'first' | 'more' | 'partial' | 'all'

// ─── Track: social feed, wallet labels, alerts ───────────────────────────────
export interface SocialAccount {
  id: string
  platform: 'x' | 'tg'
  name: string
  handle: string
  avatar: string
  followers: number
  kind: 'kol' | 'news' | 'caller' | 'poster'
  walletId?: string // X accounts belonging to KOL wallets
}

/** A real player posting on the (simulated) X timeline. */
export interface PostAuthor {
  name: string
  handle: string
  avatar: string
  followers: number
  rep: number // 0..100 caller reputation
  pid?: string // multiplayer: who posted it
}

/** Your side of the timeline: followers and caller rep grow (or shrink) with how your calls play out. */
export interface SocialProfile {
  followers: number
  rep: number // 0..100
  posts: number
  lastPostTick: number
  calls: { postId: number; tokenId: string; ticker: string; tick: number; mcapAtPost: number; peak: number; likes: number; settled?: boolean; x?: number }[]
}

export interface SocialPost {
  id: number
  tick: number
  time: number
  accountId: string // 'player' for posts written by players (see `author`)
  author?: PostAuthor
  likes?: number
  rts?: number
  replies?: string[]
  buyers?: number // bots who aped the call
  text: string
  tokenId?: string
  ticker?: string
  mcapAtPost?: number
  peakMcap?: number
  isCall: boolean
}

export interface WalletLabel {
  label?: string
  notify: boolean // alerts for this wallet at all
  buys?: boolean // alert on its buys (default on)
  sells?: boolean // alert on its sells (default on)
  group?: string // tracker group name
}

/** GMGN-style wallet tracker settings: which trades show in the feed and which ones ping you. Kept across rounds. */
export interface TrackerSettings {
  // Feed filters
  chains: Chain[] // empty = every chain
  side: 'all' | 'buy' | 'sell'
  minUsd: number // hide trades smaller than this
  minMcap: number | null
  maxMcap: number | null
  maxAgeMin: number | null // hide coins older than this (minutes)
  firstBuyOnly: boolean // buys: only a wallet's first buy of a coin
  group: string // 'all' or a group name
  groups: string[]
  // Alerts
  alerts: boolean
  alertBuys: boolean
  alertSells: boolean
  alertMinUsd: number
  alertFirstBuyOnly: boolean
  alertUseFilters: boolean // alerts also obey the feed filters above
  alertPopup: boolean
  alertSound: boolean
  alertPosition: 'bottom-right' | 'top-right'
  clusterMin: number // flag a coin once this many tracked wallets hold it (0 = off)
}

// ─── Rewards ─────────────────────────────────────────────────────────────────
export interface Friend {
  id: string
  name: string
  avatar: string
  joinedAt: number // ms timestamp
  activity: number // how actively they trade
  volume: number
  fees: number
  earned?: number // your commission from this friend
}

export interface RewardClaim {
  id: string
  time: number // ms timestamp
  kind: 'commission' | 'cashback' | 'checkin'
  amount: number // USD value (or XP)
  paidAs: 'cash' | 'xp' | 'coin'
  chain?: Chain // cashback paid in a chain coin
  native?: number // chain-coin amount paid
}

/** GMGN / Axiom-style trading cashback: part of every fill's fee comes back in that chain's coin. */
export interface CashbackState {
  pending: Record<Chain, number> // unclaimed, in chain coin; clears when a new round starts
  volume: number // lifetime trading volume (sets your tier)
  roundVolume: number
  roundUsd: number // earned this round, USD at the time of each fill
  lifetimeUsd: number // claimed, all time
  auto: 'off' | 'coin' | 'usdc' // pay straight to your wallet as each fill lands
}

export interface RewardsState {
  code: string
  friends: Friend[]
  lastShareTick: number
  commissionPending: number
  commissionTotal: number
  cashbackClaimed: number // legacy (USD cashback before chain-coin cashback)
  cashback?: CashbackState
  checkIn: { lastDate: string; streak: number }
  history: RewardClaim[]
}

export type AlertType = 'mcAbove' | 'mcBelow' | 'pctUp' | 'pctDown'
export interface PriceAlert {
  id: string
  tokenId: string
  ticker: string
  emoji: string
  hue: number
  type: AlertType
  value: number // USD for mc alerts, % for pct alerts
  baseMcap: number // MC when created (pct alerts measure from here)
  createdTick: number
  triggeredTick?: number
}

/** Seeded pre-session history so the board is populated from the start. */
export interface WalletHistory {
  pnl24h: number
  pnl7d: number
  wins: number
  losses: number
  buys: number
  sells: number
  volume: number
  inflow: number
}

export interface SimWallet {
  id: string
  name: string
  avatar: string
  style: WalletStyle
  skill: number // 0..1: how well it reads the market
  cash: number
  startValue: number
  positions: Record<string, WalletPosition>
  trades: WalletTrade[] // most recent first
  base: WalletHistory
  live: WalletHistory // accrued this session (pnl24h/pnl7d both hold realized)
  lastActive: number // tick
  rival?: string // leaderboard player id whose on-chain wallet this is
}

/** One wallet trade in a tick, used to trigger copies. */
export interface WalletAction {
  walletId: string
  tokenId: string
  side: 'buy' | 'sell'
  usd: number
  fraction: number // for sells: share of the wallet's position sold
  kind: WalletActionKind
  mcap: number
}

/** GMGN-style sniper task: auto-buys brand-new launches that match its rules, then manages TP / SL. */
export interface SniperTask {
  id: string
  name: string
  enabled: boolean
  chain: Chain
  pads: PadId[] // launchpads to watch (empty = every pad on the chain)
  keywords: string // comma-separated; empty = any name
  exclude: string // comma-separated names to skip
  maxDevPct: number | null // skip if the dev holds more than this %
  requireSocial: boolean // skip coins with no X / TG / website
  skipTax: boolean // skip tax coins
  amount: number // chain coin per wallet per snipe
  walletIds: string[] // wallets that snipe (empty = your selected wallets)
  slot: number // P1/P2/P3 trade settings (fees, slippage, anti-MEV)
  maxSnipes: number // stop after this many
  tp: number | null // take profit at +% from entry
  sl: number | null // stop loss at -%
  createdTick: number
  holdings: Record<string, { qty: number; cost: number; walletIds: string[] }> // bags opened by this task
  stats: { snipes: number; spent: number; realized: number; skipped: number; sells: number }
}

export interface CopyConfig {
  id: string
  walletId: string
  mode: 'fixed' | 'ratio'
  amount: number // USD per buy (fixed) or multiplier of their size (ratio)
  maxPerTrade: number
  budget: number
  copySells: boolean
  tp: number | null // take profit %, e.g. 50
  sl: number | null // stop loss %, e.g. 25
  skipExtreme: boolean
  minLiquidity: number
  paused: boolean
  createdTick: number
  holdings: Record<string, number> // qty bought through this copy, per token
  stats: { buys: number; sells: number; spent: number; realized: number; skipped: number }
}

/** Hidden simulation variables — the player never sees these directly. */
/** Realistic engine: a pump.fun coin on its curve is priced purely by simulated order flow. */
export interface FlowState {
  q: number // hidden quality drawn at launch (heavy-tailed: most coins ~nothing, a few catch fire)
  att: number // attention right now: expected trader arrivals per second
  ema: number // slow price average (holders take profit when price runs above it)
  lastTrade: number // market time of the last trade
  koth?: boolean // reached "king of the hill"
}

export interface TokenSim {
  archetype: Archetype
  regime: Regime
  regimeTicks: number
  drift: number
  volMult: number
  anchor: number // slow EMA of log price, for mean reversion
  meanRev: number
  beta: number // sensitivity to market-wide sentiment
  pressure: number // decaying extra buy(+)/sell(-) pressure from events and flow
  volBoost: number // decaying extra volatility multiplier
  rugAt: number | null // tick at which a scheduled rug executes
  baseTurnover: number
  flow?: FlowState // realistic engine only
}

export interface Token {
  id: string
  chain: Chain
  pad: PadId // launchpad it launched on
  tax?: Tax // buy/sell tax (tax pads only)
  devTrades?: DevTrade[] // dev wallet buys/sells, newest first
  win?: WinStats // rolling 1m / 5m / 24h volume and txns
  name: string
  ticker: string
  emoji: string
  hue: number
  createdAt: number // sim seconds
  price: number
  supply: number
  mcap: number
  ath: number // ath mcap
  liquidity: number
  volume: number // rolling 1h USD volume
  buys: number // rolling 1h counts
  sells: number
  holders: number
  momentum: number // -1..1 raw
  momentumScore: number // 0..100
  hype: number // 0..100 social activity
  volatility: number // base per-tick sigma
  top10Pct: number
  devPct: number
  snipers: number
  insidersPct: number
  rugProb: number // per-tick base rug hazard (0 = can't rug)
  riskScore: number // 0..100
  riskLevel: RiskLevel
  status: TokenStatus
  bondingProgress: number // 0..100
  graduatedAt?: number
  diedAt?: number
  change: { '1m': number; '5m': number; '1h': number; '24h': number }
  tape: TapeTrade[]
  sim: TokenSim
  // Set on tokens the player cooked on the Cooking page.
  creator?: 'you'
  creatorId?: string // multiplayer: the player who cooked it
  creatorName?: string
  vampOf?: { id: string; ticker: string } // a copycat launch of this coin
  creatorFees?: number // USD of creator fees this coin has generated (all trading, at its launchpad's creator rate)
  feesPaid?: number // USD of all trading fees paid on this coin so far (protocol + creator + LP): pump.fun / Axiom's "Global Fees Paid"
  volMark?: number // volume at the end of the last tick (to catch trades that happen between ticks)
  image?: string // custom icon: small data URL or an https image link
  narrative?: Narrative
  description?: string
  socials?: Socials
  // Dev tools on tokens you cooked (see game/devTools.ts).
  bundlePct?: number // share of supply held by your bundle wallets
  bundleWallets?: number
  bundleFlagged?: boolean // sleuths linked the bundle wallets; shows in the audit
  washVol?: number // rolling 1h USD volume from your volume bot
  washFlagged?: boolean // flagged for wash trading
}

export type Narrative = 'dogs' | 'cats' | 'frogs' | 'ai' | 'food' | 'space' | 'absurd' | 'retro'
export interface Socials {
  x: boolean
  tg: boolean
  web: boolean
}
export type LaunchStyle = 'fair' | 'hyped' | 'stealth'

export interface CookSpec {
  chain: Chain
  pad: PadId
  tax: Tax // only used on tax pads
  image?: string // custom token picture (data URL or https link)
  name: string
  ticker: string
  emoji: string
  hue: number
  description: string
  narrative: Narrative
  socials: Socials
  style: LaunchStyle
  marketing: number // USD spent on (fictional) shilling
  devBuy: number // chain-coin dev buy at launch
  bundle: BundleSpec
  devWallet?: string // which of your wallets deploys (the dev); defaults to your primary
  sideBuys?: { walletId: string; amount: number }[] // other wallets buying at launch (chain coin each)
  sideDelay?: boolean // spread side buys over the first minute instead of the launch block
  vampOf?: string // id of the live coin this launch copies ("vamping" it to ride its hype)
}

export interface BundleSpec {
  wallets: number // 0 = off
  perWallet: number // chain coin per wallet
  stagger: boolean // spread buys over a few blocks: harder to spot, costs extra tips
}

export interface VolumeBot {
  on: boolean
  rate: number // USD of volume per simulated minute
  budget: number // USD you're willing to burn; the bot stops when it's spent
  spent: number // USD burned on fees and price impact
  volume: number // USD of fake volume generated
  startedTick: number
}

export interface LaunchRecord {
  tokenId: string
  ticker: string
  name: string
  emoji: string
  pad?: PadId
  image?: string
  hue: number
  launchedTick: number
  launchedTime: number
  spent: number // launch fee + marketing
  fees: number // creator fees earned (USD, all time)
  unclaimed?: number // creator fees waiting in the vault, in the coin's chain coin (claim them to your dev wallet)
  peakMcap: number
  lastMcap: number
  status: TokenStatus
  graduated: boolean
  chain?: Chain
  bundleQty?: number // tokens still held by your bundle wallets (part of your dev wallet's position)
  devWallet?: string // wallet that deployed; only it (and linked wallets) count as the dev
  linkedWallets?: string[] // side wallets sleuths have tied to the dev
  bundleWallets?: number
  bot?: VolumeBot
  airdropped?: { qty: number; wallets: number; count: number } // everything you've airdropped of this coin
}

export interface MarketState {
  tick: number
  time: number // sim seconds (unix-like)
  sentiment: number // -1..1 market-wide mood
  sentimentTrend: number
  tokens: Token[]
  seed: number
  nextTradeId: number
  launched: number
  native: Record<Chain, NativeQuote>
  meta?: Narrative // the hot narrative right now
  metaUntil?: number // tick when the meta rotates
  /** classic = fast-forward clock (6s per tick) and regime-driven prices; realistic = real-time clock and
   *  order-flow-driven pump.fun coins with real launch rates and trade sizes. */
  engine?: MarketEngine
  /** Buys from people who read a player's call, landing over the next few seconds; also airdrop recipients
   *  dumping what a dev gave them (`side: 'sell'`, `qty` tokens). */
  shillQueue?: { tokenId: string; atTick: number; usd: number; wallet: string; side?: 'sell'; qty?: number }[]
}

export type MarketEngine = 'classic' | 'realistic'

export type EventKind =
  | 'trending' | 'whale' | 'momentum' | 'liquidity' | 'panic' | 'viral' | 'volatility'
  | 'smartmoney' | 'devsell' | 'kol' | 'graduation' | 'rug' | 'launch' | 'marketup' | 'marketdown' | 'meta' | 'cook' | 'bundle' | 'wash' | 'airdrop'

export interface MarketEvent {
  id: number
  tick: number
  time: number
  kind: EventKind
  tokenId?: string
  ticker?: string
  text: string
  icon: string
  tone: 'up' | 'down' | 'warn' | 'info'
  by?: string // multiplayer: the player whose action this was (their own browser already showed it)
  mcap?: number // the coin's market cap when it happened
}

export interface Position {
  tokenId: string
  qty: number
  costBasis: number // total USD spent incl. fees for current qty
  avgEntry: number // cost per token incl. fees
  openedAt: number // tick
  realized: number // realized P&L on this position so far
}

export interface Trade {
  id: number
  tick: number
  time: number
  tokenId: string
  ticker: string
  emoji: string
  hue: number
  side: 'buy' | 'sell'
  price: number // avg fill price
  qty: number
  value: number // gross USD
  fee: number
  slippage: number // fraction
  pnl?: number // realized, sells only
  pnlPct?: number
  holdTicks?: number
  status: 'FILLED' | 'RUGGED'
  via?: string // copy-trade source wallet name
  gas?: number // USD of priority fee + tip
  walletId?: string // which of your wallets traded
  mev?: number // USD lost to a sandwich
  lag?: number // fraction the price moved against you before the fill
  image?: string
  chain?: Chain
  native?: number // chain coin spent (buy) or received after fees (sell)
}

/** One of your wallets. USD cash is a shared bank; chain coins and positions live per wallet. */
export interface Account {
  id: string
  name: string
  emoji: string
  balances: Record<Chain, number>
  positions: Record<string, Position>
  createdAt: number // ms timestamp
  fundedBy?: Record<string, number> // wallet id → tick it last sent this wallet coins (makes it easier to link)
}

export interface Portfolio {
  cash: number // USD
  balances: Record<Chain, number> // native coins across all wallets (derived from accounts)
  startBalance: number
  positions: Record<string, Position> // all wallets combined (derived from accounts)
  accounts?: Account[] // your wallets (GMGN-style multi-wallet); each holds its own chain coins and bags
  active?: string[] // wallet ids selected for trading (first = primary)
  trades: Trade[]
  realized: number
  feesPaid: number
  equityHistory: { tick: number; time: number; equity: number }[]
  peakEquity: number
  maxDrawdown: number // fraction
  dayStartEquity: number
  tradedTokens: string[]
}

export type GameMode = 'practice' | 'challenge' | 'arena' | 'hardcore'

export interface ModeConfig {
  id: GameMode
  name: string
  tagline: string
  startBalance: number
  durationTicks: number | null
  target?: number
  rugMult: number
  unlockLevel: number
}

export interface Challenge {
  id: string
  title: string
  desc: string
  xp: number
  target: number
  progress: number
  done: boolean
  failed?: boolean
  unit?: '%' | ''
}

export interface Player {
  id: string
  name: string
  avatar: string
  level: number
  startEquity: number
  equity: number
  trades: number
  wins: number
  skill: number
  isYou?: boolean
  seasonPoints?: number // real players (multiplayer): their actual season points; simulated rivals don't have any
  real?: boolean // a real player in your room (not a simulated rival)
  holdings?: { tokenId: string; qty: number; cost: number; openedAt: number }[] // real players: what their public main wallet holds
}

export type ChartStyle = 'candles' | 'line'
export type Accent = 'acid' | 'plasma' | 'vapor' | 'gold' | 'prism'

export interface Settings {
  sound: boolean
  animations: boolean
  compact: boolean
  chartStyle: ChartStyle
  notifications: boolean
  portfolioUnit?: 'usd' | Chain // what the top bar shows your portfolio / PnL in
  markerStyle?: 'avatars' | 'tags' | 'bubbles' // chart trade markers: GMGN/Axiom tags beside the candle, or bubbles on it
  quickBuyOpen?: boolean // GMGN: open the coin's page after a quick buy (off: stay on the list)
  eventToasts?: boolean // market-event pop-ups (parabolic, whales, market moves…); off still warns when your own bag rugs
  practiceBalance: number
  engine?: MarketEngine // market engine for your next solo round (Classic / Realistic pump.fun)
  speed: 1 | 2 | 4
  accent: Accent
  quickSlot: number // P1/P2/P3 quick-buy slot (amount per chain comes from CHAINS[chain].quick)
  presetIdx: number // active P1/P2/P3 slot in the trade panel / instant trade
  buyPresets: Record<Chain, number[][]> // native-coin amounts per chain, per slot
  sellPresets: number[][] // % of position per slot
  autoSwap: boolean // top up a chain's coin from USD when a buy is short
  tradeSettings: TradeSettings // slippage / priority fee / tip / anti-MEV per chain, side and P slot
  instant: InstantPrefs // Instant Trade units and value presets
  trackerDock?: TrackerDockPrefs // GMGN-style side dock with the wallet + social trackers
}

export interface TrackerDockPrefs {
  open: boolean
  side: 'left' | 'right'
  width: number // px
  split: number // share of the height the wallet tracker gets (0..1)
  wallet: boolean // wallet section expanded
  social: boolean // social section expanded
  liveUrl?: string // feed server for real X posts (Server-Sent Events)
}

/** GMGN-style execution settings for one P slot and side. Fees are in the chain's coin. */
export interface TradeSetting {
  slippage: number | null // max slippage %, null = auto
  priority: number // priority fee / gas
  tip: number // validator / builder tip
  antiMev: boolean // private relay: no sandwiches, slightly slower
}
export type TradeSettings = Record<Chain, { buy: TradeSetting[]; sell: TradeSetting[] }>

/** GMGN-style Instant Trade units: buy in the chain coin or USD, sell by %, chain coin or USD. */
export interface InstantPrefs {
  buyUnit: 'native' | 'usd'
  sellUnit: 'pct' | 'native' | 'usd'
  statsUnit: 'usd' | 'native' // Bal / Bought / Sold / PnL
  pnlUnit: 'value' | 'pct'
  pnlScope?: 'total' | 'position' // every trade on the coin this round, or only the position you hold now
  buyUsd: number[][] // USD buy presets per P slot
  sellUsd: number[][] // USD sell presets per P slot
  sellNative: Record<Chain, number[][]> // chain-coin sell presets per P slot
  showHoldings?: boolean // GMGN: list each of your wallets with its bag of this coin on the Trade tab
}

export interface Profile {
  xp: number
  bestReturnPct: number
  runsPlayed: number
  lifetimeTrades: number
  daily?: import('../game/daily').Daily // realized PnL per real calendar day (portfolio PnL calendar)
  season?: import('../game/season').SeasonState // this week's ranked season
  badges?: import('../game/season').SeasonBadge[] // tiers reached in past seasons, newest first
  social?: SocialProfile // your X presence (followers, rep, calls)
}

export interface Toast {
  id: number
  title: string
  body?: string
  tone: 'up' | 'down' | 'warn' | 'info' | 'xp'
  icon?: string
  tokenId?: string // shows a quick-buy button; clicking the toast opens the coin
  kind?: 'tracker' | 'event' // wallet tracker alert / market event: share the alert stack the tracker settings place
}

export type RunStatus = 'select' | 'running' | 'finished'
