import clsx from 'clsx'
import { Crosshair, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { PadGrid } from '../components/discover/TrenchFilterPanel'
import { EmptyState, Segmented, Toggle, TokenIcon } from '../components/ui'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { useGame } from '../game/store'
import { useWallets } from '../hooks/useWallets'
import type { Chain, PadId, SniperTask } from '../types'
import { fmtAge, fmtPct, fmtUsd, toneClass } from '../utils/format'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'

type Draft = Omit<SniperTask, 'id' | 'createdTick' | 'holdings' | 'stats'>

const blank = (chain: Chain): Draft => ({
  name: 'Sniper 1', enabled: true, chain, pads: [], keywords: '', exclude: '', maxDevPct: 5, requireSocial: true, skipTax: true,
  amount: CHAINS[chain].quick[0], walletIds: [], slot: 2, maxSnipes: 5, tp: 100, sl: 40,
})

/** GMGN-style sniper bot: auto-buy brand-new launches that match your rules, with take profit / stop loss. */
export function SniperView() {
  const snipers = useGame((s) => s.snipers)
  const chainFilter = useGame((s) => s.chainFilter)
  const running = useGame((s) => s.runStatus === 'running')
  const trades = useGame((s) => s.portfolio.trades)
  const tick = useGame((s) => s.market.tick)
  const select = useGame((s) => s.select)
  const tokens = useGame((s) => s.market.tokens)
  const add = useGame((s) => s.addSniper)
  const [draft, setDraft] = useState<Draft>(() => blank(chainFilter === 'all' ? 'sol' : chainFilter))
  const snipes = trades.filter((t) => t.via?.startsWith('🎯')).slice(0, 30)
  const totals = snipers.reduce((a, x) => ({ snipes: a.snipes + x.stats.snipes, spent: a.spent + x.stats.spent, realized: a.realized + x.stats.realized }), { snipes: 0, spent: 0, realized: 0 })
  const open = snipers.flatMap((x) => Object.entries(x.holdings).map(([id, h]) => ({ task: x, id, h, t: tokens.find((t) => t.id === id) })))
  const unrealized = open.reduce((a, o) => a + (o.t ? o.t.price * o.h.qty - o.h.cost : 0), 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-panel p-3">
          <div className="grid size-10 place-items-center rounded-lg bg-down/15 text-down"><Crosshair size={22} /></div>
          <div className="min-w-0">
            <h1 className="font-display text-[18px] font-bold leading-tight">Sniper</h1>
            <p className="text-[11px] text-muted">Auto-buy new launches the moment they match your rules, from the wallets you pick, then take profit or cut losses automatically.</p>
          </div>
          <div className="ml-auto flex gap-5 text-right">
            <Stat label="Active tasks">{snipers.filter((x) => x.enabled).length}/{snipers.length}</Stat>
            <Stat label="Snipes">{totals.snipes}</Stat>
            <Stat label="Spent">{fmtUsd(totals.spent)}</Stat>
            <Stat label="Realized"><span className={toneClass(totals.realized)}>{totals.realized >= 0 ? '+' : ''}{fmtUsd(totals.realized)}</span></Stat>
            <Stat label="Open PnL"><span className={toneClass(unrealized)}>{unrealized >= 0 ? '+' : ''}{fmtUsd(unrealized)}</span></Stat>
          </div>
        </div>

        {!running && <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn">Snipers only fire while a round is running.</div>}

        <div className="grid gap-3 xl:grid-cols-[420px_1fr]">
          <TaskForm draft={draft} setDraft={setDraft} onCreate={() => { add(draft); setDraft({ ...draft, name: `Sniper ${snipers.length + 2}` }) }} />

          <div className="space-y-3">
            <div className="rounded-md border border-line bg-panel">
              <div className="border-b border-line px-3 py-2 text-[12px] font-bold">Your snipers</div>
              {snipers.length === 0 ? (
                <EmptyState icon="🎯" title="No sniper tasks yet" hint="Set the rules on the left and arm one" />
              ) : (
                <div className="divide-y divide-line/60">{snipers.map((x) => <TaskRow key={x.id} task={x} />)}</div>
              )}
            </div>

            <div className="rounded-md border border-line bg-panel">
              <div className="border-b border-line px-3 py-2 text-[12px] font-bold">Open sniped bags</div>
              {open.length === 0 ? (
                <EmptyState icon="🎒" title="Nothing held by snipers" />
              ) : (
                <div className="divide-y divide-line/60">
                  {open.map(({ task, id, h, t }) => {
                    const value = t ? t.price * h.qty : 0
                    const pnl = value - h.cost
                    return (
                      <button key={task.id + id} onClick={() => t && select(t.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel2">
                        {t && <TokenIcon token={t} size={22} />}
                        <span className="font-bold">{t?.ticker ?? '?'}</span>
                        <span className="text-[10px] text-dim">via {task.name}</span>
                        <span className="num ml-auto text-[12px]">{fmtUsd(value)}</span>
                        <span className={clsx('num w-24 text-right text-[12px] font-semibold', toneClass(pnl))}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)} <span className="text-[10px]">{fmtPct(h.cost > 0 ? pnl / h.cost : 0)}</span></span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="rounded-md border border-line bg-panel">
              <div className="border-b border-line px-3 py-2 text-[12px] font-bold">Recent snipes</div>
              {snipes.length === 0 ? (
                <EmptyState icon="📡" title="No snipes yet" hint="Armed tasks fire on the next matching launch" />
              ) : (
                <table className="w-full text-[12px]">
                  <tbody>
                    {snipes.map((tr) => (
                      <tr key={tr.id} className="border-b border-line/40 hover:bg-panel2">
                        <td className="px-3 py-1.5 text-dim num">{fmtAge((tick - tr.tick) * SIM_SEC_PER_TICK)}</td>
                        <td className={clsx('px-2 py-1.5 font-semibold', tr.side === 'buy' ? 'text-up' : 'text-down')}>{tr.side === 'buy' ? 'Snipe' : 'Exit'}</td>
                        <td className="px-2 py-1.5"><button onClick={() => select(tr.tokenId)} className="font-bold hover:text-accent">${tr.ticker}</button></td>
                        <td className="px-2 py-1.5 num text-right">{tr.chain ? fmtNative(tr.native ?? 0, tr.chain) : fmtUsd(tr.value)}</td>
                        <td className={clsx('px-2 py-1.5 num text-right', toneClass(tr.pnl ?? 0))}>{tr.pnl !== undefined ? `${tr.pnl >= 0 ? '+' : ''}${fmtUsd(tr.pnl)}` : ''}</td>
                        <td className="px-3 py-1.5 text-right text-[10px] text-dim">{tr.via}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
        <p className="text-[9px] text-dim">Snipers trade fictional tokens with virtual money. Fast launch buys are the riskiest trades there are: many snipes end in rugs.</p>
      </div>
    </div>
  )
}

function TaskForm({ draft, setDraft, onCreate }: { draft: Draft; setDraft: (d: Draft) => void; onCreate: () => void }) {
  const { all } = useWallets()
  const up = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
  const c = CHAINS[draft.chain]
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Number(v)))
  const inputCls = 'num h-8 w-full rounded border border-line2 bg-bg px-2 text-[12px] outline-none placeholder:text-dim focus:border-accent/60'
  return (
    <div className="space-y-3 rounded-md border border-line bg-panel p-3 text-[12px]">
      <div className="flex items-center gap-1.5 font-bold"><Plus size={13} /> New sniper task</div>
      <Field label="Name"><input value={draft.name} maxLength={20} onChange={(e) => up({ name: e.target.value })} className={inputCls} /></Field>
      <Field label="Chain">
        <div className="flex gap-1">
          {CHAIN_IDS.map((ch) => (
            <button key={ch} type="button" onClick={() => up({ chain: ch, pads: [], amount: CHAINS[ch].quick[0] })} aria-pressed={draft.chain === ch} className={clsx('h-8 flex-1 rounded border text-[11px] font-bold', draft.chain === ch ? 'bg-raise' : 'border-line2 text-muted')} style={draft.chain === ch ? { borderColor: CHAINS[ch].color, color: CHAINS[ch].color } : undefined}>
              {CHAINS[ch].glyph} {CHAINS[ch].name}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Launchpads (none = all)"><PadGrid selected={draft.pads} onChange={(pads: PadId[]) => up({ pads })} chain={draft.chain} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name contains"><input value={draft.keywords} onChange={(e) => up({ keywords: e.target.value })} placeholder="dog, ai" className={inputCls} /></Field>
        <Field label="Skip names with"><input value={draft.exclude} onChange={(e) => up({ exclude: e.target.value })} placeholder="rug, scam" className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label={`Buy per wallet (${c.native})`}><input inputMode="decimal" value={draft.amount} onChange={(e) => up({ amount: Math.max(0, Number(e.target.value) || 0) })} className={inputCls} /></Field>
        <Field label="Max dev %"><input inputMode="decimal" value={draft.maxDevPct ?? ''} placeholder="any" onChange={(e) => up({ maxDevPct: num(e.target.value) })} className={inputCls} /></Field>
        <Field label="Max snipes"><input inputMode="numeric" value={draft.maxSnipes} onChange={(e) => up({ maxSnipes: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} className={inputCls} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Take profit (+%)"><input inputMode="decimal" value={draft.tp ?? ''} placeholder="off" onChange={(e) => up({ tp: num(e.target.value) })} className={inputCls} /></Field>
        <Field label="Stop loss (−%)"><input inputMode="decimal" value={draft.sl ?? ''} placeholder="off" onChange={(e) => up({ sl: num(e.target.value) })} className={inputCls} /></Field>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-muted"><Toggle label="Require socials" on={draft.requireSocial} onChange={(v) => up({ requireSocial: v })} /> Needs X / TG / web</label>
        <label className="flex items-center gap-2 text-muted"><Toggle label="Skip tax coins" on={draft.skipTax} onChange={(v) => up({ skipTax: v })} /> Skip tax coins</label>
      </div>
      <Field label="Trade settings (fees · slippage · anti-MEV)">
        <Segmented value={draft.slot} onChange={(slot) => up({ slot })} options={[0, 1, 2].map((i) => ({ value: i, label: `P${i + 1}${i === 2 ? ' turbo' : ''}` }))} />
      </Field>
      <Field label="Snipe from (none ticked = your selected wallets)">
        <div className="flex flex-wrap gap-1">
          {all.map((a) => {
            const on = draft.walletIds.includes(a.id)
            return (
              <button key={a.id} type="button" onClick={() => up({ walletIds: on ? draft.walletIds.filter((x) => x !== a.id) : [...draft.walletIds, a.id] })} aria-pressed={on} className={clsx('flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted')}>
                {a.emoji} {a.name} <span className="num text-[10px] text-dim">{fmtNative(a.balances[draft.chain], draft.chain, false)}</span>
              </button>
            )
          })}
        </div>
      </Field>
      <button type="button" onClick={onCreate} disabled={!(draft.amount > 0) || !draft.name.trim()} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-down text-[13px] font-extrabold text-white hover:brightness-110 disabled:opacity-40">
        <Crosshair size={14} /> Arm sniper
      </button>
      <p className="text-[10px] leading-snug text-dim">It buys launches on the tick they appear, before most traders see them. Turbo fees (P3) land fastest. Keep the amount small: most fresh launches go to zero.</p>
    </div>
  )
}

function TaskRow({ task }: { task: SniperTask }) {
  const update = useGame((s) => s.updateSniper)
  const remove = useGame((s) => s.removeSniper)
  const c = CHAINS[task.chain]
  const open = Object.keys(task.holdings).length
  const done = task.stats.snipes >= task.maxSnipes
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <button onClick={() => update(task.id, { enabled: !task.enabled })} disabled={done && !task.enabled} className={clsx('grid size-8 place-items-center rounded-full', task.enabled ? 'bg-down text-white' : 'bg-raise text-muted')} aria-label={task.enabled ? 'Pause' : 'Resume'}>
        {task.enabled ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-bold">
          {task.name}
          <span className="rounded px-1 text-[9px] font-bold" style={{ color: c.color, background: `${c.color}1a` }}>{c.glyph} {c.native}</span>
          {task.enabled ? <span className="flex items-center gap-1 text-[9px] font-bold text-down"><span className="size-1.5 animate-pulse rounded-full bg-down" />ARMED</span> : <span className="text-[9px] font-bold text-dim">{done ? 'DONE' : 'PAUSED'}</span>}
        </div>
        <div className="text-[10px] text-dim">
          {fmtNative(task.amount, task.chain)} × {task.walletIds.length || 'selected'} wallet{task.walletIds.length === 1 ? '' : 's'} · {task.pads.length ? `${task.pads.length} pad${task.pads.length > 1 ? 's' : ''}` : 'all pads'}
          {task.keywords && ` · "${task.keywords}"`}{task.maxDevPct !== null && ` · dev ≤${task.maxDevPct}%`}{task.requireSocial && ' · socials'} · TP {task.tp ?? '—'}% / SL {task.sl ?? '—'}%
        </div>
      </div>
      <div className="ml-auto flex items-center gap-4 text-right text-[11px]">
        <Stat label="Snipes">{task.stats.snipes}/{task.maxSnipes}</Stat>
        <Stat label="Skipped">{task.stats.skipped}</Stat>
        <Stat label="Open">{open}</Stat>
        <Stat label="Realized"><span className={toneClass(task.stats.realized)}>{task.stats.realized >= 0 ? '+' : ''}{fmtUsd(task.stats.realized)}</span></Stat>
        <button onClick={() => remove(task.id)} className="rounded p-1 text-dim hover:text-down" aria-label={`Delete ${task.name}`} title={open ? 'Delete task (bags stay in your wallets)' : 'Delete task'}><Trash2 size={13} /></button>
      </div>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[13px] font-bold">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] text-dim">{label}</div>
      {children}
    </div>
  )
}
