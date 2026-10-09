// What changed in the game, for players: every update's fixes, new things and changes, what is being worked on, and
// why something is closed. Shown in the "Updates" window (components/Updates.tsx).
//
// HOW TO KEEP IT: every push a player could notice adds an entry at the TOP of `UPDATES`, in plain words a player
// would use (no code names). Say what was wrong and that it is fixed; do not explain how a money bug was done.
// `id` must be new each time (the game shows a dot until a player has opened the newest one).

export interface Update {
  id: string
  date: string // as shown, e.g. "October 8, 2026"
  title: string
  fixed?: string[]
  added?: string[]
  changed?: string[]
}

/** What is being worked on now, newest plans first. */
export const WORKING_ON: { what: string; why?: string }[] = [
  { what: 'Cooking (launching your own coin)', why: 'It is being rebuilt so that launching a coin is a real bet, not a way to print money.' },
  { what: 'CopyTrade, Sniper and Monitor', why: 'They work, but not well enough yet. They come back when they are worth using.' },
  { what: 'Real pictures for coins', why: 'So the market looks less like emoji and more like the real thing.' },
]

/** Things that are switched off right now. `flag`: the owner's switch that brings it back (it leaves this list by itself when that is on). */
export const CLOSED: { what: string; why: string; flag: 'cooking' | 'labs' }[] = [
  { flag: 'cooking', what: 'The Cooking tab', why: 'Launching coins was far too easy to make money with, which made the leaderboards meaningless. It is closed while it is rebuilt. Coins that were already launched keep trading.' },
  { flag: 'labs', what: 'The CopyTrade, Sniper and Monitor tabs', why: 'They need more work before they are fair and useful. Copy trades and snipers you had set up are paused, not lost.' },
]

/** Newest first. */
export const UPDATES: Update[] = [
  {
    id: '2026-10-08-fair-play',
    date: 'October 8, 2026',
    title: 'Fair play, tutorials and a better board',
    fixed: [
      'Spamming many small buys on one coin could make money out of nothing. That is closed: fast buying now costs what it should.',
      'After refreshing the page a coin\'s chart could look like it had only gone up, until you changed the timeframe. It now shows the real chart straight away.',
      'Buying your own coin with a side wallet was counted as the dev buying. Only the dev wallet is the dev now.',
      'A player\'s card listed old bags in coins that had left the market as rows of "?". They are now one line.',
    ],
    added: [
      'Tutorials for trading (and for deving, when Cooking is back): a short guide that walks you through the real game. Find them in Help.',
      'A leaf on every Trenches card: hover it (tap on a phone) to read what the coin is about before you open it.',
      'Trenches cards show how many KOLs and smart-money wallets hold a coin, and the dev\'s record (coins migrated out of coins launched).',
      'A Dev panel on coins you launched: buy and sell from the dev wallet with one click.',
      'The World leaderboard has a podium for the top three, and everybody has a rank, from Plankton to Whale.',
      'Report a bug and Share an idea: the two buttons at the top right. Every one is read.',
      'This list of updates, so you always know what changed and why.',
    ],
    changed: [
      'The market is fair: buying whatever is running no longer pays by itself. What works is reading a coin before you buy it.',
      'Coins launched by players play by the same rules as every other coin. The launch fee is $50 and creator fees are half of what they were.',
      'Coins are launched from a dev wallet only, never from a trading wallet.',
    ],
  },
]
