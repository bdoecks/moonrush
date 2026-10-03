// Invite links: your link is the game's address with ?ref=<your username>. A new player who opens it and signs up
// is tied to you; once they've played 15 minutes you both get an in-game gift (it arrives through the normal gift
// flow). Needs supabase/007_invites.sql; without it everything here quietly does nothing.
import { create } from 'zustand'
import { useGame } from '../game/store'
import { load, remove, save } from '../utils/storage'
import { pullGifts, useAccount } from './account'
import { supabase } from './supabase'

export const INVITE_REWARD = 1000 // USD in-game, to each of you
export const INVITE_MINUTES = 15 // the new player has to play this long first
export const INVITE_MAX_PAID = 25 // friends an inviter is paid for

const LIVE_URL = 'https://moonrush-n2ft.onrender.com'
const origin = () => (/^(localhost|127\.|\[::1\])/.test(location.hostname) ? LIVE_URL : location.origin)
/** Your invite link (your username is your code). */
export const inviteLink = (username: string) => `${origin()}/?ref=${encodeURIComponent(username)}`

export interface InviteFriend {
  name: string
  avatar: string
  joined: string
  rewarded: boolean
  minutes: number
}
export interface InviteStatus {
  invited_by: string | null
  my_minutes: number
  my_rewarded: boolean
  friends: InviteFriend[]
}
/** `status` is null until loaded; `setup` = the database part hasn't been installed yet. */
export const useInvites = create<{ status: InviteStatus | null; setup: boolean; pending: string | null }>(() => ({ status: null, setup: false, pending: load<string>('inviteRef') ?? null }))

/** On page load: remember the ?ref= code (it survives signing up) and take it out of the address bar. */
export function captureInviteCode() {
  try {
    const url = new URL(location.href)
    const code = url.searchParams.get('ref')
    if (!code) return
    if (/^[A-Za-z0-9_]{3,16}$/.test(code)) {
      save('inviteRef', code)
      useInvites.setState({ pending: code })
    }
    url.searchParams.delete('ref')
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash)
  } catch {
    /* odd address: no invite */
  }
}

const notify = (title: string, body: string, tone: 'info' | 'up' | 'warn' = 'info', icon = '🎁') => useGame.getState().notify({ title, body, tone, icon })

/** Signed in with a remembered code: accept the invite (once). */
export async function applyInvite() {
  const code = load<string>('inviteRef')
  if (!code || !supabase || useAccount.getState().status !== 'signedIn') return
  const { data, error } = await supabase.rpc('use_invite', { code })
  if (error) return // not installed yet, or offline: keep the code for next time
  const res = String(data ?? '')
  if (res === 'signin') return
  remove('inviteRef')
  useInvites.setState({ pending: null })
  if (res.startsWith('ok:')) notify('INVITE ACCEPTED', `You joined through ${res.slice(3)}'s link. Play ${INVITE_MINUTES} minutes and you both get $${INVITE_REWARD.toLocaleString('en-US')} in-game.`, 'up')
  else if (res === 'old') notify('INVITE LINK', 'Invite links are for brand-new accounts, so this one didn’t count. You can still invite friends from Rewards → Invite.', 'info', 'ℹ️')
  // unknown / self / already / loop: nothing to tell
}

/** Load what the Invite page shows. */
export async function refreshInvites() {
  if (!supabase || useAccount.getState().status !== 'signedIn') return useInvites.setState({ status: null })
  const { data, error } = await supabase.rpc('invite_status')
  if (error) return useInvites.setState({ setup: /invite_status|schema cache|does not exist/i.test(error.message) })
  const d = (data ?? {}) as Partial<InviteStatus>
  useInvites.setState({ setup: false, status: { invited_by: d.invited_by ?? null, my_minutes: Number(d.my_minutes) || 0, my_rewarded: !!d.my_rewarded, friends: (d.friends ?? []).map((f) => ({ ...f, minutes: Number(f.minutes) || 0 })) } })
}

/** Pay out any invites that are ready (yours as the new player, or your friends'). */
export async function claimInviteRewards() {
  if (!supabase || useAccount.getState().status !== 'signedIn') return
  const { data, error } = await supabase.rpc('claim_invite_rewards')
  if (error || !(Number(data) > 0)) return
  notify('INVITE REWARD 🎉', `${Number(data) > 1 ? `${data} invites` : 'An invite'} paid out: $${INVITE_REWARD.toLocaleString('en-US')} in-game is on its way to your wallet.`, 'up')
  void pullGifts()
  void refreshInvites()
}

// Signing in accepts a remembered invite and checks for rewards; after that, a check every few minutes while playing.
let timer: ReturnType<typeof setInterval> | null = null
export function startInvites() {
  captureInviteCode()
  const onStatus = (status: string) => {
    if (status !== 'signedIn') return
    void applyInvite().then(claimInviteRewards)
    if (!timer) timer = setInterval(() => void claimInviteRewards(), 5 * 60_000)
  }
  onStatus(useAccount.getState().status)
  useAccount.subscribe((s, prev) => s.status !== prev.status && onStatus(s.status))
}
