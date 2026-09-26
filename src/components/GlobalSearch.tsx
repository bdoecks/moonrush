import clsx from 'clsx'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGame } from '../game/store'
import { fakeAddress } from '../utils/address'
import { fmtCompact } from '../utils/format'
import { ChainBadge } from './chain'
import { PadBadge } from './pad'
import { Kbd, Pct, TokenIcon } from './ui'

type Hit =
  | { kind: 'token'; id: string; score: number }
  | { kind: 'wallet'; id: string; score: number }
  | { kind: 'mine'; id: string; score: number }

const norm = (s: string) => s.trim().toLowerCase().replace(/^[$@]/, '').replace(/…/g, '')

/** How well `q` matches: exact > prefix > contains (0 = no match). Addresses match on any fragment. */
function score(q: string, fields: string[]) {
  let best = 0
  for (const f of fields) {
    const v = f.toLowerCase().replace(/…/g, '')
    if (v === q) best = Math.max(best, 3)
    else if (v.startsWith(q)) best = Math.max(best, 2)
    else if (v.includes(q)) best = Math.max(best, 1)
  }
  return best
}

/** GMGN-style search: token name / ticker / contract address, or a wallet (name or address). Press / to focus. */
export function GlobalSearch({ className, small }: { className?: string; small?: boolean }) {
  const tokens = useGame((s) => s.market.tokens)
  const wallets = useGame((s) => s.wallets)
  const mine = useGame((s) => s.portfolio.accounts)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const setView = useGame((s) => s.setView)
  const searchFocus = useGame((s) => s.searchFocus)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchFocus) input.current?.focus()
  }, [searchFocus])
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [])

  const needle = norm(q)
  const hits = useMemo<Hit[]>(() => {
    if (needle.length < 1) return []
    const out: Hit[] = []
    for (const t of tokens) {
      const sc = score(needle, [t.ticker, t.name, fakeAddress(t.id, t.chain), t.id])
      if (sc) out.push({ kind: 'token', id: t.id, score: sc + (t.status === 'bonding' || t.status === 'graduated' ? 0.5 : 0) })
    }
    for (const w of wallets) {
      const sc = score(needle, [w.name, fakeAddress(w.id)])
      if (sc) out.push({ kind: 'wallet', id: w.id, score: sc })
    }
    for (const a of mine ?? []) {
      const sc = score(needle, [a.name, fakeAddress(a.id)])
      if (sc) out.push({ kind: 'mine', id: a.id, score: sc })
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 10)
  }, [needle, tokens, wallets, mine])

  const go = (h: Hit) => {
    if (h.kind === 'token') select(h.id)
    else if (h.kind === 'wallet') openWallet(h.id)
    else setView('portfolio')
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
          setCursor(0)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            input.current?.blur()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setCursor((c) => Math.min(hits.length - 1, c + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(0, c - 1))
          } else if (e.key === 'Enter' && hits[cursor]) {
            e.preventDefault()
            go(hits[cursor])
          }
        }}
        placeholder="Search token / CA / wallet"
        aria-label="Search tokens, contract addresses and wallets"
        className={clsx('w-full rounded-md border border-line2 bg-bg pl-7 pr-8 outline-none placeholder:text-dim focus:border-accent/60', small ? 'h-6 text-[11px]' : 'h-8 text-[12px]')}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"><Kbd>/</Kbd></span>
      {open && needle && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(420px,calc(100vw-24px))] overflow-hidden whitespace-normal rounded-lg border border-line2 bg-panel shadow-[0_18px_48px_-12px_rgba(0,0,0,0.8)]">
          {hits.length === 0 ? (
            <div className="px-3 py-4 text-center text-[12px] text-dim">No token or wallet matches “{q}”</div>
          ) : (
            <ul role="listbox" aria-label="Search results">
              {hits.map((h, i) => (
                <li key={h.kind + h.id} role="option" aria-selected={i === cursor}>
                  <button onMouseEnter={() => setCursor(i)} onClick={() => go(h)} className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left', i === cursor ? 'bg-raise' : 'hover:bg-panel2')}>
                    <HitRow h={h} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-line px-3 py-1 text-[9px] text-dim">↑↓ to move · ↵ to open · paste a contract address or wallet address to jump straight to it</div>
        </div>
      )}
    </div>
  )
}

function HitRow({ h }: { h: Hit }) {
  const t = useGame((s) => (h.kind === 'token' ? s.market.tokens.find((x) => x.id === h.id) : undefined))
  const w = useGame((s) => (h.kind === 'wallet' ? s.wallets.find((x) => x.id === h.id) : undefined))
  const a = useGame((s) => (h.kind === 'mine' ? s.portfolio.accounts?.find((x) => x.id === h.id) : undefined))
  if (t) {
    return (
      <>
        <TokenIcon token={t} size={26} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[12px] font-bold">${t.ticker}<ChainBadge chain={t.chain} /><PadBadge pad={t.pad} size={12} /><span className="truncate text-[11px] font-normal text-dim">{t.name}</span></span>
          <span className="num block text-[10px] text-dim">{fakeAddress(t.id, t.chain)}{t.status !== 'bonding' && t.status !== 'graduated' ? ` · ${t.status.toUpperCase()}` : ''}</span>
        </span>
        <span className="text-right">
          <span className="num block text-[12px] font-semibold">{fmtCompact(t.mcap)}</span>
          <Pct v={t.change['1h']} className="text-[10px]" />
        </span>
      </>
    )
  }
  if (w) {
    const pnl = w.base.pnl7d + w.live.pnl7d
    return (
      <>
        <span className="grid size-[26px] place-items-center rounded-full bg-raise text-[14px]">{w.avatar}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold">{w.name} <span className="rounded bg-raise px-1 text-[9px] font-semibold capitalize text-muted">{w.style}</span></span>
          <span className="num block text-[10px] text-dim">{fakeAddress(w.id)} · trader wallet</span>
        </span>
        <span className={clsx('num text-[11px]', pnl >= 0 ? 'text-up' : 'text-down')}>{pnl >= 0 ? '+' : ''}{fmtCompact(pnl)} 7d</span>
      </>
    )
  }
  if (a) {
    return (
      <>
        <span className="grid size-[26px] place-items-center rounded-full bg-accent/15 text-[14px]">{a.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-bold">{a.name} <span className="rounded bg-accent/15 px-1 text-[9px] font-bold text-accent">YOUR WALLET</span></span>
          <span className="num block text-[10px] text-dim">{fakeAddress(a.id)}</span>
        </span>
      </>
    )
  }
  return null
}
