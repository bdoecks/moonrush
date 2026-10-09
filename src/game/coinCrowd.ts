// Who is in a coin, for the Trenches card: how many tracked KOLs and smart-money wallets hold it right now, and the
// dev's record (coins migrated out of coins launched). Pure: read off the public wallets and the coin's own dev
// history, the same things the coin page shows in full.
import { devHistory } from './ledger'
import type { Beat, SimWallet, Token } from '../types'

export interface CrowdCount {
  kols: number
  smart: number
}

const NONE: CrowdCount = { kols: 0, smart: 0 }
let lastWallets: SimWallet[] | null = null
let lastMap = new Map<string, CrowdCount>()

/** Coin id → how many KOLs and smart-money wallets hold it. Worked out once per wallet list (it changes every tick). */
export function crowdMap(wallets: SimWallet[]): Map<string, CrowdCount> {
  if (wallets === lastWallets) return lastMap
  const map = new Map<string, CrowdCount>()
  for (const w of wallets) {
    if (w.style !== 'kol' && w.style !== 'smart') continue
    for (const [id, p] of Object.entries(w.positions)) {
      if (!(p.qty > 0)) continue
      let c = map.get(id)
      if (!c) map.set(id, (c = { kols: 0, smart: 0 }))
      if (w.style === 'kol') c.kols++
      else c.smart++
    }
  }
  lastWallets = wallets
  lastMap = map
  return map
}

export const crowdOf = (wallets: SimWallet[], tokenId: string): CrowdCount => crowdMap(wallets).get(tokenId) ?? NONE

/** Both counts as one number (a card reads it from the store, and only redraws when it changes). */
export const crowdCode = (wallets: SimWallet[], tokenId: string) => {
  const c = crowdOf(wallets, tokenId)
  return c.kols * 1000 + c.smart
}
export const crowdFromCode = (code: number): CrowdCount => ({ kols: Math.floor(code / 1000), smart: code % 1000 })

export interface DevRecord {
  migrated: number // coins of this dev that made it off the curve (this one counts once it has)
  total: number // coins this dev has launched, this one included
}

const migratedStatus = (s: string) => s === 'migrated' || s === 'graduated'

/**
 * The dev's record as the coin page counts it: this coin plus the dev's earlier ones. `own` is the player's own list
 * of launches (for a coin they made): each with its status now.
 */
export function devRecord(t: Pick<Token, 'id' | 'status' | 'pad' | 'chain' | 'sim'>, own?: { tokenId: string; status: string }[]): DevRecord {
  const others = own ? own.filter((l) => l.tokenId !== t.id).map((l) => l.status) : devHistory(t as Token).map((c) => c.status)
  return { migrated: others.filter(migratedStatus).length + (migratedStatus(t.status) ? 1 : 0), total: others.length + 1 }
}

/** A dev worth a warning: several coins behind them and almost none migrated. */
export const devRecordBad = (r: DevRecord) => r.total >= 4 && r.migrated / r.total < 0.1
/** …and one worth a nod: at least one migrated, and one in four or better. */
export const devRecordGood = (r: DevRecord) => r.migrated >= 1 && r.migrated / r.total >= 0.25

// ─── The story leaf ──────────────────────────────────────────────────────────
const STORY_FRESH_SEC = 600 // a story line this recent means the story is still going
/** The lines that tell a coin's story (posts, rumours, news, outside trends), newest first: not the market's own facts about its trades. */
export const storyLines = (t: Pick<Token, 'beats'>, n = 3): Beat[] => (t.beats ?? []).filter((b) => b.src !== 'market').slice(0, n)
/** Is a story running on this coin right now? (The leaf on its Trenches card is green.) */
export const storyLive = (t: Pick<Token, 'beats'>, now: number) => (t.beats ?? []).some((b) => b.src !== 'market' && now - b.time < STORY_FRESH_SEC)
