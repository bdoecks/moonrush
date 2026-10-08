// V2 stage 4: where the game's content comes from, on one small panel (Help, and the Story tab's "Sources").
// Three kinds, kept apart everywhere: simulated, generated, outside data (with its source, date and whether it is stale).
import clsx from 'clsx'
import { describeSources } from '../game/dataSources'
import { useGame } from '../game/store'

const TONE = { simulated: 'bg-info/15 text-info', generated: 'bg-[#8fd14f]/15 text-[#8fd14f]', outside: 'bg-warn/15 text-warn' } as const

export function DataSources({ compact }: { compact?: boolean }) {
  const feed = useGame((s) => s.market.trends)
  const rows = describeSources(feed, Date.now())
  return (
    <div className={clsx('rounded-lg border border-line bg-panel2/40', compact ? 'p-2' : 'p-3')} role="group" aria-label="Where the data comes from">
      {!compact && <div className="mb-2 text-[12px] font-semibold text-ink">Where the data comes from</div>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.kind} className="text-[11px] leading-snug">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={clsx('rounded px-1 text-[9px] font-bold tracking-wide', TONE[r.kind])}>{r.title.toUpperCase()}</span>
              <span className="font-semibold text-ink">{r.what}</span>
              {r.kind === 'outside' && r.status !== 'ok' && <span className={clsx('rounded px-1 text-[9px] font-bold', r.status === 'stale' ? 'bg-down/15 text-down' : 'bg-panel2 text-dim')}>{r.status === 'stale' ? 'OUT OF DATE' : 'NOT CONNECTED'}</span>}
            </div>
            <div className="mt-0.5 text-muted">From: {r.from}. <span className="text-dim">{r.note}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
