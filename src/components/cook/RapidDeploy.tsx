// Deploy and Rapid deploy (the owner's design, 2026-10-13): two buttons on a post in the X tracker, shown only to a
// player who turned them on. Deploy opens the Cooking page with that post on top of the form. Rapid deploy shows three
// coin ideas made from the post (game/rapid.ts), each ready with the player's Rapid deploy settings; one click launches
// it and opens the new coin. Plus those settings (a Cooking tab) and the auto-sell that runs every tick.
import clsx from 'clsx'
import { Plus, Rocket, Settings2, Trash2, X as Close, Zap } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { CHAIN_IDS, CHAINS, fmtNative } from '../../data/chains'
import { LAUNCHPADS, padsFor } from '../../data/launchpads'
import { DEV_EMOJI } from '../../game/accounts'
import { faceOf } from '../../game/feedFlavor'
import { rapidIdeas, rapidOf, rapidPad, tickerFor, type RapidIdea } from '../../game/rapid'
import { postLaunchFee } from '../../game/sparks'
import { useGame, validateCook } from '../../game/store'
import { useCooking } from '../../hooks/useLabs'
import { useWallets } from '../../hooks/useWallets'
import type { CookSpec, RapidSettings, SellRules, Spark } from '../../types'
import { fmtCompact, fmtUsd } from '../../utils/format'
import { save } from '../../utils/storage'
import { PadBadge } from '../pad'
import { VerifiedMark } from '../SparkPanel'
import { Face, X } from '../tracker/Tweet'
import { Segmented, Toggle } from '../ui'

/** Which post the Cooking page should open on, and which post the Rapid deploy window is showing. */
export const useDeploy = create<{ cookPost: string | null; rapidPost: string | null; setCookPost: (id: string | null) => void; setRapidPost: (id: string | null) => void }>((set) => ({
  cookPost: null,
  rapidPost: null,
  setCookPost: (cookPost) => set({ cookPost }),
  setRapidPost: (rapidPost) => set({ rapidPost }),
}))

/** A post a coin can be launched on right now: in the World, still open, not a tool's (those coins need a site). */
export const launchable = (x: Spark | undefined) => !!x && !x.picked && x.over === undefined && x.kind !== 'tech'

/** The Deploy / Rapid deploy buttons under a post (nothing when they are switched off or the post can't be launched on). */
export function PostDevButtons({ spark }: { spark?: Spark }) {
  const on = useGame((s) => !!s.settings.devButtons)
  const world = useGame((s) => !!s.online?.round.world && !s.online.spectator)
  const cooking = useCooking()
  const setView = useGame((s) => s.setView)
  const { setCookPost, setRapidPost } = useDeploy()
  if (!on || !world || !cooking || !launchable(spark)) return null
  const deploy = () => {
    save('cookTab', 'create')
    setCookPost(spark!.id)
    setView('cooking')
  }
  return (
    <div className="mt-2 flex gap-2">
      <button onClick={deploy} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border text-[13px] font-bold hover:bg-white/[0.06]" style={{ borderColor: X.line, color: X.text }} title="Open the Cooking page with this post">
        <Rocket size={14} /> Deploy
      </button>
      <button onClick={() => setRapidPost(spark!.id)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-warn text-[13px] font-extrabold text-black hover:brightness-110" title="Three ready coin ideas: one click launches">
        <Zap size={14} /> Rapid deploy
      </button>
    </div>
  )
}

/** The launch a rapid deploy makes from an idea and the player's settings. */
function rapidSpec(r: RapidSettings, idea: RapidIdea, spark: Spark, devWallet: string | undefined): CookSpec {
  return {
    plain: true, chain: r.chain, pad: rapidPad(r, padsFor), tax: { buy: 0.03, sell: 0.03 }, name: idea.name, ticker: idea.ticker, emoji: idea.emoji, hue: Math.floor(Math.random() * 360),
    description: '', narrative: spark.theme ?? 'absurd', socials: { x: false, tg: false, web: false }, style: 'fair', marketing: 0, devBuy: r.devBuy,
    bundle: r.bundle.wallets > 0 ? r.bundle : { wallets: 0, perWallet: r.bundle.perWallet, stagger: false }, devWallet, onPost: spark.id,
  }
}

/** The Rapid deploy window: the post, three ideas, one click each. */
export function RapidDeployModal() {
  const { rapidPost, setRapidPost, setCookPost } = useDeploy()
  const spark = useGame((s) => (rapidPost ? s.market.sparks?.find((x) => x.id === rapidPost) : undefined))
  const r = rapidOf(useGame((s) => s.settings.rapid))
  const tokens = useGame((s) => s.market.tokens)
  const world = useGame((s) => !!s.online?.round.world)
  const cash = useGame((s) => s.portfolio.cash)
  const cook = useGame((s) => s.cook)
  const select = useGame((s) => s.select)
  const setView = useGame((s) => s.setView)
  const setAutoSell = useGame((s) => s.setAutoSell)
  const wallets = useWallets()
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (rapidPost && !launchable(spark)) setRapidPost(null) // the timeline settled it while the window was open
  }, [rapidPost, spark, setRapidPost])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setRapidPost(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [setRapidPost])
  if (!rapidPost || !spark) return null
  const ideas = rapidIdeas(spark, r.ticker)
  const devs = wallets.all.filter((w) => w.emoji === DEV_EMOJI)
  const dev = devs.find((w) => w.id === r.devWallet) ?? devs[0]
  const fee = postLaunchFee(spark.by.followers)
  const sells = [r.dev.on && 'dev bag', r.bundle.wallets > 0 && r.bundleSell.on && 'bundle'].filter(Boolean).join(' + ')
  const launch = (idea: RapidIdea) => {
    if (busy) return
    setBusy(true)
    const id = cook(rapidSpec(r, idea, spark, dev?.id))
    setBusy(false)
    if (!id) return
    setAutoSell(id, { dev: r.dev.on ? r.dev : undefined, bundle: r.bundle.wallets > 0 && r.bundleSell.on ? r.bundleSell : undefined })
    setRapidPost(null)
    select(id) // straight to the new coin
  }
  const settings = () => {
    save('cookTab', 'rapid')
    setRapidPost(null)
    setCookPost(null)
    setView('cooking')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-3 pt-[8vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setRapidPost(null)}>
      <div role="dialog" aria-label="Rapid deploy" className="w-full max-w-[720px] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Zap size={16} className="text-warn" />
          <span className="text-[14px] font-bold">Rapid deploy</span>
          <span className="text-[12px] text-dim">one click launches, then opens your coin</span>
          <button onClick={() => setRapidPost(null)} className="ml-auto rounded p-1 text-dim hover:text-ink" aria-label="Close"><Close size={16} /></button>
        </div>
        <div className="flex gap-3 border-b px-4 py-3" style={{ ...{ background: X.bg }, borderColor: X.line }}>
          <Face face={spark.by.face ?? faceOf(spark.by.handle)} emoji={spark.by.avatar} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[14px]">
              <span className="truncate font-bold" style={{ color: X.text }}>{spark.by.name}</span>
              {spark.by.verified && <VerifiedMark size={14} />}
              <span className="truncate" style={{ color: X.dim }}>@{spark.by.handle}</span>
              <span className="num ml-auto shrink-0 text-[11px]" style={{ color: X.dim }}>{fmtCompact(spark.by.followers, '')} followers</span>
            </div>
            <div className="mt-0.5 line-clamp-3 text-[14px] leading-[19px]" style={{ color: X.text }}>{spark.text}</div>
          </div>
          {spark.pic && <img src={`${import.meta.env.BASE_URL}posts/${spark.pic}.webp`} alt="The post's picture" className="size-[72px] shrink-0 rounded-lg border object-cover" style={{ borderColor: X.line }} />}
        </div>
        <div className="grid gap-2 p-3 sm:grid-cols-3">
          {ideas.map((idea, i) => {
            const why = validateCook(rapidSpec(r, idea, spark, dev?.id), tokens, true, world)
            return (
              <div key={i} className="flex flex-col rounded-lg border border-line2 bg-bg/60 p-2.5">
                <div className="flex items-center gap-2">
                  {spark.pic ? <img src={`${import.meta.env.BASE_URL}posts/${spark.pic}.webp`} alt="" className="size-10 rounded-lg object-cover" /> : <span className="grid size-10 place-items-center rounded-lg bg-raise text-[22px]">{idea.emoji}</span>}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold">{idea.name}</div>
                    <div className="num text-[12px] font-bold text-accent">${idea.ticker}</div>
                  </div>
                </div>
                <div className="mt-1.5 text-[11px] text-dim">{idea.why}</div>
                <div className="mt-2 space-y-0.5 text-[11px]">
                  <Row k="Launch">{CHAINS[r.chain].glyph} {LAUNCHPADS[rapidPad(r, padsFor)].name}</Row>
                  <Row k="Dev buy">{r.devBuy > 0 ? fmtNative(r.devBuy, r.chain) : 'none'}</Row>
                  <Row k="Bundle">{r.bundle.wallets > 0 ? `${r.bundle.wallets} × ${fmtNative(r.bundle.perWallet, r.chain)}` : 'none'}</Row>
                  <Row k="Auto-sell">{sells || 'off'}</Row>
                  <Row k="Fee">{fmtUsd(fee, 0)}</Row>
                </div>
                <button disabled={!!why || busy || cash < fee} onClick={() => launch(idea)} className="mt-2.5 flex h-9 items-center justify-center gap-1.5 rounded-md bg-warn text-[13px] font-extrabold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
                  <Zap size={13} /> {why ? why.slice(0, 34) : cash < fee ? `Need ${fmtUsd(fee, 0)}` : 'Launch'}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[11px] text-dim">
          <span>The coin wears the post's picture, like every coin on it. Dev wallet: {dev ? `${dev.emoji} ${dev.name}` : 'made when you launch'}.</span>
          <button onClick={settings} className="ml-auto flex shrink-0 items-center gap-1 rounded border border-line2 px-2 py-1 text-muted hover:text-ink"><Settings2 size={12} /> Rapid deploy settings</button>
        </div>
      </div>
    </div>
  )
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex justify-between gap-2"><span className="text-dim">{k}</span><span className="num truncate text-right">{children}</span></div>
}

/** Runs the auto-sell rules once a tick (mounted once, in App). */
export function AutoSellRunner() {
  const tick = useGame((s) => s.market.tick)
  useEffect(() => {
    useGame.getState().runAutoSell()
  }, [tick])
  return null
}

// ─── Rapid deploy settings (a Cooking tab) ───────────────────────────────────
const chip = 'flex min-h-[32px] items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors'
const onCls = 'border-accent/70 bg-accent/[0.08] text-accent'
const offCls = 'border-line2 text-muted hover:text-ink'
const numCls = 'num h-8 w-20 rounded-md border border-line2 bg-bg px-2 text-[12px] outline-none focus:border-accent/60'
const num = (v: string) => {
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) && v.trim() !== '' ? n : null
}

export function RapidSettingsPanel() {
  const r = rapidOf(useGame((s) => s.settings.rapid))
  const devButtons = useGame((s) => !!s.settings.devButtons)
  const updateSettings = useGame((s) => s.updateSettings)
  const wallets = useWallets()
  const devs = wallets.all.filter((w) => w.emoji === DEV_EMOJI)
  const set = (patch: Partial<RapidSettings>) => updateSettings({ rapid: { ...r, ...patch } })
  const c = CHAINS[r.chain]
  const amounts = (c.presets[1] ?? c.quick).slice(0, 3)
  const example = 'Mayor Otter'

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className="space-y-3 rounded-xl border border-line bg-panel p-4">
        <div className="flex items-center gap-3 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold">Deploy buttons on posts</div>
            <div className="text-[11px] text-dim">Shows "Deploy" and "Rapid deploy" under each open post in the X tracker (in the World). Off: you never see them.</div>
          </div>
          <Toggle on={devButtons} onChange={(v) => updateSettings({ devButtons: v })} label="Deploy buttons on posts" />
        </div>

        <H>Where it launches</H>
        <div className="flex flex-wrap gap-1.5">
          {CHAIN_IDS.map((id) => (
            <button key={id} onClick={() => set({ chain: id, pad: padsFor(id)[0].id, devBuy: 0, bundle: { ...r.bundle, perWallet: CHAINS[id].quick[0] } })} className={clsx(chip, r.chain === id ? onCls : offCls)}>{CHAINS[id].glyph} {CHAINS[id].name}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {padsFor(r.chain).map((p) => (
            <button key={p.id} onClick={() => set({ pad: p.id })} className={clsx(chip, rapidPad(r, padsFor) === p.id ? onCls : offCls)}><PadBadge pad={p.id} size={14} /> {p.name}</button>
          ))}
        </div>

        <H>Who launches it</H>
        <div className="flex flex-wrap gap-1.5">
          {devs.length === 0 && <span className="text-[12px] text-dim">Your first dev wallet is made when you launch.</span>}
          {devs.map((w, i) => {
            const on = w.id === r.devWallet || (!devs.some((d) => d.id === r.devWallet) && i === 0)
            return <button key={w.id} onClick={() => set({ devWallet: w.id })} className={clsx(chip, on ? onCls : offCls)}>{w.emoji} {w.name} <span className="num text-dim">· {fmtNative(w.balances[r.chain] ?? 0, r.chain)}</span></button>
          })}
        </div>

        <H>Dev buy at launch</H>
        <div className="flex flex-wrap items-center gap-1.5">
          {[0, ...amounts].map((v) => <button key={v} onClick={() => set({ devBuy: v })} className={clsx(chip, r.devBuy === v ? onCls : offCls)}>{v === 0 ? 'None' : fmtNative(v, r.chain)}</button>)}
          <input defaultValue={amounts.includes(r.devBuy) || r.devBuy === 0 ? '' : r.devBuy} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v >= 0) set({ devBuy: v }) }} placeholder={`other ${c.native}`} aria-label="Dev buy" className={numCls} />
        </div>

        <H>Bundle</H>
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          {[0, 3, 5, 10].map((v) => <button key={v} onClick={() => set({ bundle: { ...r.bundle, wallets: v } })} className={clsx(chip, r.bundle.wallets === v ? onCls : offCls)}>{v === 0 ? 'None' : `${v} wallets`}</button>)}
          {r.bundle.wallets > 0 && (
            <>
              <span className="text-dim">each buys</span>
              <input defaultValue={r.bundle.perWallet} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v > 0) set({ bundle: { ...r.bundle, perWallet: v } }) }} aria-label="Bundle buy per wallet" className={numCls} />
              <span className="text-dim">{c.native}</span>
            </>
          )}
        </div>

        <H>Ticker style</H>
        <Segmented value={r.ticker} onChange={(v) => set({ ticker: v as RapidSettings['ticker'] })} options={(['full', 'short', 'letters'] as const).map((v) => ({ value: v, label: `${v === 'full' ? 'Whole name' : v === 'short' ? 'Last word' : 'First letters'} · $${tickerFor(example, v)}` }))} className="w-full [&>button]:flex-1" />
        <p className="text-[11px] text-dim">The first idea uses this style, the second another one. A coin on a post always wears the post's picture.</p>
      </section>

      <div className="space-y-3">
        <RulesCard title="Auto-sell: dev bag" note="Sells from your dev wallet. Everyone sees a dev sell." rules={r.dev} onChange={(dev) => set({ dev })} />
        <RulesCard title="Auto-sell: bundle" note={r.bundle.wallets > 0 ? 'Sells what your bundle wallets hold, apart from the dev bag.' : 'Only used when a bundle is set.'} rules={r.bundleSell} onChange={(bundleSell) => set({ bundleSell })} />
      </div>
    </div>
  )
}

function H({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-bold text-muted">{children}</div>
}

function RulesCard({ title, note, rules, onChange }: { title: string; note: string; rules: SellRules; onChange: (r: SellRules) => void }) {
  const set = (p: Partial<SellRules>) => onChange({ ...rules, ...p })
  const steps = rules.at ?? []
  return (
    <section className={clsx('space-y-2.5 rounded-xl border p-4', rules.on ? 'border-down/40 bg-panel' : 'border-line bg-panel')}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">{title}</div>
          <div className="text-[11px] text-dim">{note}</div>
        </div>
        <Toggle on={rules.on} onChange={(on) => set({ on })} label={title} />
      </div>
      <div className={clsx('space-y-2 text-[12px]', !rules.on && 'pointer-events-none opacity-40')}>
        <Rule on={rules.after != null} onToggle={(v) => set({ after: v ? 30 : null })} label="After">
          <input defaultValue={rules.after ?? 30} key={`a${rules.after}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v >= 0) set({ after: Math.round(v) }) }} aria-label="Seconds after launch" className={numCls} /> <span className="text-dim">seconds: sell all</span>
        </Rule>
        <Rule on={rules.mcap != null} onToggle={(v) => set({ mcap: v ? 30_000 : null })} label="At market cap">
          <span className="text-dim">$</span><input defaultValue={rules.mcap ?? 30000} key={`m${rules.mcap}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v > 0) set({ mcap: v }) }} aria-label="Market cap" className={numCls} /> <span className="text-dim">sell all</span>
        </Rule>
        <Rule on={rules.stop != null} onToggle={(v) => set({ stop: v ? 0.4 : null })} label="Stop loss">
          <input defaultValue={Math.round((rules.stop ?? 0.4) * 100)} key={`s${rules.stop}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v > 0 && v < 100) set({ stop: v / 100 }) }} aria-label="Stop loss percent" className={numCls} /> <span className="text-dim">% below the launch: sell all</span>
        </Rule>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="w-24 font-semibold text-muted">Take profit</span>
            <button onClick={() => set({ at: [...steps, { x: steps.length ? steps[steps.length - 1].x * 2 : 2, pct: 0.5 }].slice(0, 4) })} disabled={steps.length >= 4} className="flex items-center gap-1 rounded border border-line2 px-2 py-0.5 text-[11px] text-muted hover:text-ink disabled:opacity-40"><Plus size={11} /> Add a step</button>
          </div>
          {steps.length === 0 && <div className="pl-[104px] text-[11px] text-dim">No steps. e.g. sell 50% at 2x, the rest at 5x.</div>}
          {steps.map((st, i) => (
            <div key={i} className="mb-1 flex items-center gap-1.5 pl-[104px]">
              <span className="text-dim">sell</span>
              <input defaultValue={Math.round(st.pct * 100)} key={`p${i}${st.pct}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v > 0 && v <= 100) set({ at: steps.map((x, j) => (j === i ? { ...x, pct: v / 100 } : x)) }) }} aria-label="Percent to sell" className={clsx(numCls, 'w-14')} />
              <span className="text-dim">% at</span>
              <input defaultValue={st.x} key={`x${i}${st.x}`} onBlur={(e) => { const v = num(e.target.value); if (v !== null && v > 1) set({ at: steps.map((x, j) => (j === i ? { ...x, x: v } : x)) }) }} aria-label="Times up" className={clsx(numCls, 'w-14')} />
              <span className="text-dim">x</span>
              <button onClick={() => set({ at: steps.filter((_, j) => j !== i) })} className="ml-1 text-dim hover:text-down" aria-label="Remove step"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-dim">"x" and the stop loss are measured from the market cap just after your launch. Each rule sells once. Rules apply to coins launched with Rapid deploy.</p>
      </div>
    </section>
  )
}

function Rule({ on, onToggle, label, children }: { on: boolean; onToggle: (v: boolean) => void; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex w-24 cursor-pointer items-center gap-1.5 font-semibold text-muted"><input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} className="accent-[var(--accent)]" /> {label}</label>
      <span className={clsx('flex items-center gap-1.5', !on && 'opacity-40')}>{children}</span>
    </div>
  )
}
