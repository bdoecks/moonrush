// Themes that are hot outside the game, for the story engine. This is the list shipped with the game: a SAMPLE, the
// themes real launches were riding on the date below (from the owner's own recordings), not a live feed. The World's
// server replaces it with its latest recording (`worldTrends` in server/brainBots.ts). A real data provider plugs in at
// the same place: anything that can produce a TrendFeed, with an honest `source` and `asOf`.
import type { TrendFeed } from '../types'

export const SAMPLE_TRENDS: TrendFeed = {
  source: 'sample',
  asOf: '2026-10-03',
  themes: [
    { word: 'agent', narrative: 'ai', weight: 1 }, { word: 'horse', narrative: 'absurd', weight: 0.8 }, { word: 'bot', narrative: 'ai', weight: 0.7 },
    { word: 'mink', narrative: 'absurd', weight: 0.6 }, { word: 'cat', narrative: 'cats', weight: 0.55 }, { word: 'squirrel', narrative: 'absurd', weight: 0.5 },
    { word: 'rocket', narrative: 'space', weight: 0.4 }, { word: 'dog', narrative: 'dogs', weight: 0.35 }, { word: 'frog', narrative: 'frogs', weight: 0.25 }, { word: 'banana', narrative: 'food', weight: 0.2 },
  ],
}
