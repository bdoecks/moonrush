import clsx from 'clsx'
import { AtSign, Send, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTokenMap } from '../../hooks/useDerived'
import { ACCOUNTS, callerKey } from '../../game/socialEngine'
import { useGame } from '../../game/store'
import type { SimWallet, SocialPost, Token } from '../../types'
import { fmtAge, fmtCompact, fmtUsd, toneClass } from '../../utils/format'
import { QuickBuyButton } from '../chain'
import { EmptyState, TokenIcon } from '../ui'

const accById = new Map(ACCOUNTS.map((a) => [a.id, a]))
const th = 'h-8 px-2.5 text-[11px] font-medium text-dim whitespace-nowrap'
const td = 'px-2.5 py-1.5 whitespace-nowrap'

interface Caller {
  key: string
  name: string
  handle: string
  avatar: string
  platform: 'x' | 'tg' | 'player'
  followers: number
  walletId?: string
}

function callerOf(p: SocialPost): Caller {
  const acc = accById.get(p.accountId)
  if (acc) return { key: acc.id, name: acc.name, handle: acc.handle, avatar: acc.avatar, platform: acc.platform, followers: acc.followers, walletId: acc.walletId }
  return { key: callerKey(p), name: p.author?.name ?? 'Player', handle: p.author?.handle ?? 'player', avatar: p.author?.avatar ?? '🧑', platform: 'player', followers: p.author?.followers ?? 0 }
}

const hash = (n: number) => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** What the caller holds of the coin they called: a KOL's real wallet, a player's public main wallet, else an estimate. */
function useHolding(p: SocialPost, c: Caller, t: Token | undefined, wallets: SimWallet[]) {
  const players = useGame((s) => s.online?.players)
  const me = useGame((s) => s.online?.you)
  const myPos = useGame((s) => (p.tokenId ? s.portfolio.positions[p.tokenId] : undefined))
  if (!t || !p.tokenId || !p.mcapAtPost) return null
  if (c.walletId) {
    const w = wallets.find((x) => x.id === c.walletId)
    const pos = w?.positions[p.tokenId]
    const traded = w?.trades.some((tr) => tr.tokenId === p.tokenId)
    if (pos && pos.qty > 0) return { value: pos.qty * t.price, pnl: pos.qty * t.price - pos.cost, sold: false, est: false }
    return traded ? { value: 0, pnl: 0, sold: true, est: false } : { value: 0, pnl: 0, sold: false, none: true, est: false }
  }
  if (c.platform === 'player') {
    const pid = p.author?.pid
    if (!pid || pid === me) return myPos && myPos.qty > 0 ? { value: myPos.qty * t.price, pnl: myPos.qty * t.price - myPos.costBasis, sold: false, est: false } : { value: 0, pnl: 0, sold: false, none: true, est: false }
    const h = players?.find((x) => x.id === pid)?.holdings?.find((x) => x.tokenId === p.tokenId)
    return h ? { value: h.qty * t.price, pnl: h.qty * t.price - h.cost, sold: false, est: false } : { value: 0, pnl: 0, sold: false, none: true, est: false }
  }
  // TG channels don't show a wallet: estimate the bag they bought before calling, and how much they dumped into it.
  const r = hash(p.id)
  const bag = 150 + r * 4000
  const peakX = (p.peakMcap ?? p.mcapAtPost) / p.mcapAtPost
  const sold = Math.min(1, Math.max(0, (peakX - 1.2) * 0.7 + hash(p.id + 7) * 0.25))
  const nowX = t.mcap / p.mcapAtPost
  const value = bag * (1 - sold) * nowX
  return sold >= 0.98 ? { value: 0, pnl: 0, sold: true, est: true } : { value, pnl: value - bag * (1 - sold), sold: false, est: true }
}

/** Axiom-style Callout Tracker: calls from the callers you follow (or everyone), plus a Callers ranking. */
export function CalloutTracker() {
  const [view, setView] = useState<'feed' | 'callers'>('feed')
  const [scope, setScope] = useState<'following' | 'all'>('all')
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => s.followedAccounts)
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  const now = useGame((s) => s.market.time)
  const wallets = useGame((s) => s.wallets)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  const calls = useMemo(() => feed.filter((p) => p.isCall && p.tokenId && p.mcapAtPost), [feed])
  const shown = scope === 'following' ? calls.filter((p) => followed.includes(callerKey(p))) : calls

  // Callers ranking: every caller that has made a call, plus the TG channels / KOLs even before they do.
  const callers = useMemo(() => {
    const agg = new Map<string, { c: Caller; n: number; wins: number; peak: number; now: number; best: { x: number; ticker: string } | null }>()
    for (const a of ACCOUNTS.filter((x) => x.kind === 'caller' || x.kind === 'kol')) {
      agg.set(a.id, { c: { key: a.id, name: a.name, handle: a.handle, avatar: a.avatar, platform: a.platform, followers: a.followers, walletId: a.walletId }, n: 0, wins: 0, peak: 0, now: 0, best: null })
    }
    for (const p of calls) {
      const c = callerOf(p)
      const a = agg.get(c.key) ?? { c, n: 0, wins: 0, peak: 0, now: 0, best: null }
      const t = map.get(p.tokenId!)
      const peakX = (p.peakMcap ?? p.mcapAtPost!) / p.mcapAtPost!
      a.n++
      a.peak += peakX
      a.now += t ? t.mcap / p.mcapAtPost! : 0
      if (peakX >= 2) a.wins++
      if (!a.best || peakX > a.best.x) a.best = { x: peakX, ticker: p.ticker ?? '?' }
      agg.set(c.key, a)
    }
    return [...agg.values()].sort((x, y) => (y.n ? y.peak / y.n : 0) - (x.n ? x.peak / x.n : 0) || y.c.followers - x.c.followers)
  }, [calls, map])
  const allKeys = callers.map((c) => c.c.key)
  const followingAll = allKeys.every((k) => followed.includes(k))
  const followAll = () => {
    for (const k of allKeys) if (followingAll ? followed.includes(k) : !followed.includes(k)) toggleFollow(k)
  }

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['feed', 'callers'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={clsx('rounded-md border px-2.5 py-1 text-[12px] font-bold', view === v ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
            {v === 'feed' ? '📣 Callout Tracker' : '🏆 Callers'}
          </button>
        ))}
        {view === 'feed' && (
          <div className="ml-2 flex items-center gap-1 text-[11px]">
            {(['all', 'following'] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)} className={clsx('rounded px-2 py-0.5 font-semibold', scope === s ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
                {s === 'all' ? 'All callers' : `Following ${followed.filter((k) => allKeys.includes(k) || k.startsWith('player:')).length}`}
              </button>
            ))}
          </div>
        )}
        <button onClick={followAll} className="ml-auto rounded-md border border-line2 px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink">{followingAll ? 'Unfollow all' : '⭐ Follow all callers'}</button>
      </div>

      {view === 'feed' ? (
        !shown.length ? (
          <EmptyState icon="📣" title={scope === 'following' ? 'No calls from callers you follow yet' : 'No calls yet this session'} hint={scope === 'following' ? 'Follow callers with ⭐ (or Follow all). Their calls land here and ping you.' : 'KOLs and TG channels post calls as the market moves'} />
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-panel">
            <table className="w-full min-w-[900px] text-[12px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={clsx(th, 'text-left')}>Age</th>
                  <th className={clsx(th, 'text-left')}>Caller</th>
                  <th className={clsx(th, 'text-left')}>Token</th>
                  <th className={clsx(th, 'text-right')}>Call MC</th>
                  <th className={clsx(th, 'text-right')}>Now</th>
                  <th className={clsx(th, 'text-right')}>Now X</th>
                  <th className={clsx(th, 'text-right')}>Peak X</th>
                  <th className={clsx(th, 'text-right')} title="What the caller holds of the coin right now">Caller holds</th>
                  <th className={clsx(th, 'text-right')}>Buy</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <CallRow key={p.id} p={p} t={map.get(p.tokenId!)} now={now} wallets={wallets} followed={followed.includes(callerKey(p))} onFollow={() => toggleFollow(callerKey(p))} onOpen={(id) => select(id)} />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <table className="w-full min-w-[820px] text-[12px]">
            <thead>
              <tr className="border-b border-line">
                <th className={clsx(th, 'text-left')}>#</th>
                <th className={clsx(th, 'text-left')}>Caller</th>
                <th className={clsx(th, 'text-right')}>Followers</th>
                <th className={clsx(th, 'text-right')}>Calls</th>
                <th className={clsx(th, 'text-right')} title="Calls that went 2X or more after the call">Win rate</th>
                <th className={clsx(th, 'text-right')}>Avg peak</th>
                <th className={clsx(th, 'text-right')}>Avg now</th>
                <th className={clsx(th, 'text-right')}>Best call</th>
                <th className={clsx(th, 'text-right')}>Follow</th>
              </tr>
            </thead>
            <tbody>
              {callers.map((a, i) => {
                const on = followed.includes(a.c.key)
                return (
                  <tr key={a.c.key} className="border-b border-line/40 hover:bg-panel2">
                    <td className={clsx(td, 'num text-dim')}>{i + 1}</td>
                    <td className={td}><CallerName c={a.c} /></td>
                    <td className={clsx(td, 'num text-right text-muted')}>{fmtCompact(a.c.followers).replace('$', '')}</td>
                    <td className={clsx(td, 'num text-right')}>{a.n || '—'}</td>
                    <td className={clsx(td, 'num text-right', a.n && a.wins / a.n >= 0.4 ? 'text-up' : 'text-muted')}>{a.n ? `${Math.round((a.wins / a.n) * 100)}%` : '—'}</td>
                    <td className={clsx(td, 'num text-right', a.n && a.peak / a.n >= 2 ? 'text-up font-semibold' : 'text-muted')}>{a.n ? `${(a.peak / a.n).toFixed(2)}X` : '—'}</td>
                    <td className={clsx(td, 'num text-right', a.n ? toneClass(a.now / a.n - 1) : 'text-dim')}>{a.n ? `${(a.now / a.n).toFixed(2)}X` : '—'}</td>
                    <td className={clsx(td, 'num text-right text-muted')}>{a.best ? <>${a.best.ticker} <span className={a.best.x >= 2 ? 'text-up' : ''}>{a.best.x.toFixed(1)}X</span></> : '—'}</td>
                    <td className={clsx(td, 'text-right')}><FollowBtn on={on} onClick={() => toggleFollow(a.c.key)} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-dim">Stats cover this session's calls. Win = the coin went 2X or more after the call. Real players who post calls show up here too.</p>
        </div>
      )}
    </div>
  )
}

function CallRow({ p, t, now, wallets, followed, onFollow, onOpen }: { p: SocialPost; t?: Token; now: number; wallets: SimWallet[]; followed: boolean; onFollow: () => void; onOpen: (id: string) => void }) {
  const c = callerOf(p)
  const hold = useHolding(p, c, t, wallets)
  const nowX = t ? t.mcap / p.mcapAtPost! : 0
  const peakX = (p.peakMcap ?? p.mcapAtPost!) / p.mcapAtPost!
  return (
    <tr className="border-b border-line/40 hover:bg-panel2">
      <td className={clsx(td, 'num text-dim')}>{fmtAge(Math.max(0, now - p.time))}</td>
      <td className={td}><span className="flex items-center gap-1.5"><FollowBtn on={followed} onClick={onFollow} small /><CallerName c={c} /></span></td>
      <td className={td}>
        <button disabled={!t} onClick={() => t && onOpen(t.id)} className="flex items-center gap-1.5 hover:text-accent">
          {t && <TokenIcon token={t} size={18} />}<span className="font-bold">{p.ticker}</span>
        </button>
      </td>
      <td className={clsx(td, 'num text-right text-muted')}>{fmtCompact(p.mcapAtPost!)}</td>
      <td className={clsx(td, 'num text-right')}>{t ? fmtCompact(t.mcap) : 'delisted'}</td>
      <td className={clsx(td, 'num text-right font-semibold', toneClass(nowX - 1))}>{t ? `${nowX.toFixed(2)}X` : '—'}</td>
      <td className={clsx(td, 'num text-right', peakX >= 2 ? 'font-bold text-up' : 'text-muted')}>{peakX.toFixed(2)}X</td>
      <td className={clsx(td, 'num text-right')}>
        {!hold ? '—' : hold.sold ? <span className="font-semibold text-down">Sold all</span> : 'none' in hold && hold.none ? <span className="text-dim">No bag</span> : (
          <span title={hold.est ? 'Estimated: TG channels don’t show a wallet' : undefined}>
            {fmtUsd(hold.value, 0)} <span className={clsx('text-[10px]', toneClass(hold.pnl))}>{hold.pnl >= 0 ? '+' : '-'}{fmtUsd(Math.abs(hold.pnl), 0)}</span>
            {hold.est && <span className="ml-0.5 text-[9px] text-dim">est.</span>}
          </span>
        )}
      </td>
      <td className={clsx(td, 'text-right')}><QuickBuyButton t={t} className="py-0.5" /></td>
    </tr>
  )
}

function CallerName({ c }: { c: Caller }) {
  return (
    <span className="flex items-center gap-1">
      <span>{c.avatar}</span>
      <span className="font-semibold">{c.name}</span>
      {c.platform === 'tg' ? <Send size={10} className="text-info" /> : c.platform === 'x' ? <AtSign size={10} className="text-muted" /> : <span className="rounded bg-accent/10 px-1 text-[9px] font-bold text-accent">PLAYER</span>}
    </span>
  )
}

function FollowBtn({ on, onClick, small }: { on: boolean; onClick: () => void; small?: boolean }) {
  return (
    <button onClick={onClick} title={on ? 'Unfollow' : 'Follow: their calls land in your Callout Tracker and ping you'} className={clsx('inline-flex items-center gap-1 rounded-md font-semibold', small ? 'p-0.5' : 'border px-2 py-0.5 text-[11px]', on ? 'border-warn/50 text-warn' : 'border-line2 text-dim hover:text-ink')}>
      <Star size={small ? 11 : 11} fill={on ? 'currentColor' : 'none'} />
      {!small && (on ? 'Following' : 'Follow')}
    </button>
  )
}
