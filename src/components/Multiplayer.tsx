import clsx from 'clsx'
import { Copy, Crown, EyeOff, Flag, Globe, LogOut, Send, Users, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { lengthTicks, MODES, ROUND_LENGTHS, type RoundLength } from '../game/progression'
import { useGame } from '../game/store'
import { joinRoom, joinWorld, leaveRoom, mpProfile, reportChat, sendChat, setMpProfile, startRound } from '../net/client'
import { load, save } from '../utils/storage'
import { WORLD_START_BALANCE } from '../net/protocol'
import type { GameMode, MarketEngine } from '../types'
import { EnginePicker } from './Modals'
import { fmtClock, fmtPct, fmtUsd, toneClass } from '../utils/format'
import { Modal } from './ui'

import { AccountModal, AVATARS } from './Account'
import { useAccount } from '../net/account'
const MODE_ICON: Record<GameMode, string> = { practice: '🧪', challenge: '🎯', arena: '⚔️', hardcore: '☠️' }

/** "Play with friends": create or join a room, then the room's lobby (players, chat, host starts the round). */
export function LobbyModal() {
  const online = useGame((s) => s.online)
  const setModal = useGame((s) => s.setModal)
  const runStatus = useGame((s) => s.runStatus)
  if (online?.round.world) {
    return (
      <Modal title={<span className="flex items-center gap-2"><Globe size={15} className="text-accent" /> MOONRUSH World</span>} onClose={() => setModal(null)} wide>
        <WorldPanel />
      </Modal>
    )
  }
  return (
    <Modal title={<span className="flex items-center gap-2"><Users size={15} className="text-accent" /> Play with friends</span>} onClose={() => setModal(online || runStatus !== 'select' ? null : 'mode')} wide={!!online}>
      {online ? <Room /> : <JoinForm />}
    </Modal>
  )
}

function JoinForm() {
  const setModal = useGame((s) => s.setModal)
  const saved = mpProfile()
  const account = useAccount((s) => s.profile)
  const accountsOn = useAccount((s) => s.status !== 'off')
  const [signIn, setSignIn] = useState(false)
  const [nameState, setName] = useState(saved.name)
  const [avatarState, setAvatar] = useState(saved.avatar)
  // Signed in: you play under your account name (the server checks it).
  const name = account?.username ?? nameState
  const avatar = account?.avatar ?? avatarState
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [error, setError] = useState('')
  const go = async (create: boolean) => {
    const n = name.trim()
    if (!n) return setError('Pick a name first')
    if (!create && code.trim().length !== 5) return setError('Room codes are 5 characters')
    setMpProfile(n, avatar)
    setError('')
    setBusy(create ? 'create' : 'join')
    try {
      await joinRoom({ create, room: create ? undefined : code.trim().toUpperCase(), name: n, avatar })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-muted">
        Everyone in a room trades the <b className="text-ink">same live market</b>: you'll see each other's buys on the tape, move each other's prices, and can buy (or get rugged by) each other's cooked coins. The leaderboard is just your room.
      </p>
      {account ? (
        <div className="flex items-center gap-2 rounded-md bg-bg px-3 py-2">
          <span className="text-[20px]">{account.avatar}</span>
          <span className="font-bold">{account.username}</span>
          <span className="rounded bg-up/15 px-1.5 text-[10px] font-bold text-up">✓ Signed in</span>
          <span className="ml-auto text-[10px] text-dim">Change your avatar from the account button at the top</span>
        </div>
      ) : (
      <div>
        {accountsOn && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[11px]">
            <span className="text-muted">Playing as a guest. Sign in to lock your name and keep your progress on every device.</span>
            <button onClick={() => setSignIn(true)} className="ml-auto shrink-0 rounded border border-accent/50 px-2 py-0.5 font-bold text-accent hover:bg-accent/10">Sign in</button>
          </div>
        )}
        <div className="mb-1 text-[11px] font-semibold text-muted">Your name & avatar</div>
        <div className="flex gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-raise text-[20px]">{avatar}</span>
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="DegenDave" className="h-9 w-full rounded-md border border-line2 bg-bg px-2 text-[13px] outline-none focus:border-accent/60" aria-label="Your name" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {AVATARS.map((a) => (
            <button key={a} onClick={() => setAvatar(a)} aria-pressed={avatar === a} className={clsx('grid size-8 place-items-center rounded text-[17px]', avatar === a ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-raise')}>{a}</button>
          ))}
        </div>
      </div>
      )}
      {signIn && <AccountModal onClose={() => setSignIn(false)} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-line2 bg-bg p-3">
          <div className="text-[13px] font-bold">Start a room</div>
          <p className="mt-0.5 text-[11px] text-dim">You'll get a code to send your friends. You're the host: you pick the mode and start rounds.</p>
          <button disabled={!!busy} onClick={() => go(true)} className="mt-2 h-9 w-full rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-50">{busy === 'create' ? 'Creating…' : 'Create room'}</button>
        </div>
        <div className="rounded-lg border border-line2 bg-bg p-3">
          <div className="text-[13px] font-bold">Join a room</div>
          <p className="mt-0.5 text-[11px] text-dim">Enter the code a friend sent you.</p>
          <div className="mt-2 flex gap-1.5">
            <input value={code} maxLength={5} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && go(false)} placeholder="ABCDE" className="num h-9 w-full rounded-md border border-line2 bg-panel px-2 text-center text-[15px] font-bold tracking-[0.3em] outline-none focus:border-accent/60" aria-label="Room code" />
            <button disabled={!!busy} onClick={() => go(false)} className="h-9 shrink-0 rounded-md border border-accent/50 px-3 text-[13px] font-bold text-accent hover:bg-accent/10 disabled:opacity-50">{busy === 'join' ? '…' : 'Join'}</button>
          </div>
        </div>
      </div>
      {error && <p className="rounded-md border border-down/40 bg-down/10 px-2 py-1.5 text-[12px] text-down">{error}{/reach|connect/i.test(error) ? ' — is the multiplayer server running?' : ''}</p>}
      <div className="flex items-center justify-between text-[11px] text-dim">
        <span>Your single-player game is saved and comes back when you leave the room.</span>
        <button onClick={() => setModal('mode')} className="text-muted underline hover:text-ink">Back to solo</button>
      </div>
    </div>
  )
}

function Room() {
  const online = useGame((s) => s.online)!
  const tick = useGame((s) => s.market.tick)
  const runStatus = useGame((s) => s.runStatus)
  const setModal = useGame((s) => s.setModal)
  const notify = useGame((s) => s.notify)
  const [mode, setMode] = useState<GameMode>(online.round.mode)
  const [len, setLen] = useState<RoundLength>('default')
  const [engine, setEngine] = useState<MarketEngine>(online.round.engine ?? 'classic')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const isHost = online.hostId === online.you
  const host = online.players.find((p) => p.id === online.hostId)
  const r = online.round
  const running = r.state === 'running'
  const left = running && r.durationTicks ? Math.max(0, r.durationTicks - (tick - r.startTick)) : null
  const ranked = [...online.players].sort((a, b) => ret(b) - ret(a))
  const copy = () => {
    navigator.clipboard?.writeText(online.code).catch(() => {})
    notify({ title: 'CODE COPIED', body: `Send ${online.code} to your friends`, tone: 'info', icon: '📋' })
  }
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-dim">Room code</div>
            <div className="num font-display text-[28px] font-bold tracking-[0.25em] text-accent">{online.code}</div>
          </div>
          <button onClick={copy} className="flex items-center gap-1 rounded-md border border-line2 px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink"><Copy size={12} /> Copy</button>
          <span className={clsx('ml-auto flex items-center gap-1 text-[11px]', online.conn === 'open' ? 'text-up' : 'text-warn')}>
            {online.conn === 'open' ? <Wifi size={13} /> : <WifiOff size={13} />}{online.conn === 'open' ? 'Connected' : 'Reconnecting…'}
          </span>
        </div>

        {/* Round */}
        <div className="rounded-lg border border-line2 p-3">
          {running ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[22px]">{MODE_ICON[r.mode]}</span>
              <div>
                <div className="text-[14px] font-bold">{MODES[r.mode].name} round in progress</div>
                <div className="num text-[11px] text-muted">{left !== null ? `${fmtClock(left)} left` : 'No time limit'} · round {r.id} · {r.engine === 'realistic' ? '💊 Realistic pump.fun' : '⏩ Classic'}</div>
              </div>
              <button onClick={() => setModal(null)} className="ml-auto h-9 rounded-md bg-accent px-4 text-[13px] font-extrabold text-accent-ink hover:brightness-110">{runStatus === 'running' ? 'Back to trading' : 'Watch the market'}</button>
            </div>
          ) : isHost ? (
            <div className="space-y-2">
              <div className="text-[13px] font-bold">{r.state === 'ended' ? 'Round over. Start the next one:' : 'Pick the round'}</div>
              <EnginePicker value={engine} onChange={setEngine} />
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(Object.keys(MODES) as GameMode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={clsx('rounded-md border px-2 py-1.5 text-left', mode === m ? 'border-accent/60 bg-accent/10' : 'border-line2 hover:bg-raise')}>
                    <div className="text-[12px] font-bold">{MODE_ICON[m]} {MODES[m].name}</div>
                    <div className="num text-[10px] text-dim">{fmtUsd(m === 'practice' ? 100_000 : MODES[m].startBalance, 0)}</div>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[11px] text-muted">Length</span>
                {ROUND_LENGTHS.map((o) => (
                  <button key={String(o.value)} onClick={() => setLen(o.value)} aria-pressed={len === o.value} className={clsx('rounded-md border px-2 py-0.5 text-[11px] font-semibold', len === o.value ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                    {o.label}
                  </button>
                ))}
              </div>
              <button onClick={() => startRound(mode, lengthTicks(mode, len), engine)} className="h-10 w-full rounded-md bg-accent text-[14px] font-extrabold text-accent-ink hover:brightness-110">
                🚀 Start {MODES[mode].name} for everyone ({online.players.filter((p) => p.online).length} player{online.players.filter((p) => p.online).length > 1 ? 's' : ''})
              </button>
              <p className="text-[10px] text-dim">Everyone starts together on a fresh market with the mode's balance.</p>
            </div>
          ) : (
            <div className="py-2 text-center text-[13px] text-muted">
              {r.state === 'ended' ? 'Round over. ' : ''}Waiting for <b className="text-ink">{host?.avatar} {host?.name ?? 'the host'}</b> to start {r.state === 'ended' ? 'the next round' : 'a round'}…
              <div className="mt-1 text-[11px] text-dim">The market is live: look around while you wait.</div>
            </div>
          )}
        </div>

        {/* Players */}
        <div className="rounded-lg border border-line2">
          <div className="border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">Players · {online.players.filter((p) => p.online).length} online</div>
          {ranked.map((p, i) => {
            const rt = ret(p)
            return (
              <div key={p.id} className={clsx('flex items-center gap-2 border-b border-line/50 px-3 py-2 last:border-b-0', p.id === online.you && 'bg-accent/5')}>
                {running && p.startEquity > 0 && <span className="num w-5 text-[11px] text-dim">#{i + 1}</span>}
                <span className={clsx('relative grid size-8 place-items-center rounded-md bg-raise text-[17px]', !p.online && 'opacity-40')}>
                  {p.avatar}
                  <span className={clsx('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-panel', p.online ? 'bg-up' : 'bg-line2')} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-[13px] font-semibold">
                    <span className="truncate">{p.name}</span>
                    {p.verified && <span className="text-[10px] font-bold text-up" title="Signed in: this is their real account">✓</span>}
                    {p.id === online.you && <span className="text-[10px] text-accent">(you)</span>}
                    {p.id === online.hostId && <Crown size={12} className="text-warn" fill="currentColor" aria-label="Host" />}
                  </span>
                  <span className="text-[10px] text-dim">Lv {p.level}{!p.online ? ' · offline' : ''}{p.finished ? ' · finished' : ''}</span>
                </span>
                {p.startEquity > 0 && (
                  <span className="ml-auto text-right">
                    <span className={clsx('num block text-[13px] font-bold', toneClass(rt))}>{fmtPct(rt, 2)}</span>
                    <span className="num block text-[10px] text-dim">{fmtUsd(p.equity, 0)} · {p.trades} trades</span>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Chat />
        <div className="mt-auto">
          {confirmLeave ? (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
              Leave room {online.code}? {running && runStatus === 'running' ? 'Your round here ends. ' : ''}Your solo game comes back.
              <div className="mt-2 flex gap-1.5">
                <button onClick={leaveRoom} className="h-8 flex-1 rounded-md bg-warn text-[12px] font-bold text-black">Leave</button>
                <button onClick={() => setConfirmLeave(false)} className="h-8 flex-1 rounded-md border border-line2 text-[12px] text-muted">Stay</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmLeave(true)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:border-down/50 hover:text-down"><LogOut size={13} /> Leave room</button>
          )}
        </div>
      </div>
    </div>
  )
}

const ret = (p: { equity: number; startEquity: number }) => (p.startEquity > 0 ? p.equity / p.startEquity - 1 : -Infinity)

function Chat() {
  const spectator = useGame((s) => !!s.online?.spectator)
  const chat = useGame((s) => s.online?.chat ?? [])
  const you = useGame((s) => s.online?.you)
  const notify = useGame((s) => s.notify)
  const [text, setText] = useState('')
  // Players you've hidden (only for you, kept in this browser) and messages you've reported.
  const [hidden, setHidden] = useState<string[]>(() => load<string[]>('chatHidden') ?? [])
  const [reported, setReported] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [chat.length])
  const hide = (id: string, name: string) => {
    const next = [...hidden, id]
    setHidden(next)
    save('chatHidden', next)
    notify({ title: 'HIDDEN', body: `You won't see ${name}'s messages any more (only you; undo below the chat).`, tone: 'info', icon: '🙈' })
  }
  const report = (c: { from: string; time: number; text: string; name: string }) => {
    reportChat(c.from, c.time, c.text)
    setReported((r) => [...r, `${c.from}:${c.time}`])
    notify({ title: 'REPORTED', body: `Thanks. An admin will look at ${c.name}'s message.`, tone: 'info', icon: '🚩' })
  }
  const shown = chat.filter((c) => !hidden.includes(c.from))
  const submit = () => {
    if (!text.trim()) return
    sendChat(text)
    setText('')
  }
  return (
    <div className="flex h-[300px] flex-col rounded-lg border border-line2">
      <div className="border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">Chat</div>
      <div ref={box} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-[12px]">
        {shown.length === 0 && <div className="pt-6 text-center text-[11px] text-dim">Talk trash here. 🗣</div>}
        {shown.map((c, i) => {
          const mine = c.from === you
          const done = reported.includes(`${c.from}:${c.time}`)
          return (
            <div key={i} className="group/line leading-snug">
              <span className={clsx('font-semibold', mine ? 'text-accent' : 'text-ink')}>{c.avatar} {c.name}</span> <span className="break-words text-muted">{c.text}</span>
              {!mine && !spectator && (
                <span className="ml-1 inline-flex gap-0.5 align-middle opacity-60 md:opacity-0 md:group-hover/line:opacity-100">
                  <button onClick={() => report(c)} disabled={done} title={done ? 'Reported' : 'Report this message to the admins'} aria-label="Report message" className={clsx('rounded p-0.5', done ? 'text-warn' : 'text-dim hover:text-warn')}><Flag size={10} /></button>
                  <button onClick={() => hide(c.from, c.name)} title={`Hide ${c.name}'s messages (only for you)`} aria-label="Hide this player's messages" className="rounded p-0.5 text-dim hover:text-ink"><EyeOff size={10} /></button>
                </span>
              )}
            </div>
          )
        })}
      </div>
      {hidden.length > 0 && (
        <button onClick={() => { setHidden([]); save('chatHidden', []) }} className="border-t border-line px-3 py-1 text-left text-[10px] text-dim hover:text-ink">
          {hidden.length} player{hidden.length > 1 ? 's' : ''} hidden · show again
        </button>
      )}
      {spectator ? (
        <div className="border-t border-line p-2 text-center text-[11px] text-dim">Sign in to chat</div>
      ) : <div className="flex gap-1 border-t border-line p-1.5">
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); e.stopPropagation() }} placeholder="Say something" aria-label="Chat message" className="h-8 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none focus:border-accent/60" />
        <button onClick={submit} aria-label="Send" className="grid size-8 place-items-center rounded-md bg-raise text-accent hover:brightness-125"><Send size={13} /></button>
      </div>}
    </div>
  )
}

/** Top bar chip while you're in a room: code, players, connection. */
export function RoomChip() {
  const online = useGame((s) => s.online)
  const setModal = useGame((s) => s.setModal)
  if (!online) return null
  const n = online.players.filter((p) => p.online).length
  if (online.round.world) {
    return (
      <button onClick={() => setModal('lobby')} title="The World: who's on, and chat" className={clsx('flex items-center gap-1.5 rounded-md border px-2 py-1', online.conn === 'open' ? 'border-accent/40 bg-accent/10' : 'border-warn/50 bg-warn/10')}>
        <span className={clsx('size-1.5 rounded-full', online.conn === 'open' ? 'bg-up pulse-dot' : 'bg-warn')} />
        <Globe size={12} className="text-accent" />
        <span className="text-[11px] font-bold tracking-wider text-accent">WORLD</span>
        <span className="flex items-center gap-0.5 text-[11px] text-muted"><Users size={11} />{n}</span>
      </button>
    )
  }
  return (
    <button onClick={() => setModal('lobby')} title="Room, players and chat" className={clsx('flex items-center gap-1.5 rounded-md border px-2 py-1', online.conn === 'open' ? 'border-accent/40 bg-accent/10' : 'border-warn/50 bg-warn/10')}>
      <span className={clsx('size-1.5 rounded-full', online.conn === 'open' ? 'bg-up pulse-dot' : 'bg-warn')} />
      <span className="num text-[11px] font-bold tracking-wider text-accent">{online.code}</span>
      <span className="flex items-center gap-0.5 text-[11px] text-muted"><Users size={11} />{n}</span>
    </button>
  )
}

// ─── MOONRUSH World ──────────────────────────────────────────────────────────
/** The way into the World, on the start screen. */
export function WorldCard({ adminOnly }: { adminOnly?: boolean }) {
  const signedIn = useAccount((s) => s.status === 'signedIn')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signIn, setSignIn] = useState(false)
  const go = async () => {
    setBusy(true)
    setError('')
    try {
      await joinWorld()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mb-3 rounded-xl border border-accent/50 bg-gradient-to-br from-accent/15 via-accent/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        <span className="text-[34px] leading-none">🌍</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[19px] font-bold text-accent">MOONRUSH World</span>
            <span className="rounded bg-up/15 px-1.5 py-0.5 text-[9px] font-bold text-up">LIVE 24/7</span>
            {adminOnly && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[9px] font-bold text-warn" title="Only admins see this until you turn the World on in the admin panel">ADMIN PREVIEW</span>}
          </div>
          <p className="mt-1 text-[12px] text-muted">
            One market for everyone, always running. Every coin, pump, rug and cook is shared. Start with <b className="text-ink">{fmtUsd(WORLD_START_BALANCE, 0)}</b>, and your wallet <b className="text-ink">never resets</b>: it's yours on every device.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={go} className="h-10 rounded-md bg-accent px-5 text-[14px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-50">
              {busy ? 'Connecting…' : signedIn ? 'Enter the World' : 'Watch the World'}
            </button>
            {!signedIn && (
              <button onClick={() => setSignIn(true)} className="h-10 rounded-md border border-accent/50 px-4 text-[13px] font-bold text-accent hover:bg-accent/10">Sign in to trade</button>
            )}
            {!signedIn && <span className="text-[11px] text-dim">Guests can watch; an account gets you a wallet.</span>}
          </div>
          {error && <p className="mt-2 rounded-md border border-down/40 bg-down/10 px-2 py-1.5 text-[12px] text-down">{error}</p>}
        </div>
      </div>
      {signIn && <AccountModal onClose={() => setSignIn(false)} />}
    </div>
  )
}

/** Inside the World: who's on, chat, and the way out. */
function WorldPanel() {
  const online = useGame((s) => s.online)!
  const setModal = useGame((s) => s.setModal)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const on = online.players.filter((p) => p.online)
  // People first, richest on top; then the simulated traders who are around (never above a real player).
  const ranked = [...on].sort((a, b) => Number(!!a.bot) - Number(!!b.bot) || b.equity - a.equity)
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
          <span className="text-[28px]">🌍</span>
          <div>
            <div className="text-[14px] font-bold">The World never stops</div>
            <div className="text-[11px] text-muted">💊 Realistic pump.fun market · your wallet is saved to your account</div>
          </div>
          <span className={clsx('ml-auto flex items-center gap-1 text-[11px]', online.conn === 'open' ? 'text-up' : 'text-warn')}>
            {online.conn === 'open' ? <Wifi size={13} /> : <WifiOff size={13} />}{online.conn === 'open' ? 'Connected' : 'Reconnecting…'}
          </span>
          <button onClick={() => setModal(null)} className="h-9 rounded-md bg-accent px-4 text-[13px] font-extrabold text-accent-ink hover:brightness-110">Back to trading</button>
        </div>
        {online.spectator && <WatchBanner inline />}
        <div className="rounded-lg border border-line2">
          <div className="border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">Online now · {on.length}</div>
          {ranked.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-dim">Nobody else is trading right now.</div>}
          {ranked.map((p) => (
            <div key={p.id} className={clsx('flex items-center gap-2 border-b border-line/50 px-3 py-2 last:border-b-0', p.id === online.you && 'bg-accent/5')}>
              <span className="grid size-8 place-items-center rounded-md bg-raise text-[17px]">{p.avatar}</span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[13px] font-semibold">
                  <span className="truncate">{p.name}</span>
                  {p.verified && <span className="text-[10px] font-bold text-up" title="Signed in: this is their real account">✓</span>}
                  {p.id === online.you && <span className="text-[10px] text-accent">(you)</span>}
                </span>
                <span className="text-[10px] text-dim">Lv {p.level}</span>
              </span>
              {p.startEquity > 0 && (
                <span className="ml-auto text-right">
                  <span className="num block text-[13px] font-bold">{fmtUsd(p.equity, 0)}</span>
                  <span className={clsx('num block text-[10px]', toneClass(p.equity - p.startEquity))}>{fmtPct(p.equity / p.startEquity - 1, 1)}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Chat />
        <div className="mt-auto">
          {confirmLeave ? (
            <div className="rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
              Leave the World? Your wallet stays here for when you come back; your solo game returns.
              <div className="mt-2 flex gap-1.5">
                <button onClick={leaveRoom} className="h-8 flex-1 rounded-md bg-warn text-[12px] font-bold text-black">Leave</button>
                <button onClick={() => setConfirmLeave(false)} className="h-8 flex-1 rounded-md border border-line2 text-[12px] text-muted">Stay</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmLeave(true)} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:border-down/50 hover:text-down"><LogOut size={13} /> Leave the World</button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Guests watching the World: a strip saying so, with the way to start playing. Signing in rejoins as a player. */
export function WatchBanner({ inline }: { inline?: boolean }) {
  const spectator = useGame((s) => !!s.online?.spectator)
  const signedIn = useAccount((s) => s.status === 'signedIn')
  const [signIn, setSignIn] = useState(false)
  useEffect(() => {
    // Signed in while watching: reconnect so the server knows it's you (you come back into the World as a player).
    if (spectator && signedIn) location.reload()
  }, [spectator, signedIn])
  if (!spectator) return null
  return (
    <div className={clsx('flex flex-wrap items-center justify-center gap-2 border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px]', inline ? 'rounded-md border' : 'border-b')}>
      <span>👀 You're <b>watching</b> the World as a guest.</span>
      <span className="text-muted">Sign in to get your own {fmtUsd(WORLD_START_BALANCE, 0)} wallet and trade.</span>
      <button onClick={() => setSignIn(true)} className="rounded border border-accent/60 px-2 py-0.5 text-[11px] font-bold text-accent hover:bg-accent/10">Sign in</button>
      {signIn && <AccountModal onClose={() => setSignIn(false)} />}
    </div>
  )
}
