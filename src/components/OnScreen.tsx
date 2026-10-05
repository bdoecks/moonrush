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
 * it last had. For the rows of long feeds that update every tick and differ in height (so they can't be windowed by
 * arithmetic, like the coin lists are): a row nobody can see costs nothing.
 */
export function OnScreen({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(true) // drawn at first, so nothing flashes in empty
  const height = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return watch(el, (visible) => {
      if (!visible) height.current = el.offsetHeight
      setOn(visible)
    })
  }, [])
  return <div ref={ref} className={className} style={on ? undefined : { height: height.current }}>{on ? children : null}</div>
}
