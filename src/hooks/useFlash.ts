import { useEffect, useRef, useState } from 'react'

/** Returns 'up' | 'down' | '' for a short moment after `value` changes, plus a key to restart the CSS animation. */
export function useFlash(value: number): [string, number] {
  const prev = useRef(value)
  const [state, setState] = useState<[string, number]>(['', 0])
  useEffect(() => {
    if (value !== prev.current) {
      const dir = value > prev.current ? 'up' : 'down'
      prev.current = value
      setState((s) => [dir, s[1] + 1])
    }
  }, [value])
  return state
}
