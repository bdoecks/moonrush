// "Updates": what changed in the game, what is being worked on, and why something is closed (data/changelog.ts).
// Opened from the scroll button in the top bar (a dot shows until the newest update has been opened), Help and
// Settings.
import { useEffect, useSyncExternalStore } from 'react'
import { CLOSED, shownUpdates, shownWork, type Update } from '../data/changelog'
import { useFlags } from '../game/flags'
import { useGame } from '../game/store'
import { load, save } from '../utils/storage'
import { Modal } from './ui'

// Whether the newest update has been opened, kept so the top bar's dot goes out the moment the window opens.
const listeners = new Set<() => void>()
const seenNow = () => load<string>('updatesSeen') ?? ''
const markSeen = (newest?: string) => {
  if (!newest || seenNow() === newest) return
  save('updatesSeen', newest)
  listeners.forEach((f) => f())
}
/** Is there an update this player has not opened yet? */
export function useUnseenUpdate() {
  const seen = useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), seenNow)
  const newest = useFlags((s) => shownUpdates(s)[0]?.id)
  return !!newest && seen !== newest
}

const PART: { key: 'fixed' | 'added' | 'changed'; label: string; cls: string }[] = [
  { key: 'fixed', label: '🔧 Fixed', cls: 'text-up' },
  { key: 'added', label: '✨ New', cls: 'text-accent' },
  { key: 'changed', label: '🔁 Changed', cls: 'text-warn' },
]

function Entry({ u }: { u: Update }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[14px] font-bold text-ink">{u.title}</span>
        <span className="text-[11px] text-dim">{u.date}</span>
      </div>
      {PART.map((p) => {
        const items = u[p.key]
        if (!items?.length) return null
        return (
          <div key={p.key} className="mt-2">
            <div className={`text-[11px] font-bold uppercase tracking-wider ${p.cls}`}>{p.label}</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[12px] leading-snug text-muted marker:text-dim">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )
      })}
    </div>
  )
}

export function UpdatesModal() {
  const setModal = useGame((s) => s.setModal)
  const flags = useFlags()
  const updates = shownUpdates(flags)
  const newest = updates[0]?.id
  useEffect(() => markSeen(newest), [newest])
  const closed = CLOSED.filter((c) => !flags[c.flag])
  return (
    <Modal title="📜 Updates" onClose={() => setModal(null)} wide>
      <div className="space-y-3 p-3 text-[12px]">
        <p className="text-muted">What changed, what we are working on, and why something is closed. Found a problem or have an idea? Use Report a bug or Share an idea (top right, or in Help).</p>
        {!!closed.length && (
          <div className="rounded-lg border border-warn/40 bg-warn/5 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-warn">🚧 Closed for now, and why</div>
            <ul className="mt-1.5 space-y-2">
              {closed.map((c) => <li key={c.flag}><b className="text-ink">{c.what}.</b> <span className="text-muted">{c.why}</span></li>)}
            </ul>
          </div>
        )}
        <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">🛠 Working on now</div>
          <ul className="mt-1.5 space-y-2">
            {shownWork(flags).map((w, i) => <li key={i}><b className="text-ink">{w.what}.</b>{w.why && <span className="text-muted"> {w.why}</span>}</li>)}
          </ul>
        </div>
        {updates.map((u) => <Entry key={u.id} u={u} />)}
      </div>
    </Modal>
  )
}
