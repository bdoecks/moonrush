import clsx from 'clsx'
import { LAUNCHPADS } from '../data/launchpads'
import type { PadId } from '../types'

/** Launchpad badge: a simple original monogram tile in the pad's colours (not the platform's logo). */
export function PadBadge({ pad, size = 14, className }: { pad?: PadId; size?: number; className?: string }) {
  const p = pad ? LAUNCHPADS[pad] : undefined
  if (!p) return null
  const two = p.mono.length > 1
  return (
    <span
      title={`${p.name} → ${p.dex}`}
      className={clsx('inline-grid shrink-0 place-items-center rounded-[4px] font-display font-extrabold leading-none', className)}
      style={{
        width: size,
        height: size,
        background: p.bg,
        color: p.color,
        boxShadow: `inset 0 0 0 1px ${p.color}66`,
        fontSize: size * (two ? 0.46 : 0.62),
        letterSpacing: two ? '-0.04em' : undefined,
      }}
    >
      {p.mono}
    </span>
  )
}

/** Badge plus name, for headers and pickers. */
export function PadTag({ pad, className }: { pad?: PadId; className?: string }) {
  const p = pad ? LAUNCHPADS[pad] : undefined
  if (!p) return null
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded px-1 py-px text-[10px] font-bold', className)} style={{ color: p.color, background: `${p.color}14` }}>
      <PadBadge pad={pad} size={12} />
      {p.name}
    </span>
  )
}
