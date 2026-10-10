// Which story-market account's page is open (a click on a name in the feed opens it; see FeedExtras.tsx).
import { create } from 'zustand'
import type { SparkBy } from '../../types'

export const useAccountCard = create<{ open: SparkBy | null; show: (by: SparkBy | null) => void }>((set) => ({
  open: null,
  show: (open) => set({ open }),
}))
