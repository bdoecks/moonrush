import { useCooking } from '../hooks/useLabs'
import clsx from 'clsx'
import { Check, Lock, X } from 'lucide-react'
import { useValuation } from '../hooks/useDerived'
import { ACCENTS, levelFromXp, modeTagline, MODES, titleFor, UNLOCKS } from '../game/progression'
import { selectSpeed, useGame } from '../game/store'
import { fmtClock, fmtCompact, fmtPct } from '../utils/format'
import { DailyChallenges } from '../components/DailyChallenges'

export function MissionsView() {
  const profile = useGame((s) => s.profile)
  // (While the Cooking page is closed, the missions that need it are left out.)
  const cooking = useCooking()
  const allChallenges = useGame((s) => s.challenges)
  const challenges = cooking ? allChallenges : allChallenges.filter((c) => c.id !== 'cook' && c.id !== 'cookgrad')
  const mode = useGame((s) => s.mode)
  const runTicks = useGame((s) => s.runTicks)
  const runDuration = useGame((s) => s.runDuration)
  const runStatus = useGame((s) => s.runStatus)
  const xpEarned = useGame((s) => s.runStats.xpEarned)
  const accent = useGame((s) => s.settings.accent)
  const updateSettings = useGame((s) => s.updateSettings)
  const speed = useGame(selectSpeed)
  const v = useValuation()
  const l = levelFromXp(profile.xp)
  const cfg = MODES[mode]
  const done = challenges.filter((c) => c.done).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid gap-3 p-3 lg:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          <div className="rounded-md border border-line bg-panel p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-14 place-items-center rounded-lg bg-accent font-display text-[24px] font-bold text-accent-ink glow-accent">{l.level}</div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-dim">Level {l.level}</div>
                <div className="font-display text-[18px] font-bold">{titleFor(l.level)}</div>
                <div className="num text-[11px] text-muted">{profile.xp.toLocaleString()} XP total · +{xpEarned} this round</div>
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-line2">
              <div className="h-full bg-accent transition-all duration-700" style={{ width: `${l.progress * 100}%` }} />
            </div>
            <div className="mt-1 flex justify-between num text-[10px] text-dim">
              <span>{l.into} / {l.span} XP</span>
              <span>Next: {titleFor(l.level + 1)}</span>
            </div>
            <div className="mt-3 text-[10px] text-dim leading-relaxed">
              Earn XP for profitable trades, discovering new tokens, completing missions, holding green positions and hitting milestones.
            </div>
          </div>

          <div className="rounded-md border border-line bg-panel p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Unlocks</div>
            <ul className="space-y-1.5">
              {UNLOCKS.map((u) => (
                <li key={u.level} className={clsx('flex items-center gap-2 text-[11px]', l.level >= u.level ? 'text-ink' : 'text-dim')}>
                  {l.level >= u.level ? <Check size={12} className="text-up" /> : <Lock size={12} />}
                  <span className="num w-9 text-dim">Lv {u.level}</span>
                  {u.label}
                </li>
              ))}
            </ul>
            <div className="mt-3 text-[10px] uppercase tracking-wider text-dim">Accent theme</div>
            <div className="mt-1.5 flex gap-2">
              {ACCENTS.map((a) => {
                const unlocked = l.level >= a.level
                return (
                  <button
                    key={a.id}
                    disabled={!unlocked}
                    onClick={() => updateSettings({ accent: a.id })}
                    title={unlocked ? a.name : `${a.name} — unlocks at level ${a.level}`}
                    className={clsx('relative grid size-8 place-items-center rounded-md border transition-all', accent === a.id ? 'border-white scale-110' : 'border-line2', !unlocked && 'opacity-40')}
                    style={{ background: a.color }}
                    aria-label={`${a.name} accent`}
                  >
                    {!unlocked && <Lock size={12} className="text-black/70" />}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-md border border-line bg-panel p-3 text-[11px]">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Career</div>
            <div className="grid grid-cols-3 gap-2">
              <div><div className="text-[9px] text-dim">Rounds</div><div className="num">{profile.runsPlayed}</div></div>
              <div><div className="text-[9px] text-dim">Best return</div><div className="num text-up">{fmtPct(profile.bestReturnPct)}</div></div>
              <div><div className="text-[9px] text-dim">Lifetime trades</div><div className="num">{profile.lifetimeTrades}</div></div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-accent-ink">{cfg.name.toUpperCase()}</span>
              <span className="text-[12px] font-semibold">{modeTagline(mode, runDuration)}</span>
              {runStatus === 'running' && runDuration && (
                <span className="ml-auto num text-[12px] text-muted">{fmtClock((runDuration - runTicks) / speed)} left</span>
              )}
            </div>
            {cfg.target && (
              <div className="mt-2">
                <div className="mb-1 flex justify-between num text-[10px] text-muted">
                  <span>{fmtCompact(v.equity)}</span>
                  <span>Target {fmtCompact(cfg.target)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-line2">
                  <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.min(100, Math.max(0, ((v.equity - cfg.startBalance) / (cfg.target - cfg.startBalance)) * 100))}%` }} />
                </div>
              </div>
            )}
          </div>

          <DailyChallenges />

          <div className="rounded-md border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div className="text-[12px] font-bold">Round missions</div>
              <div className="num text-[11px] text-muted">{done}/{challenges.length} complete</div>
            </div>
            <ul className="divide-y divide-line/60">
              {challenges.map((c) => {
                const pct = Math.min(1, Math.max(0, c.progress / c.target))
                return (
                  <li key={c.id} className={clsx('flex items-center gap-3 px-3 py-2.5', c.done && 'bg-up/5')}>
                    <div className={clsx('grid size-7 shrink-0 place-items-center rounded-md border', c.done ? 'border-up bg-up text-black' : c.failed ? 'border-down/50 text-down' : 'border-line2 text-dim')}>
                      {c.done ? <Check size={14} /> : c.failed ? <X size={14} /> : <span className="num text-[10px]">{Math.round(pct * 100)}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={clsx('text-[12px] font-semibold', c.failed && 'text-dim line-through')}>{c.title}</div>
                      <div className="text-[10px] text-dim">{c.desc}</div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-line2">
                        <div className={clsx('h-full transition-all duration-500', c.done ? 'bg-up' : c.failed ? 'bg-down/50' : 'bg-accent')} style={{ width: `${pct * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="num text-[11px] text-muted">
                        {c.unit === '%' ? `${Math.max(0, c.progress).toFixed(1)}%` : Math.floor(c.progress)} / {c.target}{c.unit}
                      </div>
                      <div className="num text-[10px] font-bold text-accent">+{c.xp} XP</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
