import clsx from 'clsx'
import { Eye, EyeOff } from 'lucide-react'
import { useHidden } from '../game/hidden'
import { useGame } from '../game/store'

/** Hide / unhide a coin from your lists. */
export function HideButton({ id, ticker, className }: { id: string; ticker: string; className?: string }) {
  const hidden = useHidden((s) => s.ids.includes(id))
  const toggle = useHidden((s) => s.toggle)
  const notify = useGame((s) => s.notify)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggle(id)
        if (!hidden) notify({ title: 'HIDDEN', body: `$${ticker} is hidden. Turn on "Hidden" in the toolbar to see it again.`, tone: 'info', icon: '🙈' })
      }}
      title={hidden ? `Unhide $${ticker}` : `Hide $${ticker} from your lists`}
      aria-label={hidden ? 'Unhide coin' : 'Hide coin'}
      className={clsx('rounded p-1 transition-opacity', hidden ? 'bg-warn/15 text-warn' : 'text-dim hover:bg-raise hover:text-ink', className)}
    >
      {hidden ? <Eye size={12} /> : <EyeOff size={12} />}
    </button>
  )
}

/** Toolbar switch: show hidden coins (faded) so you can unhide them. */
export function HiddenToggle() {
  const n = useHidden((s) => s.ids.length)
  const show = useHidden((s) => s.show)
  const setShow = useHidden((s) => s.setShow)
  if (!n) return null
  return (
    <button onClick={() => setShow(!show)} aria-pressed={show} title={show ? 'Hide them again' : 'Show coins you hid (to unhide them)'} className={clsx('flex h-6 shrink-0 items-center gap-1 rounded border px-1.5 text-[10px] font-bold', show ? 'border-warn/50 bg-warn/10 text-warn' : 'border-line2 text-dim hover:text-ink')}>
      {show ? <Eye size={11} /> : <EyeOff size={11} />} Hidden {n}
    </button>
  )
}
