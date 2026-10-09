// Admin > Rooms > a player's "Wallets": every wallet that player has in a room (main, side and dev), with its address,
// balances and bags. Only admins can ask the server for this; players only ever see each other's public card (the main
// wallet). Nothing here can change a wallet.
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '../net/adminApi'
import type { AdminWallets } from '../net/protocol'
import { fmtCompact, fmtUsd } from '../utils/format'
import { Modal } from './ui'

const COIN: Record<string, string> = { sol: 'SOL', bsc: 'BNB', hood: 'ETH' }

export function AdminWalletsModal({ room, playerId, name, onClose }: { room: string; playerId: string; name: string; onClose: () => void }) {
  const [data, setData] = useState<AdminWallets | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const r = await adminApi<AdminWallets>('/admin/api/wallets', { room, playerId })
    if (r.ok) {
      setData(r.data!)
      setError('')
    } else setError(r.error ?? 'Could not load')
  }, [room, playerId])
  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 5000)
    return () => clearInterval(id)
  }, [load])

  return (
    <Modal title={`👛 ${name}'s wallets`} onClose={onClose} wide>
      <div className="space-y-2 p-3 text-[12px]">
        {error && <div className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-down">{error}</div>}
        {!data && !error && <div className="text-dim">Loading…</div>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md bg-bg px-3 py-2">
              <span>Net worth <b className="num text-ink">{fmtUsd(data.equity, 0)}</b></span>
              <span>USD bank <b className="num text-ink">{fmtUsd(data.cash, 0)}</b></span>
              <span>Started with <b className="num text-ink">{fmtUsd(data.startBalance, 0)}</b></span>
              <span>Wallets <b className="num text-ink">{data.wallets.length}</b></span>
              <button onClick={() => void load()} className="ml-auto flex items-center gap-1 rounded border border-line2 px-2 py-0.5 text-[11px] text-muted hover:text-ink"><RefreshCw size={11} /> Reload</button>
            </div>
            {!data.wallets.length && <div className="text-dim">No wallet in this room yet (they have not traded here).</div>}
            {data.wallets.map((w) => (
              <div key={w.id} className={clsx('rounded-md border p-2.5', w.kind === 'dev' ? 'border-warn/40 bg-warn/5' : w.kind === 'main' ? 'border-accent/40 bg-accent/5' : 'border-line bg-panel')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px]">{w.emoji}</span>
                  <span className="font-bold text-ink">{w.name}</span>
                  <span className={clsx('rounded px-1.5 py-px text-[9px] font-bold', w.kind === 'dev' ? 'bg-warn/15 text-warn' : w.kind === 'main' ? 'bg-accent/15 text-accent' : 'bg-raise text-muted')}>{w.kind === 'dev' ? 'DEV' : w.kind === 'main' ? 'MAIN (public)' : 'SIDE'}</span>
                  <span className="num text-[10px] text-dim" title="The address this wallet trades under">{w.addr}</span>
                  <span className="num ml-auto font-bold text-ink">{fmtUsd(w.value, 0)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
                  {Object.entries(w.balances).filter(([, n]) => n > 1e-6).map(([c, n]) => <span key={c} className="num">{n.toFixed(3)} {COIN[c] ?? c}</span>)}
                  {!Object.values(w.balances).some((n) => n > 1e-6) && <span className="text-dim">no chain coins</span>}
                </div>
                {!!w.devOf.length && <div className="mt-1 text-[11px] text-warn">Dev wallet of: {w.devOf.map((d) => `$${d.ticker}${d.vaultUsd >= 1 ? ` (${fmtUsd(d.vaultUsd, 0)} fees unclaimed)` : ''}`).join(', ')}</div>}
                {!!w.bags.length && (
                  <table className="mt-1.5 w-full text-[11px]">
                    <thead><tr className="text-left text-[9px] uppercase tracking-wider text-dim"><th>Coin</th><th className="text-right">Worth</th><th className="text-right">Paid</th><th className="text-right">% of supply</th></tr></thead>
                    <tbody>
                      {w.bags.map((b) => (
                        <tr key={b.tokenId} className="border-t border-line/40">
                          <td className="py-0.5"><span className="font-semibold text-ink">${b.ticker}</span>{b.status !== 'bonding' && b.status !== 'graduated' && <span className="ml-1 text-[9px] text-dim">{b.status}</span>}{b.own && <span className="ml-1 text-[9px] text-warn">their coin</span>}</td>
                          <td className="num text-right">{fmtCompact(b.value)}</td>
                          <td className="num text-right text-muted">{fmtCompact(b.cost)}</td>
                          <td className="num text-right text-muted">{b.pct.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
            <p className="text-[10px] text-dim">Only you see this. Other players see a player's main wallet only (their public card); side and dev wallets trade under a bare address. It refreshes every 5 seconds.</p>
          </>
        )}
      </div>
    </Modal>
  )
}
