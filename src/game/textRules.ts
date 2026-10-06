// Rules for the text and pictures players give to things everyone sees (a coin's name, description and picture).
// Shared by the game's forms and the server, so the form refuses what the server would refuse and says why first.
// Pure text code: no browser or server APIs, and no look-behind patterns (old Safari can't read them).

// The game's own launchpads are named like websites; naming one is not posting a link.
const PAD_NAME = /^(?:(?:pump|bonk|stonk)\.fun|long\.xyz)$/i
const LINKS = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|xyz|gg|fun|app|co|ru|me|link|click|top)\b(\/\S*)?/gi

/** True if the text contains a web link (the bare names of the game's own launchpads don't count). */
export const hasLink = (text: string) => {
  for (const m of text.matchAll(LINKS)) {
    const at = m.index ?? 0
    const before = text.charAt(at - 1)
    const after = text.slice(at + m[0].length, at + m[0].length + 2)
    // A pad name with a path, with http(s):// or www. in front, or as part of a longer address is a link like any other.
    if (!PAD_NAME.test(m[0]) || /[.@-]/.test(before) || /^(?:[@-]|\.[a-z0-9])/i.test(after)) return true
  }
  return false
}

// Half an emoji (a lone "surrogate"). Cutting text to a length can leave one behind, and a changed game can send
// one. The database refuses to save text that has one, so none may get into a room.
const PAIR_OR_HALF = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g
/** The text without any half emoji. */
export const whole = (s: string) => s.replace(PAIR_OR_HALF, (m) => (m.length === 2 ? m : ''))
/** Cut text to at most `n` characters without leaving half an emoji at the end. */
export const cut = (s: string, n: number) => whole(s.slice(0, n))

// Characters that draw nothing: controls, "format" marks (zero-width, text direction, tags), private-use and
// unassigned code points, and the blank fillers people use for empty names.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\u115f\u1160\u2800\u3164\uffa0]/gu
const JOINER = '\u200d' // glues emoji together (a family, a job): kept only where it does that
const BEFORE_JOINER = /[\p{Extended_Pictographic}\ufe0f\u{1F3FB}-\u{1F3FF}]$/u
const AFTER_JOINER = /^\p{Extended_Pictographic}/u

/**
 * One line of clean text: no half emoji, no invisible characters, single spaces, trimmed. Only the first 2,000
 * characters are looked at (nothing a player types for a name or description is longer, and a changed game could
 * send megabytes).
 */
export function tidyText(raw: string): string {
  const s = whole(raw.slice(0, 2000)).replace(/[\t\n\r\u2028\u2029]/g, ' ')
  let out = ''
  for (let i = 0; i < s.length; ) {
    const ch = String.fromCodePoint(s.codePointAt(i)!)
    const next = i + ch.length
    if (ch === JOINER) {
      if (BEFORE_JOINER.test(out) && AFTER_JOINER.test(s.slice(next, next + 2))) out += ch
    } else if (!ch.match(INVISIBLE)) out += ch
    i = next
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** How many characters of the text a person can actually see as letters, digits or emoji. */
export const visibleCount = (s: string) => (s.match(/[\p{L}\p{N}\p{Extended_Pictographic}]|\p{Regional_Indicator}{1,2}/gu) ?? []).length // (a flag is a pair of "regional" letters)

/** True if the text is one or more emoji and nothing else (a coin's icon). */
export const isEmoji = (s: string) => /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u200d\ufe0f\u{1F3FB}-\u{1F3FF}])+$/u.test(s) && /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(s)

/**
 * The longest picture a coin may carry online: characters of its data URL, about 45 KB of image. Every player in the
 * room is sent it, and it is saved with the World. (The game's own picker makes stills of a few KB; only GIFs come near.)
 */
export const COIN_IMAGE_MAX = 64_000
