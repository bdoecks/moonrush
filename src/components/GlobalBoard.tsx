import clsx from 'clsx'
import { Globe, RefreshCw, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { seasonNumber, tierFor } from '../game/season'
import { useAccount } from '../net/account'
import { useSocial } from '../net/social'
import { supabase } from '../net/supabase'
import { fmtAge } from '../utils/format'
import { EmptyState } from './ui'

interface Row {
  id: string
  username: string
  avatar: string
  level: number
  season_points: number
  updated_at: string
}

const COLS = 'id, username, avatar, level, season_points, updated_at'

/** Everyone signed up, ranked by this season's points (or just you and your friends). */
export function GlobalBoard() {
  const myId = useAccount((s) => s.userId)
  const signed = useAccount((s) => s.status === 'signedIn')
  const friendIds = useSocial((s) => s.friends.map((f) => f.id).join(','))
  const [scope, setScope] = useState<'all' | 'friends'>('all')
  const [rows, setRows] = useState<Row[]>([])
  const [me, setMe] = useState<{ rank: number; total: number } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const season = seasonNumber()

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    let q = supabase.from('profiles').select(COLS).eq('season', season).order('season_points', { ascending: false }).order('level', { ascending: false }).limit(100)
    if (scope === 'friends') q = q.in('id', [...friendIds.split(',').filter(Boolean), ...(myId ? [myId] : [])])
    const { data, error: err } = await q
    if (err) {
      setError(/season/.test(err.message) ? 'The global board needs the new database setup first.' : err.message)
      setLoading(false)
      return
    }
    setRows((data as Row[]) ?? [])
    setError('')
    // Your rank among everyone this season, even outside the top 100.
    if (myId) {
      const { data: mine } = await supabase.from('profiles').select('season, season_points').eq('id', myId).maybeSingle<{ season: number; season_points: number }>()
      if (mine && mine.season === season) {
        const [{ count: above }, { count: total }] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('season', season).gt('season_points', mine.season_points),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('season', season),
        ])
        setMe({ rank: (above ?? 0) + 1, total: total ?? 0 })
      } else setMe(null)
    }
    setLoading(false)
  }, [scope, friendIds, myId, season])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 30_000)
    return () => clearInterval(id)
  }, [load])

  if (!supabase) return <EmptyState icon="🌐" title="Global leaderboard isn't available here" />
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-1.5 text-[13px] font-bold"><Globe size={14} className="text-accent" /> Season {season} · everyone</span>
        {me && <span className="num rounded bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">You: #{me.rank} of {me.total}</span>}
        <div className="ml-auto flex items-center gap-1">
          {(['all', 'friends'] as const).map((s) => (
            <button key={s} disabled={s === 'friends' && !signed} onClick={() => setScope(s)} className={clsx('flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-40', scope === s ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
              {s === 'all' ? <Globe size={11} /> : <Users size={11} />} {s === 'all' ? 'Everyone' : 'Friends'}
            </button>
          ))}
          <button onClick={() => void load()} className="rounded p-1 text-dim hover:text-ink" aria-label="Refresh"><RefreshCw size={12} className={clsx(loading && 'animate-spin')} /></button>
        </div>
      </div>
      {!signed && <div className="border-b border-line bg-accent/5 px-3 py-1.5 text-[11px] text-muted">Sign in to get on the global board: your season points count here.</div>}
      {error ? (
        <p className="px-3 py-4 text-[12px] text-down">{error}</p>
      ) : !rows.length ? (
        <EmptyState icon="🏁" title={loading ? 'Loading…' : scope === 'friends' ? 'No friends with points this season yet' : 'Nobody has season points yet. Play a ranked round!'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-dim">
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2 text-right">Season pts</th>
                <th className="px-3 py-2 text-right">Level</th>
                <th className="px-3 py-2 text-right">Last on</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const tier = tierFor(r.season_points)
                const you = r.id === myId
                return (
                  <tr key={r.id} className={clsx('border-b border-line/50', you && 'bg-accent/10 shadow-[inset_3px_0_0_var(--accent)]')}>
                    <td className="num px-3 py-1.5 font-bold">{i < 3 ? ['🥇', '🥈', '🥉'][i] : `#${i + 1}`}</td>
                    <td className="px-3 py-1.5">
                      <span className="mr-1.5">{r.avatar}</span>
                      <span className={clsx('font-semibold', you && 'text-accent')}>{r.username}</span>
                      {you && <span className="ml-1 text-[10px] text-dim">(you)</span>}
                    </td>
                    <td className="px-3 py-1.5"><span className="rounded px-1 py-px text-[9px] font-bold uppercase" style={{ color: tier.color, background: `${tier.color}1f` }}>{tier.icon} {tier.name}</span></td>
                    <td className="num px-3 py-1.5 text-right font-bold">{r.season_points}</td>
                    <td className="num px-3 py-1.5 text-right text-muted">{r.level}</td>
                    <td className="num px-3 py-1.5 text-right text-dim">{fmtAge(Math.max(0, (Date.now() - Date.parse(r.updated_at)) / 1000))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-3 py-2 text-[10px] text-dim">Signed-in players only. Points come from ranked rounds (Arena, Hardcore, Challenge) and update within a minute. Refreshes every 30s.</p>
    </div>
  )
}
