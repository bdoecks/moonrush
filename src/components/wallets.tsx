import clsx from 'clsx'
import { ArrowRight, Check, ChevronDown, Copy, Pencil, Plus, Send, Settings2, Trash2, Wallet } from 'lucide-react'
import { SendFundsModal } from './SendFunds'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import { accountValue, MAX_WALLETS, WALLET_EMOJIS } from '../game/accounts'
import { useGame } from '../game/store'
import { useWalletGroups } from '../game/walletGroups'
import { nativePrice } from '../game/tradingEngine'
import { useWallets } from '../hooks/useWallets'
import type { Account, Chain } from '../types'
import { playerId } from '../net/client'
import { fakeAddress, walletAddress } from '../utils/address'
import { fmtUsd } from '../utils/format'
import { Modal } from './ui'

/** USD value of each wallet (coins + bags). */
function useWalletValues(all: Account[]) {
  const tokens = useGame((s) => s.market.tokens)
  const market = useGame((s) => s.market)
  return useMemo(() => {
    const price = new Map(tokens.map((t) => [t.id, t.price]))
    return new Map(all.map((a) => [a.id, accountValue(a, (id) => price.get(id) ?? 0, (c) => nativePrice(market, c))]))
  }, [all, tokens, market])
}

function Emojis({ list, size = 14 }: { list: Account[]; size?: number }) {
  return (
    <span className="flex items-center -space-x-1">
      {list.slice(0, 3).map((a) => (
        <span key={a.id} className="grid place-items-center rounded-full bg-raise ring-1 ring-panel" style={{ width: size + 4, height: size + 4, fontSize: size * 0.72 }}>{a.emoji}</span>
      ))}
    </span>
  )
}

/**
 * GMGN-style wallet selector: tick the wallets you trade from. Buys run from every ticked wallet; sells take the same
 * share of each one's bag.
 */
export function WalletSelector({ chain, className, compact, dropUp, align = 'right' }: { chain?: Chain; className?: string; compact?: boolean; dropUp?: boolean; align?: 'left' | 'right' }) {
  const { all, selected, activeIds } = useWallets()
  const setActive = useGame((s) => s.setActiveWallets)
  const openManager = useGame((s) => s.setWalletsOpen)
  const values = useWalletValues(all)
  const groups = useWalletGroups((s) => s.groups)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])
  const toggle = (id: string) => {
    const on = activeIds.includes(id)
    if (on && activeIds.length === 1) return // at least one wallet stays selected
    setActive(on ? activeIds.filter((x) => x !== id) : [...activeIds, id])
  }
  const label = selected.length === 1 ? selected[0].name : `${selected.length} wallets`
  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Wallets you trade from"
        className={clsx('flex items-center gap-1.5 rounded-md border px-1.5 text-[11px] font-semibold transition-colors', selected.length > 1 ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink', compact ? 'h-6' : 'h-7')}
      >
        <Emojis list={selected} size={compact ? 11 : 13} />
        <span className="max-w-[90px] truncate">{label}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className={clsx('absolute z-50 w-[280px] max-w-[calc(100vw-24px)] whitespace-normal rounded-lg', dropUp ? 'bottom-full mb-1' : 'top-full mt-1', align === 'right' ? 'right-0' : 'left-0')}>
        <div className="rounded-lg border border-line2 bg-panel p-2 shadow-[0_18px_48px_-12px_rgba(0,0,0,0.8)]">
          <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] uppercase tracking-wider text-dim">
            <span>Trade from</span>
            <button onClick={() => setActive(all.map((a) => a.id))} className="normal-case text-accent hover:underline">Select all</button>
          </div>
          {groups.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1 px-1">
              {groups.map((g) => {
                const ids = all.filter((a) => g.walletIds.includes(a.id)).map((a) => a.id)
                const on = ids.length > 0 && ids.length === activeIds.length && ids.every((id) => activeIds.includes(id))
                return (
                  <button key={g.id} type="button" disabled={!ids.length} onClick={() => setActive(ids)} title={`Trade from group ${g.name} (${ids.length} wallets)`} className={clsx('flex items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-[10px] font-semibold disabled:opacity-40', on ? 'border-accent bg-accent/15 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                    {g.emoji} {g.name} <span className="num text-dim">{ids.length}</span>
                  </button>
                )
              })}
            </div>
          )}
          <div className="max-h-[300px] space-y-0.5 overflow-y-auto">
            {all.map((a) => {
              const on = activeIds.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  aria-pressed={on}
                  className={clsx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors', on ? 'bg-accent/10' : 'hover:bg-raise')}
                >
                  <span className={clsx('grid size-4 shrink-0 place-items-center rounded border', on ? 'border-accent bg-accent text-black' : 'border-line2')}>{on && <Check size={11} strokeWidth={3} />}</span>
                  <span className="text-[15px]">{a.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-ink">{a.name}{activeIds[0] === a.id && <span className="ml-1 rounded bg-raise px-1 text-[8px] font-bold text-muted">PRIMARY</span>}</span>
                    <span className="num block text-[10px] text-dim">
                      {chain ? fmtNative(a.balances[chain], chain) : CHAIN_IDS.map((c) => `${CHAINS[c].glyph}${fmtNative(a.balances[c], c, false)}`).join(' ')}
                    </span>
                  </span>
                  <span className="num text-[11px] text-muted">{fmtUsd(values.get(a.id) ?? 0, 0)}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 px-1 text-[9px] leading-snug text-dim">Buys run from every ticked wallet. Sells take the same % of each one's bag. The first ticked wallet is your primary (dev buys, copy trades, bots).</p>
          <button
            onClick={() => {
              setOpen(false)
              openManager(true)
            }}
            className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-line2 text-[12px] font-semibold text-muted hover:text-ink"
          >
            <Settings2 size={12} /> Manage wallets
          </button>
        </div>
        </div>
      )}
    </div>
  )
}

/** Create, rename, fund and delete wallets; move coins between them. */
export function WalletManager() {
  const open = useGame((s) => s.walletsOpen)
  const setOpen = useGame((s) => s.setWalletsOpen)
  if (!open) return null
  return <ManagerBody onClose={() => setOpen(false)} />
}

function ManagerBody({ onClose }: { onClose: () => void }) {
  const { all, activeIds } = useWallets()
  const values = useWalletValues(all)
  const market = useGame((s) => s.market)
  const cash = useGame((s) => s.portfolio.cash)
  const tokens = useGame((s) => s.market.tokens)
  const create = useGame((s) => s.createWallet)
  const update = useGame((s) => s.updateWallet)
  const del = useGame((s) => s.deleteWallet)
  const setActive = useGame((s) => s.setActiveWallets)
  const transfer = useGame((s) => s.transferNative)
  const swapAssets = useGame((s) => s.swapAssets)
  const online = useGame((s) => !!s.online)
  const notify = useGame((s) => s.notify)
  const [sending, setSending] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(WALLET_EMOJIS[(all.length) % WALLET_EMOJIS.length])
  const [editing, setEditing] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [tf, setTf] = useState({ from: all[0]?.id ?? '', to: all[1]?.id ?? all[0]?.id ?? '', chain: 'sol' as Chain, amount: '' })
  const [fund, setFund] = useState({ to: all[0]?.id ?? '', chain: 'sol' as Chain, usd: '' })
  const total = [...values.values()].reduce((a, b) => a + b, 0)
  const tokenName = new Map(tokens.map((t) => [t.id, t.ticker]))
  const fromAcc = all.find((a) => a.id === tf.from)
  const amt = parseFloat(tf.amount) || 0

  return (
    <Modal title={<span className="flex items-center gap-2"><Wallet size={15} /> Wallets <span className="text-[11px] font-normal text-dim">{all.length}/{MAX_WALLETS}</span></span>} onClose={onClose} wide>
      <div className="space-y-4 text-[12px]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md bg-bg/60 px-3 py-2">
          <div><div className="text-[10px] text-dim">All wallets</div><div className="num text-[16px] font-bold">{fmtUsd(total)}</div></div>
          <div><div className="text-[10px] text-dim">USD bank (shared)</div><div className="num text-[16px] font-bold">{fmtUsd(cash)}</div></div>
          <p className="ml-auto max-w-[320px] text-[10px] leading-snug text-dim">Each wallet holds its own SOL / BNB / ETH and bags. USD is a shared bank: swap it into any wallet. Auto-swap tops up whichever wallet is buying.</p>
          {online && (
            <button onClick={() => setSending(true)} className="flex items-center gap-1 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20">
              <Send size={12} /> Send to a friend
            </button>
          )}
        </div>
        {sending && <SendFundsModal onClose={() => setSending(false)} />}

        {/* Wallet list */}
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wider text-dim">
                <th className="px-2 py-1.5 text-left">Trade</th>
                <th className="px-2 py-1.5 text-left">Wallet</th>
                {CHAIN_IDS.map((c) => <th key={c} className="px-2 py-1.5 text-right" style={{ color: CHAINS[c].color }}>{CHAINS[c].native}</th>)}
                <th className="px-2 py-1.5 text-right">Bags</th>
                <th className="px-2 py-1.5 text-right">Value</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {all.map((a) => {
                const on = activeIds.includes(a.id)
                const bags = Object.values(a.positions)
                return (
                  <tr key={a.id} className="border-b border-line/50 last:border-0">
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={on} onChange={() => setActive(on ? activeIds.filter((x) => x !== a.id) : [...activeIds, a.id])} disabled={on && activeIds.length === 1} className="accent-[var(--accent)]" aria-label={`Trade from ${a.name}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      {editing === a.id ? (
                        <form
                          className="flex items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault()
                            update(a.id, { name: draftName })
                            setEditing(null)
                          }}
                        >
                          <select value={a.emoji} onChange={(e) => update(a.id, { emoji: e.target.value })} className="h-7 rounded border border-line2 bg-bg text-[13px]" aria-label="Wallet icon">
                            {WALLET_EMOJIS.map((em) => <option key={em}>{em}</option>)}
                          </select>
                          <input autoFocus value={draftName} maxLength={18} onChange={(e) => setDraftName(e.target.value)} className="h-7 w-28 rounded border border-line2 bg-bg px-1.5 outline-none focus:border-accent/60" aria-label="Wallet name" />
                          <button type="submit" className="rounded bg-accent px-1.5 py-1 text-black" aria-label="Save name"><Check size={12} /></button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-[16px]">{a.emoji}</span>
                          <div>
                            <div className="flex items-center gap-1 font-semibold">
                              {a.name}
                              {activeIds[0] === a.id && <span className="rounded bg-raise px-1 text-[8px] font-bold text-muted">PRIMARY</span>}
                              <button onClick={() => { setEditing(a.id); setDraftName(a.name) }} className="text-dim hover:text-ink" aria-label={`Rename ${a.name}`}><Pencil size={10} /></button>
                            </div>
                            {online ? (
                              <div className="flex items-center gap-1 text-[10px]">
                                <button
                                  onClick={() => {
                                    const addr = walletAddress(playerId(), a.id, 'sol')
                                    navigator.clipboard?.writeText(addr).catch(() => {})
                                    notify({ title: 'ADDRESS COPIED', body: `${a.name}: ${addr}${a.id === all[0]?.id ? '' : ' · give it only to people you want following this wallet'}`, tone: 'info', icon: '📋' }, 'click')
                                  }}
                                  className="num inline-flex items-center gap-0.5 text-dim hover:text-accent"
                                  title="Copy address"
                                >
                                  {walletAddress(playerId(), a.id, 'sol')} <Copy size={9} />
                                </button>
                                {a.id === all[0]?.id
                                  ? <span className="rounded bg-accent/10 px-1 text-[8px] font-bold text-accent" title="Your main wallet: everyone in the room sees its trades under your name and its bags on the leaderboard">PUBLIC</span>
                                  : <span className="rounded bg-raise px-1 text-[8px] font-bold text-muted" title="Side wallet: trades show only this address, so nobody knows it's you unless you share it">🕶 STEALTH</span>}
                              </div>
                            ) : (
                              <div className="num text-[10px] text-dim">{fakeAddress(a.id)}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                    {CHAIN_IDS.map((c) => <td key={c} className="num px-2 py-1.5 text-right">{a.balances[c] > 1e-9 ? fmtNative(a.balances[c], c, false) : <span className="text-dim">0</span>}</td>)}
                    <td className="px-2 py-1.5 text-right text-[11px] text-muted" title={bags.map((b) => tokenName.get(b.tokenId) ?? '?').join(', ')}>{bags.length || <span className="text-dim">—</span>}</td>
                    <td className="num px-2 py-1.5 text-right font-semibold">{fmtUsd(values.get(a.id) ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right">
                      {!on && activeIds[0] !== a.id && (
                        <button onClick={() => setActive([a.id, ...activeIds])} className="mr-1 rounded border border-line2 px-1.5 py-0.5 text-[10px] text-muted hover:text-ink" title="Make primary and trade from it">Primary</button>
                      )}
                      {on && activeIds[0] !== a.id && (
                        <button onClick={() => setActive([a.id, ...activeIds.filter((x) => x !== a.id)])} className="mr-1 rounded border border-line2 px-1.5 py-0.5 text-[10px] text-muted hover:text-ink">Primary</button>
                      )}
                      <button onClick={() => del(a.id)} disabled={all.length <= 1} className="rounded p-1 text-dim hover:text-down disabled:opacity-30" aria-label={`Delete ${a.name}`} title="Delete (must be empty)"><Trash2 size={12} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {/* Create */}
          <form
            className="space-y-2 rounded-md border border-line p-3"
            onSubmit={(e) => {
              e.preventDefault()
              const id = create(name, emoji)
              if (id) {
                setName('')
                setEmoji(WALLET_EMOJIS[(all.length + 1) % WALLET_EMOJIS.length])
                setFund((f) => ({ ...f, to: id }))
                setTf((t) => ({ ...t, to: id }))
              }
            }}
          >
            <div className="flex items-center gap-1.5 font-bold"><Plus size={13} /> New wallet</div>
            <div className="flex flex-wrap gap-1">
              {WALLET_EMOJIS.map((em) => (
                <button key={em} type="button" onClick={() => setEmoji(em)} aria-pressed={emoji === em} className={clsx('grid size-6 place-items-center rounded text-[13px]', emoji === em ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-raise')}>{em}</button>
              ))}
            </div>
            <input value={name} maxLength={18} onChange={(e) => setName(e.target.value)} placeholder={`Wallet ${all.length + 1}`} className="h-8 w-full rounded border border-line2 bg-bg px-2 outline-none focus:border-accent/60" aria-label="New wallet name" />
            <button type="submit" disabled={all.length >= MAX_WALLETS} className="h-8 w-full rounded-md bg-accent text-[12px] font-extrabold text-black hover:brightness-110 disabled:opacity-40">Create wallet</button>
          </form>

          {/* Fund from USD */}
          <div className="space-y-2 rounded-md border border-line p-3">
            <div className="font-bold">Fund from USD bank</div>
            <div className="grid grid-cols-2 gap-1.5">
              <WalletPick all={all} value={fund.to} onChange={(to) => setFund({ ...fund, to })} label="To wallet" />
              <ChainPick value={fund.chain} onChange={(chain) => setFund({ ...fund, chain })} />
            </div>
            <div className="flex items-center rounded border border-line2 bg-bg px-2 focus-within:border-accent/60">
              <span className="text-dim">$</span>
              <input inputMode="decimal" value={fund.usd} onChange={(e) => setFund({ ...fund, usd: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="100" className="num h-8 w-full bg-transparent px-1 outline-none" aria-label="USD to swap" />
              <button type="button" onClick={() => setFund({ ...fund, usd: String(Math.floor(cash)) })} className="text-[10px] font-bold text-accent">MAX</button>
            </div>
            <button
              disabled={!(parseFloat(fund.usd) > 0)}
              onClick={() => { if (swapAssets('usd', fund.chain, parseFloat(fund.usd), fund.to)) setFund({ ...fund, usd: '' }) }}
              className="h-8 w-full rounded-md border border-accent/50 bg-accent/10 text-[12px] font-bold text-accent hover:bg-accent/20 disabled:opacity-40"
            >
              Swap USD → {CHAINS[fund.chain].native}
            </button>
            <p className="text-[10px] text-dim">≈ {fmtNative((parseFloat(fund.usd) || 0) * 0.997 / nativePrice(market, fund.chain), fund.chain)} after the 0.3% swap fee</p>
          </div>

          {/* Transfer */}
          <div className="space-y-2 rounded-md border border-line p-3">
            <div className="font-bold">Move coins between wallets</div>
            <div className="flex items-center gap-1">
              <WalletPick all={all} value={tf.from} onChange={(from) => setTf({ ...tf, from })} label="From wallet" />
              <ArrowRight size={12} className="shrink-0 text-dim" />
              <WalletPick all={all} value={tf.to} onChange={(to) => setTf({ ...tf, to })} label="To wallet" />
            </div>
            <ChainPick value={tf.chain} onChange={(chain) => setTf({ ...tf, chain })} />
            <div className="flex items-center rounded border border-line2 bg-bg px-2 focus-within:border-accent/60">
              <input inputMode="decimal" value={tf.amount} onChange={(e) => setTf({ ...tf, amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="0" className="num h-8 w-full bg-transparent outline-none" aria-label="Amount to move" />
              <span className="text-[10px] text-dim">{CHAINS[tf.chain].native}</span>
              <button type="button" onClick={() => setTf({ ...tf, amount: String(fromAcc?.balances[tf.chain] ?? 0) })} className="ml-1 text-[10px] font-bold text-accent">MAX</button>
            </div>
            <button
              disabled={!(amt > 0) || tf.from === tf.to}
              onClick={() => { if (transfer(tf.from, tf.to, tf.chain, amt)) setTf({ ...tf, amount: '' }) }}
              className="h-8 w-full rounded-md border border-line2 text-[12px] font-bold text-ink hover:bg-raise disabled:opacity-40"
            >
              Move {amt > 0 ? fmtNative(amt, tf.chain) : ''}
            </button>
            <p className="text-[10px] text-dim">{fromAcc ? `${fromAcc.name} has ${fmtNative(fromAcc.balances[tf.chain], tf.chain)}` : ''}</p>
          </div>
        </div>
        <p className="text-[9px] text-dim">Wallets, addresses and balances are part of the simulation. Nothing here touches a real wallet.</p>
      </div>
    </Modal>
  )
}

function WalletPick({ all, value, onChange, label }: { all: Account[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-8 min-w-0 flex-1 rounded border border-line2 bg-bg px-1 text-[12px] outline-none focus:border-accent/60">
      {all.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
    </select>
  )
}

function ChainPick({ value, onChange }: { value: Chain; onChange: (c: Chain) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="Chain coin">
      {CHAIN_IDS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} aria-pressed={value === c} className={clsx('h-8 flex-1 rounded border text-[11px] font-bold', value === c ? 'bg-raise' : 'border-line2 text-muted hover:text-ink')} style={value === c ? { borderColor: CHAINS[c].color, color: CHAINS[c].color } : undefined}>
          {CHAINS[c].glyph} {CHAINS[c].native}
        </button>
      ))}
    </div>
  )
}
