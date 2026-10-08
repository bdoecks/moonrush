// V2 stage 2: one trader picked out on a coin's chart (from the Tracked tab): only that wallet's trades and its
// average-entry line are drawn until it is let go.
import { create } from 'zustand'

interface TraderFocusState {
  focus: { tokenId: string; walletId: string } | null
  set: (f: { tokenId: string; walletId: string } | null) => void
}

export const useTraderFocus = create<TraderFocusState>((set) => ({ focus: null, set: (focus) => set({ focus }) }))

/** The wallet picked out on this coin, if any. */
export const focusFor = (f: TraderFocusState['focus'], tokenId: string) => (f && f.tokenId === tokenId ? f.walletId : null)
