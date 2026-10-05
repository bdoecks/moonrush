const SUB = '₀₁₂₃₄₅₆₇₈₉'

// Number and time formatters are built once and reused. `toLocaleString` builds a new one inside the browser on every
// call (20-70 microseconds each), and these run hundreds of times a tick. The text they produce is exactly the same.
const fixedFmt = new Map<number, Intl.NumberFormat>()
const fixed = (digits: number) => {
  let f = fixedFmt.get(digits)
  if (!f) fixedFmt.set(digits, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })))
  return f
}
const upToFmt = new Map<number, Intl.NumberFormat>()
/** `n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })`, without building a formatter each time. */
export const fmtUpTo = (n: number, digits: number) => {
  let f = upToFmt.get(digits)
  if (!f) upToFmt.set(digits, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })))
  return f.format(n)
}
const wholeFmt = new Intl.NumberFormat('en-US')
const timeFmt = new Intl.DateTimeFormat('en-US', { hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' })

export function fmtUsd(v: number, digits = 2): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}$${fixed(digits).format(Math.abs(v))}`
}

export function fmtCompact(v: number, prefix = '$'): string {
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (!Number.isFinite(a)) return `${sign}${prefix}∞`
  if (a >= 1e15) return `${sign}${prefix}${a.toExponential(1).replace('+', '')}`
  if (a >= 1e12) return `${sign}${prefix}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}${prefix}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}${prefix}${(a / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${sign}${prefix}${(a / 1e3).toFixed(1)}K`
  return `${sign}${prefix}${a.toFixed(a < 10 ? 2 : 0)}`
}

export function fmtNum(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`
  return wholeFmt.format(Math.round(v))
}

/** Memecoin-style price: 0.0₄5123 for very small numbers. */
export function fmtPrice(p: number): string {
  if (!isFinite(p) || p <= 0) return '$0'
  if (p >= 1) return `$${p.toFixed(4)}`
  if (p >= 0.01) return `$${p.toFixed(5)}`
  const s = p.toFixed(20)
  const m = s.match(/^0\.(0+)(\d{4})/)
  if (!m) return `$${p.toPrecision(4)}`
  const zeros = m[1].length
  if (zeros < 3) return `$0.${m[1]}${m[2]}`
  const sub = String(zeros).split('').map((d) => SUB[+d]).join('')
  return `$0.0${sub}${m[2]}`
}

export function fmtPct(v: number, digits = 1, sign = true): string {
  const pct = v * 100
  const s = Math.abs(pct) >= 1000 ? pct.toFixed(0) : pct.toFixed(digits)
  return `${sign && pct > 0 ? '+' : ''}${s}%`
}

/** Sim seconds → compact age like 45s, 12m, 3h, 2d. */
export function fmtAge(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.floor(sec))}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`
  return `${Math.floor(sec / 86400)}d`
}

/** Real seconds → mm:ss or h:mm:ss. */
export function fmtClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function fmtTime(simSec: number): string {
  const d = new Date(simSec * 1000)
  return Number.isNaN(d.getTime()) ? 'Invalid Date' : timeFmt.format(d) // (the formatter throws on a date that isn't one)
}

export const toneClass = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-muted')
