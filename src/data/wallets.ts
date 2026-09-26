import type { WalletStyle } from '../types'

// Fictional trader wallets for the copy-trade board. Names are invented handles, not real people.
export const WALLET_SEEDS: { name: string; avatar: string; style: WalletStyle; skill: number }[] = [
  { name: 'ghostbid', avatar: '👻', style: 'smart', skill: 0.85 },
  { name: 'quietcapital', avatar: '🦉', style: 'smart', skill: 0.75 },
  { name: 'frog_seer', avatar: '🔮', style: 'smart', skill: 0.65 },
  { name: 'Zeta.eth', avatar: '🧬', style: 'smart', skill: 0.55 },
  { name: 'CandleMonk', avatar: '🕯️', style: 'smart', skill: 0.4 },
  { name: 'tr3nchlord', avatar: '🪖', style: 'sniper', skill: 0.8 },
  { name: 'sniper_joe', avatar: '🎯', style: 'sniper', skill: 0.6 },
  { name: '0xLurk', avatar: '🕶️', style: 'sniper', skill: 0.45 },
  { name: '7xQm…kD2f', avatar: '🤖', style: 'sniper', skill: 0.3 },
  { name: 'VexCalls', avatar: '📣', style: 'kol', skill: 0.6 },
  { name: 'AlphaAuntie', avatar: '👑', style: 'kol', skill: 0.5 },
  { name: 'MoonMike', avatar: '🎤', style: 'kol', skill: 0.35 },
  { name: 'HerbTheWhale', avatar: '🐋', style: 'whale', skill: 0.7 },
  { name: 'DeepPockets', avatar: '💼', style: 'whale', skill: 0.55 },
  { name: 'Kraken.sol', avatar: '🦑', style: 'whale', skill: 0.4 },
  { name: 'degenmama', avatar: '🎰', style: 'degen', skill: 0.5 },
  { name: 'bagwhisperer', avatar: '👜', style: 'degen', skill: 0.4 },
  { name: 'pixelape', avatar: '🦍', style: 'degen', skill: 0.3 },
  { name: 'YoloYuki', avatar: '🎲', style: 'degen', skill: 0.2 },
  { name: 'Nomad', avatar: '🏜️', style: 'fresh', skill: 0.5 },
  { name: '3Nf…b7nX', avatar: '🌱', style: 'fresh', skill: 0.35 },
  { name: 'Mika', avatar: '🐣', style: 'fresh', skill: 0.3 },
  { name: 'Hz9…Qe1w', avatar: '🆕', style: 'fresh', skill: 0.2 },
  { name: 'rugradar', avatar: '📡', style: 'smart', skill: 0.6 },
]

export const STYLE_META: Record<WalletStyle, { label: string; icon: string; cls: string; blurb: string }> = {
  smart: { label: 'Smart Money', icon: '🧠', cls: 'text-accent border-accent/30 bg-accent/10', blurb: 'Reads accumulation early and exits into strength.' },
  sniper: { label: 'Sniper', icon: '🎯', cls: 'text-warn border-warn/30 bg-warn/10', blurb: 'Apes fresh launches in the first minutes and flips fast.' },
  kol: { label: 'KOL', icon: '📣', cls: 'text-info border-info/30 bg-info/10', blurb: 'Their buys pump the chart, and they often sell into their own followers.' },
  whale: { label: 'Whale', icon: '🐋', cls: 'text-up border-up/30 bg-up/10', blurb: 'Big size, buys dips on liquid tokens, takes modest profits.' },
  degen: { label: 'Degen', icon: '🎰', cls: 'text-down border-down/30 bg-down/10', blurb: 'Chases whatever is trending with wide stops. High variance.' },
  fresh: { label: 'Fresh Wallet', icon: '🌱', cls: 'text-muted border-line2 bg-raise', blurb: 'New wallet with little history. Could be anyone.' },
}
