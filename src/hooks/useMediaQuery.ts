import { useEffect, useState } from 'react'

/**
 * Does the screen match this CSS media query right now (and keep telling as it changes). Used to mount a panel only at
 * the sizes where it shows: a panel hidden with a CSS class is still drawn, and redrawn on every tick.
 */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const read = () => setOn(m.matches)
    read()
    m.addEventListener('change', read)
    return () => m.removeEventListener('change', read)
  }, [query])
  return on
}

// The same breakpoints the Tailwind classes use (md:, lg:), in rem like Tailwind's.
export const MD = '(min-width: 48rem)'
export const LG = '(min-width: 64rem)'
