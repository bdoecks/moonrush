import clsx from 'clsx'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { isSafeImageSrc } from '../utils/image'
import { useFlash } from '../hooks/useFlash'
import type { RiskLevel, Token } from '../types'
import { fmtPct } from '../utils/format'

export function TokenIcon({ token, size = 28, className }: { token: Pick<Token, 'emoji' | 'hue' | 'status'> & { image?: string }; size?: number; className?: string }) {
  const dead = token.status === 'rugged' || token.status === 'dead'
  const [broken, setBroken] = useState<string | null>(null)
  if (isSafeImageSrc(token.image) && broken !== token.image) {
    return (
      <div className={clsx('relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-raise', dead && 'grayscale opacity-60', className)} style={{ width: size, height: size }}>
        <img src={token.image} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setBroken(token.image!)} className="size-full object-cover" />
        {token.status === 'bonding' && <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-warn ring-2 ring-panel" />}
      </div>
    )
  }
  return (
    <div
      className={clsx('relative shrink-0 grid place-items-center rounded-md border border-white/10', dead && 'grayscale opacity-60', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.56,
        background: `radial-gradient(circle at 30% 25%, hsl(${token.hue} 80% 55% / 0.55), hsl(${(token.hue + 40) % 360} 70% 22% / 0.9))`,
      }}
    >
      <span className="leading-none select-none">{token.emoji}</span>
      {token.status === 'bonding' && <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-warn ring-2 ring-panel" />}
    </div>
  )
}

export function Pct({ v, className, arrow = false, digits = 1 }: { v: number; className?: string; arrow?: boolean; digits?: number }) {
  const cls = v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted'
  return (
    <span className={clsx('num inline-flex items-center gap-0.5', cls, className)}>
      {arrow && (v > 0 ? <ArrowUp size={10} /> : v < 0 ? <ArrowDown size={10} /> : null)}
      {fmtPct(v, digits)}
    </span>
  )
}

/** A number that flashes green/red when it changes. */
export function FlashNum({ value, children, className, bg = false }: { value: number; children: ReactNode; className?: string; bg?: boolean }) {
  const [dir, key] = useFlash(value)
  return (
    <span key={key} className={clsx('num', dir && (bg ? `flash-${dir}` : `tflash-${dir}`), className)}>
      {children}
    </span>
  )
}

const RISK_STYLE: Record<RiskLevel, string> = {
  LOW: 'text-up bg-up/10 border-up/25',
  MEDIUM: 'text-info bg-info/10 border-info/25',
  HIGH: 'text-warn bg-warn/10 border-warn/30',
  EXTREME: 'text-down bg-down/10 border-down/30',
}
export function RiskBadge({ level, score, className }: { level: RiskLevel; score?: number; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded border px-1 py-px text-[9px] font-bold tracking-wide', RISK_STYLE[level], className)} title={`Risk score ${score ?? ''}/100 — game mechanic, not advice`}>
      {level === 'EXTREME' ? '☠' : level === 'HIGH' ? '▲' : level === 'MEDIUM' ? '◆' : '●'} {level}
      {score !== undefined && <span className="opacity-70 num">{score}</span>}
    </span>
  )
}

export function RiskMeter({ score, level }: { score: number; level: RiskLevel }) {
  const segs = ['LOW', 'MEDIUM', 'HIGH', 'EXTREME'] as const
  const active = segs.indexOf(level)
  const colors = ['bg-up', 'bg-info', 'bg-warn', 'bg-down']
  return (
    <div>
      <div className="flex gap-0.5">
        {segs.map((s, i) => (
          <div key={s} className={clsx('h-1.5 flex-1 rounded-sm transition-colors', i <= active ? colors[active] : 'bg-line2')} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-dim">
        <span>LOW</span>
        <span className="num text-muted">{score}/100</span>
        <span>EXTREME</span>
      </div>
    </div>
  )
}

export function MomentumBar({ score, className }: { score: number; className?: string }) {
  const pos = score >= 50
  const w = Math.abs(score - 50) * 2
  return (
    <div className={clsx('flex items-center gap-1.5', className)} title={`Momentum ${score}/100`}>
      <div className="relative h-1.5 w-12 overflow-hidden rounded-sm bg-line2">
        <div className="absolute inset-y-0 left-1/2 w-px bg-dim" />
        <div
          className={clsx('absolute inset-y-0 transition-all duration-500', pos ? 'left-1/2 bg-up' : 'right-1/2 bg-down')}
          style={{ width: `${w / 2}%` }}
        />
      </div>
      <span className={clsx('num text-[10px] w-5 text-right', pos ? 'text-up' : 'text-down')}>{score}</span>
    </div>
  )
}

export function HypeMeter({ hype }: { hype: number }) {
  const bars = 5
  const lit = Math.round((hype / 100) * bars)
  return (
    <div className="flex items-end gap-px h-3" title={`Social activity ${Math.round(hype)}/100`}>
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} className={clsx('w-[3px] rounded-[1px] transition-colors', i < lit ? (hype > 75 ? 'bg-warn' : 'bg-accent') : 'bg-line2')} style={{ height: `${40 + i * 15}%` }} />
      ))}
      {hype > 80 && <span className="ml-0.5 text-[10px] leading-none">🔥</span>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num rounded border border-line2 bg-raise px-1 py-px text-[9px] text-muted">{children}</kbd>
}

export function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[12px] text-ink truncate">{children}</div>
    </div>
  )
}

export function Modal({ title, onClose, children, wide, closable = true }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; closable?: boolean }) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    return () => prev?.focus?.()
  }, [])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm p-3 fade-in" onMouseDown={(e) => closable && e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={clsx('pop-in w-full max-h-[92vh] overflow-auto rounded-lg border border-line2 bg-panel shadow-2xl', wide ? 'max-w-3xl' : 'max-w-md')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="font-display text-sm font-bold tracking-wide">{title}</div>
          {closable && (
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-raise hover:text-ink" aria-label="Close">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={clsx('relative h-5 w-9 rounded-full transition-colors', on ? 'bg-accent' : 'bg-line2')}>
      <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, className }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('inline-flex rounded-md border border-line2 bg-bg p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={clsx('rounded px-2 py-0.5 text-[11px] font-medium transition-colors', value === o.value ? 'bg-raise text-ink shadow-[inset_0_0_0_1px_var(--color-line2)]' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1 p-4 text-center">
      <div className="text-2xl opacity-60">{icon}</div>
      <div className="text-[12px] font-medium text-muted">{title}</div>
      {hint && <div className="text-[11px] text-dim">{hint}</div>}
    </div>
  )
}
