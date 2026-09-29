// Coins you've hidden from the lists (Axiom / GMGN "hide token"), remembered on this device.
import { create } from 'zustand'
import { load, save } from '../utils/storage'

interface HiddenState {
  ids: string[]
  show: boolean // show hidden coins (faded) so you can unhide them
  toggle: (id: string) => void
  setShow: (v: boolean) => void
  clear: () => void
}

export const useHidden = create<HiddenState>((set, get) => ({
  ids: load<string[]>('hiddenTokens') ?? [],
  show: false,
  toggle: (id) => {
    const ids = get().ids.includes(id) ? get().ids.filter((x) => x !== id) : [...get().ids, id].slice(-500)
    set({ ids })
    save('hiddenTokens', ids)
  },
  setShow: (show) => set({ show }),
  clear: () => {
    set({ ids: [] })
    save('hiddenTokens', [])
  },
}))

/** Drop hidden coins from a list (unless "show hidden" is on). */
export function useVisible<T extends { id: string }>(list: T[]): T[] {
  const ids = useHidden((s) => s.ids)
  const show = useHidden((s) => s.show)
  if (show || !ids.length) return list
  const hide = new Set(ids)
  return list.filter((t) => !hide.has(t.id))
}
