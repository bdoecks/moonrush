import { X } from 'lucide-react'
import { useState } from 'react'
import { useGame } from '../../game/store'
import { addrKey, playerKey, useFriends } from '../../net/friends'
import { fmtAge, fmtCompact, fmtUsd } from '../../utils/format'
import { GroupMenu } from './groups'
/** Wallets you follow in this room, plus a box to add a side wallet by address (if a friend gave it to you). */
export function WatchedWallets() {
  const watch = useFriends((s) => s.watch)
  const trades = useFriends((s) => s.trades)
  const toggle = useFriends((s) => s.toggle)
  const rename = useFriends((s) => s.rename)
  const notify = useGame((s) => s.notify)
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const [addr, setAddr] = useState('')
  const [label, setLabel] = useState('')
  const add = () => {
    const a = addr.trim()
    if (a.length < 6) return notify({ title: 'ADDRESS', body: 'Paste a wallet address like 9fQx…b7nK', tone: 'warn', icon: '⚠️' })
    if (!watch.some((w) => w.key === addrKey(a))) toggle({ key: addrKey(a), label: label.trim() || a })
    notify({ title: 'TRACKING', body: `${label.trim() || a} · you'll get an alert when it trades`, tone: 'info', icon: '👁' }, 'click')
    setAddr('')
    setLabel('')
  }
  const recent = trades.filter((t) => watch.some((w) => (t.pid && w.key === playerKey(t.pid)) || (t.addr && w.key === addrKey(t.addr)))).slice(0, 8)
  const labelOf = (t: (typeof trades)[number]) => watch.find((w) => (t.pid && w.key === playerKey(t.pid)) || (t.addr && w.key === addrKey(t.addr)))?.label ?? t.name
  return (
    <div className="rounded-md border border-line bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-bold">👁 Wallets you track</span>
        <span className="text-[10px] text-dim">Main wallets are public. Side wallets only show an address: track one if a friend shares it or you spot it on a coin's trades.</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {watch.length === 0 && <span className="text-[11px] text-dim">Nobody yet. Hit the 🔔 next to a player, or add an address below.</span>}
        {watch.map((w) => (
          <span key={w.key} className="inline-flex items-center gap-1 rounded-md border border-line2 bg-bg px-2 py-0.5 text-[11px]">
            <span>{w.key.startsWith('p:') ? '🧑' : '🕶'}</span>
            <input defaultValue={w.label} onBlur={(e) => e.target.value.trim() && rename(w.key, e.target.value.trim())} className="num w-28 bg-transparent font-semibold outline-none" title="Rename" />
            <GroupMenu id={w.key} />
            <button onClick={() => toggle(w)} className="text-dim hover:text-down" aria-label="Stop tracking"><X size={11} /></button>
          </span>
        ))}
      </div>
      <form className="mt-2 flex flex-wrap gap-1.5" onSubmit={(e) => (e.preventDefault(), add())}>
        <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Wallet address (e.g. 9fQx…b7nK)" className="num min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 py-1 text-[11px] outline-none focus:border-accent/60" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="w-32 rounded-md border border-line2 bg-bg px-2 py-1 text-[11px] outline-none focus:border-accent/60" />
        <button type="submit" className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20">Track address</button>
      </form>
      {recent.length > 0 && (
        <div className="mt-2 border-t border-line pt-1.5">
          {recent.map((t) => (
            <button key={t.key} onClick={() => select(t.tokenId)} className="flex w-full items-center gap-2 py-0.5 text-left text-[11px] hover:text-accent">
              <span className="num w-9 text-dim">{fmtAge(Math.max(0, now - t.time))}</span>
              <span className="w-24 truncate font-semibold">{labelOf(t)}</span>
              <span className={t.side === 'buy' ? 'text-up' : 'text-down'}>{t.side === 'buy' ? 'bought' : 'sold'}</span>
              <span className="num">{fmtUsd(t.usd, t.usd < 10 ? 2 : 0)}</span>
              <span className="font-semibold">${t.ticker}</span>
              <span className="num text-dim">@ {fmtCompact(t.mcap)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

