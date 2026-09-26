import clsx from 'clsx'
import { AtSign, Send } from 'lucide-react'
import { useState } from 'react'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { ACCOUNTS } from '../game/socialEngine'
import { useGame } from '../game/store'
import type { SocialPost } from '../types'
import { fmtAge, fmtCompact } from '../utils/format'
import { EmptyState, Pct, TokenIcon } from './ui'

const byId = new Map(ACCOUNTS.map((a) => [a.id, a]))

/** GMGN-style social tracker for the bottom dock: live X / TG posts, filterable, click a coin to open it. */
export function SocialTracker() {
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => s.followedAccounts)
  const [scope, setScope] = useState<'all' | 'following' | 'calls'>('all')
  const [platform, setPlatform] = useState<'all' | 'x' | 'tg'>('all')
  const posts = feed.filter((p) => {
    const acc = byId.get(p.accountId)
    if (!acc) return false
    if (platform !== 'all' && acc.platform !== platform) return false
    if (scope === 'following' && !followed.includes(acc.id)) return false
    if (scope === 'calls' && !p.tokenId) return false
    return true
  })
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1 text-[11px]">
        {(['all', 'following', 'calls'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className={clsx('font-semibold capitalize', scope === s ? 'text-ink' : 'text-dim hover:text-muted')}>
            {s === 'following' ? `Following ${followed.length}` : s === 'calls' ? 'Calls only' : 'All'}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          {(['all', 'x', 'tg'] as const).map((p) => (
            <button key={p} onClick={() => setPlatform(p)} aria-pressed={platform === p} className={clsx('flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold', platform === p ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
              {p === 'x' ? <><AtSign size={10} /> X</> : p === 'tg' ? <><Send size={10} /> TG</> : 'All'}
            </button>
          ))}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {posts.length === 0 ? (
          <EmptyState icon="📣" title={scope === 'following' ? 'No posts from accounts you follow' : 'No posts yet'} hint={scope === 'following' ? 'Follow accounts here or on the Track tab' : 'Posts appear as the market moves'} />
        ) : (
          posts.slice(0, 80).map((p) => <Row key={p.id} p={p} />)
        )}
      </div>
    </div>
  )
}

function Row({ p }: { p: SocialPost }) {
  const acc = byId.get(p.accountId)!
  const tick = useGame((s) => s.market.tick)
  const followed = useGame((s) => s.followedAccounts.includes(acc.id))
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  const select = useGame((s) => s.select)
  const t = useGame((s) => (p.tokenId ? s.market.tokens.find((x) => x.id === p.tokenId) : undefined))
  const since = t && p.mcapAtPost ? t.mcap / p.mcapAtPost - 1 : 0
  return (
    <div className="slide-in flex items-start gap-2 border-b border-line/50 px-3 py-1.5 hover:bg-panel2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[13px]">{acc.avatar}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-bold">{acc.name}</span>
          <span className="text-dim">@{acc.handle}</span>
          {acc.platform === 'tg' ? <Send size={10} className="text-info" /> : <AtSign size={10} className="text-dim" />}
          <span className="num text-[10px] text-dim">{fmtCompact(acc.followers, '')} · {fmtAge((tick - p.tick) * SIM_SEC_PER_TICK)}</span>
          <button onClick={() => toggleFollow(acc.id)} className={clsx('ml-auto rounded-full px-2 text-[9px] font-bold', followed ? 'border border-line2 text-muted' : 'bg-ink text-bg')}>{followed ? 'Following' : 'Follow'}</button>
        </div>
        <p className="truncate text-[11px] text-ink/90" title={p.text}>{p.text.replace(/\n/g, ' ')}</p>
      </div>
      {p.tokenId && (
        <button disabled={!t} onClick={() => t && select(t.id)} className="flex shrink-0 items-center gap-1.5 self-center rounded-md border border-line bg-bg px-1.5 py-1 text-[11px] hover:border-accent/50">
          {t ? <TokenIcon token={t} size={16} /> : <span>❔</span>}
          <span className="font-bold">{p.ticker}</span>
          <span className="num text-muted">{t ? fmtCompact(t.mcap) : '—'}</span>
          {t && p.mcapAtPost ? <Pct v={since} className="text-[10px]" /> : null}
        </button>
      )}
    </div>
  )
}
