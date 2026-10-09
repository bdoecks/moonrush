// Chat safety for rooms and the World: a blocked-word filter (slurs are masked, the worst are refused), no links in
// the public World, and a per-player rate limit. All of it runs on the server, so it can't be switched off in a
// browser. Kept deliberately small and readable: the admin's mute / ban tools handle what a word list can't.
import { COIN_IMAGE_MAX, cut, hasLink, isEmoji, tidyText, visibleCount, whole } from '../src/game/textRules'
import { imageSize } from './imageSize'

/** Letters people swap in to dodge filters: digits and signs, and look-alike letters from the Cyrillic and Greek alphabets. */
const LOOKALIKES: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i',
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'y', '\u0456': 'i', '\u0458': 'j', '\u0455': 's', '\u04bb': 'h', '\u043a': 'k', '\u043c': 'm', '\u0442': 't',
  '\u03b1': 'a', '\u03b5': 'e', '\u03bf': 'o', '\u03b9': 'i', '\u03ba': 'k', '\u03bd': 'v', '\u03c4': 't', '\u03c5': 'u', '\u03c1': 'p',
}
const SWAPPED = /[013457@$!\u0430\u0435\u043e\u0440\u0441\u0445\u0443\u0456\u0458\u0455\u04bb\u043a\u043c\u0442\u03b1\u03b5\u03bf\u03b9\u03ba\u03bd\u03c4\u03c5\u03c1]/g
// Full-width and "fancy" letters become plain ones and accents / stacked marks are dropped first (NFKD), then the
// swaps above, then long runs of one letter are shortened. The other-alphabet swaps are only made in a word that also
// has a Latin letter: a word wholly in Greek or Cyrillic is a word, not a disguise (Greek "raki" must not read "paki").
const SIGNS = /[013457@$!]/g
const normalize = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\p{L}\p{N}@$!]+/gu, (w) => w.replace(/[a-z]/.test(w) ? SWAPPED : SIGNS, (c) => LOOKALIKES[c] ?? c)).replace(/(.)\1{2,}/g, '$1$1')

// Slurs and hate terms: masked as *** . Whole words only (with their usual endings), so "raccoon" or "spice" are fine.
const MASK = [
  'nigg[a-z]*', 'fag(got)?s?', 'retard(ed|s)?', 'trann(y|ies)', 'kikes?', 'spics?', 'chinks?', 'gooks?', 'wetbacks?', 'coons?', 'pakis?', 'dykes?', 'beaners?',
].map((p) => new RegExp(`(?<![a-z])${p}(?![a-z])`, 'g')) // "not part of a longer word" (underscores and digits around it don't hide it)
// Things that get the whole message refused (and count as a strike).
const REFUSE = [
  /\bkill\s+(yo)?ur\s?self\b/, /\bkys\b/, /\bi('| a)?m\s+going\s+to\s+(kill|rape|shoot)\s+you\b/, /\brape\s+(you|her|him)\b/, /\bchild\s*porn\b/, /\bcp\s+link/,
]
// Names and tickers are often one run of letters ("MyWordCoin", "AWORD"), where a whole-word test sees nothing. These
// few stems are looked for inside the words of a name too. Not at the very end of a word ("MiniGG", "SofaGG"), and
// the real words that contain one are let through by name (to laugh, a fire-proofing, a bassoon, Italian for beech).
const STEMS = /n+i+g{2,}(?!$)|f+a+g{2,}(?!$)|f+a+g+o+t|t+r+a+n{2,}(y|ie)|r+e+t+a+r+d(?!ant|ation)/
const INNOCENT = /^(snigger(s|ed|ing)?|knigge|retarder(s)?|retardando|retardio|faggio|faggin|faggeto|faggiano|fagott(o|i)?)$/

export interface Moderated {
  ok: boolean
  text: string
  reason?: string // why it was refused (told to the sender only)
  strike?: boolean // a refused message that should count toward an automatic mute
}

// Invisible and control characters (line breaks, zero-width spaces, "write this backwards" marks).
const HIDDEN = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f]/g

/** Check a chat message or post. `noLinks`: the public World doesn't allow links (scams, spam). */
export function moderate(raw: unknown, opts: { noLinks?: boolean } = {}): Moderated {
  // Anything that is not text counts as nothing said. Half an emoji is dropped, also the one a cut can leave behind.
  const text = cut(whole(typeof raw === 'string' ? raw.slice(0, 2000) : '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim(), 200).trim()
  if (!text) return { ok: false, text: '' }
  const norm = normalize(text)
  if (REFUSE.some((re) => re.test(norm))) return { ok: false, text, reason: 'That message isn’t allowed here.', strike: true }
  if (opts.noLinks && hasLink(text)) return { ok: false, text, reason: 'Links aren’t allowed in World chat.' }
  // Mask slurs: find them in the normalized text and star out the same span in the original.
  let out = text
  let hit = false
  for (const re of MASK) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(norm))) {
      // normalize() can change the length (runs of letters, fancy letters), so only mask in place when the lengths
      // still line up; otherwise star the lot.
      hit = true
      out = norm.length === text.length ? out.slice(0, m.index) + '*'.repeat(m[0].length) + out.slice(m.index + m[0].length) : '***'
    }
  }
  return { ok: true, text: out, ...(hit ? { strike: true } : {}) }
}

/** True if a name contains a blocked word (guests with such a name become "Anon"; a coin with one is refused). */
export const nameBlocked = (name: unknown) => {
  // ("Maine Coon" is a cat. The one innocent pairing common enough in coin names to let through by name.)
  const n = normalize(typeof name === 'string' ? name.slice(0, 200) : '').replace(/\bmaine coons?\b/g, 'maine cat')
  if (MASK.some((re) => ((re.lastIndex = 0), re.test(n))) || REFUSE.some((re) => re.test(n))) return true
  // Inside words too (see STEMS): letters only, and letters spelled out one by one ("n i g ...") count as one word.
  const words: string[] = []
  let spelled = ''
  for (const w of n.replace(/[^a-z\s]/g, '').split(/\s+/)) {
    if (w.length === 1) spelled += w
    else {
      if (spelled) words.push(spelled)
      spelled = ''
      words.push(w)
    }
  }
  if (spelled) words.push(spelled)
  return words.some((w) => !INNOCENT.test(w) && STEMS.test(w))
}

// ─── Coin looks ──────────────────────────────────────────────────────────────
// A new coin's name, ticker, description and picture come from the player's browser, and everyone in the room sees
// them. The game's own form keeps them tidy (`validateCook`); a changed game could send anything, so the server
// checks them again before it charges for the launch. (The coin's id comes from the browser too: see cook().)

const EMBEDDED_IMAGE = /^data:image\/(jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/
/** The most pixels a coin's picture may have on a side. The game's picker makes 160 × 160. */
export const COIN_IMAGE_SIDE = 1024

/**
 * True for a picture carried inside the coin itself: a JPG, WebP or GIF (the kinds the game's picker makes) of a
 * sane size. A picture link is not allowed in rooms: every player's browser would fetch it from whatever computer
 * the link names, which shows that computer's owner each player's address.
 */
export const embeddedImage = (s: unknown): s is string => {
  if (typeof s !== 'string' || s.length > COIN_IMAGE_MAX) return false
  const m = EMBEDDED_IMAGE.exec(s)
  if (!m) return false
  const size = imageSize(Buffer.from(m[2], 'base64'))
  return !!size && size.type === m[1] && size.w >= 1 && size.h >= 1 && size.w <= COIN_IMAGE_SIDE && size.h <= COIN_IMAGE_SIDE
}

export interface CoinLook { name: string; ticker: string; description: string; emoji: string; hue: number; image?: string }

/** Clean and check what a player gave a new coin. Returns the cleaned look, or the reason it is refused (a string). */
export function coinLook(c: { name?: unknown; ticker?: unknown; description?: unknown; emoji?: unknown; hue?: unknown; image?: unknown }, opts: { noLinks?: boolean } = {}): CoinLook | string {
  const text = (v: unknown) => (typeof v === 'string' ? v : '') // anything else (a number, a list, an object) is no text
  const name = tidyText(text(c.name))
  if (name.length < 2 || name.length > 24) return 'Name must be 2–24 characters'
  if (visibleCount(name) < 2) return 'Name needs at least two letters, digits or emoji'
  const ticker = text(c.ticker)
  if (!/^[A-Z0-9]{2,10}$/.test(ticker)) return 'Ticker must be 2–10 letters or digits'
  if (nameBlocked(name) || nameBlocked(ticker)) return 'That coin name isn’t allowed.'
  if (opts.noLinks && hasLink(name)) return 'Links aren’t allowed in a World coin’s name.'
  let description = cut(tidyText(text(c.description)), 140).trim()
  if (description) {
    const m = moderate(description, opts)
    if (!m.ok) return m.strike ? 'That coin description isn’t allowed.' : 'Links aren’t allowed in a World coin’s description.'
    description = m.text // slurs are starred out, as in chat
  }
  // The icon: a few emoji and nothing else. Cut between characters (an emoji is often two code units or more).
  let emoji = ''
  for (const ch of whole(text(c.emoji).slice(0, 64))) {
    if (emoji.length + ch.length > 8) break
    emoji += ch
  }
  emoji = tidyText(emoji) // (a cut can leave a joiner with nothing after it)
  if (!isEmoji(emoji)) emoji = '🪙'
  const hue = typeof c.hue === 'number' && Number.isFinite(c.hue) ? Math.min(360, Math.max(0, c.hue)) : 0
  if (c.image === undefined || c.image === null || c.image === '') return { name, ticker, description, emoji, hue }
  if (typeof c.image !== 'string') return 'That picture can’t be used online. Upload it again.'
  if (/^https?:\/\//i.test(c.image.slice(0, 16))) return 'Online, a coin’s picture has to be uploaded. A picture link only works in solo play.'
  if (c.image.length > COIN_IMAGE_MAX) return 'That picture is too big to use online. Try a smaller one (a GIF has to be under about 45 KB).'
  if (!embeddedImage(c.image)) return 'That picture can’t be used online. Upload it again as a JPG, WebP or GIF.'
  return { name, ticker, description, emoji, hue, image: c.image }
}

// ─── Rate limit ──────────────────────────────────────────────────────────────
export const CHAT_GAP_MS = 1500 // at least this long between messages
export const CHAT_PER_MIN = 10
export const REPEAT_MS = 30_000 // the same message again within this is dropped
export const STRIKES_TO_MUTE = 3 // refused / masked messages within STRIKE_WINDOW_MS before an automatic mute
export const STRIKE_WINDOW_MS = 10 * 60_000
export const AUTO_MUTE_MS = 10 * 60_000

export interface ChatMeter {
  times: number[]
  last?: string
  lastAt?: number
  strikes: number[]
}

/** Why this message can't go out right now (too fast, a repeat), or null if it can. */
export function rateCheck(meter: ChatMeter, text: string, now: number): string | null {
  meter.times = meter.times.filter((t) => now - t < 60_000)
  const prev = meter.times[meter.times.length - 1]
  if (prev !== undefined && now - prev < CHAT_GAP_MS) return 'Slow down a little.'
  if (meter.times.length >= CHAT_PER_MIN) return 'You’re sending messages too fast. Give it a minute.'
  if (meter.last === text && now - (meter.lastAt ?? 0) < REPEAT_MS) return 'You just said that.'
  return null
}

/** Note a strike; true when it's time for an automatic mute. */
export function strike(meter: ChatMeter, now: number): boolean {
  meter.strikes = [...meter.strikes.filter((t) => now - t < STRIKE_WINDOW_MS), now]
  return meter.strikes.length >= STRIKES_TO_MUTE
}
