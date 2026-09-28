import clsx from 'clsx'
import { CheckCircle2, CloudOff, LogIn, LogOut, UserRound } from 'lucide-react'
import { useState } from 'react'
import { levelFromXp } from '../game/progression'
import { useGame } from '../game/store'
import { resetPassword, setAvatar, signIn, signOut, signUp, useAccount } from '../net/account'
import { USERNAME_RE } from '../net/supabaseConfig'
import { fmtAge } from '../utils/format'
import { Modal } from './ui'

export const AVATARS = ['🐸', '🐶', '🐱', '🦊', '🐼', '🐵', '🦍', '🐳', '🦄', '🤖', '👽', '🧙', '🥷', '🤠', '🦈', '🐙']

/** Top-bar button: your account (or "Sign in"). */
export function AccountButton() {
  const status = useAccount((s) => s.status)
  const profile = useAccount((s) => s.profile)
  const [open, setOpen] = useState(false)
  if (status === 'off') return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={profile ? `Signed in as ${profile.username}` : 'Sign in to save your progress online'}
        className={clsx('flex h-7 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold', profile ? 'border-line2 text-ink hover:border-accent/40' : 'border-accent/50 text-accent hover:bg-accent/10')}
      >
        {profile ? <><span className="text-[13px]">{profile.avatar}</span><span className="hidden max-w-[90px] truncate sm:inline">{profile.username}</span></> : status === 'loading' ? <UserRound size={13} className="animate-pulse" /> : <><LogIn size={12} /><span className="hidden sm:inline">Sign in</span></>}
      </button>
      {open && <AccountModal onClose={() => setOpen(false)} />}
    </>
  )
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const profile = useAccount((s) => s.profile)
  return (
    <Modal title={<span className="flex items-center gap-2"><UserRound size={15} className="text-accent" /> {profile ? 'Your account' : 'Sign in to MOONRUSH'}</span>} onClose={onClose}>
      {profile ? <Signed onClose={onClose} /> : <AuthForm onDone={onClose} />}
    </Modal>
  )
}

function Signed({ onClose }: { onClose: () => void }) {
  const a = useAccount()
  const xp = useGame((s) => s.profile.xp)
  const online = useGame((s) => !!s.online)
  const [now] = useState(() => Date.now())
  if (!a.profile) return null
  return (
    <div className="space-y-4 text-[12px]">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-raise text-[26px] ring-2 ring-accent/50">{a.profile.avatar}</span>
        <div>
          <div className="font-display text-[18px] font-bold">{a.profile.username}</div>
          <div className="text-dim">{a.email} · Lv {levelFromXp(xp).level}</div>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold text-muted">Avatar</div>
        <div className="flex flex-wrap gap-1">
          {AVATARS.map((em) => (
            <button key={em} onClick={() => setAvatar(em)} aria-pressed={a.profile!.avatar === em} className={clsx('grid size-8 place-items-center rounded text-[17px]', a.profile!.avatar === em ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-raise')}>{em}</button>
          ))}
        </div>
        {online && <p className="mt-1 text-[10px] text-dim">A new avatar shows in rooms the next time you join one.</p>}
      </div>
      <div className={clsx('flex items-center gap-2 rounded-md px-3 py-2', a.syncError ? 'bg-down/10 text-down' : 'bg-bg text-muted')}>
        {a.syncError ? <CloudOff size={14} /> : <CheckCircle2 size={14} className="text-up" />}
        {a.syncError ? `Couldn't sync: ${a.syncError}` : a.syncedAt ? `Progress saved online · ${fmtAge(Math.max(0, (now - a.syncedAt) / 1000))} ago` : 'Syncing…'}
      </div>
      <p className="text-[11px] leading-snug text-dim">Your XP, level, season rank, badges, social following, rewards and settings follow you to any device you sign in on. Rounds you're playing stay on this device.</p>
      <button onClick={async () => { await signOut(); onClose() }} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:text-ink">
        <LogOut size={13} /> Sign out
      </button>
    </div>
  )
}

function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('up')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [avatar, setAv] = useState(AVATARS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const input = 'h-9 w-full rounded-md border border-line2 bg-bg px-2 text-[13px] outline-none focus:border-accent/60'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNote('')
    setBusy(true)
    try {
      if (mode === 'reset') {
        const r = await resetPassword(email)
        if (r.ok) setNote('Check your email for a link to set a new password.')
        else setError(r.error ?? 'Something went wrong')
      } else if (mode === 'in') {
        const r = await signIn(email, password)
        if (r.ok) onDone()
        else setError(r.error ?? 'Could not sign in')
      } else {
        const r = await signUp({ email, password, username, avatar })
        if (!r.ok) setError(r.error ?? 'Could not create the account')
        else if (r.confirm) setNote('Almost done: check your email and click the link to confirm, then sign in here.')
        else onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-[12px]">
      {mode !== 'reset' && (
        <div className="flex gap-1 rounded-md bg-bg p-0.5">
          {(['up', 'in'] as const).map((m) => (
            <button type="button" key={m} onClick={() => { setMode(m); setError(''); setNote('') }} className={clsx('h-8 flex-1 rounded text-[12px] font-bold', mode === m ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
              {m === 'up' ? 'Create account' : 'Sign in'}
            </button>
          ))}
        </div>
      )}
      {mode === 'up' && (
        <>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-muted">Username <span className="font-normal text-dim">(your name in rooms and on leaderboards; can't be changed)</span></span>
            <div className="flex gap-2">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-raise text-[20px]">{avatar}</span>
              <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16))} placeholder="DegenDave" className={input} autoComplete="username" required />
            </div>
            {username && !USERNAME_RE.test(username) && <span className="mt-0.5 block text-[10px] text-warn">3-16 letters, numbers or _</span>}
          </label>
          <div className="flex flex-wrap gap-1">
            {AVATARS.map((em) => (
              <button type="button" key={em} onClick={() => setAv(em)} aria-pressed={avatar === em} className={clsx('grid size-7 place-items-center rounded text-[15px]', avatar === em ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-raise')}>{em}</button>
            ))}
          </div>
        </>
      )}
      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold text-muted">Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} autoComplete="email" required />
      </label>
      {mode !== 'reset' && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-muted">Password {mode === 'up' && <span className="font-normal text-dim">(6+ characters)</span>}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} minLength={6} required />
        </label>
      )}
      {error && <p className="rounded-md border border-down/40 bg-down/10 px-2 py-1.5 text-down">{error}</p>}
      {note && <p className="rounded-md border border-up/40 bg-up/10 px-2 py-1.5 text-up">{note}</p>}
      <button type="submit" disabled={busy} className="h-10 w-full rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-50">
        {busy ? '…' : mode === 'up' ? 'Create account' : mode === 'in' ? 'Sign in' : 'Send reset link'}
      </button>
      <div className="flex justify-between text-[11px] text-dim">
        {mode === 'reset' ? <button type="button" onClick={() => setMode('in')} className="underline hover:text-ink">Back to sign in</button> : <button type="button" onClick={() => setMode('reset')} className="underline hover:text-ink">Forgot password?</button>}
        <span>Your progress on this device comes with you.</span>
      </div>
    </form>
  )
}
