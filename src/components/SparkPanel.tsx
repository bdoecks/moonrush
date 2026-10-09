// The story market on screen (see game/sparks.ts): a post that coins were launched on, who made it, the coins devs
// launched on it in the order they came, and what the timeline did in the end. Nothing here says which coin is "the
// right one" before the timeline has settled: reading the post against the names is the player's job.
// The posts and their accounts are generated story (invented, and marked so); the coins and prices are the simulated
// market's own.
import clsx from 'clsx'
import { BadgeCheck, Layers, X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { QuickBuyButton } from './chain'
import { TokenIcon } from './ui'
import { SRC_META } from './token/beatMeta'
import { devPctOf } from '../game/ledger'
import { useGame } from '../game/store'
import type { Spark, Token } from '../types'
import { fmtAge, fmtCompact } from '../utils/format'

/** The check mark beside an account's name. */
export function VerifiedMark({ size = 11 }: { size?: number }) {
  return <span title="This account has a check mark" className="inline-flex shrink-0 text-info"><BadgeCheck size={size} aria-label="Check mark" /></span>
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
const RISK_CLS: Record<Token['riskLevel'], string> = { LOW: 'border-up/25 text-up', MEDIUM: 'border-info/25 text-info', HIGH: 'border-warn/30 text-warn', EXTREME: 'border-down/30 text-down' }
const live = (t: Token) => t.status === 'bonding' || t.status === 'graduated'

/** What became of a post, in one line (null while the timeline has not settled). */
const FAKE_TEXT = { fake: 'It came out: this was an impersonator, not the real account', shot: 'It came out: the screenshot was made up, the account never posted it', hack: 'It came out: the account was hacked, the post was not theirs' }
function outcome(s: Spark, now: number) {
  if (s.fake) return `${FAKE_TEXT[s.fake.kind]} (${fmtAge(Math.max(0, now - s.fake.time))} ago). The crowd left every coin on it`
  if (s.picked) return `The timeline settled on $${s.picked.ticker} ${fmtAge(Math.max(0, now - s.picked.time))} ago`
  if (s.over !== undefined) return `The timeline moved on ${fmtAge(Math.max(0, now - s.over))} ago: no coin was picked`
  return null
}

/** The post itself: who, how big, and what they said. */
export function SparkPost({ s, now, small }: { s: Spark; now: number; small?: boolean }) {
  return (
    <div className={clsx('rounded-lg border border-line bg-bg', small ? 'p-2' : 'p-3')}>
      <div className="flex items-center gap-2">
        <span className={clsx('grid shrink-0 place-items-center rounded-full bg-raise', small ? 'size-6 text-[13px]' : 'size-9 text-[18px]')}>{s.by.avatar}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className={clsx('flex items-center gap-1 font-bold text-ink', small ? 'text-[11px]' : 'text-[13px]')}>
            <span className="truncate">{s.by.name}</span>
            {s.by.verified && <VerifiedMark size={small ? 11 : 13} />}
          </div>
          <div className="num truncate text-[10px] text-dim">@{s.by.handle} · {fmtCompact(s.by.followers, '')} followers · {fmtAge(Math.max(0, now - s.time))} ago</div>
        </div>
        <span className="shrink-0 rounded bg-raise px-1 text-[9px] font-bold text-muted">{s.kind === 'news' ? 'NEWS' : s.kind === 'tech' ? 'TECH' : 'POST'}</span>
        <span className={clsx('shrink-0 rounded px-1 text-[8px] font-bold', SRC_META.story.cls)} title={SRC_META.story.hint}>{SRC_META.story.label}</span>
      </div>
      <p className={clsx('whitespace-pre-line leading-snug text-ink/90', small ? 'mt-1.5 text-[11px]' : 'mt-2 text-[13px]')}>{s.text}</p>
      {s.quote && <div className="mt-1.5 flex items-center gap-1 rounded border border-line2 px-1.5 py-0.5 text-[10px] text-muted">🖼 A screenshot. It says <b className="text-ink">{s.quote.name}</b>{s.quote.verified && <VerifiedMark size={10} />} <span className="text-dim">@{s.quote.handle}</span> posted this</div>}
    </div>
  )
}

/** On a post in a tracker: how many coins were launched on it. Opens the post's panel. */
export function SparkChip({ id, wide }: { id: string; wide?: boolean }) {
  // (A number and an object that only changes when the post does: neither redraws the row on every tick.)
  const n = useGame((s) => {
    let k = 0
    for (const t of s.market.tokens) if (t.spark?.id === id) k++
    return k
  })
  const spark = useGame((s) => s.market.sparks?.find((x) => x.id === id))
  const open = useGame((s) => s.openSpark)
  if (!spark && !n) return null
  const done = spark?.fake ? 'not real' : spark?.picked ? `$${spark.picked.ticker} picked` : spark?.over !== undefined ? 'moved on' : null
  return (
    <button
      type="button" onClick={() => open(id)} title="See the coins launched on this post"
      className={clsx('flex items-center gap-1.5 rounded-md border border-line bg-bg px-1.5 py-1 text-[10px] font-semibold text-muted hover:border-accent/50 hover:text-ink', wide && 'w-full')}
    >
      <Layers size={11} className="shrink-0 text-info" />
      <span className="num">{n ? `${n} coin${n === 1 ? '' : 's'} launched on this` : 'No coins on the market'}</span>
      {done && <span className={clsx('ml-auto truncate', spark?.fake ? 'text-down' : spark?.picked ? 'text-up' : 'text-dim')}>{done}</span>}
    </button>
  )
}

/**
 * Where a coin came from: the post it was launched on, how soon after, its place among the coins on that post, and
 * what the timeline did. For the leaf on a Trenches card and the coin page's Story tab (`onOpen` adds the button
 * that opens the whole post).
 */
export function SparkSource({ t, now, onOpen }: { t: Token; now: number; onOpen?: () => void }) {
  const id = t.spark?.id
  const spark = useGame((s) => (id ? s.market.sparks?.find((x) => x.id === id) : undefined))
  if (!t.spark || !spark) return null
  const after = Math.max(0, t.createdAt - spark.time)
  const end = spark.fake ? { text: FAKE_TEXT[spark.fake.kind], cls: 'text-down' } : spark.picked
    ? spark.picked.tokenId === t.id ? { text: 'The timeline settled on this coin', cls: 'text-up' } : { text: `The timeline settled on another coin on this post ($${spark.picked.ticker})`, cls: 'text-down' }
    : spark.over !== undefined ? { text: 'The timeline moved on: no coin on this post was picked', cls: 'text-dim' }
    : { text: 'The timeline has not settled on a coin yet', cls: 'text-warn' }
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[10px] text-muted">
        <Layers size={10} className="shrink-0 text-info" />
        <span>Launched {fmtAge(after)} after this post · the {ordinal(t.spark.n)} coin on it</span>
      </div>
      <SparkPost s={spark} now={now} small />
      <div className={clsx('mt-1 text-[10px] font-semibold', end.cls)}>{end.text}</div>
      {onOpen && <button type="button" onClick={onOpen} className="mt-1.5 rounded-md border border-line px-2 py-1 text-[10px] font-semibold text-muted hover:border-accent/50 hover:text-ink">See every coin launched on this post</button>}
    </div>
  )
}

/** The panel of one post: the post, what became of it, and its coins in the order they were launched. */
export function SparkDrawer() {
  const id = useGame((s) => s.sparkOpen)
  const openSpark = useGame((s) => s.openSpark)
  const spark = useGame((s) => (id ? s.market.sparks?.find((x) => x.id === id) : undefined))
  const tokens = useGame((s) => s.market.tokens)
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const coins = useMemo(() => (id ? tokens.filter((t) => t.spark?.id === id).sort((a, b) => a.spark!.n - b.spark!.n) : []), [tokens, id])

  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      openSpark(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, openSpark])

  if (!id) return null
  const close = () => openSpark(null)
  const gone = coins.length ? Math.max(0, coins[coins.length - 1].spark!.n - coins.length) : 0
  const end = spark ? outcome(spark, now) : null
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside role="dialog" aria-label="Coins launched on this post" className="sheet-up flex h-full w-full max-w-[480px] flex-col border-l border-line2 bg-panel shadow-2xl md:animate-none">
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          <Layers size={14} className="text-info" />
          <h2 className="text-[13px] font-bold">Coins launched on this post</h2>
          <button onClick={close} className="ml-auto rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {spark ? <SparkPost s={spark} now={now} /> : <p className="rounded-lg border border-line bg-bg p-3 text-[12px] text-dim">This post has left the timeline.</p>}
          {spark && (
            <p className={clsx('mt-2 rounded-md border px-2.5 py-1.5 text-[11px] leading-snug', spark.fake ? 'border-down/40 bg-down/5 text-down' : spark.picked ? 'border-up/30 bg-up/5 text-up' : spark.over !== undefined ? 'border-line text-dim' : 'border-warn/30 bg-warn/5 text-warn')}>
              {end ?? 'The timeline has not settled on a coin yet. Most posts go nowhere. When one does catch on, the crowd ends up in ONE of these coins and leaves the others.'}
            </p>
          )}
          <div className="mt-3 mb-1 flex items-center text-[10px] font-semibold uppercase tracking-wide text-dim">
            <span>In the order they were launched</span>
            <span className="num ml-auto normal-case">{coins.length} on the market</span>
          </div>
          {coins.length === 0 ? (
            <p className="rounded-lg border border-line bg-bg p-4 text-center text-[12px] text-dim">{spark && !end ? 'No coin yet. Devs usually launch within seconds of a post.' : 'No coin launched on this post is on the market any more.'}</p>
          ) : (
            <ul className="space-y-1.5">
              {coins.map((t) => {
                const picked = spark?.picked?.tokenId === t.id
                return (
                  <li key={t.id} className={clsx('rounded-lg border bg-bg', picked ? 'border-up/50' : 'border-line', !live(t) && 'opacity-60')}>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <span className="num w-5 shrink-0 text-center text-[10px] font-bold text-dim">#{t.spark!.n}</span>
                      <button type="button" onClick={() => { select(t.id); close() }} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-accent" title="Open this coin">
                        <TokenIcon token={t} size={26} />
                        <span className="min-w-0 leading-tight">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-bold text-ink">{t.name}</span>
                            {picked && <span className="shrink-0 rounded bg-up/15 px-1 text-[9px] font-bold text-up">PICKED</span>}
                          </span>
                          <span className="num block truncate text-[11px] text-info">${t.ticker}</span>
                        </span>
                      </button>
                      <span className="shrink-0 text-right leading-tight">
                        <span className="num block text-[12px] font-semibold text-ink">{fmtCompact(t.mcap)}</span>
                        <span className="num block text-[10px] text-dim">{t.status === 'graduated' ? 'migrated' : t.status === 'bonding' ? `curve ${t.bondingProgress.toFixed(0)}%` : t.status}</span>
                      </span>
                      {live(t) && <QuickBuyButton t={t} className="h-6 shrink-0 px-1.5 text-[10px]" />}
                    </div>
                    <div className="num flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line/50 px-2 py-1 text-[10px] text-dim">
                      <span>{fmtAge(Math.max(0, t.createdAt - (spark?.time ?? t.createdAt)))} after the post</span>
                      <span className={clsx('rounded border px-1 font-semibold', RISK_CLS[t.riskLevel])}>{t.riskLevel === 'EXTREME' ? '☠ ' : ''}{t.riskLevel} risk</span>
                      <span>dev {devPctOf(t).toFixed(1)}%</span>
                      <span>{t.holders} holder{t.holders === 1 ? '' : 's'}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {gone > 0 && <p className="mt-2 text-[10px] text-dim">{gone} more {gone === 1 ? 'was' : 'were'} launched on it and {gone === 1 ? 'has' : 'have'} left the market.</p>}
          <p className="mt-3 border-t border-line pt-2 text-[10px] leading-snug text-dim">
            The post and its account are made up by the game (generated story): no real person or outlet said this. The coins, their prices and every trade are this simulated market's own.
          </p>
        </div>
      </aside>
    </div>
  )
}
