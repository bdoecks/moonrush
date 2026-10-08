// V2 stage 4: the plug for outside data. One thing comes into the game from outside: which themes are hot in real
// launches (a `TrendFeed`). This file decides where the World's server takes it from, in this order:
//   1. a provider, if one is configured: TREND_FEED_URL (an http(s) address answering JSON) or TREND_FEED_FILE (a
//      JSON file on this machine), named by TREND_FEED_NAME. Asked again every TREND_FEED_MINUTES (default 30).
//   2. the owner's own recording (the market brain), as before.
//   3. nothing: the game falls back to the sample list it ships with.
// Nothing is configured by default, and nothing here invents a connection: with no provider set, no request is made.
// A provider's answer is `{ "asOf": "2026-10-08", "themes": [{ "word": "horse", "weight": 0.8 }, ...] }`. It is
// cleaned by `cleanFeed` (src/game/dataSources.ts): only approved theme words get in, and it must say when it is from.
// If a provider fails, the last good answer is kept (with its own date, so it goes stale honestly) and the failure is
// on /sources for whoever runs the server. See scripts/source-test.ts.
import { readFile } from 'node:fs/promises'
import { cleanFeed, isStale } from '../src/game/dataSources'
import type { TrendFeed } from '../src/types'
import { worldTrends } from './brainBots'

export interface SourceStatus {
  using: 'provider' | 'recorded' | 'sample' // what the World's stories are reading now
  provider: { configured: boolean; name?: string; from?: 'url' | 'file'; ok?: boolean; lastTry?: string; lastGood?: string; error?: string; dropped?: string[] }
  feed: { asOf: string; themes: number; stale: boolean } | null
}

interface Config { url?: string; file?: string; name: string; minutes: number }
const read = (env: NodeJS.ProcessEnv): Config => ({
  url: /^https?:\/\//i.test(env.TREND_FEED_URL ?? '') ? env.TREND_FEED_URL : undefined,
  file: env.TREND_FEED_FILE || undefined,
  name: (env.TREND_FEED_NAME || 'a data provider').slice(0, 40),
  minutes: Math.min(1440, Math.max(1, Number(env.TREND_FEED_MINUTES) || 30)),
})

export class TrendSource {
  private cfg: Config
  private good: TrendFeed | null = null // the provider's last good answer
  private state: SourceStatus['provider']
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.cfg = read(env)
    this.state = { configured: !!(this.cfg.url || this.cfg.file), ...(this.cfg.url || this.cfg.file ? { name: this.cfg.name, from: this.cfg.url ? 'url' as const : 'file' as const } : {}) }
  }

  /** Ask the provider once (nothing happens when none is configured). Never throws. */
  async refresh(): Promise<void> {
    if (!this.state.configured) return
    const now = new Date().toISOString()
    this.state.lastTry = now
    try {
      let raw: unknown
      if (this.cfg.url) {
        const r = await fetch(this.cfg.url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
        if (!r.ok) throw new Error(`the provider answered ${r.status}`)
        const text = await r.text()
        if (text.length > 200_000) throw new Error('the answer is too big')
        raw = JSON.parse(text)
      } else raw = JSON.parse(await readFile(this.cfg.file!, 'utf8'))
      const c = cleanFeed(raw, { source: 'provider', provider: this.cfg.name, fetchedAt: now })
      this.state.dropped = c.dropped.length ? c.dropped : undefined
      if (!c.feed) throw new Error(c.error ?? 'nothing usable')
      this.good = c.feed
      this.state.ok = true
      this.state.lastGood = now
      this.state.error = undefined
    } catch (e) {
      this.state.ok = false
      this.state.error = e instanceof Error ? e.message.slice(0, 200) : 'failed'
    }
  }

  /** Start asking on a timer (and once now). */
  start(): Promise<void> {
    if (!this.state.configured) return Promise.resolve()
    this.timer ??= setInterval(() => void this.refresh(), this.cfg.minutes * 60_000)
    this.timer.unref?.()
    return this.refresh()
  }
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * The feed the World's stories read: the provider's last good answer while it is not stale, else the owner's
   * recording, else null (the game's own sample).
   */
  current(nowMs = Date.now()): TrendFeed | null {
    if (this.good && !isStale(this.good, nowMs)) return this.good
    return worldTrends() ?? this.good
  }

  status(nowMs = Date.now()): SourceStatus {
    const feed = this.current(nowMs)
    return {
      using: feed ? (feed.source === 'provider' ? 'provider' : 'recorded') : 'sample',
      provider: { ...this.state },
      feed: feed ? { asOf: feed.asOf, themes: feed.themes.length, stale: isStale(feed, nowMs) } : null,
    }
  }
}

/** The server's one source (rooms read it every tick: a changed feed reaches the World's players on the next tick). */
export const trendSource = new TrendSource()
