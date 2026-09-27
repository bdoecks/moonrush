import clsx from 'clsx'
import { Send } from 'lucide-react'
import { useState } from 'react'
import { CHAINS } from '../data/chains'
import { useGame } from '../game/store'
import { nativePrice } from '../game/tradingEngine'
import { assetLabel, fmtAmt, sendable, sendFunds } from '../net/client'
import type { SendAsset } from '../net/protocol'
import { fmtUsd } from '../utils/format'
import { Modal } from './ui'

const ASSETS: SendAsset[] = ['sol', 'bsc', 'hood', 'usdc']

/** Send SOL / BNB / ETH / USDC to a player in your room (their main wallet) or to a wallet address they gave you. */
export function SendFundsModal({ toPid, onClose }: { toPid?: string; onClose: () => void }) {
  const players = useGame((s) => s.online?.players)
  const me = useGame((s) => s.online?.you)
  const accounts = useGame((s) => s.portfolio.accounts)
  const cash = useGame((s) => s.portfolio.cash)
  const market = useGame((s) => s.market)
  const notify = useGame((s) => s.notify)
  const others = (players ?? []).filter((p) => p.id !== me)
  const [mode, setMode] = useState<'player' | 'address'>('player')
  const [to, setTo] = useState(toPid ?? others[0]?.id ?? '')
  const [addr, setAddr] = useState('')
  const [asset, setAsset] = useState<SendAsset>('sol')
  const [from, setFrom] = useState(accounts?.[0]?.id ?? 'w-main')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  void cash // re-render when the USD bank changes
  const max = sendable(asset, from)
  const amt = parseFloat(amount) || 0
  const usd = asset === 'usdc' ? amt : amt * nativePrice(market, asset)
  const fromMain = asset === 'usdc' || from === accounts?.[0]?.id
  const toName = mode === 'player' ? others.find((p) => p.id === to)?.name ?? '' : addr.trim()

  const submit = async () => {
    setError('')
    if (mode === 'player' && !to) return setError('Pick a player')
    if (mode === 'address' && addr.trim().length < 6) return setError('Paste their wallet address')
    setBusy(true)
    const r = await sendFunds({ ...(mode === 'player' ? { to } : { toAddr: addr.trim() }), asset, amount: amt, fromWallet: from })
    setBusy(false)
    if (!r.ok) return setError(r.error ?? 'Transfer failed')
    notify({ title: 'SENT', body: `${asset === 'usdc' ? fmtUsd(amt) : `${fmtAmt(amt)} ${assetLabel(asset)}`} → ${r.toName ?? toName}`, tone: 'info', icon: '💸' }, 'click')
    onClose()
  }

  const chip = (on: boolean) => clsx('rounded-md border px-2.5 py-1 text-[12px] font-semibold', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')

  return (
    <Modal title={<span className="flex items-center gap-2"><Send size={15} /> Send to a friend</span>} onClose={onClose}>
      <div className="space-y-3 text-[12px]">
        <div className="flex gap-1.5">
          <button onClick={() => setMode('player')} className={chip(mode === 'player')}>🧑 Player (main wallet)</button>
          <button onClick={() => setMode('address')} className={chip(mode === 'address')}>🕶 Wallet address</button>
        </div>
        {mode === 'player' ? (
          others.length ? (
            <div className="flex flex-wrap gap-1.5">
              {others.map((p) => (
                <button key={p.id} onClick={() => setTo(p.id)} className={chip(to === p.id)}>{p.avatar} {p.name}{!p.online && <span className="ml-1 text-[10px] font-normal text-dim">(offline, gets it on return)</span>}</button>
              ))}
            </div>
          ) : (
            <div className="text-dim">Nobody else is in this room yet.</div>
          )
        ) : (
          <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Their wallet address (e.g. 9fQx…b7nK)" className="num h-9 w-full rounded-md border border-line2 bg-bg px-2 outline-none focus:border-accent/60" />
        )}

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Asset</div>
          <div className="flex flex-wrap gap-1.5">
            {ASSETS.map((a) => (
              <button key={a} onClick={() => setAsset(a)} className={chip(asset === a)} style={asset === a && a !== 'usdc' ? { color: CHAINS[a].color } : undefined}>{assetLabel(a)}</button>
            ))}
          </div>
        </div>

        {asset !== 'usdc' && (accounts?.length ?? 0) > 1 && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">From wallet</div>
            <div className="flex flex-wrap gap-1.5">
              {accounts!.map((a, i) => (
                <button key={a.id} onClick={() => setFrom(a.id)} className={chip(from === a.id)}>
                  {a.emoji} {a.name} <span className="num text-[10px] font-normal text-dim">{fmtAmt(a.balances[asset])}</span>
                  {i > 0 && <span className="ml-1 text-[9px] font-normal text-dim">🕶</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-dim">
            <span>Amount</span>
            <button onClick={() => setAmount(String(Math.floor(max * 1e6) / 1e6))} className="normal-case text-accent hover:underline">Max {asset === 'usdc' ? fmtUsd(max) : `${fmtAmt(max)} ${assetLabel(asset)}`}</button>
          </div>
          <div className="flex items-center gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder="0.0" className="num h-9 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 text-[14px] outline-none focus:border-accent/60" />
            <span className="num w-24 text-right text-muted">≈ {fmtUsd(usd)}</span>
          </div>
        </div>

        <p className="text-[10px] leading-snug text-dim">
          {fromMain ? 'Sent from your main wallet: they see your name.' : 'Sent from a side wallet: they only see its address.'} Gifts count like deposits, so they don’t change anyone’s % on the leaderboard.
        </p>
        {error && <div className="rounded-md border border-down/40 bg-down/10 px-2 py-1.5 text-down">{error}</div>}
        <button onClick={submit} disabled={busy || !(amt > 0) || amt > max + 1e-12} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[13px] font-bold text-accent-ink disabled:opacity-40">
          <Send size={14} /> {busy ? 'Sending…' : `Send${amt > 0 ? ` ${asset === 'usdc' ? fmtUsd(amt) : `${fmtAmt(amt)} ${assetLabel(asset)}`}` : ''}${toName ? ` to ${toName}` : ''}`}
        </button>
      </div>
    </Modal>
  )
}
