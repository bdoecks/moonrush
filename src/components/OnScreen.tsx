import { useEffect, useRef, useState, type ReactNode } from 'react'

// One observer per scrolling box, shared by all its rows.
const watchers = new WeakMap<Element, { io: IntersectionObserver; rows: Map<Element, (on: boolean) => void> }>()

function scrollerOf(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if (o === 'auto' || o === 'scroll') return p
  }
  return null
}

function watch(el: Element, cb: (on: boolean) => void) {
  const root = scrollerOf(el)
  const key = root ?? document.documentElement
  let w = watchers.get(key)
  if (!w) {
    const rows = new Map<Element, (on: boolean) => void>()
    // A screen's worth of margin either side, so rows are drawn before they scroll into view.
    const io = new IntersectionObserver((entries) => { for (const e of entries) rows.get(e.target)?.(e.isIntersecting) }, { root, rootMargin: '400px 0px' })
    w = { io, rows }
    watchers.set(key, w)
  }
  w.rows.set(el, cb)
  w.io.observe(el)
  return () => {
    w.rows.delete(el)
    w.io.unobserve(el)
  }
}

/**
 * Draws its children only while it is on (or near) the screen; scrolled away, it stays as an empty box of the height
 * it last had. For the rows of long lists that update every tick and differ in height: a row nobody can see costs
 * nothing, and because every row keeps its own real height, nothing shifts when rows come and go. (Placing rows by
 * "index × average height" instead made a list of unequal rows hop, and at some scroll positions redraw for ever.)
 *
 * `estimate`: the height to hold before the row has ever been drawn. `drawn`: whether it starts drawn (default yes,
 * so nothing flashes in empty; pass false for rows far down a long list). `className` is fixed when the row first
 * appears, so an entrance animation on it plays once and is never cut short.
 */
export function OnScreen({ children, className, estimate = 0, drawn = true }: { children: ReactNode; className?: string; estimate?: number; drawn?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(drawn)
  const [cls] = useState(className)
  const height = useRef(estimate)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return watch(el, (visible) => {
      // A box that isn't laid out (a column hidden on a phone) measures 0: keep the height we had.
      if (!visible && el.offsetHeight > 0) height.current = el.offsetHeight
      setOn(visible)
    })
  }, [])
  return <div ref={ref} className={cls} style={on ? undefined : { height: height.current }}>{on ? children : null}</div>
}
