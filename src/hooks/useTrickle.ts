import { useEffect, useRef, useState } from 'react'
import { useGame } from '../game/store'

/**
 * Axiom-style live feed: when a batch of new rows arrives (the market ticks once a second), they appear one by one
 * across the next ~0.9s, oldest first, instead of all at once. Rows are newest-first. The first load and rows that
 * were already shown aren't delayed. Off with animations off.
 */
export function useTrickle<T extends { id: number | string }>(rows: T[], spreadMs = 900): T[] {
  const animations = useGame((s) => s.settings.animations)
  const known = useRef<Set<number | string> | null>(null)
  const [pending, setPending] = useState<Set<number | string>>(() => new Set())
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    if (!known.current) {
      known.current = new Set(rows.map((r) => r.id))
      return
    }
    const fresh = rows.filter((r) => !known.current!.has(r.id))
    for (const r of fresh) known.current.add(r.id)
    if (known.current.size > 5000) known.current = new Set(rows.map((r) => r.id))
    if (!animations || fresh.length < 2) return
    // Newest-first list: reveal from the oldest new row up to the newest.
    const order = [...fresh].reverse().map((r) => r.id)
    setPending((p) => new Set([...p, ...order]))
    const gap = spreadMs / order.length
    order.forEach((id, i) => {
      timers.current.push(
        setTimeout(() => setPending((p) => {
          if (!p.has(id)) return p
          const n = new Set(p)
          n.delete(id)
          return n
        }), Math.round(gap * (i + 1) * 0.95)),
      )
    })
  }, [rows, animations, spreadMs])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  return pending.size ? rows.filter((r) => !pending.has(r.id)) : rows
}
