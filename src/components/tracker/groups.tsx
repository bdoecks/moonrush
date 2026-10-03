// Wallet tracker groups (Axiom-style): make your own groups ("Whales", "🐸 Frog callers"…), put any tracked wallet in
// one (bot wallets, players, addresses like dev wallets), and filter the tracker by group. Groups and who's in them are
// saved with your tracker settings.
import clsx from 'clsx'
import { Check, FolderPlus, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useGame } from '../../game/store'

export const MAX_GROUPS = 12

/** Add a group (trimmed, unique, up to MAX_GROUPS). Returns its name, or null. */
export function addGroup(raw: string): string | null {
  const s = useGame.getState()
  const name = raw.trim().slice(0, 20)
  const groups = s.tracker.groups
  if (!name) return null
  const same = groups.find((g) => g.toLowerCase() === name.toLowerCase())
  if (same) return same
  if (groups.length >= MAX_GROUPS) {
    s.notify({ title: 'GROUP LIMIT', body: `Up to ${MAX_GROUPS} groups`, tone: 'warn', icon: '📁' })
    return null
  }
  s.updateTracker({ groups: [...groups, name] })
  return name
}

/** "+ Group" that turns into a name box. `onAdded` gets the new group (e.g. to open it). */
export function NewGroupButton({ onAdded, className }: { onAdded?: (g: string) => void; className?: string }) {
  const [name, setName] = useState<string | null>(null)
  const done = () => {
    const g = name !== null ? addGroup(name) : null
    setName(null)
    if (g) onAdded?.(g)
  }
  if (name === null) {
    return (
      <button type="button" onClick={() => setName('')} title="Make a new wallet group" className={clsx('flex shrink-0 items-center gap-0.5 font-semibold text-dim hover:text-accent', className)}>
        <Plus size={11} /> Group
      </button>
    )
  }
  return (
    <form onSubmit={(e) => (e.preventDefault(), done())} className="flex shrink-0 items-center gap-1">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} onBlur={done} onKeyDown={(e) => e.key === 'Escape' && setName(null)} placeholder="Group name" aria-label="New group name"
        className="h-5 w-24 rounded border border-accent/60 bg-bg px-1 text-[11px] text-ink outline-none" />
    </form>
  )
}

/** A small folder button on a tracked wallet: pick its group (or make one). `id` is the wallet id or watch key. */
export function GroupMenu({ id, className }: { id: string; className?: string }) {
  const groups = useGame((s) => s.tracker.groups)
  const current = useGame((s) => s.walletLabels[id]?.group)
  const setLabel = useGame((s) => s.setWalletLabel)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const pick = (g: string | undefined) => {
    setLabel(id, { group: g })
    setOpen(false)
  }
  return (
    <div ref={box} className={clsx('relative shrink-0', className)}>
      <button type="button" onClick={(e) => (e.stopPropagation(), setOpen((v) => !v))} title={current ? `Group: ${current} (change)` : 'Add to a group'} aria-label="Wallet group"
        className={clsx('flex items-center gap-0.5 rounded px-1 text-[9px] font-semibold', current ? 'bg-raise text-muted hover:text-ink' : 'text-dim hover:text-accent')}>
        {current ?? <FolderPlus size={11} />}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-line2 bg-panel p-1 shadow-xl shadow-black/50" onClick={(e) => e.stopPropagation()}>
          <div className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-dim">Move to group</div>
          {groups.map((g) => (
            <button key={g} type="button" onClick={() => pick(g)} className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-[11px] hover:bg-panel2">
              <span className="min-w-0 flex-1 truncate">{g}</span>{current === g && <Check size={11} className="text-accent" />}
            </button>
          ))}
          {current && <button type="button" onClick={() => pick(undefined)} className="w-full rounded px-1.5 py-1 text-left text-[11px] text-dim hover:bg-panel2">No group</button>}
          <div className="mt-1 border-t border-line pt-1 px-1"><NewGroupButton onAdded={(g) => pick(g)} className="text-[11px]" /></div>
        </div>
      )}
    </div>
  )
}
