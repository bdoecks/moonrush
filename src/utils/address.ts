import type { Chain } from '../types'

/** Deterministic fake contract address for a fictional token: "7xQm…moon" on Solana, "0x4f2a…9c1e" on EVM chains. */
export function fakeAddress(id: string, chain: Chain = 'sol') {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const next = () => {
    h = Math.imul(h ^ (h >>> 13), 2654435761)
    return h >>> 0
  }
  if (chain !== 'sol') {
    const hex = (n: number) => n.toString(16).padStart(8, '0').slice(0, 4)
    return `0x${hex(next())}…${hex(next())}`
  }
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 4; i++) s += chars[next() % chars.length]
  return `${s}…moon`
}
