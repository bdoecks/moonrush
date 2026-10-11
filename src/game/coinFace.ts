// A photo for a coin that has no picture of its own: the market's own coins wear an emoji, and when that emoji is
// something the game has photos of (a frog, a pizza, a robot: the story market's subjects, data/sparkPics.ts, and the
// extra ones in data/emojiPics.ts) the coin shows one of those instead. Worked out in the browser from the coin's id,
// so the same coin always gets the same photo, nothing is sent or saved, and no dice are used. A coin a player made
// keeps what its maker chose, and a coin launched on a post has that post's picture already (Token.pic).
import { EMOJI_PICS } from '../data/emojiPics'
import { SPARK_PICS } from '../data/sparkPics'
import { SUBJECTS } from '../data/sparkPosts'
import { hash01 } from './feedFlavor'

const BY_EMOJI = new Map<string, string[]>()
for (const s of SUBJECTS) {
  const any = SPARK_PICS[s.word]?.any ?? []
  if (any.length) BY_EMOJI.set(s.emoji, [...(BY_EMOJI.get(s.emoji) ?? []), ...any])
}
for (const [emoji, files] of Object.entries(EMOJI_PICS)) if (files.length) BY_EMOJI.set(emoji, [...(BY_EMOJI.get(emoji) ?? []), ...files])

/** The photo (a file in public/posts) a coin with this emoji and id shows, if the game has one for that emoji. */
export function emojiPic(emoji: string, id: string): string | undefined {
  const files = BY_EMOJI.get(emoji)
  return files?.length ? files[Math.floor(hash01(id + 'face') * files.length) % files.length] : undefined
}
