// V2 stage 4: where the game's content comes from, said honestly, and the one door outside data comes in by.
// Three kinds of content, never mixed up:
//   simulated : every coin, price, wallet and trade. Made by this game's market engine. Nothing real.
//   generated : the stories. Written by the game; every account, outlet and brand in them is invented.
//   outside   : the themes that were hot in real launches (`TrendFeed`). The only thing that comes from outside, and it
//               always carries where it is from and its date: a sample shipped with the game, the owner's own
//               recording, or a provider somebody plugged in (server/trendSource.ts).
// Anything from outside is cleaned here before the game sees it: only approved theme words get through (the same
// allow-list as trend coins, so no real person, brand or politics can arrive by this door), and a list older than
// TREND_MAX_AGE_DAYS is stale: still shown with its date, no longer treated as what is running now.
// Pure and server-safe. `scripts/source-test.ts` holds all of it.
import { SAFE_THEMES, themeOf } from '../data/themeWords'
import type { TrendFeed } from '../types'

export const TREND_MAX_AGE_DAYS = 14
export const TREND_MAX_THEMES = 40
const DAY = 86_400_000

/** How many days old a feed's data is (not when it was fetched: when it is FROM). Infinity if it carries no date. */
export function feedAgeDays(feed: Pick<TrendFeed, 'asOf'>, nowMs: number): number {
  const at = Date.parse(feed.asOf)
  return Number.isFinite(at) ? Math.max(0, (nowMs - at) / DAY) : Infinity
}

export const isStale = (feed: Pick<TrendFeed, 'asOf'> | null | undefined, nowMs: number) => !feed || feedAgeDays(feed, nowMs) > TREND_MAX_AGE_DAYS

export interface CleanResult {
  feed: TrendFeed | null
  dropped: string[] // words that were not let in, for whoever runs the server to read
  error?: string // why there is no feed at all
}

/**
 * Anything that claims to be a trend feed (a provider's answer, a file), made safe or refused. `raw` is
 * `{ asOf, themes: [{ word, weight? }] }`; a theme's kind (its narrative) is the game's own, never the sender's.
 */
export function cleanFeed(raw: unknown, meta: { source: TrendFeed['source']; provider?: string; fetchedAt?: string }): CleanResult {
  const dropped: string[] = []
  if (!raw || typeof raw !== 'object') return { feed: null, dropped, error: 'not an object' }
  const o = raw as { asOf?: unknown; themes?: unknown }
  const asOf = typeof o.asOf === 'string' && Number.isFinite(Date.parse(o.asOf)) ? new Date(Date.parse(o.asOf)).toISOString().slice(0, 10) : null
  if (!asOf) return { feed: null, dropped, error: 'no valid "asOf" date: outside data must say when it is from' }
  if (Date.parse(asOf) > Date.now() + DAY) return { feed: null, dropped, error: '"asOf" is in the future' }
  if (!Array.isArray(o.themes)) return { feed: null, dropped, error: 'no "themes" list' }
  const best = new Map<string, number>()
  for (const x of o.themes.slice(0, 500)) {
    const word = typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { word?: unknown }).word === 'string' ? (x as { word: string }).word : null
    if (word === null) continue
    const theme = /^[a-zA-Z]{2,24}$/.test(word) ? themeOf(word) : null
    if (!theme) {
      if (dropped.length < 50) dropped.push(String(word).slice(0, 24))
      continue
    }
    const w = typeof x === 'object' ? Number((x as { weight?: unknown }).weight) : NaN
    const weight = Number.isFinite(w) ? Math.min(1, Math.max(0, w)) : 0.5
    best.set(theme, Math.max(best.get(theme) ?? 0, weight))
  }
  if (!best.size) return { feed: null, dropped, error: 'none of its themes is on the approved list' }
  // Hottest first, scaled so the hottest is 1 (the story engine reads weights that way).
  const top = Math.max(...best.values()) || 1
  const themes = [...best.entries()].map(([word, weight]) => ({ word, narrative: SAFE_THEMES.get(word)!, weight: Math.round((weight / top) * 1000) / 1000 })).sort((a, b) => b.weight - a.weight).slice(0, TREND_MAX_THEMES)
  const provider = meta.provider ? meta.provider.replace(/[^\w .\-]/g, '').trim().slice(0, 40) : undefined
  return { feed: { source: meta.source, asOf, themes, ...(provider ? { provider } : {}), ...(meta.fetchedAt ? { fetchedAt: meta.fetchedAt } : {}) }, dropped }
}

/** Where a feed is from, in words for a player. Never calls anything "live" that is not. */
export function feedLabel(feed: TrendFeed): string {
  if (feed.source === 'provider') return `${feed.provider ?? 'a data provider'}`
  return feed.source === 'recorded' ? 'the owner’s own recording of real launches' : 'a sample list shipped with the game'
}

export interface SourceRow {
  kind: 'simulated' | 'generated' | 'outside'
  title: string
  what: string
  from: string
  status: 'ok' | 'stale' | 'none'
  note: string
}

/** The three kinds of content and where each comes from right now: what the Data sources panel shows. */
export function describeSources(feed: TrendFeed | null | undefined, nowMs: number): SourceRow[] {
  const age = feed ? feedAgeDays(feed, nowMs) : Infinity
  const stale = isStale(feed, nowMs)
  const days = Number.isFinite(age) ? (age < 1 ? 'today' : `${Math.floor(age)} day${Math.floor(age) === 1 ? '' : 's'} ago`) : ''
  return [
    { kind: 'simulated', title: 'Simulated', what: 'Every coin, price, wallet, trader and trade', from: 'This game’s own market engine', status: 'ok', note: 'Nothing here is a real coin, a real wallet or real money.' },
    { kind: 'generated', title: 'Generated', what: 'The stories: posts, calls, rumours, drama', from: 'Written by the game', status: 'ok', note: 'Every account, outlet and brand in a story is invented.' },
    {
      kind: 'outside', title: 'Outside data', what: 'Which themes were hot in real launches',
      from: feed ? feedLabel(feed) : 'Nothing connected',
      status: !feed ? 'none' : stale ? 'stale' : 'ok',
      note: !feed
        ? 'No outside data is in use.'
        : `${feed.themes.length} themes, from ${feed.asOf} (${days}).${feed.source === 'provider' && feed.fetchedAt ? ` Last fetched ${feed.fetchedAt.slice(0, 16).replace('T', ' ')} UTC.` : ''} ${stale ? `Older than ${TREND_MAX_AGE_DAYS} days: shown with its date, no longer treated as what is running now.` : feed.source === 'provider' ? 'Refreshed from the provider; only approved theme words are let in.' : 'Not a live feed.'}`,
    },
  ]
}
