// The story market's content: who posts, what they post about, and what devs call the coins they launch on it.
// Everything here is INVENTED: the accounts, the outlets, the pets, the places. The owner's rule (the same one the
// stories and the theme words follow): posts ride real themes, never real names. Do not add a real person, company,
// product, outlet, place, famous animal or belief here, and no parody of one either. scripts/spark-test.ts checks the
// subjects against the approved theme words and the names against a list of famous real ones.
import type { Narrative, SparkTier } from '../types'

export interface SparkAccount {
  id: string
  name: string
  handle: string
  avatar: string
  followers: number
  verified: boolean
  tier: SparkTier
  news?: boolean // an outlet: it posts news, not memes
}

const acct = (tier: SparkTier, verified: boolean, news: boolean, rows: [string, string, string, number][]): SparkAccount[] =>
  rows.map(([name, handle, avatar, followers]) => ({ id: `sx-${handle}`, name, handle, avatar, followers, verified, tier, ...(news ? { news } : {}) }))

/**
 * The accounts with a name. A post from one of the huge ones is rare and moves the whole market's attention; the
 * small ones post all day and mostly nobody notices. (The smallest accounts are made up on the spot: `anonAccount`.)
 */
export const SPARK_ACCOUNTS: SparkAccount[] = [
  // Huge: invented celebrities. Their posts are events.
  ...acct('mega', true, false, [
    ['Orla Vex', 'orlavex', '🎤', 148_000_000], ['Kenji Blaze', 'kenjiblaze', '🎮', 61_000_000], ['Chef Tamsin Roe', 'cheftamsin', '👩‍🍳', 38_000_000],
    ['Big Milo', 'bigmilo', '🏀', 92_000_000], ['Professor Quill', 'profquill', '🧪', 27_000_000], ['Dax Marlowe', 'daxmarlowe', '🏎️', 44_000_000],
  ]),
  ...acct('mega', true, true, [['Global Wire Service', 'globalwire', '🌐', 31_000_000]]),
  // Big: pages everybody follows, and the larger outlets.
  ...acct('big', true, false, [
    ['Critter Dispatch', 'critterdispatch', '🐾', 3_200_000], ['Zoomies Central', 'zoomiescentral', '🐕', 2_100_000], ['Tiny Hats Daily', 'tinyhatsdaily', '🎩', 2_800_000],
    ['The Nap Times', 'thenaptimes', '😴', 4_400_000], ['Wholesome Wire', 'wholesomewire', '🌈', 3_600_000], ['Snack Gazette', 'snackgazette', '🍜', 1_400_000],
    ['Robot Kitchen', 'robotkitchen', '🤖', 1_100_000], ['Orbit Watch', 'orbitwatch', '🛰️', 900_000], ['Pixel Attic', 'pixelattic', '👾', 760_000],
    ['Barnyard Bulletin', 'barnyardbulletin', '🐄', 640_000], ['Pond Report', 'pondreport', '🐸', 520_000], ['Juno Park', 'junopark', '🎬', 5_100_000],
  ]),
  ...acct('big', true, true, [
    ['The Daybreak Courier', 'daybreakcourier', '📰', 2_300_000], ['Harbor City Post', 'harborcitypost', '🗞️', 1_100_000], ['Lab Notes Digest', 'labnotesdigest', '🔬', 800_000],
    ['The Tech Lantern', 'techlantern', '🏮', 950_000],
  ]),
  // Mid: accounts with a real following in their corner of the timeline.
  ...acct('mid', true, false, [
    ['frogposting daily', 'frogposting_daily', '🐸', 212_000], ['the duck desk', 'the_duck_desk', '🦆', 96_000], ['ramen inspector', 'ramen_inspector', '🥢', 74_000],
    ['retrobits fm', 'retrobits_fm', '📻', 58_000], ['bakery cam', 'bakery_cam', '🥐', 131_000], ['moonwatcher mae', 'moonwatcher_mae', '🔭', 43_000],
  ]),
  ...acct('mid', false, false, [
    ['cats of the corner shop', 'cornershopcats', '🐈', 187_000], ['gadget gran', 'gadget_gran', '👵', 66_000], ['trainspotting otter', 'trainspot_otter', '🚉', 39_000],
    ['goblin hours', 'goblin_hours', '🧌', 82_000], ['soup of the day', 'soupoftheday_', '🍲', 51_000], ['the last arcade', 'thelastarcade', '🕹️', 47_000],
    ['bird at the window', 'birdatwindow', '🐦', 29_000], ['unlicensed zookeeper', 'unlicensedzoo', '🦛', 118_000], ['dept of small robots', 'smallrobotsdept', '🔩', 34_000],
    ['horse girl emeritus', 'horsegirl_emer', '🐴', 25_000], ['midnight snack club', 'midnightsnacks', '🌙', 91_000], ['one good pixel', 'onegoodpixel', '🟩', 22_000],
  ]),
  ...acct('mid', true, true, [['Lakeside News Now', 'lakesidenews', '📺', 240_000], ['Market & Main', 'marketandmain', '🏛️', 160_000]]),
  // Small: local papers. (Most small posts are nobodies, made up on the spot: see `SMALL_OUTLETS` in game/sparks.ts.)
  ...acct('small', false, true, [
    ['Maple Street Weekly', 'maplestweekly', '🍁', 6_400], ['The Ferry Road Gazette', 'ferryroadgazette', '⛴️', 11_800], ['Northgate Courier', 'northgatecourier', '📮', 4_100],
    ['Little Harbor Herald', 'littleharborherald', '⚓', 16_500], ['Pinewood Daily', 'pinewooddaily', '🌲', 8_900], ['Canal Street Bulletin', 'canalstbulletin', '🛶', 3_300],
  ]),
]

// The smallest accounts: a handle made of two words and maybe a number. Thousands of them, none worth remembering.
const HANDLE_A = ['sleepy', 'tiny', 'lil', 'feral', 'soggy', 'crispy', 'gentle', 'cursed', 'cozy', 'loud', 'quiet', 'spicy', 'frozen', 'lucky', 'dusty', 'mellow', 'grumpy', 'bouncy', 'wobbly', 'rusty', 'fuzzy', 'salty', 'minty', 'dizzy']
const HANDLE_B = ['otter', 'goblin', 'noodle', 'pigeon', 'toast', 'gremlin', 'pickle', 'moth', 'beans', 'possum', 'wizard', 'crumb', 'pebble', 'turnip', 'badger', 'sprout', 'waffle', 'lizard', 'biscuit', 'gnome', 'muffin', 'walnut', 'radish', 'ferret']
const ANON_AVATARS = ['🙂', '🌻', '🍄', '🐛', '🧦', '🪴', '🫖', '🧃', '🌵', '🪿', '🧸', '🛼', '🥨', '🪩', '🐌', '🫧']

/** A nobody: an account made up for one post. `rand` gives numbers in [0, 1). */
export function anonAccount(rand: () => number, tier: 'anon' | 'small'): SparkAccount {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length) % a.length]
  const a = pick(HANDLE_A), b = pick(HANDLE_B)
  const digits = rand() < 0.45 ? String(Math.floor(rand() * 98) + 2) : ''
  const handle = `${a}${rand() < 0.5 ? '_' : ''}${b}${digits}`
  const followers = tier === 'anon' ? Math.round(40 + rand() ** 2 * 1900) : Math.round(2_000 + rand() ** 1.5 * 18_000)
  return { id: `sx-${handle}`, name: `${a} ${b}`, handle, avatar: pick(ANON_AVATARS), followers, verified: tier === 'small' && rand() < 0.08, tier }
}

// ─── What a post is about ────────────────────────────────────────────────────
export type SubjectType = 'creature' | 'food' | 'bot' | 'space' | 'retro'
/** A subject: an approved theme word (see themeWords.ts), its emoji and what kind of thing it is. */
export const SUBJECTS: { word: string; emoji: string; type: SubjectType }[] = [
  ...([['dog', '🐕'], ['puppy', '🐶'], ['fox', '🦊'], ['wolf', '🐺'], ['cat', '🐈'], ['kitten', '🐱'], ['tiger', '🐯'], ['lion', '🦁'], ['frog', '🐸'], ['toad', '🐸'],
    ['turtle', '🐢'], ['lizard', '🦎'], ['horse', '🐴'], ['squirrel', '🐿️'], ['monkey', '🐒'], ['bear', '🐻'], ['owl', '🦉'], ['duck', '🦆'], ['penguin', '🐧'],
    ['hamster', '🐹'], ['rabbit', '🐰'], ['panda', '🐼'], ['shark', '🦈'], ['whale', '🐋'], ['crab', '🦀'], ['snail', '🐌'], ['goat', '🐐'], ['cow', '🐄'], ['pig', '🐷'],
    ['chicken', '🐔'], ['hippo', '🦛'], ['beaver', '🦫'], ['otter', '🦦'], ['sloth', '🦥'], ['koala', '🐨'], ['dragon', '🐉'], ['unicorn', '🦄'], ['bird', '🐦'],
    ['bull', '🐂'], ['fish', '🐟'], ['mink', '🦡'], ['worm', '🪱']] as [string, string][]).map(([word, emoji]) => ({ word, emoji, type: 'creature' as const })),
  ...([['pizza', '🍕'], ['burger', '🍔'], ['taco', '🌮'], ['banana', '🍌'], ['cookie', '🍪'], ['donut', '🍩'], ['pickle', '🥒'], ['cheese', '🧀'], ['cake', '🍰'],
    ['waffle', '🧇'], ['pancake', '🥞'], ['mango', '🥭'], ['peach', '🍑'], ['lemon', '🍋'], ['melon', '🍈'], ['egg', '🥚'], ['toast', '🍞'], ['dumpling', '🥟']] as [string, string][]).map(([word, emoji]) => ({ word, emoji, type: 'food' as const })),
  ...([['robot', '🤖'], ['bot', '🤖'], ['android', '🤖'], ['machine', '⚙️']] as [string, string][]).map(([word, emoji]) => ({ word, emoji, type: 'bot' as const })),
  ...([['rocket', '🚀'], ['comet', '☄️'], ['alien', '👽'], ['ufo', '🛸'], ['planet', '🪐']] as [string, string][]).map(([word, emoji]) => ({ word, emoji, type: 'space' as const })),
  ...([['arcade', '🕹️'], ['cartridge', '💾'], ['console', '🎮'], ['joystick', '🕹️']] as [string, string][]).map(([word, emoji]) => ({ word, emoji, type: 'retro' as const })),
]

/**
 * Names: what the pet, the snack, the robot is called. That name is the RIGHT name for a coin on the post. Plain
 * names on purpose (the joke is a hippo called Brenda), and none that belongs to a famous real animal or character.
 */
export const SPARK_NAMES = [
  'Biscuit', 'Waffles', 'Tofu', 'Sprout', 'Nugget', 'Clover', 'Olive', 'Maple', 'Pudding', 'Truffle', 'Mabel', 'Dot', 'Fig', 'Kiwi', 'Pip', 'Tater',
  'Marble', 'Button', 'Cricket', 'Fudge', 'Pretzel', 'Radish', 'Turnip', 'Widget', 'Nova', 'Blip', 'Mooch', 'Gouda', 'Poppy', 'Birdie', 'Scout', 'Baron',
  'Steve', 'Linda', 'Brenda', 'Stan', 'Carl', 'Greg', 'Mildred', 'Gertrude', 'Agnes', 'Ethel', 'Norm', 'Herb', 'Murphy', 'Rocco', 'Dolores', 'Margo',
  'Lenny', 'Mort', 'Wendell', 'Beans', 'Crouton', 'Dumpster', 'Goober', 'Snorkel', 'Tugboat', 'Pancake', 'Pierogi', 'Wobble', 'Fidget', 'Doodle', 'Giblet', 'Scooter',
  'Toggle', 'Muffin', 'Raisin', 'Bagel', 'Crumpet', 'Nacho', 'Wonton', 'Gravy', 'Biscotti', 'Nibbles', 'Squeak', 'Twig', 'Acorn', 'Bramble', 'Puddle', 'Sorbet',
  'Rhubarb', 'Parsnip', 'Cabbage', 'Fritter', 'Lentil', 'Gumbo', 'Churro', 'Mochi', 'Miso', 'Udon', 'Kimchi', 'Brisket', 'Gnocchi', 'Quiche', 'Gherkin', 'Sprinkle',
  'Wiggle', 'Tumble',
]
/** A title for a subject makes a second kind of right name: "Mayor Otter" (#MayorOtter), as long as its ticker fits. */
export const SPARK_TITLES = ['Mayor', 'Doctor', 'Sir', 'Lord', 'Giga', 'Sleepy', 'Chonky', 'Judge', 'Coach', 'Chef', 'Uncle', 'Duke', 'Major', 'Granny']

/** What it did (past tense): the whole joke. */
const DID: Record<SubjectType, string[]> = {
  creature: [
    'refused to leave the hot tub', 'learned to open the fridge', 'rode the bus alone again this morning', 'stole a whole pizza and showed no remorse', 'showed up at the same bakery at 9am sharp',
    'fell asleep in a salad bowl', 'wore a tiny hat to work', 'escaped twice this week', 'only walks backwards now', 'got more followers than me overnight', 'started wearing boots',
    'sat like a person through an entire meeting', 'was promoted to station master', 'interrupted the weather forecast', 'won a staring contest with a security camera',
    'held up traffic for forty minutes and was thanked for it', 'joined a marching band uninvited', 'figured out the elevator', 'keeps bringing home shoes that are not his',
    'adopted a traffic cone', 'attended a wedding and caught the bouquet', 'has a favourite cashier', 'waited outside the library until it opened', 'photobombed a news report',
    'got banned from the buffet', 'stood in the rain looking betrayed', 'sat in a shopping cart and demanded to be pushed', 'finished a 5k by accident',
  ],
  food: [
    'has been on the counter for nine days and nobody dares eat it', 'has a face now and we are all responsible', 'won first prize and looked smug about it', 'sold out in nine minutes',
    'got its own chair at the dinner table', 'survived the office party untouched', 'was photographed more than the bride', 'is somehow still warm',
  ],
  bot: [
    'apologised to the cat', 'got stuck under the same chair for the third time', 'learned to open the fridge', 'started a group chat with the toaster', 'refused a tip and bowed',
    'followed a stranger home and vacuumed their porch', 'drew a perfect circle and then just stood there', 'waited politely at a crosswalk for an hour', 'played dead when asked to do taxes',
  ],
  space: [
    'was spotted again last night and nobody can explain it', 'got named by a classroom of seven-year-olds', 'is on the mission patch now, officially', 'waved back',
    'has been circling for a week like it lost its keys', 'showed up in the background of every photo',
  ],
  retro: [
    'still boots up after thirty years', 'has a save file with four hundred hours on it', 'was found at a garage sale for two dollars', 'only says HELLO and then your name',
    'beat the world record and nobody was playing', 'has one high score and it will never be beaten',
  ],
}

/**
 * Meme posts. `{N}` = the name, `{A}` = what it is ("hippo"), `{V}` = what it did, `{D}` = a small number,
 * `{H}` = the name as a hashtag (titled names only: "#MayorOtter").
 */
const MEME: Record<SubjectType, string[]> = {
  creature: [
    'meet {N}, the {A} who {V}', '{N} the {A} {V}. no further questions', 'everyone stop what you are doing. {N} the {A} {V}',
    'day {D} of posting {N} the {A} until he is famous. today he {V}', 'i cannot stop thinking about {N}. a {A}. {V}. legend',
    'the {A} that {V} has a name and it is {N}', '{N} update: still a {A}, still iconic. {V} this morning', 'petition to make {N} the {A} the mascot of everything',
    'this is {N}. {N} is a {A}. {N} {V}. that is the whole post', 'my neighbour has a {A} called {N} and it {V}',
  ],
  food: [
    'this {A} has a name. its name is {N}. it {V}', 'someone at work named a {A} {N} and it {V}', '{N} the {A} {V}. we protect {N}',
    'the bakery down the street made a {A} called {N}. it {V}',
  ],
  bot: [
    'my {A} is called {N} and it just {V}', 'meet {N}, the delivery {A} that {V}', '{N} the {A} {V}. the future is so stupid. i love it',
    'there is a {A} at the mall named {N}. yesterday it {V}',
  ],
  space: [
    'we named the {A} {N}. it is official. do not ask who we is', '{N} the {A} {V}', 'the {A} everybody is talking about is called {N} and it {V}',
  ],
  retro: [
    'found an old {A} and it is called {N}. it {V}', '{N} the {A} {V}. i am not okay', 'this {A} is named {N} and it {V}',
  ],
}
const MEME_TITLED = ['#{H} is the only thing getting me through this week', 'somebody please explain #{H} to me. actually do not. i get it', '#{H} {V} and i think about it daily', 'we are all just living in the #{H} era']

/** News posts (invented outlets and invented places). Same marks as above; `{P}` = a place, `{J}` = a job. */
const NEWS: Record<SubjectType, string[]> = {
  creature: [
    'BREAKING: {P} names its new {A} mascot {N} after a public vote', 'A {A} named {N} has been made honorary {J} of {P}',
    'Researchers say a {A} called {N} can count to nine. The video is everywhere.', '{N}, the {A} that wandered into {P}, now has a full-time job there',
    'Rescue {A} {N} reunited with its family after {D} days', 'Officials confirm the {A} seen on the roof of {P} is called {N} and is "doing fine"',
  ],
  food: [
    'A {A} called {N} wins first prize at the regional fair and already has a fan club', "Town's giant {A} statue, known as {N}, reopens after repairs",
    'Record crowd turns out to see {N}, the largest {A} ever made in {P}',
  ],
  bot: [
    "A cafe's {A} waiter, {N}, is going viral for refusing tips", 'Home {A} called {N} sells out in minutes after a demo video', 'City trial of a street-cleaning {A} named {N} extended "by popular demand"',
  ],
  space: [
    'The new test {A} has been nicknamed {N} by its crew', 'Amateur astronomers name a newly spotted {A} {N}', 'Schoolchildren choose {N} as the name of the next {A} model on display at {P}',
  ],
  retro: [
    'A sealed {A} nicknamed {N} sells at auction for a record price', 'Museum puts a working {A} called {N} on show in {P}',
  ],
}
const PLACES = ['a small coastal town', 'the city aquarium', 'a mountain village', 'the central train station', 'the harbor district', 'a university library', 'the old town market', 'a suburban fire station']
const JOBS = ['mayor', 'station master', 'harbor master', 'librarian', 'fire chief', 'postmaster', 'night watchman']

export const SPARK_TEXT = { DID, MEME, MEME_TITLED, NEWS, PLACES, JOBS }

/** The narrative (the game's own themes) a subject type belongs to when its word is not on the theme list by itself. */
export const TYPE_THEME: Record<SubjectType, Narrative> = { creature: 'absurd', food: 'food', bot: 'ai', space: 'space', retro: 'retro' }

// ─── What devs call their coins ──────────────────────────────────────────────
/** Put before a ticker by devs who want "their own" version of the coin. */
export const VARIANT_PRE = ['BABY', 'KING', 'TINY', 'GIGA', 'REAL', 'OG', 'SUPER']
/**
 * What a misspelled name must never spell (see `typo` in game/sparks.ts): crude words, slurs, and the names of real
 * coins and people a slip could land on ("duck" is one letter from a word nobody wants on a coin). A slip that would
 * put one of these into a name, where the right name has none, is thrown away and another is tried.
 */
export const NEVER_SPELL = [
  'nig', 'fag', 'kike', 'spic', 'coon', 'paki', 'dyke', 'tard', 'chink', 'gook', 'nazi', 'kkk', 'jew', 'homo', 'gay', 'rape', 'porn', 'sex', 'cum', 'dick', 'cock', 'cunt',
  'tit', 'ass', 'anus', 'anal', 'penis', 'vag', 'twat', 'wank', 'jizz', 'slut', 'whor', 'hoe', 'thot', 'bitch', 'bich', 'fuk', 'fuc', 'fux', 'shit', 'piss', 'poo', 'crap',
  'boob', 'kill', 'die', 'dead', 'drug', 'meth', 'coke', 'weed', 'god', 'jesus', 'allah', 'satan', 'trump', 'biden', 'elon', 'musk', 'doge', 'pepe', 'shib', 'bonk', 'wif',
]
/** …or after it. */
export const VARIANT_POST = ['INU', 'AI', 'CTO', '2', 'COIN', 'CLUB', 'DAO', 'FAN']
