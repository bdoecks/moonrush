// Per-token wallet ledger for the token page's Trades / Holders / Top Traders tabs (GMGN-style).
//
// The market only keeps each token's last 40 tape trades, which is too little to know who holds what. The ledger
// watches every tape and folds each trade into a per-wallet book (bought, sold, TXs, first/last seen) plus a longer
// trade log. When a token is first seen, its holder book is seeded from the audit numbers (top-10 %, dev %, snipers,
// insiders) so the tables look like a coin that existed before you opened it. Lives outside React state like the
// candle store: rebuilt from scratch on reload, never persisted.
import { CHAINS } from '../data/chains'
import { LAUNCHPADS } from '../data/launchpads'
import { LAUNCH_POOL } from '../data/tokens'
import type { Chain, MarketState, TapeTrade, Token } from '../types'
import { fakeAddress } from '../utils/address'
import { Rng } from '../utils/rng'
import { startPriceNative } from './curve'
import { SUPPLY, walletName } from './marketEngine'

export type HolderTag = NonNullable<TapeTrade['tag']> | 'insider' | 'fresh'

export interface Holder {
  wallet: string // display key: tape wallet name, the token's dev wallet, or 'YOU'
  tags: HolderTag[]
  walletId?: string // simulated trader wallet (opens its profile)
  boughtUsd: number
  boughtQty: number
  soldUsd: number
  soldQty: number
  buys: number
  sells: number
  first: number // sim time
  last: number
}

export interface LedgerTrade extends TapeTrade {
  qty: number
}

interface Book {
  holders: Map<string, Holder>
  log: LedgerTrade[]
  lastId: number // newest tape trade folded in
  lastTime: number // market time of the last reconcile
  devWallet: string
  offset: number // tokens held by small wallets we don't list individually (older graduated coins)
}

const LOG_LEN = 300
const MAX_HOLDERS = 400
const books = new Map<string, Book>()
let lastTick = -1
let synthId = 2 ** 40 // ids for trades the ledger fills in (kept clear of tape ids)

const hash = (s: string) => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}
const logUniform = (rng: Rng, lo: number, hi: number) => Math.exp(rng.range(Math.log(lo), Math.log(Math.max(lo * 1.0001, hi))))

/** Address as the chain shows it: base58 on Solana, 0x… on EVM chains. */
export const displayAddress = (wallet: string, chain: Chain) => (wallet === 'YOU' ? 'You' : chain === 'sol' || wallet.startsWith('0x') ? wallet : fakeAddress(wallet, chain))

function holder(book: Book, wallet: string, time: number): Holder {
  let h = book.holders.get(wallet)
  if (!h) {
    h = { wallet, tags: [], boughtUsd: 0, boughtQty: 0, soldUsd: 0, soldQty: 0, buys: 0, sells: 0, first: time, last: time }
    book.holders.set(wallet, h)
  }
  return h
}

/** A believable holder book for a token we haven't watched trade yet. */
function seed(t: Token, now: number): Book {
  const rng = new Rng(hash(t.id))
  const devWallet = walletName(rng)
  const book: Book = { holders: new Map(), log: [], lastId: 0, lastTime: now, devWallet, offset: 0 }
  const launchPx = startPriceNative(t.pad) * CHAINS[t.chain].basePrice * 1.0005
  const young = t.status === 'bonding' || now - t.createdAt < 6 * 3600
  const lo = young ? launchPx : Math.max(launchPx, t.price * 0.25)
  const hi = Math.max(lo * 1.05, (t.ath / SUPPLY) * 0.9, t.price)
  const age = Math.max(60, now - t.createdAt)
  // Holders can only own what's left the curve / pool: on a curve that's the tokens sold so far.
  const pad = LAUNCHPADS[t.pad]
  const outside = t.status === 'bonding'
    ? (t.bondingProgress / 100) * (pad?.curveTokens ?? 0.8 * SUPPLY) / SUPPLY * 100
    : 100 - Math.min(40, (t.liquidity / 2 / Math.max(1, t.mcap)) * 100)
  const planned = Math.max(1, t.top10Pct) + 26 * 0.2
  const scale = Math.min(1, (outside * 0.92) / planned)

  const add = (wallet: string, pct: number, tags: HolderTag[], entryLo = lo, entryHi = hi) => {
    const remaining = (pct * scale / 100) * SUPPLY
    const avgBuy = logUniform(rng, entryLo, entryHi)
    // About 40% of holders have already taken some profit (or cut some losses).
    const soldQty = rng.chance(0.4) ? remaining * rng.range(0.15, 1.5) : 0
    const avgSell = logUniform(rng, Math.min(avgBuy, t.price) * 0.8, Math.max(avgBuy, t.price, (t.ath / SUPPLY) * 0.7))
    const h = holder(book, wallet, t.createdAt + rng.range(0, age * 0.5))
    h.tags = tags
    h.boughtQty = remaining + soldQty
    h.boughtUsd = h.boughtQty * avgBuy
    h.soldQty = soldQty
    h.soldUsd = soldQty * avgSell
    h.buys = rng.int(1, 4)
    h.sells = soldQty ? rng.int(1, 3) : 0
    h.last = now - rng.range(0, Math.min(age, 1800))
  }

  // The dev bought at launch and may have sold since (DEV markers on the chart).
  const devSold = (t.devTrades ?? []).filter((d) => d.side === 'sell').reduce((a, d) => a + d.usd, 0)
  if (t.devPct > 0.05 || devSold > 0) {
    const h = holder(book, devWallet, t.createdAt)
    const remaining = (t.devPct * scale / 100) * SUPPLY
    const soldQty = devSold / Math.max(launchPx, t.price * 0.6)
    h.tags = ['dev']
    h.boughtQty = remaining + soldQty
    h.boughtUsd = h.boughtQty * launchPx * 1.1
    h.soldQty = soldQty
    h.soldUsd = devSold
    h.buys = 1
    h.sells = (t.devTrades ?? []).filter((d) => d.side === 'sell').length
    h.last = t.devTrades?.[0]?.time ?? t.createdAt
  }
  // Top holders share what the top 10 hold beyond the dev, with a decaying profile.
  let left = Math.max(1, t.top10Pct - t.devPct)
  for (let i = 0; i < 9; i++) {
    const share = i === 8 ? left : left * rng.range(0.16, 0.3)
    left -= share
    const tags: HolderTag[] = []
    if (i < 3 && t.snipers > 6 && rng.chance(0.6)) tags.push('sniper')
    if (i < 4 && t.insidersPct > 10 && rng.chance(0.5)) tags.push('insider')
    if (share > 3 && rng.chance(0.3)) tags.push('whale')
    if (rng.chance(0.15)) tags.push('fresh')
    const early = tags.includes('sniper') || tags.includes('insider')
    add(walletName(rng), share, tags, lo, early ? lo * 1.6 : hi)
  }
  // A tail of smaller holders.
  for (let i = 0; i < 26; i++) add(walletName(rng), logUniform(rng, 0.03, 0.7), rng.chance(0.08) ? ['fresh'] : [])
  return book
}

/**
 * The market names anonymous sellers at random, but only holders can sell. Hand the sell to an existing holder
 * (weighted by bag size) so buyers' bags actually shrink and the holder list stays in line with the curve.
 */
function sellerFor(book: Book, tr: TapeTrade, qty: number): string {
  const named = book.holders.get(tr.wallet)
  if (tr.tag || tr.walletId || (named && named.boughtQty - named.soldQty >= qty)) return tr.wallet
  const pool = [...book.holders.values()].filter((h) => h.wallet !== book.devWallet && h.wallet !== 'YOU' && h.boughtQty - h.soldQty >= qty * 0.5)
  if (!pool.length) return tr.wallet
  const total = pool.reduce((a, h) => a + (h.boughtQty - h.soldQty), 0)
  let r = new Rng(tr.id * 97 + 13).next() * total
  for (const h of pool) if ((r -= h.boughtQty - h.soldQty) <= 0) return h.wallet
  return pool[pool.length - 1].wallet
}

function apply(book: Book, tr: TapeTrade) {
  const qty = tr.usd / Math.max(1e-18, tr.price)
  const wallet = tr.tag === 'dev' ? book.devWallet : tr.side === 'sell' ? sellerFor(book, tr, qty) : tr.wallet
  const h = holder(book, wallet, tr.time)
  if (tr.tag && !h.tags.includes(tr.tag)) h.tags.push(tr.tag)
  if (tr.walletId) h.walletId = tr.walletId
  if (tr.side === 'buy') {
    h.boughtUsd += tr.usd
    h.boughtQty += qty
    h.buys++
  } else {
    // Sellers we never saw buy bought before we started watching: book that earlier buy.
    const short = qty - (h.boughtQty - h.soldQty)
    if (short > 0) {
      const rng = new Rng(tr.id * 2654435761)
      h.boughtQty += short
      h.boughtUsd += short * tr.price * Math.exp(rng.gauss() * 0.45)
      h.buys++
    }
    h.soldUsd += tr.usd
    h.soldQty += qty
    h.sells++
  }
  h.last = tr.time
  book.log.unshift({ ...tr, wallet, qty })
  if (book.log.length > LOG_LEN) book.log.length = LOG_LEN
  if (book.holders.size > MAX_HOLDERS) {
    // Forget the smallest closed-out wallets first.
    const closed = [...book.holders.values()].filter((x) => x.wallet !== book.devWallet && x.boughtQty - x.soldQty <= x.boughtQty * 1e-6)
    closed.sort((a, b) => a.boughtUsd - b.boughtUsd)
    for (const x of closed.slice(0, book.holders.size - MAX_HOLDERS)) book.holders.delete(x.wallet)
  }
}

/** Tokens outside the curve / pool — what holders own between them. Null once a coin stops trading. */
function outsideTokens(t: Token): number | null {
  if (t.status === 'bonding') return (t.bondingProgress / 100) * (LAUNCHPADS[t.pad]?.curveTokens ?? 0.8 * SUPPLY)
  if (t.status === 'graduated') return SUPPLY - Math.min(SUPPLY * 0.95, t.liquidity / 2 / Math.max(1e-18, t.price))
  return null
}

const heldBy = (book: Book) => {
  let s = 0
  for (const h of book.holders.values()) s += Math.max(0, h.boughtQty - h.soldQty)
  return s
}

/** Scale the whole seeded book (before anyone has seen it) so holders own exactly `target` tokens. */
function rescale(book: Book, target: number) {
  const f = target / Math.max(1, heldBy(book))
  for (const h of book.holders.values()) {
    h.boughtQty *= f
    h.boughtUsd *= f
    h.soldQty *= f
    h.soldUsd *= f
  }
}

/** Book a trade the ledger fills in and add it to the log. */
function post(book: Book, t: Token, wallet: string, side: 'buy' | 'sell', qty: number, time: number) {
  const usd = qty * t.price
  const h = holder(book, wallet, time)
  if (side === 'buy') {
    h.boughtUsd += usd
    h.boughtQty += qty
    h.buys++
  } else {
    h.soldUsd += usd
    h.soldQty += qty
    h.sells++
  }
  h.last = time
  book.log.unshift({ id: synthId++, time, side, usd, price: t.price, wallet, qty })
  if (book.log.length > LOG_LEN) book.log.length = LOG_LEN
}

/**
 * Prices in the sim move every tick, but the tape only samples a few of the trades behind that move. Fill in the rest
 * so holders always own exactly what's outside the curve / pool: net buying lands on new or existing wallets, net
 * selling comes out of existing bags (bigger bags more likely).
 */
function reconcile(book: Book, t: Token, now: number) {
  const target = outsideTokens(t)
  if (target === null) return
  const need = target - book.offset - heldBy(book)
  if (Math.abs(need) < SUPPLY * 2e-5) return
  const rng = new Rng((hash(t.id) ^ Math.floor(now * 7)) >>> 0)
  const parts = 1 + (Math.abs(need) > SUPPLY * 0.002 ? 1 : 0) + (Math.abs(need) > SUPPLY * 0.01 ? 1 : 0)
  const chunk = need / parts
  for (let i = 0; i < parts; i++) {
    const time = now - rng.range(0, 5.9)
    if (chunk > 0) {
      const existing = [...book.holders.values()].filter((h) => h.wallet !== 'YOU' && h.wallet !== book.devWallet && h.boughtQty - h.soldQty > 0)
      const wallet = existing.length && rng.chance(0.4) ? rng.pick(existing).wallet : walletName(rng)
      post(book, t, wallet, 'buy', chunk, time)
    } else {
      let left = -chunk
      for (let k = 0; k < 40 && left > SUPPLY * 1e-6; k++) {
        const bags = [...book.holders.values()].filter((h) => h.wallet !== 'YOU' && h.boughtQty - h.soldQty > 1)
        if (!bags.length) break
        const total = bags.reduce((a, h) => a + h.boughtQty - h.soldQty, 0)
        let r = rng.next() * total
        const h = bags.find((b) => (r -= b.boughtQty - b.soldQty) <= 0) ?? bags[bags.length - 1]
        // Most sells are partial; some wallets dump the whole bag.
        const bag = h.boughtQty - h.soldQty
        const qty = Math.min(left, k > 8 || rng.chance(0.3) ? bag : bag * rng.range(0.2, 0.8))
        post(book, t, h.wallet, 'sell', qty, time)
        left -= qty
      }
    }
  }
}

/** Fold any tape trades we haven't seen yet into the token's book, then square it with the curve. Cheap to call often. */
export function syncToken(t: Token, now: number): Book {
  let book = books.get(t.id)
  const fresh = !book
  if (!book) {
    book = seed(t, now)
    books.set(t.id, book)
  }
  if (t.tape.length && t.tape[0].id > book.lastId) {
    const next = t.tape.filter((x) => x.id > book!.lastId)
    for (let i = next.length - 1; i >= 0; i--) apply(book, next[i])
    book.lastId = t.tape[0].id
  }
  if (fresh) {
    // The seed is a guess; make it add up. Curve coins: holders own exactly what's been sold. Older coins: whatever
    // the listed wallets don't cover belongs to the long tail of small holders.
    const target = outsideTokens(t)
    if (target !== null) {
      const held = heldBy(book)
      if (t.status === 'bonding' || held > target) rescale(book, target)
      else book.offset = target - held
    }
  } else if (now !== book.lastTime) {
    reconcile(book, t, now)
  }
  book.lastTime = now
  return book
}

/** Called on every market update so every coin's book (and its top-10 figure) stays current. */
export function syncMarket(m: MarketState) {
  if (m.tick < lastTick) books.clear() // a new round started
  lastTick = m.tick
  const live = new Set<string>()
  for (const t of m.tokens) {
    live.add(t.id)
    syncToken(t, m.time)
  }
  for (const id of books.keys()) if (!live.has(id)) books.delete(id)
}

/** % of supply still in the dev wallet, as the Holders tab shows it. Your own coins keep the game's dev-stake figure. */
export function devPctOf(t: Token): number {
  const book = books.get(t.id)
  if (!book || t.creator === 'you') return t.devPct
  const h = book.holders.get(book.devWallet)
  return h ? (Math.max(0, h.boughtQty - h.soldQty) / SUPPLY) * 100 : 0
}

const top10Cache = new Map<string, { time: number; you: number; value: number }>()

/**
 * % of supply the 10 largest holders own (pool/curve excluded) — the one figure the Holders tab, the audit panel and
 * the trenches all show. `youQty` is your real combined bag, which replaces the tape's estimate of it.
 */
export function top10Of(t: Token, youQty?: number): number {
  const book = books.get(t.id)
  if (!book) return t.top10Pct
  const you = youQty ?? -1
  const c = top10Cache.get(t.id)
  if (c && c.time === book.lastTime && c.you === you) return c.value
  const bags: number[] = []
  for (const h of book.holders.values()) bags.push(h.wallet === 'YOU' && youQty !== undefined ? 0 : Math.max(0, h.boughtQty - h.soldQty))
  if (youQty !== undefined) bags.push(youQty)
  bags.sort((a, b) => b - a)
  let s = 0
  for (let i = 0; i < 10 && i < bags.length; i++) s += bags[i]
  const value = (s / SUPPLY) * 100
  top10Cache.set(t.id, { time: book.lastTime, you, value })
  return value
}

// ─── Derived numbers ─────────────────────────────────────────────────────────

export interface HolderRow extends Holder {
  remaining: number // tokens
  pct: number // % of supply
  avgBuy: number // USD per token
  avgSell: number
  unrealized: number
  realized: number
  pnl: number
  pnlPct: number
}

export function rowOf(h: Holder, price: number): HolderRow {
  const remaining = Math.max(0, h.boughtQty - h.soldQty)
  const avgBuy = h.boughtQty > 0 ? h.boughtUsd / h.boughtQty : 0
  const avgSell = h.soldQty > 0 ? h.soldUsd / h.soldQty : 0
  const unrealized = remaining * (price - avgBuy)
  const realized = h.soldUsd - h.soldQty * avgBuy
  const pnl = realized + unrealized
  return { ...h, remaining, pct: (remaining / SUPPLY) * 100, avgBuy, avgSell, unrealized, realized, pnl, pnlPct: h.boughtUsd > 0 ? pnl / h.boughtUsd : 0 }
}

export const bookOf = (t: Token, now: number) => syncToken(t, now)

// ─── Wallet flavour (balance, funding) ───────────────────────────────────────

const CEXES = ['Binance', 'OKX', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'MEXC', 'Gate']

/** Stable per-wallet extras GMGN shows: native balance and where the wallet was funded from. */
export function walletMeta(wallet: string, chain: Chain, tags: HolderTag[]) {
  const rng = new Rng(hash(`${wallet}:${chain}`))
  const scale = CHAINS[chain].basePrice
  const whale = tags.includes('whale')
  const balance = logUniform(rng, 20 / scale, (whale ? 400_000 : 25_000) / scale)
  const fresh = tags.includes('fresh')
  const fundedDays = fresh ? rng.range(0.01, 0.9) : logUniform(rng, 1, 700)
  const cex = rng.chance(0.55)
  return {
    balance,
    fundedBy: cex ? rng.pick(CEXES) : displayAddress(walletName(rng), chain),
    cex,
    fundedAgo: fundedDays * 86400,
    fundedAmount: logUniform(rng, 30 / scale, (whale ? 200_000 : 8_000) / scale),
  }
}

/** Plausible network fee paid on a tape trade, in USD (GMGN's Gas column). */
export function gasUsd(tr: TapeTrade, chain: Chain) {
  const rng = new Rng(tr.id * 40503)
  const [lo, hi] = chain === 'sol' ? [0.0006, 0.09] : chain === 'bsc' ? [0.01, 0.12] : [0.002, 0.03]
  return logUniform(rng, lo, hi) * (tr.tag === 'sniper' || tr.tag === 'smart' ? 3 : 1)
}

// ─── Dev history ─────────────────────────────────────────────────────────────

export interface DevCoin {
  ticker: string
  name: string
  emoji: string
  ago: number // seconds since launch
  athMc: number
  mc: number
  status: 'migrated' | 'rugged' | 'dead' | 'bonding'
  holders: number
}

/** The dev's earlier launches, generated from the coin's own profile: serial ruggers have long, ugly histories. */
export function devHistory(t: Token): DevCoin[] {
  const rng = new Rng(hash(`dev:${t.id}`))
  const arch = t.sim.archetype
  const n = arch === 'rugger' ? rng.int(4, 14) : arch === 'chaotic' ? rng.int(1, 7) : arch === 'bluechip' || arch === 'grinder' ? rng.int(0, 1) : rng.int(0, 4)
  const launchMc = startPriceNative(t.pad) * CHAINS[t.chain].basePrice * SUPPLY
  const out: DevCoin[] = []
  let ago = rng.range(3600, 3 * 86400)
  for (let i = 0; i < n; i++) {
    const s = rng.pick(LAUNCH_POOL)
    const roll = rng.next()
    const status: DevCoin['status'] = arch === 'rugger' ? (roll < 0.6 ? 'rugged' : roll < 0.9 ? 'dead' : 'migrated') : roll < 0.08 ? 'migrated' : roll < 0.3 ? 'rugged' : 'dead'
    const athMc = status === 'migrated' ? logUniform(rng, launchMc * 15, launchMc * 400) : logUniform(rng, launchMc * 1.2, launchMc * 12)
    const mc = status === 'migrated' ? athMc * rng.range(0.05, 0.6) : status === 'rugged' ? launchMc * rng.range(0.3, 0.9) : launchMc * rng.range(0.95, 1.4)
    out.push({ ticker: s.ticker + (rng.chance(0.3) ? String(rng.int(2, 9)) : ''), name: s.name, emoji: s.emoji, ago, athMc, mc, status, holders: Math.round(Math.pow(athMc, 0.5) * rng.range(0.2, 0.8)) })
    ago += logUniform(rng, 1800, 5 * 86400)
  }
  return out
}
