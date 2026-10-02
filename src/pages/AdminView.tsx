import clsx from 'clsx'
import { Ban, Crown, DoorClosed, Flag, Megaphone, MicOff, RefreshCw, RotateCcw, ShieldCheck, UserX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CHAIN_IDS, CHAINS } from '../data/chains'
import { setFlag, useFlags, type GameFlags } from '../game/flags'
import type { AdminMarketAction } from '../game/marketEngine'
import { adminAct, adminApi, adminBan, adminMarketOn, type RoomSummary } from '../net/adminApi'
import { levelFromXp, xpForLevel } from '../game/progression'
import { useGame } from '../game/store'
import { useAccount } from '../net/account'
import { supabase } from '../net/supabase'
import type { Archetype, Chain } from '../types'
import { fmtAge, fmtCompact, fmtUsd } from '../utils/format'
import { EmptyState, Toggle } from '../components/ui'
import { GiveBox } from '../components/GiveBox'

type Tab = 'rooms' | 'market' | 'accounts' | 'switches'
/** Admin panel: only shows for accounts on the admin list (the server and database enforce it too). */
export function AdminView() {
  const admin = useAccount((s) => s.admin)
  const [tab, setTab] = useState<Tab>('rooms')
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [roomsError, setRoomsError] = useState('')

  const refresh = useCallback(async () => {
    const r = await adminApi<{ rooms: RoomSummary[] }>('/admin/api/rooms')
    if (r.ok) {
      setRooms(r.data!.rooms)
      setRoomsError('')
    } else setRoomsError(r.error ?? '')
  }, [])
  useEffect(() => {
    if (!admin) return
    void refresh()
    const id = setInterval(() => void refresh(), 3000)
    return () => clearInterval(id)
  }, [admin, refresh])

  const act = async (body: unknown, done?: string) => {
    const ok = await adminAct(body, done)
    void refresh()
    return ok
  }

  if (!admin) return <EmptyState icon="🔒" title="Admins only" hint="Sign in with an admin account to use this page." />

  const tabs: { id: Tab; label: string }[] = [
    { id: 'rooms', label: `🏠 Rooms & players ${rooms.length}` },
    { id: 'market', label: '📈 Market god mode' },
    { id: 'accounts', label: '👤 Accounts' },
    { id: 'switches', label: '🎛 Switches & stats' },
  ]
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 font-display text-[20px] font-bold"><Crown size={18} className="text-warn" /> Admin</span>
          <span className="rounded bg-warn/15 px-1.5 text-[10px] font-bold text-warn">ONLY YOU CAN SEE THIS</span>
          <div className="ml-auto flex flex-wrap gap-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={clsx('rounded-md border px-2.5 py-1 text-[12px] font-bold', tab === t.id ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line2 text-muted hover:text-ink')}>{t.label}</button>
            ))}
          </div>
        </div>
        {roomsError && tab !== 'accounts' && tab !== 'switches' && <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-[12px] text-down">Game server: {roomsError}</div>}
        {tab === 'rooms' && <Rooms rooms={rooms} act={act} />}
        {tab === 'market' && <Market rooms={rooms} />}
        {tab === 'accounts' && <Accounts />}
        {tab === 'switches' && <Switches rooms={rooms} />}
      </div>
    </div>
  )
}

function Card({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] font-bold">{title}<span className="ml-auto">{right}</span></div>
      <div className="p-3">{children}</div>
    </div>
  )
}

const btn = 'rounded border px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40'

// ─── Rooms & players ─────────────────────────────────────────────────────────
function Rooms({ rooms, act }: { rooms: RoomSummary[]; act: (b: unknown, done?: string) => Promise<boolean> }) {
  const [msg, setMsg] = useState('')
  const [gift, setGift] = useState<Record<string, string>>({})
  return (
    <div className="space-y-3">
      <Card title={<><Megaphone size={13} /> Message everyone in a room</>}>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await act({ action: 'notice', text: msg }, `Sent to ${rooms.length} room(s)`)) setMsg('') }}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="e.g. Update in 5 minutes, finish your round!" className="h-8 flex-1 rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none focus:border-warn/60" />
          <button disabled={!msg.trim() || !rooms.length} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>Send to all rooms</button>
        </form>
        <p className="mt-1 text-[10px] text-dim">Pops up for everyone in a room right now. For a banner everyone sees (solo too), use Switches → Notice banner.</p>
      </Card>
      <ResetByName act={act} />
      {!rooms.length && <EmptyState icon="🏠" title="No rooms open right now" />}
      {rooms.map((r) => (
        <Card
          key={r.code}
          title={<><span className="num tracking-wider text-accent">{r.code}</span><span className="font-normal text-dim">· {r.round.state} · {r.round.mode} · {r.round.engine} · tick {r.round.tick}{r.emptySince ? ` · empty ${fmtAge((Date.now() - r.emptySince) / 1000)}` : ''}</span></>}
          right={
            <span className="flex items-center gap-1">
              <button onClick={() => confirm(`Reset EVERY wallet in ${r.code === 'WORLD' ? 'the World' : `room ${r.code}`}? Everyone (online or not) goes back to the starting balance and loses their coins. This can't be undone.`) && act({ action: 'reset', room: r.code }, 'All wallets reset')} className={clsx(btn, 'flex items-center gap-1 border-down/50 text-down hover:bg-down/10')}><RotateCcw size={11} /> Reset all wallets</button>
              {r.code !== 'WORLD' && <button onClick={() => confirm(`Close room ${r.code}? Everyone in it is sent back to solo.`) && act({ action: 'close', room: r.code }, `Closed ${r.code}`)} className={clsx(btn, 'flex items-center gap-1 border-down/50 text-down hover:bg-down/10')}><DoorClosed size={11} /> Close room</button>}
            </span>
          }
        >
          {/* Chat reports from players, and who is muted right now */}
          {(r.reports?.length ?? 0) > 0 && (
            <div className="mb-3 rounded-md border border-warn/30 bg-warn/5 p-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] font-bold text-warn"><Flag size={12} /> {r.reports!.length} chat report{r.reports!.length > 1 ? 's' : ''}</div>
              <div className="space-y-1.5">
                {r.reports!.map((rep) => (
                  <div key={rep.id} className="rounded border border-line bg-bg px-2 py-1.5 text-[11px]">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold">{rep.target.name}</span>
                      <span className="text-dim">said</span>
                      <span className="break-all text-ink">“{rep.text}”</span>
                      <span className="ml-auto text-[10px] text-dim">reported by {rep.by.name}{rep.count > 1 ? ` +${rep.count - 1} more` : ''} · {fmtAge((Date.now() - rep.at) / 1000)} ago</span>
                    </div>
                    {rep.context.length > 1 && <div className="mt-0.5 truncate text-[10px] text-dim">Their recent messages: {rep.context.join(' · ')}</div>}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[[10, '10 min'], [60, '1 hour'], [1440, '24 hours']].map(([m, label]) => (
                        <button key={m} onClick={async () => { if (await act({ action: 'mute', room: r.code, playerId: rep.target.id, minutes: m }, `Muted ${rep.target.name} for ${label}`)) void act({ action: 'dismissReport', room: r.code, id: rep.id }, 'Report cleared') }} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>Mute {label}</button>
                      ))}
                      <button onClick={() => act({ action: 'kick', room: r.code, playerId: rep.target.id, reason: 'You were removed from the room by an admin' }, `Kicked ${rep.target.name}`)} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>Kick</button>
                      <button onClick={() => act({ action: 'dismissReport', room: r.code, id: rep.id }, 'Report cleared')} className={clsx(btn, 'ml-auto border-line2 text-muted hover:text-ink')}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {(r.muted?.length ?? 0) > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="flex items-center gap-1 text-dim"><MicOff size={12} /> Muted:</span>
              {r.muted!.map((m) => (
                <span key={m.id} className="flex items-center gap-1 rounded border border-line2 px-1.5 py-0.5">
                  {m.name} <span className="text-dim">({fmtAge((m.until - Date.now()) / 1000)} left)</span>
                  <button onClick={() => act({ action: 'mute', room: r.code, playerId: m.id, minutes: 0 }, `Unmuted ${m.name}`)} className="text-accent hover:underline">unmute</button>
                </span>
              ))}
            </div>
          )}
          {!r.players.length ? <div className="text-[11px] text-dim">Nobody here.</div> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wider text-dim"><th className="py-1">Player</th><th>Status</th><th className="text-right">Portfolio</th><th className="text-right">Return</th><th className="text-right">Trades</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {r.players.map((p) => {
                  const ret = p.startEquity > 0 ? p.equity / p.startEquity - 1 : 0
                  return (
                    <tr key={p.id} className="border-t border-line/50">
                      <td className="py-1.5">
                        <span className="mr-1">{p.avatar}</span><span className="font-semibold">{p.name}</span>
                        {p.verified && <span className="ml-1 text-[10px] font-bold text-up" title="Signed in">✓</span>}
                        {p.id === r.hostId && <span className="ml-1 rounded bg-raise px-1 text-[9px] text-muted">HOST</span>}
                        <div className="num text-[9px] text-dim">{p.id}</div>
                      </td>
                      <td className={p.online ? 'text-up' : 'text-dim'}>{p.online ? '● online' : '○ away'}</td>
                      <td className="num text-right">{fmtUsd(p.equity, 0)}</td>
                      <td className={clsx('num text-right', ret >= 0 ? 'text-up' : 'text-down')}>{(ret * 100).toFixed(2)}%</td>
                      <td className="num text-right">{p.trades}</td>
                      <td className="text-right">
                        <span className="inline-flex flex-wrap items-center justify-end gap-1">
                          <input value={gift[p.id] ?? ''} onChange={(e) => setGift({ ...gift, [p.id]: e.target.value.replace(/[^0-9.-]/g, '') })} placeholder="$" className="num h-6 w-16 rounded border border-line2 bg-bg px-1 text-[11px] outline-none" />
                          <button disabled={!Number(gift[p.id])} onClick={() => act({ action: 'grant', room: r.code, playerId: p.id, usd: Number(gift[p.id]) }, `Gave ${p.name} ${fmtUsd(Number(gift[p.id]))}`)} className={clsx(btn, 'border-up/50 text-up hover:bg-up/10')}>Give $</button>
                          <button onClick={() => act({ action: 'mute', room: r.code, playerId: p.id, minutes: 60 }, `Muted ${p.name} for 1 hour`)} className={clsx(btn, 'flex items-center gap-0.5 border-warn/50 text-warn hover:bg-warn/10')} title="Stop them chatting and posting for an hour"><MicOff size={10} /> Mute 1h</button>
                          <button onClick={() => confirm(`Reset ${p.name}'s wallet back to the start? Their coins and cash are gone. This can't be undone.`) && act({ action: 'reset', room: r.code, playerId: p.id }, `Reset ${p.name}'s wallet`)} className={clsx(btn, 'flex items-center gap-0.5 border-down/50 text-down hover:bg-down/10')}><RotateCcw size={10} /> Reset</button>
                          <button onClick={() => act({ action: 'kick', room: r.code, playerId: p.id, reason: 'You were removed from the room by an admin' }, `Kicked ${p.name}`)} className={clsx(btn, 'flex items-center gap-0.5 border-warn/50 text-warn hover:bg-warn/10')}><UserX size={10} /> Kick</button>
                          <button onClick={() => confirm(`Ban ${p.name}?${p.verified ? ' Their account can\'t join any room until you unban it (Accounts tab).' : ' (Guest: banned until the server restarts.)'}`) && adminBan(p, r.code)} className={clsx(btn, 'flex items-center gap-0.5 border-down/50 text-down hover:bg-down/10')}><Ban size={10} /> Ban</button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </div>
  )
}

/** Reset a World wallet by account name (works when they're offline too). */
function ResetByName({ act }: { act: (b: unknown, done?: string) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const notify = useGame((s) => s.notify)
  const go = async () => {
    if (!supabase || !name.trim()) return
    setBusy(true)
    try {
      const { data } = await supabase.from('profiles').select('id, username').ilike('username', name.trim().replace(/_/g, '\\_')).maybeSingle()
      if (!data) return notify({ title: 'ADMIN FAILED', body: `No account called "${name.trim()}"`, tone: 'warn', icon: '⚠️' })
      if (!confirm(`Reset ${data.username}'s World wallet back to the start? Their coins and cash are gone. This can't be undone.`)) return
      if (await act({ action: 'reset', room: 'WORLD', playerId: `u-${data.id}` }, `Reset ${data.username}'s World wallet`)) setName('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title={<><RotateCcw size={13} /> Reset a World wallet by name</>}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void go() }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Username" className="h-8 flex-1 rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none focus:border-warn/60" />
        <button disabled={busy || !name.trim()} className={clsx(btn, 'border-down/50 text-down hover:bg-down/10')}>Reset wallet</button>
      </form>
      <p className="mt-1 text-[10px] text-dim">Sends them back to the starting balance, even if they're offline. Per-player and "Reset all" buttons are on each room below.</p>
    </Card>
  )
}

// ─── Market god mode ─────────────────────────────────────────────────────────
const ARCHETYPES: { id: Archetype; label: string }[] = [
  { id: 'runner', label: '🚀 Runner (pumps)' },
  { id: 'rugger', label: '💀 Rugger' },
  { id: 'chaotic', label: '🎢 Chaotic' },
  { id: 'sleeper', label: '😴 Sleeper' },
  { id: 'bleeder', label: '🩸 Bleeder' },
]
const SIZES = [1_000, 10_000, 50_000, 250_000]

function Market({ rooms }: { rooms: RoomSummary[] }) {
  const online = useGame((s) => s.online?.code)
  const localTokens = useGame((s) => s.market.tokens)
  const localMood = useGame((s) => s.market.sentiment)
  const [target, setTarget] = useState<string>(online ?? 'solo')
  const [q, setQ] = useState('')
  const [coin, setCoin] = useState<string | null>(null)
  const [custom, setCustom] = useState('')
  const [chain, setChain] = useState<Chain>('sol')
  const [arch, setArch] = useState<Archetype>('runner')
  const room = rooms.find((r) => r.code === target)
  const solo = target === 'solo'
  const coins = useMemo(
    () => (solo ? localTokens.filter((t) => t.status === 'bonding' || t.status === 'graduated').sort((a, b) => b.mcap - a.mcap).map((t) => ({ id: t.id, ticker: t.ticker, emoji: t.emoji, chain: t.chain, mcap: t.mcap, status: t.status, creator: t.creator === 'you' ? 'you' : null })) : room?.coins ?? []),
    [solo, localTokens, room],
  )
  const shown = coins.filter((c) => !q || c.ticker.toLowerCase().includes(q.toLowerCase().replace('$', '')))
  const sel = coins.find((c) => c.id === coin)
  const mood = solo ? localMood : room?.sentiment ?? 0

  const run = (a: AdminMarketAction, done: string) => adminMarketOn(target, a, done)
  const size = (v: number) => (Number(custom) > 0 ? Number(custom) : v)

  return (
    <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
      <Card title="Pick a market & coin" right={
        <select value={target} onChange={(e) => { setTarget(e.target.value); setCoin(null) }} className="h-7 rounded border border-line2 bg-bg px-1 text-[11px]">
          <option value="solo">Your solo game</option>
          {rooms.map((r) => <option key={r.code} value={r.code}>Room {r.code} ({r.players.length})</option>)}
        </select>
      }>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search $TICKER" className="mb-2 h-8 w-full rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none focus:border-warn/60" />
        <div className="max-h-[420px] overflow-y-auto">
          {!shown.length && <div className="py-4 text-center text-[11px] text-dim">No live coins{solo ? ' (start a round first)' : ''}.</div>}
          {shown.map((c) => (
            <button key={c.id} onClick={() => setCoin(c.id)} className={clsx('flex w-full items-center gap-2 border-b border-line/40 px-2 py-1 text-left text-[12px] hover:bg-panel2', coin === c.id && 'bg-warn/10')}>
              <span>{c.emoji}</span><span className="font-bold">${c.ticker}</span>
              <span className="text-[9px] font-bold" style={{ color: CHAINS[c.chain].color }}>{CHAINS[c.chain].short}</span>
              {c.creator && <span className="rounded bg-raise px-1 text-[9px] text-muted">by {c.creator}</span>}
              <span className="num ml-auto text-muted">{fmtCompact(c.mcap)}</span>
            </button>
          ))}
        </div>
      </Card>

      <div className="space-y-3">
        <Card title={sel ? <>Selected: <span className="text-warn">${sel.ticker}</span> <span className="num font-normal text-dim">{fmtCompact(sel.mcap)} MC</span></> : 'Pick a coin on the left'}>
          <div className="space-y-2 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="w-12 text-dim">Size</span>
              <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="custom $" className="num h-7 w-28 rounded border border-line2 bg-bg px-1 text-[11px] outline-none" />
              <span className="text-[10px] text-dim">(or use the preset buttons)</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="w-12 font-bold text-up">Pump</span>
              {SIZES.map((v) => <button key={v} disabled={!sel} onClick={() => run({ kind: 'pump', tokenId: sel!.id, usd: size(v) }, `Pumped $${sel!.ticker} ${fmtUsd(size(v), 0)}`)} className={clsx(btn, 'border-up/50 text-up hover:bg-up/10')}>{custom ? fmtUsd(Number(custom), 0) : `$${fmtCompact(v).replace('$', '')}`}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="w-12 font-bold text-down">Dump</span>
              {SIZES.map((v) => <button key={v} disabled={!sel} onClick={() => run({ kind: 'dump', tokenId: sel!.id, usd: size(v) }, `Dumped $${sel!.ticker} ${fmtUsd(size(v), 0)}`)} className={clsx(btn, 'border-down/50 text-down hover:bg-down/10')}>{custom ? fmtUsd(Number(custom), 0) : `$${fmtCompact(v).replace('$', '')}`}</button>)}
            </div>
            <button disabled={!sel} onClick={() => confirm(`Rug $${sel!.ticker}? It plays out like a normal rug on the next tick.`) && run({ kind: 'rug', tokenId: sel!.id }, `Rugged $${sel!.ticker}`)} className={clsx(btn, 'border-down bg-down/10 text-down hover:bg-down hover:text-white')}>💀 Rug it</button>
            <p className="text-[10px] text-dim">Hidden: pumps and dumps are split across made-up wallets on the trades tab, and a rug looks like the dev pulled.</p>
          </div>
        </Card>
        <Card title="Spawn a coin">
          <div className="flex flex-wrap items-center gap-1 text-[12px]">
            {CHAIN_IDS.map((c) => <button key={c} onClick={() => setChain(c)} className={clsx(btn, chain === c ? 'border-warn/60 text-warn' : 'border-line2 text-muted')}>{CHAINS[c].short}</button>)}
            <select value={arch} onChange={(e) => setArch(e.target.value as Archetype)} className="h-7 rounded border border-line2 bg-bg px-1 text-[11px]">
              {ARCHETYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            <button onClick={() => run({ kind: 'spawn', chain, archetype: arch }, 'Spawned a new coin')} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>🌱 Launch it</button>
          </div>
          <p className="mt-1 text-[10px] text-dim">Launches like any new coin (fresh on the curve). The type sets how it tends to behave.</p>
        </Card>
        <Card title={<>Market mood <span className={clsx('num font-normal', mood >= 0 ? 'text-up' : 'text-down')}>{mood.toFixed(2)}</span></>}>
          <div className="flex flex-wrap gap-1">
            {[[-1, '🩸 Crash'], [-0.5, '📉 Bearish'], [0, '😐 Neutral'], [0.5, '📈 Bullish'], [1, '🚀 Euphoria']].map(([v, l]) => (
              <button key={v} onClick={() => run({ kind: 'mood', sentiment: v as number }, `Mood set to ${l}`)} className={clsx(btn, 'border-line2 text-muted hover:text-ink')}>{l}</button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-dim">Every coin leans with the mood. It drifts back over time.</p>
        </Card>
      </div>
    </div>
  )
}

// ─── Accounts ────────────────────────────────────────────────────────────────
interface Account {
  id: string
  username: string
  avatar: string
  level: number
  season_points: number
  created_at: string
  updated_at: string
}

function Accounts() {
  const notify = useGame((s) => s.notify)
  const [list, setList] = useState<Account[]>([])
  const [bans, setBans] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [xp, setXp] = useState<Record<string, string>>({})
  const load = useCallback(async () => {
    if (!supabase) return
    const [p, b] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar, level, season_points, created_at, updated_at').order('updated_at', { ascending: false }).limit(500),
      supabase.from('bans').select('user_id'),
    ])
    setList((p.data as Account[]) ?? [])
    setBans(new Set(((b.data as { user_id: string }[]) ?? []).map((x) => x.user_id)))
  }, [])
  useEffect(() => void load(), [load])

  const say = (ok: boolean, body: string) => notify(ok ? { title: 'ADMIN', body, tone: 'info', icon: '🛠' } : { title: 'ADMIN FAILED', body, tone: 'warn', icon: '⚠️' })

  /** Edit someone's save; bumping admin_rev makes their game take it (even mid-session, within a minute). */
  const editSave = async (a: Account, fn: (profile: Record<string, unknown>) => Record<string, unknown>, resetRewards = false) => {
    if (!supabase) return
    const { data, error } = await supabase.from('saves').select('profile, admin_rev').eq('user_id', a.id).maybeSingle()
    if (error || !data) return say(false, error?.message ?? `${a.username} has no save yet (they haven't synced)`)
    const profile = fn((data.profile as Record<string, unknown>) ?? {})
    const upd = await supabase.from('saves').update({ profile, ...(resetRewards ? { rewards: null } : {}), admin_rev: (data.admin_rev ?? 0) + 1, updated_at: new Date().toISOString() }).eq('user_id', a.id)
    if (upd.error) return say(false, upd.error.message)
    const lvl = levelFromXp(Number(profile.xp) || 0).level
    const season = profile.season as { points?: number } | undefined
    await supabase.from('profiles').update({ level: lvl, season_points: season?.points ?? 0 }).eq('id', a.id)
    void load()
    return true
  }
  const giveXp = async (a: Account) => {
    const n = Math.round(Number(xp[a.id]) || 0)
    if (!n) return
    if (await editSave(a, (p) => ({ ...p, xp: Math.max(0, (Number(p.xp) || 0) + n) }))) say(true, `${n > 0 ? 'Gave' : 'Took'} ${Math.abs(n)} XP ${n > 0 ? 'to' : 'from'} ${a.username}`)
  }
  const setLevel = async (a: Account, lvl: number) => {
    if (await editSave(a, (p) => ({ ...p, xp: xpForLevel(lvl) }))) say(true, `${a.username} is now level ${lvl}`)
  }
  const reset = async (a: Account) => {
    if (!confirm(`Reset ALL of ${a.username}'s progress (XP, level, season, badges, rewards)? This can't be undone.`)) return
    if (await editSave(a, () => ({ xp: 0, bestReturnPct: 0, runsPlayed: 0, lifetimeTrades: 0 }), true)) say(true, `Reset ${a.username}`)
  }
  const toggleBan = async (a: Account) => {
    if (!supabase) return
    const banned = bans.has(a.id)
    if (!banned && !confirm(`Ban ${a.username}? They can still play solo but can't join rooms.`)) return
    const r = banned ? await supabase.from('bans').delete().eq('user_id', a.id) : await supabase.from('bans').insert({ user_id: a.id, reason: 'Banned by admin' })
    say(!r.error, r.error?.message ?? `${banned ? 'Unbanned' : 'Banned'} ${a.username}`)
    void load()
  }

  const shown = list.filter((a) => !q || a.username.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="space-y-3">
    <Card title="🎁 Give currency">
      <GiveBox />
    </Card>
    <Card title={<>👤 {list.length} accounts</>} right={<button onClick={() => void load()} className={clsx(btn, 'flex items-center gap-1 border-line2 text-muted')}><RefreshCw size={10} /> Refresh</button>}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search username" className="mb-2 h-8 w-full rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none focus:border-warn/60" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12px]">
          <thead><tr className="text-left text-[10px] uppercase tracking-wider text-dim"><th className="py-1">Player</th><th className="text-right">Level</th><th className="text-right">Season pts</th><th className="text-right">Joined</th><th className="text-right">Last on</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id} className={clsx('border-t border-line/50', bans.has(a.id) && 'opacity-60')}>
                <td className="py-1.5"><span className="mr-1">{a.avatar}</span><span className="font-semibold">{a.username}</span>{bans.has(a.id) && <span className="ml-1 rounded bg-down/15 px-1 text-[9px] font-bold text-down">BANNED</span>}</td>
                <td className="num text-right">{a.level}</td>
                <td className="num text-right">{a.season_points}</td>
                <td className="num text-right text-dim">{fmtAge((Date.now() - Date.parse(a.created_at)) / 1000)}</td>
                <td className="num text-right text-dim">{fmtAge((Date.now() - Date.parse(a.updated_at)) / 1000)}</td>
                <td className="text-right">
                  <span className="inline-flex flex-wrap items-center justify-end gap-1">
                    <input value={xp[a.id] ?? ''} onChange={(e) => setXp({ ...xp, [a.id]: e.target.value.replace(/[^0-9-]/g, '') })} placeholder="XP" className="num h-6 w-16 rounded border border-line2 bg-bg px-1 text-[11px] outline-none" />
                    <button disabled={!Number(xp[a.id])} onClick={() => giveXp(a)} className={clsx(btn, 'border-up/50 text-up hover:bg-up/10')}>Give XP</button>
                    <select value="" onChange={(e) => e.target.value && setLevel(a, Number(e.target.value))} className="h-6 rounded border border-line2 bg-bg px-1 text-[11px]">
                      <option value="">Set level…</option>
                      {[1, 5, 10, 15, 20, 25, 30].map((l) => <option key={l} value={l}>Lv {l}</option>)}
                    </select>
                    <button onClick={() => reset(a)} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>Reset</button>
                    <button onClick={() => toggleBan(a)} className={clsx(btn, bans.has(a.id) ? 'border-up/50 text-up' : 'border-down/50 text-down hover:bg-down/10')}>{bans.has(a.id) ? 'Unban' : 'Ban'}</button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-dim">XP, level and resets reach the player's game within a minute (or next time they open it). Banned players can still play solo but can't join rooms.</p>
    </Card>
    </div>
  )
}

// ─── Player counters ─────────────────────────────────────────────────────────
interface DayRow { day: string; players: number; new_accounts: number; avg_minutes: number; world_players: number; back_next_day: number; back_in_week: number }

/** Players per day, time played, and how many come back (signed-in players; needs supabase/006_activity.sql). */
function PlayerCounters() {
  const [rows, setRows] = useState<DayRow[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    if (!supabase) return setErr('Accounts are off')
    const { data, error } = await supabase.rpc('activity_summary', { days: 14 })
    if (error) return setErr(/activity_summary|schema cache|does not exist/i.test(error.message) ? 'setup' : error.message)
    setErr('')
    setRows(((data ?? []) as DayRow[]).map((r) => ({ ...r, players: +r.players, new_accounts: +r.new_accounts, avg_minutes: +r.avg_minutes, world_players: +r.world_players, back_next_day: +r.back_next_day, back_in_week: +r.back_in_week })))
  }, [])
  useEffect(() => void load(), [load])
  const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—')
  const today = new Date().toISOString().slice(0, 10)
  const full = (rows ?? []).filter((r) => r.day !== today) // today isn't over yet
  const avg = (f: (r: DayRow) => number) => (full.length ? full.reduce((a, r) => a + f(r), 0) / full.length : 0)
  const withNext = full.filter((r) => r.players > 0 && r.day < today)
  const d1 = withNext.length ? withNext.reduce((a, r) => a + r.back_next_day, 0) / Math.max(1, withNext.reduce((a, r) => a + r.players, 0)) : 0
  return (
    <Card title={<>📈 Players per day</>} right={<button onClick={() => void load()} className={clsx(btn, 'flex items-center gap-1 border-line2 text-muted hover:text-ink')}><RefreshCw size={11} /> Refresh</button>}>
      {err === 'setup' ? (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          One-time setup needed: open Supabase → SQL Editor, paste the contents of <b>supabase/006_activity.sql</b> and click Run. Counting starts from then.
        </div>
      ) : err ? (
        <div className="text-[12px] text-down">{err}</div>
      ) : !rows ? (
        <div className="text-[12px] text-dim">Loading…</div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['Players / day (avg)', avg((r) => r.players).toFixed(1)],
              ['Minutes / player (avg)', avg((r) => r.avg_minutes).toFixed(0)],
              ['Come back next day', `${Math.round(d1 * 100)}%`],
              ['New accounts (14d)', (rows ?? []).reduce((a, r) => a + r.new_accounts, 0)],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-md border border-line bg-bg px-3 py-2">
                <div className="text-[10px] uppercase tracking-wider text-dim">{l}</div>
                <div className="num text-[20px] font-bold">{v}</div>
              </div>
            ))}
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-dim">
                <th className="py-1">Day</th><th className="text-right">Players</th><th className="text-right">In the World</th><th className="text-right">New accounts</th><th className="text-right">Avg minutes</th><th className="text-right" title="Of that day's players, how many played again the next day">Back next day</th><th className="text-right" title="Of that day's players, how many played again within 7 days">Back within 7 days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day} className="border-t border-line/50">
                  <td className="num py-1.5">{r.day}{r.day === today && <span className="ml-1 text-[10px] text-dim">(today so far)</span>}</td>
                  <td className="num text-right font-semibold">{r.players}</td>
                  <td className="num text-right">{r.world_players}</td>
                  <td className="num text-right">{r.new_accounts}</td>
                  <td className="num text-right">{r.avg_minutes}</td>
                  <td className="num text-right">{r.day === today ? '—' : <>{r.back_next_day} <span className="text-dim">({pct(r.back_next_day, r.players)})</span></>}</td>
                  <td className="num text-right">{r.back_in_week} <span className="text-dim">({pct(r.back_in_week, r.players)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-dim">Signed-in players only (guests aren't counted), measured while the game is open and on screen. "Come back next day" is the number to watch: under about 20% means people try it and leave; 30–40%+ is healthy for a game.</p>
        </>
      )}
    </Card>
  )
}

// ─── Switches & stats ────────────────────────────────────────────────────────
function Switches({ rooms }: { rooms: RoomSummary[] }) {
  const flags = useFlags()
  const notify = useGame((s) => s.notify)
  const [notice, setNotice] = useState(flags.notice)
  const [stats, setStats] = useState<{ total: number; day: number; week: number; newToday: number } | null>(null)
  useEffect(() => {
    if (!supabase) return
    const since = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
    const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0)
    const head = () => supabase!.from('profiles').select('id', { count: 'exact', head: true })
    void Promise.all([count(head()), count(head().gte('updated_at', since(24))), count(head().gte('updated_at', since(24 * 7))), count(head().gte('created_at', since(24)))]).then(([total, day, week, newToday]) => setStats({ total, day, week, newToday }))
  }, [])
  const flip = async <K extends keyof GameFlags>(k: K, v: GameFlags[K], label: string) => {
    const err = await setFlag(k, v)
    notify(err ? { title: 'ADMIN FAILED', body: err, tone: 'warn', icon: '⚠️' } : { title: 'SWITCH', body: `${label}: ${typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : 'saved'} for everyone`, tone: 'info', icon: '🎛' })
  }
  const online = rooms.reduce((a, r) => a + r.players.filter((p) => p.online).length, 0)
  const rows: { k: 'events' | 'eventPopups' | 'multiplayer' | 'world'; label: string; hint: string }[] = [
    { k: 'events', label: 'Events feed', hint: 'The Events tab and sidebar feed' },
    { k: 'eventPopups', label: 'Market event pop-ups', hint: 'Trending / parabolic / whale pop-ups (rug warnings for your bags always show)' },
    { k: 'multiplayer', label: 'Play with friends', hint: 'Off hides the button for everyone except you' },
    { k: 'world', label: 'MOONRUSH World', hint: 'The public World for everyone. Off: only you see it (turn on at launch)' },
  ]
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card title="🎛 Game switches (live for everyone, no push needed)">
        <div className="space-y-2">
          {rows.map((r) => (
            <label key={r.k} className="flex items-center justify-between gap-3 rounded-md bg-bg px-3 py-2">
              <span><span className="block text-[12px] font-semibold">{r.label}</span><span className="block text-[10px] text-dim">{r.hint}</span></span>
              <Toggle label={r.label} on={flags[r.k]} onChange={(v) => flip(r.k, v, r.label)} />
            </label>
          ))}
          <div className="rounded-md bg-bg px-3 py-2">
            <div className="text-[12px] font-semibold">Notice banner</div>
            <div className="mb-1 text-[10px] text-dim">Shows at the top of everyone's game (solo too) until you clear it.</div>
            <div className="flex gap-2">
              <input value={notice} onChange={(e) => setNotice(e.target.value)} maxLength={160} placeholder="e.g. New season starts Monday!" className="h-8 flex-1 rounded-md border border-line2 bg-panel px-2 text-[12px] outline-none focus:border-warn/60" />
              <button onClick={() => flip('notice', notice.trim(), 'Notice banner')} className={clsx(btn, 'border-warn/50 text-warn hover:bg-warn/10')}>Post</button>
              <button onClick={() => { setNotice(''); void flip('notice', '', 'Notice banner') }} className={clsx(btn, 'border-line2 text-muted')}>Clear</button>
            </div>
          </div>
          <p className="text-[10px] text-dim">Players pick up changes within a minute.</p>
        </div>
      </Card>
      <Card title={<><ShieldCheck size={13} /> Stats</>}>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Online in rooms now', online],
            ['Open rooms', rooms.length],
            ['Accounts', stats?.total ?? '…'],
            ['New today', stats?.newToday ?? '…'],
            ['Active today', stats?.day ?? '…'],
            ['Active this week', stats?.week ?? '…'],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-md border border-line bg-bg px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-dim">{l}</div>
              <div className="num text-[20px] font-bold">{v}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-dim">"Active" = signed-in players whose progress synced in that time. Guests aren't counted.</p>
      </Card>
      <div className="lg:col-span-2"><PlayerCounters /></div>
    </div>
  )
}
