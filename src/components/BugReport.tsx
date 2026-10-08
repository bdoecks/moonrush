// "Report a bug": a short form anybody can send (Help, Settings and the bug button in the top bar open it). The game
// adds where the player was by itself and shows them exactly what goes with the report. Admins read them in Admin.
import { Bug } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BUG_DOING_MAX, BUG_MAX, BUG_MIN, cleanBugText } from '../game/bugReports'
import { useGame } from '../game/store'
import { bugContext, sendBugReport } from '../net/bugs'
import { Modal } from './ui'

export function BugReportModal() {
  const setModal = useGame((s) => s.setModal)
  const notify = useGame((s) => s.notify)
  const [what, setWhat] = useState('')
  const [doing, setDoing] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const ctx = useMemo(() => bugContext(), [])
  const enough = cleanBugText(what, BUG_MAX).length >= BUG_MIN

  const submit = async () => {
    setBusy(true)
    setError('')
    const r = await sendBugReport(what, doing)
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Could not send it. Please try again.')
    setSent(true)
    notify({ title: 'BUG REPORT SENT', body: 'Thank you. It goes straight to the team.', tone: 'info', icon: '🐞' })
  }

  if (sent) {
    return (
      <Modal title="Report a bug" onClose={() => setModal(null)}>
        <div className="space-y-3 text-center">
          <div className="text-[34px]">🐞</div>
          <div className="text-[14px] font-semibold text-ink">Sent. Thank you!</div>
          <p className="text-[12px] text-muted">Every report is read. You won't get a reply here, but fixes land in the game.</p>
          <button onClick={() => setModal(null)} className="h-9 w-full rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110">Back to the game</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title={<span className="flex items-center gap-1.5"><Bug size={15} /> Report a bug</span>} onClose={() => setModal(null)}>
      <div className="space-y-3 text-[12px]">
        <p className="text-muted">Found something broken, wrong or confusing? Tell us in your own words.</p>
        <label className="block">
          <span className="mb-1 block font-semibold text-ink">What went wrong?</span>
          <textarea
            value={what} onChange={(e) => setWhat(e.target.value.slice(0, BUG_MAX))} rows={4} autoFocus
            placeholder="For example: I sold my whole bag but the coin still shows in my portfolio."
            className="w-full resize-y rounded-md border border-line2 bg-panel2 px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-accent/60"
            aria-label="What went wrong"
          />
          <span className="mt-0.5 block text-right text-[10px] text-dim">{what.length} / {BUG_MAX}</span>
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold text-ink">What were you doing just before? <span className="font-normal text-dim">(optional)</span></span>
          <textarea
            value={doing} onChange={(e) => setDoing(e.target.value.slice(0, BUG_DOING_MAX))} rows={2}
            placeholder="For example: I clicked Sell 100% twice quickly."
            className="w-full resize-y rounded-md border border-line2 bg-panel2 px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-dim focus:border-accent/60"
            aria-label="What you were doing just before"
          />
        </label>
        <div className="rounded-md border border-line bg-panel2/50 px-2.5 py-2 text-[11px] text-dim">
          <div className="mb-0.5 font-semibold text-muted">Sent with it, so we can find the problem:</div>
          the page you are on ({ctx.page}), where you are playing ({ctx.mode}){ctx.coin ? `, the coin you have open ($${ctx.coin})` : ''}, your screen size and browser{ctx.errors?.length ? `, and the last ${ctx.errors.length} error${ctx.errors.length === 1 ? '' : 's'} the game ran into` : ''}. Nothing about your wallet, your balances or your email.
        </div>
        {error && <p className="rounded-md border border-down/40 bg-down/10 px-2 py-1.5 text-down" role="alert">{error}</p>}
        <div className="flex gap-2">
          <button onClick={() => setModal(null)} className="h-9 flex-1 rounded-md border border-line2 text-[13px] font-semibold text-muted hover:text-ink">Cancel</button>
          <button onClick={() => void submit()} disabled={busy || !enough} className="h-9 flex-[2] rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-50">{busy ? 'Sending…' : 'Send report'}</button>
        </div>
      </div>
    </Modal>
  )
}
