// The Story tab under a coin's chart: what happened on it, newest first, and what the price did next.
// Every line says where it comes from (the market's own facts, generated story, outside data): see SRC_META.
import clsx from 'clsx'
import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useGame } from '../../game/store'
import type { Beat, BeatSource, Token } from '../../types'
import { fmtAge, fmtCompact, fmtTime } from '../../utils/format'
import { EmptyState } from '../ui'
import { ARC_LABEL, BEAT_ICON, BEAT_LABEL, movePct, SRC_META } from './beatMeta'

type Filter = 'all' | BeatSource
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'story', label: 'Story' },
  { id: 'market', label: 'Market' },
  { id: 'trend', label: 'Outside data' },
]

export function StoryTab({ token }: { token: Token }) {
  const now = useGame((s) => s.market.time)
  const [filter, setFilter] = useState<Filter>('all')
  const beats = useMemo(() => [...(token.beats ?? [])].sort((a, b) => b.time - a.time || b.id - a.id), [token.beats])
  const shown = filter === 'all' ? beats : beats.filter((b) => b.src === filter)
  const told = beats.filter((b) => b.arc) // the coin's own story, newest first
  const latest = told[0]
  const state = !latest ? null : latest.kind === 'fade' ? 'the timeline has moved on' : latest.kind === 'drama' ? 'turned sour' : now - latest.time > 240 ? `quiet for ${fmtAge(now - latest.time)}` : 'running'

  return (
    <div className="min-w-[520px]">
      <div className="sticky left-0 top-0 z-[2] flex h-8 items-center gap-1 overflow-x-auto border-b border-line/40 bg-panel px-2 no-scrollbar">
        {FILTERS.map((f) => {
          const n = f.id === 'all' ? beats.length : beats.filter((b) => b.src === f.id).length
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={clsx('flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors', filter === f.id ? 'bg-raise text-ink' : 'text-dim hover:bg-panel2 hover:text-muted')}
            >
              {f.label}
              <span className="num text-[10px] font-medium text-dim">{n}</span>
            </button>
          )
        })}
        {latest?.arc && (
          <span className="ml-2 flex shrink-0 items-center gap-1.5 text-[11px] text-muted" title="The story this coin's posts belong to, and where it stands">
            <span className="font-semibold text-ink">{ARC_LABEL[latest.arc]}</span>
            <span className="text-dim">· {told.length} {told.length === 1 ? 'development' : 'developments'} · {state}</span>
            {latest.heat !== undefined && latest.kind !== 'fade' && <Heat value={latest.heat} />}
          </span>
        )}
        <span
          className="ml-auto flex shrink-0 cursor-help items-center gap-1 text-[10px] text-dim"
          title={'A post reaches this feed a few seconds after it was made: the fastest wallets have already reacted, as they would to a real post. Most posts go nowhere, and a story can turn sour without notice.\n\nSTORY lines are generated: the accounts, outlets and brands are invented. MARKET lines are facts read off this simulated market\'s trades. OUTSIDE DATA is a theme that was hot in real launches, shown with its source and date; Help lists where every kind of data comes from.'}
        >
          <Info size={11} /> How to read this
        </span>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon="🍃"
          title={beats.length ? 'Nothing of that kind on this coin yet' : 'Nothing has happened on this coin yet'}
          hint="Large trades, milestones, and what the timeline says about it show up here, with what the price did next."
        />
      ) : (
        shown.map((b) => <BeatRow key={b.id} b={b} now={now} />)
      )}
    </div>
  )
}

function BeatRow({ b, now }: { b: Beat; now: number }) {
  const src = SRC_META[b.src]
  const byAccount = b.src !== 'market' && !!b.by
  const age = now - b.time
  return (
    <div className="flex items-start gap-2.5 border-b border-line/30 px-3 py-1.5 hover:bg-panel2/70">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[13px] leading-none" title={BEAT_LABEL[b.kind]}>{byAccount ? b.by!.avatar : BEAT_ICON[b.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className={clsx('text-[12px] leading-snug', b.tone === 'down' ? 'text-down' : b.tone === 'warn' ? 'text-warn' : 'text-ink')}>{b.text}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-dim">
          <span className={clsx('rounded px-1 text-[9px] font-bold tracking-wide', src.cls)} title={src.hint}>{src.label}</span>
          {byAccount ? (
            <span className="text-muted">@{b.by!.name}{b.by!.followers ? <span className="num text-dim"> · {fmtCompact(b.by!.followers, '')} followers</span> : null}</span>
          ) : (
            <span className="text-muted">{BEAT_LABEL[b.kind]}</span>
          )}
          {b.src === 'story' && b.heat !== undefined && <Heat value={b.heat} />}
          <span className="num">at {fmtCompact(b.mcap)} MC</span>
          {b.why && <span className="text-muted">{b.why}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right leading-tight">
        <Then b={b} age={age} />
        <div className="num text-[10px] text-dim" title={fmtTime(b.time)}>{fmtAge(age)} ago</div>
      </div>
    </div>
  )
}

/** What the price did in the minute after a beat (the figure arrives when that minute is up). */
function Then({ b, age }: { b: Beat; age: number }) {
  if (b.move === undefined) return <div className="num text-[11px] text-dim" title="What the price does in the minute after this: the figure arrives when the minute is up">{age < 60 ? `then… ${Math.max(1, Math.ceil(60 - age))}s` : 'then…'}</div>
  return (
    <div className={clsx('num text-[12px] font-semibold', b.move >= 0 ? 'text-up' : 'text-down')} title="What the price did in the minute after this happened">
      <span className="mr-1 text-[10px] font-medium text-dim">then</span>
      {movePct(b.move)}
    </div>
  )
}

/** How much attention a post got, 0..100, as five small bars. */
export function Heat({ value }: { value: number }) {
  const lit = Math.max(0, Math.min(5, Math.ceil(value / 20)))
  return (
    <span className="inline-flex items-end gap-px" title={`Heat ${Math.round(value)} of 100: how much attention it got`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={clsx('w-[3px] rounded-sm', i < lit ? (value >= 80 ? 'bg-down' : value >= 45 ? 'bg-warn' : 'bg-[#8fd14f]') : 'bg-line2')} style={{ height: 4 + i * 1.5 }} />
      ))}
    </span>
  )
}
