// Market recorder: watches real pump.fun trading on Solana (read-only, public data) and saves it for the bots to
// learn from. It never trades, never touches a wallet, and never connects the game to real money.
//
// What it saves (bot-data/sessions/<date>.jsonl, one event per line):
//   trade    a buy or sell on a pump.fun bonding curve: coin, size in SOL, the coin's market cap, the wallet (disguised),
//            and whether the seller was the coin's own creator (a dev dump)
//   create   a new coin launch (name, ticker, creator disguised)
//   complete a coin finishing its bonding curve (graduating)
// Real wallet addresses are never written: each one is replaced by a scrambled id made with a secret kept only on
// this computer (bot-data/salt.txt), so the same wallet gets the same id in every session but can't be traced back.
//
// Setup: put your free Helius key in a file called .env in this folder:   HELIUS_API_KEY=your-key-here
// Optional: bot-data/watch.txt, one wallet per line (an address, or a link to an Axiom / GMGN / pump.fun / Solscan
// wallet page). Those wallets are followed on their own, and their trades are marked "watched".
//
//   npx tsx scripts/market-recorder.ts                 # record 30 minutes
//   npx tsx scripts/market-recorder.ts --minutes 60
//   npx tsx scripts/market-recorder.ts --public        # try Solana's free public server instead (no key; often limited)
//   npx tsx scripts/market-recorder.ts --usage         # how much of this month's free Helius allowance is used
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import WebSocket from 'ws'

const ROOT = resolve(import.meta.dirname, '..')
const DATA = join(ROOT, 'bot-data')
const args = process.argv.slice(2)
const arg = (name: string, d: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : d }
const MINUTES = arg('--minutes', 30)
const PUBLIC = args.includes('--public')
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' // pump.fun bonding-curve program
const FREE_CREDITS = 1_000_000 // Helius free plan, per month
mkdirSync(join(DATA, 'sessions'), { recursive: true })

// ---------- settings and secrets (never committed: .env and bot-data/ are in .gitignore) ----------

if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const KEY = process.env.HELIUS_API_KEY?.trim()
const saltFile = join(DATA, 'salt.txt')
if (!existsSync(saltFile)) writeFileSync(saltFile, randomBytes(32).toString('hex'))
const SALT = readFileSync(saltFile, 'utf8').trim()
const anon = (addr: string) => createHmac('sha256', SALT).update(addr).digest('hex').slice(0, 12)

const usageFile = join(DATA, 'usage.json')
const month = new Date().toISOString().slice(0, 7)
const usage: { month: string; credits: number; mb: number; sessions: number } = (() => {
  try { const u = JSON.parse(readFileSync(usageFile, 'utf8')); if (u.month === month) return u } catch {}
  return { month, credits: 0, mb: 0, sessions: 0 }
})()
if (args.includes('--usage')) {
  console.log(`${month}: about ${Math.round(usage.credits).toLocaleString()} of ${FREE_CREDITS.toLocaleString()} free Helius credits used (${usage.mb.toFixed(1)} MB over ${usage.sessions} sessions). Helius's dashboard has the exact number.`)
  process.exit(0)
}

// ---------- the wallets to follow ----------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(bytes: Uint8Array) {
  let n = 0n
  for (const b of bytes) n = n * 256n + BigInt(b)
  let s = ''
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s }
  return s
}
const ADDRESS = /[1-9A-HJ-NP-Za-km-z]{32,44}/g
const watchFile = join(DATA, 'watch.txt')
const watched = new Map<string, string>() // real address -> "watch1", "watch2"…
if (existsSync(watchFile)) {
  for (const line of readFileSync(watchFile, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue
    // A pasted link: take the address-looking part of it (wallet pages put the address in the path).
    const hit = (line.match(ADDRESS) ?? []).sort((a, b) => b.length - a.length)[0]
    if (hit && !watched.has(hit)) watched.set(hit, `watch${watched.size + 1}`)
  }
}

// ---------- reading pump.fun's events out of the transaction logs ----------

const disc = (name: string) => createHash('sha256').update(`event:${name}`).digest().subarray(0, 8).toString('hex')
const EVENTS = { [disc('TradeEvent')]: 'trade', [disc('CreateEvent')]: 'create', [disc('CompleteEvent')]: 'complete' } as const

class Reader {
  o = 8 // past the 8-byte event discriminator
  b: Buffer
  constructor(b: Buffer) {
    this.b = b
  }
  key() { const k = base58(this.b.subarray(this.o, this.o + 32)); this.o += 32; return k }
  u64() { const v = this.b.readBigUInt64LE(this.o); this.o += 8; return v }
  i64() { const v = this.b.readBigInt64LE(this.o); this.o += 8; return Number(v) }
  bool() { return this.b[this.o++] === 1 }
  str() { const n = this.b.readUInt32LE(this.o); this.o += 4; const s = this.b.subarray(this.o, this.o + n).toString('utf8'); this.o += n; return s }
}

type Row = Record<string, unknown>
function decode(b64: string, slot: number, sig: string): Row | null {
  const b = Buffer.from(b64, 'base64')
  if (b.length < 8) return null
  const kind = EVENTS[b.subarray(0, 8).toString('hex')]
  if (!kind) return null
  const r = new Reader(b)
  try {
    if (kind === 'trade') {
      // Only the leading fields, whose layout has stayed the same as pump.fun added newer ones at the end.
      const mint = r.key(), sol = r.u64(), tok = r.u64(), buy = r.bool(), user = r.key(), t = r.i64(), vsol = r.u64(), vtok = r.u64()
      r.u64(); r.u64(); r.key(); r.u64(); r.u64() // real reserves, fee recipient, fee bps, fee
      const creator = r.key()
      // Coins priced in another currency (not SOL) report zero SOL reserves: skipped, since every number here is in SOL.
      if (vsol === 0n) return { k: 'other' }
      // Price in SOL per token (SOL has 9 decimals, pump.fun tokens 6) and market cap over the fixed 1B supply.
      const price = Number(vsol) / 1e9 / (Number(vtok) / 1e6)
      return {
        k: 'trade', t, slot, sig: sig.slice(0, 16), mint, buy, sol: Number(sol) / 1e9, tok: Number(tok) / 1e6,
        mcapSol: Math.round(price * 1e9 * 100) / 100, curveSol: Math.round(Number(vsol) / 1e7) / 100,
        w: anon(user), dev: user === creator, creator: anon(creator), ...(watched.has(user) ? { watched: watched.get(user) } : {}),
      }
    }
    if (kind === 'create') {
      const name = r.str(), symbol = r.str(); r.str() // uri
      const mint = r.key(); r.key() // bonding curve
      const user = r.key(), creator = r.key(), t = r.i64()
      return { k: 'create', t, slot, mint, name: name.slice(0, 40), symbol: symbol.slice(0, 16), creator: anon(creator || user) }
    }
    const user = r.key(), mint = r.key(); r.key()
    const t = r.i64()
    return { k: 'complete', t, slot, mint, w: anon(user) }
  } catch {
    return null // a layout we don't know (a pump.fun update): skip it rather than save garbage
  }
}

// ---------- recording ----------

const url = PUBLIC ? 'wss://api.mainnet-beta.solana.com' : `wss://mainnet.helius-rpc.com/?api-key=${KEY}`
if (!PUBLIC && !KEY) {
  console.error('No Helius key found. Make a file called .env in this folder containing:\n  HELIUS_API_KEY=your-key-here\n(or try --public to use Solana\'s free public server).')
  process.exit(1)
}
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const outFile = join(DATA, 'sessions', `${stamp}.jsonl`)
const stats = { other: 0, trade: 0, create: 0, complete: 0, devSells: 0, watched: 0, bytes: 0, connections: 0, truncated: 0 }
const end = Date.now() + MINUTES * 60_000
let buffer: string[] = []
const flush = () => { if (buffer.length) { appendFileSync(outFile, buffer.join('\n') + '\n'); buffer = [] } }

function connect() {
  if (Date.now() >= end) return finish()
  stats.connections++
  const ws = new WebSocket(url)
  let id = 1
  ws.on('open', () => {
    const sub = (address: string) => ws.send(JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'logsSubscribe', params: [{ mentions: [address] }, { commitment: 'confirmed' }] }))
    sub(PUMP)
    for (const a of watched.keys()) sub(a)
    console.log(`Connected to ${PUBLIC ? 'the public Solana server' : 'Helius'}: following pump.fun${watched.size ? ` and ${watched.size} watched wallet(s)` : ''}. Recording until ${new Date(end).toLocaleTimeString()}…`)
  })
  const seen = new Set<string>() // a watched wallet's pump.fun trade arrives on two subscriptions
  ws.on('message', (data: Buffer) => {
    stats.bytes += data.length
    let m: any
    try { m = JSON.parse(String(data)) } catch { return }
    if (m.error) console.error('Server said:', m.error.message ?? m.error)
    const v = m.params?.result?.value
    if (!v || v.err || !Array.isArray(v.logs)) return
    if (seen.has(v.signature)) return
    seen.add(v.signature)
    if (seen.size > 20000) seen.clear()
    if (v.logs.some((l: string) => /Log truncated/.test(l))) stats.truncated++
    for (const line of v.logs as string[]) {
      if (!line.startsWith('Program data: ')) continue
      const row = decode(line.slice(14), m.params.result.context?.slot ?? 0, v.signature)
      if (!row) continue
      stats[row.k as 'trade' | 'create' | 'complete' | 'other']++
      if (row.k === 'other') continue
      if (row.dev && row.buy === false) stats.devSells++
      if (row.watched) stats.watched++
      buffer.push(JSON.stringify(row))
    }
    if (buffer.length > 200) flush()
  })
  const timer = setTimeout(() => ws.close(), Math.max(0, end - Date.now()))
  ws.on('close', () => { clearTimeout(timer); flush(); if (Date.now() < end) setTimeout(connect, 3000); else finish() })
  ws.on('error', (e) => console.error('Connection problem:', e.message))
}

const progress = setInterval(() => {
  const mins = (Date.now() - (end - MINUTES * 60_000)) / 60_000
  console.log(`  ${mins.toFixed(0)} min: ${stats.trade.toLocaleString()} trades (${stats.devSells} dev sells), ${stats.create} launches, ${stats.complete} graduations${watched.size ? `, ${stats.watched} by watched wallets` : ''} · ${(stats.bytes / 1e6).toFixed(1)} MB`)
}, 60_000)

let finished = false
function finish() {
  if (finished) return
  finished = true
  clearInterval(progress)
  flush()
  const mb = stats.bytes / 1e6
  // Helius meters streaming at 2 credits per 0.1 MB, plus 1 per connection (helius.dev/docs/faqs/websockets).
  const credits = PUBLIC ? 0 : mb * 20 + stats.connections
  if (!PUBLIC) {
    usage.credits += credits
    usage.mb += mb
    usage.sessions++
    writeFileSync(usageFile, JSON.stringify(usage))
  }
  console.log(`\nSaved ${stats.trade.toLocaleString()} trades, ${stats.create} launches and ${stats.complete} graduations to ${outFile}`)
  console.log(`  dev sells: ${stats.devSells} · watched-wallet trades: ${stats.watched} · data: ${mb.toFixed(1)} MB${stats.truncated ? ` · ${stats.truncated} transactions too long to read` : ''}${stats.other ? ` · ${stats.other} non-SOL coin trades skipped` : ''}`)
  if (!PUBLIC) console.log(`  about ${Math.round(credits).toLocaleString()} Helius credits this session; this month so far about ${Math.round(usage.credits).toLocaleString()} of ${FREE_CREDITS.toLocaleString()} free`)
  process.exit(0)
}

process.on('SIGINT', finish)
connect()
