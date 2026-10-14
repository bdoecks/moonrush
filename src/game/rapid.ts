// Rapid deploy (the owner's design, 2026-10-13): a dev presses "Rapid deploy" on a post and gets three coin ideas made
// from it, each ready to launch with the dev's own rapid-deploy settings, and one click launches. Also the auto-sell
// rules a launch can carry (for the dev bag and for the bundle). Pure: the browser only, nothing here touches money.
//
// The ideas are read off the post's own words, the way a player would read them: the name the post gives, the thing
// it is about. Nothing hidden is used (a browser never has a post's hidden side), so an idea is exactly as right as a
// careful reader would be, and a post that is a fake still makes ideas.
import { SPARK_NAMES, SPARK_TITLES, SUBJECTS, TECH_NAMES } from '../data/sparkPosts'
import type { Chain, PadId, RapidSettings, SellRules, Spark } from '../types'
import { tickerOf } from './sparks'

export type TickerStyle = RapidSettings['ticker']

export const RAPID_DEFAULT: RapidSettings = {
  chain: 'sol',
  pad: 'pump',
  devBuy: 0,
  bundle: { wallets: 0, perWallet: 0.1, stagger: false },
  ticker: 'full',
  dev: { on: false, after: null, at: [], mcap: null, stop: null },
  bundleSell: { on: false, after: null, at: [], mcap: null, stop: null },
}
/** A player's settings with anything missing (a save from before a field was added) filled in. */
export const rapidOf = (r?: Partial<RapidSettings>): RapidSettings => ({
  ...RAPID_DEFAULT,
  ...r,
  bundle: { ...RAPID_DEFAULT.bundle, ...r?.bundle },
  dev: { ...RAPID_DEFAULT.dev, ...r?.dev },
  bundleSell: { ...RAPID_DEFAULT.bundleSell, ...r?.bundleSell },
})

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const has = (text: string, word: string) => new RegExp(`(^|[^A-Za-z])${esc(word)}($|[^A-Za-z])`, 'i').test(text)

/** The thing a post is about ("horse"), as its words say it: the longest subject word in the text. */
export function postSubject(text: string) {
  return SUBJECTS.filter((s) => has(text, s.word)).sort((a, b) => b.word.length - a.word.length)[0]
}

/** The name a post gives ("Waffles", "Mayor Otter", a tool's name), as a reader finds it in the text. */
export function postName(text: string): string | undefined {
  for (const title of SPARK_TITLES) {
    const m = new RegExp(`(^|[^A-Za-z])${title} ?([A-Za-z]+)`, 'i').exec(text) // (a hashtag runs it together: #MayorOtter)
    if (m && SUBJECTS.some((s) => s.word === m[2].toLowerCase())) return `${title} ${cap(m[2].toLowerCase())}`
  }
  // (The first one the post mentions: a name comes before the thing it did.)
  const at = (n: string) => text.search(new RegExp(`(^|[^A-Za-z])${esc(n)}($|[^A-Za-z])`, 'i'))
  return [...SPARK_NAMES, ...TECH_NAMES].filter((n) => has(text, n)).sort((a, b) => at(a) - at(b) || b.length - a.length)[0]
}

/** A ticker for a name: the whole name, its last word (the short one), or its first letters. */
export function tickerFor(name: string, style: TickerStyle): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (style === 'short') return tickerOf(words[words.length - 1] ?? name).slice(0, 6)
  if (style === 'letters') return words.length > 1 ? tickerOf(words.map((w) => w[0]).join('')) : tickerOf(name).slice(0, 4)
  return tickerOf(name)
}

export interface RapidIdea {
  name: string
  ticker: string
  emoji: string
  why: string // in plain words, where the idea comes from
}

/** Three coin ideas for a post: its own name with your ticker style, the same name with another ticker, and your own version. */
export function rapidIdeas(spark: Pick<Spark, 'text'>, style: TickerStyle): RapidIdea[] {
  const subject = postSubject(spark.text)
  const named = postName(spark.text)
  const name = named ?? (subject ? cap(subject.word) : 'Main Character')
  const emoji = subject?.emoji ?? '✨'
  const first = tickerFor(name, style)
  const other = (['full', 'short', 'letters'] as TickerStyle[]).map((s) => tickerFor(name, s)).find((x) => x !== first) ?? `${first.slice(0, 7)}COIN`
  // Your own version: the "Baby" one (its ticker still fits).
  const last = name.split(' ').pop() ?? name
  const ownName = /^baby /i.test(name) ? `Lil ${last}` : `Baby ${last}`.slice(0, 24)
  return [
    { name, ticker: first, emoji, why: named ? 'The name in the post' : 'What the post is about' },
    { name, ticker: other, emoji, why: 'Same name, another ticker' },
    { name: ownName, ticker: tickerFor(ownName, style), emoji, why: 'Your own version' },
  ]
}

/** One auto-sell rule that is due now: what share of that part of the bag to sell, and its id (each fires once). */
export interface SellDue {
  id: string
  pct: number // of what is left of that part
  why: string
}

/**
 * Which of a part's auto-sell rules are due: `age` seconds since launch, `mcap` now, `entry` the market cap just
 * after launch. Time, market cap and stop loss sell all of it; each "times up" step sells its share once.
 */
export function sellsDue(rules: SellRules | undefined, part: 'dev' | 'bundle', age: number, mcap: number, entry: number, done: string[]): SellDue[] {
  if (!rules?.on || !(entry > 0)) return []
  const out: SellDue[] = []
  const once = (id: string, pct: number, why: string) => {
    if (!done.includes(`${part}:${id}`)) out.push({ id: `${part}:${id}`, pct, why })
  }
  if (rules.after != null && rules.after >= 0 && age >= rules.after) once('after', 1, `${rules.after}s after launch`)
  if (rules.mcap != null && rules.mcap > 0 && mcap >= rules.mcap) once('mcap', 1, 'market cap reached')
  if (rules.stop != null && rules.stop > 0 && mcap <= entry * (1 - rules.stop)) once('stop', 1, 'stop loss')
  ;(rules.at ?? []).forEach((s, i) => {
    if (s.x > 1 && s.pct > 0 && mcap >= entry * s.x) once(`x${i}`, Math.min(1, s.pct), `${s.x}x`)
  })
  return out
}

/** Where a rapid deploy goes when the settings name a launchpad that is not on the chain (kept from an older save). */
export const rapidPad = (r: RapidSettings, padsOf: (c: Chain) => { id: PadId }[]): PadId => (padsOf(r.chain).some((p) => p.id === r.pad) ? r.pad : padsOf(r.chain)[0].id)
