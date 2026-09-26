import type { Archetype } from '../types'

// All tokens are fictional. Any resemblance to real assets is parody.
export interface TokenSeed {
  ticker: string
  name: string
  emoji: string
  archetype: Archetype
}

export const INITIAL_TOKENS: TokenSeed[] = [
  { ticker: 'DOGE2', name: 'Doge Two Electric', emoji: '🐕', archetype: 'bluechip' },
  { ticker: 'PEPEMAX', name: 'Pepe Maximus', emoji: '🐸', archetype: 'runner' },
  { ticker: 'WOJAK', name: 'Wojak Feels', emoji: '😐', archetype: 'bleeder' },
  { ticker: 'MOONCAT', name: 'Moon Cat', emoji: '🐱', archetype: 'runner' },
  { ticker: 'RUGRAT', name: 'Rug Rat', emoji: '🐀', archetype: 'rugger' },
  { ticker: 'CHAD', name: 'Chad Coin', emoji: '🗿', archetype: 'grinder' },
  { ticker: 'BONKSTER', name: 'Bonkster', emoji: '🔨', archetype: 'chaotic' },
  { ticker: 'GIGA', name: 'Giga Brain', emoji: '🧠', archetype: 'bluechip' },
  { ticker: 'FROGGO', name: 'Froggo', emoji: '🐊', archetype: 'sleeper' },
  { ticker: 'HAMSTR', name: 'Hamster Wheel', emoji: '🐹', archetype: 'grinder' },
  { ticker: 'LAMBO', name: 'Lambo Soon', emoji: '🏎️', archetype: 'chaotic' },
  { ticker: 'WAGMI', name: 'We All Gonna', emoji: '🤝', archetype: 'sleeper' },
  { ticker: 'NGMI', name: 'Not Gonna', emoji: '🪦', archetype: 'bleeder' },
  { ticker: 'COPE', name: 'Copium Tank', emoji: '🫁', archetype: 'rugger' },
  { ticker: 'SEND', name: 'Just Send It', emoji: '📨', archetype: 'runner' },
  { ticker: 'BANANA', name: 'Banana Republic', emoji: '🍌', archetype: 'grinder' },
  { ticker: 'SHRIMP', name: 'Shrimp Army', emoji: '🦐', archetype: 'chaotic' },
  { ticker: 'TOAD', name: 'Toad Council', emoji: '🍄', archetype: 'sleeper' },
  { ticker: 'BURGR', name: 'Burger Time', emoji: '🍔', archetype: 'bleeder' },
  { ticker: 'KEKW', name: 'Kek Warriors', emoji: '😂', archetype: 'runner' },
  { ticker: 'PONZI', name: 'Totally Legit', emoji: '🎩', archetype: 'rugger' },
  { ticker: 'OWL', name: 'Night Owl', emoji: '🦉', archetype: 'bluechip' },
  { ticker: 'GOBLN', name: 'Goblin Town', emoji: '👺', archetype: 'chaotic' },
  { ticker: 'SNEK', name: 'Snek Snek', emoji: '🐍', archetype: 'grinder' },
  { ticker: 'BLOBBY', name: 'Blobby', emoji: '🫠', archetype: 'rugger' },
  { ticker: 'ZOOMR', name: 'Zoomer Juice', emoji: '⚡', archetype: 'runner' },
  { ticker: 'CRAB', name: 'Crab Market', emoji: '🦀', archetype: 'sleeper' },
  { ticker: 'VIBES', name: 'Good Vibes Only', emoji: '🌈', archetype: 'grinder' },
  { ticker: 'HODLR', name: 'Hodl Forever', emoji: '💎', archetype: 'bluechip' },
  { ticker: 'SQUID', name: 'Squid Ink', emoji: '🦑', archetype: 'rugger' },
  { ticker: 'NOODLE', name: 'Noodle Arms', emoji: '🍜', archetype: 'chaotic' },
  { ticker: 'BEEF', name: 'Beef Mode', emoji: '🥩', archetype: 'bleeder' },
  { ticker: 'ALIEN', name: 'Area 69', emoji: '👽', archetype: 'runner' },
  { ticker: 'PIGGY', name: 'Piggy Bank', emoji: '🐷', archetype: 'sleeper' },
  { ticker: 'YOLO', name: 'You Only Live', emoji: '🎲', archetype: 'chaotic' },
  { ticker: 'CLOWN', name: 'Clown World', emoji: '🤡', archetype: 'rugger' },
  { ticker: 'TURBO', name: 'Turbo Snail', emoji: '🐌', archetype: 'grinder' },
  { ticker: 'MOGGR', name: 'Mogger', emoji: '😎', archetype: 'runner' },
  { ticker: 'PEAK', name: 'Peak Brain', emoji: '🏔️', archetype: 'bleeder' },
  { ticker: 'DUCKY', name: 'Rubber Ducky', emoji: '🦆', archetype: 'sleeper' },
]

/** Names for tokens that launch during play. */
export const LAUNCH_POOL: Omit<TokenSeed, 'archetype'>[] = [
  { ticker: 'SPUDZ', name: 'Spud Lords', emoji: '🥔' },
  { ticker: 'FUDGE', name: 'Fud Fudge', emoji: '🍫' },
  { ticker: 'WIFHAT', name: 'Cat Wif Beanie', emoji: '🧢' },
  { ticker: 'BRRR', name: 'Money Printer', emoji: '🖨️' },
  { ticker: 'SIGMA', name: 'Sigma Grind', emoji: '🐺' },
  { ticker: 'NPC', name: 'Non Player', emoji: '🤖' },
  { ticker: 'GRAIL', name: 'Holy Grail', emoji: '🏆' },
  { ticker: 'TENDIE', name: 'Tendies', emoji: '🍗' },
  { ticker: 'OTTER', name: 'Otter Space', emoji: '🦦' },
  { ticker: 'BASED', name: 'Based Dept', emoji: '🧊' },
  { ticker: 'JELLY', name: 'Jelly Jam', emoji: '🪼' },
  { ticker: 'RIZZ', name: 'Unspoken Rizz', emoji: '💘' },
  { ticker: 'SKULL', name: 'Skull Emoji', emoji: '💀' },
  { ticker: 'MANGO', name: 'Mango Mania', emoji: '🥭' },
  { ticker: 'BLEEP', name: 'Bleep Bloop', emoji: '📟' },
  { ticker: 'CACTUS', name: 'Spiky Boi', emoji: '🌵' },
  { ticker: 'WHALEY', name: 'Tiny Whale', emoji: '🐳' },
  { ticker: 'PIXEL', name: 'Pixel Pup', emoji: '👾' },
  { ticker: 'SOUP', name: 'Soup Season', emoji: '🥣' },
  { ticker: 'HONK', name: 'Goose Honk', emoji: '🪿' },
  { ticker: 'BOBA', name: 'Boba Tea', emoji: '🧋' },
  { ticker: 'GLIZZY', name: 'Glizzy Gang', emoji: '🌭' },
  { ticker: 'MOTH', name: 'Lamp Moth', emoji: '🦋' },
  { ticker: 'ROCKY', name: 'Pet Rock', emoji: '🪨' },
  { ticker: 'WIZRD', name: 'Wizard Hat', emoji: '🧙' },
  { ticker: 'BUNNY', name: 'Bunny Hop', emoji: '🐰' },
  { ticker: 'NACHO', name: 'Nacho Libre', emoji: '🌮' },
  { ticker: 'ZAP', name: 'Zap Zap', emoji: '🔋' },
  { ticker: 'KOALA', name: 'Sleepy Koala', emoji: '🐨' },
  { ticker: 'DONUT', name: 'Donut Hole', emoji: '🍩' },
  { ticker: 'TACO', name: 'Taco Tues', emoji: '🌯' },
  { ticker: 'GHOST', name: 'Ghost Chain', emoji: '👻' },
  { ticker: 'PRAWN', name: 'Prawn Star', emoji: '🍤' },
  { ticker: 'MEOW', name: 'Meow Meow', emoji: '😺' },
  { ticker: 'SAUCE', name: 'Secret Sauce', emoji: '🥫' },
  { ticker: 'BEAR', name: 'Bear Hug', emoji: '🧸' },
]

// ─── Generated launch names ──────────────────────────────────────────────────
// Once the hand-written pool is used up, new launches get memecoin-style names built from these parts.
const NOUNS: [string, string][] = [
  ['Dog', '🐕'], ['Cat', '🐈'], ['Frog', '🐸'], ['Pepe', '🐸'], ['Doge', '🐶'], ['Shib', '🐕'], ['Monke', '🐒'], ['Goat', '🐐'],
  ['Penguin', '🐧'], ['Hamster', '🐹'], ['Duck', '🦆'], ['Pig', '🐷'], ['Bull', '🐂'], ['Bear', '🐻'], ['Whale', '🐋'], ['Shark', '🦈'],
  ['Dragon', '🐉'], ['Alien', '👽'], ['Robot', '🤖'], ['Ape', '🦍'], ['Cow', '🐄'], ['Owl', '🦉'], ['Fox', '🦊'], ['Wolf', '🐺'],
  ['Tiger', '🐯'], ['Panda', '🐼'], ['Sloth', '🦥'], ['Snail', '🐌'], ['Crab', '🦀'], ['Squid', '🦑'], ['Banana', '🍌'], ['Pizza', '🍕'],
  ['Burger', '🍔'], ['Cookie', '🍪'], ['Moon', '🌕'], ['Rocket', '🚀'], ['Chad', '🗿'], ['Wojak', '😐'], ['Troll', '🧌'], ['Unicorn', '🦄'],
  ['Hippo', '🦛'], ['Seal', '🦭'], ['Bee', '🐝'], ['Worm', '🪱'], ['Pickle', '🥒'], ['Egg', '🥚'], ['Cheese', '🧀'], ['Clown', '🤡'],
]
const ADJECTIVES = ['Baby', 'Mini', 'Mega', 'Giga', 'Based', 'Sad', 'Angry', 'Fat', 'Tiny', 'Sigma', 'Rich', 'Degen', 'Turbo', 'Smol', 'Chill', 'Dark', 'Cyber', 'Golden', 'Pixel', 'Lazy', 'Hyper', 'Retro', 'Space', 'Magic', 'Grumpy', 'Happy', 'Wet', 'Sleepy', 'Evil', 'Holy']
const HATS = ['Hat', 'Beanie', 'Crown', 'Knife', 'Gun', 'Cap', 'Hoodie', 'Chain']

/** A memecoin name for the n-th generated launch: "Baby Pepe" BABYPEPE, "Dog wif Crown" DOGWIF, "Turbo Inu"… */
export function generatedLaunch(n: number): Omit<TokenSeed, 'archetype'> {
  let h = (n * 2654435761) >>> 0
  const next = (k: number) => {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0
    return h % k
  }
  const [noun, emoji] = NOUNS[next(NOUNS.length)]
  const adj = ADJECTIVES[next(ADJECTIVES.length)]
  // Tickers stay within the 10 characters launchpads allow; long combos keep the noun and the adjective's initial.
  const up = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const join = (a: string, b: string) => (a.length + b.length <= 10 ? a + b : b.length < 10 ? a[0] + b : b)
  switch (next(6)) {
    case 0: return { ticker: join(up(noun), 'WIF'), name: `${noun} wif ${HATS[next(HATS.length)]}`, emoji }
    case 1: return { ticker: join(up(noun), 'INU'), name: `${noun} Inu`, emoji }
    case 2: return { ticker: join(up(noun), 'AI'), name: `${noun} AI`, emoji: next(2) ? emoji : '🤖' }
    case 3: return { ticker: up(noun), name: `The ${noun}`, emoji }
    default: return { ticker: join(up(adj), up(noun)), name: `${adj} ${noun}`, emoji }
  }
}

export const WALLET_PREFIXES = ['7xK', '9fQ', 'Bz4', 'Dm2', 'H8p', 'Kq7', 'Mv3', 'P2w', 'Rt9', 'Tz5', 'Wc1', 'Yx6', '3Nf', '5Gh', 'Aa8']
export const WALLET_SUFFIXES = ['f3a', '9kd', 'x2P', 'm8Q', 'rT4', 'zz1', 'Lp0', 'b7n', 'Q9e', 'w3W', 'J5s', 'dD6']
