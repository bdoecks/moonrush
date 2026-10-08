// Load test: how many players can the server hold?
// Starts the real server on a spare port with NO database (nothing here can touch the live game or its saves), lets the
// World grow to a realistic size, then connects fake players in steps. Each one behaves like a browser: joins the
// World, receives every tick, reports its status every 2 seconds, and some of them trade and open coins. For every
// step it measures what the server spent (processor time, memory, freezes) and what the players got (ticks on time,
// data per second, how long an order takes).
//
//   npx tsx scripts/load-test.ts                       # steps of 1, 10, 25, 50, 100, 200 players, 30 s each
//   npx tsx scripts/load-test.ts --steps 1,50,150      # your own steps
//   npx tsx scripts/load-test.ts --hold 60             # longer per step (steadier numbers)
//   npx tsx scripts/load-test.ts --warm 3000           # World ticks to run before anyone joins (default 1800)
//   npx tsx scripts/load-test.ts --bots 40             # World bots (default: the server's own default)
//
// The numbers are for THIS computer. The last lines turn them into an estimate for Render's plans, using how much
// slower Render ran the same market tick (read it from the live /status once this is deployed, and pass it as
// --render-tick-ms N for a real figure instead of a range).
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { MP_PATH, WORLD_CODE } from '../src/net/protocol'

const ROOT = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const STEPS = (arg('--steps') ?? '1,10,25,50,100,200').split(',').map(Number).filter((n) => n > 0)
const HOLD = Number(arg('--hold') ?? 30)
const WARM = Number(arg('--warm') ?? 1800)
const BOTS = arg('--bots')
const RENDER_TICK_MS = Number(arg('--render-tick-ms') ?? 0)
const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] }
const RUN = randomBytes(3).toString('hex')

// ─── The server under test ───────────────────────────────────────────────────
const freePort = () => new Promise<number>((res) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)) }) })
interface Sample { t: number; cpuMs: number; rss: number; heap: number; lagMs: number }
const samples: Sample[] = []
let serverLog = ''
let serverDied = false
let server: ChildProcess

async function startServer(port: number) {
  server = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(join(ROOT, 'scripts/load-probe.mjs')).href, 'server/index.ts'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // No database, ever: with no secret key the server neither loads nor saves anything.
    env: { ...process.env, PORT: String(port), SUPABASE_SECRET_KEY: '', WORLD_GUESTS_PLAY: '1', WORLD_WARM_TICKS: String(WARM), ...(BOTS ? { WORLD_BOTS: BOTS } : {}) },
  })
  server.stdout!.on('data', (d) => (serverLog += d))
  server.stderr!.on('data', (d) => (serverLog += d))
  server.on('message', (m: Sample & { lt?: number }) => { if (m?.lt === 1) samples.push(m) })
  server.on('exit', (code) => { if (code) serverDied = true })
  for (let i = 0; i < 1800 && !serverLog.includes(`localhost:${port}`) && !serverDied; i++) await sleep(100)
  return serverLog.includes(`localhost:${port}`)
}

// ─── A fake player ───────────────────────────────────────────────────────────
type Kind = 'watcher' | 'browser' | 'trader'
const TYPE = /^\{"t":"(\w+)"/
class Player {
  ws!: WebSocket
  id: string
  joined = false
  spectator = false
  compressed = false
  seq = 0
  raw = 0
  wireAt = 0
  byType: Record<string, number> = {}
  gaps: number[] = []
  lastTick = 0
  coins = 0
  online = 0
  coinIds: string[] = []
  bags = new Map<string, number>()
  sent = new Map<number, number>()
  rtts: number[] = []
  orders = 0
  refused = 0
  closed = false
  private timers: ReturnType<typeof setInterval>[] = []
  constructor(readonly n: number, readonly kind: Kind, readonly parse: boolean) {
    this.id = `lt-${RUN}-${String(n).padStart(4, '0')}`
  }
  connect(port: number) {
    return new Promise<boolean>((res) => {
      // Default options: the same compression offer a browser makes, so the server compresses for us as it does for them.
      const ws = (this.ws = new WebSocket(`ws://127.0.0.1:${port}${MP_PATH}`, { skipUTF8Validation: true }))
      const done = setTimeout(() => res(false), 30_000)
      ws.on('open', () => {
        this.compressed = /permessage-deflate/.test(ws.extensions)
        // The name has a space on purpose: names shaped like account names make the server ask the real database.
        ws.send(JSON.stringify({ t: 'hello', name: `LT ${this.n}`, avatar: '🐸', level: 1, playerId: this.id, room: WORLD_CODE, key: randomBytes(18).toString('hex') }))
      })
      ws.on('message', (data: Buffer) => {
        this.raw += data.length
        const type = TYPE.exec(data.subarray(0, 24).toString('latin1'))?.[1] ?? '?'
        this.byType[type] = (this.byType[type] ?? 0) + data.length
        if (type === 'tick') {
          const now = performance.now()
          if (this.lastTick) this.gaps.push(now - this.lastTick)
          this.lastTick = now
          if (this.parse) {
            const m = JSON.parse(data.toString())
            this.coins = m.market.tokens.length
            for (const id of Object.keys(m.newCandles ?? {})) this.coinIds.push(id)
          }
        } else if (type === 'welcome') {
          const m = JSON.parse(data.toString())
          this.spectator = !!m.spectator
          this.coins = m.market.tokens.length
          this.coinIds = m.market.tokens.filter((t: { status: string }) => t.status === 'bonding' || t.status === 'graduated').map((t: { id: string }) => t.id)
          this.joined = true
          clearTimeout(done)
          this.live()
          res(true)
        } else if (type === 'wallet') {
          const m = JSON.parse(data.toString())
          const at = this.sent.get(m.ack)
          if (at !== undefined) {
            this.rtts.push(performance.now() - at)
            this.sent.delete(m.ack)
          }
          if (m.failures?.length) this.refused++
          const pos = m.state?.accounts?.[0]?.positions ?? {}
          this.bags = new Map(Object.entries(pos).map(([id, p]) => [id, (p as { qty: number }).qty]))
        } else if (type === 'players' && this.parse) {
          this.online = JSON.parse(data.toString()).players.length
        }
      })
      ws.on('close', () => { this.closed = true; clearTimeout(done); res(false) })
      ws.on('error', () => undefined)
    })
  }
  private send(m: unknown) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)) }
  /** What a browser does once it is in: its wallet layout, a status report every 2 s, and (some players) coins and trades. */
  private live() {
    this.send({ t: 'layout', seq: ++this.seq, layout: { accounts: [{ id: 'w-main', name: 'Main', emoji: '🟢', createdAt: Date.now() }], active: ['w-main'] } })
    const status = () => this.send({ t: 'status', equity: 10_000, startEquity: 10_000, trades: this.orders, wins: 0, level: 1, finished: false, protect: [...this.bags.keys()].slice(0, 20), holdings: [], addrs: [], cbVolume: 0 })
    status()
    this.timers.push(setInterval(status, 2000))
    const pick = () => this.coinIds[Math.floor(Math.random() * this.coinIds.length)]
    if (this.kind !== 'watcher') this.timers.push(setInterval(() => { const id = pick(); if (id) this.send({ t: 'candles', tokenId: id }) }, 20_000 + Math.random() * 20_000))
    if (this.kind === 'trader') {
      this.timers.push(setInterval(() => {
        const held = [...this.bags.entries()]
        const n = ++this.seq
        this.sent.set(n, performance.now())
        this.orders++
        // Buy a little of a random live coin, or sell a bag: about what a busy player does every 10-20 seconds.
        if (held.length && Math.random() < 0.45) {
          const [tokenId, qty] = held[Math.floor(Math.random() * held.length)]
          this.send({ t: 'order', seq: n, ref: n, order: { side: 'sell', tokenId, legs: [{ walletId: 'w-main', qty }] } })
        } else this.send({ t: 'order', seq: n, ref: n, order: { side: 'buy', tokenId: pick(), walletIds: ['w-main'], usdEach: 25 + Math.random() * 75, autoSwap: true } })
      }, 10_000 + Math.random() * 10_000))
    }
  }
  wire() { return (this.ws as unknown as { _socket?: { bytesRead: number } })._socket?.bytesRead ?? 0 }
  reset() {
    this.raw = 0
    this.byType = {}
    this.gaps = []
    this.rtts = []
    this.refused = 0
    this.wireAt = this.wire()
  }
  stop() {
    this.timers.forEach(clearInterval)
    this.ws.terminate()
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────
const port = await freePort()
console.log(`Starting the server on port ${port} with no database, warming the World up for ${WARM} ticks…`)
const up = await startServer(port)
ok(up && !serverDied, 'the server started')
if (!up) {
  console.log(serverLog.slice(-1500))
  process.exit(1)
}
const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json()).catch(() => null) as { saving?: boolean } | null
ok(health?.saving === false, 'it has no database: nothing here can reach the live game or its saves')
if (health?.saving !== false) {
  server.kill()
  process.exit(1)
}

const players: Player[] = []
interface Row { n: number; cpu: number; rssMb: number; lagMs: number; gapP95: number; gapMax: number; late: number; rawKb: number; wireKb: number; playersShare: number; rttP50: number; rttP95: number; orders: number; refused: number; coins: number; dropped: number }
const rows: Row[] = []
console.log('\nplayers | server CPU (ms per second, 1000 = one whole core) | memory | worst freeze | ticks: 95% within / worst gap / late | data per player raw → on the wire | player list share | order answered in (half / 95%) | coins')
for (const target of STEPS) {
  // A third only watch, a third also open coins, a third also trade.
  const add: Player[] = []
  for (let n = players.length; n < target; n++) add.push(new Player(n, (['trader', 'browser', 'watcher'] as const)[n % 3], n < 3))
  for (let i = 0; i < add.length; i += 10) {
    await Promise.all(add.slice(i, i + 10).map((p) => p.connect(port)))
    await sleep(100)
  }
  players.push(...add)
  await sleep(6000) // let the joins settle
  const s0 = samples.length
  players.forEach((p) => p.reset())
  await sleep(HOLD * 1000)
  const win = samples.slice(s0)
  const alive = players.filter((p) => p.joined && !p.closed)
  const secs = win.length > 1 ? (win[win.length - 1].t - win[0].t) / 1000 : HOLD
  const gaps = alive.slice(0, 40).flatMap((p) => p.gaps)
  const rtts = alive.flatMap((p) => p.rtts)
  const raw = alive.reduce((a, p) => a + p.raw, 0) / Math.max(1, alive.length) / HOLD / 1024
  const wire = alive.reduce((a, p) => a + (p.wire() - p.wireAt), 0) / Math.max(1, alive.length) / HOLD / 1024
  const sample = alive[0]
  const total = Object.values(sample?.byType ?? {}).reduce((a, b) => a + b, 0)
  const row: Row = {
    n: alive.length,
    cpu: win.length > 1 ? (win[win.length - 1].cpuMs - win[0].cpuMs) / secs : 0,
    rssMb: Math.max(0, ...win.map((s) => s.rss)) / 1e6,
    lagMs: Math.max(0, ...win.map((s) => s.lagMs)),
    gapP95: pct(gaps, 0.95), gapMax: Math.max(0, ...gaps), late: gaps.filter((g) => g > 1300).length / Math.max(1, gaps.length),
    rawKb: raw, wireKb: wire, playersShare: total ? (sample.byType.players ?? 0) / total : 0,
    rttP50: pct(rtts, 0.5), rttP95: pct(rtts, 0.95), orders: rtts.length, refused: alive.reduce((a, p) => a + p.refused, 0),
    coins: sample?.coins ?? 0, dropped: players.length - alive.length,
  }
  rows.push(row)
  console.log(`${String(row.n).padStart(7)} | ${row.cpu.toFixed(0).padStart(5)} | ${row.rssMb.toFixed(0)} MB | ${row.lagMs.toFixed(0)} ms | ${row.gapP95.toFixed(0)} ms / ${row.gapMax.toFixed(0)} ms / ${(row.late * 100).toFixed(1)}% | ${row.rawKb.toFixed(0)} KB/s → ${row.wireKb.toFixed(1)} KB/s | ${(row.playersShare * 100).toFixed(0)}% | ${row.rttP50.toFixed(0)} / ${row.rttP95.toFixed(0)} ms (${row.orders} orders, ${row.refused} refused) | ${row.coins}${row.dropped ? ` | ${row.dropped} DROPPED` : ''}`)
  if (serverDied) break
}

// ─── What it means ───────────────────────────────────────────────────────────
const first = rows[0]
const last = rows[rows.length - 1]
console.log('')
ok(!serverDied, 'the server stayed up for the whole test')
ok(players.every((p) => p.joined), `every fake player got into the World (${players.filter((p) => p.joined).length} of ${players.length})`)
ok(players.filter((p) => p.joined).every((p) => p.compressed && !p.spectator), 'they were compressed for like real browsers, and played as real players (not spectators)')
ok(!!first && first.late === 0 && first.gapP95 < 1150, `with ${first?.n} player the ticks arrive on time (95% within ${first?.gapP95.toFixed(0)} ms)`)
ok(rows.some((r) => r.orders > 0) && last.rttP50 > 0, `orders were answered (${rows.reduce((a, r) => a + r.orders, 0)} in all)`)
// (With the fair market fewer coins bond: a World settles at 130 to 160 coins, where it used to hold 200 to 300.)
ok(first.coins >= 100, `the World was a realistic size (${first.coins} coins; a World runs at 130-160 coins)`)

// Server cost = a base (the World itself) + so much per player. Least squares over the steps.
const xs = rows.map((r) => r.n), ys = rows.map((r) => r.cpu)
const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
const per = xs.length > 1 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.max(1e-9, xs.reduce((a, x) => a + (x - mx) ** 2, 0)) : 0
const base = my - per * mx
const memPer = rows.length > 1 ? (last.rssMb - first.rssMb) / Math.max(1, last.n - first.n) : 0
const lateAt = rows.find((r) => r.late > 0.02 || r.gapP95 > 1300)
console.log(`\nOn this computer: the World alone costs about ${base.toFixed(0)} ms of processor per second, and each player adds about ${per.toFixed(2)} ms and ${memPer.toFixed(2)} MB of memory.`)
console.log(lateAt ? `Ticks started arriving late at ${lateAt.n} players.` : `Ticks stayed on time all the way to ${last.n} players.`)
console.log(`Each player receives about ${last.rawKb.toFixed(0)} KB a second (${last.wireKb.toFixed(1)} KB after compression): ${(last.wireKb * 3600 * 24 * 30 / 1e6).toFixed(0)} GB a month for one player online around the clock.`)

// Render gives a fraction of a core: free 0.1 (100 ms of processor per second), Starter 0.5 (500 ms). Work arrives in
// one burst per tick, so half the budget is taken as the comfortable limit. How much slower Render's core is than
// this one is the unknown: measured if --render-tick-ms was given (the live server's own tick time for the same
// World, from /status), otherwise a range.
const hold = (budget: number, k: number) => Math.max(0, Math.floor((budget * 0.5 / k - base) / Math.max(1e-9, per)))
const localTick = base // the base cost is, almost entirely, the tick
if (RENDER_TICK_MS > 0) {
  const k = RENDER_TICK_MS / Math.max(1, localTick)
  console.log(`\nRender ran the same tick in ${RENDER_TICK_MS} ms against ${localTick.toFixed(0)} ms here, so its processor is about ${k.toFixed(1)}× slower for this work.`)
  console.log(`Estimate: free plan about ${hold(100, k)} players at once, Starter about ${hold(500, k)}. Memory allows about ${Math.floor((512 - first.rssMb) / Math.max(0.01, memPer))} on either (512 MB).`)
} else {
  console.log('\nEstimate for Render (players at once before it struggles), depending on how much slower its processor is than this one:')
  for (const k of [1, 2, 4]) console.log(`  if it is ${k === 1 ? 'the same speed' : `${k}× slower`}: free plan ${hold(100, k)}, Starter ${hold(500, k)}`)
  console.log(`  memory (512 MB on both plans) allows about ${Math.floor((512 - first.rssMb) / Math.max(0.01, memPer))}`)
  console.log('  For one figure instead of a range: read "tickMs" from https://moonrush-n2ft.onrender.com/status and run again with --render-tick-ms <that number>.')
}

players.forEach((p) => p.stop())
server.kill()
await sleep(300)
process.exit(0)
