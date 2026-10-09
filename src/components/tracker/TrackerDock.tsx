import clsx from 'clsx'
import { ArrowLeftRight, AtSign, ChevronDown, ChevronRight, ExternalLink, GripHorizontal, PanelLeftClose, PanelRightClose, PictureInPicture2, Radio, Send, UserPlus, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { tokenMapOf, useTokenMap } from '../../hooks/useDerived'
import { OnScreen } from '../OnScreen'
import { useLiveFeed } from '../../game/liveSocial'
import { SIM_SEC_PER_TICK } from '../../game/marketEngine'
import { useGame } from '../../game/store'
import { useFriends } from '../../net/friends'
import type { FloatBox, SimWallet, SocialPost, TrackerDockPrefs, WalletStyle, WalletTrade } from '../../types'
import { fmtAge, fmtCompact, fmtUsd } from '../../utils/format'
import { QuickBuyButton } from '../chain'
import { EmptyState, Pct, TokenIcon } from '../ui'
import { Composer, Engagement, postAccount } from '../SocialTracker'
import { SparkChip, VerifiedMark } from '../SparkPanel'
import { openRow, useFriendRows, type TrackerRow } from './friendRows'
import { useOpenPlayer } from '../PlayerCard'
import { GroupMenu, NewGroupButton } from './groups'

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
 * Either tracker can be popped out into a floating panel (the button in its title bar) that drags by its top bar and
 * resizes from its corner, like Instant Trade; its dock button puts it back.
 */
export function TrackerDock() {
  const [p, set] = useDockPrefs()
  const [live, setLive] = useState<{ width: number; split: number } | null>(null) // while dragging
  const [front, setFront] = useState<'wallet' | 'social'>('wallet') // of two floating panels, the one touched last is on top
  const width = live?.width ?? p.width
  const split = live?.split ?? p.split
  const left = p.side === 'left'
  // A tracker that has been popped out floats over the page; the dock holds only the ones still in it.
  const fw = p.float?.wallet
  const fs = p.float?.social
  const setFloat = (which: 'wallet' | 'social', box: FloatBox | undefined) => set({ float: { ...p.float, [which]: box }, ...(box ? {} : { open: true, [which]: true }) })
  const popOut = (which: 'wallet' | 'social') => setFloat(which, clampBox({ x: left ? width + 24 : window.innerWidth - width - 384, y: which === 'wallet' ? 110 : 190, w: 360, h: 440 }))
  const floats = (
    <>
      {fw && <FloatPanel title="Wallet Tracker" icon={<Wallet size={12} />} box={fw} onBox={(b) => setFloat('wallet', b)} onDock={() => setFloat('wallet', undefined)} front={front === 'wallet'} onFront={() => setFront('wallet')}><WalletSection /></FloatPanel>}
      {fs && <FloatPanel title="Social Tracker" icon={<AtSign size={12} />} box={fs} onBox={(b) => setFloat('social', b)} onDock={() => setFloat('social', undefined)} front={front === 'social'} onFront={() => setFront('social')}><SocialSection /></FloatPanel>}
    </>
  )
  if (fw && fs) return floats // both are floating: the dock has nothing left to hold

  if (!p.open) {
    return (
      <>
      {floats}
      <div className={clsx('hidden w-9 shrink-0 flex-col items-center gap-1 bg-panel py-2 lg:flex', left ? 'order-first border-r border-line' : 'order-last border-l border-line')}>
        <RailButton title="Open wallet tracker" onClick={() => set({ open: true, wallet: true })}><Wallet size={15} /></RailButton>
        <RailButton title="Open social tracker" onClick={() => set({ open: true, social: true })}><AtSign size={15} /></RailButton>
      </div>
      </>
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

  const both = p.wallet && p.social && !fw && !fs
  return (
    <>
    {floats}
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
        {!fw && <Section title="Wallet Tracker" icon={<Wallet size={12} />} open={p.wallet} onToggle={() => set({ wallet: !p.wallet })} onFloat={() => popOut('wallet')} style={both ? { height: `${split * 100}%` } : p.wallet ? { flex: 1 } : undefined}>
          <WalletSection />
        </Section>}
        {both && <div onPointerDown={dragSplit} onDoubleClick={() => set({ split: 0.5 })} title="Drag to resize · double-click to reset" className="h-1 shrink-0 cursor-row-resize bg-line hover:bg-accent/50" />}
        {!fs && <Section title="Social Tracker" icon={<AtSign size={12} />} open={p.social} onToggle={() => set({ social: !p.social })} onFloat={() => popOut('social')} style={both ? { height: `${(1 - split) * 100}%` } : p.social ? { flex: 1 } : undefined}>
          <SocialSection />
        </Section>}
      </div>
    </aside>
    </>
  )
}

// ─── Floating panels ─────────────────────────────────────────────────────────
const FLOAT_MIN = { w: 280, h: 220 }
/** Keep a floating panel a sane size and on the screen (whatever the window has become since it was placed). */
const clampBox = (b: FloatBox): FloatBox => {
  const w = Math.min(Math.max(FLOAT_MIN.w, b.w), Math.max(FLOAT_MIN.w, window.innerWidth - 16))
  const h = Math.min(Math.max(FLOAT_MIN.h, b.h), Math.max(FLOAT_MIN.h, window.innerHeight - 72))
  return { w, h, x: Math.min(Math.max(8, b.x), Math.max(8, window.innerWidth - w - 8)), y: Math.min(Math.max(56, b.y), Math.max(56, window.innerHeight - h - 8)) }
}

/**
 * A tracker out of the dock: drag it by its top bar, resize it from the bottom-right corner, put it back with the dock
 * button. Where it sits is saved with your settings. Desktop only, like the dock.
 */
function FloatPanel({ title, icon, box, onBox, onDock, front, onFront, children }: { title: string; icon: ReactNode; box: FloatBox; onBox: (b: FloatBox) => void; onDock: () => void; front: boolean; onFront: () => void; children: ReactNode }) {
  const [live, setLive] = useState<FloatBox | null>(null) // while dragging or resizing
  const latest = useRef(box)
  const [, redraw] = useState(0)
  useEffect(() => {
    const on = () => redraw((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const b = clampBox(live ?? box)
  const track = (e: React.PointerEvent, next: (dx: number, dy: number) => FloatBox) => {
    if ((e.target as HTMLElement).closest('button, input, a')) return
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    latest.current = b
    const move = (ev: PointerEvent) => {
      latest.current = clampBox(next(ev.clientX - sx, ev.clientY - sy))
      setLive(latest.current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setLive(null)
      onBox(latest.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div role="region" aria-label={`${title} (floating)`} onPointerDownCapture={onFront} className={clsx('fixed hidden flex-col', front ? 'z-[31]' : 'z-30', 'flex-col overflow-hidden rounded-lg border border-line2 bg-panel/95 shadow-2xl backdrop-blur lg:flex', live && 'select-none')} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
      <div onPointerDown={(e) => track(e, (dx, dy) => ({ ...b, x: b.x + dx, y: b.y + dy }))} className="flex h-8 shrink-0 cursor-grab touch-none items-center gap-1.5 border-b border-line px-2 active:cursor-grabbing">
        <GripHorizontal size={14} className="text-dim" />
        <span className="text-dim">{icon}</span>
        <span className="text-[12px] font-bold text-ink">{title}</span>
        <button onClick={onDock} className="ml-auto rounded p-1 text-dim hover:bg-panel2 hover:text-ink" title="Put it back in the side dock" aria-label={`Dock the ${title}`}><X size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <div onPointerDown={(e) => track(e, (dx, dy) => ({ ...b, w: b.w + dx, h: b.h + dy }))} title="Drag to resize" aria-label={`Resize the ${title}`} className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize touch-none" style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.25) 50%)' }} />
    </div>
  )
}

function RailButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} title={title} aria-label={title} className="grid size-7 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-ink">{children}</button>
}

function Section({ title, icon, open, onToggle, onFloat, style, children }: { title: string; icon: ReactNode; open: boolean; onToggle: () => void; onFloat?: () => void; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <section className={clsx('flex min-h-0 flex-col', !open && 'shrink-0')} style={open ? style : undefined}>
      <div className="flex h-7 shrink-0 items-center border-b border-line/60 hover:bg-panel2/60">
        <button onClick={onToggle} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-[12px] font-bold text-ink" aria-expanded={open}>
          {open ? <ChevronDown size={12} className="text-dim" /> : <ChevronRight size={12} className="text-dim" />}
          <span className="text-dim">{icon}</span>
          {title}
        </button>
        {onFloat && <button onClick={onFloat} className="mr-1 rounded p-1 text-dim hover:bg-panel2 hover:text-ink" title="Pop out: a floating panel you can drag anywhere" aria-label={`Pop out the ${title}`}><PictureInPicture2 size={13} /></button>}
      </div>
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

type WalletScope = 'tracked' | 'smart' | 'kol' | 'all' | `g:${string}` // g:<name> = one of your groups
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
  const groups = useGame((s) => s.tracker.groups)
  const labels = useGame((s) => s.walletLabels)
  const watch = useFriends((s) => s.watch)
  const nTracked = tracked.length + friends.count
  const [scope, setScope] = useState<WalletScope>(nTracked ? 'tracked' : 'smart')
  const group = scope.startsWith('g:') ? scope.slice(2) : null
  const inGroup = (id: string) => labels[id]?.group === group
  const rows = useMemo(() => {
    const out: TrackerRow[] = scope === 'tracked' ? [...friends.rows] : group ? friends.rows.filter((r) => inGroup(r.w.id)) : []
    const styles = SCOPE_STYLES[scope as 'smart' | 'kol']
    for (const w of wallets) {
      if (scope === 'tracked' ? !tracked.includes(w.id) : group ? !tracked.includes(w.id) || !inGroup(w.id) : styles && !styles.includes(w.style)) continue
      for (const tr of w.trades.slice(0, 20)) out.push({ w, tr })
    }
    return out.sort((a, b) => b.tr.tick - a.tr.tick || b.tr.id - a.tr.id).slice(0, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets, tracked, scope, friends.rows, labels])
  const groupCount = (g: string) => tracked.filter((id) => labels[id]?.group === g).length + watch.filter((w) => labels[w.key]?.group === g).length
  return (
    <>
      <div className="no-scrollbar flex shrink-0 items-center gap-3 overflow-x-auto border-b border-line/40 px-2 py-1 text-[11px]">
        {([['tracked', <>Tracked <span className="text-dim">{nTracked}</span></>], ...groups.map((g) => [`g:${g}`, <>📁 {g} <span className="text-dim">{groupCount(g)}</span></>]), ['smart', '🧠 Smart'], ['kol', '📣 KOL'], ['all', 'All']] as [WalletScope, ReactNode][]).map(([v, label]) => (
          <button key={v} onClick={() => setScope(v)} className={clsx('flex shrink-0 items-center gap-1 font-semibold', scope === v ? 'text-ink' : 'text-dim hover:text-muted')}>{label}</button>
        ))}
        <NewGroupButton onAdded={(g) => setScope(`g:${g}`)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!rows.length ? (
          scope === 'tracked'
            ? <EmptyState icon={<UserPlus />} title="No tracked wallets yet" hint={<button onClick={() => setView('track')} className="text-accent underline">Track wallets →</button>} />
            : group ? <EmptyState icon="📁" title={`Nothing in ${group} yet`} hint="Click the 📁 on any tracked wallet's trade to put it in this group" />
            : <EmptyState icon="👛" title="No trades yet" />
        ) : rows.map(({ w, tr, friend }) => <OnScreen key={`${w.id}-${tr.id}`} className="slide-in"><WalletRow w={w} tr={tr} friend={friend} groupable={friend || tracked.includes(w.id)} /></OnScreen>)}
      </div>
    </>
  )
}

function WalletRow({ w, tr, friend, groupable }: { w: SimWallet; tr: WalletTrade; friend?: boolean; groupable?: boolean }) {
  const setView = useGame((s) => s.setView)
  const tick = useGame((s) => s.market.tick)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const openPlayer = useOpenPlayer()
  const map = useTokenMap()
  const t = map.get(tr.tokenId)
  const a = ACTION[tr.action ?? (tr.side === 'buy' ? 'first' : 'partial')]
  return (
    <div className="border-b border-line/40 px-2 py-1.5 hover:bg-panel2/70">
      <div className="flex items-center gap-1.5 text-[11px]">
        <button onClick={() => openRow({ w, friend }, { leaderboard: () => setView('leaderboard'), wallet: openWallet, player: openPlayer })} className="flex min-w-0 items-center gap-1 font-semibold hover:text-accent" title={friend ? 'A player in your room: open the leaderboard' : 'Open wallet profile'}>
          <span>{w.avatar}</span><span className="truncate">{w.name}</span>
          {friend && <span className="rounded bg-[#b36bff]/15 px-1 text-[9px] font-bold text-[#b36bff]">FRIEND</span>}
        </button>
        <span className={clsx('shrink-0 font-bold', a.cls)}>{a.label}</span>
        <span className={clsx('num shrink-0', tr.side === 'buy' ? 'text-up' : 'text-down')}>{fmtUsd(tr.usd, 0)}</span>
        <span className="num ml-auto shrink-0 text-[10px] text-dim">{fmtAge((tick - tr.tick) * SIM_SEC_PER_TICK)}</span>
        {groupable && <GroupMenu id={w.id} />}
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
const BIG_ACCOUNT = 500_000 // followers: the "Big accounts only" filter

function SocialSection() {
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => s.followedAccounts)
  const [scope, setScope] = useState<SocialScope>('x')
  const [onlyCA, setOnlyCA] = useState(false)
  const [onlyBig, setOnlyBig] = useState(false)
  // (The huge accounts are the story market's: without its posts there is nothing that big to filter for.)
  const stories = feed.some((p) => !!p.sparkId)
  const liveFeed = useLiveFeed()
  const posts = scope === 'live' ? [] : feed.filter((p) => {
    const acc = postAccount(p)
    if (!acc) return false
    if (scope === 'following' ? !followed.includes(acc.id) && !acc.player : acc.platform !== scope) return false
    if (stories && onlyBig && acc.followers < BIG_ACCOUNT && !acc.player) return false
    // (A post that coins were launched on is a post with coins.)
    return !onlyCA || !!p.tokenId || !!p.sparkId
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
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 border-b border-line/40 px-2 py-1 text-[10px] text-dim">
          <label className="flex cursor-pointer items-center gap-1"><input type="checkbox" checked={onlyCA} onChange={(e) => setOnlyCA(e.target.checked)} className="accent-[var(--accent)]" /> Only posts with a coin</label>
          {stories && <label className="flex cursor-pointer items-center gap-1" title="Only accounts with 500K followers or more: a big account's post moves far more than a small one's"><input type="checkbox" checked={onlyBig} onChange={(e) => setOnlyBig(e.target.checked)} className="accent-[var(--accent)]" /> Big accounts only</label>}
        </div>
      )}
      {scope !== 'live' && scope !== 'tg' && <Composer />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {scope === 'live' ? <LiveXFeed /> : !posts.length ? (
          <EmptyState icon="📣" title={scope === 'following' ? 'No posts from accounts you follow' : 'No posts yet'} hint={scope === 'following' ? 'Hit Follow on any post' : 'Posts appear as the market moves'} />
        ) : posts.slice(0, 60).map((p) => <OnScreen key={p.id} className="slide-in"><PostRow p={p} /></OnScreen>)}
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
  const t = useGame((s) => (p.tokenId ? tokenMapOf(s.market.tokens).get(p.tokenId) : undefined))
  const since = t && p.mcapAtPost ? t.mcap / p.mcapAtPost - 1 : 0
  return (
    <div className={clsx('border-b border-line/40 px-2 py-2 hover:bg-panel2/70', acc.player && 'bg-info/[0.04]')}>
      <div className="flex items-center gap-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[13px]">{acc.avatar}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 truncate text-[11px] font-bold">
            {acc.name}
            {acc.verified && <VerifiedMark />}
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
      {p.sparkId && <div className="mt-1.5"><SparkChip id={p.sparkId} wide /></div>}
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
