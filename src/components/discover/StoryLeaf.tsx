// The leaf on a Trenches card: a coin that was launched on a post (the story market, see game/sparks.ts) wears one,
// and hovering it (tapping it on a phone) shows that post as the X tracker shows it: who posted, the words, the
// picture and the newest replies. Nothing else (the owner's call, 2026-10-11): not the coin's theme, not its story
// feed, not how the story ended, and no way from here to the list of the post's other coins. The rest is for the
// player to look up. A coin with no post behind it has no leaf.
import { Leaf } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useGame } from '../../game/store'
import type { SocialPost, Token } from '../../types'
import { feedStyle, Tweet, X } from '../tracker/Tweet'

const W = 380
const TALL = 560 // (about what a post with a picture and three replies takes: used to keep the box on screen)
export function StoryLeaf({ t }: { t: Token; now: number }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const spark = useGame((s) => (t.spark ? s.market.sparks?.find((x) => x.id === t.spark!.id) : undefined))
  // (The post as it sits on the timeline, when it is still there: its likes and counts are that one's.)
  const posted = useGame((s) => (t.spark && at ? s.socialFeed.find((p) => p.sparkId === t.spark!.id) : undefined))
  if (!t.spark || !spark) return null
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    // Beside the leaf, kept on screen: below it when there is room, else as high as it has to go.
    const x = Math.min(Math.max(8, r.left - 12), window.innerWidth - W - 8)
    setAt({ x, y: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - TALL - 8)) })
  }
  const post: SocialPost = posted ?? { id: spark.tick * 1000 + 700, tick: spark.tick, time: spark.time, accountId: spark.by.id, by: spark.by, sparkId: spark.id, text: spark.text, isCall: false }
  return (
    <>
      <button
        type="button" aria-label={`The post $${t.ticker} was launched on`} aria-expanded={!!at}
        onMouseEnter={open} onMouseLeave={() => setAt(null)} onBlur={() => setAt(null)}
        // (A click only matters on a touch screen, where it is the way to read the leaf. It never opens the coin.)
        onClick={(e) => {
          e.stopPropagation()
          if (at) setAt(null)
          else open(e)
        }}
        className="flex shrink-0 items-center text-[#8fd14f]"
      >
        <Leaf size={11} />
      </button>
      {at && createPortal(
        <div role="tooltip" className="pointer-events-none fixed z-50 overflow-hidden rounded-2xl border shadow-2xl" style={{ ...feedStyle, borderColor: X.line, left: at.x, top: at.y, width: W, maxHeight: 'calc(100vh - 16px)' }}>
          <Tweet p={post} quiet />
        </div>,
        document.body,
      )}
    </>
  )
}
