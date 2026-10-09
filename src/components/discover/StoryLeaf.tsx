// The leaf on a Trenches card: hover it (tap it on a phone) to read what a coin is about before opening it. Its
// theme, what it says about itself, and the latest lines of its story feed, each marked with where it comes from, as
// on the coin page's Story tab. Green while the coin has a story running, grey when nobody is talking about it.
// A coin that was launched on a post (the story market, see game/sparks.ts) shows that post first.
import clsx from 'clsx'
import { Leaf } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { NARRATIVES } from '../../data/narratives'
import { storyLines, storyLive } from '../../game/coinCrowd'
import { useGame } from '../../game/store'
import type { Token } from '../../types'
import { fmtAge } from '../../utils/format'
import { ARC_LABEL, BEAT_ICON, SRC_META } from '../token/beatMeta'
import { SparkSource } from '../SparkPanel'

const W = 280
export function StoryLeaf({ t, now }: { t: Token; now: number }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const meta = useGame((s) => s.market.meta)
  const openSpark = useGame((s) => s.openSpark)
  // (With a mouse the leaf is read by hovering, so a click is free to do more: it opens the post's coins. On a
  // touch screen a tap is the only way to read it.)
  const mouse = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches
  // (A coin launched on a post in the last ten minutes: that post is its story.)
  const live = storyLive(t, now) || (!!t.spark && now - t.createdAt < 600)
  const tall = t.spark ? 360 : 220
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    // Beside the leaf, kept on screen: below it when there is room, above it when there is not.
    const x = Math.min(Math.max(8, r.left - 12), window.innerWidth - W - 8)
    setAt({ x, y: r.bottom + 6 > window.innerHeight - tall ? Math.max(8, r.top - tall - 6) : r.bottom + 6 })
  }
  const theme = NARRATIVES.find((n) => n.id === t.narrative)
  const lines = at ? storyLines(t) : []
  const arc = at ? (t.beats ?? []).find((b) => b.arc)?.arc : undefined
  return (
    <>
      <button
        type="button" aria-label={`What $${t.ticker} is about`} aria-expanded={!!at}
        onMouseEnter={open} onMouseLeave={() => setAt(null)} onBlur={() => setAt(null)}
        onClick={(e) => {
          e.stopPropagation()
          if (t.spark && mouse) {
            setAt(null)
            openSpark(t.spark.id)
          } else if (at) setAt(null)
          else open(e)
        }}
        className={clsx('flex shrink-0 items-center', live ? 'text-[#8fd14f]' : 'text-dim hover:text-muted')}
      >
        <Leaf size={11} />
      </button>
      {at && createPortal(
        <div role="tooltip" className="pointer-events-none fixed z-50 rounded-lg border border-line2 bg-panel p-2.5 text-[11px] shadow-2xl" style={{ left: at.x, top: at.y, width: W }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-bold text-ink">${t.ticker}</span>
            <span className="min-w-0 truncate text-dim">{t.name}</span>
            {theme && <span className={clsx('ml-auto shrink-0 rounded border px-1 text-[10px] font-semibold', t.narrative === meta ? 'border-warn/50 text-warn' : 'border-line2 text-muted')}>{theme.icon} {theme.label}{t.narrative === meta ? ' · the meta' : ''}</span>}
          </div>
          {t.spark && <div className="mt-1.5"><SparkSource t={t} now={now} /></div>}
          {t.description && <p className="mt-1.5 text-muted">“{t.description}”</p>}
          {arc && <div className="mt-1.5 font-semibold text-[#8fd14f]">{ARC_LABEL[arc]}</div>}
          {lines.length ? (
            <ul className="mt-1.5 space-y-1.5">
              {lines.map((b) => (
                <li key={b.id} className="leading-snug">
                  <span className="mr-1">{BEAT_ICON[b.kind]}</span>
                  <span className="text-ink">{b.by ? <b>{b.by.name}: </b> : null}{b.text}</span>
                  <span className="ml-1 whitespace-nowrap text-[9px] text-dim">{fmtAge(Math.max(0, now - b.time))} ago</span>
                  <span className={clsx('ml-1 rounded px-1 text-[8px] font-bold', SRC_META[b.src].cls)}>{SRC_META[b.src].label}</span>
                </li>
              ))}
            </ul>
          ) : (
            !t.spark && <p className="mt-1.5 text-dim">No story yet: nobody is talking about this coin.</p>
          )}
          {t.spark && mouse && <p className="mt-1.5 text-[10px] font-semibold text-info">Click the leaf to see every coin launched on this post.</p>}
          <p className="mt-1.5 border-t border-line pt-1 text-[9px] text-dim">Story lines are generated and their accounts are invented. A line shows a few seconds after it was posted: its fastest readers are already in.</p>
        </div>,
        document.body,
      )}
    </>
  )
}
