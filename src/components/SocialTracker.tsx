import clsx from 'clsx'
import { AtSign, Crown, Paperclip, Send } from 'lucide-react'
import { useState } from 'react'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { ACCOUNTS, callAppeal, followerCapPerDay, followersLeftToday, freshSocial, KOL_FOLLOWERS, POST_COOLDOWN_TICKS } from '../game/socialEngine'
import { playerAuthor, useGame } from '../game/store'
import type { SocialPost } from '../types'
import { fmtAge, fmtCompact } from '../utils/format'
import { EmptyState, Pct, TokenIcon } from './ui'

const byId = new Map(ACCOUNTS.map((a) => [a.id, a]))

/** Who wrote a post: one of the simulated accounts, or a real player (you or someone in your room). */
export function postAccount(p: SocialPost) {
  if (p.accountId === 'player' && p.author) {
    return { id: `player:${p.author.pid ?? p.author.handle}`, platform: 'x' as const, name: p.author.name, handle: p.author.handle, avatar: p.author.avatar, followers: p.author.followers, player: true, kol: p.author.followers >= KOL_FOLLOWERS }
  }
  const a = byId.get(p.accountId)
  return a ? { ...a, player: false, kol: a.kind === 'kol' } : undefined
}

/** Likes, retweets, how many aped, and a couple of replies (player posts). */
export function Engagement({ p }: { p: SocialPost }) {
  if (p.likes === undefined) return null
  return (
    <div className="mt-1 text-[10px] text-dim">
      <span className="num">❤️ {p.likes} · 🔁 {p.rts ?? 0}{p.tokenId ? <> · <span className={p.buyers ? 'font-semibold text-up' : ''}>🦍 {p.buyers ?? 0} aped</span></> : null}</span>
      {!!p.replies?.length && <div className="mt-0.5 truncate italic">{p.replies.map((r) => `“${r}”`).join('  ')}</div>}
    </div>
  )
}

/** Write a post. Attach a coin (or type its $TICKER) and it becomes a call the bots may ape. */
export function Composer({ compact }: { compact?: boolean }) {
  // Select stable store values and derive in render (a selector returning a new object would re-render forever).
  const socialRaw = useGame((s) => s.profile.social)
  const social = { ...freshSocial(), ...(socialRaw ?? {}) }
  const tick = useGame((s) => s.market.tick)
  const tokens = useGame((s) => s.market.tokens)
  const positions = useGame((s) => s.portfolio.positions)
  const selectedId = useGame((s) => s.selectedId)
  const tradable = (t: { status: string }) => t.status === 'bonding' || t.status === 'graduated'
  const selected = tokens.find((t) => t.id === selectedId && tradable(t))
  const held = tokens.filter((t) => positions[t.id] && tradable(t)).slice(0, 3)
  const post = useGame((s) => s.postSocial)
  const [text, setText] = useState('')
  const [coinId, setCoinId] = useState<string | null>(null)
  const coin = coinId ? tokens.find((t) => t.id === coinId) : undefined
  const me = playerAuthor()
  const wait = Math.max(0, POST_COOLDOWN_TICKS - (tick - social.lastPostTick))
  const appeal = coin ? callAppeal(coin) : 0
  const attach = (id: string, ticker: string) => {
    if (coinId === id) return setCoinId(null)
    setCoinId(id)
    if (!text.includes(`$${ticker}`)) setText((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}$${ticker} `)
  }
  const submit = () => {
    if (!text.trim() || wait > 0) return
    if (post(text, coin?.id)) {
      setText('')
      setCoinId(null)
    }
  }
  const picks = [...(selected ? [selected] : []), ...held.filter((h) => h.id !== selected?.id)].slice(0, 4)
  return (
    <div className="shrink-0 border-b border-line bg-panel2/40 px-2 py-2">
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="grid size-5 place-items-center rounded-full bg-raise text-[11px]">{me.avatar}</span>
        <span className="font-bold text-ink">{me.name}</span>
        <span className="num text-dim" title="Followers: how many people see your posts">👥 {fmtCompact(social.followers, '')}</span>
        <span className={clsx('num', followersLeftToday(social) === 0 ? 'text-warn' : 'text-dim')} title={`You can gain up to ${fmtCompact(followerCapPerDay(social.followers), '')} followers a day. Resets at midnight (UTC).`}>+{fmtCompact(followersLeftToday(social), '')} left today</span>
        <span className="num text-dim" title="Caller reputation: whether readers trust your calls. Goes up when your calls run, down when they dump.">⭐ {Math.round(social.rep)}</span>
        {social.followers >= KOL_FOLLOWERS && <span className="flex items-center gap-0.5 rounded bg-warn/15 px-1 font-bold text-warn"><Crown size={9} /> KOL</span>}
        {wait > 0 && <span className="num ml-auto text-warn">{wait}s</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 200))}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit() }}
        rows={compact ? 2 : 2}
        placeholder="Shill something… add a coin to make it a call"
        aria-label="Write a post"
        className="mt-1.5 w-full resize-none rounded-md border border-line2 bg-bg px-2 py-1 text-[11px] outline-none placeholder:text-dim focus:border-accent/60"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Paperclip size={10} className="text-dim" />
        {picks.length === 0 && <span className="text-[10px] text-dim">open or hold a coin to attach it</span>}
        {picks.map((t) => (
          <button key={t.id} onClick={() => attach(t.id, t.ticker)} aria-pressed={coinId === t.id} className={clsx('flex items-center gap-1 rounded px-1 py-px text-[10px] font-semibold', coinId === t.id ? 'bg-info/20 text-info' : 'bg-raise text-muted hover:text-ink')}>
            <TokenIcon token={t} size={12} />${t.ticker}
          </button>
        ))}
        <button disabled={!text.trim() || wait > 0} onClick={submit} className="ml-auto flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-[10px] font-bold text-bg disabled:opacity-40">
          <Send size={10} /> Post
        </button>
      </div>
      {coin && (
        <div className={clsx('mt-1 text-[10px]', appeal > 0.45 ? 'text-up' : appeal > 0.25 ? 'text-warn' : 'text-down')}>
          {appeal > 0.45 ? '🔥 readers will like this call' : appeal > 0.25 ? '🤔 some might bite' : '🥶 looks rough, few will ape'} · more followers + rep = more buyers
        </div>
      )}
    </div>
  )
}

/** GMGN-style social tracker for the bottom dock: live X / TG posts, filterable, click a coin to open it. */
export function SocialTracker() {
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => s.followedAccounts)
  const [scope, setScope] = useState<'all' | 'following' | 'calls'>('all')
  const [platform, setPlatform] = useState<'all' | 'x' | 'tg'>('all')
  const posts = feed.filter((p) => {
    const acc = postAccount(p)
    if (!acc) return false
    if (platform !== 'all' && acc.platform !== platform) return false
    if (scope === 'following' && !followed.includes(acc.id) && !acc.player) return false
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
      <Composer compact />
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
  const acc = postAccount(p)!
  const tick = useGame((s) => s.market.tick)
  const you = useGame((s) => (s.online ? p.author?.pid === s.online.you : p.accountId === 'player'))
  const followed = useGame((s) => s.followedAccounts.includes(acc.id))
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  const select = useGame((s) => s.select)
  const t = useGame((s) => (p.tokenId ? s.market.tokens.find((x) => x.id === p.tokenId) : undefined))
  const since = t && p.mcapAtPost ? t.mcap / p.mcapAtPost - 1 : 0
  return (
    <div className={clsx('slide-in flex items-start gap-2 border-b border-line/50 px-3 py-1.5 hover:bg-panel2', acc.player && 'bg-info/[0.04]')}>
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[13px]">{acc.avatar}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-bold">{acc.name}</span>
          {you && <span className="rounded bg-accent/15 px-1 text-[9px] font-bold text-accent">YOU</span>}
          {acc.player && !you && <span className="rounded bg-info/15 px-1 text-[9px] font-bold text-info">PLAYER</span>}
          <span className="text-dim">@{acc.handle}</span>
          {acc.platform === 'tg' ? <Send size={10} className="text-info" /> : <AtSign size={10} className="text-dim" />}
          <span className="num text-[10px] text-dim">{fmtCompact(acc.followers, '')} · {fmtAge((tick - p.tick) * SIM_SEC_PER_TICK)}</span>
          {!acc.player && <button onClick={() => toggleFollow(acc.id)} className={clsx('ml-auto rounded-full px-2 text-[9px] font-bold', followed ? 'border border-line2 text-muted' : 'bg-ink text-bg')}>{followed ? 'Following' : 'Follow'}</button>}
        </div>
        <p className="truncate text-[11px] text-ink/90" title={p.text}>{p.text.replace(/\n/g, ' ')}</p>
        <Engagement p={p} />
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
