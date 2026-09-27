// Axiom-style: a Trades side panel next to the chart, and clicking a candle narrows the trades to that candle.
import { create } from 'zustand'
import { load, save } from '../../utils/storage'

export interface CandlePick {
  tokenId: string
  from: number // market time the candle opens
  to: number // exclusive
  tf: string
}

interface TradePickState {
  open: boolean
  pick: CandlePick | null
  toggle: (open?: boolean) => void
  setPick: (p: CandlePick | null) => void
}

export const useTradePick = create<TradePickState>((set, get) => ({
  open: load<boolean>('tradesPanelOpen') ?? true,
  pick: null,
  toggle: (open) => {
    const next = open ?? !get().open
    set({ open: next })
    save('tradesPanelOpen', next)
  },
  setPick: (pick) => set({ pick }),
}))

/** The candle filter for this coin, if one is picked. */
export const pickFor = (p: CandlePick | null, tokenId: string) => (p && p.tokenId === tokenId ? p : null)
export const inPick = (time: number, p: CandlePick | null) => !p || (time >= p.from && time < p.to)
