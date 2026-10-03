// Rewards → Invite: your invite link, how it pays, and the friends who joined through it.
import clsx from 'clsx'
import { Check, Copy, Gift, Send, Share2, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { useAccount } from '../net/account'
import { claimInviteRewards, INVITE_MAX_PAID, INVITE_MINUTES, INVITE_REWARD, inviteLink, refreshInvites, useInvites } from '../net/invites'
import { fmtUsd } from '../utils/format'
import { AccountModal } from './Account'

const reward = fmtUsd(INVITE_REWARD, 0)

export function InviteTab() {
  const status = useAccount((s) => s.status)
  const username = useAccount((s) => s.profile?.username)
  const inv = useInvites((s) => s.status)
  const setup = useInvites((s) => s.setup)
  const pending = useInvites((s) => s.pending)
  const notify = useGame((s) => s.notify)
  const [copied, setCopied] = useState(false)
  const [signIn, setSignIn] = useState(false)
  // Fresh numbers when the page opens (and a payout check: a friend may have just hit 15 minutes).
  useEffect(() => {
    if (status !== 'signedIn') return
    void claimInviteRewards().then(refreshInvites)
    const id = setInterval(() => void refreshInvites(), 60_000)
    return () => clearInterval(id)
  }, [status])

  if (status !== 'signedIn' || !username) {
    return (
      <div className="mx-auto max-w-xl rounded-lg border border-line bg-panel p-6 text-center">
        <div className="text-[36px]">🎁</div>
        <h2 className="mt-1 font-display text-[18px] font-bold">Invite friends, both get {reward}</h2>
        <p className="mt-1 text-[12px] text-muted">
          {pending ? <>You opened <b className="text-ink">{pending}</b>’s invite link. Create an account and play {INVITE_MINUTES} minutes, and you both get {reward} in-game.</> : <>Sign in to get your own invite link. When a friend signs up through it and plays {INVITE_MINUTES} minutes, you each get {reward} in-game.</>}
        </p>
        <button onClick={() => setSignIn(true)} className="mt-3 h-9 rounded-md bg-accent px-4 text-[13px] font-bold text-accent-ink">{pending ? 'Create account' : 'Sign in'}</button>
        {signIn && <AccountModal onClose={() => setSignIn(false)} />}
      </div>
    )
  }

  const link = inviteLink(username)
  const text = `Come trade memecoins with me on MOONRUSH. Fake money, real bragging rights. We both get ${reward} in-game when you play.`
  const copy = () => {
    navigator.clipboard?.writeText(link).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    notify({ title: 'COPIED', body: 'Your invite link is copied. Send it to a friend.', tone: 'info', icon: '📋' })
  }
  const canShare = typeof navigator.share === 'function'
  const friends = inv?.friends ?? []
  const paid = friends.filter((f) => f.rewarded).length
  const earned = Math.min(paid, INVITE_MAX_PAID) * INVITE_REWARD

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="relative overflow-hidden rounded-lg border border-accent/30 bg-[radial-gradient(circle_at_0%_0%,rgba(198,255,61,0.14),transparent_55%),#0c0e11] p-4">
        <div className="flex items-center gap-2 font-display text-[18px] font-bold"><Gift size={18} className="text-accent" /> Invite a friend, you both get {reward}</div>
        <p className="mt-1 text-[12px] text-muted">Send your link. When your friend makes an account through it and plays {INVITE_MINUTES} minutes, {reward} of in-game money lands in each of your wallets. It’s a gift, so it doesn’t count as profit on the leaderboards.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="num min-w-0 flex-1 truncate rounded-md border border-line2 bg-bg px-3 py-2 text-[13px] text-ink" title={link}>{link}</div>
          <button onClick={copy} className="flex h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-[12px] font-bold text-accent-ink">{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy link'}</button>
          <a href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center gap-1.5 rounded-md border border-line2 px-3 text-[12px] font-semibold text-muted hover:text-ink"><Send size={13} /> Post on X</a>
          {canShare && <button onClick={() => void navigator.share({ text, url: link }).catch(() => {})} className="flex h-9 items-center gap-1.5 rounded-md border border-line2 px-3 text-[12px] font-semibold text-muted hover:text-ink"><Share2 size={13} /> Share…</button>}
        </div>
      </div>

      {setup && <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">One-time setup needed before invites count: run <b>supabase/007_invites.sql</b> in the Supabase SQL Editor.</div>}

      {inv?.invited_by && (
        <div className="rounded-md border border-line bg-panel px-3 py-2 text-[12px]">
          You joined through <b>{inv.invited_by}</b>’s link.{' '}
          {inv.my_rewarded ? <span className="text-up">Reward paid to both of you ✓</span> : (
            <span className="text-muted">Play {Math.max(0, INVITE_MINUTES - inv.my_minutes)} more minute{INVITE_MINUTES - inv.my_minutes === 1 ? '' : 's'} and you both get {reward}.
              <span className="ml-2 inline-block h-1.5 w-28 overflow-hidden rounded-full bg-line2 align-middle"><span className="block h-full bg-accent" style={{ width: `${Math.min(100, (inv.my_minutes / INVITE_MINUTES) * 100)}%` }} /></span>
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Tile label="Friends joined" value={String(friends.length)} />
        <Tile label="Rewards paid" value={`${paid}${paid > INVITE_MAX_PAID ? ` (first ${INVITE_MAX_PAID} pay)` : ''}`} />
        <Tile label="You earned" value={fmtUsd(earned, 0)} tone />
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] font-bold"><Users size={13} /> Your friends</div>
        {!friends.length ? (
          <div className="p-6 text-center text-[12px] text-dim">Nobody has joined through your link yet. Send it to a friend, or share one of your wins: the Share window carries your link too.</div>
        ) : friends.map((f) => (
          <div key={f.name} className="flex items-center gap-2 border-b border-line/40 px-3 py-2 text-[12px] last:border-0">
            <span className="grid size-7 place-items-center rounded-md bg-raise text-[15px]">{f.avatar}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{f.name}</span><span className="text-[10px] text-dim">joined {new Date(f.joined).toLocaleDateString()}</span></span>
            {f.rewarded ? <span className="rounded bg-up/10 px-2 py-0.5 text-[11px] font-bold text-up">+{reward} paid</span> : (
              <span className="flex items-center gap-2 text-[11px] text-muted">
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line2"><span className={clsx('block h-full bg-accent')} style={{ width: `${Math.min(100, (f.minutes / INVITE_MINUTES) * 100)}%` }} /></span>
                <span className="num">{f.minutes}/{INVITE_MINUTES} min played</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-dim">Links are for brand-new accounts. You’re paid for your first {INVITE_MAX_PAID} friends; every friend still gets their own {reward}. Simulated game, virtual money.</p>
    </div>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-dim">{label}</div>
      <div className={clsx('num mt-0.5 text-[17px] font-bold', tone ? 'text-up' : 'text-ink')}>{value}</div>
    </div>
  )
}
