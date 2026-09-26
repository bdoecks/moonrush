import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useSelectedToken } from '../../hooks/useDerived'
import { candleStore } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import type { Timeframe, Token } from '../../types'
import { fmtCompact, fmtNum } from '../../utils/format'
import { clamp } from '../../utils/rng'
import { Pct } from '../ui'

type Win = '1m' | '5m' | '1h' | '24h'
const WINDOWS: { id: Win; sec: number; src: Timeframe }[] = [
  { id: '1m', sec: 60, src: '1m' },
  { id: '5m', sec: 300, src: '1m' },
  { id: '1h', sec: 3600, src: '5m' },
  { id: '24h', sec: 86400, src: '1h' },
]

/** Buy/sell flow over a window, estimated from candle volume and direction. */
function flow(t: Token, w: (typeof WINDOWS)[number], now: number) {
  const arr = candleStore.get(t.id)?.[w.src] ?? []
  let buyVol = 0
  let sellVol = 0
  for (let i = arr.length - 1; i >= 0 && arr[i].time > now - w.sec - 1; i--) {
    const c = arr[i]
    const share = clamp(0.5 + 4 * (c.close / c.open - 1), 0.15, 0.85)
    buyVol += c.volume * share
    sellVol += c.volume * (1 - share)
  }
  const avg = clamp(t.mcap * 0.0004, 25, 2500)
  return { vol: buyVol + sellVol, buyVol, sellVol, buys: Math.round(buyVol / avg), sells: Math.round(sellVol / avg), net: buyVol - sellVol }
}

export function FlowStats() {
  const t = useSelectedToken()
  const now = useGame((s) => s.market.time)
  const [win, setWin] = useState<Win>('5m')
  const w = WINDOWS.find((x) => x.id === win)!
  const f = useMemo(() => (t ? flow(t, w, now) : null), [t, w, now])
  if (!t || !f) return null
  const total = f.buyVol + f.sellVol || 1
  return (
    <div className="p-2">
      <div className="grid grid-cols-4 gap-1">
        {WINDOWS.map((x) => (
          <button
            key={x.id}
            onClick={() => setWin(x.id)}
            className={clsx('rounded-md py-1.5 text-center transition-colors', win === x.id ? 'bg-raise shadow-[inset_0_0_0_1px_var(--color-line2)]' : 'hover:bg-panel2')}
          >
            <div className="text-[10px] text-dim">{x.id}</div>
            <Pct v={t.change[x.id]} className="text-[12px] font-semibold" />
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 px-1 text-[10px]">
        <div><div className="text-dim">Vol</div><div className="num text-[12px] text-ink">{fmtCompact(f.vol)}</div></div>
        <div><div className="text-dim">Buys</div><div className="num text-[12px] text-up">{fmtNum(f.buys)}<span className="text-[10px] text-up/70">/{fmtCompact(f.buyVol)}</span></div></div>
        <div><div className="text-dim">Sells</div><div className="num text-[12px] text-down">{fmtNum(f.sells)}<span className="text-[10px] text-down/70">/{fmtCompact(f.sellVol)}</span></div></div>
        <div className="text-right"><div className="text-dim">Net Buy</div><div className={clsx('num text-[12px]', f.net >= 0 ? 'text-up' : 'text-down')}>{f.net >= 0 ? '+' : '-'}{fmtCompact(Math.abs(f.net))}</div></div>
      </div>
      <div className="mx-1 mt-1.5 flex h-1 overflow-hidden rounded-full bg-down">
        <div className="bg-up transition-all duration-500" style={{ width: `${(f.buyVol / total) * 100}%` }} />
      </div>
    </div>
  )
}
