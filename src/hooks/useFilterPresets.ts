import { useMemo, useSyncExternalStore } from 'react'
import type { Chain } from '../types'
import { BUILTIN_PRESETS, withDefaults, type FilterPreset, type TrenchFilter } from '../components/discover/trenchFilter'
import { load, save } from '../utils/storage'

// Your saved filter presets, shared by every Trenches column and the table's filter. Each chain view (ALL, SOL, BNB,
// ETH) has its own list; presets saved before that belong to ALL.
let custom: FilterPreset[] = (load<FilterPreset[]>('filterPresets') ?? []).map((p) => ({ ...p, chain: p.chain ?? 'all', filter: withDefaults(p.filter) }))
let all = [...BUILTIN_PRESETS, ...custom]
const subs = new Set<() => void>()
const emit = () => {
  all = [...BUILTIN_PRESETS, ...custom]
  save('filterPresets', custom)
  subs.forEach((f) => f())
}

export const MAX_PRESETS = 12

export function addPreset(name: string, icon: string, filter: TrenchFilter, chain: 'all' | Chain): FilterPreset {
  const p: FilterPreset = { id: `u-${Date.now().toString(36)}`, name: name.trim().slice(0, 24) || 'My preset', icon, chain, filter: withDefaults(filter) }
  const mine = custom.filter((x) => x.chain === chain && x.name.toLowerCase() !== p.name.toLowerCase())
  custom = [...custom.filter((x) => x.chain !== chain), ...[...mine, p].slice(-MAX_PRESETS)]
  emit()
  return p
}
export function removePreset(id: string) {
  custom = custom.filter((p) => p.id !== id)
  emit()
}

export function useFilterPresets(chain: 'all' | Chain) {
  const list = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => all,
  )
  return useMemo(() => list.filter((p) => (p.builtin ? !p.chain || chain === 'all' || p.chain === chain : p.chain === chain)), [list, chain])
}
