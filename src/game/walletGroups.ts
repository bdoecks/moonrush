// Wallet groups (Axiom / GMGN style): name a set of your wallets, see their combined bags and PnL, and trade from
// the whole group in one click. Kept per browser; wallets that no longer exist are simply skipped.
import { create } from 'zustand'

export interface WalletGroup {
  id: string
  name: string
  emoji: string
  walletIds: string[]
}

const KEY = 'moonrush:walletGroups'
export const GROUP_EMOJIS = ['📁', '🔥', '🕶', '🎯', '🐋', '🤖', '💎', '🧪', '🚀', '🪤']

function load(): WalletGroup[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function persist(groups: WalletGroup[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(groups))
  } catch {
    /* storage blocked */
  }
}

interface GroupsState {
  groups: WalletGroup[]
  add: (name: string, emoji: string, walletIds: string[]) => string
  update: (id: string, patch: Partial<Omit<WalletGroup, 'id'>>) => void
  remove: (id: string) => void
}

export const useWalletGroups = create<GroupsState>((set, get) => ({
  groups: load(),
  add: (name, emoji, walletIds) => {
    const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    const groups = [...get().groups, { id, name: name.trim() || `Group ${get().groups.length + 1}`, emoji, walletIds }]
    set({ groups })
    persist(groups)
    return id
  },
  update: (id, patch) => {
    const groups = get().groups.map((g) => (g.id === id ? { ...g, ...patch } : g))
    set({ groups })
    persist(groups)
  },
  remove: (id) => {
    const groups = get().groups.filter((g) => g.id !== id)
    set({ groups })
    persist(groups)
  },
}))

/** The group's wallets that still exist, in your wallet order. */
export function liveIds(g: WalletGroup, accountIds: string[]) {
  return accountIds.filter((id) => g.walletIds.includes(id))
}
