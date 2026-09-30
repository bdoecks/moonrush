import type { CashbackState, Chain, Friend, RewardsState, Trade } from '../types'

// Referral commissions (on referred friends' fees) and fee cashback (on your own fees), tiered by volume.
export const REF_TIERS = [
  { volume: 0, rate: 0.1 },
  { volume: 50_000, rate: 0.2 },
  { volume: 250_000, rate: 0.3 },
  { volume: 1_000_000, rate: 0.4 },
]
// Cashback tiers use lifetime volume (GMGN / Axiom style): everyone earns from the first trade.
export const CASHBACK_TIERS = [
  { volume: 0, rate: 0.1 },
  { volume: 25_000, rate: 0.15 },
  { volume: 100_000, rate: 0.2 },
  { volume: 500_000, rate: 0.25 },
  { volume: 2_000_000, rate: 0.3 },
]
export const PLATFORM_FEE = 0.01 // cashback is a share of the platform fee only (not token taxes)

export const freshCashback = (): CashbackState => ({ pending: { sol: 0, bsc: 0, hood: 0 }, volume: 0, roundVolume: 0, roundUsd: 0, lifetimeUsd: 0, auto: 'off' })
export const cashbackOf = (r: RewardsState): CashbackState => ({ ...freshCashback(), ...(r.cashback ?? {}) })

/** USD cashback for one fill at the tier reached by lifetime volume so far. */
export const cashbackUsd = (tr: Trade, lifetimeVolume: number) => Math.min(tr.fee, tr.value * PLATFORM_FEE) * tierFor(CASHBACK_TIERS, lifetimeVolume).rate

export const pendingUsd = (cb: CashbackState, price: (c: Chain) => number) => (Object.keys(cb.pending) as Chain[]).reduce((a, c) => a + cb.pending[c] * price(c), 0)
export const SHARE_COOLDOWN_TICKS = 45
/**
 * Referrals are off: they used made-up sign-ups. They come back when inviting real people (with accounts) is built.
 */
export const REFERRALS_ENABLED = false
export const MAX_FRIENDS = 20
export const CHECKIN_REWARDS = [50, 75, 100, 150, 200, 300, 500] // day 1..7 (cash in practice, XP elsewhere)

export const tierFor = (tiers: { volume: number; rate: number }[], volume: number) => {
  let i = 0
  while (i + 1 < tiers.length && volume >= tiers[i + 1].volume) i++
  return { index: i, rate: tiers[i].rate, next: tiers[i + 1] }
}

export const referralVolume = (friends: Friend[]) => friends.reduce((a, f) => a + f.volume, 0)

const FIRST = ['Lil', 'Big', 'Captain', 'Doctor', 'Sir', 'Lady', 'Baron', 'Tiny', 'Crypto', 'Moon', 'Degen', 'Chad']
const LAST = ['Ape', 'Pump', 'Frog', 'Candle', 'Wick', 'Bag', 'Rug', 'Gem', 'Dip', 'Whale', 'Shrimp', 'Sniper']
const AVATARS = ['🐵', '🦊', '🐸', '🐻', '🐼', '🐯', '🦁', '🐨', '🐙', '🦄', '🐧', '🦉']

export function makeFriend(): Friend {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
  return {
    id: `f${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    name: `${pick(FIRST)}${pick(LAST)}${Math.floor(Math.random() * 90 + 10)}`,
    avatar: pick(AVATARS),
    joinedAt: Date.now(),
    activity: 0.3 + Math.random() * 1.2,
    volume: 0,
    fees: 0,
  }
}

/** Friends trade a little every tick; you earn a tiered commission on their 1% fees. */
export function tickFriends(r: RewardsState, sentiment: number): RewardsState {
  if (!r.friends.length) return r
  let pending = r.commissionPending
  let total = r.commissionTotal
  let refVol = referralVolume(r.friends)
  const friends = r.friends.map((f) => {
    if (Math.random() > 0.35 * f.activity) return f
    const vol = Math.random() * 400 * f.activity * (1 + Math.max(-0.5, sentiment))
    const fee = vol * 0.01
    const commission = fee * tierFor(REF_TIERS, refVol).rate
    refVol += vol
    pending += commission
    total += commission
    return { ...f, volume: f.volume + vol, fees: f.fees + fee, earned: (f.earned ?? 0) + commission }
  })
  return { ...r, friends, commissionPending: pending, commissionTotal: total }
}

export function freshRewards(): RewardsState {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return { code, friends: [], lastShareTick: -999, commissionPending: 0, commissionTotal: 0, cashbackClaimed: 0, cashback: freshCashback(), checkIn: { lastDate: '', streak: 0 }, history: [] }
}

export const todayKey = () => new Date().toDateString()
export const yesterdayKey = () => new Date(Date.now() - 86_400_000).toDateString()
