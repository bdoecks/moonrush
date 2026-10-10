// The timeline's flavour (the words are in data/sparkFlavor.ts): how a named account writes, the follow-up it posts,
// the accounts that repost it with a line of their own, and the replies underneath. Pure, and NO DICE: everything is
// worked out from the post's own id, so it is the same for everybody, costs the market's random numbers nothing, and
// cannot depend on what the simulation hides (whether a story runs, which coin is right, whether a post is a larp).
// A reply about how a story ended is only ever written from what the post already shows publicly.
import { ACCOUNT_STYLE, FOLLOW_UPS, QUOTE_LINES, REPLIES } from '../data/sparkFlavor'
import { SPARK_FACES } from '../data/sparkFaces'
import { anonAccount, SPARK_ACCOUNTS } from '../data/sparkPosts'
import type { MarketState, SocialPost, Spark, SparkBy } from '../types'

/** A number in [0, 1) from a text: the same text always gives the same number. */
export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
/**
 * An account's profile picture (a file in public/faces): its own if it is a named account, else one from the pool the
 * nobodies share, always the same one for the same handle. None made yet: undefined, and the emoji shows.
 */
export function faceOf(handle: string): string | undefined {
  if (SPARK_FACES.named.includes(handle)) return handle
  return SPARK_FACES.pool > 0 ? `pool-${1 + (Math.floor(hash01(handle + 'face') * SPARK_FACES.pool) % SPARK_FACES.pool)}` : undefined
}
const pickBy = <T,>(a: readonly T[], key: string) => a[Math.floor(hash01(key) * a.length) % a.length]

/** A post in its account's own style (`key` = the post's id). A post that would get too long is left as it was. */
export function styleText(handle: string, text: string, key: string, name?: string): string {
  const st = ACCOUNT_STYLE[handle]
  if (!st) return text
  let out = st.upper ? text.toUpperCase() : st.lower ? text.toLowerCase() : text
  // (A lower-case voice still writes the name as it is: "a duck named Greg". The name is what a reader is after.)
  if (st.lower && name) out = out.split(name.toLowerCase()).join(name)
  const pre = st.pre ? pickBy(st.pre, key + 'pre') : ''
  const post = st.post ? pickBy(st.post, key + 'post') : ''
  // (Words after a post that does not end its sentence need a full stop first: "...named greg. i am not a vet".)
  out = `${pre}${out}${/^ [A-Za-z0-9]/.test(post) && /[A-Za-z0-9]$/.test(out) ? '.' : ''}${post}`
  return out.length <= 200 ? out : text
}

/** When (ticks after the post) its account follows up and others repost it; -1 = never. From the post's id alone. */
export function flavorPlan(s: Pick<Spark, 'id' | 'by'>) {
  const big = s.by.followers >= 20_000
  return {
    follow: hash01(s.id + 'f?') < (big ? 0.45 : 0.15) ? 14 + Math.floor(hash01(s.id + 'f@') * 28) : -1,
    quote1: big && hash01(s.id + 'q?') < 0.5 ? 6 + Math.floor(hash01(s.id + 'q@') * 30) : -1,
    quote2: s.by.followers >= 500_000 && hash01(s.id + 'r?') < 0.6 ? 10 + Math.floor(hash01(s.id + 'r@') * 45) : -1,
  }
}

const byOf = (a: (typeof SPARK_ACCOUNTS)[number]): SparkBy => ({ id: a.id, name: a.name, handle: a.handle, avatar: a.avatar, followers: a.followers, verified: a.verified, face: faceOf(a.handle) })
// Who reposts: accounts with a following of their own that are not outlets.
const QUOTERS = SPARK_ACCOUNTS.filter((a) => !a.news && (a.tier === 'mid' || a.tier === 'big'))

/**
 * The flavour posts due this tick: an open story's account following up, and other accounts reposting it. A follow-up
 * names the thing again, which its post already did (`names` = the open stories' names; a story that has settled gets
 * no follow-up, whichever way it went).
 */
export function flavorPosts(m: Pick<MarketState, 'tick' | 'time' | 'sparks'>, names: Record<string, string | undefined>, nextId: () => number): SocialPost[] {
  const out: SocialPost[] = []
  for (const s of m.sparks ?? []) {
    const age = m.tick - s.tick
    if (age < 6 || age > 60 || s.fake) continue
    const plan = flavorPlan(s)
    const name = names[s.id]
    if (age === plan.follow && name && !s.quote && s.over === undefined && !s.picked) {
      const line = pickBy(FOLLOW_UPS[s.kind], s.id + 'fl').replaceAll('{N}', name).replaceAll('{D}', String(12 + Math.floor(hash01(s.id + 'fd') * 80)))
      out.push({ id: nextId(), tick: m.tick, time: m.time, accountId: s.by.id, by: s.by, isCall: false, text: styleText(s.by.handle, line, s.id + 'fs', name) })
    }
    for (const [at, salt] of [[plan.quote1, 'q'], [plan.quote2, 'r']] as const) {
      if (age !== at) continue
      const who = pickBy(QUOTERS.filter((a) => a.handle !== s.by.handle && a.followers <= Math.max(300_000, s.by.followers)), s.id + salt + 'w')
      if (!who) continue
      const text = styleText(who.handle, pickBy(QUOTE_LINES, s.id + salt + 'l'), s.id + salt + 's')
      out.push({ id: nextId(), tick: m.tick, time: m.time, accountId: who.id, by: byOf(who), isCall: false, text, quote: { by: s.by, text: s.text } })
    }
  }
  return out
}

export interface Reply { handle: string; name: string; avatar: string; face?: string; text: string; at: number }

/**
 * The replies under a post that can be read `ageSec` seconds after it: more on a big account's post, the first within
 * seconds. Once the post shows how it ended (a coin picked, the timeline moved on, a fake come out) the newest replies
 * are about that, never before.
 */
export function repliesOf(s: Pick<Spark, 'id' | 'kind' | 'by' | 'picked' | 'over' | 'fake'>, ageSec: number): Reply[] {
  const f = s.by.followers
  const total = Math.min(14, Math.max(0, Math.round(Math.log10(Math.max(10, f)) * 1.6 - 3 + hash01(s.id + 'n') * 4)))
  const out: Reply[] = []
  const pool = [...REPLIES.any, ...REPLIES.any, ...REPLIES[s.kind]]
  const seen = new Set<string>()
  for (let i = 0; i < total; i++) {
    const at = 3 + i ** 1.5 * 5 * (0.5 + hash01(s.id + 'a' + i))
    if (at > ageSec) break
    let k = 0
    const rand = () => hash01(s.id + 'u' + i + ':' + k++)
    const who = anonAccount(rand, 'anon')
    let text = pickBy(pool, s.id + 't' + i)
    for (let j = 1; seen.has(text) && j < 6; j++) text = pickBy(pool, s.id + 't' + i + '.' + j)
    seen.add(text)
    out.push({ handle: who.handle, name: who.name, avatar: who.avatar, face: faceOf(who.handle), text, at })
  }
  const end = s.fake ? REPLIES.faked : s.picked ? REPLIES.picked : s.over !== undefined ? REPLIES.over : null
  if (end && total >= 3) {
    for (let i = 0; i < 1; i++) {
      let k = 0
      const who = anonAccount(() => hash01(s.id + 'e' + i + ':' + k++), 'anon')
      const text = pickBy(end, s.id + 'end' + i)
      if (out.some((r) => r.text === text)) continue
      out.push({ handle: who.handle, name: who.name, avatar: who.avatar, face: faceOf(who.handle), text, at: ageSec })
    }
  }
  return out
}
