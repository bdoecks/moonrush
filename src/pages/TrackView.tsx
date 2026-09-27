import clsx from 'clsx'
import { AtSign, Bell, BellOff, Plus, Search, Send, Settings2, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { EmptyState, Pct, TokenIcon } from '../components/ui'
import { QuickBuyButton, QuickSlotPicker } from '../components/chain'
import { TrackerFeed } from '../components/tracker/TrackerFeed'
import { CalloutTracker } from '../components/tracker/CalloutTracker'
import { TrackerSettingsModal } from '../components/tracker/TrackerSettingsModal'
import { STYLE_META } from '../data/wallets'
import { useTokenMap } from '../hooks/useDerived'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { ACCOUNTS } from '../game/socialEngine'
import { alertText, useGame } from '../game/store'
import { walletStats } from '../game/walletEngine'
import type { AlertType, SocialPost, Token } from '../types'
import { fakeAddress } from '../utils/address'
import { fmtAge, fmtCompact, toneClass } from '../utils/format'

type Sub = 'wallet' | 'track' | 'callout' | 'alerts' | 'social'
const accById = new Map(ACCOUNTS.map((a) => [a.id, a]))

export function TrackView() {
  const [sub, setSub] = useState<Sub>('track')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const tracked = useGame((s) => s.trackedWallets)
  const alerts = useGame((s) => s.alerts)
  const sound = useGame((s) => s.settings.sound)
  const updateSettings = useGame((s) => s.updateSettings)
  const activeAlerts = alerts.filter((a) => a.triggeredTick === undefined).length
  const subs: { id: Sub; label: string; mobileOnly?: boolean }[] = [
    { id: 'wallet', label: `Wallet${tracked.length ? ` ${tracked.length}` : ''}` },
    { id: 'track', label: 'Track' },
    { id: 'callout', label: 'Callout' },
    { id: 'alerts', label: `Alerts${activeAlerts ? ` ${activeAlerts}` : ''}` },
    { id: 'social', label: 'X / TG', mobileOnly: true },
  ]

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-panel px-3 py-2">
          {subs.map((t) => (
            <button key={t.id} onClick={() => setSub(t.id)} className={clsx('font-display text-[16px] font-bold transition-colors', t.mobileOnly && 'lg:hidden', sub === t.id ? 'text-ink' : 'text-dim hover:text-muted')}>
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => updateSettings({ sound: !sound })} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" title="Sound for alerts">{sound ? <Volume2 size={14} /> : <VolumeX size={14} />}</button>
            <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1 rounded-md border border-line2 px-2 py-1 text-[11px] font-semibold text-muted hover:text-ink" title="Wallet tracker settings"><Settings2 size={12} /> Tracker settings</button>
            <QuickSlotPicker />
          </div>
        </div>
        {settingsOpen && <TrackerSettingsModal onClose={() => setSettingsOpen(false)} />}
        <div className="min-h-0 flex-1 overflow-auto">
          {sub === 'wallet' && <WalletManager />}
          {sub === 'track' && <TrackerFeed onManage={() => setSub('wallet')} />}
          {sub === 'callout' && <CalloutTracker />}
          {sub === 'alerts' && <Alerts />}
          {sub === 'social' && <div className="h-full lg:hidden"><SocialPanel /></div>}
        </div>
      </div>
      <aside className="hidden w-[360px] shrink-0 border-l border-line bg-panel lg:flex">
        <SocialPanel />
      </aside>
    </div>
  )
}

function QuickBuy({ t }: { t?: Token }) {
  return <QuickBuyButton t={t} className="py-0.5" />
}

const th = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim whitespace-nowrap'
const td = 'px-3 py-1.5 whitespace-nowrap'

// ─── Wallet: manage tracked wallets ──────────────────────────────────────────
function WalletManager() {
  const wallets = useGame((s) => s.wallets)
  const tracked = useGame((s) => s.trackedWallets)
  const labels = useGame((s) => s.walletLabels)
  const copies = useGame((s) => s.copies)
  const tick = useGame((s) => s.market.tick)
  const toggleTrack = useGame((s) => s.toggleTrackWallet)
  const setLabel = useGame((s) => s.setWalletLabel)
  const openWallet = useGame((s) => s.openWallet)
  const groups = useGame((s) => s.tracker.groups)
  const map = useTokenMap()
  const [q, setQ] = useState('')
  const stats = useMemo(() => new Map(wallets.map((w) => [w.id, walletStats(w, '24H', map, tick)])), [wallets, map, tick])
  const mine = wallets.filter((w) => tracked.includes(w.id))
  const needle = q.trim().toLowerCase().replace('…', '')
  const matches = (w: (typeof wallets)[number]) =>
    !needle || w.name.toLowerCase().includes(needle) || STYLE_META[w.style].label.toLowerCase().includes(needle) || fakeAddress(w.id).toLowerCase().replace('…', '').includes(needle)
  const candidates = wallets
    .filter((w) => !tracked.includes(w.id) && matches(w))
    .sort((a, b) => stats.get(b.id)!.pnl - stats.get(a.id)!.pnl)
    .slice(0, needle ? 12 : 6)

  return (
    <div className="space-y-3 p-3">
      <div className="rounded-md border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[12px] font-bold">Tracked wallets ({mine.length})</span>
          <span className="text-[10px] text-dim">Label, group, and choose which trades alert you per wallet</span>
        </div>
        {mine.length === 0 ? <EmptyState icon="👁" title="Nothing tracked yet" hint="Add wallets below" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-[12px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={clsx(th, 'text-left')}>Label</th>
                  <th className={clsx(th, 'text-left')}>Wallet</th>
                  <th className={clsx(th, 'text-left')}>Group</th>
                  <th className={clsx(th, 'text-left')}>Alerts</th>
                  <th className={clsx(th, 'text-right')}>Balance</th>
                  <th className={clsx(th, 'text-right')}>24H PnL</th>
                  <th className={clsx(th, 'text-right')}>Last active</th>
                  <th className={clsx(th, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((w) => {
                  const st = stats.get(w.id)!
                  const lb = labels[w.id]
                  const notify = lb?.notify !== false
                  return (
                    <tr key={w.id} className="border-b border-line/40 hover:bg-panel2">
                      <td className={td}>
                        <input
                          defaultValue={lb?.label ?? ''}
                          placeholder={w.name}
                          maxLength={20}
                          onBlur={(e) => setLabel(w.id, { label: e.target.value.trim() || undefined })}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          className="h-7 w-36 rounded border border-line2 bg-bg px-2 text-[12px] font-semibold outline-none placeholder:font-normal placeholder:text-dim focus:border-accent/60"
                          aria-label={`Label for ${w.name}`}
                        />
                      </td>
                      <td className={td}>
                        <button onClick={() => openWallet(w.id)} className="flex items-center gap-1.5 hover:text-accent">
                          <span className="text-[16px]">{w.avatar}</span><span>{w.name}</span>
                          <span className={clsx('rounded border px-1 text-[9px] font-semibold', STYLE_META[w.style].cls)}>{STYLE_META[w.style].label}</span>
                          {copies.some((c) => c.walletId === w.id) && <span className="rounded bg-up/15 px-1 text-[9px] font-bold text-up">COPYING</span>}
                        </button>
                        <div className="num text-[10px] text-dim">{fakeAddress(w.id)}</div>
                      </td>
                      <td className={td}>
                        <select
                          id={`trk-group-${w.id}`}
                          value={lb?.group ?? ''}
                          onChange={(e) => setLabel(w.id, { group: e.target.value || undefined })}
                          className="h-7 rounded border border-line2 bg-bg px-1.5 text-[11px] outline-none focus:border-accent/60"
                          aria-label={`Group for ${w.name}`}
                        >
                          <option value="">No group</option>
                          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                      </td>
                      <td className={td}>
                        <div className="flex gap-1">
                          {(['buys', 'sells'] as const).map((k) => {
                            const on = notify && lb?.[k] !== false
                            return (
                              <button
                                key={k}
                                disabled={!notify}
                                onClick={() => setLabel(w.id, { [k]: !on })}
                                aria-pressed={on}
                                title={`${on ? 'Mute' : 'Alert on'} this wallet's ${k}`}
                                className={clsx('rounded border px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-40', on ? (k === 'buys' ? 'border-up/40 text-up' : 'border-down/40 text-down') : 'border-line2 text-dim')}
                              >
                                {k === 'buys' ? 'Buys' : 'Sells'}
                              </button>
                            )
                          })}
                        </div>
                      </td>
                      <td className={clsx(td, 'text-right num')}>{fmtCompact(st.balance)}</td>
                      <td className={clsx(td, 'text-right num', toneClass(st.pnl))}>{st.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.pnl))}</td>
                      <td className={clsx(td, 'text-right num text-muted')}>{fmtAge(Math.max(0, tick - w.lastActive) * SIM_SEC_PER_TICK)}</td>
                      <td className={clsx(td, 'text-right')}>
                        <div className="flex justify-end gap-1">
                          <button onClick={() => setLabel(w.id, { notify: !notify })} title={notify ? 'Mute trade toasts' : 'Unmute trade toasts'} className={clsx('rounded border p-1', notify ? 'border-accent/40 text-accent' : 'border-line2 text-dim')}>{notify ? <Bell size={12} /> : <BellOff size={12} />}</button>
                          <button onClick={() => openWallet(w.id)} className="rounded border border-line2 px-2 text-[11px] font-semibold text-muted hover:text-ink">Profile / Copy</button>
                          <button onClick={() => toggleTrack(w.id)} title="Stop tracking" className="rounded border border-line2 p-1 text-dim hover:border-down/50 hover:text-down"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-md border border-line bg-panel">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <span className="text-[12px] font-bold">{needle ? 'Search results' : 'Suggested (top 24H PnL)'}</span>
          <div className="relative ml-auto w-full sm:w-64">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, address or type (e.g. whale)" className="h-7 w-full rounded-md border border-line2 bg-bg pl-7 pr-2 text-[12px] outline-none placeholder:text-dim focus:border-accent/60" aria-label="Search wallets to track" />
          </div>
        </div>
        {candidates.length === 0 ? <EmptyState icon="🔎" title="No wallets match" /> : (
          <div className="grid gap-px bg-line/50 sm:grid-cols-2 xl:grid-cols-3">
            {candidates.map((w) => {
              const st = stats.get(w.id)!
              return (
                <div key={w.id} className="flex items-center gap-2 bg-panel px-3 py-2">
                  <button onClick={() => openWallet(w.id)} className="grid size-8 place-items-center rounded-full bg-raise text-[16px]">{w.avatar}</button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] font-semibold">{w.name}<span className={clsx('rounded border px-1 text-[9px]', STYLE_META[w.style].cls)}>{STYLE_META[w.style].label}</span></div>
                    <div className={clsx('num text-[10px]', toneClass(st.pnl))}>24H {st.pnl >= 0 ? '+' : '-'}{fmtCompact(Math.abs(st.pnl))} · WR {(st.winRate * 100).toFixed(0)}%</div>
                  </div>
                  <button onClick={() => toggleTrack(w.id)} className="flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-[11px] font-bold text-accent hover:bg-accent/25"><Plus size={12} /> Track</button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Alerts: one-shot price / MC alerts ──────────────────────────────────────
const ALERT_TYPES: { id: AlertType; label: string; unit: '$' | '%' }[] = [
  { id: 'mcAbove', label: 'MC rises above', unit: '$' },
  { id: 'mcBelow', label: 'MC falls below', unit: '$' },
  { id: 'pctUp', label: 'Pumps by', unit: '%' },
  { id: 'pctDown', label: 'Dumps by', unit: '%' },
]

function Alerts() {
  const tokens = useGame((s) => s.market.tokens)
  const selectedId = useGame((s) => s.selectedId)
  const alerts = useGame((s) => s.alerts)
  const tick = useGame((s) => s.market.tick)
  const addAlert = useGame((s) => s.addAlert)
  const removeAlert = useGame((s) => s.removeAlert)
  const select = useGame((s) => s.select)
  const map = useTokenMap()
  const live = tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated')
  const [tokenId, setTokenId] = useState(selectedId && map.has(selectedId) ? selectedId : live[0]?.id ?? '')
  const [type, setType] = useState<AlertType>('pctUp')
  const [value, setValue] = useState('25')
  const [q, setQ] = useState('')
  const t = map.get(tokenId)
  const unit = ALERT_TYPES.find((a) => a.id === type)!.unit
  const matches = q ? live.filter((x) => x.ticker.toLowerCase().includes(q.toLowerCase().replace('$', ''))).slice(0, 8) : []
  const setTypeWithDefault = (ty: AlertType) => {
    setType(ty)
    if (t) setValue(ty === 'mcAbove' ? String(Math.round(t.mcap * 1.5)) : ty === 'mcBelow' ? String(Math.round(t.mcap * 0.7)) : ty === 'pctUp' ? '25' : '20')
  }
  const active = alerts.filter((a) => a.triggeredTick === undefined)
  const fired = alerts.filter((a) => a.triggeredTick !== undefined)

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-[340px_1fr]">
      <div className="space-y-2.5 rounded-md border border-line bg-panel p-3 text-[12px]">
        <div className="text-[12px] font-bold">New alert</div>
        <div className="relative">
          <div className="flex items-center gap-2 rounded-md border border-line2 bg-bg px-2 py-1.5">
            {t && <TokenIcon token={t} size={20} />}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t ? `$${t.ticker} · ${fmtCompact(t.mcap)} MC — search to change` : 'Search token'} className="w-full bg-transparent text-[12px] outline-none placeholder:text-muted" aria-label="Alert token" />
          </div>
          {matches.length > 0 && (
            <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-line2 bg-raise shadow-xl">
              {matches.map((x) => (
                <button key={x.id} onClick={() => { setTokenId(x.id); setQ('') }} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-panel2">
                  <TokenIcon token={x} size={18} /><span className="font-bold">{x.ticker}</span><span className="ml-auto num text-muted">{fmtCompact(x.mcap)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {ALERT_TYPES.map((a) => (
            <button key={a.id} onClick={() => setTypeWithDefault(a.id)} className={clsx('rounded-md border px-2 py-1 text-[11px] font-semibold', type === a.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>{a.label}</button>
          ))}
        </div>
        <div className="flex items-center rounded-md border border-line2 bg-bg px-2 focus-within:border-accent/60">
          {unit === '$' && <span className="text-dim">$</span>}
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} className="num h-8 w-full bg-transparent px-1 text-right text-[13px] font-semibold outline-none" aria-label="Alert value" />
          {unit === '%' && <span className="text-dim">%</span>}
        </div>
        {t && unit === '$' && <div className="num text-[10px] text-dim">Now {fmtCompact(t.mcap)} → alert at {fmtCompact(Number(value) || 0)}</div>}
        <button disabled={!t || !(Number(value) > 0)} onClick={() => t && addAlert({ tokenId: t.id, type, value: Number(value) })} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[12px] font-bold text-accent-ink hover:brightness-110 disabled:opacity-40">
          <Bell size={13} /> Set alert
        </button>
        <p className="text-[10px] text-dim">Alerts fire once as a toast (with sound, if it's on) and then move to Triggered.</p>
      </div>
      <div className="space-y-3">
        <AlertList title={`Active (${active.length})`} empty="No active alerts">
          {active.map((a) => {
            const tk = map.get(a.tokenId)
            return (
              <AlertRow key={a.id} a={a} onOpen={() => tk && select(tk.id)} onRemove={() => removeAlert(a.id)}>
                <span className="num text-muted">now {tk ? fmtCompact(tk.mcap) : 'delisted'}{tk && <Pct v={tk.mcap / a.baseMcap - 1} className="ml-1 text-[10px]" />}</span>
              </AlertRow>
            )
          })}
        </AlertList>
        <AlertList title={`Triggered (${fired.length})`} empty="Nothing triggered yet">
          {fired.map((a) => (
            <AlertRow key={a.id} a={a} onOpen={() => map.has(a.tokenId) && select(a.tokenId)} onRemove={() => removeAlert(a.id)}>
              <span className="num text-up">🔔 {fmtAge((tick - (a.triggeredTick ?? tick)) * SIM_SEC_PER_TICK)} ago</span>
            </AlertRow>
          ))}
        </AlertList>
      </div>
    </div>
  )
}

function AlertList({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-3 py-2 text-[12px] font-bold">{title}</div>
      {children.length ? children : <div className="px-3 py-3 text-center text-[11px] text-dim">{empty}</div>}
    </div>
  )
}

function AlertRow({ a, onOpen, onRemove, children }: { a: { ticker: string; emoji: string; hue: number; type: AlertType; value: number }; onOpen: () => void; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line/40 px-3 py-2 text-[12px]">
      <button onClick={onOpen} className="flex items-center gap-1.5 hover:text-accent"><TokenIcon token={{ emoji: a.emoji, hue: a.hue, status: 'graduated' }} size={20} /><span className="font-bold">{a.ticker}</span></button>
      <span className="text-muted">{alertText(a)}</span>
      <span className="ml-auto">{children}</span>
      <button onClick={onRemove} className="rounded p-1 text-dim hover:text-down" aria-label="Remove alert"><X size={13} /></button>
    </div>
  )
}

// ─── X / TG tracker ──────────────────────────────────────────────────────────
function SocialPanel() {
  const feed = useGame((s) => s.socialFeed)
  const followed = useGame((s) => s.followedAccounts)
  const [platform, setPlatform] = useState<'x' | 'tg'>('x')
  const [scope, setScope] = useState<'mine' | 'featured' | 'recommended'>('recommended')
  const [onlyCA, setOnlyCA] = useState(false)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase().replace('$', '').replace('@', '')
  const posts = feed.filter((p) => {
    const acc = accById.get(p.accountId)
    if (!acc || acc.platform !== platform) return false
    if (scope === 'mine' && !followed.includes(acc.id)) return false
    if (scope === 'featured' && acc.followers < 50_000) return false
    if (onlyCA && !p.tokenId) return false
    if (needle && !(p.ticker?.toLowerCase().includes(needle) || acc.handle.includes(needle) || p.text.toLowerCase().includes(needle))) return false
    return true
  })
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center gap-4 border-b border-line px-3 py-2">
        {(['x', 'tg'] as const).map((p) => (
          <button key={p} onClick={() => setPlatform(p)} className={clsx('text-[13px] font-bold', platform === p ? 'text-ink' : 'text-dim hover:text-muted')}>{p === 'x' ? 'X Tracker' : 'TG Tracker'}</button>
        ))}
      </div>
      <div className="flex items-center gap-3 px-3 pt-2 text-[11px]">
        {(['mine', 'featured', 'recommended'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className={clsx('font-semibold capitalize', scope === s ? 'text-ink' : 'text-dim hover:text-muted')}>{s === 'mine' ? `Mine${followed.length ? ` ${followed.length}` : ''}` : s}</button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-dim"><input type="checkbox" checked={onlyCA} onChange={(e) => setOnlyCA(e.target.checked)} className="accent-[var(--accent)]" /> Only CA</label>
        <div className="relative min-w-0 flex-1">
          <Search size={11} className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="CA / Symbol / @handle" className="h-6 w-full rounded border border-line2 bg-bg pl-5 pr-1 text-[11px] outline-none placeholder:text-dim focus:border-accent/60" aria-label="Search posts" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {posts.length === 0 ? (
          <EmptyState icon={platform === 'x' ? <AtSign /> : <Send />} title={scope === 'mine' ? "No posts from accounts you follow" : 'Nothing posted yet'} hint={scope === 'mine' ? 'Follow accounts from Recommended' : 'Posts appear as the market moves'} />
        ) : posts.slice(0, 60).map((p) => <PostCard key={p.id} p={p} />)}
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[9px] text-dim">Fictional accounts reacting to the simulation. Not real people, not advice.</p>
    </div>
  )
}

function PostCard({ p }: { p: SocialPost }) {
  const acc = accById.get(p.accountId)!
  const tick = useGame((s) => s.market.tick)
  const followed = useGame((s) => s.followedAccounts.includes(acc.id))
  const toggleFollow = useGame((s) => s.toggleFollowAccount)
  const select = useGame((s) => s.select)
  const openWallet = useGame((s) => s.openWallet)
  const t = useGame((s) => (p.tokenId ? s.market.tokens.find((x) => x.id === p.tokenId) : undefined))
  const since = t && p.mcapAtPost ? t.mcap / p.mcapAtPost - 1 : 0
  const parts = p.text.split(/(\$[A-Z0-9]+)/g)
  return (
    <div className="slide-in border-b border-line/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <div className="grid size-8 place-items-center rounded-full bg-raise text-[16px]">{acc.avatar}</div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 text-[12px] font-bold">
            <span className="truncate">{acc.name}</span>
            {acc.walletId && <button onClick={() => openWallet(acc.walletId!)} title="This account's wallet" className="rounded bg-info/15 px-1 text-[9px] font-semibold text-info">wallet</button>}
          </div>
          <div className="num text-[10px] text-dim">@{acc.handle} · {fmtCompact(acc.followers, '')} · {fmtAge((tick - p.tick) * SIM_SEC_PER_TICK)}</div>
        </div>
        <button onClick={() => toggleFollow(acc.id)} className={clsx('rounded-full px-2.5 py-0.5 text-[10px] font-bold', followed ? 'border border-line2 text-muted' : 'bg-ink text-bg hover:brightness-90')}>{followed ? 'Following' : 'Follow'}</button>
      </div>
      <p className="mt-1.5 whitespace-pre-line text-[12px] leading-snug text-ink/90">
        {parts.map((part, i) => (/^\$[A-Z0-9]+$/.test(part) ? <span key={i} className="font-semibold text-info">{part}</span> : <span key={i}>{part}</span>))}
      </p>
      {p.tokenId && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-bg px-2 py-1.5">
          <button disabled={!t} onClick={() => t && select(t.id)} className="flex min-w-0 items-center gap-1.5 hover:text-accent">
            {t ? <TokenIcon token={t} size={20} /> : <span>❔</span>}
            <span className="text-[12px] font-bold">{p.ticker}</span>
          </button>
          <span className="num text-[11px] text-muted">{t ? fmtCompact(t.mcap) : 'delisted'}</span>
          {t && p.mcapAtPost ? <span className="flex items-center gap-1 text-[10px] text-dim">since post <Pct v={since} className="text-[10px]" /></span> : null}
          <span className="ml-auto"><QuickBuy t={t} /></span>
        </div>
      )}
    </div>
  )
}
