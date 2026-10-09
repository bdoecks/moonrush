// A tech coin's site (story market, stage 3): the project page of a coin launched on a post that announced a tool,
// with a demo to try. On some coins the demo works; on others it gives the same answer whatever is typed, says
// "coming soon", or does nothing. Nothing here says which: trying it is the player's job. In the World and in rooms
// the server answers the demo (what it really does never reaches the browser); solo play works it out itself.
import { ExternalLink, X } from 'lucide-react'
import { useState } from 'react'
import { TECH_TOOLS } from '../../data/sparkPosts'
import { demoAsked, useDemo } from '../../game/demoStore'
import { demoAnswer } from '../../game/sparks'
import { useGame } from '../../game/store'
import { send } from '../../net/client'
import type { Token } from '../../types'

export function SitePanel({ t }: { t: Token }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const online = useGame((s) => !!s.online)
  const last = useDemo((s) => (s.last?.tokenId === t.id ? s.last : null))
  if (!t.site) return null
  const tool = TECH_TOOLS[t.site.tool]
  const host = `${t.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.app`
  const run = () => {
    const input = text.trim().slice(0, 60)
    if (!input) return
    demoAsked(t.id, input)
    if (online) send({ t: 'demo', tokenId: t.id, input })
    else useDemo.setState({ last: { tokenId: t.id, input, ...demoAnswer(t.site!.tool, t.sim.demo, input) } })
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mx-3 mt-2 flex items-center gap-2 rounded-md border border-info/40 bg-info/5 px-2.5 py-1.5 text-left text-[11px] hover:border-info">
        <ExternalLink size={12} className="shrink-0 text-info" />
        <span className="min-w-0 flex-1"><b className="text-ink">This coin has a site:</b> <span className="text-muted">{host}. It says the demo works. Open it and try.</span></span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-3 fade-in" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div role="dialog" aria-label={`${t.name}: the site`} className="w-full max-w-[440px] overflow-hidden rounded-xl border border-line2 bg-panel shadow-2xl">
            <div className="flex items-center gap-2 border-b border-line bg-bg px-3 py-2 text-[11px] text-dim">
              <span className="flex-1 truncate rounded bg-raise px-2 py-0.5">https://{host}</span>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close"><X size={14} /></button>
            </div>
            <div className="p-5">
              <div className="text-[22px] font-bold text-ink">{tool.emoji} {t.name}</div>
              <p className="mt-1 text-[13px] text-muted">The tiny tool that {tool.does}.</p>
              <div className="mt-4 rounded-lg border border-line bg-bg p-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-dim">Live demo</div>
                <div className="mt-2 flex gap-2">
                  <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} maxLength={60} placeholder={tool.hint} aria-label={tool.hint} className="min-w-0 flex-1 rounded-md border border-line2 bg-panel px-2 py-1.5 text-[13px] text-ink outline-none focus:border-info" />
                  <button type="button" onClick={run} disabled={!text.trim()} className="rounded-md bg-info px-3 text-[12px] font-bold text-bg disabled:opacity-40">Try it</button>
                </div>
                <div className="mt-2 min-h-[38px] rounded-md bg-panel px-2 py-2 text-[13px]" aria-live="polite">
                  {!last ? <span className="text-dim">The answer shows here.</span>
                    : last.status === 'ok' ? <span className="num text-ink">{last.out}</span>
                    : last.status === 'soon' ? <span className="text-warn">Coming soon. Join the waitlist.</span>
                    : <span className="text-dim">Loading…</span>}
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-snug text-dim">A made-up project site inside the game (generated story). Several coins were launched on the same post and each has a site like this one: try the demo with more than one thing before you trust it.</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
