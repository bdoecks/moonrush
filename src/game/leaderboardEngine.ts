import { RIVALS } from '../data/players'
import type { GameMode, Player } from '../types'
import type { Rng } from '../utils/rng'

/** Arena rivals start flat with the player; other modes show a lived-in "season" board. */
export function createRivals(rng: Rng, start: number, mode: GameMode): Player[] {
  const fresh = mode === 'arena' || mode === 'hardcore'
  return RIVALS.map((r, i) => {
    const pre = fresh ? 0 : r.skill * 0.6 + rng.gauss() * 0.35
    const trades = fresh ? 0 : rng.int(8, 140)
    return {
      id: `rival-${i}`,
      name: r.name,
      avatar: r.avatar,
      level: r.level,
      skill: r.skill,
      startEquity: start,
      equity: start * Math.max(0.05, Math.exp(pre)),
      trades,
      wins: Math.round(trades * Math.min(0.85, Math.max(0.15, 0.48 + r.skill * 0.18 + rng.gauss() * 0.05))),
    }
  })
}

/** Rivals trade on the same market mood as the player, with their own skill edge and noise. */
export function tickRivals(players: Player[], rng: Rng, marketReturn: number): Player[] {
  return players.map((p) => {
    const r = p.skill * 0.00025 + 0.35 * marketReturn + rng.gauss() * 0.0055 * (1.2 - p.skill * 0.2)
    let { trades, wins } = p
    if (rng.chance(0.07)) {
      trades++
      if (rng.chance(0.48 + p.skill * 0.18)) wins++
    }
    return { ...p, equity: Math.max(p.startEquity * 0.02, p.equity * Math.exp(r)), trades, wins }
  })
}
