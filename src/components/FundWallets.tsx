import clsx from 'clsx'
import { Check, Coins } from 'lucide-react'
import { useState } from 'react'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { useGame } from '../game/store'
import { nativePrice } from '../game/tradingEngine'
import { useWalletGroups } from '../game/walletGroups'
import type { Chain } from '../types'
import { fmtUsd } from '../utils/format'
import { Modal } from './ui'

/** Top up several of your wallets at once: from the USD bank (swapped in) or sent from one of your wallets. */
export function FundWalletsModal({ initialTo, onClose }: { initialTo?: string[]; onClose: () => void }) {
  const accounts = useGame((s) => s.portfolio.accounts) ?? []
  const cash = useGame((s) => s.portfolio.cash)
  const market = useGame((s) => s.market)
  const fund = useGame((s) => s.fundWallets)
  const groups = useWalletGroups((s) => s.groups)
  const [source, setSource] = useState<'usd' | string>('usd')
  const [chain, setChain] = useState<Chain>('sol')
  const [to, setTo] = useState<string[]>(initialTo ?? accounts.slice(1).map((a) => a.id))
  const [amount, setAmount] = useState('')
  const amt = parseFloat(amount) || 0
  const px = nativePrice(market, chain)
  const targets = to.filter((id) => id !== source)
  const src = accounts.find((a) => a.id === source)
  // From USD you type dollars per wallet; from a wallet you type coins per wallet.
  const perUsd = source === 'usd' ? amt : amt * px
  const total = amt * targets.length
  const have = source === 'usd' ? cash : src?.balances[chain] ?? 0
  const short = total > have + 1e-9
  const chip = (on: boolean) => clsx('flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')
  const toggle = (id: string) => setTo(to.includes(id) ? to.filter((x) => x !== id) : [...to, id])

  return (
    <Modal title={<span className="flex items-center gap-2"><Coins size={15} /> Fund wallets</span>} onClose={onClose}>
      <div className="space-y-3 text-[12px]">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">From</div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setSource('usd')} className={chip(source === 'usd')}>🏦 USD bank <span className="num font-normal text-dim">{fmtUsd(cash, 0)}</span></button>
            {accounts.map((a) => (
              <button key={a.id} onClick={() => setSource(a.id)} className={chip(source === a.id)}>{a.emoji} {a.name} <span className="num font-normal text-dim">{fmtNative(a.balances[chain], chain)}</span></button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Coin</div>
          <div className="flex gap-1.5">
            {CHAIN_IDS.map((c) => (
              <button key={c} onClick={() => setChain(c)} className={chip(chain === c)} style={chain === c ? { color: CHAINS[c].color } : undefined}>{CHAINS[c].native}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-dim">
            <span>To ({targets.length})</span>
            <span className="flex gap-2 normal-case">
              <button onClick={() => setTo(accounts.map((a) => a.id))} className="text-accent hover:underline">All</button>
              <button onClick={() => setTo([])} className="text-dim hover:text-ink">None</button>
            </span>
          </div>
          {groups.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1">
              {groups.map((g) => (
                <button key={g.id} onClick={() => setTo(accounts.filter((a) => g.walletIds.includes(a.id)).map((a) => a.id))} className="rounded-md border border-dashed border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-ink">{g.emoji} {g.name}</button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => (
              <button key={a.id} disabled={a.id === source} onClick={() => toggle(a.id)} className={clsx(chip(to.includes(a.id) && a.id !== source), 'disabled:opacity-30')}>
                {to.includes(a.id) && a.id !== source && <Check size={10} />}{a.emoji} {a.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Each wallet gets</div>
          <div className="flex items-center gap-2">
            <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={source === 'usd' ? '$ per wallet' : `${CHAINS[chain].native} per wallet`} className="num h-9 min-w-0 flex-1 rounded-md border border-line2 bg-bg px-2 text-[14px] outline-none focus:border-accent/60" />
            <span className="w-14 text-muted">{source === 'usd' ? 'USD' : CHAINS[chain].native}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(source === 'usd' ? [50, 100, 250, 500, 1000] : [0.1, 0.25, 0.5, 1, 2]).map((v) => (
              <button key={v} onClick={() => setAmount(String(v))} className="num rounded border border-line2 px-1.5 py-0.5 text-[10px] text-muted hover:text-ink">{source === 'usd' ? `$${v}` : v}</button>
            ))}
          </div>
        </div>

        <div className="rounded-md bg-bg/60 px-2 py-1.5 text-[11px]">
          <div className="flex justify-between"><span className="text-dim">Each</span><span className="num">{source === 'usd' ? `${fmtUsd(amt)} → ≈${fmtNative(amt / px, chain)}` : `${fmtNative(amt, chain)} ≈ ${fmtUsd(perUsd)}`}</span></div>
          <div className="flex justify-between"><span className="text-dim">Total</span><span className={clsx('num', short && 'text-down')}>{source === 'usd' ? fmtUsd(total) : fmtNative(total, chain)} <span className="text-dim">of {source === 'usd' ? fmtUsd(have) : fmtNative(have, chain)}</span></span></div>
        </div>
        {source !== 'usd' && <p className="text-[10px] leading-snug text-dim">Heads up: sending straight from one wallet to another leaves a trail. If you fund side wallets from your dev wallet, sleuths can link them to you. Funding from the USD bank doesn't.</p>}

        <button
          disabled={!(amt > 0) || !targets.length || short}
          onClick={() => fund(source, targets, chain, amt) > 0 && onClose()}
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[13px] font-bold text-accent-ink disabled:opacity-40"
        >
          <Coins size={14} /> {short ? 'Not enough' : `Fund ${targets.length} wallet${targets.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  )
}
