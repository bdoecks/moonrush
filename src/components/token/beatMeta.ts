// How a coin's story beats look and read, shared by the Story tab and the chart's pins.
import type { Beat, BeatKind, BeatSource, StoryArc } from '../../types'

export const BEAT_ICON: Record<BeatKind, string> = {
  post: '💬', call: '📣', trend: '🔥', rumor: '👀', partner: '🤝', news: '📰', drama: '💢', fade: '💤', theme: '🌐',
  bigbuy: '🐋', bigsell: '🐋', enter: '📥', exit: '📤', volume: '📊', milestone: '🏁', dev: '🧑‍💻', warn: '🚨',
}

export const BEAT_LABEL: Record<BeatKind, string> = {
  post: 'Post', call: 'Call', trend: 'Trending', rumor: 'Rumour', partner: 'Partnership', news: 'News', drama: 'Drama', fade: 'Faded', theme: 'Outside trend',
  bigbuy: 'Large buy', bigsell: 'Large sell', enter: 'Position opened', exit: 'Position closed', volume: 'Volume spike', milestone: 'Milestone', dev: 'Dev sold', warn: 'Warning',
}

/** Where a beat's content comes from. The three are shown apart everywhere: nothing invented passes for a fact. */
export const SRC_META: Record<BeatSource, { label: string; cls: string; hint: string }> = {
  market: { label: 'MARKET', cls: 'bg-info/15 text-info', hint: 'A fact from this simulated market, read off the trades.' },
  story: { label: 'STORY', cls: 'bg-[#8fd14f]/15 text-[#8fd14f]', hint: 'Generated narrative. The accounts, outlets and brands in it are invented.' },
  trend: { label: 'OUTSIDE DATA', cls: 'bg-warn/15 text-warn', hint: 'A theme that was hot in real launches, from the source and date shown (Help lists where the data comes from). Never presented as live unless a provider is connected.' },
}

export const ARC_LABEL: Record<StoryArc, string> = {
  meme: 'A meme catching on', caller: 'Callers circling', community: 'Community takeover', builder: 'The dev is building', whale: 'A whale is in',
}

export const TONE_COLOR: Record<Beat['tone'], string> = { up: '#8fd14f', down: '#ff4d6a', warn: '#ffb020', info: '#8b93a1' }

/** "+18.2%" / "-9.1%" */
export const movePct = (move: number) => `${move >= 0 ? '+' : ''}${(move * 100).toFixed(Math.abs(move) >= 1 ? 0 : 1)}%`

/** A beat's headline: who it is by, or what kind of thing it is. */
export const beatTitle = (b: Beat) => (b.src !== 'market' && b.by ? `@${b.by.name}` : BEAT_LABEL[b.kind])

/** Which beat a pin shows when several share a candle: the story's loudest, the market's most important. */
const WEIGHT: Partial<Record<BeatKind, number>> = { drama: 9, trend: 8, news: 7, call: 6, partner: 5, milestone: 5, warn: 5, volume: 4, bigsell: 3, bigbuy: 3, rumor: 2, post: 2, theme: 1, fade: 1 }
export const beatWeight = (b: Beat) => (WEIGHT[b.kind] ?? 0) * 100 + (b.heat ?? 0)
