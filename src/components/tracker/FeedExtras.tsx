// Two things a timeline has besides its posts: the "What is happening" box on top of the feed, and the page of an
// account (a click on its name). Both show only what the feed already shows (the meta, what recent posts are about,
// an account's size and its own posts): nothing about which coin is right or how a story will end.
import { useEffect } from 'react'
import { X as Close } from 'lucide-react'
import { ACCOUNT_BIOS } from '../../data/sparkFlavor'
import { narrativeLabel } from '../../data/narratives'
import { faceOf, hash01 } from '../../game/feedFlavor'
import { useGame } from '../../game/store'
import { fmtCompact } from '../../utils/format'
import { VerifiedMark } from '../SparkPanel'
import { useAccountCard } from './accountCard'
import { Face, Tweet, X } from './Tweet'

/** What the last ten minutes of posts were about: the meta, the busiest hashtags, the busiest other theme. */
export function Happening() {
  const sparks = useGame((s) => s.market.sparks)
  const meta = useGame((s) => s.market.meta)
  const now = useGame((s) => s.market.time)
  if (!sparks?.length) return null
  const recent = sparks.filter((s) => now - s.time < 600)
  const tags = new Map<string, number>()
  const themes = new Map<string, number>()
  for (const s of recent) {
    for (const t of s.text.match(/#[A-Za-z0-9]{3,}/g) ?? []) tags.set(t.toLowerCase(), (tags.get(t.toLowerCase()) ?? 0) + 1)
    if (s.theme) themes.set(s.theme, (themes.get(s.theme) ?? 0) + 1)
  }
  const spelled = (tag: string) => recent.flatMap((s) => s.text.match(/#[A-Za-z0-9]{3,}/g) ?? []).find((t) => t.toLowerCase() === tag) ?? tag
  const rows: { over: string; what: string; n: number }[] = []
  if (meta) rows.push({ over: 'Meta right now', what: narrativeLabel(meta)?.label ?? meta, n: themes.get(meta) ?? 0 })
  for (const [tag, n] of [...tags].sort((a, b) => b[1] - a[1]).slice(0, 2)) rows.push({ over: 'Trending', what: spelled(tag), n })
  const other = [...themes].filter(([t]) => t !== meta).sort((a, b) => b[1] - a[1])[0]
  if (other && rows.length < 3) rows.push({ over: 'Also busy', what: narrativeLabel(other[0] as never)?.label ?? other[0], n: other[1] })
  if (!rows.length) return null
  return (
    <div className="mx-4 my-3 rounded-2xl px-3.5 py-3" style={{ background: '#16181C' }}>
      <div className="text-[17px] font-extrabold" style={{ color: X.text }}>What is happening</div>
      {rows.map((r, i) => (
        <div key={i} className="mt-2 flex items-center justify-between text-[14px]">
          <div className="min-w-0">
            <div className="text-[12px]" style={{ color: X.dim }}>{r.over}</div>
            <div className="truncate font-bold" style={{ color: X.text }}>{r.what}</div>
          </div>
          <div className="num shrink-0 text-[13px]" style={{ color: X.dim }}>{r.n} {r.n === 1 ? 'post' : 'posts'}</div>
        </div>
      ))}
    </div>
  )
}

const BANNERS = ['#1d4ed8,#7856FF', '#0f766e,#1D9BF0', '#b45309,#F91880', '#15803d,#0f766e', '#7c2d12,#b45309', '#4c1d95,#1d4ed8']

/** An account's page: who it says it is, how big, and what it has posted lately. Everything on it is made up. */
export function AccountCardHost() {
  const by = useAccountCard((s) => s.open)
  const show = useAccountCard((s) => s.show)
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => (by ? s.followedAccounts.includes(by.id) : false))
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  useEffect(() => {
    if (!by) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && show(null)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [by, show])
  if (!by) return null
  const posts = feed.filter((p) => p.by?.id === by.id).slice(0, 12)
  const h = (salt: string) => hash01(by.id + salt)
  const bio = ACCOUNT_BIOS[by.handle] ?? (by.followers >= 500_000 ? 'Posts things. People seem to like them.' : by.followers >= 20_000 ? 'posting through it' : h('bio') < 0.5 ? 'here for the vibes' : 'just a little guy on the timeline')
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-3" onClick={() => show(null)}>
      <div className="flex max-h-[88vh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border" style={{ background: X.bg, color: X.text, borderColor: X.line, fontFamily: '"Segoe UI", Inter, -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-4 px-4 py-2.5">
          <button onClick={() => show(null)} aria-label="Close" className="grid size-8 place-items-center rounded-full hover:bg-white/10"><Close size={18} /></button>
          <div className="min-w-0">
            <div className="flex items-center gap-1 truncate text-[17px] font-extrabold">{by.name}{by.verified && <VerifiedMark size={16} />}</div>
            <div className="text-[13px]" style={{ color: X.dim }}>{fmtCompact(40 + h('n') * 4000, '')} posts</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="h-24" style={{ background: `linear-gradient(90deg, ${BANNERS[Math.floor(h('ban') * BANNERS.length)]})` }} />
          <div className="border-b px-4 pb-3" style={{ borderColor: X.line }}>
            <div className="-mt-9 flex items-end justify-between">
              <span className="rounded-full border-4" style={{ borderColor: X.bg }}><Face face={by.face ?? faceOf(by.handle)} emoji={by.avatar} size={72} /></span>
              <button onClick={() => toggleFollow(by.id)} className={followed ? 'rounded-full border px-4 py-1.5 text-[14px] font-bold' : 'rounded-full bg-[#EFF3F4] px-4 py-1.5 text-[14px] font-bold text-black hover:bg-[#D7DBDC]'} style={followed ? { borderColor: '#536471' } : undefined}>{followed ? 'Following' : 'Follow'}</button>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[20px] font-extrabold leading-6">{by.name}{by.verified && <VerifiedMark size={18} />}</div>
            <div className="text-[15px]" style={{ color: X.dim }}>@{by.handle}</div>
            <p className="mt-2 text-[15px] leading-5">{bio}</p>
            <div className="mt-2 text-[14px]" style={{ color: X.dim }}>Joined {2011 + Math.floor(h('yr') * 14)} · made-up account</div>
            <div className="num mt-1.5 text-[14px]"><span className="font-bold">{Math.round(20 + h('fg') * 900)}</span> <span style={{ color: X.dim }}>Following</span>&nbsp;&nbsp; <span className="font-bold">{fmtCompact(by.followers, '')}</span> <span style={{ color: X.dim }}>Followers</span></div>
          </div>
          <div className="border-b px-4 py-2.5 text-[15px] font-bold" style={{ borderColor: X.line }}><span className="border-b-[3px] pb-2" style={{ borderColor: X.blue }}>Posts</span></div>
          {posts.length ? posts.map((p) => <Tweet key={p.id} p={p} />) : <div className="px-4 py-8 text-center text-[14px]" style={{ color: X.dim }}>Nothing from this account on your timeline lately.</div>}
        </div>
      </div>
    </div>
  )
}
