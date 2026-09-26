import type { EventKind, Regime } from '../types'

// Fictional in-game market events. Each one nudges the hidden simulation of a token.
export interface EventTemplate {
  kind: EventKind
  icon: string
  tone: 'up' | 'down' | 'warn' | 'info'
  weight: number
  texts: string[] // `{T}` is replaced with $TICKER
  pressure?: number // added to token sim pressure
  jump?: [number, number] // immediate price move range (fraction)
  hype?: number
  volBoost?: number
  regime?: Regime
  regimeTicks?: [number, number]
  liquidity?: number // multiplier
  prefers?: 'hot' | 'risky' | 'any' | 'cold'
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  { kind: 'trending', icon: '🔥', tone: 'up', weight: 10, texts: ['{T} is trending', '{T} hit the trending page', '{T} is on every timeline'], pressure: 0.006, hype: 22, prefers: 'hot' },
  { kind: 'whale', icon: '🐋', tone: 'up', weight: 8, texts: ['Large simulated buy on {T}', 'Whale aped into {T}', 'A 🐋 just swept the {T} order book'], jump: [0.05, 0.14], pressure: 0.004, hype: 8, prefers: 'any' },
  { kind: 'momentum', icon: '🚀', tone: 'up', weight: 7, texts: ['Momentum spike on {T}', '{T} breaking out', '{T} is sending'], regime: 'pump', regimeTicks: [8, 22], hype: 12, prefers: 'hot' },
  { kind: 'liquidity', icon: '⚠️', tone: 'warn', weight: 6, texts: ['Liquidity dropping on {T}', 'LP pulled from {T} pool', '{T} liquidity thinning out'], liquidity: 0.72, pressure: -0.003, volBoost: 0.8, prefers: 'risky' },
  { kind: 'panic', icon: '💀', tone: 'down', weight: 6, texts: ['Panic selling on {T}', '{T} holders heading for the exits', 'Capitulation on {T}'], regime: 'dump', regimeTicks: [6, 16], hype: -10, prefers: 'any' },
  { kind: 'viral', icon: '📈', tone: 'up', weight: 6, texts: ['Viral social activity around {T}', '{T} meme went viral', 'Everyone is posting {T} memes'], hype: 35, pressure: 0.004, regime: 'accumulation', regimeTicks: [15, 35], prefers: 'cold' },
  { kind: 'volatility', icon: '🧨', tone: 'warn', weight: 5, texts: ['Extreme volatility on {T}', '{T} is going absolutely feral', 'Wild wicks on {T}'], volBoost: 2.2, prefers: 'any' },
  { kind: 'smartmoney', icon: '👀', tone: 'info', weight: 5, texts: ['Smart money accumulating {T}', 'Tracked wallets quietly buying {T}', 'Insiders loading {T}'], regime: 'accumulation', regimeTicks: [25, 50], pressure: 0.002, prefers: 'cold' },
  { kind: 'devsell', icon: '🧑‍💻', tone: 'down', weight: 4, texts: ['Dev wallet sold {T}', '{T} dev is taking profits', 'Team wallet dumping {T}'], jump: [-0.18, -0.08], pressure: -0.005, prefers: 'risky' },
  { kind: 'kol', icon: '📣', tone: 'up', weight: 4, texts: ['A big fictional influencer shilled {T}', 'KOL callout: {T}', '{T} got called in 40 group chats'], jump: [0.03, 0.09], hype: 25, regime: 'pump', regimeTicks: [5, 12], prefers: 'any' },
]

export const MARKET_EVENTS = {
  up: { icon: '🌙', texts: ['Degen season: risk-on across the trenches', 'Market mood flipped bullish', 'Fresh (simulated) liquidity entering memes'] },
  down: { icon: '🥶', texts: ['Risk-off: the whole market is bleeding', 'Market mood turning bearish', 'Liquidity leaving the trenches'] },
}
