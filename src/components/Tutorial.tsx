// The tutorial card: one step at a time, in a corner, while the player uses the real game. A step that asks for an
// action waits and moves on by itself; the others have a Next button. The part of the screen a step talks about gets
// a ring. Also the one-time "new here?" offer when somebody plays their first round. (Steps: game/tutorials.ts.)
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, GraduationCap, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useGame } from '../game/store'
import { baseOf, TUTORIALS, type TutorialBase, type TutorialId, type TutorialView } from '../game/tutorials'
import { useCooking } from '../hooks/useLabs'
import { load, save } from '../utils/storage'

const viewNow = (): TutorialView => {
  const s = useGame.getState()
  const coin = s.selectedId ? s.market.tokens.find((t) => t.id === s.selectedId) : undefined
  return { view: s.view, selectedId: s.selectedId, selectedIsMine: coin?.creator === 'you', trades: s.portfolio.trades, launches: s.launches }
}

interface TutorialState {
  id: TutorialId | null
  step: number
  base: TutorialBase
  start: (id: TutorialId) => void
  go: (step: number) => void
  stop: () => void
}
export const useTutorial = create<TutorialState>((set) => ({
  id: null, step: 0, base: { trades: 0, launches: 0 },
  start: (id) => {
    save('tutOffered', true)
    set({ id, step: 0, base: baseOf(viewNow()) })
  },
  go: (step) => set({ step, base: baseOf(viewNow()) }),
  stop: () => set({ id: null, step: 0 }),
}))

/** The tutorials a player has finished (for the ticks in Help). */
export const tutorialsDone = (): TutorialId[] => load<TutorialId[]>('tutDone') ?? []

/** Where on the screen the first visible match of a step's targets is. */
function useTargetRect(targets: string[] | undefined) {
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const key = (targets ?? []).join('|')
  useEffect(() => {
    if (!key) return setRect(null)
    const find = () => {
      for (const sel of key.split('|')) {
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect()
          if (r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth) {
            return setRect((old) => (old && Math.abs(old.x - r.left) < 1 && Math.abs(old.y - r.top) < 1 && Math.abs(old.w - r.width) < 1 && Math.abs(old.h - r.height) < 1 ? old : { x: r.left, y: r.top, w: r.width, h: r.height }))
          }
        }
      }
      setRect(null)
    }
    // What the step talks about may be further down the page: bring it into view once, when the step opens.
    for (const sel of key.split('|')) {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((x) => x.getBoundingClientRect().width > 4)
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      break
    }
    find()
    const id = setInterval(find, 400)
    return () => clearInterval(id)
  }, [key])
  return rect
}

export function Tutorial() {
  const { id, step, base, go, stop, start } = useTutorial()
  const running = useGame((s) => s.runStatus === 'running')
  const modal = useGame((s) => s.modal)
  const cooking = useCooking()
  const def = id ? TUTORIALS[id] : null
  const cur = def?.steps[step]
  const rect = useTargetRect(modal ? undefined : cur?.target)
  const [offer, setOffer] = useState(() => !load<boolean>('tutOffered'))

  // A step that asks for an action: watch the game and move on when it has happened.
  const done = useGame(() => (cur?.done ? cur.done(viewNow(), base) : false))
  useEffect(() => {
    if (!def || !cur?.done || !done) return
    const t = setTimeout(() => go(Math.min(step + 1, def.steps.length - 1)), 600)
    return () => clearTimeout(t)
  }, [def, cur, done, step, go])

  const card = 'fixed bottom-32 left-2 right-2 z-40 rounded-lg border bg-panel/95 p-3 shadow-2xl backdrop-blur md:bottom-20 md:left-3 md:right-auto md:w-[320px]'

  if (!def || !cur) {
    // The one-time offer, to somebody playing their first round.
    if (!offer || !running || modal) return null
    const no = () => {
      save('tutOffered', true)
      setOffer(false)
    }
    return (
      <div role="region" aria-label="Tutorial offer" className={clsx(card, 'border-accent/50')}>
        <div className="flex items-center gap-2 text-[13px] font-bold text-ink"><GraduationCap size={16} className="text-accent" /> New here?</div>
        <p className="mt-1 text-[12px] text-muted">A {TUTORIALS.trading.minutes}-minute tutorial walks you through your first trade, with play money. You can also find it later in Help.</p>
        <div className="mt-2 flex gap-2">
          <button onClick={no} className="h-8 flex-1 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:text-ink">No thanks</button>
          <button onClick={() => { setOffer(false); start('trading') }} className="h-8 flex-[2] rounded-md bg-accent text-[12px] font-extrabold text-accent-ink hover:brightness-110">Start the tutorial</button>
        </div>
      </div>
    )
  }

  const last = step === def.steps.length - 1
  const finish = () => {
    save('tutDone', [...new Set([...tutorialsDone(), def.id])])
    stop()
  }
  const closed = def.id === 'deving' && !cooking // (the Cooking page was closed while the tutorial was open)
  return (
    <>
      {rect && !closed && <div aria-hidden className="pointer-events-none fixed z-40 animate-pulse rounded-lg ring-2 ring-accent ring-offset-2 ring-offset-bg" style={{ left: rect.x - 2, top: rect.y - 2, width: rect.w + 4, height: rect.h + 4 }} />}
      <div role="region" aria-label="Tutorial" className={clsx(card, 'border-accent/60')}>
        <div className="flex items-center gap-2">
          <span className="text-[14px]">{def.icon}</span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-accent">{def.name} tutorial</span>
          <span className="num text-[10px] text-dim">{step + 1} / {def.steps.length}</span>
          <button onClick={stop} className="ml-auto rounded p-1 text-dim hover:text-ink" aria-label="Close the tutorial" title="Close (you can start it again from Help)"><X size={14} /></button>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-line2"><div className="h-full bg-accent transition-all" style={{ width: `${((step + 1) / def.steps.length) * 100}%` }} /></div>
        {closed ? (
          <p className="mt-2 text-[12px] text-muted">Cooking is closed for now while it is being reworked, so this tutorial can't go on. It will be back with it.</p>
        ) : (
          <>
            <div className="mt-2 text-[14px] font-bold text-ink">{cur.title}</div>
            <div className="mt-1 max-h-[30vh] space-y-1.5 overflow-y-auto text-[12px] leading-snug text-muted">{cur.body.map((p, i) => <p key={i}>{p}</p>)}</div>
            {cur.todo && <div className={clsx('mt-2 rounded-md border px-2 py-1.5 text-[12px] font-semibold', done ? 'border-up/50 bg-up/10 text-up' : 'border-warn/50 bg-warn/10 text-warn')}>{done ? '✓ Done' : `👉 ${cur.todo}`}</div>}
            {cur.todo && !running && <div className="mt-1 text-[11px] text-dim">Start a round first (pick Practice): the tutorial needs a market that is running.</div>}
          </>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => go(step - 1)} disabled={step === 0} className="flex h-8 items-center gap-0.5 rounded-md border border-line2 px-2 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-30"><ChevronLeft size={13} /> Back</button>
          {last || closed ? (
            <button onClick={finish} className="h-8 flex-1 rounded-md bg-accent text-[12px] font-extrabold text-accent-ink hover:brightness-110">Finish</button>
          ) : (
            <button onClick={() => go(step + 1)} className={clsx('flex h-8 flex-1 items-center justify-center gap-0.5 rounded-md text-[12px] font-extrabold', cur.done && !done ? 'border border-line2 text-muted hover:text-ink' : 'bg-accent text-accent-ink hover:brightness-110')}>{cur.done && !done ? 'Skip this step' : 'Next'} <ChevronRight size={13} /></button>
          )}
        </div>
      </div>
    </>
  )
}

/** The two tutorials as buttons, for Help. */
export function TutorialButtons({ onStart }: { onStart?: () => void }) {
  const start = useTutorial((s) => s.start)
  const cooking = useCooking()
  const done = tutorialsDone()
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(Object.values(TUTORIALS)).filter((t) => t.id !== 'deving' || cooking).map((t) => (
        <button key={t.id} onClick={() => { start(t.id); onStart?.() }} className="rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-left hover:border-accent">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink">{t.icon} {t.name} tutorial{done.includes(t.id) && <span className="text-[10px] font-semibold text-up">✓ done</span>}<span className="ml-auto text-[10px] font-normal text-dim">{t.minutes} min</span></span>
          <span className="mt-0.5 block text-[11px] text-muted">{t.blurb}</span>
        </button>
      ))}
    </div>
  )
}
