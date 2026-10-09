// A coin's whole chart was replaced (the real one arrived from the server after a join, a reload or opening the
// coin): the chart on screen has to draw it again from the start. Day to day a chart only adds its newest candles,
// so without this it kept showing the placeholder sketched on joining until the timeframe was changed.
import { create } from 'zustand'

export const useChartRev = create<{ revs: Record<string, number> }>(() => ({ revs: {} }))

/** Say that this coin's candles were replaced. */
export const chartReplaced = (tokenId: string) => useChartRev.setState((s) => ({ revs: { ...s.revs, [tokenId]: (s.revs[tokenId] ?? 0) + 1 } }))
