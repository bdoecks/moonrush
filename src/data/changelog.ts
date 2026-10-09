// What changed in the game, for players: every update's fixes, new things and changes, what is being worked on, and
// why something is closed. Shown in the "Updates" window (components/Updates.tsx).
//
// HOW TO KEEP IT: every push a player could notice adds an entry at the TOP of `UPDATES`, in plain words a player
// would use (no code names). Say what was wrong and that it is fixed; do not explain how a money bug was done.
// `id` must be new each time (the game shows a dot until a player has opened the newest one).
// Something behind one of the owner's switches is news only once that switch is on: give its entry the switch's
// name as `flag` (and the same as `until` on its "working on" line, which then leaves that list).

export interface Update {
  id: string
  flag?: 'sparks' // told only while this switch is on (see the top of the file)
  date: string // as shown, e.g. "October 8, 2026"
  title: string
  fixed?: string[]
  added?: string[]
  changed?: string[]
}

/** What is being worked on now, newest plans first. */
export const WORKING_ON: { what: string; why?: string; until?: 'sparks' }[] = [
  { until: 'sparks', what: 'Coins that come from a story', why: 'A post or a news item appears on the timeline, devs rush to launch coins on it, and you work out which coin is the real one. It is being tested before it opens to everyone.' },
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
    id: '2026-10-09-story-market',
    flag: 'sparks',
    date: 'October 2026',
    title: 'Coins now come from stories',
    added: [
      'Posts and news come in on the Social Tracker all day, from made-up accounts of every size. Within seconds devs launch coins on them. Most new coins now come from a post.',
      'Under a post, "coins launched on this" opens every coin that was launched on it, in the order they came, each with its risk tag.',
      'The leaf on a Trenches card and the Story tab on a coin show the post that coin was launched on.',
      'Read the post, then the coins. Some have the name exactly right, some are misspelled, some are somebody\'s own version. After a while the timeline settles on ONE coin and the crowd leaves the others for it, or it moves on and no coin is picked.',
      'A big account\'s post brings more coins and moves far more money than a small one\'s. Most posts go nowhere.',
    ],
    changed: [
      'Buying the first coin, the biggest coin or every coin on a post does not pay. The right name with a clean risk tag is the better bet, and even that one misses more often than it hits.',
    ],
  },
  {
    id: '2026-10-08-floating-trackers',
    date: 'October 8, 2026',
    title: 'Trackers you can drag anywhere',
    added: [
      'The Wallet Tracker and the Social Tracker can be popped out of the side dock (the small window button in their title bar) into floating panels. Drag one by its top bar, resize it from its corner, and press its X to put it back. On a computer screen only.',
    ],
  },
  {
    id: '2026-10-08-missions',
    date: 'October 8, 2026',
    title: 'A bigger Missions tab',
    added: [
      'Weekly missions: four bigger goals every Monday, with a bonus for finishing all four.',
      'A career ladder: nine things to get good at (trades, volume, wins, your best trade, streaks and more), each with five badges from Bronze to Diamond. They never reset.',
      'A streak counter: trade every day to keep it alive.',
    ],
    changed: [
      'The Missions tab is split into Daily, Weekly, Career and This round, and on a phone the missions now come first.',
      'Missions pay XP, as before. They never pay money.',
    ],
  },
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

type Switches = Partial<Record<'sparks', boolean>>
/** The updates a player is told about right now (an update behind a switch that is off is not news yet). */
export const shownUpdates = (flags: Switches) => UPDATES.filter((u) => !u.flag || !!flags[u.flag])
/** …and what is being worked on (a thing that has opened is not being worked on any more). */
export const shownWork = (flags: Switches) => WORKING_ON.filter((w) => !w.until || !flags[w.until])
