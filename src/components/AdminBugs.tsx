// Admin > Bug reports and Admin > Ideas: what players sent through "Report a bug" and "Share an idea", newest first.
// Mark one done, leave yourself a note, or delete it. Only admins can read the table (the database enforces it).
import clsx from 'clsx'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { IDEA_WANTS, type BugReport, type BugStatus, type ReportKind } from '../game/bugReports'
import { useGame } from '../game/store'
import { deleteBugReport, loadBugReports, markBugReport } from '../net/bugs'
import { fmtAge } from '../utils/format'
import { EmptyState } from './ui'

const CLS: Record<BugStatus, string> = { open: 'bg-warn/15 text-warn', fixed: 'bg-up/15 text-up', wontfix: 'bg-panel2 text-dim' }
/** The same three states under each kind's own words. */
const WORDS: Record<ReportKind, { labels: Record<BugStatus, string>; done: string; no: string; icon: string; empty: string; hint: string; more: string }> = {
  bug: { labels: { open: 'Open', fixed: 'Fixed', wontfix: 'Not a bug' }, done: 'Mark fixed', no: 'Not a bug', icon: '🐞', empty: 'No open bug reports', hint: 'Players send them from Help → Report a bug.', more: 'Just before: ' },
  idea: { labels: { open: 'New', fixed: 'Done', wontfix: 'Not doing' }, done: 'Mark done', no: 'Not doing', icon: '💡', empty: 'No new ideas', hint: 'Players send them from Help → Share an idea.', more: 'Why: ' },
}

export function AdminBugs({ onCount, kind = 'bug' }: { onCount?: (open: number) => void; kind?: ReportKind }) {
  const words = WORDS[kind]
  const STATUS = { open: { label: words.labels.open, cls: CLS.open }, fixed: { label: words.labels.fixed, cls: CLS.fixed }, wontfix: { label: words.labels.wontfix, cls: CLS.wontfix } }
  const notify = useGame((s) => s.notify)
  const [rows, setRows] = useState<BugReport[]>([])
  const [error, setError] = useState('')
  const [show, setShow] = useState<BugStatus | 'all'>('open')
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const r = await loadBugReports(kind)
    setRows(r.rows)
    setError(r.error ? (/does not exist|schema cache/i.test(r.error) ? 'The bug_reports table is not there yet: run supabase/009_bug_reports.sql in the Supabase SQL editor.' : r.error) : '')
    setLoading(false)
    onCount?.(r.rows.filter((x) => x.status === 'open').length)
  }, [onCount, kind])
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 60_000)
    return () => clearInterval(id)
  }, [load])

  const fail = (body: string) => notify({ title: 'ADMIN FAILED', body, tone: 'warn', icon: '⚠️' })
  const mark = async (b: BugReport, status: BugStatus) => {
    const e = await markBugReport(b.id, { status })
    if (e) return fail(e)
    void load()
  }
  const saveNote = async (b: BugReport) => {
    const e = await markBugReport(b.id, { note: (notes[b.id] ?? '').trim().slice(0, 1000) || null })
    if (e) return fail(e)
    setNotes(({ [b.id]: _, ...rest }) => rest)
    void load()
  }
  const remove = async (b: BugReport) => {
    if (!window.confirm('Delete this report for good?')) return
    const e = await deleteBugReport(b.id)
    if (e) return fail(e)
    void load()
  }

  const count = (s: BugStatus) => rows.filter((r) => r.status === s).length
  const shown = show === 'all' ? rows : rows.filter((r) => r.status === show)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {(['open', 'fixed', 'wontfix', 'all'] as const).map((s) => (
          <button key={s} onClick={() => setShow(s)} className={clsx('rounded-md border px-2.5 py-1 text-[12px] font-bold', show === s ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line2 text-muted hover:text-ink')}>
            {s === 'all' ? `All ${rows.length}` : `${STATUS[s].label} ${count(s)}`}
          </button>
        ))}
        <button onClick={() => void load()} className="ml-auto flex items-center gap-1 rounded-md border border-line2 px-2 py-1 text-[12px] text-muted hover:text-ink" title="Reload"><RefreshCw size={12} /> Reload</button>
      </div>
      {error && <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-[12px] text-down">{error}</div>}
      {!error && !loading && !shown.length && <EmptyState icon={words.icon} title={show === 'open' ? words.empty : 'Nothing here'} hint={words.hint} />}
      {shown.map((b) => {
        const c = b.context ?? {}
        const draft = notes[b.id]
        return (
          <div key={b.id} className="rounded-lg border border-line bg-panel p-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className={clsx('rounded px-1.5 py-px text-[10px] font-bold', STATUS[b.status]?.cls)}>{STATUS[b.status]?.label ?? b.status}</span>
              {c.want && <span className="rounded bg-accent/15 px-1.5 py-px text-[10px] font-bold text-accent">{IDEA_WANTS.find((w) => w.id === c.want)?.label ?? c.want}</span>}
              <span className="font-semibold text-ink">{b.username || 'Guest'}</span>
              <span className="text-[10px] text-dim">{b.user_id ? 'signed in' : 'guest'} · #{b.id} · {fmtAge(Math.max(0, (Date.now() - Date.parse(b.created_at)) / 1000))} ago · {new Date(b.created_at).toLocaleString()}</span>
              <span className="ml-auto flex gap-1">
                {b.status !== 'fixed' && <button onClick={() => void mark(b, 'fixed')} className="rounded border border-up/50 px-2 py-0.5 text-[11px] font-semibold text-up hover:bg-up/10">{words.done}</button>}
                {b.status !== 'wontfix' && <button onClick={() => void mark(b, 'wontfix')} className="rounded border border-line2 px-2 py-0.5 text-[11px] font-semibold text-muted hover:text-ink">{words.no}</button>}
                {b.status !== 'open' && <button onClick={() => void mark(b, 'open')} className="rounded border border-warn/50 px-2 py-0.5 text-[11px] font-semibold text-warn hover:bg-warn/10">Reopen</button>}
                <button onClick={() => void remove(b)} className="rounded border border-down/40 p-1 text-down hover:bg-down/10" title="Delete this report" aria-label="Delete this report"><Trash2 size={12} /></button>
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-[13px] text-ink">{b.what}</p>
            {b.doing && <p className="mt-1.5 whitespace-pre-wrap break-words text-muted"><span className="font-semibold text-dim">{words.more}</span>{b.doing}</p>}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-dim">
              {c.page && <span>Page: <span className="text-muted">{c.page}</span></span>}
              {c.mode && <span>Playing: <span className="text-muted">{c.mode}</span></span>}
              {c.engine && <span>Market: <span className="text-muted">{c.engine}</span></span>}
              {c.coin && <span>Coin: <span className="text-muted">${c.coin}</span></span>}
              {c.screen && <span>Screen: <span className="text-muted">{c.screen}</span></span>}
              {c.version && <span>Game: <span className="text-muted">{c.version}</span></span>}
            </div>
            {c.browser && <div className="mt-0.5 truncate text-[10px] text-dim" title={c.browser}>Browser: {c.browser}</div>}
            {!!c.errors?.length && (
              <div className="mt-1.5 rounded border border-down/30 bg-down/5 px-2 py-1 text-[10px] text-down">
                <div className="font-semibold">Errors the game ran into before the report:</div>
                {c.errors.map((e, i) => <div key={i} className="num break-words">{e}</div>)}
              </div>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <input
                value={draft ?? b.note ?? ''} onChange={(e) => setNotes({ ...notes, [b.id]: e.target.value })}
                placeholder="Your note (only you see it)" aria-label="Your note on this report"
                className="h-7 min-w-0 flex-1 rounded border border-line2 bg-panel2 px-2 text-[12px] text-ink outline-none placeholder:text-dim focus:border-warn/60"
              />
              {draft !== undefined && draft !== (b.note ?? '') && <button onClick={() => void saveNote(b)} className="h-7 rounded border border-warn/50 px-2 text-[11px] font-semibold text-warn hover:bg-warn/10">Save note</button>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
