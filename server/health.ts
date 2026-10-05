// The server's health watch: it keeps note of how the database, the saves, the market tick and memory are doing, and
// turns that into a short list of problems in plain words. `/status` shows the result to anyone (an outside checker
// reads it and emails the owner), and the admin panel shows the numbers behind it.
//
// Nothing here talks to the network or the clock on its own: the server calls the `note…` functions as things happen,
// and `judge` is a pure function of what was noted and the time, so it can be tested.

export interface HealthState {
  bootAt: number
  saving: boolean // is there a database at all (SUPABASE_SECRET_KEY set)
  worldLoaded: boolean
  db: { okAt: number | null; fails: number; ms: number | null } // the once-a-minute database check
  save: { okAt: number | null; fails: number; ms: number | null; kb: number | null } // the World's save
  ticks: number[] // how long the World's last ticks took (ms), newest last
  tickAt: number | null // when the World last ticked
  tickErrors: number[] // times a tick threw
  errors: number[] // times something threw where nothing was waiting to catch it (the server carries on)
  loopLagMs: number // worst event-loop stall in the last minute
  memoryMb: number
  backup: { set: boolean | null; okAt: number | null; error: string | null } // set: is the backups table there (null = not checked yet)
}

export interface Problem {
  code: string
  text: string
  /** A warning is shown to the admin but doesn't count as "something is wrong" for the outside checker. */
  warning?: boolean
}

export const LIMITS = {
  worldLoadMs: 2 * 60_000, // the World should have loaded this long after boot
  dbFails: 3, // database checks in a row
  dbSlowMs: 5_000,
  saveStaleMs: 16 * 60_000, // the World saves every 5 min: three missed in a row
  tickAvgMs: 400, // a tick should take a small part of its second
  tickStallMs: 6_000,
  tickErrorsPerMin: 3,
  loopLagMs: 1_500,
  memoryMb: 460, // Render gives 512
  backupStaleMs: 49 * 3600_000, // backups are daily: two missed
  errorsPer10Min: 3,
}

export const fresh = (now: number, saving: boolean): HealthState => ({
  bootAt: now, saving, worldLoaded: false, db: { okAt: null, fails: 0, ms: null }, save: { okAt: null, fails: 0, ms: null, kb: null },
  ticks: [], tickAt: null, tickErrors: [], errors: [], loopLagMs: 0, memoryMb: 0, backup: { set: null, okAt: null, error: null },
})

const mins = (ms: number) => `${Math.max(1, Math.round(ms / 60_000))} min`

/** What is wrong right now, most serious first. An empty list means all is well. */
export function judge(s: HealthState, now: number): Problem[] {
  const out: Problem[] = []
  const up = now - s.bootAt
  if (!s.worldLoaded && up > LIMITS.worldLoadMs) out.push({ code: 'world-loading', text: `The World hasn't loaded ${mins(up)} after the server started: the database isn't answering` })
  if (s.saving) {
    if (s.db.fails >= LIMITS.dbFails) out.push({ code: 'db-down', text: `The database isn't answering (${s.db.fails} checks in a row failed${s.db.okAt ? `, last answer ${mins(now - s.db.okAt)} ago` : ''})` })
    else if (s.db.fails === 0 && (s.db.ms ?? 0) > LIMITS.dbSlowMs) out.push({ code: 'db-slow', text: `The database is slow: a tiny question took ${(s.db.ms! / 1000).toFixed(1)}s` })
    if (s.worldLoaded) {
      const since = s.save.okAt ?? s.bootAt
      if (now - since > LIMITS.saveStaleMs) out.push({ code: 'save-stale', text: `The World hasn't been saved for ${mins(now - since)}${s.save.fails ? ` (${s.save.fails} saves in a row failed)` : ''}` })
    }
  }
  if (s.worldLoaded) {
    if (s.tickAt !== null && now - s.tickAt > LIMITS.tickStallMs) out.push({ code: 'tick-stalled', text: `The market has stopped: no tick for ${Math.round((now - s.tickAt) / 1000)}s` })
    const errs = s.tickErrors.filter((t) => now - t < 60_000).length
    if (errs >= LIMITS.tickErrorsPerMin) out.push({ code: 'tick-errors', text: `The market tick is failing (${errs} errors in the last minute)` })
    if (s.ticks.length >= 10) {
      const avg = s.ticks.reduce((a, b) => a + b, 0) / s.ticks.length
      if (avg > LIMITS.tickAvgMs) out.push({ code: 'tick-slow', text: `The server is struggling: each market tick takes ${Math.round(avg)} ms of its second` })
    }
  }
  const errors = s.errors.filter((t) => now - t < 10 * 60_000).length
  if (errors >= LIMITS.errorsPer10Min) out.push({ code: 'errors', text: `The server hit ${errors} unexpected errors in the last 10 minutes (it kept running; the details are in Render's log)` })
  else if (errors > 0) out.push({ code: 'errors', warning: true, text: `The server hit ${errors === 1 ? 'an unexpected error' : `${errors} unexpected errors`} in the last 10 minutes and carried on (details in Render's log)` })
  if (s.loopLagMs > LIMITS.loopLagMs) out.push({ code: 'lag', text: `The server froze for ${(s.loopLagMs / 1000).toFixed(1)}s in the last minute` })
  if (s.memoryMb > LIMITS.memoryMb) out.push({ code: 'memory', text: `Memory is nearly full (${Math.round(s.memoryMb)} MB of 512)` })
  if (s.saving) {
    if (s.backup.set === false) out.push({ code: 'backup-setup', warning: true, text: 'Backups are not set up yet: run supabase/008_backups.sql in the Supabase SQL editor' })
    else if (s.backup.set && s.worldLoaded) {
      // The time of the last copy comes from the database, so this holds across restarts (and the free plan's naps).
      if (s.backup.okAt !== null && now - s.backup.okAt > LIMITS.backupStaleMs) out.push({ code: 'backup-stale', text: `No backup for ${Math.round((now - s.backup.okAt) / 3600_000)} hours${s.backup.error ? ` (${s.backup.error})` : ''}` })
      else if (s.backup.error) out.push({ code: 'backup-failed', text: `The last backup failed: ${s.backup.error}` })
      else if (s.backup.okAt === null) out.push({ code: 'backup-none', warning: true, text: 'No backup has been taken yet: the first one is taken a couple of minutes after the server starts' })
    }
  }
  return out
}

// ─── The running server's own state ──────────────────────────────────────────

export const health: HealthState = fresh(Date.now(), false)

export function noteDb(ok: boolean, ms: number, now = Date.now()) {
  health.db = ok ? { okAt: now, fails: 0, ms } : { ...health.db, fails: health.db.fails + 1, ms }
}
export function noteSave(ok: boolean, ms: number, kb: number, now = Date.now()) {
  health.save = ok ? { okAt: now, fails: 0, ms, kb } : { ...health.save, fails: health.save.fails + 1, ms }
}
export function noteTick(ms: number, now = Date.now()) {
  health.ticks.push(ms)
  if (health.ticks.length > 60) health.ticks.shift()
  health.tickAt = now
}
export function noteTickError(now = Date.now()) {
  health.tickErrors = [...health.tickErrors.filter((t) => now - t < 60_000), now]
}
export function noteError(now = Date.now()) {
  health.errors = [...health.errors.filter((t) => now - t < 10 * 60_000), now]
}

/** Everything the admin panel shows: the verdict and the numbers behind it. */
export function report(now = Date.now()) {
  health.memoryMb = process.memoryUsage().rss / 1e6
  const problems = judge(health, now)
  const t = health.ticks
  return {
    status: problems.some((p) => !p.warning) ? ('degraded' as const) : ('ok' as const),
    problems,
    upMin: Math.round((now - health.bootAt) / 60_000),
    memoryMb: Math.round(health.memoryMb),
    tickMs: t.length ? { avg: Math.round(t.reduce((a, b) => a + b, 0) / t.length), max: Math.round(Math.max(...t)) } : null,
    loopLagMs: Math.round(health.loopLagMs),
    saving: health.saving,
    worldLoaded: health.worldLoaded,
    db: { ms: health.db.ms === null ? null : Math.round(health.db.ms), fails: health.db.fails, okAgoSec: health.db.okAt ? Math.round((now - health.db.okAt) / 1000) : null },
    save: { okAgoSec: health.save.okAt ? Math.round((now - health.save.okAt) / 1000) : null, ms: health.save.ms === null ? null : Math.round(health.save.ms), kb: health.save.kb, fails: health.save.fails },
    backup: { set: health.backup.set, okAgoHours: health.backup.okAt ? Math.round((now - health.backup.okAt) / 360_000) / 10 : null, error: health.backup.error },
  }
}
export type HealthReport = ReturnType<typeof report>

/** Watch for the server freezing: a 1s timer that notices when it fires late. Keeps the worst stall of the last minute. */
export function watchLoop() {
  let last = Date.now()
  let worst = 0
  let n = 0
  setInterval(() => {
    const now = Date.now()
    worst = Math.max(worst, now - last - 1000)
    last = now
    if (++n % 60 === 0) {
      health.loopLagMs = worst
      worst = 0
    } else health.loopLagMs = Math.max(health.loopLagMs, worst)
  }, 1000).unref()
}
