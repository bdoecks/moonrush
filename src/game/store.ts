import { create } from 'zustand'
import type { SocialProfile, CashbackState, SniperTask, Trade, VolumeBot, Chain, Challenge, CookSpec, CopyConfig, GameMode, LaunchRecord, MarketEvent, MarketState, Player, Portfolio, Profile, RunStatus, Settings, PriceAlert, RewardClaim, RewardsState, SimWallet, SocialPost, Toast, Token, TrackerSettings, WalletAction, WalletActionKind, WalletLabel } from '../types'
import { clamp, Rng } from '../utils/rng'
import { useFlags } from './flags'
import { restoreCharts, saveCharts } from './chartSave'
import { fmtCompact, fmtPct, fmtUsd } from '../utils/format'
import { fakeAddress } from '../utils/address'
import { playSfx, type Sfx } from '../utils/sound'
import { load, remove, save } from '../utils/storage'
import { createChallenges, evaluateChallenges, type ChallengeContext } from './challengeEngine'
import { DAILY_SWEEP_XP, foldDailies } from './dailyChallenges'
import { newTrades } from './daily'
import { rollEvents } from './eventEngine'
import { createRivals, tickRivals } from './leaderboardEngine'
import { freshSeason, isRanked, placementPoints, seasonNumber, tierFor, type SeasonState } from './season'
import { candleStore, COOK_FEE, cookAllowance, cookToken, COOK_COOLDOWN_TICKS, GRAD_BONUS, MAX_COOKS_PER_ROUND, createMarket, migrateMarket, rebuildCandles, secPerTickOf, setClock, SIM_SEC_PER_TICK, SUPPLY, tickMarket, walletName } from './marketEngine'
import { AIRDROP_MAX_WALLETS, airdropFeePerWallet, planAirdrop, type AirdropTarget, BUNDLE_MAX_WALLETS, BUNDLE_WALLET_FEE, bundleDetectChance, botTickCost, flagBundle, runBotTick, sleuthBundle, splitBag, STAGGER_FEE } from './devTools'
import { newPortfolio, portfolioStats, snapshot, valuePortfolio } from './portfolioEngine'
import { lengthTicks, levelFromXp, modeTagline, MODES, titleFor, UNLOCKS, type RoundLength } from './progression'
import { accountOf, activeAccounts, commitView, ensureAccounts, makeAccount, MAX_WALLETS, primaryId, viewOf } from './accounts'
import { emptyBalances, executeBuy, nativePrice, type Asset } from './tradingEngine'
import { CHAINS, fmtNative } from '../data/chains'
import { DEFAULT_INSTANT, DEFAULT_TRADE_SETTINGS, migrateTradeSettings } from '../data/tradeSettings'
import { createWallets, ensureRivalWallets, tickWallets } from './walletEngine'
import { ACCOUNTS, addFollowers, CALL_SETTLE_TICKS, callerKey, copyBuys, copySells, type CopyBook, freshSocial, KOL_FOLLOWERS, POST_COOLDOWN_TICKS, saneSocial, settleCall, shill, tickSocial, type ShillResult } from './socialEngine'
import { DEFAULT_TRACKER, shouldAlert, trackedHolders } from './tracker'
import { WORLD_START_BALANCE, type ClientMsg, type OpMsg, type OrderMsg, type RoomPlayer, type RoundInfo } from '../net/protocol'
import { payNative, runBuy, runConvert, runGiveAway, runSell, runSwap } from './orders'
import { cashbackOf, cashbackUsd, CHECKIN_REWARDS, freshRewards, makeFriend, MAX_FRIENDS, REFERRALS_ENABLED, SHARE_COOLDOWN_TICKS, tickFriends, todayKey, yesterdayKey } from './rewardsEngine'

export type View = 'discover' | 'trenches' | 'token' | 'portfolio' | 'missions' | 'leaderboard' | 'cooking' | 'copytrade' | 'sniper' | 'monitor' | 'track' | 'rewards' | 'admin'
export type DockTab = 'positions' | 'watchlist' | 'history' | 'feed' | 'tracker' | 'social'
export type Modal = null | 'settings' | 'help' | 'mode' | 'results' | 'lobby'

export interface RunResult {
  mode: GameMode
  won: boolean
  reason: string
  startBalance: number
  finalEquity: number
  returnPct: number
  rank: number
  field: number
  trades: number
  winRate: number
  xpBonus: number
  seasonPoints?: number // ranked modes: points added to this week's season
}

interface RunStats {
  earlyBuys: number
  gradsHeld: number
  milestones: number[]
  xpEarned: number
  cooked?: number
  cookedGrads?: number
}

interface SavedRun {
  market: MarketState
  events: MarketEvent[]
  portfolio: Portfolio
  mode: GameMode
  runStatus: RunStatus
  runTicks: number
  challenges: Challenge[]
  players: Player[]
  watchlist: string[]
  selectedId: string | null
  runStats: RunStats
  dayKey: string
  result: RunResult | null
  launches?: LaunchRecord[]
  lastCookTick?: number
  wallets?: SimWallet[]
  copies?: CopyConfig[]
  trackedWallets?: string[]
  walletFeed?: WalletFeedItem[]
  socialFeed?: SocialPost[]
  followedAccounts?: string[]
  walletLabels?: Record<string, WalletLabel>
  alerts?: PriceAlert[]
  snipers?: SniperTask[]
  runDuration?: number | null
}

/** You as a poster on the timeline (the name/avatar you use in rooms, or "You"). */
export function playerAuthor() {
  const name = load<string>('mpName') || 'You'
  return { name, handle: name.toLowerCase().replace(/[^a-z0-9_]/g, '') || 'you', avatar: load<string>('mpAvatar') || '🫵' }
}

/** The speed the market actually runs at: Realistic markets and online rooms are always real time (1×). */
export const selectSpeed = (s: Pick<GameState, 'online' | 'market' | 'settings'>) => (s.online || s.market.engine === 'realistic' ? 1 : s.settings.speed)

/** The other players in your room, as leaderboard rivals. */
export function roomRivals(o: OnlineState): Player[] {
  return o.players
    .filter((p) => p.id !== o.you && p.startEquity > 0)
    .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, level: p.level, startEquity: p.startEquity, equity: p.equity, trades: p.trades, wins: p.wins, skill: 0, seasonPoints: p.seasonPoints ?? 0, real: true, holdings: p.holdings ?? [] }))
}

/** Your side of an online round (the market lives on the server), so a reload can rejoin where you were. */
export interface MpSave {
  code: string
  roundId: number
  portfolio: Portfolio
  launches: LaunchRecord[]
  runStats: RunStats
  runTicks: number
  challenges: Challenge[]
  copies: CopyConfig[]
  snipers: SniperTask[]
  alerts: PriceAlert[]
  lastCookTick: number
  result: RunResult | null
  runStatus: RunStatus
  mode: GameMode
  runDuration: number | null
  watchlist: string[]
}

/** A round you end yourself before this many ticks (5 min at 1x) pays no round bonus. */
const MIN_BONUS_TICKS = 300

export interface WalletFeedItem {
  id: number
  tick: number
  time: number
  walletId: string
  tokenId: string
  ticker: string
  emoji: string
  hue: number
  side: 'buy' | 'sell'
  usd: number
  fraction: number
  copied: boolean
  kind?: WalletActionKind
  mcap?: number
}

export interface BotTickRun {
  vol: number
  cost: number
  stop?: string
}

/** One tick's market result: advanced here (single-player) or received from the server (online). */
export interface TickInput {
  market: MarketState
  newEvents: MarketEvent[]
  wr: { wallets: SimWallet[]; actions: WalletAction[] }
  newPosts: SocialPost[]
  botRuns: Map<string, BotTickRun>
  botCost: Map<string, Record<Chain, number>>
  players: Player[]
}

export interface ChatLine {
  from: string
  name: string
  avatar: string
  text: string
  time: number
}

/** Multiplayer room you're in (null = single-player). */
export interface OnlineState {
  code: string
  you: string
  hostId: string
  players: RoomPlayer[]
  round: RoundInfo
  conn: 'open' | 'reconnecting'
  chat: ChatLine[]
  spectator?: boolean // World guest: watching only (sign in to trade)
}

/** Set by the network client while online; the store calls it to tell the server about your cooks, bots and coins. */
export const netHooks: {
  send: ((msg: ClientMsg) => void) | null
  /** Rooms: send a buy / sell to the server (the judge) and get the order's ref back. */
  order: ((o: OrderMsg) => number) | null
  /** Rooms: run a swap / transfer / claim on the server too. */
  op: ((o: OpMsg) => void) | null
  /** Rooms: a cook or airdrop for the server to run on your wallets; returns its ref (its fills carry it). */
  wallet: ((msg: NumberedMsg) => number) | null
  /** >0 while a wallet change is being made that the server runs too (test copies flag any other change). */
  quiet: number
} = { send: null, order: null, op: null, wallet: null, quiet: 0 }

/** Wallet messages the network client numbers (`seq` / `ref`) before sending. */
export type NumberedMsg = Omit<Extract<ClientMsg, { t: 'cook' }>, 'seq' | 'ref'> | Omit<Extract<ClientMsg, { t: 'airdrop' }>, 'seq'>

/** Tag the newest `n` trades with the room order they belong to (the server's fills replace them). */
function tagRef(p: Portfolio, n: number, ref: number): Portfolio {
  return n ? { ...p, trades: p.trades.map((t, i) => (i < n ? { ...t, ref } : t)) } : p
}

/** Change the store without reporting the wallet change to the room server (it already knows about it). */
export function quietly(fn: () => void) {
  netHooks.quiet++
  try {
    fn()
  } finally {
    netHooks.quiet--
  }
}

export interface GameState {
  online: OnlineState | null
  market: MarketState
  events: MarketEvent[]
  portfolio: Portfolio
  mode: GameMode
  runStatus: RunStatus
  runTicks: number
  runDuration: number | null // this round's clock in ticks; null = no time limit
  roundLength: RoundLength // round length picked on the mode picker, used for the next round
  challenges: Challenge[]
  players: Player[]
  profile: Profile
  settings: Settings
  watchlist: string[]
  selectedId: string | null
  runStats: RunStats
  result: RunResult | null
  launches: LaunchRecord[]
  lastCookTick: number
  wallets: SimWallet[]
  copies: CopyConfig[]
  trackedWallets: string[]
  walletFeed: WalletFeedItem[]
  socialFeed: SocialPost[]
  followedAccounts: string[]
  walletLabels: Record<string, WalletLabel>
  tracker: TrackerSettings
  alerts: PriceAlert[]
  rewards: RewardsState

  view: View
  discoverLayout: 'table' | 'trenches'
  backView: View // page the open coin was opened from (token page Back / Esc)
  dockTab: DockTab
  modal: Modal
  tradeSide: 'buy' | 'sell'
  tradeFocus: number
  searchFocus: number
  sheetOpen: boolean
  instantOpen: boolean
  walletDrawer: string | null
  chainFilter: 'all' | Chain
  swapOpen: boolean
  walletsOpen: boolean
  sideQueue: { tokenId: string; walletId: string; amount: number; atTick: number }[] // delayed side-wallet buys on your launches
  snipers: SniperTask[]
  pnlOpen: boolean // floating PnL card
  paused: boolean
  toasts: Toast[]

  /** Advance one tick; online, `net` is the server's market update for this tick. */
  tick: (net?: TickInput) => void
  /** Start a round. Online rounds pass the room's clock instead of the local round length. */
  startRun: (mode: GameMode, opts?: { durationTicks?: number | null; silent?: boolean }) => void
  /** Replace store fields directly (the network client uses this for room updates). */
  patchState: (patch: Partial<GameState>) => void
  /** Leave the room and go back to your single-player game. */
  leaveRoom: () => void
  /** Round over for everyone (online): wrap up your round if it's still going. */
  endRoundOnline: () => void
  /** `slot` picks the P1/P2/P3 trade settings (defaults to the active slot). */
  buy: (usd: number, tokenId?: string, slot?: number) => boolean
  /** scope: 'active' = the selected wallets (default), 'all' = every wallet holding it, one wallet id, or a list of ids. */
  sell: (qty: number, tokenId?: string, slot?: number, scope?: 'active' | 'all' | (string & {}) | string[]) => boolean
  select: (id: string, open?: boolean) => void
  setView: (v: View) => void
  setDockTab: (t: DockTab) => void
  setDiscoverLayout: (l: 'table' | 'trenches') => void
  setModal: (m: Modal) => void
  requestTrade: (side: 'buy' | 'sell') => void
  setTradeSide: (side: 'buy' | 'sell') => void
  setSheetOpen: (v: boolean) => void
  toggleInstant: (open?: boolean) => void
  focusSearch: () => void
  toggleWatch: (id: string) => void
  togglePause: () => void
  updateSettings: (patch: Partial<Settings>) => void
  setRoundLength: (len: RoundLength) => void
  endRun: () => void
  resetGame: () => void
  resetProgress: () => void
  /** Roll over to this week's ranked season (paying out last season's tier if it ended). */
  checkSeason: () => void
  notify: (t: Omit<Toast, 'id'>, sfx?: Sfx) => void
  dismissToast: (id: number) => void
  sfx: (s: Sfx) => void
  cook: (spec: CookSpec) => string | null
  startCopy: (cfg: Omit<CopyConfig, 'id' | 'createdTick' | 'holdings' | 'stats' | 'paused'>) => void
  updateCopy: (id: string, patch: Partial<CopyConfig>) => void
  stopCopy: (id: string, sellAll: boolean) => void
  toggleTrackWallet: (walletId: string) => void
  /** Give part of your dev bag away to `wallets` recipients (existing holders or fresh wallets). */
  airdrop: (tokenId: string, pct: number, wallets: number, target: AirdropTarget) => boolean
  openWallet: (walletId: string | null) => void
  toggleFollowAccount: (accountId: string) => void
  setWalletLabel: (walletId: string, patch: Partial<WalletLabel>) => void
  updateTracker: (patch: Partial<TrackerSettings>) => void
  addAlert: (a: Omit<PriceAlert, 'id' | 'createdTick' | 'baseMcap' | 'ticker' | 'emoji' | 'hue'>) => void
  removeAlert: (id: string) => void
  shareInvite: () => void
  claimReward: (kind: 'commission') => void
  /** Claim trading cashback for one chain (or all) as that chain's coin, or converted to USDC. */
  claimCashback: (chain: Chain | 'all', as: 'coin' | 'usdc') => void
  setCashbackAuto: (auto: CashbackState['auto']) => void
  checkIn: () => void
  /** Daily challenges: count these new fills (and coins cooked) towards today's three, paying XP for any that finish. */
  trackDaily: (fills: Trade[], cooked?: number) => void
  setChainFilter: (c: 'all' | Chain) => void
  setSwapOpen: (v: boolean) => void
  setWalletsOpen: (v: boolean) => void
  setPnlOpen: (v: boolean) => void
  addSniper: (task: Omit<SniperTask, 'id' | 'createdTick' | 'holdings' | 'stats'>) => void
  updateSniper: (id: string, patch: Partial<SniperTask>) => void
  removeSniper: (id: string) => void
  swapAssets: (from: Asset, to: Asset, amount: number, walletId?: string) => boolean
  /** Convert any asset in one wallet into any asset in another (USD is the shared bank). */
  convertAssets: (from: Asset, to: Asset, amount: number, fromWallet: string, toWallet: string) => boolean
  /** World: ask the server for the leaderboards. */
  requestBoard: (list?: import('../net/protocol').BoardList) => void
  /** World: you're broke; ask the server for a fresh start (it checks you really are, and the once-a-day limit). */
  bankruptRestart: () => void
  // Multi-wallet (GMGN-style)
  createWallet: (name: string, emoji: string) => string | null
  updateWallet: (id: string, patch: { name?: string; emoji?: string }) => void
  deleteWallet: (id: string) => boolean
  setActiveWallets: (ids: string[]) => void
  transferNative: (fromId: string, toId: string, chain: Chain, amount: number) => boolean
  /** Put the same amount of a chain coin into several wallets: swapped from the USD bank (`amountEach` in USD) or sent from one wallet (in coin). Returns how many got funded. */
  fundWallets: (source: 'usd' | string, toIds: string[], chain: Chain, amountEach: number) => number
  /** Buy using an amount of the token's chain coin (e.g. 0.5 SOL). */
  buyNative: (amount: number, tokenId?: string, slot?: number) => boolean
  /** Start, retune or stop the volume bot on one of your launches. */
  setBot: (tokenId: string, patch: Partial<VolumeBot>) => void
  /** Post on the (simulated) X timeline; attach a coin to make it a call that bots may ape. */
  postSocial: (text: string, tokenId?: string) => boolean
  /** Claim creator fees from one of your coins (or all of them) into its dev wallet. */
  claimCreatorFees: (tokenId?: string, silent?: boolean) => void
}

const DEFAULT_SETTINGS: Settings = {
  sound: false,
  animations: true,
  compact: false,
  chartStyle: 'candles',
  notifications: true,
  practiceBalance: 100_000,
  speed: 1,
  accent: 'acid',
  quickSlot: 1,
  presetIdx: 1,
  buyPresets: { sol: CHAINS.sol.presets, bsc: CHAINS.bsc.presets, hood: CHAINS.hood.presets },
  autoSwap: true,
  tradeSettings: DEFAULT_TRADE_SETTINGS,
  instant: DEFAULT_INSTANT,
  sellPresets: [
    [10, 25, 50, 100],
    [25, 50, 75, 100],
    [5, 10, 20, 100],
  ],
}
const DEFAULT_PROFILE: Profile = { xp: 0, bestReturnPct: 0, runsPlayed: 0, lifetimeTrades: 0 }
const freshRunStats = (): RunStats => ({ earlyBuys: 0, gradsHeld: 0, milestones: [], xpEarned: 0, cooked: 0, cookedGrads: 0 })
const dayKey = () => new Date().toDateString()
let toastSeq = 1
let lastEventToast = -999

// Cooking rules.
export { COOK_COOLDOWN_TICKS, GRAD_BONUS, MAX_COOKS_PER_ROUND }

/**
 * Returns an error message, or null if the launch spec is valid. `online`: in a room or the World the server checks
 * the same things again (`coinLook` in server/moderation.ts) and only takes a picture that was uploaded.
 */
export function validateCook(spec: CookSpec, tokens: Token[], online = false): string | null {
  if (spec.name.trim().length < 2 || spec.name.trim().length > 24) return 'Name must be 2–24 characters'
  if (!/^[A-Z0-9]{2,8}$/.test(spec.ticker)) return 'Ticker must be 2–8 letters or digits'
  if (online && spec.image && !/^data:image\//i.test(spec.image)) return 'Online, upload the picture (links are solo only)'
  if (online && spec.image && spec.image.length > 200_000) return 'Picture too big for online play'
  // Tickers are unique, except a vamp may reuse the exact ticker of the coin it's copying (that's the point of a vamp).
  if (tokens.some((t) => t.ticker === spec.ticker && t.status !== 'dead' && t.status !== 'rugged' && t.id !== spec.vampOf)) return `$${spec.ticker} already exists`
  if (!(spec.marketing >= 0) || !(spec.devBuy >= 0)) return 'Amounts must be positive'
  const b = spec.bundle
  if (b && (!Number.isInteger(b.wallets) || b.wallets < 0 || b.wallets > BUNDLE_MAX_WALLETS || !(b.perWallet >= 0))) return `Bundle uses 0–${BUNDLE_MAX_WALLETS} wallets`
  return null
}

export function alertText(a: Pick<PriceAlert, 'type' | 'value'>) {
  switch (a.type) {
    case 'mcAbove': return `MC above ${fmtCompact(a.value)}`
    case 'mcBelow': return `MC below ${fmtCompact(a.value)}`
    case 'pctUp': return `up ${a.value}%`
    case 'pctDown': return `down ${a.value}%`
  }
}

/** Settings saved before chains existed used USD presets; swap in the per-chain native presets. */
function migrateSettings(s: Settings & { quickBuy?: number }): Settings {
  const presetsOk = s.buyPresets && !Array.isArray(s.buyPresets) && CHAIN_IDS_LOCAL.every((c) => Array.isArray((s.buyPresets as Record<Chain, number[][]>)[c]))
  const { quickBuy: _old, ...rest } = s
  void _old
  return {
    ...rest,
    quickSlot: typeof s.quickSlot === 'number' ? s.quickSlot : 1,
    buyPresets: presetsOk ? s.buyPresets : { sol: CHAINS.sol.presets, bsc: CHAINS.bsc.presets, hood: CHAINS.hood.presets },
    autoSwap: s.autoSwap ?? true,
    tradeSettings: migrateTradeSettings(s.tradeSettings),
    instant: { ...DEFAULT_INSTANT, ...(s.instant ?? {}), sellNative: { ...DEFAULT_INSTANT.sellNative, ...(s.instant?.sellNative ?? {}) } },
  }
}
const CHAIN_IDS_LOCAL: Chain[] = ['sol', 'bsc', 'hood']

/** Execution settings for a chain, side and P slot (defaults to the active slot). */
export function slotSetting(settings: Settings, chain: Chain, side: 'buy' | 'sell', slot?: number) {
  const list = (settings.tradeSettings ?? DEFAULT_TRADE_SETTINGS)[chain]?.[side] ?? DEFAULT_TRADE_SETTINGS[chain][side]
  return list[slot ?? settings.presetIdx] ?? list[0]
}

// ─── Dev wallet vs side wallets on your launches ──────────────────────────────
/** Wallets that count as the dev on one of your launches: the deployer plus any side wallets sleuths linked. */
function devSet(p: Portfolio, rec?: LaunchRecord): string[] {
  return [rec?.devWallet ?? p.accounts?.[0]?.id ?? 'w-main', ...(rec?.linkedWallets ?? [])]
}
const qtyIn = (p: Portfolio, ids: string[], tokenId: string) => ids.reduce((a, id) => a + (accountOf(p, id)?.positions[tokenId]?.qty ?? 0), 0)

/**
 * Dev % is only the deployer wallet's bag (minus its hidden bundle). Other wallets never add to it, even when
 * sleuths link them: linking costs hype instead.
 */
function devStake(p: Portfolio, rec: LaunchRecord | undefined, tokenId: string) {
  const [dev] = devSet(p, rec)
  return splitBag(qtyIn(p, [dev], tokenId), rec?.bundleQty ?? 0)
}

/**
 * Chance on-chain sleuths tie a side wallet's buy to the dev. Buying in the launch block is the classic tell; later
 * buys are much harder to link, unless the wallet was funded straight from the dev wallet recently.
 */
export function linkChance(p: Portfolio, rec: LaunchRecord, walletId: string, ageSec: number, tick: number) {
  let c = ageSec < 12 ? 0.35 : ageSec < 120 ? 0.12 : 0.04
  const funded = accountOf(p, walletId)?.fundedBy?.[rec.devWallet ?? '']
  if (funded !== undefined && tick - funded < 600) c += 0.25
  return Math.min(0.9, c)
}

/** Update a single token immutably. */
function patchToken(m: MarketState, id: string, fn: (t: Token) => void): MarketState {
  return {
    ...m,
    tokens: m.tokens.map((old) => {
      if (old.id !== id) return old
      const t: Token = { ...old, sim: { ...old.sim }, change: { ...old.change } }
      fn(t)
      return t
    }),
  }
}

function startBalanceFor(mode: GameMode, settings: Settings, online = false) {
  // In a room the server sets everyone's start balance (the mode's standard one), so practice's own setting doesn't apply.
  return mode === 'practice' && !online ? settings.practiceBalance : MODES[mode].startBalance
}

function challengeCtx(p: Portfolio, market: MarketState, rs: RunStats): ChallengeContext {
  const map = new Map(market.tokens.map((t) => [t.id, t]))
  const v = valuePortfolio(p, map, market)
  const st = portfolioStats(p, v)
  return {
    profitableSells: st.profitableSells,
    uniqueTokens: p.tradedTokens.length,
    bestSellPct: st.bestSellPct,
    growth: v.equity / p.startBalance - 1,
    maxDrawdown: p.maxDrawdown,
    tradeCount: p.trades.length,
    earlyBuys: rs.earlyBuys,
    gradsHeld: rs.gradsHeld,
    greenPositions: v.greenPositions,
    startBalance: p.startBalance,
    cooked: rs.cooked ?? 0,
    cookedGrads: rs.cookedGrads ?? 0,
  }
}

function defaultSelection(m: MarketState) {
  return [...m.tokens].filter((t) => t.status === 'graduated').sort((a, b) => b.hype + b.momentumScore - (a.hype + a.momentumScore))[0]?.id ?? m.tokens[0]?.id ?? null
}

function initialState() {
  const settings = migrateSettings({ ...DEFAULT_SETTINGS, ...(load<Settings>('settings') ?? {}) })
  const profile = saneSocial({ ...DEFAULT_PROFILE, ...(load<Profile>('profile') ?? {}) })
  const saved = load<SavedRun>('run')
  if (saved?.market?.tokens?.length) {
    setClock(secPerTickOf(saved.market)) // before rebuilding charts: their spacing depends on the clock
    migrateMarket(saved.market)
    rebuildCandles(saved.market)
    restoreCharts(saved.market) // the real history of coins you traded, so your trade markers still line up
    const portfolio = ensureAccounts({ ...saved.portfolio, balances: saved.portfolio.balances ?? emptyBalances() })
    if (saved.dayKey !== dayKey()) {
      const v = valuePortfolio(portfolio, new Map(saved.market.tokens.map((t) => [t.id, t])), saved.market)
      portfolio.dayStartEquity = v.equity
    }
    return {
      settings, profile,
      market: saved.market, events: saved.events ?? [], portfolio, mode: saved.mode, runStatus: saved.runStatus,
      runTicks: saved.runTicks, challenges: saved.challenges, players: saved.players, watchlist: saved.watchlist ?? [],
      selectedId: saved.selectedId ?? defaultSelection(saved.market), runStats: saved.runStats ?? freshRunStats(),
      result: saved.result ?? null, runDuration: saved.runDuration !== undefined ? saved.runDuration : MODES[saved.mode].durationTicks,
      launches: saved.launches ?? [], lastCookTick: saved.lastCookTick ?? -999,
      wallets: saved.wallets ? ensureRivalWallets(saved.wallets, new Rng((saved.market.seed ^ 0x71ba1) >>> 0)) : createWallets(new Rng((saved.market.seed ^ 0xa11ce) >>> 0)), copies: saved.copies ?? [],
      trackedWallets: saved.trackedWallets ?? [], walletFeed: saved.walletFeed ?? [],
      socialFeed: saved.socialFeed ?? [], followedAccounts: saved.followedAccounts ?? [], walletLabels: saved.walletLabels ?? {}, alerts: saved.alerts ?? [], snipers: saved.snipers ?? [],
      modal: (saved.runStatus === 'select' ? 'mode' : saved.runStatus === 'finished' ? 'results' : null) as Modal,
    }
  }
  const market = createMarket((Math.random() * 2 ** 32) >>> 0, undefined, settings.engine ?? 'classic')
  const portfolio = ensureAccounts(newPortfolio(settings.practiceBalance))
  return {
    settings, profile, market, events: [] as MarketEvent[], portfolio, mode: 'practice' as GameMode, runStatus: 'select' as RunStatus,
    runTicks: 0, challenges: createChallenges(challengeCtx(portfolio, market, freshRunStats())),
    players: createRivals(new Rng(market.seed ^ 77), portfolio.startBalance, 'practice'), watchlist: [] as string[],
    selectedId: defaultSelection(market), runStats: freshRunStats(), result: null, modal: 'mode' as Modal, runDuration: null as number | null,
    launches: [] as LaunchRecord[], lastCookTick: -999,
    wallets: createWallets(new Rng((market.seed ^ 0xa11ce) >>> 0)), copies: [] as CopyConfig[], trackedWallets: [] as string[], walletFeed: [] as WalletFeedItem[],
    socialFeed: [] as SocialPost[], followedAccounts: [] as string[], walletLabels: {} as Record<string, WalletLabel>, alerts: [] as PriceAlert[], snipers: [] as SniperTask[],
  }
}

/** Solo: what your followers' copy bots hold (rooms keep this on the server). */
const soloCopyBook: CopyBook = {}

export const useGame = create<GameState>()((set, get) => {
  const init = initialState()

  let lastChartSave = 0
  function persist() {
    const s = get()
    if (s.online) {
      // Online rounds save to their own slot so your single-player game is never overwritten.
      const mp: MpSave = {
        code: s.online.code, roundId: s.online.round.id, portfolio: s.portfolio, launches: s.launches, runStats: s.runStats, runTicks: s.runTicks,
        challenges: s.challenges, copies: s.copies, snipers: s.snipers, alerts: s.alerts, lastCookTick: s.lastCookTick, result: s.result,
        runStatus: s.runStatus, mode: s.mode, runDuration: s.runDuration, watchlist: s.watchlist,
      }
      save(`mpSave:${s.online.you}`, mp)
      save('profile', s.profile)
      save('rewards', s.rewards)
      return
    }
    const data: SavedRun = {
      market: s.market, events: s.events.slice(0, 60), portfolio: s.portfolio, mode: s.mode, runStatus: s.runStatus,
      runTicks: s.runTicks, challenges: s.challenges, players: s.players, watchlist: s.watchlist, selectedId: s.selectedId,
      runStats: s.runStats, dayKey: dayKey(), result: s.result, launches: s.launches, lastCookTick: s.lastCookTick,
      wallets: s.wallets, copies: s.copies, trackedWallets: s.trackedWallets, walletFeed: s.walletFeed.slice(0, 60),
      socialFeed: s.socialFeed.slice(0, 80), followedAccounts: s.followedAccounts, walletLabels: s.walletLabels, alerts: s.alerts, snipers: s.snipers,
      runDuration: s.runDuration,
    }
    save('run', data)
    save('profile', s.profile)
    save('rewards', s.rewards)
    // Charts of the coins you're in or traded (throttled: they're bigger than the rest of the save).
    if (Date.now() - lastChartSave > 15_000) {
      lastChartSave = Date.now()
      const traded = s.portfolio.trades.slice(0, 60).map((t) => t.tokenId)
      saveCharts([...Object.keys(s.portfolio.positions), ...(s.selectedId ? [s.selectedId] : []), ...traded])
    }
  }

  /** A failed on-chain order (slippage) still burns its priority fee, from the wallet that sent it. */
  /**
   * Buy `usd` of a token from each of these wallets. On coins you cooked, only the deployer (and wallets sleuths have
   * linked to it) count as the dev; any other wallet looks like a normal buyer — unless this buy gets it linked.
   */
  /** World guests only watch: anything that trades or spends says "sign in" instead. */
  function watchingOnly(): boolean {
    const s = get()
    if (!s.online?.spectator) return false
    s.notify({ title: 'SIGN IN TO TRADE', body: "You're watching the World as a guest. Sign in (top right) to get your own $10,000 wallet and trade.", tone: 'info', icon: '👀' }, 'alert')
    return true
  }

  /** Your follower count and reputation when you're a KOL (your followers copy your buys), else null. */
  const kolOf = (s: GameState) => {
    const soc = s.profile.social
    return soc && soc.followers >= KOL_FOLLOWERS ? { followers: soc.followers, rep: soc.rep } : null
  }

  function buyFrom(walletIds: string[], usd: number, id: string, slot?: number, label?: string): boolean {
    if (watchingOnly()) return false
    const s = get()
    const tok = s.market.tokens.find((x) => x.id === id)
    const setting = tok ? slotSetting(s.settings, tok.chain, 'buy', slot) : undefined
    const r = runBuy(s.portfolio, s.market, walletIds, usd, id, { autoSwap: s.settings.autoSwap, setting })
    let portfolio = r.portfolio
    let market = r.market
    const { fills, failures, firstTimeToken, swappedUsd } = r
    // Rooms: the server runs the same order and its result wins (this one just shows it instantly).
    if (s.online && netHooks.order) portfolio = tagRef(portfolio, fills.length, netHooks.order({ side: 'buy', tokenId: id, walletIds, usdEach: usd, setting, autoSwap: s.settings.autoSwap, ...(kolOf(s) ? { kol: kolOf(s)! } : {}) }))
    if (!fills.length) {
      quietly(() => set({ portfolio }))
      s.notify({ title: failures[0]?.includes('Slippage') ? 'TX FAILED' : 'ORDER REJECTED', body: failures.join(' · ') || 'No wallet selected', tone: 'warn', icon: '⛔' }, 'alert')
      return false
    }
    const t = s.market.tokens.find((x) => x.id === id)!
    const early = s.market.time - t.createdAt < 300
    let launches = s.launches
    let events = s.events
    if (t.creator === 'you') {
      // Side-wallet buys on your own coin: each one risks being linked to the dev by on-chain sleuths.
      let rec = launches.find((r) => r.tokenId === id)
      const newLinks: string[] = []
      if (rec) {
        const dev = devSet(portfolio, rec)
        for (const f of fills) {
          const w = f.walletId
          if (w && !dev.includes(w) && !newLinks.includes(w) && Math.random() < linkChance(portfolio, rec, w, s.market.time - t.createdAt, s.market.tick)) newLinks.push(w)
        }
        if (newLinks.length) {
          rec = { ...rec, linkedWallets: [...(rec.linkedWallets ?? []), ...newLinks] }
          const updated = rec
          launches = launches.map((r) => (r.tokenId === id ? updated : r))
          const names = newLinks.map((w) => fakeAddress(w)).join(', ')
          events = [{ id: s.market.tick * 100 + 94, tick: s.market.tick, time: s.market.time, kind: 'bundle' as const, tokenId: id, ticker: t.ticker, text: `🔗 Sleuths linked ${names} to the $${t.ticker} dev — traders are getting nervous`, icon: '🔗', tone: 'down' as const }, ...events].slice(0, 120)
        }
      }
      const stake = devStake(portfolio, rec, id)
      market = patchToken(market, id, (x) => {
        x.devPct = stake.devPct
        if (x.bundlePct !== undefined) x.bundlePct = stake.bundlePct
        if (newLinks.length) {
          x.hype = Math.max(0, x.hype - 8 * newLinks.length)
          x.sim.pressure -= 0.003 * newLinks.length
        }
      })
      if (newLinks.length) s.notify({ title: 'WALLET LINKED TO DEV 🔗', body: `Sleuths tied ${newLinks.map((w) => accountOf(portfolio, w)?.name ?? w).join(', ')} to your dev wallet on $${t.ticker}. Hype took a hit (dev % is still only your deployer's bag).`, tone: 'down', icon: '🔗' }, 'alert')
    }
    if (!s.online) {
      const kol = kolOf(s)
      const main = s.portfolio.accounts?.[0]?.id // copy traders follow your main (public) wallet only
      const wave = kol && copyBuys(market, new Rng((Math.random() * 2 ** 32) >>> 0), market.tokens.find((x) => x.id === id) ?? t, kol, fills.filter((f) => !main || (f.walletId ?? main) === main).reduce((a, f) => a + f.value, 0), soloCopyBook)
      if (wave) {
        market = { ...market, shillQueue: [...(market.shillQueue ?? []), ...wave.queue] }
        s.notify({ title: 'COPY TRADERS', body: `👥 ${wave.copiers} copy trader${wave.copiers > 1 ? 's are' : ' is'} following your buy of $${t.ticker} (~${fmtUsd(wave.usd, 0)})`, tone: 'info', icon: '👥' })
      }
    }
    quietly(() => set({
      portfolio, market, launches, events,
      runStats: early ? { ...s.runStats, earlyBuys: s.runStats.earlyBuys + 1 } : s.runStats,
      profile: { ...s.profile, lifetimeTrades: s.profile.lifetimeTrades + fills.length },
    }))
    if (t.creator === 'you') sendTokenPatch(id)
    if (swappedUsd > 0) s.notify({ title: 'AUTO-SWAP', body: `${fmtUsd(swappedUsd)} USD → ${CHAINS[t.chain].native}`, tone: 'info', icon: '🔄' })
    const nat = fills.reduce((acc, f) => acc + (f.native ?? 0), 0)
    const val = fills.reduce((acc, f) => acc + f.value, 0)
    const gas = fills.reduce((acc, f) => acc + (f.gas ?? 0), 0)
    s.notify({
      title: label ?? (fills.length > 1 ? `BUY EXECUTED · ${fills.length} WALLETS` : 'BUY EXECUTED'),
      body: `${fmtNative(nat, t.chain)} (${fmtUsd(val)}) of $${t.ticker} · slip ${fmtPct(fills[0].slippage, 2, false)}${gas ? ` · fees ${fmtUsd(gas)}` : ''}${failures.length ? ` · ${failures.length} failed` : ''}`,
      tone: 'up', icon: '🟢',
    }, 'buy')
    if (failures.length) s.notify({ title: 'SOME WALLETS FAILED', body: failures.join(' · '), tone: 'warn', icon: '⚠️' })
    fills.forEach(sandwichNote)
    if (firstTimeToken) gainXp(early ? 15 : 10, early ? `Early discovery: $${t.ticker}` : `New token: $${t.ticker}`)
    persist()
    return true
  }

  /**
   * Sniper bot: check brand-new launches against every enabled task and auto-buy the matches from the task's wallets
   * (using its P slot's fees / slippage), then run take-profit / stop-loss on the bags it opened.
   */
  function runSnipers(newIds: string[]) {
    const s0 = get()
    if (s0.online?.spectator) return
    if (!s0.snipers.some((x) => x.enabled)) return
    const words = (str: string) => str.split(',').map((w) => w.trim().toLowerCase().replace(/^\$/, '')).filter(Boolean)
    let snipers = s0.snipers.map((x) => ({ ...x, holdings: { ...x.holdings }, stats: { ...x.stats } }))

    for (const id of newIds) {
      for (const task of snipers) {
        const t = get().market.tokens.find((x) => x.id === id)
        if (!task.enabled || !t || t.chain !== task.chain || task.stats.snipes >= task.maxSnipes) continue
        const text = `${t.ticker} ${t.name}`.toLowerCase()
        const inc = words(task.keywords)
        const ok =
          (!task.pads.length || task.pads.includes(t.pad)) &&
          (!inc.length || inc.some((w) => text.includes(w))) &&
          !words(task.exclude).some((w) => text.includes(w)) &&
          (task.maxDevPct === null || t.devPct <= task.maxDevPct) &&
          (!task.requireSocial || !!(t.socials?.x || t.socials?.tg || t.socials?.web)) &&
          !(task.skipTax && t.tax)
        if (!ok) {
          task.stats.skipped++
          continue
        }
        const p0 = get().portfolio
        const wallets = (task.walletIds.length ? task.walletIds : p0.active ?? []).filter((w) => accountOf(p0, w))
        if (!wallets.length) continue
        const before = p0.trades.length
        const done = buyFrom(wallets, task.amount * nativePrice(get().market, t.chain), t.id, task.slot, `🎯 SNIPED · ${task.name}`)
        if (!done) continue
        // Tag the new fills and record the bag this task now manages.
        const p1 = get().portfolio
        const added = p1.trades.length - before
        const fills = p1.trades.slice(0, added).filter((tr) => tr.tokenId === t.id && tr.side === 'buy')
        quietly(() => set({ portfolio: { ...p1, trades: [...p1.trades.slice(0, added).map((tr) => (tr.tokenId === t.id ? { ...tr, via: `🎯 ${task.name}` } : tr)), ...p1.trades.slice(added)] } }))
        const qty = fills.reduce((a, f) => a + f.qty, 0)
        const cost = fills.reduce((a, f) => a + f.value + (f.gas ?? 0), 0)
        const prev = task.holdings[t.id]
        task.holdings[t.id] = { qty: (prev?.qty ?? 0) + qty, cost: (prev?.cost ?? 0) + cost, walletIds: [...new Set([...(prev?.walletIds ?? []), ...fills.map((f) => f.walletId ?? wallets[0])])] }
        task.stats.snipes++
        task.stats.spent += cost
      }
    }

    // Take profit / stop loss on sniped bags (only the part this task bought).
    for (const task of snipers) {
      if (!task.enabled || (task.tp === null && task.sl === null)) continue
      for (const [tokenId, h] of Object.entries(task.holdings)) {
        const t = get().market.tokens.find((x) => x.id === tokenId)
        const heldNow = qtyIn(get().portfolio, h.walletIds, tokenId)
        if (!t || heldNow <= 0 || t.status === 'rugged' || t.status === 'dead') {
          if (!t || heldNow <= 0) delete task.holdings[tokenId]
          continue
        }
        const qty = Math.min(h.qty, heldNow)
        const pct = ((t.price * qty) / (h.cost * (qty / h.qty)) - 1) * 100
        const hitTp = task.tp !== null && pct >= task.tp
        const hitSl = task.sl !== null && pct <= -task.sl
        if (!hitTp && !hitSl) continue
        const before = get().portfolio.trades.length
        if (get().sell(qty, tokenId, task.slot, h.walletIds)) {
          const p1 = get().portfolio
          const sells = p1.trades.slice(0, p1.trades.length - before).filter((tr) => tr.tokenId === tokenId && tr.side === 'sell')
          quietly(() => set({ portfolio: { ...p1, trades: p1.trades.map((tr) => (sells.includes(tr) ? { ...tr, via: `🎯 ${task.name}` } : tr)) } }))
          task.stats.realized += sells.reduce((a, f) => a + (f.pnl ?? 0), 0)
          task.stats.sells++
          delete task.holdings[tokenId]
          get().notify({ title: hitTp ? '🎯 SNIPER TAKE PROFIT' : '🎯 SNIPER STOP LOSS', body: `${task.name} · $${t.ticker} ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`, tone: hitTp ? 'up' : 'down', icon: '🎯' })
        }
      }
    }
    snipers = snipers.map((x) => (x.enabled && x.stats.snipes >= x.maxSnipes && Object.keys(x.holdings).length === 0 ? { ...x, enabled: false } : x))
    set({ snipers })
  }

  function sandwichNote(tr: { mev?: number; ticker: string }) {
    if (tr.mev && tr.mev > 0.005) get().notify({ title: 'SANDWICHED 🥪', body: `An MEV bot took ${fmtUsd(tr.mev)} from your $${tr.ticker} order. Turn on Anti-MEV for bigger trades.`, tone: 'warn', icon: '🥪' }, 'alert')
  }

  /**
   * Make sure the profile is on this week's season. If a season with ranked rounds just ended, pay out its tier:
   * XP plus a badge for the profile.
   */
  function rollSeason(): SeasonState {
    const s = get()
    const n = seasonNumber()
    const cur = s.profile.season
    if (cur && cur.id === n) return cur
    const fresh = freshSeason(n)
    if (cur && cur.rounds > 0) {
      const tier = tierFor(cur.points)
      const badges = [{ season: cur.id, tier: tier.id, points: cur.points }, ...(s.profile.badges ?? [])].slice(0, 30)
      set({ profile: { ...s.profile, season: fresh, badges } })
      s.notify({ title: `SEASON ${cur.id} ENDED`, body: `You finished ${tier.icon} ${tier.name} with ${cur.points} pts · +${tier.xp} XP and a ${tier.name} badge`, tone: 'xp', icon: tier.icon }, 'achievement')
      gainXp(tier.xp, `Season ${cur.id} reward`, true)
    } else {
      set({ profile: { ...s.profile, season: fresh } })
    }
    return fresh
  }

  function gainXp(amount: number, reason: string, quiet = false) {
    if (amount <= 0) return
    const s = get()
    const before = levelFromXp(s.profile.xp).level
    const profile = { ...s.profile, xp: s.profile.xp + Math.round(amount) }
    const after = levelFromXp(profile.xp).level
    set({ profile, runStats: { ...s.runStats, xpEarned: s.runStats.xpEarned + Math.round(amount) } })
    if (after > before) {
      const unlock = UNLOCKS.filter((u) => u.level > before && u.level <= after).map((u) => u.label).join(', ')
      s.notify({ title: `LEVEL UP — LV ${after}`, body: `${titleFor(after)}${unlock ? ` · Unlocked: ${unlock}` : ''}`, tone: 'xp', icon: '⭐' }, 'levelup')
    } else if (!quiet) {
      s.notify({ title: `+${Math.round(amount)} XP`, body: reason, tone: 'xp', icon: '✨' })
    }
  }

  /**
   * Mirror wallet actions for every active copy config, then apply take-profit / stop-loss on copied bags.
   * Copies execute right after the source wallet, against the same pool, so they pay its price impact.
   */
  function runCopies(actions: WalletAction[]) {
    const s0 = get()
    if (s0.online?.spectator) return
    if (!s0.copies.some((c) => !c.paused)) return
    // Copy trades run from your primary wallet. In rooms each one is an order the server runs too (its result wins).
    const pid = primaryId(s0.portfolio)
    let portfolio = s0.portfolio
    let market = s0.market
    const online = !!s0.online && !!netHooks.order
    const walletName = new Map(s0.wallets.map((w) => [w.id, w.name]))
    const copies = s0.copies.map((c) => ({ ...c, holdings: { ...c.holdings }, stats: { ...c.stats } }))
    const notes: { title: string; body: string; tone: 'up' | 'down' | 'warn'; icon: string }[] = []
    const copiedFeed = new Set<string>()
    const tokenOf = (id: string) => market.tokens.find((x) => x.id === id)
    const held = (tokenId: string) => accountOf(portfolio, pid)?.positions[tokenId]
    const tag = (via: string) => {
      portfolio = { ...portfolio, trades: [{ ...portfolio.trades[0], via }, ...portfolio.trades.slice(1)] }
    }
    const sellCopied = (c: CopyConfig, tokenId: string, qtyWanted: number, label: string) => {
      const qty = Math.min(qtyWanted, held(tokenId)?.qty ?? 0)
      if (!(qty > 0)) {
        delete c.holdings[tokenId]
        return
      }
      const legs = [{ walletId: pid, qty }]
      const res = runSell(portfolio, market, legs, tokenId, {})
      if (!res.fills.length) return
      portfolio = res.portfolio
      market = res.market
      if (online) portfolio = tagRef(portfolio, res.fills.length, netHooks.order!({ side: 'sell', tokenId, legs }))
      const via = walletName.get(c.walletId) ?? 'copy'
      tag(via)
      const left = (c.holdings[tokenId] ?? 0) - qty
      if (left <= 1e-9 || !held(tokenId)) delete c.holdings[tokenId]
      else c.holdings[tokenId] = left
      const pnl = res.fills.reduce((a, f) => a + (f.pnl ?? 0), 0)
      c.stats.sells++
      c.stats.realized += pnl
      notes.push({ title: label, body: `${via} → $${res.fills[0].ticker} ${pnl >= 0 ? '+' : ''}${fmtUsd(pnl)}`, tone: pnl >= 0 ? 'up' : 'down', icon: '⚡' })
    }

    for (const a of actions) {
      for (const c of copies) {
        if (c.walletId !== a.walletId || c.paused) continue
        const t = tokenOf(a.tokenId)
        if (!t) continue
        if (a.side === 'buy') {
          if ((c.skipExtreme && t.riskLevel === 'EXTREME') || t.liquidity < c.minLiquidity) {
            c.stats.skipped++
            continue
          }
          const coin = accountOf(portfolio, pid)?.balances[t.chain] ?? 0
          const usd = Math.min(c.mode === 'fixed' ? c.amount : a.usd * c.amount, c.maxPerTrade, c.budget - c.stats.spent, portfolio.cash + coin * nativePrice(market, t.chain))
          if (!(usd >= 1)) {
            c.stats.skipped++
            continue
          }
          const res = runBuy(portfolio, market, [pid], usd, t.id, { autoSwap: s0.settings.autoSwap })
          if (!res.fills.length) {
            portfolio = res.portfolio // a failed order can still burn its priority fee
            c.stats.skipped++
            continue
          }
          portfolio = res.portfolio
          market = res.market
          if (online) portfolio = tagRef(portfolio, res.fills.length, netHooks.order!({ side: 'buy', tokenId: t.id, walletIds: [pid], usdEach: usd, autoSwap: s0.settings.autoSwap }))
          const via = walletName.get(c.walletId) ?? 'copy'
          tag(via)
          c.holdings[t.id] = (c.holdings[t.id] ?? 0) + res.fills[0].qty
          c.stats.buys++
          c.stats.spent += usd
          copiedFeed.add(`${a.walletId}:${a.tokenId}:buy`)
          notes.push({ title: 'COPY BUY', body: `${via} → $${t.ticker} · ${fmtUsd(usd)}`, tone: 'up', icon: '⚡' })
        } else if (c.copySells && (c.holdings[t.id] ?? 0) > 0) {
          sellCopied(c, t.id, a.fraction >= 1 ? c.holdings[t.id] : c.holdings[t.id] * a.fraction, 'COPY SELL')
          copiedFeed.add(`${a.walletId}:${a.tokenId}:sell`)
        }
      }
    }

    // Take profit / stop loss on copied bags, measured against your average entry.
    for (const c of copies) {
      if (c.paused || (c.tp === null && c.sl === null)) continue
      for (const [tokenId, qty] of Object.entries(c.holdings)) {
        const pos = held(tokenId)
        const t = tokenOf(tokenId)
        if (!pos || !t) {
          delete c.holdings[tokenId]
          continue
        }
        const pct = (t.price / pos.avgEntry - 1) * 100
        if (c.tp !== null && pct >= c.tp) sellCopied(c, tokenId, qty, 'COPY TAKE PROFIT')
        else if (c.sl !== null && pct <= -c.sl) sellCopied(c, tokenId, qty, 'COPY STOP LOSS')
      }
    }

    const walletFeed = copiedFeed.size ? get().walletFeed.map((f) => (f.tick === market.tick && copiedFeed.has(`${f.walletId}:${f.tokenId}:${f.side}`) ? { ...f, copied: true } : f)) : get().walletFeed
    quietly(() => set({ portfolio, market, copies, walletFeed }))
    notes.slice(0, 3).forEach((n, i) => get().notify(n, i === 0 ? (n.title.includes('BUY') ? 'buy' : n.tone === 'up' ? 'profit' : 'sell') : undefined))
  }

  /** Online: your coin's dev bag, bundle and hype changed on your side; tell the server so everyone sees it. */
  function sendTokenPatch(tokenId: string) {
    const s = get()
    const t = s.market.tokens.find((x) => x.id === tokenId)
    if (!s.online || !t || t.creator !== 'you') return
    netHooks.send?.({ t: 'patch', tokenId, patch: { devPct: t.devPct, bundlePct: t.bundlePct, bundleWallets: t.bundleWallets, holders: t.holders, top10Pct: t.top10Pct, hype: t.hype, bundleFlagged: t.bundleFlagged } })
  }

  /** Single-player: advance the shared market one tick right here in the browser. */
  function advanceLocal(s: GameState): TickInput {
    const rng = new Rng(s.market.seed)
    const held = Object.keys(s.portfolio.positions)
    const protectedIds = new Set([...held, ...s.watchlist, s.selectedId ?? ''])
    const { market, events: e1 } = tickMarket(s.market, rng, { rugMult: MODES[s.mode].rugMult, protectedIds })
    const e2 = rollEvents(market, rng)
    const wr = tickWallets(s.wallets, market, rng)
    const newPosts = tickSocial(market, rng, wr.actions, [...e1, ...e2])
    const running = s.runStatus === 'running'

    // Dev tools on your launches: volume bots burn your chain coin for fake volume; sleuths hunt bundles.
    const devEvents: MarketEvent[] = []
    // Bot costs are paid by each launch's own dev wallet: wallet id → chain → USD.
    const botCost = new Map<string, Record<Chain, number>>()
    const costOf = (w: string) => botCost.get(w) ?? (botCost.set(w, { sol: 0, bsc: 0, hood: 0 }), botCost.get(w)!)
    const botRuns = new Map<string, BotTickRun>()
    if (running) {
      for (const r of s.launches) {
        const t = market.tokens.find((x) => x.id === r.tokenId)
        if (!t) continue
        if (r.bot?.on) {
          const live = t.status === 'bonding' || t.status === 'graduated'
          const px = nativePrice(market, t.chain)
          const devW = devSet(s.portfolio, r)[0]
          const have = (accountOf(s.portfolio, devW)?.balances[t.chain] ?? 0) * px - costOf(devW)[t.chain]
          if (!live) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: `$${t.ticker} is ${t.status}` })
          else if (r.bot.spent >= r.bot.budget) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: 'budget used up' })
          else if (have < botTickCost(t, r.bot.rate / 5)) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: `out of ${CHAINS[t.chain].native}` })
          else {
            const res = runBotTick(t, r.bot, market, rng)
            costOf(devW)[t.chain] += res.cost
            botRuns.set(r.tokenId, { vol: res.vol, cost: res.cost })
            if (res.event) devEvents.push(res.event)
          }
        }
        if ((r.bundleQty ?? 0) > 0 && sleuthBundle(t, rng)) devEvents.push(flagBundle(t, market, r.bundleWallets ?? 0))
      }
      devEvents.forEach((e, i) => (e.id = market.tick * 100 + 90 + i))
    }
    market.seed = rng.s
    const map = new Map(market.tokens.map((t) => [t.id, t]))

    // Average token return this tick drives rival equity (they trade the same market).
    let sum = 0
    let n = 0
    for (const t of s.market.tokens) {
      const nt = map.get(t.id)
      if (nt && t.status === 'graduated') {
        sum += Math.max(-0.2, Math.min(0.2, nt.price / t.price - 1))
        n++
      }
    }
    const marketReturn = n ? sum / n : 0
    return { market, newEvents: [...e1, ...e2, ...devEvents], wr, newPosts, botRuns, botCost, players: running ? tickRivals(s.players, rng, marketReturn) : s.players }
  }

  function finishRun(reason: string, won: boolean, noBonus = false) {
    // Creator fees still in the vault are paid out first, so they count toward your final result.
    if (get().launches.some((r) => (r.unclaimed ?? 0) > 1e-9)) get().claimCreatorFees(undefined, true)
    const s = get()
    const map = new Map(s.market.tokens.map((t) => [t.id, t]))
    const v = valuePortfolio(s.portfolio, map, s.market)
    const st = portfolioStats(s.portfolio, v)
    const ret = v.equity / s.portfolio.startBalance - 1
    const field = s.players.length + 1
    const rank = 1 + s.players.filter((p) => p.equity / p.startEquity - 1 > ret).length
    let xpBonus = 0
    if (s.mode === 'arena' || s.mode === 'hardcore') xpBonus = rank === 1 ? 300 : rank <= 3 ? 150 : rank <= 10 ? 60 : 10
    if (s.mode === 'challenge') xpBonus = won ? 400 : 20
    if (s.mode === 'hardcore' && won) xpBonus += 150
    if (noBonus) xpBonus = 0
    // Ranked modes feed the weekly season.
    const season = rollSeason()
    const seasonPoints = noBonus || !isRanked(s.mode) ? 0 : placementPoints(s.mode, rank, field, won)
    const result: RunResult = {
      mode: s.mode, won, reason, startBalance: s.portfolio.startBalance, finalEquity: v.equity, returnPct: ret, rank, field,
      trades: st.tradeCount, winRate: st.winRate, xpBonus, seasonPoints,
    }
    const nextSeason = isRanked(s.mode) && !noBonus
      ? { ...season, points: season.points + seasonPoints, rounds: season.rounds + 1, bestRank: Math.min(season.bestRank ?? rank, rank), firsts: season.firsts + (rank === 1 ? 1 : 0) }
      : season
    const p0 = get().profile
    set({
      runStatus: 'finished', result, modal: 'results', sheetOpen: false,
      profile: { ...p0, runsPlayed: p0.runsPlayed + 1, bestReturnPct: Math.max(p0.bestReturnPct, ret), season: nextSeason },
    })
    const before = tierFor(season.points)
    const after = tierFor(nextSeason.points)
    if (after.min > before.min) s.notify({ title: `PROMOTED TO ${after.name.toUpperCase()}`, body: `${after.icon} ${nextSeason.points} season points · still ${after.name} or higher when the season ends = +${after.xp} XP`, tone: 'xp', icon: after.icon }, 'achievement')
    s.sfx(won ? 'achievement' : 'loss')
    gainXp(xpBonus, 'Round bonus', true)
    persist()
  }

  return {
    ...init,
    online: null,
    view: 'discover',
    discoverLayout: 'table',
    backView: 'discover',
    dockTab: 'positions',
    tradeSide: 'buy',
    tradeFocus: 0,
    searchFocus: 0,
    sheetOpen: false,
    instantOpen: load<boolean>('instantOpen') ?? false,
    walletDrawer: null,
    chainFilter: load<'all' | Chain>('chainFilter') ?? 'all',
    swapOpen: false,
    walletsOpen: false,
    sideQueue: [],
    pnlOpen: load<boolean>('pnlOpen') ?? false,
    roundLength: load<RoundLength>('roundLength') ?? 'default',
    tracker: { ...DEFAULT_TRACKER, ...(load<Partial<TrackerSettings>>('tracker') ?? {}) },
    rewards: { ...freshRewards(), ...(load<RewardsState>('rewards') ?? {}) },
    paused: false,
    toasts: [],

    tick: (net) => {
      const s = get()
      // Online, the server advances the market and hands the result in as `net`; the local clock stands down.
      if (!net && (s.paused || s.online)) return
      const { market, newEvents, wr, newPosts, botRuns, botCost, players } = net ?? advanceLocal(s)
      const held = Object.keys(s.portfolio.positions)
      const prevIds = new Set(s.market.tokens.map((t) => t.id))
      const running = s.runStatus === 'running'
      const map = new Map(market.tokens.map((t) => [t.id, t]))

      let portfolio = s.portfolio
      for (const [walletId, cost] of botCost) {
        const view = viewOf(portfolio, walletId)
        const balances = { ...view.balances }
        let usd = 0
        for (const c of CHAIN_IDS_LOCAL) {
          balances[c] = Math.max(0, balances[c] - cost[c] / nativePrice(market, c))
          usd += cost[c]
        }
        portfolio = commitView(portfolio, walletId, { ...view, balances, feesPaid: view.feesPaid + usd })
      }
      const v = valuePortfolio(portfolio, map, market)
      if (running) portfolio = snapshot(portfolio, v.equity, market.tick, market.time)
      let runStats = s.runStats
      for (const e of newEvents) {
        if (running && e.kind === 'graduation' && e.tokenId && held.includes(e.tokenId)) runStats = { ...runStats, gradsHeld: runStats.gradsHeld + 1 }
      }

      // Creator economics for tokens you cooked: a cut of every tick's volume, plus a graduation bonus.
      let launches = s.launches
      const graduatedNow: string[] = []
      const botStops: string[] = []
      if (running && launches.length) {
        const oldMap = new Map(s.market.tokens.map((t) => [t.id, t]))
        // Creator fees (like pump.fun's creator vault) pile up unclaimed, in the coin's chain coin, until you claim them.
        launches = launches.map((r) => {
          const nt = map.get(r.tokenId)
          if (!nt) return r
          const old = oldMap.get(r.tokenId)
          const justGrad = !r.graduated && nt.status === 'graduated'
          // Everything the coin has earned since last tick (from 0 for a coin you just cooked).
          const fee = Math.max(0, (nt.creatorFees ?? 0) - (old ? old.creatorFees ?? 0 : nt.creatorFees ?? 0)) + (justGrad ? GRAD_BONUS : 0)
          const unclaimed = (r.unclaimed ?? 0) + fee / nativePrice(market, nt.chain)
          if (justGrad) graduatedNow.push(nt.ticker)
          const run = botRuns.get(r.tokenId)
          let bot = r.bot
          if (bot && run) {
            bot = run.stop ? { ...bot, on: false } : { ...bot, spent: bot.spent + run.cost, volume: bot.volume + run.vol }
            if (run.stop) {
              botStops.push(`${nt.ticker}: ${run.stop}`)
              if (s.online) netHooks.send?.({ t: 'bot', tokenId: r.tokenId, bot: null })
            }
          }
          return { ...r, bot, fees: r.fees + fee, unclaimed, peakMcap: Math.max(r.peakMcap, nt.mcap), lastMcap: nt.mcap, status: nt.status, graduated: r.graduated || nt.status === 'graduated' }
        })
        if (graduatedNow.length) runStats = { ...runStats, cookedGrads: (runStats.cookedGrads ?? 0) + graduatedNow.length }
      }

      const feedItems: WalletFeedItem[] = wr.actions.map((a, i) => {
        const t = map.get(a.tokenId)
        return { id: market.tick * 1000 + i, tick: market.tick, time: market.time, walletId: a.walletId, tokenId: a.tokenId, ticker: t?.ticker ?? '?', emoji: t?.emoji ?? '❔', hue: t?.hue ?? 0, side: a.side, usd: a.usd, fraction: a.fraction, copied: false, kind: a.kind, mcap: a.mcap }
      })

      // Rooms: bot costs are charged on the server too (this shows them right away).
      quietly(() => set({
        market,
        portfolio,
        runStats,
        launches,
        wallets: wr.wallets,
        // Posts that reference a token track the peak MC since they were made (for callout scoring).
        socialFeed: [...newPosts.reverse(), ...s.socialFeed].slice(0, 150).map((p) => {
          const t = p.tokenId ? map.get(p.tokenId) : undefined
          return t && p.peakMcap !== undefined && t.mcap > p.peakMcap ? { ...p, peakMcap: t.mcap } : p
        }),
        walletFeed: feedItems.length ? [...feedItems.reverse(), ...s.walletFeed].slice(0, 120) : s.walletFeed,
        // Each event remembers the coin's MC when it happened (the Events tab shows the move since).
        events: newEvents.length ? [...newEvents.reverse().map((e) => (e.tokenId && e.mcap === undefined ? { ...e, mcap: map.get(e.tokenId)?.mcap } : e)), ...s.events].slice(0, 200) : s.events,
        players,
        runTicks: running ? s.runTicks + 1 : s.runTicks,
      }))

      // Notifications: anything touching your bags or watchlist, market-wide moves, and a throttled sample of the rest.
      const eventToasts = s.settings.eventToasts !== false && useFlags.getState().eventPopups
      for (const e of newEvents) {
        const mine = e.tokenId && (held.includes(e.tokenId) || s.watchlist.includes(e.tokenId))
        const ev = { kind: 'event' as const, tokenId: e.tokenId }
        if (e.kind === 'rug' && e.tokenId && held.includes(e.tokenId)) {
          s.notify({ title: 'POSITION RUGGED', body: e.text, tone: 'down', icon: '💀', ...ev }, 'rug')
        } else if (!eventToasts) {
          continue
        } else if (mine || e.kind === 'marketup' || e.kind === 'marketdown') {
          s.notify({ title: mine ? 'YOUR TOKEN' : 'MARKET EVENT', body: e.text, tone: e.tone, icon: e.icon, ...ev }, 'alert')
        } else if (e.kind === 'viral' && e.icon === '🚀') {
          // A coin going parabolic is the moment to look: always shown, with a quick-buy on the toast.
          s.notify({ title: 'GOING PARABOLIC', body: e.text, tone: 'up', icon: '🚀', ...ev }, 'alert')
        } else if (market.tick - lastEventToast > 14 && ['whale', 'trending', 'rug', 'graduation', 'kol'].includes(e.kind)) {
          lastEventToast = market.tick
          s.notify({ title: 'NEW MARKET EVENT', body: e.text, tone: e.tone, icon: e.icon, ...ev })
        }
      }

      if (running) {
        runCopies(wr.actions)
        if (REFERRALS_ENABLED) set({ rewards: tickFriends(get().rewards, market.sentiment) })
      }
      // Tracked (not copied) wallets: alerts per your tracker settings, with a quick-buy on the toast.
      const copiedIds = new Set(get().copies.filter((c) => !c.paused).map((c) => c.walletId))
      const tr = s.tracker
      const trackedActs = wr.actions.filter((a) => s.trackedWallets.includes(a.walletId) && !copiedIds.has(a.walletId) && shouldAlert(tr, a, map.get(a.tokenId), market.time, s.walletLabels)).slice(0, 2)
      const holders = trackedActs.length && tr.clusterMin > 0 ? trackedHolders(wr.wallets, s.trackedWallets) : null
      for (const a of trackedActs) {
        const w = wr.wallets.find((x) => x.id === a.walletId)
        const t = map.get(a.tokenId)
        if (!w || !t) continue
        const n = holders?.get(t.id) ?? 0
        const cluster = a.side === 'buy' && tr.clusterMin > 0 && n >= tr.clusterMin
        const what = a.side === 'buy' ? (a.kind === 'first' ? 'first buy' : 'bought more') : a.kind === 'all' ? 'sold all' : 'sold'
        const toast = {
          title: cluster ? `🔥 ${n} WALLETS IN` : 'TRACKED WALLET',
          body: `${s.walletLabels[w.id]?.label || w.name} ${what} ${fmtUsd(a.usd, 0)} of $${t.ticker} · ${fmtCompact(t.mcap)} MC`,
          tone: a.side === 'buy' ? ('up' as const) : ('down' as const),
          icon: w.avatar,
          tokenId: t.id,
          kind: 'tracker' as const,
        }
        if (tr.alertPopup) s.notify(toast, tr.alertSound ? 'alert' : undefined)
        else if (tr.alertSound) s.sfx('alert')
      }
      // Posts from accounts you follow.
      const followedPost = newPosts.find((p) => s.followedAccounts.includes(callerKey(p)) && !(p.accountId === 'player' && p.author?.pid === s.online?.you))
      if (followedPost) {
        const acc = ACCOUNTS.find((x) => x.id === followedPost.accountId)
        const handle = acc?.handle ?? followedPost.author?.handle ?? 'player'
        if (followedPost.isCall && followedPost.tokenId) {
          // Callout Tracker alert: a caller you follow just called a coin (with quick-buy on the toast).
          s.notify({ title: 'CALLOUT', body: `@${handle} called $${followedPost.ticker} at ${fmtCompact(followedPost.mcapAtPost ?? 0)} MC`, tone: 'info', icon: acc?.avatar ?? followedPost.author?.avatar ?? '📣', tokenId: followedPost.tokenId }, 'alert')
        } else s.notify({ title: acc?.platform === 'tg' ? 'TG POST' : 'NEW POST', body: `@${handle}: ${followedPost.text.split('\n')[0]}`, tone: 'info', icon: acc?.avatar ?? '📣' }, 'alert')
      }
      // Price alerts (one-shot).
      const fired: PriceAlert[] = []
      const alerts = s.alerts.map((al) => {
        if (al.triggeredTick !== undefined) return al
        const t = map.get(al.tokenId)
        if (!t) return al
        const pct = (t.mcap / al.baseMcap - 1) * 100
        const hit = al.type === 'mcAbove' ? t.mcap >= al.value : al.type === 'mcBelow' ? t.mcap <= al.value : al.type === 'pctUp' ? pct >= al.value : pct <= -al.value
        if (!hit) return al
        const done = { ...al, triggeredTick: market.tick }
        fired.push(done)
        return done
      })
      if (fired.length) {
        set({ alerts })
        for (const al of fired) {
          const t = map.get(al.tokenId)!
          s.notify({ title: 'PRICE ALERT', body: `$${al.ticker} ${alertText(al)} · now ${fmtCompact(t.mcap)} MC`, tone: al.type === 'mcAbove' || al.type === 'pctUp' ? 'up' : 'down', icon: '🔔' }, 'alert')
        }
      }

      // Your calls on the timeline: track each coin's best price since the call and judge it after ~5 minutes.
      const soc0 = get().profile.social
      if (soc0?.calls.some((c) => !c.settled)) {
        const judged: { ticker: string; x: number; likes: number; tokenId: string }[] = []
        let changed = false
        const calls = soc0.calls.map((c) => {
          if (c.settled) return c
          const t = map.get(c.tokenId)
          const peak = t ? Math.max(c.peak, t.mcap) : c.peak
          if (market.tick - c.tick >= CALL_SETTLE_TICKS) {
            const x = t && t.status !== 'rugged' && t.status !== 'dead' ? peak / c.mcapAtPost : Math.min(0.5, peak / c.mcapAtPost)
            judged.push({ ticker: c.ticker, x, likes: c.likes, tokenId: c.tokenId })
            changed = true
            return { ...c, peak, settled: true, x }
          }
          if (peak !== c.peak) changed = true
          return peak !== c.peak ? { ...c, peak } : c
        })
        if (changed) {
          let soc: SocialProfile = { ...soc0, calls }
          for (const j of judged) {
            const before = soc
            soc = settleCall(soc, j.x, j.likes)
            const dRep = Math.round(soc.rep - before.rep)
            const dF = soc.followers - before.followers
            s.notify({ title: j.x >= 1.5 ? 'CALL HIT 🎯' : j.x >= 1.1 ? 'CALL OK' : 'CALL MISSED', body: `$${j.ticker} ran ${j.x.toFixed(1)}x after your call · rep ${dRep >= 0 ? '+' : ''}${dRep} · ${dF >= 0 ? '+' : ''}${Math.abs(dF) < 1000 ? dF : fmtCompact(dF, '')} followers`, tone: j.x >= 1.1 ? 'up' : 'down', icon: j.x >= 1.5 ? '🎯' : '📉', tokenId: j.tokenId })
            if (before.followers < KOL_FOLLOWERS && soc.followers >= KOL_FOLLOWERS) s.notify({ title: 'YOU ARE A KOL NOW 👑', body: `${fmtCompact(soc.followers, '')} followers. Your calls move real money now.`, tone: 'xp', icon: '👑' }, 'achievement')
          }
          set({ profile: { ...get().profile, social: soc } })
        }
      }

      for (const msg of botStops) s.notify({ title: 'VOLUME BOT STOPPED', body: `$${msg}`, tone: 'warn', icon: '🤖' }, 'alert')
      for (const tk of graduatedNow) {
        s.notify({ title: 'YOUR TOKEN GRADUATED', body: `$${tk} completed its curve and migrated · +${fmtUsd(GRAD_BONUS, 0)} creator bonus`, tone: 'xp', icon: '🎓' }, 'achievement')
        gainXp(150, `$${tk} graduated`, true)
      }

      if (!running) return
      runSnipers(market.tokens.filter((t) => !prevIds.has(t.id) && t.creator !== 'you').map((t) => t.id))
      // Delayed side-wallet buys on your launches that are due now.
      const due = get().sideQueue.filter((q) => q.atTick <= market.tick)
      if (due.length) {
        set({ sideQueue: get().sideQueue.filter((q) => q.atTick > market.tick) })
        for (const q of due) {
          const tk = get().market.tokens.find((x) => x.id === q.tokenId)
          if (tk && (tk.status === 'bonding' || tk.status === 'graduated')) buyFrom([q.walletId], q.amount * nativePrice(get().market, tk.chain), q.tokenId, undefined, 'SIDE BUY')
        }
      }
      const cur = get()
      const v2 = valuePortfolio(cur.portfolio, map, market)
      const growth = v2.equity / cur.portfolio.startBalance - 1

      // Holding XP & milestones.
      if (cur.runTicks % 60 === 0 && v2.greenPositions > 0) gainXp(v2.greenPositions * 2, 'Holding green positions', true)
      for (const [pct, xp] of [[25, 50], [50, 100], [100, 200], [200, 400]] as const) {
        if (growth * 100 >= pct && !get().runStats.milestones.includes(pct)) {
          set({ runStats: { ...get().runStats, milestones: [...get().runStats.milestones, pct] } })
          get().notify({ title: `MILESTONE +${pct}%`, body: `Portfolio up ${pct}% this round`, tone: 'up', icon: '🏁' }, 'achievement')
          gainXp(xp, `+${pct}% milestone`, true)
        }
      }

      // Challenges.
      const { list, completed } = evaluateChallenges(cur.challenges, challengeCtx(cur.portfolio, market, get().runStats))
      if (list !== cur.challenges) set({ challenges: list })
      for (const c of completed) {
        get().notify({ title: 'CHALLENGE COMPLETED', body: `${c.title} · +${c.xp} XP`, tone: 'xp', icon: '🏆' }, 'achievement')
        gainXp(c.xp, c.title, true)
      }

      // Round end conditions.
      const cfg = MODES[cur.mode]
      if (cfg.target && v2.equity >= cfg.target) finishRun(`Target ${fmtCompact(cfg.target)} reached`, true)
      else if (cur.mode === 'hardcore' && v2.equity < 500) finishRun('Busted — equity fell below $500', false)
      else if (cur.runDuration && get().runTicks >= cur.runDuration) {
        const won = cur.mode === 'challenge' ? false : growth > 0
        finishRun("Time's up", won)
      }
      if (market.tick % 5 === 0) persist()
    },

    buy: (usd, tokenId, slot) => {
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to trade', tone: 'warn', icon: '⏸' })
        return false
      }
      const id = tokenId ?? s.selectedId
      if (!id) return false
      // The amount is split evenly across the selected wallets (5 SOL over 5 wallets = 1 SOL each); they buy one after
      // another against the same pool.
      const ids = activeAccounts(s.portfolio).map((a) => a.id)
      return buyFrom(ids, usd / Math.max(1, ids.length), id, slot)
    },

    sell: (qty, tokenId, slot, scope = 'active') => {
      if (watchingOnly()) return false
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to trade', tone: 'warn', icon: '⏸' })
        return false
      }
      const id = tokenId ?? s.selectedId
      if (!id) return false
      const tokS = s.market.tokens.find((x) => x.id === id)
      const setting = tokS ? slotSetting(s.settings, tokS.chain, 'sell', slot) : undefined
      // `qty` is out of what the chosen wallets hold; each one sells the same fraction of its own bag.
      const pool = Array.isArray(scope)
        ? (s.portfolio.accounts ?? []).filter((a) => scope.includes(a.id))
        : scope === 'all' ? s.portfolio.accounts ?? [] : scope === 'active' ? activeAccounts(s.portfolio) : (s.portfolio.accounts ?? []).filter((a) => a.id === scope)
      const holders = pool.filter((a) => (a.positions[id]?.qty ?? 0) > 0)
      const held = holders.reduce((acc, a) => acc + a.positions[id].qty, 0)
      if (!(held > 0)) {
        s.notify({ title: 'ORDER REJECTED', body: scope === 'all' ? 'No position to sell' : 'Your selected wallets hold none of this — switch wallets or sell from Portfolio', tone: 'warn', icon: '⛔' }, 'alert')
        return false
      }
      const frac = Math.min(1, qty / held)
      const legs = holders.map((a) => ({ walletId: a.id, qty: frac >= 0.999999 ? a.positions[id].qty : a.positions[id].qty * frac }))
      const r = runSell(s.portfolio, s.market, legs, id, { setting })
      let portfolio = r.portfolio
      let market = r.market
      // Solo: your copy traders sell the same share behind you (in rooms the server does this).
      if (!s.online && r.fills.length && tokS) {
        // Only what your main (public) wallet sold counts: copy traders can't see your side wallets.
        const main = s.portfolio.accounts?.[0]
        const mainHeld = main?.positions[id]?.qty ?? 0
        const mainLeg = legs.find((l) => l.walletId === main?.id)
        const wave = mainLeg && mainHeld > 0 ? copySells(market, new Rng((Math.random() * 2 ** 32) >>> 0), market.tokens.find((x) => x.id === id) ?? tokS, Math.min(1, mainLeg.qty / mainHeld), soloCopyBook) : null
        if (wave) market = { ...market, shillQueue: [...(market.shillQueue ?? []), ...wave.queue] }
      }
      const { fills, failures } = r
      if (s.online && netHooks.order) portfolio = tagRef(portfolio, fills.length, netHooks.order({ side: 'sell', tokenId: id, legs, setting }))
      if (!fills.length) {
        quietly(() => set({ portfolio }))
        s.notify({ title: failures[0]?.includes('Slippage') ? 'TX FAILED' : 'ORDER REJECTED', body: failures.join(' · '), tone: 'warn', icon: '⛔' }, 'alert')
        return false
      }
      fills.forEach(sandwichNote)
      const tr = { ...fills[0], pnl: fills.reduce((a, f) => a + (f.pnl ?? 0), 0), value: fills.reduce((a, f) => a + f.value, 0) }
      const costSold = fills.reduce((a, f) => a + f.value - f.fee - (f.gas ?? 0) - (f.pnl ?? 0), 0)
      tr.pnlPct = costSold > 0 ? (tr.pnl ?? 0) / costSold : 0
      const res = { portfolio, trade: tr }
      const closed = !res.portfolio.positions[id]
      const pnl = tr.pnl ?? 0
      let events = s.events
      let launches = s.launches
      const tok = s.market.tokens.find((x) => x.id === id)
      if (tok?.creator === 'you') {
        // Sells come out of the bundle wallets first: they look like random holders selling, until the bundle is
        // flagged. Dev-wallet sells are public, and holders panic in proportion to how much of the dev bag you dumped.
        // Only the dev (deployer) wallet counts as the dev here. Side wallets sleuths linked sell like anyone, but
        // traders watching them get a little nervous; unlinked side wallets sell like anyone at all.
        const rec = s.launches.find((r) => r.tokenId === id)
        const [devW, ...linked] = devSet(s.portfolio, rec)
        const devWBefore = qtyIn(s.portfolio, [devW], id)
        const devWAfter = qtyIn(res.portfolio, [devW], id)
        const linkedBefore = qtyIn(s.portfolio, linked, id)
        const linkedFrac = linkedBefore > 0 ? Math.min(1, (linkedBefore - qtyIn(res.portfolio, linked, id)) / linkedBefore) : 0
        const bundleBefore = Math.min(rec?.bundleQty ?? 0, devWBefore)
        const fromBundle = Math.min(bundleBefore, devWBefore - devWAfter)
        const fromDev = devWBefore - devWAfter - fromBundle
        const devBefore = devWBefore - bundleBefore
        const devFrac = devBefore > 0 ? Math.min(1, fromDev / devBefore) : 0
        const bundleFrac = bundleBefore > 0 ? fromBundle / bundleBefore : 0
        const bundleLeft = devWAfter <= 0 ? 0 : bundleBefore - fromBundle
        if (rec) launches = s.launches.map((r) => (r.tokenId === id ? { ...r, bundleQty: bundleLeft } : r))
        const stake = devStake(res.portfolio, rec ? { ...rec, bundleQty: bundleLeft } : undefined, id)
        market = patchToken(market, id, (x) => {
          x.devPct = stake.devPct
          x.bundlePct = stake.bundlePct
          x.sim.pressure -= 0.012 * devFrac + (x.bundleFlagged ? 0.007 : 0.002) * bundleFrac + 0.004 * linkedFrac
          x.hype = Math.max(0, x.hype - 30 * devFrac - (x.bundleFlagged ? 15 : 3) * bundleFrac - 8 * linkedFrac)
        })
        const evs: MarketEvent[] = []
        if (fromDev > 0) {
          evs.push({
            id: s.market.tick * 100 + 98, tick: s.market.tick, time: s.market.time, kind: 'devsell', tokenId: id, ticker: tok.ticker,
            text: `Dev (you) sold ${Math.round(devFrac * 100)}% of their $${tok.ticker} bag`, icon: '🧑‍💻', tone: 'down',
          })
        }
        if (fromBundle > 0 && tok.bundleFlagged) {
          evs.push({
            id: s.market.tick * 100 + 95, tick: s.market.tick, time: s.market.time, kind: 'bundle', tokenId: id, ticker: tok.ticker,
            text: `Flagged bundle wallets are dumping $${tok.ticker} (${Math.round(bundleFrac * 100)}% of the bundle sold)`, icon: '📦', tone: 'down',
          })
        }
        events = [...evs, ...events].slice(0, 120)
        if (s.online) for (const e of evs) netHooks.send?.({ t: 'event', event: e }) // everyone sees the dev dump
      }
      quietly(() => set({ portfolio: res.portfolio, market, events, launches, profile: { ...s.profile, lifetimeTrades: s.profile.lifetimeTrades + fills.length } }))
      if (tok?.creator === 'you') sendTokenPatch(id)
      s.notify(
        { title: `${closed ? 'POSITION CLOSED' : 'SELL EXECUTED'}${fills.length > 1 ? ` · ${fills.length} WALLETS` : ''}`, body: `$${tr.ticker} ${pnl >= 0 ? '+' : ''}${fmtUsd(pnl)} (${fmtPct(tr.pnlPct ?? 0)})${failures.length ? ` · ${failures.length} failed` : ''}`, tone: pnl >= 0 ? 'up' : 'down', icon: pnl >= 0 ? '💰' : '🩸' },
        pnl >= 0 ? 'profit' : 'loss',
      )
      if (failures.length) s.notify({ title: 'SOME WALLETS FAILED', body: failures.join(' · '), tone: 'warn', icon: '⚠️' })
      if (pnl > 0) gainXp(15 + Math.min(50, ((tr.pnlPct ?? 0) * 100) / 2), `Profitable trade on $${tr.ticker}`)
      persist()
      return true
    },

    // Opening a coin remembers the page it came from, so Back / Esc return there (e.g. Trenches).
    select: (id, open = true) => set((s) => ({ selectedId: id, ...(open ? { view: 'token' as View, backView: s.view === 'token' ? s.backView : s.view } : {}) })),
    setView: (view) => set({ view }),
    setDockTab: (dockTab) => set({ dockTab }),
    setDiscoverLayout: (discoverLayout) => set({ discoverLayout }),
    setModal: (modal) => set({ modal }),
    checkSeason: () => {
      rollSeason()
    },
    // tradeFocus is a timestamp: panels mounted/updated within a moment of it grab focus.
    requestTrade: (side) =>
      set((s) => ({
        tradeSide: side,
        tradeFocus: Date.now(),
        sheetOpen: true,
        ...(window.innerWidth < 1024 && s.selectedId ? { view: 'token' as View } : {}),
      })),
    setTradeSide: (tradeSide) => set({ tradeSide }),
    setSheetOpen: (sheetOpen) => set({ sheetOpen }),
    toggleInstant: (open) => {
      const instantOpen = open ?? !get().instantOpen
      set({ instantOpen })
      save('instantOpen', instantOpen)
    },
    focusSearch: () => set((s) => ({ searchFocus: s.searchFocus + 1 })),
    toggleWatch: (id) => {
      const s = get()
      const on = !s.watchlist.includes(id)
      set({ watchlist: on ? [...s.watchlist, id] : s.watchlist.filter((x) => x !== id) })
      const t = s.market.tokens.find((x) => x.id === id)
      if (t) s.notify({ title: on ? 'ADDED TO WATCHLIST' : 'REMOVED FROM WATCHLIST', body: `$${t.ticker}`, tone: 'info', icon: on ? '⭐' : '☆' }, 'click')
      persist()
    },
    // A shared market can't be paused by one player.
    togglePause: () => set((s) => (s.online ? {} : { paused: !s.paused })),
    updateSettings: (patch) => {
      const settings = { ...get().settings, ...patch }
      set({ settings })
      save('settings', settings)
    },

    setRoundLength: (len) => {
      set({ roundLength: len })
      save('roundLength', len)
    },
    endRun: () => {
      const s = get()
      if (s.runStatus !== 'running') return
      const map = new Map(s.market.tokens.map((t) => [t.id, t]))
      const growth = valuePortfolio(s.portfolio, map, s.market).equity / s.portfolio.startBalance - 1
      // Ending very early doesn't pay a round bonus, so a quick start-and-quit can't farm XP.
      finishRun('You ended the round', s.mode === 'challenge' ? false : growth > 0, s.runTicks < MIN_BONUS_TICKS)
    },

    startRun: (mode, opts) => {
      // Picked a different market engine (Classic / Realistic)? Solo rounds then start on a fresh market of that kind.
      const engine = get().settings.engine ?? 'classic'
      if (!get().online && (get().market.engine ?? 'classic') !== engine) {
        const market = createMarket((Math.random() * 2 ** 32) >>> 0, undefined, engine)
        set({ market, wallets: createWallets(new Rng((market.seed ^ 0xa11ce) >>> 0)), events: [], socialFeed: [], walletFeed: [], selectedId: defaultSelection(market), watchlist: [] })
      }
      const s = get()
      const balance = s.online?.round.world ? WORLD_START_BALANCE : startBalanceFor(mode, s.settings, !!s.online)
      const runDuration = opts?.durationTicks !== undefined ? opts.durationTicks : lengthTicks(mode, s.roundLength)
      // Your wallets carry over to the new round (emptied); the bank starts with the mode's balance.
      const portfolio = ensureAccounts({
        ...newPortfolio(balance),
        accounts: (s.portfolio.accounts ?? []).map((a) => ({ ...a, balances: emptyBalances(), positions: {} })),
        active: s.portfolio.active,
      })
      const stats = freshRunStats()
      set({
        mode, runDuration, portfolio, runStatus: 'running', runTicks: 0, runStats: stats, result: null, modal: null, paused: false, launches: [], lastCookTick: -999, copies: [], sideQueue: [], snipers: s.snipers.map((x) => ({ ...x, holdings: {}, stats: { snipes: 0, spent: 0, realized: 0, skipped: 0, sells: 0 } })), rewards: { ...s.rewards, cashbackClaimed: 0, cashback: { ...cashbackOf(s.rewards), pending: { sol: 0, bsc: 0, hood: 0 }, roundVolume: 0, roundUsd: 0 } },
        challenges: createChallenges(challengeCtx(portfolio, s.market, stats)),
        // Online, your rivals are the other players in the room.
        players: s.online ? roomRivals(s.online) : createRivals(new Rng((s.market.seed ^ 0x5bd1e995) >>> 0), balance, mode),
        view: 'discover',
      })
      if (s.online?.round.world) s.notify(s.online.spectator
        ? { title: 'WATCHING THE WORLD', body: 'Everything here is live and shared by everyone. Sign in to trade.', tone: 'info', icon: '🌍' }
        : { title: 'WELCOME TO THE WORLD', body: 'One market for everyone, always running. Your wallet is saved to your account.', tone: 'info', icon: '🌍' }, 'achievement')
      else s.notify({ title: `${MODES[mode].name.toUpperCase()} STARTED`, body: `${fmtUsd(balance, 0)} virtual USD · ${modeTagline(mode, runDuration)}${s.online ? ` · room ${s.online.code}` : ''}`, tone: 'info', icon: '🚀' }, 'achievement')
      if (!opts?.silent) s.notify({ title: 'PICK YOUR CHAINS', body: 'Solana coins cost SOL, BNB Chain costs BNB, Robinhood Chain costs ETH. Swap from the wallet chip, or let auto-swap cover buys.', tone: 'info', icon: '🔄' })
      persist()
    },

    patchState: (patch) => set(patch),
    leaveRoom: () => {
      netHooks.send = null
      remove('mpRoom')
      const you = get().online?.you
      if (you) remove(`mpSave:${you}`)
      // Your single-player save was never touched while online; reloading brings it back.
      location.reload()
    },
    endRoundOnline: () => {
      const s = get()
      if (!s.online || s.runStatus !== 'running') return
      const map = new Map(s.market.tokens.map((t) => [t.id, t]))
      const growth = valuePortfolio(s.portfolio, map, s.market).equity / s.portfolio.startBalance - 1
      finishRun('Round over', s.mode === 'challenge' ? false : growth > 0)
    },

    resetGame: () => {
      remove('run')
      const s = get()
      const market = createMarket((Math.random() * 2 ** 32) >>> 0, undefined, s.settings.engine ?? 'classic')
      const portfolio = ensureAccounts(newPortfolio(s.settings.practiceBalance))
      set({
        market, events: [], portfolio, runStatus: 'select', runTicks: 0, runStats: freshRunStats(), result: null, launches: [], lastCookTick: -999, copies: [], sideQueue: [], walletFeed: [], socialFeed: [], alerts: [], wallets: createWallets(new Rng((market.seed ^ 0xa11ce) >>> 0)),
        challenges: createChallenges(challengeCtx(portfolio, market, freshRunStats())), watchlist: [],
        players: createRivals(new Rng(market.seed ^ 77), portfolio.startBalance, 'practice'),
        selectedId: defaultSelection(market), modal: 'mode', view: 'discover', toasts: [],
      })
    },

    resetProgress: () => {
      remove('profile')
      remove('rewards')
      set({ profile: { ...DEFAULT_PROFILE }, rewards: freshRewards() })
      get().resetGame()
    },

    notify: (t, sfx) => {
      const s = get()
      if (sfx) s.sfx(sfx)
      if (!s.settings.notifications && t.tone !== 'xp' && !t.title.startsWith('ORDER')) return
      set({ toasts: [...s.toasts, { ...t, id: toastSeq++ }].slice(-5) })
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    sfx: (kind) => {
      if (get().settings.sound) playSfx(kind)
    },

    cook: (spec) => {
      if (watchingOnly()) return null
      const s = get()
      const fail = (body: string) => {
        s.notify({ title: 'CAN’T COOK', body, tone: 'warn', icon: '🍳' }, 'alert')
        return null
      }
      if (s.runStatus !== 'running') return fail('Start a round to launch tokens')
      const err = validateCook(spec, s.market.tokens, !!s.online)
      if (err) return fail(err)
      const limit = cookAllowance(!!s.online?.round.world, s.launches.map((l) => l.launchedTick), s.market.tick, secPerTickOf(s.market))
      if (limit.blocked) return fail(limit.blocked)
      if (s.market.tick - s.lastCookTick < COOK_COOLDOWN_TICKS) return fail(`Kitchen cooling down — ${COOK_COOLDOWN_TICKS - (s.market.tick - s.lastCookTick)}s`)
      // Launch fee + marketing are paid in USD; the dev buy is paid in the chain's coin (auto-swapped if enabled).
      const bundle = spec.bundle ?? { wallets: 0, perWallet: 0, stagger: false }
      const bundleNative = bundle.wallets > 0 ? bundle.wallets * bundle.perWallet : 0
      const bundleUsd = bundleNative * nativePrice(s.market, spec.chain)
      const bundleFees = bundleNative > 0 ? bundle.wallets * BUNDLE_WALLET_FEE + (bundle.stagger ? bundleUsd * STAGGER_FEE : 0) : 0
      const usdCosts = COOK_FEE + spec.marketing + bundleFees
      const devUsd = (spec.devBuy + bundleNative) * nativePrice(s.market, spec.chain)
      // The deployer (dev) wallet pays the dev buy and bundle and earns the creator fees. Defaults to your primary.
      const devId = spec.devWallet && accountOf(s.portfolio, spec.devWallet) ? spec.devWallet : primaryId(s.portfolio)
      const nativeUsd = (accountOf(s.portfolio, devId)?.balances[spec.chain] ?? 0) * nativePrice(s.market, spec.chain)
      if (usdCosts > s.portfolio.cash + 1e-9) return fail(`Need ${fmtUsd(usdCosts)} USD for fees + marketing — you have ${fmtUsd(s.portfolio.cash)}`)
      const devShort = Math.max(0, devUsd - nativeUsd)
      if (devShort > 0 && (!s.settings.autoSwap || devShort > s.portfolio.cash - usdCosts + 1e-9)) {
        return fail(`Not enough ${CHAINS[spec.chain].native} for the dev buy and bundle — swap USD into ${CHAINS[spec.chain].native} first`)
      }

      const rng = new Rng((s.market.seed ^ Math.imul(s.market.tick + 1, 0x9e3779b1)) >>> 0)
      const cooked = cookToken(s.market, rng, spec)
      const fresh = s.online ? structuredClone(cooked.token) : null // rooms: the server runs the dev buy / bundle on the fresh coin
      let market = cooked.market
      const devView = viewOf(s.portfolio, devId)
      let portfolio: Portfolio = { ...devView, cash: devView.cash - COOK_FEE - spec.marketing - bundleFees, feesPaid: devView.feesPaid + COOK_FEE + bundleFees }
      const id = cooked.token.id
      if (spec.devBuy > 0) {
        const res = executeBuy(portfolio, market, id, spec.devBuy * nativePrice(market, spec.chain), portfolio.trades.length + 1, { autoSwap: s.settings.autoSwap })
        if (res.ok) {
          portfolio = res.portfolio
          market = res.market
        }
      }
      // Bundle: the rest of the opening buys come from your side wallets in the same block (or spread over a few).
      let bundleQty = 0
      let bundleEvent: MarketEvent | null = null
      if (bundleNative > 0) {
        const res = executeBuy(portfolio, market, id, bundleUsd, portfolio.trades.length + 1, { autoSwap: s.settings.autoSwap })
        if (res.ok) {
          bundleQty = res.trade.qty
          portfolio = { ...res.portfolio, trades: [{ ...res.trade, via: `Bundle ×${bundle.wallets}` }, ...res.portfolio.trades.slice(1)] }
          market = res.market
        }
      }
      portfolio = commitView(s.portfolio, devId, portfolio, devView.trades.length)
      const pos = qtyIn(portfolio, [devId], id) // dev % = the deployer wallet's bag only
      market = patchToken(market, id, (x) => {
        const split = splitBag(pos, bundleQty)
        x.devPct = split.devPct
        if (bundleQty > 0) {
          x.bundlePct = split.bundlePct
          x.bundleWallets = bundle.wallets
          x.holders += bundle.wallets
          x.top10Pct = Math.min(95, x.top10Pct + split.bundlePct * Math.min(1, 10 / bundle.wallets) * 0.8)
          // Your wallets show up on the tape as ordinary buyers.
          const usd = bundleUsd / bundle.wallets
          const fresh = Array.from({ length: Math.min(bundle.wallets, 12) }, (_, i) => ({ id: market.nextTradeId + i, time: market.time, side: 'buy' as const, usd: usd * (0.8 + 0.4 * rng.next()), price: x.price, wallet: walletName(rng) }))
          x.tape = [...fresh, ...x.tape.slice(1)].slice(0, 40)
          if (bundle.stagger) x.snipers += 2 // spreading the buys lets a couple of snipers in between
          if (rng.chance(bundleDetectChance(bundle.wallets, split.bundlePct, bundle.stagger))) bundleEvent = flagBundle(x, market, bundle.wallets)
        }
      })
      market = { ...market, nextTradeId: market.nextTradeId + 12 }
      const t = market.tokens.find((x) => x.id === id)!
      const record: LaunchRecord = {
        tokenId: t.id, ticker: t.ticker, name: t.name, emoji: t.emoji, image: t.image, hue: t.hue, launchedTick: s.market.tick, launchedTime: s.market.time,
        spent: COOK_FEE + spec.marketing + bundleFees, fees: 0, peakMcap: t.mcap, lastMcap: t.mcap, status: t.status, graduated: false,
        chain: t.chain, devWallet: devId, ...(bundleQty > 0 ? { bundleQty, bundleWallets: bundle.wallets } : {}),
      }
      const cookEvents = bundleEvent ? [bundleEvent, cooked.event] : [cooked.event]
      quietly(() => set({
        market, portfolio,
        launches: [record, ...s.launches],
        lastCookTick: s.market.tick,
        runStats: { ...s.runStats, cooked: (s.runStats.cooked ?? 0) + 1 },
        events: [...cookEvents, ...s.events].slice(0, 120),
        watchlist: s.watchlist.includes(t.id) ? s.watchlist : [...s.watchlist, t.id],
        profile: { ...s.profile, lifetimeTrades: s.profile.lifetimeTrades + (spec.devBuy > 0 ? 1 : 0) + (bundleQty > 0 ? 1 : 0) },
      }))
      // Rooms: the server charges the launch, puts the coin on the shared market and runs the same dev buy / bundle
      // (its fills replace the ones shown here).
      if (fresh && netHooks.wallet) {
        const ref = netHooks.wallet({
          t: 'cook', token: fresh, candles: candleStore.get(t.id), event: cooked.event,
          money: { devWallet: devId, devBuy: spec.devBuy, bundle: bundleNative > 0 ? bundle : undefined, marketing: spec.marketing, autoSwap: s.settings.autoSwap, style: spec.style },
        })
        const p = get().portfolio
        quietly(() => set({ portfolio: tagRef(p, p.trades.length - s.portfolio.trades.length, ref) }))
      }
      s.notify({ title: 'TOKEN COOKED', body: `$${t.ticker} is live on the curve${spec.devBuy > 0 ? ` · dev bag ${t.devPct.toFixed(1)}%` : ''}${bundleQty > 0 ? ` · bundle ${(t.bundlePct ?? 0).toFixed(1)}% across ${bundle.wallets} wallets` : ''}`, tone: 'up', icon: '🍳' }, 'achievement')
      if (bundleEvent) s.notify({ title: 'BUNDLE SPOTTED', body: (bundleEvent as MarketEvent).text, tone: 'down', icon: '📦' }, 'alert')
      gainXp(25, `Cooked $${t.ticker}`)
      // Side-wallet buys: your other wallets buy like strangers. In the launch block they're easy to link to the dev;
      // spread over the first minute they mostly aren't.
      const sides = (spec.sideBuys ?? []).filter((sb) => sb.walletId !== devId && sb.amount > 0 && accountOf(get().portfolio, sb.walletId))
      if (sides.length) {
        if (spec.sideDelay) {
          const queue = sides.map((sb) => ({ tokenId: t.id, walletId: sb.walletId, amount: sb.amount, atTick: s.market.tick + 3 + Math.floor(Math.random() * 8) }))
          set({ sideQueue: [...get().sideQueue, ...queue] })
          s.notify({ title: 'SIDE BUYS QUEUED', body: `${sides.length} wallet${sides.length > 1 ? 's' : ''} will buy $${t.ticker} over the next minute`, tone: 'info', icon: '🕶' })
        } else {
          for (const sb of sides) buyFrom([sb.walletId], sb.amount * nativePrice(get().market, t.chain), t.id, undefined, 'SIDE BUY')
        }
      }
      persist()
      return t.id
    },

    startCopy: (cfg) => {
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to copy trade', tone: 'warn', icon: '⏸' })
        return
      }
      const existing = s.copies.find((c) => c.walletId === cfg.walletId)
      const w = s.wallets.find((x) => x.id === cfg.walletId)
      if (existing) {
        set({ copies: s.copies.map((c) => (c.id === existing.id ? { ...c, ...cfg, paused: false } : c)) })
        s.notify({ title: 'COPY UPDATED', body: `Now copying ${w?.name} with new settings`, tone: 'info', icon: '⚡' })
      } else {
        const copy: CopyConfig = {
          ...cfg, id: `copy-${cfg.walletId}-${s.market.tick}`, createdTick: s.market.tick, paused: false, holdings: {},
          stats: { buys: 0, sells: 0, spent: 0, realized: 0, skipped: 0 },
        }
        set({ copies: [copy, ...s.copies] })
        s.notify({ title: 'COPY TRADING ON', body: `Mirroring ${w?.name}'s trades · ${cfg.mode === 'fixed' ? fmtUsd(cfg.amount, 0) + ' per buy' : `${Math.round(cfg.amount * 100)}% of their size`}`, tone: 'up', icon: '⚡' }, 'achievement')
      }
      persist()
    },
    updateCopy: (id, patch) => {
      set((s) => ({ copies: s.copies.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
      persist()
    },
    stopCopy: (id, sellAll) => {
      const s = get()
      const c = s.copies.find((x) => x.id === id)
      if (!c) return
      if (sellAll && s.runStatus === 'running') {
        for (const [tokenId, qty] of Object.entries(c.holdings)) {
          const pos = get().portfolio.positions[tokenId]
          if (pos) get().sell(Math.min(qty, pos.qty), tokenId)
        }
      }
      set({ copies: get().copies.filter((x) => x.id !== id) })
      const w = s.wallets.find((x) => x.id === c.walletId)
      s.notify({ title: 'COPY STOPPED', body: `${w?.name ?? 'Wallet'}${sellAll ? ' · copied bags sold' : ' · bags kept in your portfolio'}`, tone: 'info', icon: '⏹' })
      persist()
    },
    setChainFilter: (chainFilter) => {
      set({ chainFilter })
      save('chainFilter', chainFilter)
    },
    setSwapOpen: (swapOpen) => set({ swapOpen }),
    setWalletsOpen: (walletsOpen) => set({ walletsOpen }),
    setPnlOpen: (pnlOpen) => {
      set({ pnlOpen })
      save('pnlOpen', pnlOpen)
    },
    addSniper: (task) => {
      const s = get()
      const full: SniperTask = { ...task, id: `sn-${Date.now().toString(36)}`, createdTick: s.market.tick, holdings: {}, stats: { snipes: 0, spent: 0, realized: 0, skipped: 0, sells: 0 } }
      set({ snipers: [full, ...s.snipers] })
      s.notify({ title: 'SNIPER ARMED 🎯', body: `${full.name} · watching new ${CHAINS[full.chain].name} launches`, tone: 'info', icon: '🎯' })
      persist()
    },
    updateSniper: (id, patch) => {
      set({ snipers: get().snipers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })
      persist()
    },
    removeSniper: (id) => {
      set({ snipers: get().snipers.filter((x) => x.id !== id) })
      persist()
    },
    swapAssets: (from, to, amount, walletId) => {
      if (watchingOnly()) return false
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to swap', tone: 'warn', icon: '⏸' })
        return false
      }
      const wid = walletId ?? primaryId(s.portfolio)
      const res = runSwap(s.portfolio, s.market, from, to, amount, wid)
      if (!res.ok) {
        s.notify({ title: 'SWAP FAILED', body: res.error, tone: 'warn', icon: '⛔' }, 'alert')
        return false
      }
      if (s.online) netHooks.op?.({ kind: 'swap', from, to, amount, walletId: wid })
      quietly(() => set({ portfolio: res.portfolio }))
      const label = (a: Asset, n: number) => (a === 'usd' ? fmtUsd(n) : fmtNative(n, a))
      s.notify({ title: 'SWAPPED', body: `${label(from, amount)} → ${label(to, res.received)}`, tone: 'info', icon: '🔄' }, 'click')
      persist()
      return true
    },
    requestBoard: (list) => {
      if (get().online?.round.world) netHooks.send?.({ t: 'board', ...(list ? { list } : {}) })
    },
    bankruptRestart: () => {
      const s = get()
      if (!s.online?.round.world || watchingOnly()) return
      netHooks.op?.({ kind: 'bankrupt' })
    },
    convertAssets: (from, to, amount, fromWallet, toWallet) => {
      if (watchingOnly()) return false
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to convert', tone: 'warn', icon: '⏸' })
        return false
      }
      const res = runConvert(s.portfolio, s.market, from, to, amount, fromWallet, toWallet, s.market.tick)
      if (!res.ok) {
        s.notify({ title: 'CONVERT FAILED', body: res.error, tone: 'warn', icon: '⛔' }, 'alert')
        return false
      }
      if (s.online) netHooks.op?.({ kind: 'convert', from, to, amount, fromWallet, toWallet }) // the server converts too (its result wins)
      quietly(() => set({ portfolio: res.portfolio }))
      const label = (a: Asset, n: number) => (a === 'usd' ? fmtUsd(n) : fmtNative(n, a))
      s.notify({ title: from === to ? 'TRANSFERRED' : 'CONVERTED', body: `${label(from, amount)} → ${label(to, res.received)}`, tone: 'info', icon: '🔄' }, 'click')
      persist()
      return true
    },
    createWallet: (name, emoji) => {
      const s = get()
      const accounts = s.portfolio.accounts ?? []
      if (accounts.length >= MAX_WALLETS) {
        s.notify({ title: 'WALLET LIMIT', body: `You can have up to ${MAX_WALLETS} wallets`, tone: 'warn', icon: '👛' })
        return null
      }
      const a = makeAccount(name.trim().slice(0, 18) || `Wallet ${accounts.length + 1}`, emoji)
      set({ portfolio: ensureAccounts({ ...s.portfolio, accounts: [...accounts, a] }) })
      s.notify({ title: 'WALLET CREATED', body: `${a.emoji} ${a.name} · fund it by moving coins or swapping USD into it`, tone: 'info', icon: '👛' })
      persist()
      return a.id
    },
    updateWallet: (id, patch) => {
      const s = get()
      const accounts = (s.portfolio.accounts ?? []).map((a) => (a.id === id ? { ...a, ...(patch.name !== undefined ? { name: patch.name.trim().slice(0, 18) || a.name } : {}), ...(patch.emoji ? { emoji: patch.emoji } : {}) } : a))
      set({ portfolio: { ...s.portfolio, accounts } })
      persist()
    },
    deleteWallet: (id) => {
      const s = get()
      const accounts = s.portfolio.accounts ?? []
      const a = accounts.find((x) => x.id === id)
      if (!a) return false
      const dust = Object.values(a.balances).some((b) => b > 1e-6) || Object.keys(a.positions).length > 0
      if (accounts.length <= 1 || dust) {
        s.notify({ title: 'CAN’T DELETE', body: accounts.length <= 1 ? 'You need at least one wallet' : `Move ${a.name}'s coins and sell its bags first`, tone: 'warn', icon: '👛' }, 'alert')
        return false
      }
      const rest = accounts.filter((x) => x.id !== id)
      set({ portfolio: ensureAccounts({ ...s.portfolio, accounts: rest, active: (s.portfolio.active ?? []).filter((x) => x !== id) }) })
      persist()
      return true
    },
    setActiveWallets: (ids) => {
      const s = get()
      const valid = ids.filter((id) => s.portfolio.accounts?.some((a) => a.id === id))
      if (!valid.length) return
      set({ portfolio: { ...s.portfolio, active: valid } })
      persist()
    },
    transferNative: (fromId, toId, chain, amount) => {
      if (watchingOnly()) return false
      const s = get()
      const from = accountOf(s.portfolio, fromId)
      const to = accountOf(s.portfolio, toId)
      if (!from || !to || fromId === toId || !(amount > 0)) return false
      if (amount > from.balances[chain] + 1e-12) {
        s.notify({ title: 'TRANSFER FAILED', body: `${from.name} only has ${fmtNative(from.balances[chain], chain)}`, tone: 'warn', icon: '⛔' }, 'alert')
        return false
      }
      const amt = Math.min(amount, from.balances[chain])
      const accounts = (s.portfolio.accounts ?? []).map((a) =>
        a.id === fromId
          ? { ...a, balances: { ...a.balances, [chain]: a.balances[chain] - amt } }
          : a.id === toId
            // On-chain transfers leave a trail: sleuths can link wallets funded straight from each other.
            ? { ...a, balances: { ...a.balances, [chain]: a.balances[chain] + amt }, fundedBy: { ...(a.fundedBy ?? {}), [fromId]: s.market.tick } }
            : a,
      )
      if (s.online) netHooks.op?.({ kind: 'transfer', fromId, toId, chain, amount: amt })
      quietly(() => set({ portfolio: ensureAccounts({ ...s.portfolio, accounts }) }))
      s.notify({ title: 'TRANSFERRED', body: `${fmtNative(amt, chain)} · ${from.emoji} ${from.name} → ${to.emoji} ${to.name}`, tone: 'info', icon: '💸' }, 'click')
      persist()
      return true
    },
    fundWallets: (source, toIds, chain, amountEach) => {
      if (watchingOnly()) return 0
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to fund wallets', tone: 'warn', icon: '⏸' })
        return 0
      }
      const targets = toIds.filter((id) => id !== source && accountOf(s.portfolio, id))
      if (!targets.length || !(amountEach > 0)) return 0
      let portfolio = s.portfolio
      let done = 0
      let got = 0
      const errors: string[] = []
      const ops: OpMsg[] = []
      for (const id of targets) {
        if (source === 'usd') {
          // Swap from the USD bank straight into that wallet.
          const r = runSwap(portfolio, s.market, 'usd', chain, amountEach, id)
          if (!r.ok) {
            errors.push(r.error)
            break
          }
          portfolio = r.portfolio
          got += r.received
          ops.push({ kind: 'swap', from: 'usd', to: chain, amount: amountEach, walletId: id })
        } else {
          const from = accountOf(portfolio, source)
          if (!from || from.balances[chain] < amountEach - 1e-12) {
            errors.push(`${from?.name ?? 'Source'} ran out of ${CHAINS[chain].native}`)
            break
          }
          const amt = Math.min(amountEach, from.balances[chain])
          const accounts = (portfolio.accounts ?? []).map((a) =>
            a.id === source
              ? { ...a, balances: { ...a.balances, [chain]: a.balances[chain] - amt } }
              : a.id === id
                ? { ...a, balances: { ...a.balances, [chain]: a.balances[chain] + amt }, fundedBy: { ...(a.fundedBy ?? {}), [source]: s.market.tick } }
                : a,
          )
          portfolio = ensureAccounts({ ...portfolio, accounts })
          got += amt
          ops.push({ kind: 'transfer', fromId: source, toId: id, chain, amount: amt })
        }
        done++
      }
      if (done) {
        if (s.online) ops.forEach((o) => netHooks.op?.(o))
        quietly(() => set({ portfolio }))
        persist()
      }
      const src = source === 'usd' ? 'USD bank' : `${accountOf(s.portfolio, source)?.emoji ?? ''} ${accountOf(s.portfolio, source)?.name ?? ''}`
      if (done) s.notify({ title: `FUNDED ${done} WALLET${done > 1 ? 'S' : ''}`, body: `${fmtNative(got, chain)} total from ${src}${errors.length ? ` · stopped: ${errors[0]}` : ''}`, tone: errors.length ? 'warn' : 'info', icon: '💸' }, 'click')
      else s.notify({ title: 'FUNDING FAILED', body: errors[0] ?? 'Nothing to fund', tone: 'warn', icon: '⛔' }, 'alert')
      return done
    },
    buyNative: (amount, tokenId, slot) => {
      const s = get()
      const id = tokenId ?? s.selectedId
      const t = id ? s.market.tokens.find((x) => x.id === id) : undefined
      if (!t) return false
      return s.buy(amount * nativePrice(s.market, t.chain), t.id, slot)
    },
    claimCreatorFees: (tokenId, silent) => {
      if (watchingOnly()) return
      const s = get()
      const recs = s.launches.filter((r) => (!tokenId || r.tokenId === tokenId) && (r.unclaimed ?? 0) > 1e-9)
      if (!recs.length) return
      let portfolio = s.portfolio
      const paid: string[] = []
      for (const r of recs) {
        const chain = r.chain ?? 'sol'
        portfolio = payNative(portfolio, s.market, [[chain, r.unclaimed ?? 0]], 'coin', devSet(portfolio, r)[0]).portfolio
        paid.push(`${fmtNative(r.unclaimed ?? 0, chain)} from ${r.ticker}`)
      }
      if (s.online) netHooks.op?.({ kind: 'claimFees', tokenIds: recs.map((r) => r.tokenId) }) // the server pays from its own vaults
      quietly(() => set({ portfolio, launches: s.launches.map((r) => (recs.includes(r) ? { ...r, unclaimed: 0 } : r)) }))
      if (!silent) s.notify({ title: 'CREATOR FEES CLAIMED', body: `${paid.slice(0, 3).join(' · ')}${paid.length > 3 ? ` +${paid.length - 3} more` : ''} → your dev wallet`, tone: 'up', icon: '💰' }, 'profit')
      persist()
    },
    postSocial: (text, tokenId) => {
      if (watchingOnly()) return false
      const s = get()
      const clean = text.trim().slice(0, 200)
      if (!clean) return false
      const soc = { ...freshSocial(), ...(s.profile.social ?? {}) }
      const wait = POST_COOLDOWN_TICKS - (s.market.tick - soc.lastPostTick)
      if (wait > 0 && soc.lastPostTick <= s.market.tick) {
        s.notify({ title: 'SLOW DOWN', body: `You can post again in ${wait}s. Spamming the timeline kills your reach.`, tone: 'warn', icon: '⏳' })
        return false
      }
      // A $TICKER in the text counts as a call on that coin, even without attaching it.
      const tickerInText = clean.match(/\$([A-Z0-9]{2,8})\b/)?.[1]
      const t = tokenId ? s.market.tokens.find((x) => x.id === tokenId) : tickerInText ? [...s.market.tokens].sort((a, b) => b.mcap - a.mcap).find((x) => x.ticker === tickerInText && (x.status === 'bonding' || x.status === 'graduated')) : undefined
      const author = { ...playerAuthor(), followers: soc.followers, rep: soc.rep }
      const repeats = soc.calls.filter((c) => c.tokenId === t?.id && s.market.tick - c.tick < CALL_SETTLE_TICKS).length
      const call = t ? { tokenId: t.id, ticker: t.ticker, tick: s.market.tick, mcapAtPost: t.mcap, peak: t.mcap } : null
      if (s.online) {
        // The room's server runs the timeline's reaction on the shared market; the post comes back with the next tick.
        netHooks.send?.({ t: 'post', text: clean, tokenId: t?.id, followers: soc.followers, rep: soc.rep, repeats })
        const next = { ...soc, posts: soc.posts + 1, lastPostTick: s.market.tick, calls: call ? [{ ...call, postId: 0, likes: 0 }, ...soc.calls].slice(0, 30) : soc.calls }
        set({ profile: { ...s.profile, social: next } })
        persist()
        return true
      }
      const rng = new Rng((s.market.seed ^ Math.imul(s.market.tick + 7, 0x9e3779b1) ^ soc.posts) >>> 0)
      let res: ShillResult = { likes: 0, rts: 0, replies: [], buyers: 0, queue: [] }
      let market = s.market
      if (t) market = patchToken(market, t.id, (x) => (res = shill(s.market, rng, x, author, clean, repeats)))
      else res = shill(s.market, rng, undefined, author, clean)
      market = { ...market, shillQueue: [...(market.shillQueue ?? []), ...res.queue] }
      const post: SocialPost = {
        id: s.market.tick * 1000 + 900 + (soc.posts % 90), tick: s.market.tick, time: s.market.time, accountId: 'player', author, text: clean,
        tokenId: t?.id, ticker: t?.ticker, mcapAtPost: t?.mcap, peakMcap: t?.mcap, isCall: !!t, likes: res.likes, rts: res.rts, replies: res.replies, buyers: res.buyers,
      }
      const next: SocialProfile = {
        ...addFollowers(soc, res.likes * 0.1), posts: soc.posts + 1, lastPostTick: s.market.tick,
        calls: call ? [{ ...call, postId: post.id, likes: res.likes }, ...soc.calls].slice(0, 30) : soc.calls,
      }
      set({ market, socialFeed: [post, ...s.socialFeed].slice(0, 150), profile: { ...s.profile, social: next } })
      s.notify(
        t
          ? { title: 'CALL POSTED', body: `$${t.ticker} · ${res.likes} likes · ${res.buyers ? `${res.buyers} aped 🦍` : 'nobody bit yet'}`, tone: res.buyers ? 'up' : 'info', icon: '📣', tokenId: t.id }
          : { title: 'POSTED', body: `${res.likes} likes`, tone: 'info', icon: '🐦' },
      )
      persist()
      return true
    },
    airdrop: (tokenId, pct, wallets, target) => {
      if (watchingOnly()) return false
      const s = get()
      const fail = (body: string) => {
        s.notify({ title: 'AIRDROP FAILED', body, tone: 'warn', icon: '🪂' }, 'alert')
        return false
      }
      if (s.runStatus !== 'running') return fail('Start a round first')
      const rec = s.launches.find((r) => r.tokenId === tokenId)
      const t = s.market.tokens.find((x) => x.id === tokenId)
      if (!rec || !t || t.creator !== 'you') return fail('You can only airdrop coins you cooked')
      if (t.status !== 'bonding' && t.status !== 'graduated') return fail(`$${t.ticker} is ${t.status}`)
      const n = Math.round(clamp(wallets, 1, AIRDROP_MAX_WALLETS))
      if (target === 'holders' && t.holders < n) return fail(`$${t.ticker} only has ${t.holders} holders. Pick fewer, or send to fresh wallets.`)
      const devW = devSet(s.portfolio, rec)[0]
      const acc = accountOf(s.portfolio, devW)
      const pos = acc?.positions[tokenId]
      // Only the dev's visible bag can be airdropped; the hidden bundle stays put.
      const free = Math.max(0, (pos?.qty ?? 0) - (rec.bundleQty ?? 0))
      const qty = free * clamp(pct, 0, 1)
      if (!acc || !pos || !(qty > 0)) return fail('Your dev wallet has no tokens of this coin to give away')
      const fee = airdropFeePerWallet(t.chain, target) * n
      if (acc.balances[t.chain] < fee) return fail(`Needs ${fmtNative(fee, t.chain)} in your dev wallet for network fees (${n} transfers)`)
      const rng = new Rng((s.market.seed ^ Math.imul(s.market.tick + 1, 0x2c1b3c6d) ^ n) >>> 0)
      const plan = planAirdrop(t, qty, n, target, rng, s.market.tick, secPerTickOf(s.market))
      // The tokens leave your bag for nothing: their cost is written off as a realized loss.
      const given = runGiveAway(s.portfolio, devW, tokenId, qty, t.chain, fee)
      if (!given.ok) return fail(given.error)
      const portfolio = given.portfolio
      const launches = s.launches.map((r) => (r.tokenId === tokenId ? { ...r, airdropped: { qty: (r.airdropped?.qty ?? 0) + qty, wallets: (r.airdropped?.wallets ?? 0) + n, count: (r.airdropped?.count ?? 0) + 1 } } : r))
      const stake = devStake(portfolio, rec, tokenId)
      let market = patchToken(s.market, tokenId, (x) => {
        x.devPct = stake.devPct
        x.bundlePct = stake.bundlePct
        x.holders += plan.holdersAdd
        x.top10Pct = Math.max(1, x.top10Pct - plan.top10Drop)
        x.hype = Math.min(100, x.hype + plan.hype)
      })
      if (!s.online) market = { ...market, shillQueue: [...(market.shillQueue ?? []), ...plan.queue] }
      const pctTxt = `${((qty / SUPPLY) * 100).toFixed(2)}% of supply`
      const ev: MarketEvent = {
        id: s.market.tick * 100 + 93, tick: s.market.tick, time: s.market.time, kind: 'airdrop', tokenId, ticker: t.ticker,
        text: `Dev airdropped ${pctTxt} of $${t.ticker} to ${n} ${target === 'fresh' ? 'fresh wallets' : 'holders'}`, icon: '🪂', tone: 'info',
      }
      quietly(() => set({ portfolio, market, launches, events: [ev, ...s.events].slice(0, 120) }))
      if (s.online) {
        netHooks.wallet?.({ t: 'airdrop', tokenId, queue: plan.queue, walletId: devW, qty, wallets: n, target }) // the server takes the tokens and fee too
        netHooks.send?.({ t: 'event', event: ev })
        sendTokenPatch(tokenId)
      }
      s.notify({
        title: 'AIRDROP SENT', tone: 'info', icon: '🪂', tokenId,
        body: `${pctTxt} to ${n} ${target === 'fresh' ? 'fresh wallets' : 'holders'} · fees ${fmtNative(fee, t.chain)}${plan.dumpers ? ` · watch out: ~${plan.dumpers} look like farmers` : ''}`,
      }, 'click')
      persist()
      return true
    },
    setBot: (tokenId, patch) => {
      if (watchingOnly()) return
      const s = get()
      const rec = s.launches.find((r) => r.tokenId === tokenId)
      const t = s.market.tokens.find((x) => x.id === tokenId)
      if (!rec || !t) return
      if (patch.on && s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to run a volume bot', tone: 'warn', icon: '⏸' })
        return
      }
      if (patch.on && t.status !== 'bonding' && t.status !== 'graduated') {
        s.notify({ title: 'BOT NOT STARTED', body: `$${t.ticker} is ${t.status}`, tone: 'warn', icon: '🤖' })
        return
      }
      const base: VolumeBot = rec.bot ?? { on: false, rate: 2000, budget: 0, spent: 0, volume: 0, startedTick: s.market.tick }
      const bot: VolumeBot = { ...base, ...patch, ...(patch.on && !base.on ? { startedTick: s.market.tick } : {}) }
      set({ launches: s.launches.map((r) => (r.tokenId === tokenId ? { ...r, bot } : r)) })
      if (s.online) netHooks.send?.({ t: 'bot', tokenId, bot: bot.on ? bot : null }) // the server runs it on the shared coin
      if (patch.on !== undefined && patch.on !== base.on) {
        s.notify(
          patch.on
            ? { title: 'VOLUME BOT ON', body: `$${t.ticker} · ${fmtUsd(bot.rate, 0)}/min · budget ${fmtUsd(bot.budget - bot.spent, 0)}`, tone: 'info', icon: '🤖' }
            : { title: 'VOLUME BOT OFF', body: `$${t.ticker} · ${fmtUsd(bot.volume, 0)} volume for ${fmtUsd(bot.spent)} in fees`, tone: 'info', icon: '🤖' },
        )
      }
      persist()
    },
    shareInvite: () => {
      if (!REFERRALS_ENABLED) return
      const s = get()
      const r = s.rewards
      const wait = SHARE_COOLDOWN_TICKS - (s.market.tick - r.lastShareTick)
      if (wait > 0 && r.lastShareTick <= s.market.tick) {
        s.notify({ title: 'SLOW DOWN', body: `You can share again in ${wait}s`, tone: 'warn', icon: '⏳' })
        return
      }
      if (r.friends.length >= MAX_FRIENDS) {
        s.notify({ title: 'SQUAD FULL', body: `You've invited the max of ${MAX_FRIENDS} friends`, tone: 'info', icon: '👥' })
        return
      }
      // Sharing is a gamble: sometimes nobody bites, sometimes a couple of fictional traders sign up.
      const roll = Math.random()
      const n = Math.min(MAX_FRIENDS - r.friends.length, roll < 0.45 ? 0 : roll < 0.85 ? 1 : 2)
      const joined = Array.from({ length: n }, makeFriend)
      set({ rewards: { ...r, lastShareTick: s.market.tick, friends: [...joined, ...r.friends] } })
      if (n) s.notify({ title: 'NEW REFERRAL', body: `${joined.map((f) => f.name).join(' & ')} joined with your code`, tone: 'up', icon: '🤝' }, 'achievement')
      else s.notify({ title: 'INVITE SHARED', body: 'No sign-ups this time, try again later', tone: 'info', icon: '📨' })
      persist()
    },
    claimReward: (kind) => {
      if (!REFERRALS_ENABLED) return
      const s = get()
      const r = s.rewards
      const amount = r.commissionPending
      if (!(amount >= 0.01)) return
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to claim rewards', tone: 'warn', icon: '⏸' })
        return
      }
      const asCash = s.mode === 'practice' && !s.online
      const claim: RewardClaim = { id: `c${Date.now()}`, time: Date.now(), kind, amount, paidAs: asCash ? 'cash' : 'xp' }
      set({
        rewards: {
          ...r,
          commissionPending: 0,
          history: [claim, ...r.history].slice(0, 50),
        },
        ...(asCash ? { portfolio: { ...s.portfolio, cash: s.portfolio.cash + amount } } : {}),
      })
      s.notify({ title: 'REWARD CLAIMED', body: `Referral commission · ${asCash ? fmtUsd(amount) : `+${Math.round(amount)} XP`}`, tone: 'up', icon: '🎁' }, 'profit')
      if (!asCash) gainXp(amount, 'Rewards (non-practice rounds pay XP)', true)
      persist()
    },
    claimCashback: (which, as) => {
      if (watchingOnly()) return
      const s = get()
      if (s.runStatus !== 'running') {
        s.notify({ title: 'ROUND NOT ACTIVE', body: 'Start a round to claim rewards', tone: 'warn', icon: '⏸' })
        return
      }
      const cb = cashbackOf(s.rewards)
      const chains = (which === 'all' ? (Object.keys(cb.pending) as Chain[]) : [which]).filter((c) => cb.pending[c] > 1e-9)
      if (!chains.length) return
      const paid = payNative(s.portfolio, s.market, chains.map((c) => [c, cb.pending[c]]), as)
      const pending = { ...cb.pending }
      for (const c of chains) pending[c] = 0
      const claims: RewardClaim[] = paid.lines.map((l, i) => ({ id: `c${Date.now()}${i}`, time: Date.now(), kind: 'cashback', amount: l.usd, paidAs: as === 'coin' ? 'coin' : 'cash', chain: l.chain, native: l.native }))
      if (s.online) netHooks.op?.({ kind: 'cashback', chains, as }) // the server pays what it counted
      quietly(() => set({ portfolio: paid.portfolio, rewards: { ...s.rewards, cashback: { ...cb, pending, lifetimeUsd: cb.lifetimeUsd + paid.usd }, history: [...claims, ...s.rewards.history].slice(0, 50) } }))
      const body = as === 'usdc' ? `+${fmtUsd(paid.usd)} USDC` : paid.lines.map((l) => `+${fmtNative(l.native, l.chain)}`).join(' · ')
      s.notify({ title: 'CASHBACK CLAIMED', body: `${body}${as === 'coin' ? ' → your wallet' : ''}`, tone: 'up', icon: '💸' }, 'profit')
      persist()
    },
    setCashbackAuto: (auto) => {
      const s = get()
      set({ rewards: { ...s.rewards, cashback: { ...cashbackOf(s.rewards), auto } } })
      persist()
    },
    checkIn: () => {
      const s = get()
      const r = s.rewards
      if (r.checkIn.lastDate === todayKey()) return
      const streak = r.checkIn.lastDate === yesterdayKey() ? (r.checkIn.streak % 7) + 1 : 1
      const amount = CHECKIN_REWARDS[streak - 1]
      const asCash = s.mode === 'practice' && s.runStatus === 'running' && !s.online
      const claim: RewardClaim = { id: `c${Date.now()}`, time: Date.now(), kind: 'checkin', amount, paidAs: asCash ? 'cash' : 'xp' }
      set({
        rewards: { ...r, checkIn: { lastDate: todayKey(), streak }, history: [claim, ...r.history].slice(0, 50) },
        ...(asCash ? { portfolio: { ...s.portfolio, cash: s.portfolio.cash + amount } } : {}),
      })
      s.notify({ title: `DAY ${streak} CHECK-IN`, body: asCash ? `+${fmtUsd(amount, 0)} cash` : `+${amount} XP`, tone: 'xp', icon: '📅' }, 'achievement')
      if (!asCash) gainXp(amount, 'Daily check-in', true)
      persist()
    },
    trackDaily: (fills, cooked = 0) => {
      const s = get()
      const { state, completed, swept } = foldDailies(s.rewards.dailies, fills, cooked)
      const paid: [string, number][] = completed.map((c) => [c.title, c.xp])
      if (swept) paid.push(['All three daily challenges', DAILY_SWEEP_XP])
      const claims: RewardClaim[] = paid.map(([, xp], i) => ({ id: `d${Date.now()}${i}`, time: Date.now(), kind: 'challenge', amount: xp, paidAs: 'xp' }))
      set({ rewards: { ...s.rewards, dailies: state, history: claims.length ? [...claims, ...s.rewards.history].slice(0, 50) : s.rewards.history } })
      for (const c of completed) s.notify({ title: 'DAILY CHALLENGE DONE', body: `${c.title} · +${c.xp} XP`, tone: 'xp', icon: c.icon }, 'achievement')
      if (swept) s.notify({ title: 'DAILY SWEEP', body: `All three done · +${DAILY_SWEEP_XP} XP bonus`, tone: 'xp', icon: '🧹' }, 'achievement')
      for (const [title, xp] of paid) gainXp(xp, title, true)
      if (paid.length) persist()
    },
    toggleFollowAccount: (accountId) => {
      const s = get()
      const on = !s.followedAccounts.includes(accountId)
      set({ followedAccounts: on ? [...s.followedAccounts, accountId] : s.followedAccounts.filter((x) => x !== accountId) })
      const acc = ACCOUNTS.find((a) => a.id === accountId)
      s.notify({ title: on ? 'FOLLOWING' : 'UNFOLLOWED', body: `@${acc?.handle}${on ? ' · their posts show in Mine and ping you' : ''}`, tone: 'info', icon: acc?.avatar ?? '📣' }, 'click')
      persist()
    },
    setWalletLabel: (walletId, patch) => {
      const s = get()
      const cur = s.walletLabels[walletId] ?? { notify: true }
      set({ walletLabels: { ...s.walletLabels, [walletId]: { ...cur, ...patch } } })
      persist()
    },
    updateTracker: (patch) => {
      const tracker = { ...get().tracker, ...patch }
      set({ tracker })
      save('tracker', tracker)
    },
    addAlert: (a) => {
      const s = get()
      const t = s.market.tokens.find((x) => x.id === a.tokenId)
      if (!t || !(a.value > 0)) return
      const alert: PriceAlert = { ...a, id: `al-${t.id}-${s.market.tick}-${s.alerts.length}`, createdTick: s.market.tick, baseMcap: t.mcap, ticker: t.ticker, emoji: t.emoji, hue: t.hue }
      set({ alerts: [alert, ...s.alerts] })
      s.notify({ title: 'ALERT SET', body: `$${t.ticker} ${alertText(alert)}`, tone: 'info', icon: '🔔' }, 'click')
      persist()
    },
    removeAlert: (id) => {
      set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }))
      persist()
    },
    openWallet: (walletId) => set(walletId ? { walletDrawer: walletId, view: 'copytrade' } : { walletDrawer: null }),
    toggleTrackWallet: (walletId) => {
      const s = get()
      const on = !s.trackedWallets.includes(walletId)
      set({ trackedWallets: on ? [...s.trackedWallets, walletId] : s.trackedWallets.filter((x) => x !== walletId) })
      const w = s.wallets.find((x) => x.id === walletId)
      s.notify({ title: on ? 'TRACKING WALLET' : 'UNTRACKED', body: on ? `${w?.name} · their trades show in Track and alert you per your tracker settings` : `${w?.name}`, tone: 'info', icon: on ? '👁' : '🙈' }, 'click')
      persist()
    },
  }
})

// ─── Trading cashback ────────────────────────────────────────────────────────

const nativeUsd = (m: MarketState, c: Chain) => m.native?.[c]?.price ?? CHAINS[c].basePrice

// Every new fill (manual, instant, copy, sniper, limit…) earns cashback in its chain's coin, priced at fill time.
useGame.subscribe((s, prev) => {
  if (s.portfolio.trades === prev.portfolio.trades || s.runStatus !== 'running') return
  // Match by content, not object identity: some code re-tags existing trades (e.g. sniper `via`) with new objects.
  const key = (tr: Trade) => `${tr.id}|${tr.walletId ?? ''}|${tr.tick}|${tr.side}|${tr.qty}`
  const seen = new Set(prev.portfolio.trades.map(key))
  const fresh = s.portfolio.trades.filter((tr) => !seen.has(key(tr)) && tr.status === 'FILLED')
  // A new round (or a load) swaps the whole list; only count trades added on top of the old one.
  if (!fresh.length || fresh.length === s.portfolio.trades.length && prev.portfolio.trades.length > 0) return
  const cb = cashbackOf(s.rewards)
  const chainOf = (tr: Trade): Chain => tr.chain ?? s.market.tokens.find((t) => t.id === tr.tokenId)?.chain ?? 'sol'
  const pending = { ...cb.pending }
  let volume = cb.volume
  let roundVolume = cb.roundVolume
  let roundUsd = cb.roundUsd
  const earned: [Chain, number][] = []
  for (const tr of [...fresh].reverse()) {
    const usd = cashbackUsd(tr, volume)
    volume += tr.value
    roundVolume += tr.value
    roundUsd += usd
    const c = chainOf(tr)
    const native = usd / nativeUsd(s.market, c)
    if (native > 0) earned.push([c, native])
  }
  let portfolio = s.portfolio
  let lifetimeUsd = cb.lifetimeUsd
  if (cb.auto !== 'off' && earned.length) {
    const paid = payNative(portfolio, s.market, earned, cb.auto) // rooms: the server auto-pays it too
    portfolio = paid.portfolio
    lifetimeUsd += paid.usd
  } else for (const [c, n] of earned) pending[c] += n
  quietly(() => useGame.setState({ ...(portfolio !== s.portfolio ? { portfolio } : {}), rewards: { ...s.rewards, cashback: { ...cb, pending, volume, roundVolume, roundUsd, lifetimeUsd } } }))
})

// ─── Daily challenges ────────────────────────────────────────────────────────

// Every new fill and every coin you cook counts towards today's three. Must stay below the cashback listener: that one
// writes `rewards` from the state it was called with, so it has to run first.
useGame.subscribe((s, prev) => {
  if (s.runStatus !== 'running') return
  const cooked = s.launches.length === prev.launches.length + 1 && (s.runStats.cooked ?? 0) === (prev.runStats.cooked ?? 0) + 1 ? 1 : 0
  let fills: Trade[] = []
  if (s.portfolio.trades !== prev.portfolio.trades && s.mode === prev.mode) {
    const old = new Set(prev.portfolio.trades)
    const refs = new Set(prev.portfolio.trades.map((tr) => tr.ref).filter((r) => r !== undefined))
    // Only fills stamped with the current market time (loading a save or rejoining a room never re-adds old trades),
    // and each order once: in rooms the server's fills replace the ones shown instantly, under the same `ref`.
    fills = newTrades(s.portfolio.trades, prev.portfolio.trades).filter((tr) => !old.has(tr) && tr.status === 'FILLED' && tr.time >= s.market.time - 12 && (tr.ref === undefined || !refs.has(tr.ref)))
  }
  if (fills.length || cooked) s.trackDaily(fills, cooked)
})

export const TICK_REAL_SECONDS = 1
export const simSecondsToTicks = (sec: number) => sec / SIM_SEC_PER_TICK

// Leaving or reloading the page: save the latest charts of your coins too (solo rounds only; rooms get theirs from
// the server).
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    const s = useGame.getState()
    if (s.online || s.runStatus === 'select') return
    const traded = s.portfolio.trades.slice(0, 60).map((t) => t.tokenId)
    saveCharts([...Object.keys(s.portfolio.positions), ...(s.selectedId ? [s.selectedId] : []), ...traded])
  })
}
