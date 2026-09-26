import clsx from 'clsx'
import { Bot, Boxes, EyeOff, Info, Play, Square, Wallet } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { CHAINS, fmtNative } from '../../data/chains'
import { BOT_RATES, BUNDLE_MAX_WALLETS, botCostPerMin, washShare } from '../../game/devTools'
import { useGame } from '../../game/store'
import { creatorRate, nativePrice } from '../../game/tradingEngine'
import type { BundleSpec, CookSpec, LaunchRecord, Token } from '../../types'
import { fmtUsd } from '../../utils/format'
import { Segmented, Toggle } from '../ui'
import { useWallets } from '../../hooks/useWallets'

// ─── Bundler (launch form) ───────────────────────────────────────────────────
interface BundlerProps {
  spec: CookSpec
  onChange: (b: Partial<BundleSpec>) => void
  est: { devPct: number; bundlePct: number }
  detect: number
  bundleUsd: number
  bundleFees: number
  maxPerWallet: number
}

export function BundlerSection({ spec, onChange, est, detect, bundleUsd, bundleFees, maxPerWallet }: BundlerProps) {
  const b = spec.bundle
  const on = b.wallets > 0
  const c = CHAINS[spec.chain]
  const step = c.quick[0] / 10
  const risk = detect < 0.3 ? 'text-up' : detect < 0.6 ? 'text-warn' : 'text-down'
  return (
    <section className={clsx('rounded-md border p-3 transition-colors', on ? 'border-info/40 bg-info/5' : 'border-line2')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes size={15} className="text-info" />
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Bundler</h2>
          <span className="rounded bg-raise px-1.5 text-[9px] font-semibold text-dim">launch block buys</span>
        </div>
        <Toggle label="Bundle launch" on={on} onChange={(v) => onChange({ wallets: v ? 8 : 0 })} />
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Buy the opening supply from several of your own wallets in the same block as the launch. The audit shows a small dev bag, but you control much more.
      </p>

      {on && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="flex justify-between text-[11px]"><span className="text-dim">Wallets</span><span className="num font-bold">{b.wallets}</span></div>
              <input type="range" min={2} max={BUNDLE_MAX_WALLETS} step={1} value={b.wallets} onChange={(e) => onChange({ wallets: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label="Bundle wallets" />
            </div>
            <div>
              <div className="flex justify-between text-[11px]"><span className="text-dim">Per wallet</span><span className="num font-bold" style={{ color: c.color }}>{fmtNative(b.perWallet, spec.chain)}</span></div>
              <input type="range" min={step} max={Math.max(maxPerWallet, b.perWallet, step)} step={step} value={b.perWallet} onChange={(e) => onChange({ perWallet: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label={`Bundle buy per wallet in ${c.native}`} />
            </div>
          </div>

          <div className="flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1.5 text-muted" title="Spread the buys over the first few blocks. Harder to link, but costs 1% extra in tips and lets a couple of snipers in.">
              Stagger over a few blocks <Info size={11} className="text-dim" />
            </span>
            <Toggle label="Stagger bundle" on={b.stagger} onChange={(v) => onChange({ stagger: v })} />
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-md bg-bg/60 p-2 text-center">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Audit shows dev</div>
              <div className="num text-[14px] font-bold text-up">{est.devPct.toFixed(1)}%</div>
            </div>
            <div>
              <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-dim"><EyeOff size={9} /> You really hold</div>
              <div className="num text-[14px] font-bold text-info">{(est.devPct + est.bundlePct).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-dim">Chance spotted</div>
              <div className={clsx('num text-[14px] font-bold', risk)}>{Math.round(detect * 100)}%</div>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line2">
            <div className={clsx('h-full transition-all', detect < 0.3 ? 'bg-up' : detect < 0.6 ? 'bg-warn' : 'bg-down')} style={{ width: `${detect * 100}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-dim">
            <span>Bundle ≈{fmtUsd(bundleUsd, 0)} · fees + tips {fmtUsd(bundleFees)}</span>
            <span>More, smaller wallets are harder to link</span>
          </div>
          <ul className="space-y-0.5 text-[10px] leading-snug text-muted">
            <li>• <b className="text-ink">If spotted</b> (at launch or later by bubble-map sleuths): the audit shows the bundle, hype drops, and holders start selling.</li>
            <li>• Your sells come out of the bundle wallets first. Unflagged, they look like normal holders selling; flagged, everyone sees the bundle dumping.</li>
            <li>• In real markets this is a common rug setup. Here it's a sim so you can learn to spot it on other coins: look for high Bundler % in the audit.</li>
          </ul>
        </div>
      )}
    </section>
  )
}

// ─── Dev wallet + side wallets (launch form) ─────────────────────────────────
export function SideWalletsSection({ spec, onChange }: { spec: CookSpec; onChange: (patch: Partial<CookSpec>) => void }) {
  const { all, primary } = useWallets()
  const openManager = useGame((s) => s.setWalletsOpen)
  const tick = useGame((s) => s.market.tick)
  const c = CHAINS[spec.chain]
  const devId = spec.devWallet && all.some((a) => a.id === spec.devWallet) ? spec.devWallet : primary?.id
  const sides = spec.sideBuys ?? []
  const amountOf = (id: string) => sides.find((x) => x.walletId === id)?.amount
  const setSide = (id: string, amount: number | null) => {
    const rest = sides.filter((x) => x.walletId !== id)
    onChange({ sideBuys: amount === null ? rest : [...rest, { walletId: id, amount }] })
  }
  const others = all.filter((a) => a.id !== devId)
  const baseRisk = spec.sideDelay ? 0.12 : 0.35
  const step = c.quick[0] / 5
  return (
    <section className={clsx('rounded-md border p-3', sides.length ? 'border-accent/40 bg-accent/5' : 'border-line2')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet size={15} className="text-accent" />
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-muted">Dev &amp; side wallets</h2>
        </div>
        <button type="button" onClick={() => openManager(true)} className="text-[10px] text-dim hover:text-ink">Manage wallets…</button>
      </div>
      <p className="mt-1 text-[11px] text-muted">Only the deployer counts as the dev, so only its buys raise dev %. Your other wallets look like normal buyers, but sleuths may link them (costs hype).</p>

      <div className="mt-2 flex items-center gap-2 text-[12px]">
        <span className="shrink-0 text-dim">Deploy from</span>
        <select value={devId} onChange={(e) => onChange({ devWallet: e.target.value, sideBuys: sides.filter((x) => x.walletId !== e.target.value) })} className="h-8 min-w-0 flex-1 rounded border border-line2 bg-bg px-1.5 outline-none focus:border-accent/60" aria-label="Dev wallet">
          {all.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name} · {fmtNative(a.balances[spec.chain], spec.chain)}</option>)}
        </select>
      </div>

      {others.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-line2 p-2 text-center text-[11px] text-dim">
          Create a second wallet to buy your own launch without it counting as dev.{' '}
          <button type="button" onClick={() => openManager(true)} className="font-semibold text-accent underline">Create wallet</button>
        </div>
      ) : (
        <div className="mt-2 space-y-1">
          {others.map((a) => {
            const amt = amountOf(a.id)
            const on = amt !== undefined
            const funded = a.fundedBy?.[devId ?? ''] !== undefined && tick - (a.fundedBy?.[devId ?? ''] ?? 0) < 600
            const risk = Math.min(0.9, baseRisk + (funded ? 0.25 : 0))
            return (
              <div key={a.id} className={clsx('flex items-center gap-2 rounded-md border px-2 py-1.5', on ? 'border-accent/40 bg-bg/60' : 'border-line2')}>
                <input type="checkbox" checked={on} onChange={(e) => setSide(a.id, e.target.checked ? c.quick[0] : null)} className="accent-[var(--accent)]" aria-label={`Side buy from ${a.name}`} />
                <span className="text-[14px]">{a.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold">{a.name}</span>
                  <span className="num block text-[10px] text-dim">holds {fmtNative(a.balances[spec.chain], spec.chain)}{funded && <span className="text-warn"> · funded by dev</span>}</span>
                </span>
                {on && (
                  <>
                    <input
                      type="number"
                      min={step}
                      step={step}
                      value={amt}
                      onChange={(e) => setSide(a.id, Math.max(0, Number(e.target.value)))}
                      className="num h-7 w-20 rounded border border-line2 bg-bg px-1.5 text-right text-[12px] outline-none focus:border-accent/60"
                      aria-label={`${a.name} buy amount in ${c.native}`}
                    />
                    <span className="text-[10px]" style={{ color: c.color }}>{c.native}</span>
                    <span className={clsx('num w-12 text-right text-[10px]', risk < 0.2 ? 'text-up' : risk < 0.4 ? 'text-warn' : 'text-down')} title="Chance this wallet gets linked to the dev">{Math.round(risk * 100)}% link</span>
                  </>
                )}
              </div>
            )
          })}
          <div className="flex items-center justify-between pt-1 text-[12px]">
            <span className="flex items-center gap-1.5 text-muted" title="Side buys land at random over the first minute instead of in the launch block: much harder to link to the dev, but you pay a higher price if it pumps.">
              Spread side buys over the first minute <Info size={11} className="text-dim" />
            </span>
            <Toggle label="Delay side buys" on={!!spec.sideDelay} onChange={(v) => onChange({ sideDelay: v })} />
          </div>
          <ul className="space-y-0.5 pt-1 text-[10px] leading-snug text-muted">
            <li>• Buying in the launch block is the classic tell (~35% link each). Spread over a minute it's ~12%, and later buys ~4%.</li>
            <li>• Wallets you funded <b className="text-ink">directly from the dev wallet</b> are much easier to link (+25%). Funding from the USD bank leaves no trail.</li>
            <li>• Once linked, hype drops and its sells spook holders a little. It never adds to dev %: only the deployer's bag counts.</li>
          </ul>
        </div>
      )}
    </section>
  )
}

// ─── Volume bot (your launches) ──────────────────────────────────────────────
const BUDGETS = [100, 250, 500, 1000, 2500]

export function VolumeBotPanel({ rec, t }: { rec: LaunchRecord; t?: Token }) {
  const setBot = useGame((s) => s.setBot)
  const px = useGame((s) => (t ? nativePrice(s.market, t.chain) : 1))
  const balance = useGame((s) => (t ? (s.portfolio.balances?.[t.chain] ?? 0) : 0))
  const bot = rec.bot
  const [rate, setRate] = useState(bot?.rate ?? 2000)
  const [budget, setBudget] = useState(250)
  if (!t) return <div className="p-3 text-[11px] text-dim">Token delisted.</div>
  const live = t.status === 'bonding' || t.status === 'graduated'
  const on = !!bot?.on
  const perMin = botCostPerMin(t, on ? bot!.rate : rate)
  const left = bot ? Math.max(0, bot.budget - bot.spent) : 0
  const share = washShare(t)
  const c = CHAINS[t.chain]
  const earnedBack = (bot?.volume ?? 0) * creatorRate(t)

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[1fr_1fr_1.1fr]">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted"><Bot size={13} className="text-info" /> Volume bot</div>
        <p className="text-[11px] leading-snug text-muted">Rotating wallets buy and sell the same size, so the price barely moves but volume, txns and makers go up. That drags in some real attention, until someone notices.</p>
        <div className="text-[10px] text-dim">Speed (volume per minute)</div>
        <Segmented
          value={String(on ? bot!.rate : rate)}
          onChange={(v) => (on ? setBot(t.id, { rate: Number(v) }) : setRate(Number(v)))}
          options={BOT_RATES.map((r) => ({ value: String(r), label: `$${r >= 1000 ? `${r / 1000}K` : r}` }))}
          className="w-full [&>button]:flex-1"
        />
      </div>

      <div className="space-y-2">
        <div className="text-[10px] text-dim">{on ? 'Budget left' : 'Max to burn (fees + price impact)'}</div>
        {on ? (
          <div className="num text-[18px] font-bold">{fmtUsd(left)} <span className="text-[11px] font-normal text-dim">left of {fmtUsd(bot!.budget, 0)} cap</span></div>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            {BUDGETS.map((b) => (
              <button key={b} onClick={() => setBudget(b)} className={clsx('num rounded border py-1 text-[11px] font-semibold', budget === b ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                {b >= 1000 ? `${b / 1000}K` : b}
              </button>
            ))}
          </div>
        )}
        <div className="space-y-0.5 text-[11px]">
          <Row label="Burn rate">≈{fmtUsd(perMin)}/min</Row>
          <Row label="Runs for">≈{Math.max(0, (on ? left : budget) / Math.max(0.01, perMin)).toFixed(1)} min</Row>
          <Row label={`Paid in ${c.native}`}>{fmtNative(balance, t.chain)} <span className="text-dim">≈{fmtUsd(balance * px, 0)}</span></Row>
        </div>
        {live ? (
          on ? (
            <button onClick={() => setBot(t.id, { on: false })} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-down/40 bg-down/10 text-[12px] font-bold text-down hover:bg-down hover:text-white">
              <Square size={12} /> Stop bot
            </button>
          ) : (
            <button
              disabled={balance * px < 1}
              onClick={() => setBot(t.id, { on: true, rate, budget: (bot?.spent ?? 0) + budget })}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-info text-[12px] font-extrabold text-black hover:brightness-110 disabled:opacity-40"
            >
              <Play size={12} /> {balance * px < 1 ? `No ${c.native} to pay fees` : `Start bot · ${fmtUsd(budget, 0)}`}
            </button>
          )
        ) : (
          <div className="rounded-md bg-raise py-2 text-center text-[11px] text-dim">${t.ticker} is {t.status}</div>
        )}
      </div>

      <div className="space-y-2 rounded-md bg-bg/60 p-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-dim">Wash share of 1h volume</span>
          <span className={clsx('num text-[12px] font-bold', share > 0.6 ? 'text-down' : share > 0.35 ? 'text-warn' : 'text-up')}>{Math.round(share * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line2">
          <div className={clsx('h-full transition-all', share > 0.6 ? 'bg-down' : share > 0.35 ? 'bg-warn' : 'bg-up')} style={{ width: `${share * 100}%` }} />
        </div>
        <div className="text-[10px] text-dim">Above ~35%, sleuths get suspicious fast.</div>
        {t.washFlagged && <div className="rounded border border-down/40 bg-down/10 px-2 py-1 text-[11px] font-semibold text-down">🤖 Flagged for wash trading. The bot no longer attracts buyers.</div>}
        <div className="space-y-0.5 pt-1 text-[11px]">
          <Row label="Fake volume made">{fmtUsd(bot?.volume ?? 0, 0)}</Row>
          <Row label="Burned on fees">-{fmtUsd(bot?.spent ?? 0)}</Row>
          <Row label={`Creator fees back (${(creatorRate(t) * 100).toFixed(1)}%)`}><span className="text-up">+{fmtUsd(earnedBack)}</span></Row>
          <Row label="Bot net"><span className={clsx('font-bold', earnedBack - (bot?.spent ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtUsd(earnedBack - (bot?.spent ?? 0))}</span></Row>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-dim">{label}</span>
      <span className="num">{children}</span>
    </div>
  )
}
