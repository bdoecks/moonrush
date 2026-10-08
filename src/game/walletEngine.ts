import { RIVALS } from '../data/players'
import { WALLET_SEEDS } from '../data/wallets'
import { addWin, getWin } from './windows'
import type { MarketState, SimWallet, Token, WalletAction, WalletHistory, WalletStyle, WalletTrade } from '../types'
import { clamp, type Rng } from '../utils/rng'
import { MIND, mindEntry, mindExit, mindOf } from './traderMinds'
import { secPerTickOf, fillSim, HOUR_TICKS, quoteBuy, quoteSell, SUPPLY, touchCandles, walletName } from './marketEngine'

// Simulated trader wallets that really trade the market. Their fills move prices through the same pool
// the player uses, so anyone copying them enters after them, at a worse price.

const TRADES_KEPT = 60
const START_VALUE: Record<WalletStyle, [number, number]> = {
  whale: [250_000, 800_000], smart: [30_000, 150_000], sniper: [10_000, 60_000], kol: [20_000, 100_000], degen: [5_000, 40_000], fresh: [2_000, 20_000],
}
const ACT_RATE: Record<WalletStyle, number> = { smart: 0.06, sniper: 0.14, kol: 0.04, whale: 0.03, degen: 0.1, fresh: 0.04 }
const MAX_POS: Record<WalletStyle, number> = { smart: 4, sniper: 5, kol: 3, whale: 3, degen: 6, fresh: 2 }
const SIZE: Record<WalletStyle, [number, number]> = { smart: [0.04, 0.1], sniper: [0.02, 0.05], kol: [0.03, 0.08], whale: [0.05, 0.12], degen: [0.08, 0.25], fresh: [0.03, 0.08] }
const TX_PER_DAY: Record<WalletStyle, [number, number]> = { smart: [30, 200], sniper: [200, 900], kol: [20, 120], whale: [10, 60], degen: [80, 400], fresh: [3, 40] }

const emptyHistory = (): WalletHistory => ({ pnl24h: 0, pnl7d: 0, wins: 0, losses: 0, buys: 0, sells: 0, volume: 0, inflow: 0 })
const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'

export function createWallets(rng: Rng): SimWallet[] {
  return ensureRivalWallets(createSeedWallets(rng), rng)
}

/** Leaderboard rival i trades from wallet `rw{i}`, so its profile shows real coins and it can be tracked. */
export const rivalWalletId = (playerId: string) => `rw${playerId.replace('rival-', '')}`

const rivalStyle = (skill: number): WalletStyle => (skill >= 0.6 ? 'smart' : skill >= 0.3 ? 'sniper' : skill >= -0.3 ? 'degen' : 'fresh')

/** Adds any missing rival wallets (older saves were made before rivals had wallets). */
export function ensureRivalWallets(wallets: SimWallet[], rng: Rng): SimWallet[] {
  const have = new Set(wallets.map((w) => w.id))
  const add: SimWallet[] = []
  RIVALS.forEach((r, i) => {
    const id = `rw${i}`
    if (have.has(id)) return
    const style = rivalStyle(r.skill)
    const skill = clamp((r.skill + 1) / 2, 0.05, 0.95)
    const startValue = Math.round(Math.exp(rng.range(Math.log(8_000), Math.log(60_000))))
    const buys = rng.int(20, 160)
    const sells = Math.round(buys * rng.range(0.85, 1.05))
    const wins = Math.round(sells * clamp(0.3 + skill * 0.4 + rng.gauss() * 0.05, 0.08, 0.85))
    const pnl24h = startValue * ((skill - 0.45) * 0.3 + rng.gauss() * 0.12)
    const avgTrade = startValue * (SIZE[style][0] + SIZE[style][1]) / 2
    add.push({
      id, name: r.name, avatar: r.avatar, style, skill, cash: startValue, startValue, positions: {}, trades: [], rival: `rival-${i}`,
      base: { pnl24h, pnl7d: pnl24h * rng.range(1.5, 4), wins, losses: sells - wins, buys, sells, volume: (buys + sells) * avgTrade, inflow: pnl24h },
      live: emptyHistory(),
      lastActive: -rng.int(1, 300),
    })
  })
  return add.length ? [...wallets, ...add] : wallets
}

function createSeedWallets(rng: Rng): SimWallet[] {
  return WALLET_SEEDS.map((s, i) => {
    const [lo, hi] = START_VALUE[s.style]
    const startValue = Math.round(Math.exp(rng.range(Math.log(lo), Math.log(hi))))
    const edge = (s.skill - 0.45) * (s.style === 'kol' ? 0.4 : 1)
    const buys = rng.int(...TX_PER_DAY[s.style])
    const sells = Math.round(buys * rng.range(0.85, 1.05))
    const winRate = clamp(0.3 + s.skill * 0.4 + rng.gauss() * 0.05, 0.08, 0.85)
    const wins = Math.round(sells * winRate)
    const pnl24h = startValue * (edge * 0.3 + rng.gauss() * 0.12)
    const avgTrade = startValue * (SIZE[s.style][0] + SIZE[s.style][1]) / 2
    return {
      id: `w${i}`,
      name: s.name,
      avatar: s.avatar,
      style: s.style,
      skill: s.skill,
      cash: startValue,
      startValue,
      positions: {},
      trades: [],
      base: {
        pnl24h,
        pnl7d: pnl24h * rng.range(1.5, 4) + startValue * edge * 0.6 + rng.gauss() * startValue * 0.2,
        wins,
        losses: sells - wins,
        buys,
        sells,
        volume: (buys + sells) * avgTrade,
        inflow: pnl24h + rng.gauss() * avgTrade * 3,
      },
      live: emptyHistory(),
      lastActive: -rng.int(1, 300),
    }
  })
}

export type Period = '1H' | '24H' | '7D'

export interface WalletStats {
  pnl: number
  pnlPct: number
  winRate: number
  buys: number
  sells: number
  volume: number
  inflow: number
  balance: number
  unrealized: number
  holdings: number
}

export function walletStats(w: SimWallet, period: Period, tokens: Map<string, Token>, tick: number): WalletStats {
  let posValue = 0
  let posCost = 0
  for (const [id, p] of Object.entries(w.positions)) {
    const t = tokens.get(id)
    posValue += t ? p.qty * t.price : 0
    posCost += p.cost
  }
  const unrealized = posValue - posCost
  const balance = w.cash + posValue
  if (period === '1H') {
    let pnl = 0, wins = 0, losses = 0, buys = 0, sells = 0, volume = 0, inflow = 0
    for (const tr of w.trades) {
      if (tr.tick < tick - HOUR_TICKS) break
      volume += tr.usd
      if (tr.side === 'buy') { buys++; inflow -= tr.usd }
      else {
        sells++
        inflow += tr.usd
        pnl += tr.pnl ?? 0
        if ((tr.pnl ?? 0) > 0) wins++
        else losses++
      }
    }
    pnl += unrealized
    return { pnl, pnlPct: pnl / w.startValue, winRate: wins + losses ? wins / (wins + losses) : 0, buys, sells, volume, inflow, balance, unrealized, holdings: Object.keys(w.positions).length }
  }
  const k = period === '7D' ? 4.3 : 1
  const b = w.base
  const pnl = (period === '7D' ? b.pnl7d : b.pnl24h) + w.live.pnl24h + unrealized
  const wins = b.wins * k + w.live.wins
  const losses = b.losses * k + w.live.losses
  return {
    pnl,
    pnlPct: pnl / w.startValue,
    winRate: wins + losses ? wins / (wins + losses) : 0,
    buys: Math.round(b.buys * k + w.live.buys),
    sells: Math.round(b.sells * k + w.live.sells),
    volume: b.volume * k + w.live.volume,
    inflow: b.inflow * k + w.live.inflow,
    balance,
    unrealized,
    holdings: Object.keys(w.positions).length,
  }
}

function pickEntry(w: SimWallet, tokens: Token[], m: MarketState, rng: Rng): Token | undefined {
  const age = (t: Token) => m.time - t.createdAt
  const pool = tokens.filter((t) => live(t) && !w.positions[t.id] && t.liquidity > 1500)
  let c: Token[] = []
  switch (w.style) {
    case 'sniper': {
      // Snipers buy in the launch block: a coin launched this very tick, which nobody outside it has been shown yet,
      // so nobody gets in ahead of them. (Now and then one picks up a young coin late.)
      const fresh = pool.filter((t) => t.status === 'bonding' && age(t) < secPerTickOf(m))
      c = fresh.length ? fresh : rng.chance(0.25) ? pool.filter((t) => t.status === 'bonding' && age(t) < 240) : []
      break
    }
    case 'smart':
      // Skilled wallets read the hidden regime (and dodge scheduled rugs); otherwise they follow momentum.
      c = rng.chance(w.skill)
        ? pool.filter((t) => (t.sim.regime === 'accumulation' || t.sim.regime === 'pump' || t.sim.regime === 'moon') && t.sim.regimeTicks > 6 && t.sim.rugAt === null)
        : pool.filter((t) => t.momentumScore > 55)
      c = c.sort((a, b) => b.hype - a.hype).slice(0, 5)
      break
    case 'kol':
      c = pool.filter((t) => t.hype > 55 && t.mcap < 2_000_000).slice(0, 8)
      break
    case 'whale':
      c = pool.filter((t) => t.status === 'graduated' && t.liquidity > 40_000 && t.change['5m'] < -0.03)
      break
    case 'degen':
      c = [...pool].sort((a, b) => b.change['5m'] - a.change['5m']).slice(0, 5)
      break
    case 'fresh':
      c = pool
      break
  }
  return c.length ? rng.pick(c) : undefined
}

function exitFraction(w: SimWallet, t: Token, pnlPct: number, held: number, tookProfit: boolean | undefined, rng: Rng): number {
  if (t.status === 'rugged' || t.status === 'dead') return 1
  switch (w.style) {
    case 'smart':
      if (rng.chance(w.skill * 0.5) && (t.sim.regime === 'distribution' || t.sim.regime === 'dump' || t.sim.rugAt !== null)) return 1
      if (pnlPct > 0.6 || pnlPct < -0.25 || held > 240) return 1
      if (pnlPct > 0.3 && !tookProfit) return 0.5
      return 0
    case 'sniper':
      if (pnlPct > 0.4) return tookProfit ? 1 : 0.6
      return pnlPct < -0.25 || held > 60 ? 1 : 0
    case 'kol':
      return pnlPct > 0.2 || pnlPct < -0.3 || held > 90 ? 1 : 0
    case 'whale':
      return pnlPct > 0.15 || pnlPct < -0.12 || held > 400 ? 1 : 0
    case 'degen':
      if (pnlPct > 0.8 || pnlPct < -0.45) return 1
      return held > 300 && rng.chance(0.02) ? 1 : 0
    case 'fresh':
      return pnlPct > 0.5 || pnlPct < -0.3 || rng.chance(0.01) ? 1 : 0
  }
}

const TAG: Record<WalletStyle, 'smart' | 'sniper' | 'kol' | 'whale' | undefined> = { smart: 'smart', sniper: 'sniper', kol: 'kol', whale: 'whale', degen: undefined, fresh: undefined }

/**
 * Let every wallet manage exits and maybe open a position. Mutates the (already cloned) tokens of this tick:
 * price impact, volume, tape. Returns updated wallets and the actions taken (for copy trading).
 */
export function tickWallets(wallets: SimWallet[], m: MarketState, rng: Rng): { wallets: SimWallet[]; actions: WalletAction[] } {
  const byId = new Map(m.tokens.map((t) => [t.id, t]))
  const actions: WalletAction[] = []

  const fill = (t: Token, w: SimWallet, side: 'buy' | 'sell', usd: number, price: number) => {
    t.volume += usd
    if (side === 'buy') t.buys += 1
    else t.sells += 1
    t.win = addWin(getWin(t, m.time), usd, side === 'buy' ? 1 : 0, side === 'sell' ? 1 : 0)
    t.tape = [{ id: m.nextTradeId++, time: m.time, side, usd, price, wallet: w.name, tag: TAG[w.style], walletId: w.id }, ...t.tape].slice(0, 40)
  }
  const record = (w: SimWallet, tr: Omit<WalletTrade, 'id' | 'tick' | 'time'>): WalletTrade[] => [{ ...tr, id: m.nextTradeId++, tick: m.tick, time: m.time }, ...w.trades].slice(0, TRADES_KEPT)

  const next = wallets.map((w0) => {
    let w: SimWallet = w0
    const mind = mindOf(w0)
    const touch = () => {
      if (w === w0) w = { ...w0, positions: { ...w0.positions }, live: { ...w0.live } }
    }

    // Exits (with a little reaction delay so wallets don't all act the same tick).
    for (const [id, pos] of Object.entries(w0.positions)) {
      const t = byId.get(id)
      if (!t) {
        touch()
        delete w.positions[id]
        w.live.losses++
        w.live.pnl24h -= pos.cost
        continue
      }
      if (!rng.chance(w.style === 'smart' ? 0.7 : 0.5)) continue
      const pnlPct = (pos.qty * t.price) / pos.cost - 1
      // Its mind first (what the coin's feed said since it bought), then its style's own exits.
      const minded = mind && live(t) ? mindExit(mind, t, pos, pnlPct, (m.tick - pos.openedTick) * secPerTickOf(m), m) : null
      const frac = minded ? minded.frac : exitFraction(w, t, pnlPct, m.tick - pos.openedTick, pos.tookProfit, rng)
      if (frac <= 0) continue
      touch()
      const qty = frac >= 1 ? pos.qty : pos.qty * frac
      const q = quoteSell(t, qty)
      const usd = q.usdOut
      const costPart = (pos.cost * qty) / pos.qty
      const pnl = usd - costPart
      const prev = t.price
      t.price = Math.max(1e-13, q.newPrice)
      t.mcap = t.price * SUPPLY
      touchCandles(t, m.time, prev, usd, m.native)
      fill(t, w, 'sell', usd, q.avgPrice)
      w.cash += usd
      if (frac >= 1) delete w.positions[id]
      else w.positions[id] = { ...pos, qty: pos.qty - qty, cost: pos.cost - costPart, tookProfit: true }
      w.live.sells++
      w.live.volume += usd
      w.live.inflow += usd
      w.live.pnl24h += pnl
      if (pnl > 0) w.live.wins++
      else w.live.losses++
      const kind = frac >= 1 ? 'all' : 'partial'
      w.trades = record(w, { tokenId: id, ticker: t.ticker, emoji: t.emoji, hue: t.hue, side: 'sell', usd, qty, price: q.avgPrice, pnl, pnlPct: pnl / costPart, mcap: t.mcap, action: kind, ...(minded ? { why: minded.why } : {}) })
      w.lastActive = m.tick
      actions.push({ walletId: w.id, tokenId: id, side: 'sell', usd, fraction: frac >= 1 ? 1 : frac, kind, mcap: t.mcap, ...(minded ? { why: minded.why } : {}) })
    }

    // Conviction adds: winners sometimes buy more of a position that's working.
    if (w.style === 'smart' || w.style === 'whale' || w.style === 'degen') {
      for (const [id, pos] of Object.entries(w.positions)) {
        const t = byId.get(id)
        if (!t || !live(t) || (pos.qty * t.price) / pos.cost - 1 < 0.1 || !rng.chance(0.02)) continue
        const usd = Math.min(w.cash * 0.03, t.liquidity * 0.01)
        if (usd < 20) continue
        touch()
        const q = quoteBuy(t, usd)
        const prev = t.price
        t.price = q.newPrice
        t.mcap = t.price * SUPPLY
        t.ath = Math.max(t.ath, t.mcap)
        touchCandles(t, m.time, prev, usd, m.native)
        fill(t, w, 'buy', usd, q.avgPrice)
        w.cash -= usd
        w.positions[id] = { ...w.positions[id], qty: w.positions[id].qty + q.qty, cost: w.positions[id].cost + usd }
        w.live.buys++
        w.live.volume += usd
        w.live.inflow -= usd
        w.trades = record(w, { tokenId: id, ticker: t.ticker, emoji: t.emoji, hue: t.hue, side: 'buy', usd, qty: q.qty, price: q.avgPrice, mcap: t.mcap, action: 'more' })
        w.lastActive = m.tick
        actions.push({ walletId: w.id, tokenId: id, side: 'buy', usd, fraction: 1, kind: 'more', mcap: t.mcap })
        break
      }
    }

    // Entries.
    // Rival wallets trade at half pace so the extra 20 wallets don't swamp the market.
    if (Object.keys(w.positions).length < MAX_POS[w.style] && rng.chance(ACT_RATE[w.style] * (w.rival ? 0.5 : 1))) {
      // Its mind picks most of a minded wallet's entries (what the feed says); the rest are its style's, as before.
      const minded = mind && rng.chance(w.style === 'kol' ? MIND.kolShare : MIND.share) ? mindEntry(mind, w, m.tokens.filter((x) => live(x) && x.liquidity > 1500), m, rng) : undefined
      const t = minded?.t ?? pickEntry(w, m.tokens, m, rng)
      if (t) {
        const [lo, hi] = SIZE[w.style]
        // Real traders size to the pool: ~1.5% of liquidity keeps their own impact to a few percent.
        const usd = Math.min(w.cash * rng.range(lo, hi), t.liquidity * 0.015)
        if (usd >= 20) {
          touch()
          const q = quoteBuy(t, usd)
          const prev = t.price
          t.price = q.newPrice
          t.mcap = t.price * SUPPLY
          t.ath = Math.max(t.ath, t.mcap)
          // A KOL's call pulls in a wave of followers right behind them.
          touchCandles(t, m.time, prev, usd, m.native)
          fill(t, w, 'buy', usd, q.avgPrice)
          // (Only a KOL's own pick is a call. One made by its mind is a reaction to somebody else's post or to a run:
          // followers on those sent KOLs' crowds into whatever was already running, and a coin at 80% of its curve
          // made +9% in two minutes. See fair-test.)
          if (w.style === 'kol' && !minded) {
            // A KOL's call pulls in followers right behind them: a few real buys, on the tape like any other.
            const crowd = usd * rng.range(1, 3)
            const k = rng.int(2, 4)
            let bought = 0
            for (let i = 0; i < k; i++) bought += fillSim(m, t, 'buy', crowd / k, m.time, walletName(rng))
            // (In a pool the crowd answers them like an event's jump: see step 4b of tickMarket. Left to stand there,
            // every KOL who bought was a pump, and the pools KOLs pile into, the freshly bonded ones, drifted up: $100
            // on any coin the moment it bonded made +37% in fifteen minutes. On a curve the same buys are part of what
            // holders live on against their dev's selling; answering them there too cost every buyer a tenth.)
            if (bought > 0 && t.status === 'graduated') t.sim.jolt = (t.sim.jolt ?? 0) + bought
            t.volume += bought
            t.buys += k
            t.hype = Math.min(100, t.hype + 10)
            t.sim.pressure += 0.004
          }
          w.cash -= usd
          w.positions[t.id] = { qty: q.qty, cost: usd, openedTick: m.tick }
          w.live.buys++
          w.live.volume += usd
          w.live.inflow -= usd
          w.trades = record(w, { tokenId: t.id, ticker: t.ticker, emoji: t.emoji, hue: t.hue, side: 'buy', usd, qty: q.qty, price: q.avgPrice, mcap: t.mcap, action: 'first', ...(minded ? { why: minded.why } : {}) })
          w.lastActive = m.tick
          actions.push({ walletId: w.id, tokenId: t.id, side: 'buy', usd, fraction: 1, kind: 'first', mcap: t.mcap, ...(minded ? { why: minded.why } : {}) })
        }
      }
    }
    return w
  })
  return { wallets: next, actions }
}
