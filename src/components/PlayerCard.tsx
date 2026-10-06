// A World player's public card: opened by clicking their name (the boards, the World panel, a coin's trades, a
// tracker). The server builds it from the wallet it holds, so it is there for players who are off line too.
import clsx from 'clsx'
import { Bell, BellOff, Send, Wallet, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChainBadge } from './chain'
import { SendFundsModal } from './SendFunds'
import { EmptyState, TokenIcon } from './ui'
import { useTokenMap } from '../hooks/useDerived'
import { secPerTickOf } from '../game/marketEngine'
import { useGame } from '../game/store'
import { playerKey, useFriends } from '../net/friends'
import { usePlayerCard } from '../net/playerCard'
import { fmtAge, fmtCompact, fmtPct, fmtUsd, toneClass } from '../utils/format'

/**
 * What clicking a player's name does, wherever the name is: yourself → your Portfolio; a World bot → its wallet page
 * (that is where copy trading is); anybody else → their card. Outside the World there is no card to ask for, so the
 * hook answers null and the name stays plain text.
 */
export function useOpenPlayer(): ((id: string) => void) | null {
  const inWorld = useGame((s) => !!s.online?.round.world)
  const you = useGame((s) => s.online?.you)
  const openCard = useGame((s) => s.openCard)
  const openWallet = useGame((s) => s.openWallet)
  const setView = useGame((s) => s.setView)
  const setModal = useGame((s) => s.setModal)
  const open = useCallback(
    (id: string) => {
      if (id === you) {
        setModal(null)
        setView('portfolio')
      } else if (id.startsWith('bot-')) {
        setModal(null)
        openCard(null)
        openWallet(id)
      } else openCard(id)
    },
    [you, openCard, openWallet, setView, setModal],
  )
  return inWorld ? open : null
}

const signed = (n: number) => `${n >= 0 ? '+' : '-'}${fmtCompact(Math.abs(n))}`

export function PlayerCardDrawer() {
  const id = usePlayerCard((s) => s.id)
  const card = usePlayerCard((s) => s.card)
  const openCard = useGame((s) => s.openCard)
  const inWorld = useGame((s) => !!s.online?.round.world)
  const waiting = card === undefined

  // Ask again while it is open: quickly until the first answer (the server drops a request that comes too soon after
  // another), then every few seconds so the numbers stay current.
  useEffect(() => {
    if (!id) return
    const timer = setInterval(() => openCard(id), waiting ? 900 : 5000)
    return () => clearInterval(timer)
  }, [id, waiting, openCard])
  // Leaving the World closes it: there is nobody to ask any more.
  useEffect(() => {
    if (id && !inWorld) openCard(null)
  }, [id, inWorld, openCard])
  useEffect(() => {
    if (!id) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      openCard(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, openCard])

  if (!id) return null
  const close = () => openCard(null)
  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/50 fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <aside role="dialog" aria-label={card ? `${card.name}: player card` : 'Player card'} className="sheet-up flex h-full w-full max-w-[480px] flex-col border-l border-line2 bg-panel shadow-2xl md:animate-none">
        {card ? <Card key={card.id} id={id} onClose={close} /> : (
          <>
            <div className="flex items-center justify-end border-b border-line p-3">
              <button onClick={close} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="p-8 text-center text-[12px] text-dim">{waiting ? 'Loading…' : 'This player has no wallet in the World (any more).'}</div>
          </>
        )}
      </aside>
    </div>
  )
}

function Card({ id, onClose }: { id: string; onClose: () => void }) {
  const card = usePlayerCard((s) => s.card)!
  const you = useGame((s) => s.online?.you)
  const spectator = useGame((s) => !!s.online?.spectator)
  const tick = useGame((s) => s.market.tick)
  const now = useGame((s) => s.market.time)
  const secPerTick = useGame((s) => secPerTickOf(s.market))
  const select = useGame((s) => s.select)
  const setModal = useGame((s) => s.setModal)
  const openWallet = useGame((s) => s.openWallet)
  const notify = useGame((s) => s.notify)
  const tracked = useFriends((s) => s.watch.some((w) => w.key === playerKey(id)))
  const toggle = useFriends((s) => s.toggle)
  const [sending, setSending] = useState(false)
  const map = useTokenMap()

  const holdings = card.holdings.map((p) => {
    const t = map.get(p.tokenId)
    const value = t ? p.qty * t.price : 0
    return { p, t, value, pct: p.cost > 0 ? value / p.cost - 1 : 0 }
  })
  const holdValue = holdings.reduce((a, h) => a + h.value, 0)
  const goCoin = (tokenId: string) => {
    if (!map.get(tokenId)) return
    setModal(null)
    onClose()
    select(tokenId)
  }
  const track = () => {
    const on = toggle({ key: playerKey(id), label: card.name })
    notify({ title: on ? 'TRACKING' : 'UNTRACKED', body: on ? `${card.name}'s main wallet · you'll get an alert when it trades. Side wallets stay hidden.` : card.name, tone: 'info', icon: on ? '👁' : '🙈' }, 'click')
  }
  const pill = 'inline-flex items-center gap-1 rounded-md border border-line2 px-2 py-0.5 text-[11px] font-semibold text-muted hover:border-accent/40 hover:text-ink'

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line p-3">
        <div className="relative grid size-12 shrink-0 place-items-center rounded-full bg-raise text-[24px] ring-1 ring-line2">
          {card.avatar}
          <span className={clsx('absolute bottom-0 right-0 size-3 rounded-full ring-2 ring-panel', card.online ? 'bg-up' : 'bg-line2')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-[17px] font-bold">{card.name}</span>
            {card.verified && <span className="text-[11px] font-bold text-up" title="Signed in: this is their real account">✓</span>}
            {card.rank !== undefined && <span className="num shrink-0 rounded bg-raise px-1.5 py-px text-[10px] text-muted" title="Place on the net worth board">#{card.rank} of {card.ranked}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="num rounded bg-raise px-1.5 py-px text-[10px] text-muted">Lv {card.level}</span>
            <span className={clsx('text-[10px]', card.online ? 'text-up' : 'text-dim')}>{card.online ? 'Online now' : 'Offline'}</span>
            {card.bot
              ? <span className="rounded border border-line2 px-1 text-[9px] font-semibold leading-[14px] text-muted">Simulated trader</span>
              : <span className="rounded border border-accent/40 px-1 text-[9px] font-semibold leading-[14px] text-accent">🧑 Real player · main wallet</span>}
            {card.trophies?.map((t, i) => <span key={i} className="rounded bg-warn/10 px-1 text-[9px] font-bold text-warn" title="Season trophy">{t}</span>)}
          </div>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close"><X size={16} /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {id !== you && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
            {card.bot ? (
              <button onClick={() => { setModal(null); onClose(); openWallet(id) }} className={pill} title="Its wallet page: track it or copy its trades"><Wallet size={12} /> Wallet page</button>
            ) : (
              <>
                <button onClick={track} aria-pressed={tracked} className={clsx(pill, tracked && 'border-accent/50 bg-accent/10 text-accent')} title={tracked ? 'Stop tracking' : `Track ${card.name}'s main wallet: you get an alert when it trades`}>
                  {tracked ? <Bell size={12} /> : <BellOff size={12} />} {tracked ? 'Tracking' : 'Track'}
                </button>
                {card.online && !spectator && <button onClick={() => setSending(true)} className={pill} title={`Send SOL / BNB / ETH or USD to ${card.name}`}><Send size={12} /> Send</button>}
              </>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 p-3">
          <Box label="Net worth">{fmtUsd(card.equity, 0)}</Box>
          <Box label="All-time profit"><span className={toneClass(card.pnl)}>{signed(card.pnl)}</span></Box>
          <Box label="This season"><span className={toneClass(card.season)}>{signed(card.season)}</span></Box>
          <Box label="Today"><span className={toneClass(card.day)}>{signed(card.day)}</span></Box>
          <Box label="Win rate"><span className={card.sells ? (card.wins / card.sells >= 0.5 ? 'text-up' : 'text-down') : ''}>{card.sells ? `${((card.wins / card.sells) * 100).toFixed(0)}%` : '—'}</span><span className="text-[10px] font-normal text-dim"> {card.sells ? `of ${card.sells} sells` : ''}</span></Box>
          <Box label="Main wallet bags">{holdings.length ? fmtCompact(holdValue) : '—'}</Box>
        </div>
        {card.dev && card.dev.cooked > 0 && (
          <p className="px-3 pb-3 text-[11px] text-muted">
            🍳 Launched <span className="num font-semibold text-ink">{card.dev.cooked}</span> coin{card.dev.cooked === 1 ? '' : 's'}, <span className="num font-semibold text-ink">{card.dev.migrated}</span> migrated, <span className="num font-semibold text-up">{fmtUsd(card.dev.fees, 0)}</span> in creator fees
            {card.dev.bestTicker ? <> · best: ${card.dev.bestTicker} at {fmtCompact(card.dev.bestAth)}</> : null}
          </p>
        )}

        <Section title={`Coins they're in (${holdings.length})`}>
          {holdings.length === 0 ? <EmptyState icon="💤" title="Main wallet holds nothing right now" /> : holdings.map((h) => (
            <button key={h.p.tokenId} disabled={!h.t} onClick={() => goCoin(h.p.tokenId)} title={h.t ? `Open ${h.t.ticker}` : 'This coin has left the market'} className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-1.5 text-left hover:bg-panel2 disabled:opacity-50">
              {h.t && <TokenIcon token={h.t} size={24} />}
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-[12px] font-bold">{h.t?.ticker ?? '?'}{h.t && <ChainBadge chain={h.t.chain} />}{h.t?.status === 'rugged' && <span className="text-[9px] font-bold text-down">RUGGED</span>}</span>
                <span className="num block text-[10px] text-dim">{h.t ? `${fmtCompact(h.t.mcap)} MC · ` : ''}held {fmtAge(Math.max(0, tick - h.p.openedAt) * secPerTick)}</span>
              </span>
              <span className="ml-auto text-right">
                <span className="num block text-[12px] font-semibold">{fmtUsd(h.value, h.value < 10 ? 2 : 0)}</span>
                <span className="num block text-[10px] text-dim">cost {fmtCompact(h.p.cost)}</span>
              </span>
              <span className={clsx('num w-16 text-right text-[11px] font-semibold', toneClass(h.pct))}>{fmtPct(h.pct)}</span>
            </button>
          ))}
        </Section>

        <Section title={`Recent trades${card.recent.length ? ` · ${card.recent.length}` : ''}`}>
          {card.recent.length === 0 ? <EmptyState icon="📭" title="No main-wallet trades on record" /> : card.recent.map((tr) => (
            <button key={tr.id} disabled={!map.get(tr.tokenId)} onClick={() => goCoin(tr.tokenId)} className="flex w-full items-center gap-2 border-b border-line/50 px-3 py-1.5 text-left text-[11px] hover:bg-panel2 disabled:cursor-default">
              <span className="num w-9 text-dim">{fmtAge(Math.max(0, now - tr.time))}</span>
              <span className={clsx('w-8 font-semibold', tr.side === 'buy' ? 'text-up' : 'text-down')}>{tr.side === 'buy' ? 'Buy' : 'Sell'}</span>
              <TokenIcon token={{ emoji: tr.emoji, hue: tr.hue, status: 'graduated' }} size={18} />
              <span className="font-semibold">{tr.ticker}</span>
              <span className="ml-auto num">{fmtUsd(tr.usd, tr.usd < 10 ? 2 : 0)}</span>
              <span className={clsx('num w-16 text-right', tr.pnl !== undefined ? toneClass(tr.pnl) : 'text-dim')}>{tr.pnl !== undefined ? signed(tr.pnl) : '—'}</span>
            </button>
          ))}
        </Section>
        <p className="px-3 py-2 text-[10px] text-dim">
          {card.bot
            ? 'A computer player in the World: its own wallet, the same rules and fees as yours. It is not on the leaderboards.'
            : `Like on-chain: you see ${card.name}'s main wallet. Side wallets trade under a bare address, so they are not shown here.`}
        </p>
      </div>
      {sending && <SendFundsModal toPid={id} onClose={() => setSending(false)} />}
    </>
  )
}

function Box({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-bg px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[13px] font-bold">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-line">
      <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">{title}</div>
      {children}
    </div>
  )
}
