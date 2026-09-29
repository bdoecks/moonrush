import clsx from 'clsx'
import { Check, Send, UserPlus, Users, X } from 'lucide-react'
import { useState } from 'react'
import { seasonNumber, tierFor } from '../game/season'
import { useGame } from '../game/store'
import { useAccount } from '../net/account'
import { joinRoom, leaveRoom, mpProfile } from '../net/client'
import { acceptRequest, clearInvite, inviteFriend, isOnline, loadSocial, removeFriend, sendRequest, useSocial, type Friend } from '../net/social'
import { fmtAge } from '../utils/format'
import { Modal } from './ui'

/** Top-bar 👥 button (signed in only): friends, with a badge for requests and invites. */
export function FriendsButton() {
  const signed = useAccount((s) => s.status === 'signedIn')
  const incoming = useSocial((s) => s.requests.filter((r) => r.incoming).length)
  const invites = useSocial((s) => s.invites.length)
  const online = useSocial((s) => s.friends.filter(isOnline).length)
  const [open, setOpen] = useState(false)
  if (!signed) return null
  const badge = incoming + invites
  return (
    <>
      <button onClick={() => setOpen(true)} title="Friends" className="relative flex h-7 items-center gap-1 rounded-md border border-line2 px-1.5 text-[11px] font-semibold text-muted hover:text-ink">
        <Users size={13} />
        {online > 0 && <span className="num text-up">{online}</span>}
        {badge > 0 && <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-down text-[9px] font-bold text-white">{badge}</span>}
      </button>
      {open && <FriendsModal onClose={() => setOpen(false)} />}
    </>
  )
}

function FriendsModal({ onClose }: { onClose: () => void }) {
  const { friends, requests, invites, error } = useSocial()
  const myRoom = useGame((s) => s.online?.code)
  const notify = useGame((s) => s.notify)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const say = (err: string | null, ok: string) => notify(err ? { title: 'FRIENDS', body: err, tone: 'warn', icon: '⚠️' } : { title: 'FRIENDS', body: ok, tone: 'info', icon: '👥' })

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const err = await sendRequest(name)
    setBusy(false)
    say(err, `Friend request sent to ${name.trim()}`)
    if (!err) setName('')
  }
  const join = async (room: string, inviteId?: number) => {
    if (room === myRoom) return onClose()
    const { name: n, avatar } = mpProfile()
    try {
      if (useGame.getState().online) leaveRoom()
      await joinRoom({ room, name: n || 'Player', avatar })
      if (inviteId) void clearInvite(inviteId)
      onClose()
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not join', '')
    }
  }
  const incoming = requests.filter((r) => r.incoming)
  const outgoing = requests.filter((r) => !r.incoming)
  const btn = 'rounded border px-2 py-0.5 text-[11px] font-semibold'

  return (
    <Modal title={<span className="flex items-center gap-2"><Users size={15} className="text-accent" /> Friends</span>} onClose={onClose}>
      <div className="space-y-3 text-[12px]">
        <form onSubmit={add} className="flex gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a friend by username" className="h-9 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 outline-none focus:border-accent/60" />
          <button disabled={busy || !name.trim()} className="flex items-center gap-1 rounded-md bg-accent px-3 font-bold text-accent-ink disabled:opacity-40"><UserPlus size={13} /> Add</button>
        </form>
        {error && <p className="text-[11px] text-down">{error}</p>}

        {invites.length > 0 && (
          <Section title={`🎮 Room invites · ${invites.length}`}>
            {invites.map((i) => (
              <Row key={i.id} avatar={i.avatar} name={i.from} sub={`invited you to room ${i.room} · ${fmtAge((Date.now() - i.at) / 1000)} ago`}>
                <button onClick={() => join(i.room, i.id)} className={clsx(btn, 'border-accent/60 bg-accent/10 text-accent')}>Join</button>
                <button onClick={() => clearInvite(i.id)} className="p-1 text-dim hover:text-ink" aria-label="Dismiss"><X size={12} /></button>
              </Row>
            ))}
          </Section>
        )}

        {incoming.length > 0 && (
          <Section title={`Requests · ${incoming.length}`}>
            {incoming.map((r) => (
              <Row key={r.id} avatar={r.avatar} name={r.username} sub="wants to be friends">
                <button onClick={async () => say(await acceptRequest(r.id), `You and ${r.username} are friends`)} className={clsx(btn, 'flex items-center gap-1 border-up/60 text-up')}><Check size={11} /> Accept</button>
                <button onClick={() => removeFriend(r.id)} className={clsx(btn, 'border-line2 text-muted')}>Decline</button>
              </Row>
            ))}
          </Section>
        )}

        <Section title={`Friends · ${friends.length}`} right={<button onClick={() => loadSocial()} className="text-[10px] text-dim hover:text-ink">Refresh</button>}>
          {!friends.length && <p className="px-1 py-2 text-[11px] text-dim">No friends yet. Add someone by their username above.</p>}
          {friends.map((f) => <FriendRow key={f.id} f={f} myRoom={myRoom} onJoin={join} say={say} />)}
        </Section>

        {outgoing.length > 0 && (
          <Section title={`Sent · ${outgoing.length}`}>
            {outgoing.map((r) => (
              <Row key={r.id} avatar={r.avatar} name={r.username} sub="waiting for them to accept">
                <button onClick={() => removeFriend(r.id)} className={clsx(btn, 'border-line2 text-muted')}>Cancel</button>
              </Row>
            ))}
          </Section>
        )}
        <p className="text-[10px] text-dim">Only your friends can see which room you're in.</p>
      </div>
    </Modal>
  )
}

function FriendRow({ f, myRoom, onJoin, say }: { f: Friend; myRoom?: string; onJoin: (room: string) => void; say: (err: string | null, ok: string) => void }) {
  const on = isOnline(f)
  const tier = tierFor(f.season === seasonNumber() ? f.seasonPoints : 0)
  const [confirm, setConfirm] = useState(false)
  const sub = on ? (f.room ? (f.room === myRoom ? 'in your room' : `in room ${f.room}`) : 'online') : f.lastSeen ? `last on ${fmtAge((Date.now() - f.lastSeen) / 1000)} ago` : 'offline'
  return (
    <Row avatar={f.avatar} name={f.username} dot={on} sub={<><span style={{ color: tier.color }}>{tier.icon} {tier.name}</span> · Lv {f.level} · {sub}</>}>
      {on && f.room && f.room !== myRoom && <button onClick={() => onJoin(f.room!)} className="rounded border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">Join</button>}
      {on && myRoom && f.room !== myRoom && (
        <button onClick={async () => say(await inviteFriend(f.id), `Invited ${f.username} to room ${myRoom}`)} className="flex items-center gap-1 rounded border border-line2 px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-ink"><Send size={10} /> Invite</button>
      )}
      {confirm ? (
        <button onClick={() => removeFriend(f.id)} className="rounded border border-down/50 px-2 py-0.5 text-[11px] font-semibold text-down">Remove?</button>
      ) : (
        <button onClick={() => setConfirm(true)} className="p-1 text-dim hover:text-down" aria-label="Remove friend" title="Remove friend"><X size={12} /></button>
      )}
    </Row>
  )
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center text-[10px] font-bold uppercase tracking-wider text-dim">{title}<span className="ml-auto normal-case">{right}</span></div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Row({ avatar, name, sub, dot, children }: { avatar: string; name: string; sub: React.ReactNode; dot?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-bg px-2 py-1.5">
      <span className="relative text-[18px]">
        {avatar}
        {dot !== undefined && <span className={clsx('absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-bg', dot ? 'bg-up' : 'bg-line2')} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{name}</span>
        <span className="block truncate text-[10px] text-dim">{sub}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </div>
  )
}
