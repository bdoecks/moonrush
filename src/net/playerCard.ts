// One World player's public card (their standing and main wallet), as last sent by the server. The game asks for it
// when somebody clicks a name (`openCard` in the store); the network client fills it in; `PlayerCardDrawer` shows it.
import { create } from 'zustand'
import type { PlayerCard } from './protocol'

/** `card` is undefined while the answer is on its way, and null when there is nobody by that id. */
export const usePlayerCard = create<{ id: string | null; card: PlayerCard | null | undefined }>(() => ({ id: null, card: undefined }))
