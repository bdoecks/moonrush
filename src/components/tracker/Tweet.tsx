// One post, drawn the way a real timeline draws it: picture on the left, name / check mark / handle / time on one
// line, the text, a quoted box for a screenshot, the coin it calls, and the row of reply / repost / like / view
// counts. Shared by every place the game shows the feed (the side dock, the bottom panel, the Track page), in the
// timeline's own colours (`X` below). Everything in it is made up by the game: accounts, posts and counts.
import { useState } from 'react'
import clsx from 'clsx'
import { BarChart2, Heart, MessageCircle, Repeat2 } from 'lucide-react'
import { tokenMapOf } from '../../hooks/useDerived'
import { faceOf, repliesOf } from '../../game/feedFlavor'
import { SIM_SEC_PER_TICK } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import type { SocialPost } from '../../types'
import { fmtAge, fmtCompact } from '../../utils/format'
import { QuickBuyButton } from '../chain'
import { Pct, TokenIcon } from '../ui'
import { postAccount } from '../SocialTracker'
import { VerifiedMark } from '../SparkPanel'
import { useAccountCard } from './accountCard'

/** The timeline's colours ("lights out"): background, text, quiet text, lines, and the blue of links and check marks. */
export const X = { bg: '#000000', text: '#E7E9EA', dim: '#71767B', line: '#2F3336', blue: '#1D9BF0', hover: 'rgba(231,233,234,0.03)' }
/** The style a feed's box takes: the colours above and the system fonts a timeline uses. */
export const feedStyle = { background: X.bg, color: X.text, fontFamily: '"Segoe UI", Inter, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif' }

/** An account's picture: its photo when it has one (public/faces), else its emoji. Round, like a timeline's. */
export function Face({ face, emoji, size, className }: { face?: string; emoji: string; size: number; className?: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <span className={clsx('grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#16181C]', className)} style={{ width: size, height: size, fontSize: Math.round(size / 2) }}>
      {face && !broken && /^[a-z0-9_-]+$/.test(face) ? <img src={`${import.meta.env.BASE_URL}faces/${face}.webp`} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} className="size-full object-cover" /> : emoji}
    </span>
  )
}

/** How big an account is, at a glance: the colour of its follower badge. */
const sizeLook = (followers: number) =>
  followers >= 20_000_000 ? { badge: 'bg-[#c084fc]/20 text-[#d8b4fe]', word: 'HUGE' }
  : followers >= 500_000 ? { badge: 'bg-warn/20 text-warn', word: 'BIG' }
  : followers >= 20_000 ? { badge: 'bg-[#1D9BF0]/15 text-[#1D9BF0]', word: '' }
  : { badge: 'bg-white/[0.06] text-[#71767B]', word: '' }

/**
 * The counts under a post (replies, reposts, likes, views). Made up like the post itself: they follow the account's
 * size and grow for the first minutes, the same for everybody who looks (worked out from the post, never stored).
 */
function postCounts(p: SocialPost, followers: number, ageSec: number) {
  const h = (Math.imul(p.id | 0, 0x9e3779b1) >>> 0) / 4294967296 // 0..1, fixed for this post
  const reach = Math.max(30, followers) * (0.02 + 0.1 * h) * Math.min(1, 0.08 + ageSec / 240)
  const likes = p.likes ?? Math.round(reach * 0.12)
  return { views: Math.round(reach * 6 + 20 * h), likes, reposts: p.rts ?? Math.round(likes * (0.12 + 0.2 * h)), replies: Math.round(likes * (0.04 + 0.1 * (1 - h))) }
}
const cnt = (n: number) => (n < 1000 ? String(Math.round(n)) : fmtCompact(n, ''))

export function Tweet({ p, roomy }: { p: SocialPost; roomy?: boolean }) {
  const acc = postAccount(p)
  const you = useGame((s) => (s.online ? p.author?.pid === s.online.you : p.accountId === 'player'))
  const tick = useGame((s) => s.market.tick)
  const followed = useGame((s) => (acc ? s.followedAccounts.includes(acc.id) : false))
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  const select = useGame((s) => s.select)
  const t = useGame((s) => (p.tokenId ? tokenMapOf(s.market.tokens).get(p.tokenId) : undefined))
  // (A post of the story market: what kind it is, and whether it is a screenshot of somebody else's.)
  const spark = useGame((s) => (p.sparkId ? s.market.sparks?.find((x) => x.id === p.sparkId) : undefined))
  const [open, setOpen] = useState(false)
  const showAccount = useAccountCard((s) => s.show)
  if (!acc) return null
  const since = t && p.mcapAtPost ? t.mcap / p.mcapAtPost - 1 : 0
  const look = sizeLook(acc.player ? 0 : acc.followers)
  const age = (tick - p.tick) * SIM_SEC_PER_TICK
  const n = postCounts(p, acc.followers, age)
  // (The replies under a story's post: made up from the post itself, the same for everybody. See feedFlavor.ts.)
  const thread = spark ? repliesOf(spark, age) : []
  return (
    <article className={clsx('flex gap-3 border-b px-4 transition-colors hover:bg-white/[0.03]', roomy ? 'py-3.5' : 'py-3')} style={{ borderColor: X.line }}>
      <Face face={p.by ? (p.by.face ?? faceOf(p.by.handle)) : acc.player ? undefined : faceOf(acc.handle)} emoji={acc.avatar} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px] leading-5">
          {p.by ? <button onClick={() => showAccount(p.by!)} className="truncate font-bold hover:underline" style={{ color: X.text }}>{acc.name}</button> : <span className="truncate font-bold" style={{ color: X.text }}>{acc.name}</span>}
          {acc.verified && <VerifiedMark size={16} />}
          <span className="min-w-0 shrink truncate" style={{ color: X.dim }}>@{acc.handle}</span>
          <span className="shrink-0" style={{ color: X.dim }}>· {fmtAge(age)}</span>
          {!acc.player && <button onClick={() => toggleFollow(acc.id)} className={clsx('ml-auto shrink-0 rounded-full px-3.5 py-1 text-[12px] font-bold', followed ? 'border text-[#E7E9EA]' : 'bg-[#EFF3F4] text-black hover:bg-[#D7DBDC]')} style={followed ? { borderColor: '#536471' } : undefined}>{followed ? 'Following' : 'Follow'}</button>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-bold">
          <span className={clsx('num rounded px-1.5 py-px', look.badge)} title="Followers">{look.word ? `${look.word} · ` : ''}{fmtCompact(acc.followers, '')} followers</span>
          {you && <span className="rounded bg-accent/15 px-1.5 py-px text-accent">YOU</span>}
          {acc.player && !you && <span className="rounded bg-[#1D9BF0]/15 px-1.5 py-px text-[#1D9BF0]">PLAYER</span>}
          {acc.player && acc.kol && <span className="rounded bg-warn/15 px-1.5 py-px text-warn">KOL</span>}
          {spark?.kind === 'news' && <span className="rounded bg-[#1D9BF0]/15 px-1.5 py-px text-[#1D9BF0]">NEWS</span>}
          {spark?.kind === 'tech' && <span className="rounded bg-[#8fd14f]/15 px-1.5 py-px text-[#8fd14f]">TECH</span>}
        </div>
        <p className={clsx('mt-1.5 whitespace-pre-line break-words text-[15px] leading-5', spark?.fake && 'line-through')} style={{ color: spark?.fake ? X.dim : X.text }}>
          {p.text.split(/(\$[A-Z0-9]+|#[A-Za-z0-9]+|@[A-Za-z0-9_]+)/g).map((part, i) => (/^[$#@][A-Za-z0-9_]+$/.test(part) ? <span key={i} style={{ color: X.blue }}>{part}</span> : <span key={i}>{part}</span>))}
        </p>
        {spark?.pic && (spark.kind === 'news' ? (
          <div className="mt-2.5 overflow-hidden rounded-2xl border" style={{ borderColor: X.line }}>
            <img src={`${import.meta.env.BASE_URL}posts/${spark.pic}.webp`} alt="Made-up picture with the post" loading="lazy" className="block aspect-[4/3] w-full object-cover" />
            <div className="px-3 py-2 text-[13px]" style={{ color: X.dim }}>{acc.handle}.news · made-up outlet</div>
          </div>
        ) : (
          <img src={`${import.meta.env.BASE_URL}posts/${spark.pic}.webp`} alt="Made-up picture with the post" loading="lazy" className="mt-2.5 block aspect-[4/3] w-full rounded-2xl border object-cover" style={{ borderColor: X.line }} />
        ))}
        {spark?.fake && (
          <div className="mt-2.5 rounded-xl border px-3 py-2.5 text-[13px] leading-[18px]" style={{ borderColor: 'rgba(244,33,46,0.5)', background: 'rgba(244,33,46,0.1)', color: X.text }}>
            <div className="font-bold" style={{ color: '#F4212E' }}>{spark.fake.kind === 'fake' ? 'Fake account' : spark.fake.kind === 'shot' ? 'Made-up screenshot' : 'Hacked account'}</div>
            <div>
              {spark.fake.kind === 'fake' ? `The real ${spark.fake.real?.name ?? 'account'}${spark.fake.real ? ` (@${spark.fake.real.handle})` : ''} says this was not them. Look at the handle, @${acc.handle}, and there is no check mark.`
                : spark.fake.kind === 'shot' ? `${spark.quote?.name ?? 'That account'} never posted this. A screenshot is not a post: it came from @${acc.handle}.`
                : `${acc.name} has its account back and says to ignore this post. Nothing on the post gave it away.`}
            </div>
          </div>
        )}
        {spark?.quote && (
          <div className="mt-2.5 rounded-2xl border px-3 py-2.5 text-[13px]" style={{ borderColor: X.line }}>
            <div className="flex items-center gap-1 font-bold" style={{ color: X.text }}>🖼 Screenshot <span className="font-normal" style={{ color: X.dim }}>of a post by</span> {spark.quote.name}{spark.quote.verified && <VerifiedMark size={13} />}</div>
            <div style={{ color: X.dim }}>@{spark.quote.handle} · not posted from that account</div>
          </div>
        )}
        {p.quote && (
          <div className="mt-2.5 rounded-2xl border px-3 py-2.5" style={{ borderColor: X.line }}>
            <div className="flex items-center gap-1 text-[13px] leading-4">
              <Face face={p.quote.by.face ?? faceOf(p.quote.by.handle)} emoji={p.quote.by.avatar} size={20} />
              <span className="truncate font-bold" style={{ color: X.text }}>{p.quote.by.name}</span>
              {p.quote.by.verified && <VerifiedMark size={13} />}
              <span className="min-w-0 shrink truncate" style={{ color: X.dim }}>@{p.quote.by.handle}</span>
            </div>
            <p className="mt-1 whitespace-pre-line break-words text-[14px] leading-5" style={{ color: X.text }}>{p.quote.text}</p>
          </div>
        )}
        {p.tokenId && (
          <div className="mt-2.5 flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: X.line }}>
            <button disabled={!t} onClick={() => t && select(t.id)} className="flex min-w-0 items-center gap-2 hover:underline">
              {t ? <TokenIcon token={t} size={24} /> : <span>❔</span>}
              <span className="truncate text-[14px] font-bold" style={{ color: X.text }}>{p.ticker}</span>
            </button>
            <span className="num text-[13px]" style={{ color: X.dim }}>{t ? fmtCompact(t.mcap) : 'delisted'}</span>
            {t && p.mcapAtPost ? <Pct v={since} className="text-[13px]" /> : null}
            {t && <span className="ml-auto"><QuickBuyButton t={t} className="h-7 px-2 text-[11px]" /></span>}
          </div>
        )}
        <div className="num mt-2.5 flex max-w-[420px] items-center justify-between text-[13px]" style={{ color: X.dim }}>
          <span className="flex items-center gap-1.5"><MessageCircle size={16} /> {cnt(Math.max(n.replies, thread.length))}</span>
          <span className="flex items-center gap-1.5"><Repeat2 size={17} /> {cnt(n.reposts)}</span>
          <span className="flex items-center gap-1.5"><Heart size={16} /> {cnt(n.likes)}</span>
          <span className="flex items-center gap-1.5"><BarChart2 size={16} /> {cnt(n.views)}</span>
        </div>
        {p.tokenId && p.buyers !== undefined && <div className="mt-1 text-[12px]" style={{ color: X.dim }}>🦍 <span className={p.buyers ? 'font-semibold text-up' : ''}>{p.buyers} aped</span></div>}
        {!!p.replies?.length && <div className="mt-1 truncate text-[12px] italic" style={{ color: X.dim }}>{p.replies.map((r) => `“${r}”`).join('  ')}</div>}
        {thread.length > 0 && (
          <div className="mt-2.5 border-l-2 pl-3" style={{ borderColor: X.line }}>
            {(open ? thread : thread.slice(-2)).map((r, i) => (
              <div key={i} className="flex gap-2 py-1">
                <Face face={r.face} emoji={r.avatar} size={24} />
                <div className="min-w-0 text-[13px] leading-[18px]">
                  <span className="font-bold" style={{ color: X.text }}>{r.name}</span> <span style={{ color: X.dim }}>@{r.handle}</span>
                  <div className="break-words" style={{ color: X.text }}>{r.text}</div>
                </div>
              </div>
            ))}
            {thread.length > 2 && <button onClick={() => setOpen(!open)} className="py-1 text-[13px] hover:underline" style={{ color: X.blue }}>{open ? 'Show fewer replies' : `Show ${thread.length - 2} more ${thread.length - 2 === 1 ? 'reply' : 'replies'}`}</button>}
          </div>
        )}
      </div>
    </article>
  )
}
