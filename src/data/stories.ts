// Story content: who talks about coins and what they say. Everything here is INVENTED: the handles, the outlets, the
// shops that "partner" with a coin. The owner's rule (the same one the theme words follow): stories ride real themes,
// never real names. Do not add a real person, company, product, outlet or belief here, and no parody of one either.
import type { BeatKind, StoryArc } from '../types'

export interface Poster {
  name: string // shown as @name
  avatar: string
  followers: number
}

/** Small accounts: the first people to notice a coin. Most of what they post goes nowhere. */
export const SMALL_POSTERS: Poster[] = [
  { name: 'chartgoblin', avatar: '👺', followers: 840 }, { name: 'bagwhisperer', avatar: '🧳', followers: 2_300 }, { name: 'mcap_maxi', avatar: '📐', followers: 1_150 },
  { name: 'trenchmom', avatar: '🧺', followers: 3_900 }, { name: 'candle_carl', avatar: '🕯️', followers: 620 }, { name: 'liq_lizard', avatar: '🦎', followers: 1_800 },
  { name: 'nightshift_ape', avatar: '🌃', followers: 2_750 }, { name: 'tiny_whale', avatar: '🐳', followers: 4_400 }, { name: 'ser_no', avatar: '🙅', followers: 980 },
  { name: 'wick_hunter', avatar: '🎯', followers: 1_420 }, { name: 'degen_dee', avatar: '🎲', followers: 3_100 }, { name: 'pumpito', avatar: '🌶️', followers: 760 },
  { name: 'alpha_goblin', avatar: '🧌', followers: 2_050 }, { name: 'sol_gardener', avatar: '🌱', followers: 1_300 }, { name: 'exit_liq_eli', avatar: '🚪', followers: 540 },
  { name: 'floor_sweeper', avatar: '🧹', followers: 1_900 }, { name: 'mint_condition', avatar: '🍃', followers: 2_600 }, { name: 'gm_gremlin', avatar: '🌞', followers: 3_350 },
  { name: 'ticker_tape_tia', avatar: '🎞️', followers: 1_050 }, { name: 'slippage_sam', avatar: '🧊', followers: 880 }, { name: 'onchain_ollie', avatar: '🔎', followers: 4_100 },
  { name: 'rug_radar_rae', avatar: '📡', followers: 4_800 }, { name: 'jeet_whisper', avatar: '🤫', followers: 1_240 }, { name: 'lowcap_lou', avatar: '🔬', followers: 2_900 },
]

/** Mid-size accounts: when these pick a coin up, it is being noticed. */
export const MID_POSTERS: Poster[] = [
  { name: 'trench_cartographer', avatar: '🗺️', followers: 14_500 }, { name: 'the_tape_reader', avatar: '📼', followers: 22_000 }, { name: 'curve_surfer', avatar: '🏄', followers: 11_800 },
  { name: 'bonded_and_based', avatar: '🧱', followers: 18_300 }, { name: 'meta_weatherman', avatar: '🌦️', followers: 27_500 }, { name: 'holder_count', avatar: '🧮', followers: 9_600 },
  { name: 'wallet_watching', avatar: '👁️', followers: 31_000 }, { name: 'first_candle', avatar: '🕐', followers: 12_400 }, { name: 'midcurve_mel', avatar: '📊', followers: 16_900 },
  { name: 'narrative_nat', avatar: '🧵', followers: 24_200 }, { name: 'volume_vera', avatar: '🔊', followers: 13_700 }, { name: 'degen_almanac', avatar: '📔', followers: 19_800 },
]

/** Invented outlets for news-style developments. */
export const OUTLETS = ['The Daily Wick', 'Mempool Gazette', 'The Degen Dispatch', 'Candle Report', 'Trench Weekly', 'The Bonding Bulletin']
/** Invented shops and brands for "partnership" developments. Made-up names only. */
export const BRANDS = ['Moonwich Deli', 'Ribbit Bank', 'Bag & Bucket Burgers', 'Giga Gym', 'Wick Coffee Roasters', 'Trench TV', 'Paperhand Paper Co.', 'Slippage Skate Shop']

/**
 * What gets said. `{T}` = $TICKER, `{N}` = the coin's name, `{M}` = its market cap, `{X}` = how far it has run since
 * the story began ("3.2x"), `{W}` = its theme word ("frog"), `{O}` = an outlet, `{B}` = a brand.
 * A line that needs `{W}` is only used for a coin whose theme is known. A line that starts with `[kind]` refers back
 * to something: it is only used when a beat of that kind is on the coin's story already (the mark is not shown).
 */
export const STORY_TEXT: Record<BeatKind, string[]> = {
  post: [
    '{T} sitting at {M} and nobody is talking about it', 'found {T} early. chart is clean so far', 'ok who else is seeing {T}', '{T} has that look. small bag, see what happens',
    '{N}. that is the post', 'the {W} meta is not done. {T} is my pick', '{T} buyers keep stepping in at the same level', '{T} holders are not selling. interesting',
    '{T} is getting passed around the group chats', 'been watching {T} for a while. it does not want to go down', '{T} up {X} since i first posted it and it still feels early',
    'thread: why {T} could be the {W} coin of the week (1/7)', 'every {W} coin is moving and {T} has the best name', '{T} at {M}. writing this down so i can be mad later',
    'ok {T} again. somebody keeps buying the dips', 'my whole feed is {T} and i only follow twelve people', '{T} chart looks like stairs. i like stairs', 'checked the {T} holders list. nobody big has sold',
    'not saying {T} is the one. saying i have seen worse at ten times the price', '{T} volume just woke up', 'sold {T} too early once already today. back in',
  ],
  rumor: [
    'hearing a big caller is looking at {T}. nfa', 'word in the chats: the {T} dev is about to lock the bag', 'someone big is quietly building a {T} position. the tape does not lie',
    'somebody in a caller chat leaked {T} as tomorrow\'s pick', 'the {T} dev was seen in a much bigger project\'s chat. make of that what you will',
    'word is {O} is writing something on {T}', 'unconfirmed, but a known wallet rotated into {T} an hour ago', 'people in the {T} chat say a listing page is coming. source: trust me',
  ],
  call: [
    '{T}. this is the one i have been waiting for. in size', 'NEW CALL: {T} at {M}. you know what to do', 'adding {T} to the list. the chart, the name, the timing',
    'calling it: {T} is the {W} coin that sticks', '{T} is my biggest bag as of five minutes ago', 'not financial advice but i am not selling {T} under {M} times ten',
  ],
  news: [
    '{O}: "{N} is the coin everybody suddenly has an opinion about"', '{O} ran a piece on {T}: "from nothing to {M} in an afternoon"', '{O} put {T} on its front page',
    '{O}: "the {W} trade has a new favourite, and it is called {N}"',
  ],
  partner: [
    '{T} team says {B} will take it at the counter. yes, really', '{B} changed its avatar to the {T} mascot', '{T} x {B}: a collab nobody asked for and everybody is buying',
    '{B} is giving away {T} with every order this week',
  ],
  trend: ['{T} is the top trending coin on the timeline', 'everybody is posting {N} memes', '{T} just hit the front page', 'you cannot open the app without seeing {T}'],
  drama: [
    'a big holder of {T} is accused of dumping on the community', '[partner]that {T} "partnership" was made up. {B} says they have never heard of it', '[call]the {T} caller deleted the post and went quiet',
    'the {T} telegram is at war with itself', 'screenshots going around: the {T} dev wallet is linked to three dead coins', 'the {T} thread got ratioed. people are calling it exit liquidity', 'a wallet tied to the {T} posts sold into every one of them. receipts are going around',
    '{T} mods are banning anyone who asks about the dev bag',
  ],
  fade: ['the timeline has moved on from {T}', 'the {T} chat went quiet', 'nobody is posting about {T} any more', '{T} is yesterday\'s coin already'],
  // The market's own beats are worded in the story engine (they carry numbers).
  bigbuy: [], bigsell: [], enter: [], exit: [], volume: [], milestone: [], dev: [], warn: [],
  theme: [], // outside data, worded in the story engine with its date
}

/** Lines only a story of this kind uses, tried before the general ones. */
export const ARC_TEXT: Partial<Record<StoryArc, Partial<Record<BeatKind, string[]>>>> = {
  community: {
    post: ['{T} dev left, so the holders are taking it over. new chat is live', 'community takeover on {T}. same bags, new management', '{T} holders are raiding every reply section today', 'the {T} community made a site in an afternoon. it is better than most'],
    drama: ['the {T} takeover team is fighting over who holds the socials', 'half the {T} "community" turned out to be one person with eleven accounts'],
  },
  builder: {
    post: ['the dev of {T} shipped a site and it is actually good', '{T} dev is still in the chat answering questions. rare', '{T} dev burned part of the bag. it is on-chain', 'the dev of {T} is doing a live space right now'],
    rumor: ['people say the {T} dev has something to announce tonight', 'the {T} dev keeps hinting at a second thing. people are front-running it'],
    drama: ['the {T} dev went silent the minute the chart turned', '[rumor]the big {T} announcement was a sticker pack'],
  },
  whale: {
    post: ['one wallet has been buying {T} on every dip for an hour', 'a whale just made {T} its biggest bag', 'the top {T} holder has not sold a single coin', 'somebody is absorbing every {T} sell. watch the tape'],
    drama: ['the {T} whale just sent half the bag to a fresh wallet', 'that {T} whale is the same wallet that topped the last three runners'],
  },
  caller: {
    rumor: ['a caller with a real following just followed the {T} account', 'the {T} ticker showed up in a big caller\'s likes'],
  },
  meme: {
    post: ['the {N} meme is everywhere today', 'made a {N} edit and it has more likes than anything i have posted', 'the {W} posting is out of control and {T} is the reason'],
  },
}
