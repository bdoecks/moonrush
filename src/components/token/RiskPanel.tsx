import clsx from 'clsx'
import { AlertTriangle, Ban, Boxes, ChefHat, CircleCheck, CircleX, Crosshair, Droplet, Flame, Ghost, ShieldAlert, Skull, UserRound, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { useSelectedToken } from '../../hooks/useDerived'
import { useGame } from '../../game/store'
import { publicBundlePct, washShare } from '../../game/devTools'
import { fmtCompact, fmtNum } from '../../utils/format'
import { LAUNCHPADS } from '../../data/launchpads'
import { gradMcapUsd } from '../../game/curve'
import { devPctOf, top10Of } from '../../game/ledger'
import { PadBadge } from '../pad'
import { RiskBadge, RiskMeter } from '../ui'

interface Cell {
  label: string
  value: ReactNode
  icon: ReactNode
  bad: boolean
}

export function RiskPanel({ className }: { className?: string }) {
  const t = useSelectedToken()
  const now = useGame((s) => s.market.time)
  const native = useGame((s) => s.market.native)
  const myQty = useGame((s) => (t ? s.portfolio.positions[t.id]?.qty ?? 0 : 0))
  if (!t) return null
  const nativeUsd = native?.[t.chain]?.price ?? 1
  const liqRatio = t.liquidity / Math.max(1, t.mcap)
  // Same figures the Holders tab shows.
  const top10 = top10Of(t, myQty)
  const devPct = devPctOf(t)
  // Displayed rug estimate is a fuzzy read of the hidden hazard plus visible red flags — a game mechanic.
  const rugEst = t.status === 'rugged' ? 100 : Math.min(99, Math.round(t.rugProb * 60000 + (top10 > 45 ? 10 : 0) + (devPct > 10 ? 8 : 0) + (liqRatio < 0.05 ? 10 : 0)))
  const shady = t.rugProb > 0.0002
  const bundler = publicBundlePct(t)
  const ok = (good: boolean) => (good ? <CircleCheck size={13} /> : <CircleX size={13} />)

  const cells: Cell[] = [
    { label: 'Top 10', value: `${top10.toFixed(2)}%`, icon: <UserRound size={12} />, bad: top10 > 40 },
    { label: 'DEV', value: `${devPct.toFixed(1)}%`, icon: <ChefHat size={12} />, bad: devPct > 8 },
    { label: 'Holders', value: fmtNum(t.holders), icon: <Users size={12} />, bad: t.holders < 50 },
    { label: 'Snipers', value: String(t.snipers), icon: <Crosshair size={12} />, bad: t.snipers > 10 },
    { label: 'Insiders', value: `${t.insidersPct.toFixed(1)}%`, icon: <Ghost size={12} />, bad: t.insidersPct > 15 },
    { label: 'Bundler', value: `${bundler.toFixed(0)}%`, icon: <Boxes size={12} />, bad: bundler > 12 },
    { label: 'Liq / MC', value: `${(liqRatio * 100).toFixed(1)}%`, icon: <Droplet size={12} />, bad: liqRatio < 0.06 },
    { label: 'LP Burnt', value: t.status === 'graduated' ? (shady ? '0%' : '100%') : 'Curve', icon: <Flame size={12} />, bad: t.status === 'graduated' && shady },
    { label: 'NoMint', value: '', icon: ok(!shady), bad: shady },
    { label: 'No Blacklist', value: '', icon: ok(t.rugProb < 0.0004), bad: t.rugProb >= 0.0004 },
    { label: 'Vol risk', value: t.volatility > 0.015 ? 'WILD' : t.volatility > 0.009 ? 'HIGH' : t.volatility > 0.005 ? 'MED' : 'LOW', icon: <Ban size={12} />, bad: t.volatility > 0.015 },
    { label: 'Rug %', value: t.status === 'rugged' ? 'RUGGED' : `${rugEst}%`, icon: <Skull size={12} />, bad: rugEst > 25 },
  ]

  return (
    <div className={clsx('p-3', className)}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
          <ShieldAlert size={13} /> Audit
        </div>
        <RiskBadge level={t.riskLevel} score={t.riskScore} />
      </div>
      <div className="grid grid-cols-4 gap-x-1 gap-y-2.5">
        {cells.map((c) => (
          <div key={c.label} className="text-center">
            <div className="truncate text-[10px] text-dim">{c.label}</div>
            <div className={clsx('num mt-0.5 flex items-center justify-center gap-0.5 text-[12px] font-semibold', c.bad ? 'text-down' : 'text-up')}>
              {c.icon}
              {c.value}
            </div>
          </div>
        ))}
      </div>
      {t.tax && (
        <div className="mt-2 flex items-center justify-between rounded-md border border-warn/30 bg-warn/5 px-2 py-1 text-[11px]">
          <span className="text-warn">Tax coin · paid to the creator</span>
          <span className="num font-bold">Buy {(t.tax.buy * 100).toFixed(0)}% · Sell {(t.tax.sell * 100).toFixed(0)}%</span>
        </div>
      )}
      <div className="mt-3">
        <RiskMeter score={t.riskScore} level={t.riskLevel} />
      </div>
      {t.status === 'bonding' && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[10px] text-dim">
            <span className="flex items-center gap-1"><PadBadge pad={t.pad} size={12} />{LAUNCHPADS[t.pad]?.name ?? 'Bonding'} curve → migrates to {LAUNCHPADS[t.pad]?.dex ?? 'DEX'} at {fmtCompact(gradMcapUsd(t.pad, nativeUsd))}</span>
            <span className="num text-warn">{t.bondingProgress.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line2">
            <div className="h-full bg-warn transition-all duration-700" style={{ width: `${t.bondingProgress}%` }} />
          </div>
        </div>
      )}
      {t.bundleFlagged && (
        <div className="mt-2 rounded-md border border-down/40 bg-down/10 p-2 text-[10px] leading-snug text-down">
          📦 <b>Bundle detected:</b> {t.bundleWallets ?? 'several'} linked wallets bought {(t.bundlePct ?? 0).toFixed(1)}% of supply in the launch block. Classic dump setup.
        </div>
      )}
      {t.washFlagged && (
        <div className="mt-2 rounded-md border border-down/40 bg-down/10 p-2 text-[10px] leading-snug text-down">
          🤖 <b>Wash trading:</b> about {Math.round(washShare(t) * 100)}% of recent volume is bots trading with themselves. Real demand is much lower than it looks.
        </div>
      )}
      {t.creator === 'you' && !t.bundleFlagged && (t.bundlePct ?? 0) > 0.05 && (
        <div className="mt-2 rounded-md border border-info/40 bg-info/10 p-2 text-[10px] leading-snug text-info">
          🕶 Only you can see this: your bundle wallets hold {(t.bundlePct ?? 0).toFixed(1)}% on top of the {t.devPct.toFixed(1)}% dev bag. Not flagged yet.
        </div>
      )}
      {now - t.createdAt < 3600 && t.status !== 'rugged' && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/5 p-2 text-[10px] leading-snug text-warn">
          <AlertTriangle size={12} className="mt-px shrink-0" />
          Fresh launch: holder data is still settling and the dev can still move the market. Trade cautiously.
        </div>
      )}
      <p className="mt-2 text-[9px] leading-snug text-dim">Audit values describe fictional tokens as a game mechanic, not any real asset.</p>
    </div>
  )
}
