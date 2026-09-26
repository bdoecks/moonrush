import { useEffect } from 'react'
import { selectSpeed, useGame } from '../game/store'

/** Drives the simulation: one market tick per second at 1× speed. */
export function useGameLoop() {
  const speed = useGame(selectSpeed)
  useEffect(() => {
    const id = window.setInterval(() => useGame.getState().tick(), 1000 / speed)
    return () => window.clearInterval(id)
  }, [speed])
}
