// Chart trade-marker kinds, shared by the chart and its toolbar.
export type MarkerKind = 'me' | 'dev' | 'tracked' | 'friends' | 'kol' | 'top10'
export type MarkerKinds = Record<MarkerKind, boolean>

export const MARKER_UP = '#19d989'
export const MARKER_DOWN = '#ff4d6a'

export const MARKER_KINDS: { id: MarkerKind; label: string; glyph: string; color: string; hint: string }[] = [
  { id: 'me', label: 'My trades', glyph: 'B', color: MARKER_UP, hint: 'Your buys (B) and sells (S)' },
  { id: 'dev', label: 'Dev', glyph: 'D', color: '#ffb020', hint: 'Dev wallet buys (DB) and sells (DS)' },
  { id: 'tracked', label: 'Tracked', glyph: 'T', color: '#4da3ff', hint: 'Wallets you track on the Track tab (their avatar + B/S)' },
  { id: 'friends', label: 'Friends', glyph: 'F', color: '#b36bff', hint: 'Players in your room: their main-wallet buys and sells (avatar), plus side-wallet addresses you track' },
  { id: 'kol', label: 'KOLs', glyph: 'K', color: '#ffb020', hint: 'KOL and smart-money wallets trading this coin (their avatar)' },
  { id: 'top10', label: 'Top 10 avg', glyph: '10', color: '#8b93a1', hint: 'Dotted lines: the top 10 holders’ average buy and sell' },
]

/** Saved marker settings from before a kind existed count it as on. */
export const withMarkerDefaults = (k: Partial<MarkerKinds>): MarkerKinds => ({ me: true, dev: true, tracked: true, friends: true, kol: true, top10: true, ...k })
