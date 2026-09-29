import { Megaphone, X } from 'lucide-react'
import { useState } from 'react'
import { useFlags } from '../game/flags'

/** The admin's notice for everyone (posted from the admin panel). Each player can hide a given notice. */
export function NoticeBanner() {
  const notice = useFlags((s) => s.notice)
  const [hidden, setHidden] = useState<string | null>(null)
  if (!notice || hidden === notice) return null
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-3 py-1.5 text-[12px] text-warn">
      <Megaphone size={13} className="shrink-0" />
      <span className="min-w-0 flex-1">{notice}</span>
      <button onClick={() => setHidden(notice)} className="rounded p-0.5 hover:bg-warn/20" aria-label="Hide notice"><X size={12} /></button>
    </div>
  )
}
