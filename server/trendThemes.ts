// Which real pump.fun trends the World's chef bots may launch coins about. Real launch names follow whatever is
// trending on X, which includes real people, brands, politics and worse, so this is an allow-list, not a block-list:
// a trend only becomes a coin idea if its word is one of these meme-friendly themes. Words that name a real person,
// company, product, character or belief are deliberately not here; don't add any.
import type { Narrative } from '../src/types'

const THEMES: Record<Narrative, string[]> = {
  dogs: ['dog', 'doggo', 'puppy', 'pup', 'hound', 'mutt', 'wolf', 'fox', 'coyote'],
  cats: ['cat', 'kitty', 'kitten', 'meow', 'tiger', 'lion', 'panther', 'lynx', 'cheetah'],
  frogs: ['frog', 'toad', 'ribbit', 'tadpole', 'gecko', 'lizard', 'newt', 'turtle'],
  ai: ['agent', 'bot', 'robot', 'android', 'artificial', 'neural', 'cyber', 'quantum', 'chip', 'code', 'data', 'terminal', 'compute', 'machine', 'circuit', 'algo', 'model', 'swarm'],
  food: ['pizza', 'burger', 'taco', 'sushi', 'banana', 'cookie', 'donut', 'noodle', 'ramen', 'pickle', 'cheese', 'bacon', 'coffee', 'soda', 'candy', 'cake', 'fries', 'popcorn', 'waffle', 'pancake', 'mango', 'peach', 'cherry', 'lemon', 'melon', 'egg', 'toast', 'dumpling', 'nugget'],
  space: ['moon', 'mars', 'rocket', 'star', 'comet', 'alien', 'ufo', 'galaxy', 'astronaut', 'planet', 'saturn', 'nebula', 'orbit', 'meteor', 'cosmic', 'lunar', 'solar'],
  absurd: ['horse', 'squirrel', 'mink', 'monkey', 'ape', 'bear', 'bull', 'owl', 'duck', 'penguin', 'hamster', 'rabbit', 'bunny', 'panda', 'shark', 'whale', 'fish', 'crab', 'snail', 'worm', 'goat', 'cow', 'pig', 'chicken', 'hippo', 'bird', 'raven', 'beaver', 'otter', 'sloth', 'koala', 'dragon', 'unicorn', 'goblin', 'troll', 'gremlin', 'ghost', 'zombie', 'wizard', 'ninja', 'pirate', 'knight', 'cowboy', 'clown', 'rogue', 'sword', 'potato', 'rock', 'brick', 'sock', 'cactus', 'mushroom', 'cloud', 'rainbow', 'bubble',
    // Trading-culture words (the game has no separate meme narrative).
    'chad', 'giga', 'based', 'cope', 'npc', 'sigma', 'rizz', 'chill', 'vibe', 'trench', 'trencher', 'renter', 'landlord', 'intern', 'degen', 'jeet', 'sniper', 'diamond', 'paper', 'moonboy', 'wagmi', 'frens', 'hodl', 'pump', 'bag', 'cash', 'cache', 'king', 'queen', 'hero', 'legend', 'captain', 'chef', 'bro', 'dude'],
  retro: ['pixel', 'arcade', 'retro', 'cartridge', 'joystick', 'glitch', 'floppy', 'cassette', 'console', 'quest', 'dungeon', 'boss', 'level'],
}

/** The approved theme words, each with the game narrative its coins get. */
export const SAFE_THEMES: Map<string, Narrative> = new Map(Object.entries(THEMES).flatMap(([n, words]) => words.map((w) => [w, n as Narrative])))

/** A word from a real launch name, as one of the approved themes (exact word or a simple plural), or null. */
export function themeOf(word: string): string | null {
  const w = word.toLowerCase()
  if (SAFE_THEMES.has(w)) return w
  if (w.endsWith('s') && SAFE_THEMES.has(w.slice(0, -1))) return w.slice(0, -1)
  return null
}
