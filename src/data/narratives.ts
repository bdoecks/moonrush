import type { Narrative } from '../types'

// Fictional meme narratives. One of them is the "meta" at any time, and launches that match it get extra hype.
export const NARRATIVES: { id: Narrative; label: string; icon: string }[] = [
  { id: 'dogs', label: 'Dogs', icon: '🐕' },
  { id: 'cats', label: 'Cats', icon: '🐈' },
  { id: 'frogs', label: 'Frogs', icon: '🐸' },
  { id: 'ai', label: 'AI Agents', icon: '🤖' },
  { id: 'food', label: 'Food', icon: '🍔' },
  { id: 'space', label: 'Space', icon: '🚀' },
  { id: 'absurd', label: 'Absurdist', icon: '🫠' },
  { id: 'retro', label: 'Retro Games', icon: '👾' },
]

export const narrativeLabel = (n?: Narrative) => NARRATIVES.find((x) => x.id === n)

export const COOK_EMOJIS = [
  '🐶', '🐱', '🐸', '🤖', '🍕', '🚀', '🫠', '👾', '🦊', '🐼', '🐧', '🦄', '🐙', '🦖', '🐝', '🦍',
  '🍩', '🌮', '🍄', '🌶️', '🥑', '🧀', '🌙', '⭐', '🔥', '💎', '👑', '🎩', '🗿', '💀', '👽', '🤡',
  '🧠', '🍌', '🥷', '🧙', '🪩', '🎲', '⚡', '🌈',
]
