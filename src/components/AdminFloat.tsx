import clsx from 'clsx'
import { Ban, ExternalLink, GripHorizontal, UserX, X } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { create } from 'zustand'
import { CHAIN_IDS, CHAINS } from '../data/chains'
import { setFlag, useFlags, type GameFlags } from '../game/flags'
import type { AdminMarketAction } from '../game/marketEngine'
import { useGame } from '../game/store'
import { useSelectedToken } from '../hooks/useDerived'
import { useAccount } from '../net/account'
import { adminAct, adminApi, adminBan, adminMarketOn, type RoomSummary } from '../net/adminApi'
import type { Archetype, Chain } from '../types'
import { fmtCompact, fmtUsd } from '../utils/format'
import { load, save } from '../utils/storage'
import { Toggle } from './ui'
import { GiveBox } from './GiveBox'

const W = 320
const clampPos = (p: { x: number; y: number }) => ({
  x: Math.min(Math.max(8, p.x), Math.max(8, window.innerWidth - W - 8)),
  y: Math.min(Math.max(56, p.y), Math.max(56, window.innerHeight - 200)),
})

type Tab = 'coin' | 'give' | 'room' | 'switches'

/** Whether the floating admin panel is open (remembered). The 🛠 button in the top bar toggles it. */
export const useAdminFloat = create<{ open: boolean; toggle: (v?: boolean) => void }>((set, get) => ({
  open: load<boolean>('adminFloatOpen') ?? false,
  toggle: (v) => {
    const open = v ?? !get().open
    set({ open })
    save('adminFloatOpen', open)
  },
}))

const SIZES = [1_000, 10_000, 50_000, 250_000]
const ARCHETYPES: { id: Archetype; label: string }[] = [
  { id: 'runner', label: '🚀 Runner' },
  { id: 'rugger', label: '💀 Rugger' },
  { id: 'chaotic', label: '🎢 Chaotic' },
  { id: 'sleeper', label: '😴 Sleeper' },
  { id: 'bleeder', label: '🩸 Bleeder' },
]
const btn = 'rounded border px-1.5 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40'

/** Floating admin panel (drag it anywhere; stays open across tabs). Admins only. */
export function AdminFloat() {
  const admin = useAccount((s) => s.admin)
  const open = useAdminFloat((s) => s.open)
  const toggle = useAdminFloat((s) => s.toggle)
  const setView = useGame((s) => s.setView)
  const room = useGame((s) => s.online?.code)
  const [pos, setPos] = useState(() => clampPos(load<{ x: number; y: number }>('adminFloatPos') ?? { x: window.innerWidth - W - 24, y: 110 }))
  const [tab, setTab] = useState<Tab>(() => load<Tab>('adminFloatTab') ?? 'coin')
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  if (!admin || !open) return null

  const pick = (t: Tab) => {
    setTab(t)
    save('adminFloatTab', t)
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) setPos(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }))
  }
  const onUp = () => {
    if (drag.current) save('adminFloatPos', pos)
    drag.current = null
  }

  return (
    <div role="dialog" aria-label="Admin panel" className="pop-in fixed z-40 rounded-lg border border-warn/50 bg-panel/95 shadow-2xl shadow-black/60 backdrop-blur" style={{ left: pos.x, top: pos.y, width: W }}>
      <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} className="flex cursor-grab touch-none items-center gap-1.5 border-b border-line px-2.5 py-1.5 active:cursor-grabbing">
        <GripHorizontal size={14} className="text-dim" />
        <span className="text-[12px] font-bold text-warn">🛠 Admin</span>
        <span className="rounded bg-raise px-1 text-[9px] font-bold text-muted">{room ? `ROOM ${room}` : 'SOLO'}</span>
        <button onClick={() => setView('admin')} className="ml-auto flex items-center gap-0.5 rounded px-1 text-[10px] text-dim hover:text-ink" title="Open the full admin page"><ExternalLink size={11} /> Full page</button>
        <button onClick={() => toggle(false)} className="rounded p-1 text-dim hover:text-ink" aria-label="Close admin panel"><X size={14} /></button>
      </div>
      <div className="flex gap-3 border-b border-line px-2.5">
        {(['coin', 'give', 'room', 'switches'] as Tab[]).map((k) => (
          <button key={k} onClick={() => pick(k)} className={clsx('-mb-px border-b-2 py-1 text-[11px] font-bold', tab === k ? 'border-warn text-ink' : 'border-transparent text-dim hover:text-muted')}>
            {k === 'coin' ? '📈 Coin' : k === 'give' ? '🎁 Give' : k === 'room' ? '🏠 Room' : '🎛 Switches'}
          </button>
        ))}
      </div>
      <div className="max-h-[70vh] overflow-y-auto p-2.5">
        {tab === 'coin' && <CoinTab target={room ?? 'solo'} />}
        {tab === 'give' && <GiveTab room={room} />}
        {tab === 'room' && <RoomTab room={room} />}
        {tab === 'switches' && <SwitchesTab />}
      </div>
    </div>
  )
}

// ─── Coin: god mode on the coin you're looking at ────────────────────────────
function CoinTab({ target }: { target: string }) {
  const t = useSelectedToken()
  const mood = useGame((s) => s.market.sentiment)
  const [size, setSize] = useState(10_000)
  const [custom, setCustom] = useState('')
  const [chain, setChain] = useState<Chain>('sol')
  const [arch, setArch] = useState<Archetype>('runner')
  const usd = Number(custom) > 0 ? Number(custom) : size
  const live = t && (t.status === 'bonding' || t.status === 'graduated')
  const run = (a: AdminMarketAction, done: string) => adminMarketOn(target, a, done)
  return (
    <div className="space-y-2.5 text-[11px]">
      <div className="rounded-md bg-bg/70 p-2">
        {!t ? (
          <div className="text-dim">Open a coin to pump, dump or rug it.</div>
        ) : (
          <>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span>{t.emoji}</span><span className="text-[12px] font-bold">${t.ticker}</span>
              <span className="text-[9px] font-bold" style={{ color: CHAINS[t.chain].color }}>{CHAINS[t.chain].short}</span>
              <span className="num ml-auto text-muted">{fmtCompact(t.mcap)} MC</span>
            </div>
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              {SIZES.map((v) => (
                <button key={v} onClick={() => { setSize(v); setCustom('') }} className={clsx(btn, !custom && size === v ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line2 text-muted')}>${fmtCompact(v).replace('$', '')}</button>
              ))}
              <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="$ custom" className="num h-6 w-20 rounded border border-line2 bg-panel px-1 text-[11px] outline-none" />
            </div>
            <div className="grid grid-cols-3 gap-1">
              <button disabled={!live} onClick={() => run({ kind: 'pump', tokenId: t.id, usd }, `Pumped $${t.ticker} ${fmtUsd(usd, 0)}`)} className={clsx(btn, 'border-up/60 py-1 text-up hover:bg-up hover:text-black')}>Pump</button>
              <button disabled={!live} onClick={() => run({ kind: 'dump', tokenId: t.id, usd }, `Dumped $${t.ticker} ${fmtUsd(usd, 0)}`)} className={clsx(btn, 'border-down/60 py-1 text-down hover:bg-down hover:text-white')}>Dump</button>
              <button disabled={!live} onClick={() => confirm(`Rug $${t.ticker}?`) && run({ kind: 'rug', tokenId: t.id }, `Rugged $${t.ticker}`)} className={clsx(btn, 'border-down bg-down/10 py-1 text-down hover:bg-down hover:text-white')}>💀 Rug</button>
            </div>
            {!live && <div className="mt-1 text-[10px] text-dim">${t.ticker} isn't trading ({t.status}).</div>}
          </>
        )}
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Spawn a coin</div>
        <div className="flex flex-wrap items-center gap-1">
          {CHAIN_IDS.map((c) => <button key={c} onClick={() => setChain(c)} className={clsx(btn, chain === c ? 'border-warn/60 text-warn' : 'border-line2 text-muted')}>{CHAINS[c].short}</button>)}
          <select value={arch} onChange={(e) => setArch(e.target.value as Archetype)} className="h-6 rounded border border-line2 bg-bg px-1 text-[11px]">
            {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <button onClick={() => run({ kind: 'spawn', chain, archetype: arch }, 'Spawned a new coin')} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>🌱 Launch</button>
        </div>
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Market mood <span className={clsx('num normal-case', mood >= 0 ? 'text-up' : 'text-down')}>{mood.toFixed(2)}</span></div>
        <div className="grid grid-cols-5 gap-1">
          {([[-1, '🩸'], [-0.5, '📉'], [0, '😐'], [0.5, '📈'], [1, '🚀']] as [number, string][]).map(([v, l]) => (
            <button key={v} onClick={() => run({ kind: 'mood', sentiment: v }, `Mood ${l}`)} title={['Crash', 'Bearish', 'Neutral', 'Bullish', 'Euphoria'][[-1, -0.5, 0, 0.5, 1].indexOf(v)]} className={clsx(btn, 'border-line2 py-1 text-[13px] hover:border-warn/50')}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-[9px] text-dim">Hidden: looks like normal wallets trading. Acts on {target === 'solo' ? 'your solo game' : `room ${target}`}.</p>
    </div>
  )
}

// ─── Give: currency to you, a room player, or any account ────────────────────
function GiveTab({ room }: { room?: string }) {
  const [players, setPlayers] = useState<RoomSummary['players']>([])
  useEffect(() => {
    if (!room) return setPlayers([])
    const get = async () => {
      const r = await adminApi<{ rooms: RoomSummary[] }>('/admin/api/rooms')
      if (r.ok) setPlayers(r.data!.rooms.find((x) => x.code === room)?.players ?? [])
    }
    void get()
    const id = setInterval(() => void get(), 5000)
    return () => clearInterval(id)
  }, [room])
  return <GiveBox room={room} players={players} compact />
}

// ─── Room: the players in the room you're in ─────────────────────────────────
function RoomTab({ room }: { room?: string }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [err, setErr] = useState('')
  const [gift, setGift] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState('')
  useEffect(() => {
    const get = async () => {
      const r = await adminApi<{ rooms: RoomSummary[] }>('/admin/api/rooms')
      if (r.ok) {
        setRooms(r.data!.rooms)
        setErr('')
      } else setErr(r.error ?? '')
    }
    void get()
    const id = setInterval(() => void get(), 3000)
    return () => clearInterval(id)
  }, [])
  const r = rooms.find((x) => x.code === room)
  if (err) return <div className="text-[11px] text-down">Game server: {err}</div>
  if (!room || !r) {
    return (
      <div className="space-y-1 text-[11px] text-dim">
        <div>You're not in a room. {rooms.length ? `${rooms.length} room(s) open:` : 'No rooms are open.'}</div>
        {rooms.map((x) => <div key={x.code} className="num text-muted">{x.code} · {x.players.filter((p) => p.online).length} online · {x.round.state}</div>)}
        <div>Use Full page to manage other rooms.</div>
      </div>
    )
  }
  return (
    <div className="space-y-2 text-[11px]">
      <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (await adminAct({ action: 'notice', room, text: msg }, 'Message sent')) setMsg('') }}>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="Message everyone in this room" className="h-7 flex-1 rounded border border-line2 bg-bg px-1.5 outline-none focus:border-warn/60" />
        <button disabled={!msg.trim()} className={clsx(btn, 'border-warn/50 text-warn')}>Send</button>
      </form>
      {r.players.map((p) => {
        const ret = p.startEquity > 0 ? p.equity / p.startEquity - 1 : 0
        return (
          <div key={p.id} className="rounded-md bg-bg/70 px-2 py-1.5">
            <div className="flex items-center gap-1">
              <span>{p.avatar}</span><span className="font-semibold">{p.name}</span>
              {p.verified && <span className="text-[10px] font-bold text-up">✓</span>}
              <span className={clsx('text-[9px]', p.online ? 'text-up' : 'text-dim')}>{p.online ? '●' : '○'}</span>
              <span className="num ml-auto text-muted">{fmtUsd(p.equity, 0)}</span>
              <span className={clsx('num w-14 text-right', ret >= 0 ? 'text-up' : 'text-down')}>{(ret * 100).toFixed(1)}%</span>
            </div>
            <div className="mt-1 flex items-center gap-1">
              <input value={gift[p.id] ?? ''} onChange={(e) => setGift({ ...gift, [p.id]: e.target.value.replace(/[^0-9.-]/g, '') })} placeholder="$" className="num h-6 w-16 rounded border border-line2 bg-panel px-1 outline-none" />
              <button disabled={!Number(gift[p.id])} onClick={() => adminAct({ action: 'grant', room, playerId: p.id, usd: Number(gift[p.id]) }, `Gave ${p.name} ${fmtUsd(Number(gift[p.id]))}`)} className={clsx(btn, 'border-up/50 text-up')}>Give $</button>
              <button onClick={() => confirm(`Reset ${p.name}'s wallet back to the start? This can't be undone.`) && adminAct({ action: 'reset', room, playerId: p.id }, `Reset ${p.name}'s wallet`)} className={clsx(btn, 'ml-auto border-down/50 text-down')} title="Reset wallet to the start">Reset</button>
              <button onClick={() => adminAct({ action: 'kick', room, playerId: p.id, reason: 'You were removed from the room by an admin' }, `Kicked ${p.name}`)} className={clsx(btn, 'flex items-center gap-0.5 border-warn/50 text-warn')}><UserX size={10} /> Kick</button>
              <button onClick={() => confirm(`Ban ${p.name}?`) && adminBan(p, room)} className={clsx(btn, 'flex items-center gap-0.5 border-down/50 text-down')}><Ban size={10} /> Ban</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Switches ────────────────────────────────────────────────────────────────
function SwitchesTab() {
  const flags = useFlags()
  const notify = useGame((s) => s.notify)
  const [notice, setNotice] = useState(flags.notice)
  const flip = async <K extends keyof GameFlags>(k: K, v: GameFlags[K], label: string) => {
    const err = await setFlag(k, v)
    notify(err ? { title: 'ADMIN FAILED', body: err, tone: 'warn', icon: '⚠️' } : { title: 'SWITCH', body: `${label}: ${typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : 'saved'} for everyone`, tone: 'info', icon: '🎛' })
  }
  const rows: { k: 'events' | 'eventPopups' | 'multiplayer' | 'world'; label: string }[] = [
    { k: 'events', label: 'Events feed' },
    { k: 'eventPopups', label: 'Event pop-ups' },
    { k: 'multiplayer', label: 'Play with friends' },
    { k: 'world', label: 'MOONRUSH World' },
  ]
  return (
    <div className="space-y-1.5 text-[11px]">
      {rows.map((r) => (
        <label key={r.k} className="flex items-center justify-between rounded-md bg-bg/70 px-2 py-1.5">
          <span className="font-semibold">{r.label}</span>
          <Toggle label={r.label} on={flags[r.k]} onChange={(v) => flip(r.k, v, r.label)} />
        </label>
      ))}
      <div className="rounded-md bg-bg/70 px-2 py-1.5">
        <div className="mb-1 font-semibold">Notice banner</div>
        <div className="flex gap-1">
          <input value={notice} onChange={(e) => setNotice(e.target.value)} maxLength={160} placeholder="Shows at the top for everyone" className="h-7 min-w-0 flex-1 rounded border border-line2 bg-panel px-1.5 outline-none focus:border-warn/60" />
          <button onClick={() => flip('notice', notice.trim(), 'Notice')} className={clsx(btn, 'border-warn/50 text-warn')}>Post</button>
          <button onClick={() => { setNotice(''); void flip('notice', '', 'Notice') }} className={clsx(btn, 'border-line2 text-muted')}>Clear</button>
        </div>
      </div>
      <p className="text-[9px] text-dim">Live for everyone within a minute, no push needed.</p>
    </div>
  )
}
