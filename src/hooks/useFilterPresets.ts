import { useSyncExternalStore } from 'react'
import { BUILTIN_PRESETS, withDefaults, type FilterPreset, type TrenchFilter } from '../components/discover/trenchFilter'
import { load, save } from '../utils/storage'

// Your saved filter presets, shared by every Trenches column and the table's launchpad filter.
let custom: FilterPreset[] = (load<FilterPreset[]>('filterPresets') ?? []).map((p) => ({ ...p, filter: withDefaults(p.filter) }))
let all = [...BUILTIN_PRESETS, ...custom]
const subs = new Set<() => void>()
const emit = () => {
  all = [...BUILTIN_PRESETS, ...custom]
  save('filterPresets', custom)
  subs.forEach((f) => f())
}

export const MAX_PRESETS = 12

export function addPreset(name: string, icon: string, filter: TrenchFilter): FilterPreset {
  const p: FilterPreset = { id: `u-${Date.now().toString(36)}`, name: name.trim().slice(0, 24) || 'My preset', icon, filter: withDefaults(filter) }
  custom = [...custom.filter((x) => x.name.toLowerCase() !== p.name.toLowerCase()), p].slice(-MAX_PRESETS)
  emit()
  return p
}
export function removePreset(id: string) {
  custom = custom.filter((p) => p.id !== id)
  emit()
}

export function useFilterPresets() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => all,
  )
}
