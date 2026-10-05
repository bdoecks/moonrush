import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Draw only the rows of a long list that are on screen (plus a few either side); the rest become empty space of the
 * same height, so the scrollbar and scrolling feel the same. The lists redraw every tick, and with a few hundred
 * coins drawing them all froze the page for a large part of each second.
 *
 * Put `ref` on the scrolling box and `data-win` on each row. Only for rows that are all the same height (it is
 * measured once per box width and `estimate`); rows of different heights go in an OnScreen box each instead.
 */
export function useWindowed<T extends HTMLElement = HTMLDivElement>(count: number, estimate: number, overscan = 6) {
  const [el, ref] = useState<T | null>(null) // the scrolling box (kept in state: it may appear after the first draw)
  const [rowH, setRowH] = useState(estimate)
  const [view, setView] = useState({ first: 0, rows: 40 }) // first row on screen, and how many fit
  const measured = useRef('') // what the height was last measured for

  useEffect(() => {
    if (!el) return
    const read = () => {
      const first = Math.floor(el.scrollTop / rowH)
      const rows = Math.ceil(el.clientHeight / rowH) + 1
      setView((v) => (v.first === first && v.rows === rows ? v : { first, rows }))
    }
    read()
    el.addEventListener('scroll', read, { passive: true })
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', read)
      ro.disconnect()
    }
  }, [el, rowH])

  // The real row height. Measured once for each box width and never again until that changes: if every draw could
  // correct it, rows of slightly different heights would make it flip back and forth without end.
  useLayoutEffect(() => {
    if (!el || !el.clientWidth) return
    const key = `${el.clientWidth}|${estimate}`
    if (measured.current === key) return
    const rows = el.querySelectorAll<HTMLElement>('[data-win]')
    if (!rows.length) return
    const a = rows[0].getBoundingClientRect()
    const b = rows[rows.length - 1].getBoundingClientRect()
    const h = rows.length > 1 ? (b.top - a.top) / (rows.length - 1) : a.height
    if (!(h > 4)) return
    measured.current = key
    if (Math.abs(h - rowH) > 0.5) setRowH(h)
  })

  const start = Math.max(0, Math.min(view.first, count) - overscan)
  const end = Math.min(count, view.first + view.rows + overscan)
  /** Bring a row into view (for keyboard movement: the row may not be drawn yet). */
  const reveal = (i: number) => {
    if (!el || i < 0) return
    const top = i * rowH
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + rowH * 2 > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH * 2 - el.clientHeight
  }
  return { ref, start, end, padTop: start * rowH, padBottom: Math.max(0, count - end) * rowH, reveal }
}
