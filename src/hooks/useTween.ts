import { useEffect, useRef } from 'react'
import { useGame } from '../game/store'

/**
 * Makes a number glide to its new value (Axiom / GMGN feel) by writing the element's text directly on each animation
 * frame, with no React re-render per frame, so dozens of cards can animate at once without lag. Returns the ref
 * to put on the element. With animations off in Settings, the value just updates.
 */
export function useTweenText<T extends HTMLElement>(value: number, format: (n: number) => string, ms = 700) {
  const animations = useGame((s) => s.settings.animations)
  const ref = useRef<T>(null)
  const shown = useRef(value)
  const fmt = useRef(format)
  fmt.current = format
  useEffect(() => {
    const el = ref.current
    const from = shown.current
    if (!el || !animations || !Number.isFinite(value) || !Number.isFinite(from) || from === value) {
      shown.current = value
      if (el) el.textContent = fmt.current(value)
      return
    }
    const start = performance.now()
    let raf = 0
    let lastText = ''
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      shown.current = from + (value - from) * e
      const text = fmt.current(shown.current)
      if (text !== lastText) el.textContent = lastText = text // only touch the DOM when the text changes
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms, animations])
  return ref
}
