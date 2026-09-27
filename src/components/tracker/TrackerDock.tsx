import clsx from 'clsx'
import { ArrowLeftRight, AtSign, ChevronDown, ChevronRight, ExternalLink, PanelLeftClose, PanelRightClose, Radio, Send, UserPlus, Wallet } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTokenMap } from '../../hooks/useDerived'
import { useLiveFeed } from '../../game/liveSocial'
import { SIM_SEC_PER_TICK } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import type { SimWallet, SocialPost, TrackerDockPrefs, WalletStyle, WalletTrade } from '../../types'
import { fmtAge, fmtCompact, fmtUsd } from '../../utils/format'
import { QuickBuyButton } from '../chain'
import { EmptyState, Pct, TokenIcon } from '../ui'
import { Composer, Engagement, postAccount } from '../SocialTracker'
import { useFriendRows, type TrackerRow } from './friendRows'

export const DOCK_DEFAULTS: TrackerDockPrefs = { open: true, side: 'left', width: 320, split: 0.5, wallet: true, social: true }
const MIN_W = 260
const MAX_W = 560

export function useDockPrefs(): [TrackerDockPrefs, (patch: Partial<TrackerDockPrefs>) => void] {
  const prefs = useGame((s) => s.settings.trackerDock)
  const update = useGame((s) => s.updateSettings)
  const p = { ...DOCK_DEFAULTS, ...prefs }
  return [p, (patch) => update({ trackerDock: { ...p, ...patch } })]
}

/**
 * GMGN-style side dock: Wallet Tracker on top, Social Tracker below. Docks to the left or right edge, drag its inner
 * edge to resize, drag the divider to share the height, or collapse it to a thin rail. Desktop only.
 */
export function TrackerDock() {
  const [p, set] = useDockPrefs()
  const [live, setLive] = useState<{ width: number; split: number } | null>(null) // while dragging
  const width = live?.width ?? p.width
  const split = live?.split ?? p.split
  const left = p.side === 'left'

  if (!p.open) {
    return (
      <div className={clsx('hidden w-9 shrink-0 flex-col items-center gap-1 bg-panel py-2 lg:flex', left ? 'order-first border-r border-line' : 'order-last border-l border-line')}>
        <RailButton title="Open wallet tracker" onClick={() => set({ open: true, wallet: true })}><Wallet size={15} /></RailButton>
        <RailButton title="Open social tracker" onClick={() => set({ open: true, social: true })}><AtSign size={15} /></RailButton>
      </div>
    )
  }

  const dragWidth = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    let last = startW
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(MAX_W, Math.max(MIN_W, startW + (left ? ev.clientX - startX : startX - ev.clientX))))
      setLive({ width: last, split })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLive(null)
      set({ width: last })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const dragSplit = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const box = e.currentTarget.parentElement!.getBoundingClientRect()
    let last = split
    const move = (ev: PointerEvent) => {
      last = Math.min(0.85, Math.max(0.15, (ev.clientY - box.top) / box.height))
      setLive({ width, split: last })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLive(null)
      set({ split: last })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const both = p.wallet && p.social
  return (
    <aside
      className={clsx('relative hidden shrink-0 flex-col bg-panel lg:flex', left ? 'order-first border-r border-line' : 'order-last border-l border-line', live && 'select-none')}
      style={{ width }}
      aria-label="Trackers"
    >
      {/* Resize from the inner edge */}
      <div onPointerDown={dragWidth} onDoubleClick={() => set({ width: DOCK_DEFAULTS.width })} title="Drag to resize · double-click to reset" className={clsx('absolute inset-y-0 z-20 w-1.5 cursor-col-resize hover:bg-accent/40', left ? '-right-1' : '-left-1', live && 'bg-accent/40')} />

      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Trackers</span>
        <button onClick={() => set({ side: left ? 'right' : 'left' })} className="ml-auto rounded p-1 text-dim hover:bg-panel2 hover:text-ink" title={`Dock on the ${left ? 'right' : 'left'}`}><ArrowLeftRight size={13} /></button>
        <button onClick={() => set({ open: false })} className="rounded p-1 text-dim hover:bg-panel2 hover:text-ink" title="Collapse">{left ? <PanelLeftClose size={14} /> : <PanelRightClose size={14} />}</button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <Section title="Wallet Tracker" icon={<Wallet size={12} />} open={p.wallet} onToggle={() => set({ wallet: !p.wallet })} style={both ? { height: `${split * 100}%` } : p.wallet ? { flex: 1 } : undefined}>
          <WalletSection />
        </Section>
        {both && <div onPointerDown={dragSplit} onDoubleClick={() => set({ split: 0.5 })} title="Drag to resize · double-click to reset" className="h-1 shrink-0 cursor-row-resize bg-line hover:bg-accent/50" />}
        <Section title="Social Tracker" icon={<AtSign size={12} />} open={p.social} onToggle={() => set({ social: !p.social })} style={both ? { height: `${(1 - split) * 100}%` } : p.social ? { flex: 1 } : undefined}>
          <SocialSection />
        </Section>
      </div>
    </aside>
  )
}

function RailButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} title={title} aria-label={title} className="grid size-7 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-ink">{children}</button>
}

function Section({ title, icon, open, onToggle, style, children }: { title: string; icon: ReactNode; open: boolean; onToggle: () => void; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <section className={clsx('flex min-h-0 flex-col', !open && 'shrink-0')} style={open ? style : undefined}>
      <button onClick={onToggle} className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line/60 px-2 text-[12px] font-bold text-ink hover:bg-panel2/60" aria-expanded={open}>
        {open ? <ChevronDown size={12} className="text-dim" /> : <ChevronRight size={12} className="text-dim" />}
        <span className="text-dim">{icon}</span>
        {title}
      </button>
      {open && <div className="flex min-h-0 flex-1 flex-col">{children}</div>}
    </section>
  )
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="no-scrollbar flex shrink-0 items-center gap-3 overflow-x-auto border-b border-line/40 px-2 py-1 text-[11px]">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={clsx('flex shrink-0 items-center gap-1 font-semibold', value === o.value ? 'text-ink' : 'text-dim hover:text-muted')}>{o.label}</button>
      ))}
    </div>
  )
}

// ─── Wallet tracker ──────────────────────────────────────────────────────────

type WalletScope = 'tracked' | 'smart' | 'kol' | 'all'
const SCOPE_STYLES: Partial<Record<WalletScope, WalletStyle[]>> = { smart: ['smart', 'whale'], kol: ['kol'] }
const ACTION: Record<string, { label: string; cls: string }> = {
  first: { label: 'Buy', cls: 'text-up' },
  more: { label: 'Buy more', cls: 'text-up' },
  partial: { label: 'Sell part', cls: 'text-warn' },
  all: { label: 'Sell all', cls: 'text-down' },
}

function WalletSection() {
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const setView = useGame((s) => s.setView)
  const friends = useFriendRows() // friends you track in a room
  const nTracked = tracked.length + friends.count
  const [scope, setScope] = useState<WalletScope>(nTracked ? 'tracked' : 'smart')
  const rows = useMemo(() => {
    const out: TrackerRow[] = scope === 'tracked' ? [...friends.rows] : []
    const styles = SCOPE_STYLES[scope]
    for (const w of wallets) {
      if (scope === 'tracked' ? !tracked.includes(w.id) : styles && !styles.includes(w.style)) continue
      for (const tr of w.trades.slice(0, 20)) out.push({ w, tr })
    }
    return out.sort((a, b) => b.tr.tick - a.tr.tick || b.tr.id - a.tr.id).slice(0, 60)
  }, [wallets, tracked, scope, friends.rows])
  return (
    <>
      <Tabs value={scope} onChange={setScope} options={[
        { value: 'tracked', label: <>Tracked <span className="text-dim">{nTracked}</span></> },
        { value: 'smart', label: '🧠 Smart' },
        { value: 'kol', label: '📣 KOL' },
        { value: 'all', label: 'All' },
      ]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!rows.length ? (
          scope === 'tracked'
            ? <EmptyState icon={<UserPlus />} title="No tracked wallets yet" hint={<button onClick={() => setView('track')} className="text-accent underline">Track wallets →</button>} />
            : <EmptyState icon="👛" title="No trades yet" />
        ) : rows.map(({ w, tr, friend }) => <WalletRow key={`${w.id}-${tr.id}`} w={w} tr={tr} friend={friend} />)}
      </div>
    </>
  )
}

function WalletRow({ w, tr, friend }: { w: SimWallet; tr: WalletTrade; friend?: boolean }) {
  const setView = useGame((s) => s.setView)
  const tick = useGame((s) => s.market.tick)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const map = useTokenMap()
  const t = map.get(tr.tokenId)
  const a = ACTION[tr.action ?? (tr.side === 'buy' ? 'first' : 'partial')]
  return (
    <div className="slide-in border-b border-line/40 px-2 py-1.5 hover:bg-panel2/70">
      <div className="flex items-center gap-1.5 text-[11px]">
        <button onClick={() => (friend ? setView('leaderboard') : openWallet(w.id))} className="flex min-w-0 items-center gap-1 font-semibold hover:text-accent" title={friend ? 'A player in your room: open the leaderboard' : 'Open wallet profile'}>
          <span>{w.avatar}</span><span className="truncate">{w.name}</span>
          {friend && <span className="rounded bg-[#b36bff]/15 px-1 text-[9px] font-bold text-[#b36bff]">FRIEND</span>}
        </button>
        <span className={clsx('shrink-0 font-bold', a.cls)}>{a.label}</span>
        <span className={clsx('num shrink-0', tr.side === 'buy' ? 'text-up' : 'text-down')}>{fmtUsd(tr.usd, 0)}</span>
        <span className="num ml-auto shrink-0 text-[10px] text-dim">{fmtAge((tick - tr.tick) * SIM_SEC_PER_TICK)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <button disabled={!t} onClick={() => t && select(t.id)} className="flex min-w-0 items-center gap-1.5 hover:text-accent">
          <TokenIcon token={t ?? { emoji: tr.emoji, hue: tr.hue, status: 'dead' }} size={18} />
          <span className="truncate text-[12px] font-bold">{tr.ticker}</span>
        </button>
        <span className="num text-[10px] text-dim">{tr.mcap ? fmtCompact(tr.mcap) : '—'} → <span className="text-ink">{t ? fmtCompact(t.mcap) : 'delisted'}</span></span>
        {tr.pnl !== undefined && <Pct v={tr.pnlPct ?? 0} className="text-[10px]" />}
        {t && <span className="ml-auto"><QuickBuyButton t={t} className="h-5 px-1.5 text-[10px]" /></span>}
      </div>
    </div>
  )
}

// ─── Social tracker ──────────────────────────────────────────────────────────

type SocialScope = 'x' | 'tg' | 'following' | 'live'

function SocialSection() {
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => s.followedAccounts)
  const [scope, setScope] = useState<SocialScope>('x')
  const [onlyCA, setOnlyCA] = useState(false)
  const liveFeed = useLiveFeed()
  const posts = scope === 'live' ? [] : feed.filter((p) => {
    const acc = postAccount(p)
    if (!acc) return false
    if (scope === 'following' ? !followed.includes(acc.id) && !acc.player : acc.platform !== scope) return false
    return !onlyCA || !!p.tokenId
  })
  return (
    <>
      <Tabs value={scope} onChange={setScope} options={[
        { value: 'x', label: <><AtSign size={10} /> X</> },
        { value: 'tg', label: <><Send size={10} /> TG</> },
        { value: 'following', label: <>Following <span className="text-dim">{followed.length}</span></> },
        { value: 'live', label: <><Radio size={10} className={liveFeed.status === 'live' ? 'text-up' : undefined} /> Live X</> },
      ]} />
      {scope !== 'live' && (
        <label className="flex shrink-0 cursor-pointer items-center gap-1 border-b border-line/40 px-2 py-1 text-[10px] text-dim">
          <input type="checkbox" checked={onlyCA} onChange={(e) => setOnlyCA(e.target.checked)} className="accent-[var(--accent)]" /> Only posts with a coin
        </label>
      )}
      {scope !== 'live' && scope !== 'tg' && <Composer />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {scope === 'live' ? <LiveXFeed /> : !posts.length ? (
          <EmptyState icon="📣" title={scope === 'following' ? 'No posts from accounts you follow' : 'No posts yet'} hint={scope === 'following' ? 'Hit Follow on any post' : 'Posts appear as the market moves'} />
        ) : posts.slice(0, 60).map((p) => <PostRow key={p.id} p={p} />)}
      </div>
    </>
  )
}

function PostRow({ p }: { p: SocialPost }) {
  const acc = postAccount(p)!
  const you = useGame((s) => (s.online ? p.author?.pid === s.online.you : p.accountId === 'player'))
  const tick = useGame((s) => s.market.tick)
  const followed = useGame((s) => s.followedAccounts.includes(acc.id))
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  const select = useGame((s) => s.select)
  const t = useGame((s) => (p.tokenId ? s.market.tokens.find((x) => x.id === p.tokenId) : undefined))
  const since = t && p.mcapAtPost ? t.mcap / p.mcapAtPost - 1 : 0
  return (
    <div className={clsx('slide-in border-b border-line/40 px-2 py-2 hover:bg-panel2/70', acc.player && 'bg-info/[0.04]')}>
      <div className="flex items-center gap-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[13px]">{acc.avatar}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 truncate text-[11px] font-bold">
            {acc.name}
            {you && <span className="rounded bg-accent/15 px-1 text-[9px] text-accent">YOU</span>}
            {acc.player && !you && <span className="rounded bg-info/15 px-1 text-[9px] text-info">PLAYER</span>}
            {acc.player && acc.kol && <span className="rounded bg-warn/15 px-1 text-[9px] text-warn">KOL</span>}
          </div>
          <div className="num truncate text-[10px] text-dim">@{acc.handle} · {fmtCompact(acc.followers, '')} · {fmtAge((tick - p.tick) * SIM_SEC_PER_TICK)}</div>
        </div>
        {!acc.player && <button onClick={() => toggleFollow(acc.id)} className={clsx('shrink-0 rounded-full px-2 py-px text-[9px] font-bold', followed ? 'border border-line2 text-muted' : 'bg-ink text-bg')}>{followed ? 'Following' : 'Follow'}</button>}
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-line text-[11px] leading-snug text-ink/90">
        {p.text.split(/(\$[A-Z0-9]+)/g).map((part, i) => (/^\$[A-Z0-9]+$/.test(part) ? <span key={i} className="font-semibold text-info">{part}</span> : <span key={i}>{part}</span>))}
      </p>
      {p.tokenId && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-line bg-bg px-1.5 py-1">
          <button disabled={!t} onClick={() => t && select(t.id)} className="flex min-w-0 items-center gap-1 hover:text-accent">
            {t ? <TokenIcon token={t} size={16} /> : <span>❔</span>}
            <span className="truncate text-[11px] font-bold">{p.ticker}</span>
          </button>
          <span className="num text-[10px] text-muted">{t ? fmtCompact(t.mcap) : 'delisted'}</span>
          {t && p.mcapAtPost ? <Pct v={since} className="text-[10px]" /> : null}
          {t && <span className="ml-auto"><QuickBuyButton t={t} className="h-5 px-1.5 text-[10px]" /></span>}
        </div>
      )}
      <Engagement p={p} />
    </div>
  )
}

/** Real posts from X, once a feed server is connected (see game/liveSocial.ts). */
function LiveXFeed() {
  const { posts, status, error } = useLiveFeed()
  if (!posts.length) {
    return (
      <EmptyState
        icon={<Radio />}
        title={status === 'live' ? 'Connected · waiting for posts' : status === 'connecting' ? 'Connecting…' : 'Real X feed not connected yet'}
        hint={status === 'error' ? error : 'Real tweets will stream in here once the X feed server is set up. Simulated posts are in the X and TG tabs.'}
      />
    )
  }
  return (
    <>
      {posts.map((p) => (
        <div key={p.id} className="slide-in border-b border-line/40 px-2 py-2 hover:bg-panel2/70">
          <div className="flex items-center gap-1.5">
            {p.author.avatarUrl ? <img src={p.author.avatarUrl} alt="" className="size-6 shrink-0 rounded-full" /> : <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[11px]">𝕏</span>}
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[11px] font-bold">{p.author.name}{p.author.verified && <span className="ml-1 text-info">✓</span>}</div>
              <div className="num truncate text-[10px] text-dim">@{p.author.handle}{p.author.followers ? ` · ${fmtCompact(p.author.followers, '')}` : ''} · {fmtAge((Date.now() - p.createdAt) / 1000)}</div>
            </div>
            {p.url && <a href={p.url} target="_blank" rel="noreferrer noopener" className="shrink-0 text-dim hover:text-ink" title="Open on X"><ExternalLink size={12} /></a>}
          </div>
          <p className="mt-1 line-clamp-4 whitespace-pre-line text-[11px] leading-snug text-ink/90">{p.text}</p>
          {!!p.tickers?.length && <div className="mt-1 flex flex-wrap gap-1">{p.tickers.slice(0, 4).map((x) => <span key={x} className="rounded bg-info/10 px-1 text-[10px] font-semibold text-info">{x}</span>)}</div>}
        </div>
      ))}
    </>
  )
}
