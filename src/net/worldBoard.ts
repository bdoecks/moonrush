// The World leaderboards as last sent by the server (the network client fills this in; the Leaderboard page reads it).
import { create } from 'zustand'
import type { BoardMsg } from './protocol'

export const useWorldBoard = create<{ board: BoardMsg | null }>(() => ({ board: null }))
