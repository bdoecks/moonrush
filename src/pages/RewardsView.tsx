import clsx from 'clsx'
import { CalendarCheck, Copy, DollarSign, Gift, Info, Share2, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChainBadge } from '../components/chain'
import { EmptyState, Segmented } from '../components/ui'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import type { Chain } from '../types'
import { cashbackOf, CASHBACK_TIERS, CHECKIN_REWARDS, pendingUsd, REF_TIERS, REFERRALS_ENABLED, referralVolume, SHARE_COOLDOWN_TICKS, tierFor, todayKey, yesterdayKey } from '../game/rewardsEngine'
import { MODES } from '../game/progression'
import { selectSpeed, useGame } from '../game/store'
import { fmtCompact, fmtUsd } from '../utils/format'
import { load, save } from '../utils/storage'

type Tab = 'referral' | 'cashback' | 'daily' | 'history'
const tierLabel = (v: number) => (v === 0 ? 'Start' : `Vol.${fmtCompact(v, '')}`)

export function RewardsView() {
  const [tab0, setTab0] = useState<Tab>(() => load<Tab>('rewardsTab') ?? 'cashback')
  const tab: Tab = tab0 === 'referral' && !REFERRALS_ENABLED ? 'cashback' : tab0
  const setTab = (t: Tab) => {
    setTab0(t)
    save('rewardsTab', t)
  }
  const mode = useGame((s) => s.mode)
  const r = useGame((s) => s.rewards)
  const native = useGame((s) => s.market.native)
  const cbPending = pendingUsd(cashbackOf(r), (c) => native?.[c]?.price ?? CHAINS[c].basePrice)
  const canCheckIn = r.checkIn.lastDate !== todayKey()
  const tabs: { id: Tab; label: string; dot?: boolean }[] = [
    { id: 'cashback', label: 'Cashback', dot: cbPending >= 0.0001 },
    ...(REFERRALS_ENABLED ? [{ id: 'referral' as Tab, label: 'Referral', dot: r.commissionPending >= 0.01 }] : []),
    { id: 'daily', label: 'Daily', dot: canCheckIn },
    { id: 'history', label: 'History' },
  ]
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line bg-panel px-3 py-2">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={clsx('relative font-display text-[16px] font-bold transition-colors', tab === t.id ? 'text-ink' : 'text-dim hover:text-muted')}>
            {t.label}
            {t.dot && <span className="absolute -right-2 top-0.5 size-1.5 rounded-full bg-warn" />}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-dim">
          <Info size={12} />
          {mode === 'practice' ? 'Practice: rewards pay out as cash' : `${MODES[mode].name}: cashback pays coins; check-in pays XP`}
        </span>
      </div>
      <div className="p-3">
        {tab === 'referral' && <Referral />}
        {tab === 'cashback' && <Cashback />}
        {tab === 'daily' && <Daily />}
        {tab === 'history' && <History />}
      </div>
    </div>
  )
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-lg border border-line bg-panel p-4', className)}>{children}</div>
}
function Stat({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[18px] font-bold">{children}</div>
      {sub && <div className="text-[10px] text-dim">{sub}</div>}
    </div>
  )
}

function TierCurve({ tiers, current, unit }: { tiers: { volume: number; rate: number }[]; current: number; unit: string }) {
  const tier = tierFor(tiers, current)
  const data = tiers.map((t) => ({ x: tierLabel(t.volume), rate: t.rate * 100 }))
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 28, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="tierFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#19d989" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#19d989" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="x" stroke="#5b6370" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis stroke="#5b6370" fontSize={10} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => `${v}%`} domain={[0, 'dataMax + 5']} />
          <Tooltip
            cursor={{ stroke: '#3a414d' }}
            contentStyle={{ background: '#171b22', border: '1px solid #262c36', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono' }}
            formatter={(v) => [`${v}% ${unit}`, 'Rate']}
          />
          <Area type="monotone" dataKey="rate" stroke="#19d989" strokeWidth={2} fill="url(#tierFill)" isAnimationActive={false} dot={{ r: 4, fill: '#19d989', stroke: '#0c0e11', strokeWidth: 2 }} />
          <ReferenceDot x={data[tier.index].x} y={tier.rate * 100} r={8} fill="var(--accent)" stroke="#0c0e11" strokeWidth={2} label={{ value: `You · ${Math.round(tier.rate * 100)}%`, position: 'top', fill: '#e7e9ee', fontSize: 11, fontWeight: 700 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function Progress({ tiers, volume }: { tiers: { volume: number; rate: number }[]; volume: number }) {
  const t = tierFor(tiers, volume)
  const floor = tiers[t.index].volume
  const pct = t.next ? Math.min(1, (volume - floor) / (t.next.volume - floor)) : 1
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="text-muted">Tier {t.index + 1} · <b className="text-up">{Math.round(t.rate * 100)}%</b></span>
        <span className="num text-dim">{t.next ? `${fmtCompact(t.next.volume - volume)} more volume → ${Math.round(t.next.rate * 100)}%` : 'Max tier'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line2"><div className="h-full bg-up transition-all duration-500" style={{ width: `${pct * 100}%` }} /></div>
    </div>
  )
}

function ClaimButton({ amount, onClaim }: { amount: number; onClaim: () => void }) {
  const running = useGame((s) => s.runStatus === 'running')
  const mode = useGame((s) => s.mode)
  const disabled = amount < 0.01 || !running
  return (
    <button disabled={disabled} onClick={onClaim} className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-up px-5 text-[13px] font-extrabold text-black transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
      <Gift size={14} /> {!running ? 'Start a round to claim' : amount < 0.01 ? 'Nothing to claim' : `Claim ${mode === 'practice' ? fmtUsd(amount) : `${Math.round(amount)} XP`}`}
    </button>
  )
}

function Referral() {
  const r = useGame((s) => s.rewards)
  const tick = useGame((s) => s.market.tick)
  const speed = useGame(selectSpeed)
  const shareInvite = useGame((s) => s.shareInvite)
  const claim = useGame((s) => s.claimReward)
  const notify = useGame((s) => s.notify)
  const refVol = referralVolume(r.friends)
  const tier = tierFor(REF_TIERS, refVol)
  const cooldown = Math.max(0, SHARE_COOLDOWN_TICKS - (tick - r.lastShareTick))
  const link = `moonrush.local/r/${r.code}`
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    notify({ title: 'COPIED', body: text, tone: 'info', icon: '📋' })
  }
  return (
    <div className="space-y-3">
      <Card className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col justify-center">
          <div className="text-[22px] font-bold leading-tight">Invite Friends and Earn<br />Commissions, up to</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[48px] font-bold leading-none text-up">40%</span>
            <span className="text-[18px] font-semibold">of their fees</span>
          </div>
          <p className="mt-2 text-[12px] text-muted">Share your code and simulated traders may sign up. Every trade they make pays you a cut of the 1% fee, and the cut grows with their total volume.</p>
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 rounded-md border border-line2 bg-bg px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-dim">Code</span>
              <span className="num text-[15px] font-bold tracking-widest text-accent">{r.code}</span>
              <button onClick={() => copy(r.code)} className="ml-auto text-dim hover:text-ink" aria-label="Copy code"><Copy size={13} /></button>
            </div>
            <div className="flex items-center gap-2 rounded-md border border-line2 bg-bg px-3 py-2">
              <span className="num truncate text-[12px] text-muted">{link}</span>
              <button onClick={() => copy(link)} className="ml-auto text-dim hover:text-ink" aria-label="Copy link"><Copy size={13} /></button>
            </div>
            <button disabled={cooldown > 0} onClick={shareInvite} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[13px] font-extrabold text-accent-ink hover:brightness-110 disabled:opacity-40">
              <Share2 size={14} /> {cooldown > 0 ? `Share again in ${Math.ceil(cooldown / speed)}s` : 'Share invite'}
            </button>
            <p className="text-[10px] text-dim">Fictional link. Nothing is posted anywhere; sign-ups are simulated.</p>
          </div>
        </div>
        <TierCurve tiers={REF_TIERS} current={refVol} unit="commission" />
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><Stat label="Friends" sub={`max 20`}><span className="flex items-center gap-1.5"><Users size={16} className="text-dim" />{r.friends.length}</span></Stat></Card>
        <Card><Stat label="Referral volume" sub="all-time, from your friends">{fmtCompact(refVol)}</Stat><div className="mt-2"><Progress tiers={REF_TIERS} volume={refVol} /></div></Card>
        <Card><Stat label="Commission rate" sub={`${fmtCompact(r.commissionTotal)} earned lifetime`}><span className="text-up">{Math.round(tier.rate * 100)}%</span></Stat></Card>
        <Card className="flex flex-col justify-between gap-2"><Stat label="Pending commission"><span className="text-up">{fmtUsd(r.commissionPending)}</span></Stat><ClaimButton amount={r.commissionPending} onClaim={() => claim('commission')} /></Card>
      </div>

      <Card className="p-0">
        <div className="border-b border-line px-4 py-2.5 text-[12px] font-bold">Your referrals</div>
        {r.friends.length === 0 ? <EmptyState icon="🤝" title="No referrals yet" hint="Hit Share invite; sign-ups aren't guaranteed" /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wider text-dim">
                  <th className="px-4 py-2 text-left font-semibold">Friend</th>
                  <th className="px-4 py-2 text-right font-semibold">Joined</th>
                  <th className="px-4 py-2 text-right font-semibold">Volume</th>
                  <th className="px-4 py-2 text-right font-semibold">Fees paid</th>
                  <th className="px-4 py-2 text-right font-semibold">Your commission</th>
                </tr>
              </thead>
              <tbody>
                {r.friends.map((f) => (
                  <tr key={f.id} className="border-b border-line/40">
                    <td className="px-4 py-2"><span className="mr-1.5">{f.avatar}</span><span className="font-semibold">{f.name}</span></td>
                    <td className="px-4 py-2 text-right text-muted">{ago(f.joinedAt)}</td>
                    <td className="px-4 py-2 text-right num">{fmtCompact(f.volume)}</td>
                    <td className="px-4 py-2 text-right num text-muted">{fmtUsd(f.fees)}</td>
                    <td className="px-4 py-2 text-right num text-up">{fmtUsd(f.earned ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 py-2 text-[10px] text-dim">Friends only trade while a round is running.</p>
      </Card>
    </div>
  )
}

function Cashback() {
  const cb = cashbackOf(useGame((s) => s.rewards))
  const native = useGame((s) => s.market.native)
  const running = useGame((s) => s.runStatus === 'running')
  const claim = useGame((s) => s.claimCashback)
  const setAuto = useGame((s) => s.setCashbackAuto)
  const price = (c: Chain) => native?.[c]?.price ?? CHAINS[c].basePrice
  const tier = tierFor(CASHBACK_TIERS, cb.volume)
  const total = pendingUsd(cb, price)
  const any = total >= 0.0001
  const top = CASHBACK_TIERS[CASHBACK_TIERS.length - 1].rate
  return (
    <div className="space-y-3">
      <Card className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col justify-center">
          <div className="text-[22px] font-bold leading-tight">Trade & earn cashback, up to</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[48px] font-bold leading-none text-up">{Math.round(top * 100)}%</span>
            <span className="text-[18px] font-semibold">of your fees back</span>
          </div>
          <p className="mt-2 text-[12px] text-muted">
            Every buy and sell pays part of its trading fee (up to the 1% platform fee, not token taxes) back in that chain's coin: <b style={{ color: CHAINS.sol.color }}>SOL</b> on Solana, <b style={{ color: CHAINS.bsc.color }}>BNB</b> on BNB Chain, <b style={{ color: CHAINS.hood.color }}>ETH</b> on Robinhood Chain. Claim it as the coin or as USDC. Your rate climbs with your lifetime volume.
          </p>
          <div className="mt-4"><Progress tiers={CASHBACK_TIERS} volume={cb.volume} /></div>
        </div>
        <TierCurve tiers={CASHBACK_TIERS} current={cb.volume} unit="cashback" />
      </Card>

      {/* Claimable, per chain */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-dim">Claimable cashback</div>
            <div className="num text-[26px] font-bold text-up">{fmtUsd(total, total < 10 ? 4 : 2)}</div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button disabled={!any || !running} onClick={() => claim('all', 'coin')} className="flex h-10 items-center gap-1.5 rounded-md bg-up px-4 text-[13px] font-extrabold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              <Gift size={14} /> Claim all as coins
            </button>
            <button disabled={!any || !running} onClick={() => claim('all', 'usdc')} className="flex h-10 items-center gap-1.5 rounded-md border border-info/50 px-4 text-[13px] font-bold text-info hover:bg-info/10 disabled:cursor-not-allowed disabled:opacity-40">
              <DollarSign size={14} /> Claim all as USDC
            </button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {CHAIN_IDS.map((c) => {
            const amt = cb.pending[c]
            const has = amt > 1e-9
            return (
              <div key={c} className="rounded-lg border border-line2 bg-bg p-3" style={{ backgroundImage: `radial-gradient(circle at 0% 0%, ${CHAINS[c].color}1f, transparent 60%)` }}>
                <div className="flex items-center gap-2">
                  <ChainBadge chain={c} />
                  <span className="text-[12px] font-semibold">{CHAINS[c].name}</span>
                </div>
                <div className="num mt-2 text-[18px] font-bold" style={{ color: has ? CHAINS[c].color : undefined }}>{fmtNative(amt, c)}</div>
                <div className="num text-[11px] text-dim">≈ {fmtUsd(amt * price(c), 4)}</div>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  <button disabled={!has || !running} onClick={() => claim(c, 'coin')} className="rounded-md border border-up/50 py-1 text-[11px] font-bold text-up hover:bg-up hover:text-black disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-up">
                    Claim {CHAINS[c].native}
                  </button>
                  <button disabled={!has || !running} onClick={() => claim(c, 'usdc')} className="rounded-md border border-info/50 py-1 text-[11px] font-bold text-info hover:bg-info/10 disabled:cursor-not-allowed disabled:opacity-30">
                    → USDC
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px]">
          <span className="font-semibold">Auto-claim</span>
          <Segmented value={cb.auto} onChange={setAuto} options={[{ value: 'off', label: 'Off' }, { value: 'coin', label: 'As coin' }, { value: 'usdc', label: 'As USDC' }]} />
          <span className="text-[11px] text-dim">{cb.auto === 'off' ? 'Cashback waits here until you claim it.' : cb.auto === 'coin' ? 'Each fill pays its cashback straight into your primary wallet.' : 'Each fill pays its cashback to your USDC balance.'}</span>
        </div>
        <p className="mt-2 text-[10px] text-dim">{running ? 'Coins go to your primary (first selected) wallet. Unclaimed cashback expires when a new round starts.' : 'Start a round to earn and claim cashback.'}</p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><Stat label="Cashback rate" sub={tier.next ? `next: ${Math.round(tier.next.rate * 100)}% at ${fmtCompact(tier.next.volume)}` : 'max tier'}><span className="text-up">{Math.round(tier.rate * 100)}%</span></Stat></Card>
        <Card><Stat label="Lifetime volume" sub="sets your tier">{fmtCompact(cb.volume)}</Stat></Card>
        <Card><Stat label="Earned this round" sub={`on ${fmtCompact(cb.roundVolume)} volume`}><span className="text-up">{fmtUsd(cb.roundUsd, cb.roundUsd < 10 ? 4 : 2)}</span></Stat></Card>
        <Card><Stat label="Claimed all-time">{fmtUsd(cb.lifetimeUsd, cb.lifetimeUsd < 10 ? 4 : 2)}</Stat></Card>
      </div>
      <Card className="p-0">
        <div className="border-b border-line px-4 py-2.5 text-[12px] font-bold">Tiers</div>
        <div className="grid grid-cols-2 gap-px bg-line/50 sm:grid-cols-5">
          {CASHBACK_TIERS.map((t, i) => (
            <div key={t.volume} className={clsx('bg-panel px-4 py-3', i === tier.index && 'bg-up/5 shadow-[inset_0_-2px_0_#19d989]')}>
              <div className="text-[10px] text-dim">{tierLabel(t.volume)}</div>
              <div className={clsx('num text-[16px] font-bold', i <= tier.index ? 'text-up' : 'text-muted')}>{Math.round(t.rate * 100)}%</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Daily() {
  const r = useGame((s) => s.rewards)
  const mode = useGame((s) => s.mode)
  const running = useGame((s) => s.runStatus === 'running')
  const checkIn = useGame((s) => s.checkIn)
  const done = r.checkIn.lastDate === todayKey()
  const alive = done || r.checkIn.lastDate === yesterdayKey()
  const streak = alive ? r.checkIn.streak : 0
  const nextDay = done ? streak : (streak % 7) + 1
  const asCash = mode === 'practice' && running
  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid size-11 place-items-center rounded-lg bg-warn/15 text-warn"><CalendarCheck size={22} /></div>
          <div>
            <div className="text-[18px] font-bold">Daily check-in</div>
            <div className="text-[12px] text-muted">Come back each day to grow your streak. Miss a day and it resets. Day 7 pays the most, then the cycle restarts.</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-wider text-dim">Streak</div>
            <div className="num text-[22px] font-bold text-warn">{streak} 🔥</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
          {CHECKIN_REWARDS.map((amt, i) => {
            const day = i + 1
            const claimed = alive && day <= streak
            const isToday = !done && day === nextDay
            return (
              <div key={day} className={clsx('rounded-lg border p-3 text-center', claimed ? 'border-up/40 bg-up/10' : isToday ? 'border-warn/60 bg-warn/10 glow-accent' : 'border-line2 bg-bg')}>
                <div className="text-[10px] uppercase tracking-wider text-dim">Day {day}</div>
                <div className="mt-1 text-[22px]">{day === 7 ? '💰' : claimed ? '✅' : '🎁'}</div>
                <div className={clsx('num mt-1 text-[12px] font-bold', claimed ? 'text-up' : 'text-ink')}>{asCash ? fmtUsd(amt, 0) : `${amt} XP`}</div>
              </div>
            )
          })}
        </div>
        <button disabled={done} onClick={checkIn} className="mt-4 flex h-11 w-full items-center justify-center gap-1.5 rounded-md bg-warn text-[14px] font-extrabold text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          <Gift size={15} /> {done ? 'Checked in today · come back tomorrow' : `Check in · Day ${nextDay} · ${asCash ? fmtUsd(CHECKIN_REWARDS[nextDay - 1], 0) : `${CHECKIN_REWARDS[nextDay - 1]} XP`}`}
        </button>
        <p className="mt-2 text-[10px] text-dim">Pays cash during a running Practice round, XP otherwise. Uses your device's calendar day.</p>
      </Card>
    </div>
  )
}

function History() {
  const history = useGame((s) => s.rewards.history)
  if (!history.length) return <EmptyState icon="🎁" title="No rewards claimed yet" />
  const label = { commission: 'Referral commission', cashback: 'Fee cashback', checkin: 'Daily check-in' }
  return (
    <Card className="p-0">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wider text-dim">
            <th className="px-4 py-2 text-left font-semibold">When</th>
            <th className="px-4 py-2 text-left font-semibold">Reward</th>
            <th className="px-4 py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {history.map((h) => (
            <tr key={h.id} className="border-b border-line/40">
              <td className="px-4 py-2 text-muted">{ago(h.time)}</td>
              <td className="px-4 py-2 font-semibold">{label[h.kind]}</td>
              <td className="px-4 py-2 text-right num text-up">
                {h.paidAs === 'coin' && h.chain ? `+${fmtNative(h.native ?? 0, h.chain)}` : h.paidAs === 'xp' ? `+${Math.round(h.amount)} XP` : `+${fmtUsd(h.amount, h.amount < 10 ? 4 : 2)}${h.kind === 'cashback' ? ' USDC' : ''}`}
                {h.paidAs === 'coin' && <span className="ml-1 text-[10px] text-dim">≈{fmtUsd(h.amount, 4)}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function ago(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
