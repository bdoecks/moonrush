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
  flag?: 'sparks' | 'larps' | 'tech' | 'cooking' // told only while this switch is on (see the top of the file)
  date: string // as shown, e.g. "October 8, 2026"
  title: string
  fixed?: string[]
  added?: string[]
  changed?: string[]
}

/** What is being worked on now, newest plans first. */
export const WORKING_ON: { what: string; why?: string; until?: 'sparks' | 'larps' | 'tech' }[] = [
  { until: 'tech', what: 'Tech coins', why: 'Posts that announce a small tool. Every coin launched on one has a site with a demo, and only on some of them does the demo really work. It is being tested first.' },
  { until: 'larps', what: 'Real or fake posts', why: 'Some posts will come from impersonators, made-up screenshots and hacked accounts, and you will have to check who really posted before you buy. It is being tested first.' },
  { until: 'sparks', what: 'Coins that come from a story', why: 'A post or a news item appears on the timeline, devs rush to launch coins on it, and you work out which coin is the real one. It is being tested before it opens to everyone.' },
  { what: 'Cooking (launching your own coin)', why: 'It is being rebuilt so that launching a coin is a real bet, not a way to print money.' },
  { what: 'CopyTrade, Sniper and Monitor', why: 'They work, but not well enough yet. They come back when they are worth using.' },
]

/** Things that are switched off right now. `flag`: the owner's switch that brings it back (it leaves this list by itself when that is on). */
export const CLOSED: { what: string; why: string; flag: 'cooking' | 'labs' }[] = [
  { flag: 'cooking', what: 'The Cooking tab', why: 'Launching coins was far too easy to make money with, which made the leaderboards meaningless. It is closed while it is rebuilt. Coins that were already launched keep trading.' },
  { flag: 'labs', what: 'The CopyTrade, Sniper and Monitor tabs', why: 'They need more work before they are fair and useful. Copy trades and snipers you had set up are paused, not lost.' },
]

/** Newest first. */
export const UPDATES: Update[] = [
  {
    id: '2026-10-13-right-click',
    date: 'October 13, 2026',
    title: 'Right-click a coin to open it in a new tab',
    changed: ['In the World and in friends rooms, a right-click on a coin now opens it in a new browser tab straight away. A middle click or a click with Ctrl held still does the same.'],
  },
  {
    id: '2026-10-13-rapid-deploy',
    date: 'October 13, 2026',
    title: 'Deploy and Rapid deploy from a post',
    flag: 'cooking',
    added: [
      'Turn on "Deploy buttons" in the X tracker (or in Cooking > Rapid deploy settings) and every open post in the World gets two buttons. Deploy opens Cooking with that post on top of the form.',
      'Rapid deploy shows three coin ideas made from the post, ready to go with your own settings. One click launches it and opens your coin.',
      'Rapid deploy settings: chain and launchpad, which dev wallet, the dev buy, a bundle, the ticker style, and auto-sell for the dev bag and for the bundle (after a time, at a multiple, at a market cap, or a stop loss).',
      'The dev panel on your coin can now sell your bundle on its own, apart from the dev bag.',
    ],
    changed: ['The list of posts is no longer on the Cooking page: press Deploy under a post in the X tracker instead.'],
  },
  {
    id: '2026-10-13-dev-tools',
    date: 'October 13, 2026',
    title: 'The volume bot and the airdrop work like the real ones',
    flag: 'cooking',
    changed: [
      'The volume bot is now a service you buy as a package: so much volume, from so many wallets, over so many minutes, for a fee paid up front. Its wallets really buy and sell your coin, so you see its trades on the tape and the chart.',
      'A bot package always costs more than the creator fees it earns back. You pay for attention, not for profit.',
      'An airdrop now goes one of two ways. The first is to fresh wallets of your own: your dev wallet looks smaller and the holder count goes up, and the coins are still yours.',
      'The second is to known traders you pick from a list. The trackers then show them holding your coin, but they did not choose it, and most sell what they are sent.',
      'On a coin\u2019s Tracked tab, a trader holding tokens the dev sent is marked "sent by dev", so you can tell a real buy from a gift.',
    ],
  },
  {
    id: '2026-10-12-coin-new-tab',
    date: 'October 12, 2026',
    title: 'Open a coin in a new tab',
    added: [
      'In the World and in friends rooms, right-click a coin and choose "Open link in new tab", or click it with the middle button or with Ctrl held. The coin opens in its own browser tab, like on a real market.',
      'You can keep several tabs open as the same player. A trade in one tab shows in the others, and each tab keeps its own coin and chart.',
    ],
  },
  {
    id: '2026-10-12-back-button',
    date: 'October 12, 2026',
    title: 'The Back button works',
    fixed: ['Your browser\u2019s Back button now takes you to the page or coin you had open before. It used to leave the game.'],
    added: ['The address bar shows where you are, so reloading the page keeps you on the same page or coin.'],
  },
  {
    id: '2026-10-12-tracker-sides',
    date: 'October 12, 2026',
    title: 'Put each tracker where you want it',
    added: [
      'The Wallet Tracker and the Social Tracker can sit on opposite sides of the screen. The arrows button in a tracker\u2019s title bar moves it to the other side.',
      'You can show just one of them: the X in a tracker\u2019s title bar hides it, and its button on the edge of the screen brings it back.',
    ],
  },
  {
    id: '2026-10-11-coin-photos',
    date: 'October 11, 2026',
    title: 'Photos on coins',
    added: ['Most coins now show a photo of what they are (a frog, a rocket, a bowl of noodles) where they used to show an emoji. Every photo is made up. A coin a player launched keeps the picture its maker chose.'],
    changed: ['The leaf on Trenches cards has been taken off for now. It comes back with "Coins that come from a story", where it will show the post a coin was launched on.'],
  },
  {
    id: '2026-10-10-timeline',
    flag: 'sparks',
    date: 'October 10, 2026',
    title: 'A timeline that feels alive',
    added: [
      'Pictures on posts. Many posts now come with a photo of what they are about. Every picture is made up, like the accounts.',
      "Coins launched on a post wear that post's picture, the way devs lift a post's image for their coin. Every coin on the same post gets the same picture, so the picture never tells you which one is right.",
      "Accounts have profile pictures now. A fake account copies the real one's picture along with its name: check the handle and the check mark, not the picture.",
      'Replies under a post, and "Show more replies" to read the rest. They are chatter, not tips: nobody in the replies knows which coin is the right one.',
      'Accounts follow up on their own posts, and other accounts repost them with a line of their own.',
      'Every known account now writes in its own way, so you can tell them apart by how they talk.',
      'The leaf on a Trenches card is back, on coins launched on a post only: hover it to read that post, with its picture and the newest replies. That is all it shows. The rest is yours to look up.',
      '"What is happening" is a tab of the Social Tracker: the meta right now and what the timeline is talking about. It no longer sits on top of the posts.',
      'Click an account\'s name to open its page: who it says it is, how many followers, and its latest posts.',
    ],
    changed: [
      'Far more variety in what posts say, and each size of account sounds different: a celebrity, a big page, a small account and a local paper no longer write the same sentences.',
      'When the timeline settles on a coin, that coin now trades in a rush, the way a winner does.',
    ],
  },
  {
    id: '2026-10-10-one-feed-look',
    date: 'October 10, 2026',
    title: 'One look for every feed',
    changed: ['The Social Tracker at the bottom of the screen and the feed on the Track page now look like the one in the side panel: the same timeline everywhere.'],
  },
  {
    id: '2026-10-09-social-tracker-look',
    date: 'October 9, 2026',
    title: 'A Social Tracker you can read',
    changed: [
      'Posts in the Social Tracker (the side panel) now look like a real timeline: bigger text, the name, handle and time on one line, and replies, reposts, likes and views under each post.',
      'Every account shows how many followers it has, in a coloured badge.',
      'The box for writing a post is folded into one line ("Write a post…") so the feed has the room.',
    ],
  },
  {
    id: '2026-10-09-tech-coins',
    flag: 'tech',
    date: 'October 2026',
    title: 'Tech coins: try the demo',
    added: [
      'Some posts now announce a small tool. Every coin launched on such a post has the same name, so the name tells you nothing.',
      'Each of those coins has a site. Open it from the coin\'s page (the blue line under its name) and try the demo.',
      'On some coins the demo really works. On others it gives the same answer whatever you type, says "coming soon", or just keeps loading. Try it with two different things.',
      'The timeline tends to settle on a coin whose demo works. A coin with a working demo and a clean risk tag is the better bet.',
    ],
  },
  {
    id: '2026-10-09-real-or-fake',
    flag: 'larps',
    date: 'October 2026',
    title: 'Real or fake: check who posted',
    added: [
      'Not every post from a famous name is real. An impersonator has the same name and picture, but the handle is one letter off, there is no check mark and the follower count is lower.',
      'A screenshot of a famous account\'s post, shared by a nobody, may be made up. The post says it is a screenshot and whose post it claims to be.',
      'Now and then a real account is hacked. Nothing gives that one away until it comes out.',
      'When a fake comes out, the real account says so on the timeline and the crowd leaves every coin that was launched on it.',
    ],
  },
  {
    id: '2026-10-09-story-market',
    flag: 'sparks',
    date: 'October 2026',
    title: 'Coins now come from stories',
    added: [
      'Posts and news come in on the Social Tracker all day, from made-up accounts of every size. Within seconds devs launch coins on them. Most new coins now come from a post.',
      'A post does not tell you which coins were launched on it. Find them yourself in Trenches: the new coins with its name on them.',
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

type Switches = Partial<Record<'sparks' | 'larps' | 'tech' | 'cooking', boolean>>
/** The updates a player is told about right now (an update behind a switch that is off is not news yet). */
export const shownUpdates = (flags: Switches) => UPDATES.filter((u) => !u.flag || !!flags[u.flag])
/** …and what is being worked on (a thing that has opened is not being worked on any more). */
export const shownWork = (flags: Switches) => WORKING_ON.filter((w) => !w.until || !flags[w.until])
