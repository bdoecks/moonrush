// Friends list, presence (online / which room) and room invites, all through Supabase. Only signed-in players.
import { create } from 'zustand'
import { useGame } from '../game/store'
import { useAccount } from './account'
import { supabase } from './supabase'

export interface Friend {
  id: string
  username: string
  avatar: string
  level: number
  seasonPoints: number
  season: number
  lastSeen: number | null // ms
  room: string | null // their room code (friends only)
}
export interface FriendRequest {
  id: string // the other player's id
  username: string
  avatar: string
  incoming: boolean
}
export interface Invite {
  id: number
  fromId: string
  from: string
  avatar: string
  room: string
  at: number
}

interface SocialState {
  friends: Friend[]
  requests: FriendRequest[]
  invites: Invite[]
  loaded: boolean
  error: string | null
}

export const useSocial = create<SocialState>(() => ({ friends: [], requests: [], invites: [], loaded: false, error: null }))

export const ONLINE_MS = 2.5 * 60_000
export const isOnline = (f: Pick<Friend, 'lastSeen'>) => !!f.lastSeen && Date.now() - f.lastSeen < ONLINE_MS

const me = () => useAccount.getState().userId

type ProfileRow = { id: string; username: string; avatar: string; level: number; season_points: number; season?: number }

/** Reload friends, requests and invites. */
export async function loadSocial() {
  const uid = me()
  if (!supabase || !uid) return
  const { data: rows, error } = await supabase.from('friends').select('user_id, friend_id, status')
  if (error) return useSocial.setState({ error: error.message, loaded: true })
  const other = (r: { user_id: string; friend_id: string }) => (r.user_id === uid ? r.friend_id : r.user_id)
  const ids = [...new Set((rows ?? []).map(other))]
  const [{ data: profs }, { data: pres }, { data: inv }] = await Promise.all([
    ids.length ? supabase.from('profiles').select('*').in('id', ids) : Promise.resolve({ data: [] as ProfileRow[] }),
    ids.length ? supabase.from('presence').select('user_id, last_seen, room').in('user_id', ids) : Promise.resolve({ data: [] as { user_id: string; last_seen: string; room: string | null }[] }),
    supabase.from('invites').select('id, from_id, room, created_at').eq('to_id', uid).gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString()),
  ])
  const pmap = new Map(((profs ?? []) as ProfileRow[]).map((p) => [p.id, p]))
  const presence = new Map(((pres ?? []) as { user_id: string; last_seen: string; room: string | null }[]).map((p) => [p.user_id, p]))
  const friends: Friend[] = []
  const requests: FriendRequest[] = []
  for (const r of rows ?? []) {
    const id = other(r)
    const p = pmap.get(id)
    if (!p) continue
    if (r.status === 'accepted') {
      const pr = presence.get(id)
      friends.push({ id, username: p.username, avatar: p.avatar, level: p.level, seasonPoints: p.season_points, season: p.season ?? 0, lastSeen: pr ? Date.parse(pr.last_seen) : null, room: pr?.room ?? null })
    } else requests.push({ id, username: p.username, avatar: p.avatar, incoming: r.friend_id === uid })
  }
  friends.sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
  // New invites pop up once.
  const prev = new Set(useSocial.getState().invites.map((i) => i.id))
  const invites: Invite[] = ((inv ?? []) as { id: number; from_id: string; room: string; created_at: string }[]).map((i) => {
    const f = friends.find((x) => x.id === i.from_id)
    return { id: i.id, fromId: i.from_id, from: f?.username ?? 'A friend', avatar: f?.avatar ?? '🎮', room: i.room, at: Date.parse(i.created_at) }
  })
  for (const i of invites) if (!prev.has(i.id) && useSocial.getState().loaded) useGame.getState().notify({ title: '🎮 ROOM INVITE', body: `${i.from} invited you to room ${i.room}. Open 👥 Friends to join.`, tone: 'info', icon: i.avatar }, 'alert')
  useSocial.setState({ friends, requests, invites, loaded: true, error: null })
}

export async function sendRequest(username: string): Promise<string | null> {
  const uid = me()
  if (!supabase || !uid) return 'Sign in first'
  const name = username.trim()
  const { data: p } = await supabase.from('profiles').select('id, username').ilike('username', name.replace(/_/g, '\\_')).maybeSingle()
  if (!p) return `No player called "${name}"`
  if (p.id === uid) return "That's you"
  // They already asked you: just accept theirs.
  const theirs = useSocial.getState().requests.find((r) => r.id === p.id && r.incoming)
  if (theirs) return acceptRequest(p.id)
  const { error } = await supabase.from('friends').insert({ user_id: uid, friend_id: p.id })
  await loadSocial()
  return error ? (/duplicate/i.test(error.message) ? 'Request already sent' : error.message) : null
}

export async function acceptRequest(fromId: string): Promise<string | null> {
  const uid = me()
  if (!supabase || !uid) return 'Sign in first'
  const { error } = await supabase.from('friends').update({ status: 'accepted' }).eq('user_id', fromId).eq('friend_id', uid)
  await loadSocial()
  return error?.message ?? null
}

/** Decline a request, cancel yours, or unfriend. */
export async function removeFriend(otherId: string): Promise<string | null> {
  const uid = me()
  if (!supabase || !uid) return 'Sign in first'
  const { error } = await supabase.from('friends').delete().or(`and(user_id.eq.${uid},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${uid})`)
  await loadSocial()
  return error?.message ?? null
}

export async function inviteFriend(friendId: string): Promise<string | null> {
  const uid = me()
  const room = useGame.getState().online?.code
  if (!supabase || !uid) return 'Sign in first'
  if (!room) return 'Make or join a room first'
  const { error } = await supabase.from('invites').insert({ from_id: uid, to_id: friendId, room })
  return error?.message ?? null
}

export async function clearInvite(id: number) {
  if (!supabase) return
  await supabase.from('invites').delete().eq('id', id)
  useSocial.setState({ invites: useSocial.getState().invites.filter((i) => i.id !== id) })
}

/** You're online (and in this room), every ~45s while signed in; friends refresh every ~20s. */
async function heartbeat() {
  const uid = me()
  if (!supabase || !uid) return
  await supabase.from('presence').upsert({ user_id: uid, last_seen: new Date().toISOString(), room: useGame.getState().online?.code ?? null })
}

let timers: ReturnType<typeof setInterval>[] = []
let unsubRoom: (() => void) | null = null

function startSocial() {
  stopSocial()
  void heartbeat()
  void loadSocial()
  timers = [setInterval(() => void heartbeat(), 45_000), setInterval(() => void loadSocial(), 20_000)]
  // Tell friends right away when you join or leave a room.
  let lastRoom = useGame.getState().online?.code
  unsubRoom = useGame.subscribe((s) => {
    const room = s.online?.code
    if (room !== lastRoom) {
      lastRoom = room
      void heartbeat()
    }
  })
}

function stopSocial() {
  timers.forEach(clearInterval)
  timers = []
  unsubRoom?.()
  unsubRoom = null
  useSocial.setState({ friends: [], requests: [], invites: [], loaded: false })
}

/** Friends run while you're signed in. Call once at start-up. */
export function initSocial() {
  let on = false
  const sync = () => {
    const signed = useAccount.getState().status === 'signedIn'
    if (signed && !on) startSocial()
    if (!signed && on) stopSocial()
    on = signed
  }
  sync()
  useAccount.subscribe(sync)
}
