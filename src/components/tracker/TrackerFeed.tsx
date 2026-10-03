import clsx from 'clsx'
import { Bell, BellOff, Pause, Play, Settings2, SlidersHorizontal, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CHAIN_IDS, CHAINS } from '../../data/chains'
import { useTokenMap } from '../../hooks/useDerived'
import { SIM_SEC_PER_TICK } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import { activeFilterCount, passesFeed, trackedHolders } from '../../game/tracker'
import type { WalletActionKind } from '../../types'
import { fmtAge, fmtCompact, fmtNum, fmtUsd, toneClass } from '../../utils/format'
import { QuickBuyButton } from '../chain'
import { EmptyState, Pct, TokenIcon } from '../ui'
import { TrackerSettingsModal } from './TrackerSettingsModal'
import { useFriendRows, type TrackerRow } from './friendRows'
import { GroupMenu, NewGroupButton } from './groups'

const ACTION: Record<WalletActionKind, { label: string; short: string; cls: string }> = {
  first: { label: 'First Buy', short: 'Buy', cls: 'text-up' },
  more: { label: 'Buy More', short: 'Buy+', cls: 'text-up' },
  partial: { label: 'Sell Partial', short: 'Sell', cls: 'text-warn' },
  all: { label: 'Sell All', short: 'Sell all', cls: 'text-down' },
}

const th = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim whitespace-nowrap'
const td = 'px-3 py-1.5 whitespace-nowrap'
const chip = (on: boolean) => clsx('rounded-md border px-2 py-0.5 text-[11px] font-semibold transition-colors', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')

type Row = TrackerRow

/** Live trades by the wallets you track, filtered per your tracker settings. `compact` is the bottom-dock version. */
export function TrackerFeed({ compact = false, onManage }: { compact?: boolean; onManage?: () => void }) {
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const labels = useGame((s) => s.walletLabels)
  const f = useGame((s) => s.tracker)
  const update = useGame((s) => s.updateTracker)
  const tick = useGame((s) => s.market.tick)
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const setView = useGame((s) => s.setView)
  const map = useTokenMap()
  const [settings, setSettings] = useState<null | 'alerts' | 'filters' | 'groups'>(null)
  const [frozen, setFrozen] = useState<Row[] | null>(null) // rows held on screen while the feed is paused
  const friends = useFriendRows() // friends you track in a room (main wallets / known side-wallet addresses)

  const holders = useMemo(() => trackedHolders(wallets, tracked), [wallets, tracked])
  const live = useMemo(() => {
    const out: Row[] = []
    for (const w of wallets) {
      if (!tracked.includes(w.id)) continue
      for (const tr of w.trades) {
        if (passesFeed(f, { walletId: w.id, side: tr.side, usd: tr.usd, kind: tr.action, mcap: tr.mcap }, map.get(tr.tokenId), now, labels)) out.push({ w, tr })
      }
    }
    for (const r of friends.rows) if (passesFeed(f, { walletId: r.w.id, side: r.tr.side, usd: r.tr.usd, kind: r.tr.action, mcap: r.tr.mcap }, map.get(r.tr.tokenId), now, labels)) out.push(r)
    return out.sort((a, b) => b.tr.tick - a.tr.tick || b.tr.id - a.tr.id).slice(0, compact ? 60 : 150)
  }, [wallets, tracked, friends.rows, f, map, now, labels, compact])
  const paused = frozen !== null
  const rows = frozen ?? live
  const nFilters = activeFilterCount(f)
  const manage = onManage ?? (() => setView('track'))

  if (!tracked.length && !friends.count) {
    return <EmptyState icon={<UserPlus />} title="You're not tracking any wallets yet" hint={<button onClick={manage} className="text-accent underline">Add wallets to track →</button>} />
  }

  return (
    <div>
      <div className={clsx('flex flex-wrap items-center gap-1.5 border-b border-line px-3', compact ? 'py-1.5' : 'py-2')}>
        <button onClick={() => update({ group: 'all' })} className={chip(f.group === 'all')}>All {tracked.length + friends.count}</button>
        {f.groups.map((g) => (
          <button key={g} onClick={() => update({ group: f.group === g ? 'all' : g })} className={chip(f.group === g)}>📁 {g}</button>
        ))}
        <NewGroupButton onAdded={(g) => update({ group: g })} className="text-[11px]" />
        <span className="mx-1 h-4 w-px bg-line2" />
        {CHAIN_IDS.map((c) => (
          <button key={c} onClick={() => update({ chains: f.chains.includes(c) ? f.chains.filter((x) => x !== c) : [...f.chains, c] })} aria-pressed={f.chains.includes(c)} className={chip(f.chains.includes(c))}>
            {CHAINS[c].short}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line2" />
        {(['all', 'buy', 'sell'] as const).map((s) => (
          <button key={s} onClick={() => update({ side: s })} className={chip(f.side === s)}>{s === 'all' ? 'All' : s === 'buy' ? 'Buys' : 'Sells'}</button>
        ))}
        <button onClick={() => setSettings('filters')} className={clsx(chip(nFilters > 0), 'flex items-center gap-1')}>
          <SlidersHorizontal size={11} /> Filters{nFilters ? ` ${nFilters}` : ''}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => update({ alerts: !f.alerts })} title={f.alerts ? 'Trade alerts on' : 'Trade alerts off'} aria-pressed={f.alerts} className={clsx('rounded p-1', f.alerts ? 'text-accent' : 'text-dim')}>
            {f.alerts ? <Bell size={13} /> : <BellOff size={13} />}
          </button>
          <button onClick={() => setFrozen(paused ? null : live)} title={paused ? 'Resume live feed' : 'Pause feed'} aria-pressed={paused} className={clsx('rounded p-1', paused ? 'text-warn' : 'text-muted hover:text-ink')}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
          <button onClick={() => setSettings('alerts')} title="Tracker settings" className="rounded p-1 text-muted hover:text-ink" aria-label="Tracker settings"><Settings2 size={13} /></button>
          <span className={clsx('flex items-center gap-1 text-[10px]', paused ? 'text-warn' : 'text-dim')}>
            <span className={clsx('size-1.5 rounded-full', paused ? 'bg-warn' : 'bg-up pulse-dot')} /> {paused ? 'paused' : 'live'}
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="📭" title={nFilters ? 'No trades match your filters' : "Your wallets haven't traded this session yet"} hint={nFilters ? <button onClick={() => setSettings('filters')} className="text-accent underline">Adjust filters</button> : undefined} />
      ) : (
        <div className="overflow-x-auto">
          <table className={clsx('w-full text-[12px]', compact ? 'min-w-[640px]' : 'min-w-[900px]')}>
            <thead className="sticky top-0 z-[1] bg-panel">
              <tr className="border-b border-line">
                <th className={clsx(th, 'text-left')}>Age</th>
                <th className={clsx(th, 'text-left')}>Wallet</th>
                <th className={clsx(th, 'text-left')}>Type</th>
                <th className={clsx(th, 'text-left')}>Token</th>
                <th className={clsx(th, 'text-right')}>Amount</th>
                <th className={clsx(th, 'text-right')}>{compact ? 'MC' : 'MC at trade → now'}</th>
                {!compact && <th className={clsx(th, 'text-right')} title="Tracked wallets holding this coin now">Tracked</th>}
                {!compact && <th className={clsx(th, 'text-right')}>PnL</th>}
                <th className={clsx(th, 'text-right')}>Buy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, tr, friend }) => {
                const t = map.get(tr.tokenId)
                const a = ACTION[tr.action ?? (tr.side === 'buy' ? 'first' : 'all')]
                const since = t && tr.mcap ? t.mcap / tr.mcap - 1 : 0
                const n = holders.get(tr.tokenId) ?? 0
                const hot = f.clusterMin > 0 && n >= f.clusterMin
                const lb = labels[w.id]
                return (
                  <tr key={`${w.id}-${tr.id}`} className={clsx('slide-in border-b border-line/40 hover:bg-panel2', hot && tr.side === 'buy' && 'bg-accent/[0.04]')}>
                    <td className={clsx(td, 'num text-dim')}>{fmtAge((tick - tr.tick) * SIM_SEC_PER_TICK)}</td>
                    <td className={td}>
                      <button onClick={() => (friend ? setView('leaderboard') : openWallet(w.id))} className="flex items-center gap-1.5 hover:text-accent" title={friend ? 'A player in your room: open the leaderboard' : undefined}>
                        <span>{w.avatar}</span>
                        <span className="font-semibold">{lb?.label || w.name}</span>
                        {friend && <span className="rounded bg-[#b36bff]/15 px-1 text-[9px] font-bold text-[#b36bff]">FRIEND</span>}
                      </button>
                      <GroupMenu id={w.id} className="ml-1 inline-block align-middle" />
                    </td>
                    <td className={clsx(td, 'font-semibold', a.cls)}>{compact ? a.short : a.label}</td>
                    <td className={td}>
                      <button disabled={!t} onClick={() => t && select(t.id)} className="flex items-center gap-1.5 hover:text-accent">
                        <TokenIcon token={t ?? { emoji: tr.emoji, hue: tr.hue, status: 'dead' }} size={compact ? 16 : 20} />
                        <span className="font-bold">{tr.ticker}</span>
                        {t && <span className="rounded px-1 text-[9px] font-bold" style={{ color: CHAINS[t.chain].color, background: `${CHAINS[t.chain].color}1f` }}>{CHAINS[t.chain].short}</span>}
                        {t && <span className="num text-[10px] text-dim">{fmtAge(now - t.createdAt)}</span>}
                      </button>
                    </td>
                    <td className={clsx(td, 'text-right num', tr.side === 'buy' ? 'text-up' : 'text-down')}>
                      {fmtUsd(tr.usd)}
                      {!compact && <span className="ml-1 text-[10px] text-dim">{fmtNum(tr.qty)}</span>}
                    </td>
                    <td className={clsx(td, 'text-right num')}>
                      {compact ? (
                        <span className="text-ink">{t ? fmtCompact(t.mcap) : 'delisted'}</span>
                      ) : (
                        <>
                          <span className="text-muted">{tr.mcap ? fmtCompact(tr.mcap) : '—'}</span>
                          <span className="text-dim"> → </span>
                          <span className="text-ink">{t ? fmtCompact(t.mcap) : 'delisted'}</span>
                        </>
                      )}
                      {t && tr.mcap ? <Pct v={since} className="ml-1 text-[10px]" /> : null}
                    </td>
                    {!compact && (
                      <td className={clsx(td, 'text-right num', hot ? 'font-bold text-accent' : n > 1 ? 'text-ink' : 'text-dim')}>
                        {hot && '🔥 '}{n || '—'}
                      </td>
                    )}
                    {!compact && (
                      <td className={clsx(td, 'text-right num', tr.pnl !== undefined ? toneClass(tr.pnl) : 'text-dim')}>
                        {tr.pnl !== undefined ? `${tr.pnl >= 0 ? '+' : '-'}${fmtCompact(Math.abs(tr.pnl))}` : '—'}
                      </td>
                    )}
                    <td className={clsx(td, 'text-right')}><QuickBuyButton t={t} className="py-0.5" /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {settings && <TrackerSettingsModal initialTab={settings} onClose={() => setSettings(null)} />}
    </div>
  )
}
