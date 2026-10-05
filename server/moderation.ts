// Chat safety for rooms and the World: a blocked-word filter (slurs are masked, the worst are refused), no links in
// the public World, and a per-player rate limit. All of it runs on the server, so it can't be switched off in a
// browser. Kept deliberately small and readable: the admin's mute / ban tools handle what a word list can't.

/** Letters people swap in to dodge filters. */
const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' }
const normalize = (s: string) => s.toLowerCase().replace(/[013457@$!]/g, (c) => LOOKALIKES[c] ?? c).replace(/(.)\1{2,}/g, '$1$1')

// Slurs and hate terms: masked as *** . Whole words only (with their usual endings), so "raccoon" or "spice" are fine.
const MASK = [
  'nigg[a-z]*', 'fag(got)?s?', 'retard(ed|s)?', 'trann(y|ies)', 'kikes?', 'spics?', 'chinks?', 'gooks?', 'wetbacks?', 'coons?', 'pakis?', 'dykes?', 'beaners?',
].map((p) => new RegExp(`(?<![a-z])${p}(?![a-z])`, 'g')) // "not part of a longer word" (underscores and digits around it don't hide it)
// Things that get the whole message refused (and count as a strike).
const REFUSE = [
  /\bkill\s+(yo)?ur\s?self\b/, /\bkys\b/, /\bi('| a)?m\s+going\s+to\s+(kill|rape|shoot)\s+you\b/, /\brape\s+(you|her|him)\b/, /\bchild\s*porn\b/, /\bcp\s+link/,
]
const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(com|net|org|io|xyz|gg|fun|app|co|ru|me|link|click|top)\b(\/\S*)?/i

export interface Moderated {
  ok: boolean
  text: string
  reason?: string // why it was refused (told to the sender only)
  strike?: boolean // a refused message that should count toward an automatic mute
}

// Invisible and control characters (line breaks, zero-width spaces, "write this backwards" marks).
const HIDDEN = /[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202f]/g

/** Check a chat message or post. `noLinks`: the public World doesn't allow links (scams, spam). */
export function moderate(raw: string, opts: { noLinks?: boolean } = {}): Moderated {
  const text = String(raw ?? '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!text) return { ok: false, text: '' }
  const norm = normalize(text)
  if (REFUSE.some((re) => re.test(norm))) return { ok: false, text, reason: 'That message isn’t allowed here.', strike: true }
  if (opts.noLinks && LINK.test(text)) return { ok: false, text, reason: 'Links aren’t allowed in World chat.' }
  // Mask slurs: find them in the normalized text and star out the same span in the original.
  let out = text
  let hit = false
  for (const re of MASK) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(norm))) {
      // normalize() can shorten runs of letters, so only mask when the lengths still line up; otherwise star the lot.
      hit = true
      out = norm.length === text.length ? out.slice(0, m.index) + '*'.repeat(m[0].length) + out.slice(m.index + m[0].length) : '***'
    }
  }
  return { ok: true, text: out, ...(hit ? { strike: true } : {}) }
}

/** True if a name contains a blocked word (guests with such a name become "Anon"). */
export const nameBlocked = (name: string) => {
  const n = normalize(String(name ?? ''))
  return MASK.some((re) => ((re.lastIndex = 0), re.test(n))) || REFUSE.some((re) => re.test(n))
}

// ─── Coin looks ──────────────────────────────────────────────────────────────
// A new coin's name, ticker, description and picture are the one part of a launch that comes from the player's
// browser, and everyone in the room sees them. The game's own form keeps them tidy (`validateCook`); a changed game
// could send anything, so the server checks them again before it charges for the launch.

/** The longest picture a coin may carry: characters of its data URL, about 150 KB of image. Every player is sent it. */
export const COIN_IMAGE_MAX = 200_000
const EMBEDDED_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * True for a picture carried inside the coin itself. A picture link is not allowed in rooms: every player's browser
 * would fetch it from whatever computer the link names, which shows that computer's owner each player's address.
 */
export const embeddedImage = (s: unknown): s is string => typeof s === 'string' && s.length <= COIN_IMAGE_MAX && EMBEDDED_IMAGE.test(s)

export interface CoinLook { name: string; ticker: string; description: string; emoji: string; hue: number; image?: string }

/** Clean and check what a player gave a new coin. Returns the cleaned look, or the reason it is refused (a string). */
export function coinLook(c: { name?: unknown; ticker?: unknown; description?: unknown; emoji?: unknown; hue?: unknown; image?: unknown }, opts: { noLinks?: boolean } = {}): CoinLook | string {
  const tidy = (s: unknown) => String(s ?? '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim()
  const name = tidy(c.name)
  if (name.length < 2 || name.length > 24) return 'Name must be 2–24 characters'
  const ticker = typeof c.ticker === 'string' ? c.ticker : ''
  if (!/^[A-Z0-9]{2,8}$/.test(ticker)) return 'Ticker must be 2–8 letters or digits'
  if (nameBlocked(name) || nameBlocked(ticker)) return 'That coin name isn’t allowed.'
  if (opts.noLinks && LINK.test(name)) return 'Links aren’t allowed in a World coin’s name.'
  let description = tidy(c.description).slice(0, 140)
  if (description) {
    const m = moderate(description, opts)
    if (!m.ok) return m.strike ? 'That coin description isn’t allowed.' : 'Links aren’t allowed in a World coin’s description.'
    description = m.text // slurs are starred out, as in chat
  }
  // The icon: a few emoji, never text. Cut between characters (an emoji is often two code units).
  let emoji = ''
  for (const ch of String(c.emoji ?? '').replace(/[\u0000-\u001f\u007f]/g, '')) {
    if (emoji.length + ch.length > 8) break
    emoji += ch
  }
  if (!emoji || /[\p{L}\p{N}<>&]/u.test(emoji)) emoji = '🪙'
  const h = Number(c.hue)
  const hue = Number.isFinite(h) ? Math.min(360, Math.max(0, h)) : 0
  if (c.image === undefined || c.image === null || c.image === '') return { name, ticker, description, emoji, hue }
  if (embeddedImage(c.image)) return { name, ticker, description, emoji, hue, image: c.image }
  if (typeof c.image === 'string' && /^https?:\/\//i.test(c.image)) return 'Online, a coin’s picture has to be uploaded. A picture link only works in solo play.'
  return typeof c.image === 'string' && c.image.length > COIN_IMAGE_MAX ? 'That picture is too big to use online. Try a smaller file.' : 'That picture can’t be used online. Upload a PNG, JPG, WebP or GIF.'
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
