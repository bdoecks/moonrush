import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { useGame } from '../game/store'
import type { Toast } from '../types'
import { QuickBuyButton } from './chain'

const TONE: Record<Toast['tone'], string> = {
  up: 'border-l-up',
  down: 'border-l-down',
  warn: 'border-l-warn',
  info: 'border-l-info',
  xp: 'border-l-accent',
}

const EVENT_COLOR = '#a78bfa'
const EVENT_CARD = 'border-[#a78bfa]/35 border-l-[#a78bfa] bg-[#1a1530]/95'

/** Source tag on the shared alert stack: TRACKED (wallet tracker) or EVENT (market event). */
function KindTag({ kind }: { kind: NonNullable<Toast['kind']> }) {
  return kind === 'event' ? (
    <span className="ml-auto shrink-0 rounded px-1 text-[9px] font-bold tracking-wider" style={{ color: EVENT_COLOR, background: `${EVENT_COLOR}26` }}>EVENT</span>
  ) : (
    <span className="ml-auto shrink-0 rounded bg-accent/15 px-1 text-[9px] font-bold tracking-wider text-accent">👁 TRACKED</span>
  )
}

// Top stack sits under the top bar, left of the trade sidebar. The bottom stack (tracker alerts by default) sits in
// the bottom-right corner, above the status bar / mobile nav and above the bottom dock when that's open, so it
// stays clear of page headers and settings buttons.
const TOP = 'top-14 md:top-[88px] lg:right-[330px] xl:right-[350px]'

/** Height of the bottom dock while it's on screen (0 when absent), kept current as it opens, collapses or resizes. */
function useDockHeight(watch: boolean) {
  const view = useGame((s) => s.view)
  const [h, setH] = useState(0)
  useEffect(() => {
    if (!watch) return
    let ro: ResizeObserver | null = null
    const attach = () => {
      const el = document.querySelector<HTMLElement>('[data-dock]')
      setH(el?.offsetHeight ?? 0)
      if (el) {
        ro = new ResizeObserver(() => setH(el.offsetHeight))
        ro.observe(el)
      }
    }
    const raf = requestAnimationFrame(attach) // after the new view has rendered
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [view, watch])
  return watch ? h : 0
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts)
  const trackerBottom = useGame((s) => s.tracker.alertPosition !== 'top-right')
  const isBottom = (t: Toast) => trackerBottom && (t.kind === 'tracker' || t.kind === 'event')
  const top = toasts.filter((t) => !isBottom(t))
  const bottom = toasts.filter(isBottom)
  const dock = useDockHeight(bottom.length > 0)
  return (
    <>
      <Stack toasts={top} className={TOP} />
      {/* Phone: 72px clears the mobile nav. md+: the status bar (32px) plus the dock when it's on screen. */}
      <Stack toasts={bottom} className="bottom-[72px] md:bottom-[calc(var(--dock)+32px)]" style={{ '--dock': `${dock}px` } as CSSProperties} />
    </>
  )
}

function Stack({ toasts, className, style }: { toasts: Toast[]; className: string; style?: CSSProperties }) {
  if (!toasts.length) return null
  return (
    <div className={clsx('pointer-events-none fixed right-2 z-[60] flex w-[300px] max-w-[calc(100vw-16px)] flex-col gap-1.5', className)} style={style} aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  )
}

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useGame((s) => s.dismissToast)
  const select = useGame((s) => s.select)
  const token = useGame((s) => (t.tokenId ? s.market.tokens.find((x) => x.id === t.tokenId) : undefined))
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const life = t.tone === 'xp' ? 3200 : t.tokenId ? 6000 : 3800
    const a = window.setTimeout(() => setLeaving(true), life)
    const b = window.setTimeout(() => dismiss(t.id), life + 260)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [t, dismiss])
  const close = () => {
    setLeaving(true)
    window.setTimeout(() => dismiss(t.id), 250)
  }
  return (
    <div
      onClick={() => {
        if (token) select(token.id)
        close()
      }}
      className={clsx(
        'pointer-events-auto cursor-pointer rounded-md border border-l-[3px] px-3 py-2 shadow-xl backdrop-blur',
        // Market events: violet card, so they read apart from tracker alerts (tone-colored edge) in the shared stack.
        t.kind === 'event' ? EVENT_CARD : clsx('border-line2 bg-raise/95', TONE[t.tone]),
        leaving ? 'toast-out' : 'toast-in',
        t.tone === 'xp' && 'glow-accent',
      )}
    >
      <div className="flex items-center gap-2">
        {t.icon && <span className="text-[14px] leading-none">{t.icon}</span>}
        <span className={clsx('min-w-0 truncate text-[11px] font-extrabold tracking-wider', t.tone === 'up' ? 'text-up' : t.tone === 'down' ? 'text-down' : t.tone === 'warn' ? 'text-warn' : t.tone === 'xp' ? 'text-accent' : 'text-info')}>{t.title}</span>
        {t.kind && <KindTag kind={t.kind} />}
        {token && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              close()
            }}
            className="-mr-1 rounded p-0.5 text-dim hover:bg-panel2 hover:text-ink"
            aria-label="Dismiss"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {t.body && <div className="mt-0.5 text-[11px] leading-snug text-muted">{t.body}</div>}
      {token && (
        <div className="mt-1.5 flex items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { select(token.id); close() }} className="text-[10px] font-semibold text-dim hover:text-ink">Open ${token.ticker} →</button>
          <QuickBuyButton t={token} className="py-0.5" />
        </div>
      )}
    </div>
  )
}
