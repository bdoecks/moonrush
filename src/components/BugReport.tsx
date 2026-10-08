// "Report a bug" and "Share an idea": two short forms anybody can send (Help, Settings and the buttons in the top bar
// open them). The game adds where the player was by itself and shows them exactly what goes with it. Admins read
// them in Admin > Bug reports and Admin > Ideas.
import clsx from 'clsx'
import { Bug, Lightbulb } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BUG_DOING_MAX, BUG_MAX, BUG_MIN, cleanBugText, IDEA_WANTS, type IdeaWant, type ReportKind } from '../game/bugReports'
import { useGame } from '../game/store'
import { bugContext, sendBugReport } from '../net/bugs'
import { Modal } from './ui'

const box = 'w-full resize-y rounded-md border border-line2 bg-panel2 px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-accent/60'

const TEXT = {
  bug: {
    title: 'Report a bug', emoji: '🐞', toast: 'BUG REPORT SENT', send: 'Send report',
    lead: 'Found something broken, wrong or confusing? Tell us in your own words.',
    what: 'What went wrong?', whatHint: 'For example: I sold my whole bag but the coin still shows in my portfolio.', whatAria: 'What went wrong',
    more: 'What were you doing just before?', moreHint: 'For example: I clicked Sell 100% twice quickly.', moreAria: 'What you were doing just before',
    after: "Every report is read. You won't get a reply here, but fixes land in the game.",
    with: 'Sent with it, so we can find the problem:',
  },
  idea: {
    title: 'Share an idea', emoji: '💡', toast: 'IDEA SENT', send: 'Send idea',
    lead: 'What does the game need? What should change, or go? Tell us in your own words.',
    what: "What's your idea?", whatHint: 'For example: let me sort my portfolio by profit.', whatAria: 'Your idea',
    more: 'Why would it make the game better?', moreHint: 'For example: with 20 bags I cannot find my winners.', moreAria: 'Why it would make the game better',
    after: "Every idea is read. You won't get a reply here, but the good ones land in the game.",
    with: 'Sent with it, so we know where you were:',
  },
} as const

function ReportModal({ kind }: { kind: ReportKind }) {
  const setModal = useGame((s) => s.setModal)
  const notify = useGame((s) => s.notify)
  const [what, setWhat] = useState('')
  const [doing, setDoing] = useState('')
  const [want, setWant] = useState<IdeaWant>('add')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const ctx = useMemo(() => bugContext(), [])
  const enough = cleanBugText(what, BUG_MAX).length >= BUG_MIN
  const t = TEXT[kind]
  const idea = kind === 'idea'

  const submit = async () => {
    setBusy(true)
    setError('')
    const r = await sendBugReport(what, doing, idea ? { want } : undefined)
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Could not send it. Please try again.')
    setSent(true)
    notify({ title: t.toast, body: 'Thank you. It goes straight to the team.', tone: 'info', icon: t.emoji })
  }

  if (sent) {
    return (
      <Modal title={t.title} onClose={() => setModal(null)}>
        <div className="space-y-3 text-center">
          <div className="text-[34px]">{t.emoji}</div>
          <div className="text-[14px] font-semibold text-ink">Sent. Thank you!</div>
          <p className="text-[12px] text-muted">{t.after}</p>
          <button onClick={() => setModal(null)} className="h-9 w-full rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110">Back to the game</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title={<span className="flex items-center gap-1.5">{idea ? <Lightbulb size={15} /> : <Bug size={15} />} {t.title}</span>} onClose={() => setModal(null)}>
      <div className="space-y-3 text-[12px]">
        <p className="text-muted">{t.lead}</p>
        {idea && (
          <div>
            <span className="mb-1 block font-semibold text-ink">It is about…</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="What the idea is about">
              {IDEA_WANTS.map((w) => (
                <button key={w.id} type="button" onClick={() => setWant(w.id)} aria-pressed={want === w.id} className={clsx('rounded-md border px-2.5 py-1 text-[12px] font-semibold', want === w.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                  {w.emoji} {w.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block font-semibold text-ink">{t.what}</span>
          <textarea value={what} onChange={(e) => setWhat(e.target.value.slice(0, BUG_MAX))} rows={4} autoFocus placeholder={t.whatHint} className={box} aria-label={t.whatAria} />
          <span className="mt-0.5 block text-right text-[10px] text-dim">{what.length} / {BUG_MAX}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold text-ink">{t.more} <span className="font-normal text-dim">(optional)</span></span>
          <textarea value={doing} onChange={(e) => setDoing(e.target.value.slice(0, BUG_DOING_MAX))} rows={2} placeholder={t.moreHint} className={box} aria-label={t.moreAria} />
        </label>
        <div className="rounded-md border border-line bg-panel2/50 px-2.5 py-2 text-[11px] text-dim">
          <div className="mb-0.5 font-semibold text-muted">{t.with}</div>
          the page you are on ({ctx.page}), where you are playing ({ctx.mode}){ctx.coin ? `, the coin you have open ($${ctx.coin})` : ''}, your screen size and browser{!idea && ctx.errors?.length ? `, and the last ${ctx.errors.length} error${ctx.errors.length === 1 ? '' : 's'} the game ran into` : ''}. Nothing about your wallet, your balances or your email.
        </div>
        {error && <p className="rounded-md border border-down/40 bg-down/10 px-2 py-1.5 text-down" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => setModal(null)} className="h-9 flex-1 rounded-md border border-line2 text-[13px] font-semibold text-muted hover:text-ink">Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !enough} className="h-9 flex-[2] rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-50">{busy ? 'Sending…' : t.send}</button>
        </div>
      </div>
    </Modal>
  )
}

export const BugReportModal = () => <ReportModal kind="bug" />
export const IdeaModal = () => <ReportModal kind="idea" />
