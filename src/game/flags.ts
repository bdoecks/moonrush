// Game switches the admin flips live from the admin panel (stored in Supabase `app_flags`, read by every game and
// refreshed every minute). Until they load, the safe defaults below apply.
import { create } from 'zustand'
import { supabase } from '../net/supabase'

export interface GameFlags {
  events: boolean // market events feed (off: showing announced pumps looked like free money)
  eventPopups: boolean // market event pop-ups (rug warnings for your own bags always show)
  multiplayer: boolean // "Play with friends"
  world: boolean // "MOONRUSH World" (off: only admins see it, until launch day)
  notice: string // banner at the top for everyone ('' = none)
}

export const DEFAULT_FLAGS: GameFlags = { events: false, eventPopups: false, multiplayer: true, world: false, notice: '' }

export const useFlags = create<GameFlags & { loaded: boolean }>(() => ({ ...DEFAULT_FLAGS, loaded: false }))

export async function loadFlags() {
  if (!supabase) return
  const { data } = await supabase.from('app_flags').select('key, value')
  if (!data) return
  const next: Partial<GameFlags> = {}
  for (const row of data as { key: keyof GameFlags; value: never }[]) if (row.key in DEFAULT_FLAGS) next[row.key] = row.value
  useFlags.setState({ ...next, loaded: true })
}

let timer: ReturnType<typeof setInterval> | null = null
export function watchFlags() {
  void loadFlags()
  if (!timer) timer = setInterval(() => void loadFlags(), 60_000)
}

/** Admin only (the database refuses anyone else). */
export async function setFlag<K extends keyof GameFlags>(key: K, value: GameFlags[K]) {
  if (!supabase) return 'Accounts are off'
  const { error } = await supabase.from('app_flags').upsert({ key, value, updated_at: new Date().toISOString() })
  if (!error) useFlags.setState({ [key]: value } as Partial<GameFlags>)
  return error?.message ?? null
}
