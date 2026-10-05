import clsx from 'clsx'
import { ArrowDownUp, Copy, Filter, X } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { OnScreen } from '../OnScreen'
import { CHAINS, fmtNative } from '../../data/chains'
import { bookOf, displayAddress, gasUsd, rowOf, type Holder, type HolderTag, type LedgerTrade } from '../../game/ledger'
import { SUPPLY } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import { nativePrice } from '../../game/tradingEngine'
import type { Token } from '../../types'
import { fmtAge, fmtCompact, fmtNum, fmtTime, fmtUsd, toneClass } from '../../utils/format'
import { inPick, pickFor, useTradePick } from './tradePick'
import { useTrickle } from '../../hooks/useTrickle'

const TAG_ICON: Partial<Record<HolderTag, string>> = { dev: '🧑‍💻', you: '⭐', whale: '🐋', smart: '🧠', kol: '📣', sniper: '🎯', insider: '🐀', fresh: '🌱', agent: '🌀' }
type Who = 'all' | 'dev' | 'you' | 'tracked'

/**
 * Axiom-style Trades panel beside the chart: a compact live feed of every trade on the coin. Click a candle on the
 * chart to see just that candle's trades (with a buy/sell summary); click a row for the full trade details.
 */
export function TradesSide({ token, className }: { token: Token; className?: string }) {
  const now = useGame((s) => s.market.time)
  const nativeUsd = useGame((s) => nativePrice(s.market, token.chain))
  const tracked = useGame((s) => s.trackedWallets)
  const wallets = useGame((s) => s.wallets)
  const pick = useTradePick((s) => pickFor(s.pick, token.id))
  const setPick = useTradePick((s) => s.setPick)
  const close = useTradePick((s) => s.toggle)
  const [who, setWho] = useState<Who>('all')
  const [inNative, setInNative] = useState(false)
  const [clock, setClock] = useState(false)
  const [wallet, setWallet] = useState<string | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const book = bookOf(token, now)
  const coin = CHAINS[token.chain].native
  const tagsOf = (tr: LedgerTrade) => book.holders.get(tr.wallet)?.tags ?? (tr.tag ? [tr.tag] : [])
  // The log is one array that grows at the front: "did it change" is its length and newest id. The lists below are
  // rebuilt only then (or when a filter changes), not on every tick and every trade that trickles in.
  const logVersion = `${book.log.length}:${book.log[0]?.id ?? ''}`
  const trackedKey = who === 'tracked' ? tracked.join(',') : ''
  const inCandle = useMemo(
    () => (pick ? book.log.filter((tr) => inPick(tr.time, pick)) : book.log),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token.id, logVersion, pick],
  )
  const { rows, total } = useMemo(() => {
    const trackedNames = who === 'tracked' ? new Set(wallets.filter((w) => tracked.includes(w.id)).map((w) => w.name)) : null
    const list = inCandle.filter(
      (tr) =>
        (!wallet || tr.wallet === wallet) &&
        (who === 'all' || (who === 'you' ? tr.wallet === 'YOU' : who === 'dev' ? tr.wallet === book.devWallet || tagsOf(tr).includes('dev') : trackedNames!.has(tr.wallet) || !!tr.walletId && tracked.includes(tr.walletId))),
    )
    return { rows: list, total: list.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inCandle, logVersion, wallet, who, trackedKey])
  const trickled = useTrickle(rows) // new trades flow in across the second
  const live = trickled.length > 400 ? trickled.slice(0, 400) : trickled // the newest 400 are listed
  // Candle summary (Axiom shows what happened inside the candle you clicked): only worked out when a candle is picked.
  const summary = useMemo(() => {
    if (!pick) return null
    let buys = 0, sells = 0, buyUsd = 0, sellUsd = 0
    const makers = new Set<string>()
    for (const t of inCandle) {
      if (t.side === 'buy') { buys++; buyUsd += t.usd } else { sells++; sellUsd += t.usd }
      makers.add(t.wallet)
    }
    return { buys, sells, buyUsd, sellUsd, makers: makers.size }
  }, [inCandle, pick])
  const money = (usd: number) => (inNative ? fmtNative(usd / nativeUsd, token.chain, false) : fmtUsd(usd, usd < 10 ? 2 : 0))

  return (
    <aside className={clsx('flex min-h-0 flex-col border-l border-line bg-panel', className)} aria-label="Trades">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="text-[12px] font-bold">Trades</span>
        <span className="num text-[10px] text-dim">{total}</span>
        <button onClick={() => setInNative((v) => !v)} className="ml-auto flex items-center gap-0.5 rounded px-1 text-[10px] font-semibold text-muted hover:text-ink" title={`Show amounts in USD or ${coin}`}>{inNative ? coin : 'USD'} <ArrowDownUp size={9} /></button>
        <button onClick={() => close(false)} className="rounded p-0.5 text-dim hover:text-ink" aria-label="Close trades panel" title="Close"><X size={13} /></button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-line/50 px-2 py-1">
        {(['all', 'dev', 'you', 'tracked'] as Who[]).map((w) => (
          <button key={w} onClick={() => setWho(w)} className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold', who === w ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
            {w === 'all' ? 'All' : w === 'dev' ? '🧑‍💻 Dev' : w === 'you' ? '⭐ You' : '👁 Tracked'}
          </button>
        ))}
        {wallet && (
          <span className="ml-auto flex items-center gap-1 rounded bg-accent/10 px-1.5 text-[10px] font-semibold text-accent">
            <Filter size={9} /> {displayAddress(wallet, token.chain)}
            <button onClick={() => setWallet(null)} aria-label="Clear wallet filter"><X size={10} /></button>
          </span>
        )}
      </div>

      {pick && summary && (
        <div className="shrink-0 border-b border-accent/30 bg-accent/5 px-2 py-1.5 text-[10px]">
          <div className="flex items-center gap-1">
            <span className="font-bold text-accent">🕯 Candle {fmtTime(pick.from)}</span>
            <span className="text-dim">· {pick.tf}</span>
            <button onClick={() => setPick(null)} className="ml-auto flex items-center gap-0.5 rounded px-1 text-muted hover:text-ink" title="Show all trades again"><X size={10} /> Clear</button>
          </div>
          <div className="num mt-0.5 grid grid-cols-3 gap-1">
            <span><span className="text-up">{summary.buys} buys</span> {money(summary.buyUsd)}</span>
            <span><span className="text-down">{summary.sells} sells</span> {money(summary.sellUsd)}</span>
            <span className="text-right">net <span className={toneClass(summary.buyUsd - summary.sellUsd)}>{summary.buyUsd - summary.sellUsd >= 0 ? '+' : '-'}{money(Math.abs(summary.buyUsd - summary.sellUsd))}</span> · {summary.makers} wallets</span>
          </div>
        </div>
      )}

      <div className="grid shrink-0 grid-cols-[42px_1fr_1fr_1.25fr] gap-1 px-2 py-1 text-[10px] text-dim">
        <button onClick={() => setClock((v) => !v)} className="text-left hover:text-ink" title="Age / time">{clock ? 'Time' : 'Age'}</button>
        <span className="text-right">MC</span>
        <span className="text-right">Amount</span>
        <span className="pl-2">Trader</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!rows.length ? (
          <div className="px-3 py-6 text-center text-[11px] text-dim">{pick ? 'No trades in this candle' : 'No trades yet'}{pick && <div><button onClick={() => setPick(null)} className="mt-1 text-accent underline">Show all trades</button></div>}</div>
        ) : (
          live.map((tr, i) => {
            const open = openId === tr.id
            const h = open ? book.holders.get(tr.wallet) : undefined
            return (
              // Only rows on (or near) the screen are drawn; an opened row is taller, so each keeps its own height.
              <OnScreen key={tr.id} estimate={25} drawn={i < 40}>
                <SideRow
                  tr={tr}
                  chain={token.chain}
                  ticker={token.ticker}
                  when={clock ? fmtTime(tr.time).slice(-8) : fmtAge(Math.max(0, now - tr.time))}
                  amount={money(tr.usd)}
                  tags={tagsOf(tr).slice(0, 2).join(',')}
                  open={open}
                  onToggle={setOpenId}
                  // The details change every tick (price, ages): only the one open row is given them.
                  detail={open ? { nativeUsd, now, h, pnl: h ? rowOf(h, token.price).pnl : 0, canFilter: !wallet, onFilter: setWallet } : undefined}
                />
              </OnScreen>
            )
          })
        )}
      </div>
      {!pick && <div className="shrink-0 border-t border-line/50 px-2 py-1 text-[9px] text-dim">Tip: click a candle to see its trades</div>}
    </aside>
  )
}

interface SideDetail { nativeUsd: number; now: number; h: Holder | undefined; pnl: number; canFilter: boolean; onFilter: (w: string) => void }
/** One trade in the side panel. Plain text props, so it redraws only when what it shows changes. */
const SideRow = memo(function SideRow({ tr, chain, ticker, when, amount, tags, open, onToggle, detail }: { tr: LedgerTrade; chain: Token['chain']; ticker: string; when: string; amount: string; tags: string; open: boolean; onToggle: (id: number | null) => void; detail?: SideDetail }) {
  const buy = tr.side === 'buy'
  const h = detail?.h
  return (
    <div className={clsx('border-b border-line/20', tr.wallet === 'YOU' && 'bg-accent/5')}>
      <button onClick={() => onToggle(open ? null : tr.id)} className="grid w-full grid-cols-[42px_1fr_1fr_1.25fr] items-center gap-1 px-2 py-1 text-left text-[11px] hover:bg-panel2/70">
        <span className="num text-dim">{when}</span>
        <span className="num text-right text-muted">{fmtCompact(tr.price * SUPPLY)}</span>
        <span className={clsx('num text-right font-semibold', buy ? 'text-up' : 'text-down')}>{amount}</span>
        <span className="flex min-w-0 items-center gap-0.5 pl-2">
          {(tags ? (tags.split(',') as HolderTag[]) : []).map((k) => TAG_ICON[k] && <span key={k} className="text-[10px]">{TAG_ICON[k]}</span>)}
          <span className={clsx('num truncate', tr.wallet === 'YOU' ? 'font-semibold text-accent' : 'text-muted')}>{displayAddress(tr.wallet, chain)}</span>
        </span>
      </button>
      {open && detail && (
        <div className="space-y-0.5 bg-bg/60 px-2 py-1.5 text-[10px]">
          <Line label="Type"><span className={buy ? 'text-up' : 'text-down'}>{buy ? 'Buy' : 'Sell'}</span> · {fmtTime(tr.time)}</Line>
          <Line label="Amount">{fmtUsd(tr.usd, 2)} · {fmtNative(tr.usd / detail.nativeUsd, chain)}</Line>
          <Line label={`$${ticker}`}>{fmtNum(tr.qty)} ({((tr.qty / SUPPLY) * 100).toFixed(3)}% of supply)</Line>
          <Line label="Price / MC">{fmtUsd(tr.price, 10)} · {fmtCompact(tr.price * SUPPLY)}</Line>
          <Line label="Gas">{fmtUsd(gasUsd(tr, chain), 3)}</Line>
          <Line label="Wallet">
            <span className="num">{displayAddress(tr.wallet, chain)}</span>
            {tr.wallet !== 'YOU' && (
              <button onClick={() => navigator.clipboard?.writeText(displayAddress(tr.wallet, chain)).catch(() => {})} className="ml-1 text-dim hover:text-ink" title="Copy wallet"><Copy size={9} /></button>
            )}
          </Line>
          {h && (
            <>
              <Line label="Wallet on this coin"><span className="text-up">{h.buys}B</span>/<span className="text-down">{h.sells}S</span> · first seen {fmtAge(Math.max(0, detail.now - h.first))} ago</Line>
              <Line label="Wallet PnL"><span className={toneClass(detail.pnl)}>{detail.pnl >= 0 ? '+' : '-'}{fmtUsd(Math.abs(detail.pnl))}</span></Line>
            </>
          )}
          {detail.canFilter && tr.wallet !== 'YOU' && (
            <button onClick={() => detail.onFilter(tr.wallet)} className="mt-0.5 flex items-center gap-1 text-accent hover:underline"><Filter size={9} /> Only this wallet's trades</button>
          )}
        </div>
      )}
    </div>
  )
})

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-dim">{label}</span>
      <span className="num truncate text-right text-ink">{children}</span>
    </div>
  )
}
