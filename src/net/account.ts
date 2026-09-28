// MOONRUSH accounts (Supabase). Signing in claims your username and syncs your progress (XP, season, badges,
// social following, rewards, settings) between devices. Rounds themselves stay on the device you play them on.
import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { levelFromXp } from '../game/progression'
import { seasonNumber } from '../game/season'
import { useGame } from '../game/store'
import type { Profile, RewardsState, Settings } from '../types'
import { load, save } from '../utils/storage'
import { supabase } from './supabase'
import { USERNAME_RE } from './supabaseConfig'

export interface AccountProfile {
  username: string
  avatar: string
}

interface AccountState {
  status: 'off' | 'loading' | 'guest' | 'signedIn'
  userId: string | null
  email: string | null
  profile: AccountProfile | null
  syncedAt: number | null
  syncError: string | null
}

export const useAccount = create<AccountState>(() => ({
  status: supabase ? 'loading' : 'off',
  userId: null,
  email: null,
  profile: null,
  syncedAt: null,
  syncError: null,
}))

interface CloudSave {
  profile: Profile
  rewards: RewardsState | null
  settings: Partial<Settings> | null
  updated_at: string
}

const SYNC_MS = 15_000
let syncTimer: ReturnType<typeof setTimeout> | null = null
let unsubStore: (() => void) | null = null
let applying = false // while we write cloud data into the game, don't echo it back

/** Your multiplayer id while signed in: the same on every device. */
export function accountPlayerId(): string | null {
  const id = useAccount.getState().userId
  return id ? `u-${id}` : null
}

/** Your login token, sent to the room server so it can confirm who you are. */
export async function accessToken(): Promise<string | undefined> {
  if (!supabase) return undefined
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token
}

/** Run `fn` once we know whether you're signed in (right away if accounts are off). Returns a cancel. */
export function whenAccountReady(fn: () => void): () => void {
  if (useAccount.getState().status !== 'loading') {
    fn()
    return () => {}
  }
  let done = false
  const unsub = useAccount.subscribe((s) => {
    if (done || s.status === 'loading') return
    done = true
    unsub()
    fn()
  })
  return () => {
    done = true
    unsub()
  }
}

// ─── Start-up ────────────────────────────────────────────────────────────────
export function initAccount() {
  if (!supabase) return
  supabase.auth.getSession().then(({ data }) => (data.session ? onSignedIn(data.session) : useAccount.setState({ status: 'guest' })))
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') onSignedOut()
    else if (event === 'SIGNED_IN' && session && session.user.id !== useAccount.getState().userId) onSignedIn(session)
  })
}

// ─── Sign up / in / out ──────────────────────────────────────────────────────
export async function usernameTaken(username: string): Promise<boolean> {
  if (!supabase) return false
  const { data } = await supabase.from('profiles').select('id').ilike('username', username.replace(/_/g, '\\_')).limit(1)
  return !!data?.length
}

export async function signUp(o: { email: string; password: string; username: string; avatar: string }): Promise<{ ok: boolean; error?: string; confirm?: boolean }> {
  if (!supabase) return { ok: false, error: 'Accounts are not available here' }
  const username = o.username.trim()
  if (!USERNAME_RE.test(username)) return { ok: false, error: 'Username: 3-16 letters, numbers or _' }
  if (o.password.length < 6) return { ok: false, error: 'Password needs at least 6 characters' }
  if (await usernameTaken(username)) return { ok: false, error: `"${username}" is taken. Pick another name.` }
  const { data, error } = await supabase.auth.signUp({ email: o.email.trim(), password: o.password, options: { data: { username, avatar: o.avatar } } })
  if (error) return { ok: false, error: friendly(error.message) }
  // With "Confirm email" on, there's no session until they click the link in their inbox.
  if (!data.session) return { ok: true, confirm: true }
  return { ok: true }
}

export async function signIn(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Accounts are not available here' }
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  return error ? { ok: false, error: friendly(error.message) } : { ok: true }
}

export async function signOut() {
  await flushSync()
  await supabase?.auth.signOut()
}

export async function resetPassword(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false }
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin })
  return error ? { ok: false, error: friendly(error.message) } : { ok: true }
}

/** Change your avatar (your username is permanent). */
export async function setAvatar(avatar: string) {
  const s = useAccount.getState()
  if (!supabase || !s.userId || !s.profile) return
  useAccount.setState({ profile: { ...s.profile, avatar } })
  save('mpAvatar', avatar)
  await supabase.from('profiles').update({ avatar, updated_at: new Date().toISOString() }).eq('id', s.userId)
}

function friendly(msg: string) {
  if (/invalid login/i.test(msg)) return 'Wrong email or password'
  if (/already registered/i.test(msg)) return 'That email already has an account. Sign in instead.'
  if (/rate limit/i.test(msg)) return 'Too many tries. Wait a minute and try again.'
  if (/email not confirmed/i.test(msg)) return 'Confirm your email first (check your inbox)'
  return msg
}

// ─── Signed in: load the cloud save, keep it in sync ─────────────────────────
async function onSignedIn(session: Session) {
  if (!supabase) return
  const uid = session.user.id
  useAccount.setState({ status: 'loading', userId: uid, email: session.user.email ?? null })

  // Your player card (created on first sign-in from what you picked when signing up).
  let { data: prof } = await supabase.from('profiles').select('username, avatar').eq('id', uid).maybeSingle()
  if (!prof) {
    const meta = session.user.user_metadata as { username?: string; avatar?: string }
    const username = meta.username && USERNAME_RE.test(meta.username) ? meta.username : `player_${uid.slice(0, 6)}`
    const row = { id: uid, username, avatar: meta.avatar || '🐸', level: levelFromXp(useGame.getState().profile.xp).level }
    const { error } = await supabase.from('profiles').insert(row)
    if (error && !/duplicate/i.test(error.message)) useAccount.setState({ syncError: error.message })
    prof = { username: row.username, avatar: row.avatar }
  }
  // Rooms and posts use your account name.
  save('mpName', prof.username)
  save('mpAvatar', prof.avatar)

  // Progress: this device's progress vs the cloud's.
  const { data: cloud } = await supabase.from('saves').select('profile, rewards, settings, updated_at').eq('user_id', uid).maybeSingle<CloudSave>()
  const owner = load<string>('accountOwner') // whose progress is on this device
  const local = useGame.getState().profile
  const foreign = !!owner && owner !== uid // another account's progress is on this device
  let push = !cloud
  if (cloud) {
    // Take the cloud save if it's further along (or this device holds someone else's); otherwise this device wins.
    if (foreign || (cloud.profile?.xp ?? 0) >= (local.xp ?? 0)) applyCloud(cloud)
    else push = true
  }
  save('accountOwner', uid)
  useAccount.setState({ status: 'signedIn', profile: prof, syncError: null })
  if (push) await flushSync()
  else useAccount.setState({ syncedAt: Date.now() })
  watchStore()
}

function onSignedOut() {
  unsubStore?.()
  unsubStore = null
  if (syncTimer) clearTimeout(syncTimer)
  useAccount.setState({ status: 'guest', userId: null, email: null, profile: null, syncedAt: null, syncError: null })
}

function applyCloud(c: CloudSave) {
  applying = true
  const g = useGame.getState()
  const profile = { ...g.profile, ...c.profile }
  const rewards = c.rewards ? { ...g.rewards, ...c.rewards } : g.rewards
  // Device-only settings (window layout) stay; game settings come from the cloud.
  const settings = c.settings ? { ...g.settings, ...c.settings, trackerDock: g.settings.trackerDock } : g.settings
  useGame.setState({ profile, rewards, settings })
  save('profile', profile)
  save('rewards', rewards)
  save('settings', settings)
  applying = false
}

function watchStore() {
  unsubStore?.()
  unsubStore = useGame.subscribe((s, prev) => {
    if (applying) return
    if (s.profile !== prev.profile || s.rewards !== prev.rewards || s.settings !== prev.settings) scheduleSync()
  })
  window.addEventListener('pagehide', () => void flushSync())
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushSync())
}

function scheduleSync() {
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    void flushSync()
  }, SYNC_MS)
}

/** Upload your progress and refresh your public card (level, season points). */
export async function flushSync() {
  const a = useAccount.getState()
  if (!supabase || !a.userId || a.status === 'loading') return
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  const g = useGame.getState()
  const now = new Date().toISOString()
  const points = g.profile.season?.id === seasonNumber() ? g.profile.season.points : 0
  const [r1, r2] = await Promise.all([
    supabase.from('saves').upsert({ user_id: a.userId, profile: g.profile, rewards: g.rewards, settings: g.settings, updated_at: now }),
    supabase.from('profiles').update({ level: levelFromXp(g.profile.xp).level, season_points: points, updated_at: now }).eq('id', a.userId),
  ])
  const err = r1.error?.message ?? r2.error?.message ?? null
  useAccount.setState(err ? { syncError: err } : { syncedAt: Date.now(), syncError: null })
}
