// Seeded PRNG (mulberry32). The state is a single uint32 so it can be persisted with the market.
export class Rng {
  s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number) {
    return min + (max - min) * this.next()
  }
  int(min: number, max: number) {
    return Math.floor(this.range(min, max + 1))
  }
  chance(p: number) {
    return this.next() < p
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  /** Standard normal via Box-Muller. */
  gauss(): number {
    const u = Math.max(1e-12, this.next())
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  poisson(lambda: number): number {
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * this.gauss()))
    const L = Math.exp(-lambda)
    let k = 0
    let p = 1
    do {
      k++
      p *= this.next()
    } while (p > L)
    return k - 1
  }
  weighted<T extends string>(weights: Partial<Record<T, number>>): T {
    const entries = Object.entries(weights) as [T, number][]
    const total = entries.reduce((a, [, w]) => a + w, 0)
    let r = this.next() * total
    for (const [k, w] of entries) {
      r -= w
      if (r <= 0) return k
    }
    return entries[entries.length - 1][0]
  }
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
