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
  labs: boolean // CopyTrade, Sniper and Monitor (off: only admins see them, while they are being worked on)
  cooking: boolean // the Cooking page and launching coins (off: only admins see it, and the server refuses players' launches)
  larps: boolean // real or larp: some posts are fakes (off: only admins get it, in their own solo game with the story market)
  sparks: boolean // the story market: posts that coins get launched on (off: only admins get it, in solo play on the real-time engine)
}

export const DEFAULT_FLAGS: GameFlags = { events: false, eventPopups: false, multiplayer: true, world: false, notice: '', labs: false, cooking: false, sparks: false, larps: false }

// (`labsDev`, `sparksDev`: test copies only, so the UI bots can open the hidden pages and play the story market.
// Never set by the live game.)
export const useFlags = create<GameFlags & { loaded: boolean; labsDev?: boolean; sparksDev?: boolean }>(() => ({ ...DEFAULT_FLAGS, loaded: false }))

/** The pages behind the `labs` switch. */
export const LAB_VIEWS: readonly string[] = ['copytrade', 'sniper', 'monitor']
// Whether this player sees them right now (the switch is on, or they are an admin): kept here by the app
// (`useLabs` in hooks/useLabs.ts) for code outside React: the keyboard, and the game loop that runs copy trades and snipers.
let labsNow = false
export const labsVisible = () => labsNow
export const setLabsVisible = (v: boolean) => {
  labsNow = v
}
// The same for the Cooking page (the `cooking` switch; `useCooking` in hooks/useLabs.ts).
let cookingNow = false
export const cookingVisible = () => cookingNow
export const setCookingVisible = (v: boolean) => {
  cookingNow = v
}
// And for the story market (the `sparks` switch; `useSparks` in hooks/useLabs.ts): does this player's own game run it?
// (Solo play only. In a room and in the World the server decides, and a browser shows whatever posts it is sent.)
// `null` = not known yet: the switches are read a moment after the game starts, and a story market that was running
// in a saved game must not be closed in between (see the solo tick in store.ts).
let sparksNow: boolean | null = null
export const sparksVisible = () => sparksNow
export const setSparksVisible = (v: boolean | null) => {
  sparksNow = v
}
// …and for real or larp (the `larps` switch), the same way.
let larpsNow = false
export const larpsVisible = () => larpsNow
export const setLarpsVisible = (v: boolean) => {
  larpsNow = v
}

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
