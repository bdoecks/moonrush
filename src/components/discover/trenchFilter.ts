// GMGN-style filters shared by the Trenches columns and the Discover table.
import { publicBundlePct } from '../../game/devTools'
import { devPctOf, top10Of } from '../../game/ledger'
import { winBuys, winSells, winTxns, winVolume } from '../../game/windows'
import type { Chain, PadId, Token, Win } from '../../types'

export type RangeKey =
  | 'progress' | 'migrated' | 'mcap' | 'liquidity' | 'volume' | 'txns' | 'buys' | 'sells' | 'change' | 'holders' | 'age'
  | 'top10' | 'dev' | 'snipers' | 'insiders' | 'bundler'
export type Range = [number | null, number | null]

export type CheckKey = 'x' | 'tg' | 'web' | 'anySocial' | 'noMint' | 'lpBurned' | 'devSold' | 'devHolds' | 'unflagged' | 'hideDead' | 'taxOnly' | 'noTax'

export interface TrenchFilter {
  pads: PadId[] // empty = every launchpad
  include: string // comma-separated keywords, any must match
  exclude: string // comma-separated keywords, none may match
  window: Win // stats window for volume / txns / buys / sells / change
  ranges: Partial<Record<RangeKey, Range>>
  checks: Partial<Record<CheckKey, boolean>>
}

export const EMPTY_FILTER: TrenchFilter = { pads: [], include: '', exclude: '', window: '1h', ranges: {}, checks: {} }
export const WINDOWS: Win[] = ['1m', '5m', '1h', '24h']

export type Scope = 'new' | 'stretch' | 'grad' | 'table'
export interface RangeMeta {
  key: RangeKey
  label: string | ((w: Win) => string)
  group: 'Market' | 'Activity' | 'Holders'
  unit?: string // shown in the inputs
  scale: number // input value × scale = token value
  get: (t: Token, now: number, w: Win) => number | null // null = doesn't apply (excluded when the range is set)
  scopes?: Scope[] // where it's offered (default: everywhere)
}

const shady = (t: Token) => t.rugProb > 0.0002

export const RANGES: RangeMeta[] = [
  { key: 'progress', label: 'Bonding curve', group: 'Market', unit: '%', scale: 1, get: (t) => t.bondingProgress, scopes: ['new', 'stretch', 'table'] },
  { key: 'migrated', label: 'Migrated ago', group: 'Market', unit: 'min', scale: 60, get: (t, now) => (t.graduatedAt ? now - t.graduatedAt : null), scopes: ['grad', 'table'] },
  { key: 'mcap', label: 'Market cap', group: 'Market', unit: '$K', scale: 1000, get: (t) => t.mcap },
  { key: 'liquidity', label: 'Liquidity', group: 'Market', unit: '$K', scale: 1000, get: (t) => t.liquidity },
  { key: 'age', label: 'Age', group: 'Market', unit: 'min', scale: 60, get: (t, now) => now - t.createdAt },
  { key: 'change', label: (w) => `Change ${w}`, group: 'Activity', unit: '%', scale: 0.01, get: (t, _n, w) => t.change[w] },
  { key: 'volume', label: (w) => `Volume ${w}`, group: 'Activity', unit: '$K', scale: 1000, get: (t, now, w) => winVolume(t, w, now) },
  { key: 'txns', label: (w) => `Txns ${w}`, group: 'Activity', scale: 1, get: (t, now, w) => winTxns(t, w, now) },
  { key: 'buys', label: (w) => `Buys ${w}`, group: 'Activity', scale: 1, get: (t, now, w) => winBuys(t, w, now) },
  { key: 'sells', label: (w) => `Sells ${w}`, group: 'Activity', scale: 1, get: (t, now, w) => winSells(t, w, now) },
  { key: 'holders', label: 'Holders', group: 'Holders', scale: 1, get: (t) => t.holders },
  { key: 'top10', label: 'Top 10 holders', group: 'Holders', unit: '%', scale: 1, get: (t) => top10Of(t) },
  { key: 'dev', label: 'Dev holding', group: 'Holders', unit: '%', scale: 1, get: (t) => devPctOf(t) },
  { key: 'snipers', label: 'Snipers', group: 'Holders', scale: 1, get: (t) => t.snipers },
  { key: 'insiders', label: 'Insiders', group: 'Holders', unit: '%', scale: 1, get: (t) => t.insidersPct },
  { key: 'bundler', label: 'Bundler', group: 'Holders', unit: '%', scale: 1, get: (t) => publicBundlePct(t) },
]
export const rangeLabel = (m: RangeMeta, w: Win) => (typeof m.label === 'function' ? m.label(w) : m.label)

export const CHECKS: { key: CheckKey; label: string; group: 'Socials' | 'Audit'; test: (t: Token) => boolean }[] = [
  { key: 'x', label: 'Has X', group: 'Socials', test: (t) => !!t.socials?.x },
  { key: 'tg', label: 'Has Telegram', group: 'Socials', test: (t) => !!t.socials?.tg },
  { key: 'web', label: 'Has website', group: 'Socials', test: (t) => !!t.socials?.web },
  { key: 'anySocial', label: 'At least 1 social', group: 'Socials', test: (t) => !!(t.socials?.x || t.socials?.tg || t.socials?.web) },
  { key: 'noMint', label: 'Mint disabled', group: 'Audit', test: (t) => !shady(t) },
  { key: 'lpBurned', label: 'LP burned / curve', group: 'Audit', test: (t) => t.status === 'bonding' || (t.status === 'graduated' && !shady(t)) },
  { key: 'devSold', label: 'Dev sold all', group: 'Audit', test: (t) => devPctOf(t) < 0.05 },
  { key: 'devHolds', label: 'Dev still holding', group: 'Audit', test: (t) => devPctOf(t) >= 0.05 },
  { key: 'unflagged', label: 'No bundle / wash flags', group: 'Audit', test: (t) => !t.bundleFlagged && !t.washFlagged },
  { key: 'hideDead', label: 'Hide rugged / dead', group: 'Audit', test: (t) => t.status !== 'rugged' && t.status !== 'dead' },
  { key: 'taxOnly', label: 'Tax coins only', group: 'Audit', test: (t) => !!t.tax },
  { key: 'noTax', label: 'No tax', group: 'Audit', test: (t) => !t.tax },
]

const words = (s: string) => s.split(',').map((w) => w.trim().toLowerCase().replace(/^\$/, '')).filter(Boolean)
const setRanges = (f: TrenchFilter) => Object.values(f.ranges).filter((r) => r && (r[0] !== null || r[1] !== null)).length

export function countActive(f: TrenchFilter) {
  return (f.pads.length ? 1 : 0) + (words(f.include).length ? 1 : 0) + (words(f.exclude).length ? 1 : 0) + setRanges(f) + Object.values(f.checks).filter(Boolean).length
}

export function matchesFilter(t: Token, f: TrenchFilter, now: number) {
  if (f.pads.length && !f.pads.includes(t.pad)) return false
  for (const c of CHECKS) if (f.checks[c.key] && !c.test(t)) return false
  const text = `${t.ticker} ${t.name}`.toLowerCase()
  const inc = words(f.include)
  if (inc.length && !inc.some((w) => text.includes(w))) return false
  if (words(f.exclude).some((w) => text.includes(w))) return false
  for (const m of RANGES) {
    const r = f.ranges[m.key]
    if (!r || (r[0] === null && r[1] === null)) continue
    const v = m.get(t, now, f.window)
    if (v === null) return false
    if (r[0] !== null && v < r[0] * m.scale) return false
    if (r[1] !== null && v > r[1] * m.scale) return false
  }
  return true
}

// ─── Presets ─────────────────────────────────────────────────────────────────
export interface FilterPreset {
  id: string
  name: string
  icon: string
  filter: TrenchFilter
  builtin?: boolean
  chain?: 'all' | Chain // the chain view it belongs to (built-ins without one show everywhere)
}

const F = (p: Partial<TrenchFilter>): TrenchFilter => ({ ...EMPTY_FILTER, ...p })
export const BUILTIN_PRESETS: FilterPreset[] = [
  { id: 'b-pump', name: 'pump.fun only', icon: '💊', builtin: true, chain: 'sol', filter: F({ pads: ['pump'] }) },
  { id: 'b-clean', name: 'Clean', icon: '🧼', builtin: true, filter: F({ checks: { hideDead: true, noMint: true, unflagged: true }, ranges: { top10: [null, 30], dev: [null, 5], insiders: [null, 10], bundler: [null, 10], snipers: [null, 8] } }) },
  { id: 'b-fresh', name: 'Fresh 5m', icon: '🌱', builtin: true, filter: F({ checks: { hideDead: true }, ranges: { age: [null, 5] } }) },
  { id: 'b-almost', name: 'Almost bonded', icon: '🎯', builtin: true, filter: F({ checks: { hideDead: true }, ranges: { progress: [80, null] } }) },
  { id: 'b-hot1m', name: 'Hot 1m', icon: '⚡', builtin: true, filter: F({ window: '1m', checks: { hideDead: true }, ranges: { volume: [1, null], txns: [8, null] } }) },
  { id: 'b-volume', name: 'Volume movers', icon: '🌊', builtin: true, filter: F({ window: '5m', checks: { hideDead: true }, ranges: { volume: [3, null], change: [10, null] } }) },
  { id: 'b-socials', name: 'Has socials', icon: '📣', builtin: true, filter: F({ checks: { x: true, tg: true, hideDead: true } }) },
  { id: 'b-tax', name: 'Tax coins', icon: '🧾', builtin: true, filter: F({ checks: { taxOnly: true, hideDead: true } }) },
]

const canon = (f: TrenchFilter) =>
  JSON.stringify({
    pads: [...f.pads].sort(), include: f.include.trim(), exclude: f.exclude.trim(),
    // The window only matters when a window-based range is set.
    window: ['volume', 'txns', 'buys', 'sells', 'change'].some((k) => f.ranges[k as RangeKey]) ? f.window : '',
    ranges: Object.fromEntries(Object.entries(f.ranges).filter(([, r]) => r && (r[0] !== null || r[1] !== null)).sort(([a], [b]) => a.localeCompare(b))),
    checks: Object.keys(f.checks).filter((k) => f.checks[k as CheckKey]).sort(),
  })
export const sameFilter = (a: TrenchFilter, b: TrenchFilter) => canon(a) === canon(b)
/** The preset a filter currently matches, if any. */
export const presetFor = (f: TrenchFilter, presets: FilterPreset[]) => (countActive(f) ? presets.find((p) => sameFilter(p.filter, f)) : undefined)

/** Normalise a saved filter; older saves had hideDead / taxOnly booleans instead of checks. */
export function withDefaults(f: (Partial<TrenchFilter> & { hideDead?: boolean; taxOnly?: boolean }) | null | undefined): TrenchFilter {
  const checks = { ...(f?.checks ?? {}) }
  if (f?.hideDead) checks.hideDead = true
  if (f?.taxOnly) checks.taxOnly = true
  return { pads: f?.pads ?? [], include: f?.include ?? '', exclude: f?.exclude ?? '', window: f?.window ?? '1h', ranges: { ...(f?.ranges ?? {}) }, checks }
}
