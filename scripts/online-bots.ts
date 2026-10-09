// Online bots: two players in two separate hidden Chrome windows make a friends room on a room server running on
// this computer, then play together: trade, cook, send each other money, chat, and click around. All the time the
// bots check that each screen agrees with the server about its wallet, and that both players see the same market.
// Nothing touches the live game.
//
//   npx tsx scripts/online-bots.ts               # default: 150 explorer clicks per player
//   npx tsx scripts/online-bots.ts --clicks 600  # longer
//   npx tsx scripts/online-bots.ts --show        # watch both windows
//   npx tsx scripts/online-bots.ts --selftest    # plant a wallet mismatch to prove the checks notice
//
// Needs ports 8787 (the room server; the game's dev proxy points there) and 5197 free.
// Report: bot-reports/<date>-online/report.pdf (people) and report.json (Claude).
import { chromium, type Browser, type Page } from 'playwright-core'
import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const arg = (name: string, d: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : d }
const CLICKS = arg('--clicks', 150)
const SHOW = args.includes('--show')
const SELFTEST = args.includes('--selftest') // plant a screen/server mismatch to prove the checks see it
const SEED = arg('--seed', Math.floor(Math.random() * 1e9))
const ROOT = resolve(import.meta.dirname, '..')
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const OUT = join(ROOT, 'bot-reports', `${STAMP}-online`)
const SHOTS = join(OUT, 'screenshots')
mkdirSync(SHOTS, { recursive: true })
const GAME_PORT = 5197
const URL = `http://localhost:${GAME_PORT}/`
const AVOID = /reset|delete|wipe|erase|start over|sign in|sign out|log ?in|log ?out|upload|download|leave|create room|join|admin|ban|mute|report|clear (all|data|save)|back to solo|bankrupt|start over/i

// ---------- what gets recorded ----------

type Severity = 'high' | 'medium' | 'low'
interface Problem { id: string; severity: Severity; title: string; what: string; who: string; steps: string[]; tech: string; times: number; screenshot?: string }
interface Check { name: string; plain: string; ok: boolean; note?: string }
const problems: Problem[] = []
const checks: Check[] = []
const trail: string[] = []
const act = (who: string, s: string) => { trail.push(`${who}: ${s}`); if (trail.length > 14) trail.shift(); if (SHOW) console.log(`  · ${who}: ${s}`) }

function addProblem(p: Omit<Problem, 'id' | 'times' | 'steps'> & { steps?: string[] }) {
  const key = p.title + '|' + p.tech.split('\n')[0]
  const old = problems.find((x) => x.title + '|' + x.tech.split('\n')[0] === key)
  if (old) { old.times++; return old }
  const np: Problem = { ...p, id: `O${problems.length + 1}`, times: 1, steps: p.steps ?? [...trail] }
  problems.push(np)
  return np
}

// ---------- the room server and the game ----------

const portFree = (port: number) => new Promise<boolean>((ok) => { const s = createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true))).listen(port) })
let serverLog = ''
let serverDied: string | null = null
function startServer(): Promise<ChildProcess> {
  const srv = spawn(process.execPath, [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], { cwd: ROOT, env: { ...process.env, PORT: '8787', SUPABASE_SECRET_KEY: '' } })
  srv.stdout!.on('data', (d) => (serverLog += d))
  srv.stderr!.on('data', (d) => (serverLog += d))
  srv.on('exit', (code) => { if (code !== null && code !== 0) serverDied = `exited with code ${code}` })
  return new Promise((ok, fail) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (serverLog.includes('8787')) { clearInterval(iv); ok(srv) }
      else if (serverDied || Date.now() - t0 > 60_000) { clearInterval(iv); fail(new Error(`room server did not start: ${serverDied ?? 'timeout'}\n${serverLog.slice(-800)}`)) }
    }, 100)
  })
}
async function startGame(): Promise<ChildProcess> {
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(GAME_PORT), '--strictPort'], { cwd: ROOT })
  await new Promise<void>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('the game did not start within 60 seconds')), 60_000)
    vite.stdout!.on('data', (d) => { if (String(d).includes(String(GAME_PORT))) { clearTimeout(t); ok() } })
  })
  return vite
}
function findBrowser() {
  const hit = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
  if (!hit) throw new Error('No Chrome or Edge found. Install Chrome, or set CHROME_PATH.')
  return hit
}

// ---------- looking inside each player's game ----------

interface Player { name: string; page: Page }
const shot = async (p: Player, name: string) => { const f = join(SHOTS, `${p.name}-${name}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() + '.jpg'); await p.page.screenshot({ path: f, type: 'jpeg', quality: 60 }).catch(() => {}); return f }
const game = <T>(p: Player, fn: string) => p.page.evaluate(`(() => { const s = window.__game.getState(); return (${fn})(s) })()`) as Promise<T>

function watch(p: Player) {
  p.page.on('pageerror', async (e) => {
    const pr = addProblem({ severity: 'high', title: `${p.name}'s game crashed: ${e.message.slice(0, 70)}`, what: 'The game hit an error while playing online. The player may see a frozen or blank screen.', who: p.name, tech: (e.stack ?? e.message).split('\n').slice(0, 8).join('\n') })
    if (!pr.screenshot) pr.screenshot = await shot(p, `crash-${pr.id}`)
  })
  p.page.on('console', (m) => {
    const t = m.text()
    if (/\[wallet\] change not run on the server/.test(t)) addProblem({ severity: 'high', title: 'A wallet change skipped the server', what: 'The game changed a wallet in a room without the server running the same change, so the player sees money the server does not agree with.', who: p.name, tech: t.slice(0, 1500) })
    else if (m.type() === 'error' && !/favicon|Failed to load resource|supabase/i.test(t)) addProblem({ severity: 'medium', title: `Error message in ${p.name}'s game: ${t.slice(0, 70)}`, what: 'The game logged an error while playing online.', who: p.name, tech: t.slice(0, 1500) })
  })
}

// The screen's wallet vs the server's last word on it. They must match once the game has caught up.
async function walletsAgree(p: Player, where: string) {
  for (let i = 0; i < 12; i++) {
    const r = await p.page.evaluate(() => {
      const w = (window as any).__srvWallet, s = (window as any).__game.getState()
      if (!w?.state) return { ready: false }
      const mine = s.portfolio, srv = w.state
      const diffs: string[] = []
      const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 2e-5)
      if (!close(mine.cash, srv.cash)) diffs.push(`cash: screen ${mine.cash} vs server ${srv.cash}`)
      const byId = new Map<string, any>((mine.accounts ?? []).map((a: any) => [a.id, a]))
      for (const a of srv.accounts ?? []) {
        const m = byId.get(a.id)
        if (!m) { diffs.push(`wallet ${a.id} missing on screen`); continue }
        for (const [c, n] of Object.entries<number>(a.balances)) if (!close(m.balances[c] ?? 0, n)) diffs.push(`${a.id} ${c}: screen ${m.balances[c]} vs server ${n}`)
        for (const [id, pos] of Object.entries<any>(a.positions)) if (!close(m.positions[id]?.qty ?? 0, pos.qty)) diffs.push(`${a.id} holds ${id}: screen ${m.positions[id]?.qty ?? 0} vs server ${pos.qty}`)
        for (const [id, pos] of Object.entries<any>(m.positions)) if (pos.qty > 0 && !a.positions[id]) diffs.push(`${a.id} holds ${id} on screen (${pos.qty}) but not on the server`)
      }
      return { ready: true, diffs }
    })
    if (r.ready && !r.diffs!.length) return true
    if (i === 11) {
      const pr = addProblem({ severity: 'high', title: `${p.name}'s screen and the server disagree about their wallet`, what: `After ${where}, the money ${p.name} sees is not what the server holds, and it did not catch up within 6 seconds. The player would trade on numbers that aren't real.`, who: p.name, tech: r.ready ? r.diffs!.slice(0, 10).join('\n') : 'the server never sent a wallet answer' })
      if (!pr.screenshot) pr.screenshot = await shot(p, `desync-${pr.id}`)
      return false
    }
    await p.page.waitForTimeout(500)
  }
  return false
}

// Both players must see the same market: same coins at the same prices on the same tick.
async function marketsAgree(a: Player, b: Player, where: string) {
  for (let i = 0; i < 20; i++) {
    const read = (p: Player) => game<{ tick: number; prices: Record<string, number> }>(p, `(s) => ({ tick: s.market.tick, prices: Object.fromEntries(s.market.tokens.map((t) => [t.id, t.price])) })`)
    const [x, y] = await Promise.all([read(a), read(b)])
    if (x.tick !== y.tick) { await a.page.waitForTimeout(150); continue }
    const diffs: string[] = []
    for (const [id, px] of Object.entries(x.prices)) {
      if (!(id in y.prices)) diffs.push(`${id} on ${a.name}'s screen only`)
      else if (Math.abs(px - y.prices[id]) > Math.abs(px) * 1e-4) diffs.push(`${id}: ${a.name} ${px} vs ${b.name} ${y.prices[id]}`)
    }
    for (const id of Object.keys(y.prices)) if (!(id in x.prices)) diffs.push(`${id} on ${b.name}'s screen only`)
    if (!diffs.length) return true
    if (i >= 6) {
      addProblem({ severity: 'medium', title: 'The two players see a different market', what: `After ${where}, on the same tick, the two players' screens show different coins or prices.`, who: 'both', tech: `tick ${x.tick}\n` + diffs.slice(0, 10).join('\n') })
      return false
    }
    await a.page.waitForTimeout(400)
  }
  return true
}

async function step(name: string, plain: string, fn: () => Promise<string | void>) {
  act('bot', `Start: ${name}`)
  try {
    const note = await fn()
    checks.push({ name, plain, ok: true, note: note || undefined })
  } catch (e: any) {
    const msg = String(e?.message ?? e).split('\n')[0].slice(0, 300)
    checks.push({ name, plain, ok: false, note: msg })
    addProblem({ severity: 'medium', title: `${name} didn't work`, what: `${plain} This did not work: ${msg}`, who: 'bot', tech: String(e?.stack ?? e).slice(0, 1500) })
  }
  if (serverDied) throw new Error(`The room server stopped (${serverDied})`)
}

const tradePanel = (page: Page) => page.locator('aside').filter({ has: page.locator('button', { hasText: /^(BUY|SELL) / }) }).first()
async function openCoin(p: Player, id: string) {
  act(p.name, 'Open the coin\'s chart')
  await p.page.evaluate((cid) => { const g = (window as any).__game.getState(); g.setModal(null); g.select(cid, true) }, id)
  await p.page.waitForTimeout(800)
}
async function buyUi(p: Player) {
  act(p.name, 'Click Buy, pick the second amount, press BUY')
  await tradePanel(p.page).locator('button', { hasText: /^Buy/ }).first().click().catch(() => {})
  await tradePanel(p.page).locator('button').filter({ hasText: /^(0\.\d+|1|\$?\d+)$/ }).nth(1).click()
  await tradePanel(p.page).locator('button', { hasText: /^BUY / }).first().click()
  await p.page.waitForTimeout(1200)
}
async function sellAllUi(p: Player) {
  act(p.name, 'Click Sell, 100%, press SELL')
  await tradePanel(p.page).locator('button', { hasText: /^Sell/ }).first().click()
  await p.page.waitForTimeout(300)
  await tradePanel(p.page).locator('button', { hasText: /^(100%|MAX)$/ }).first().click()
  await tradePanel(p.page).locator('button', { hasText: /^SELL / }).first().click()
  await p.page.waitForTimeout(1200)
}
const held = (p: Player, id: string) => game<number>(p, `(s) => Object.values(s.portfolio.accounts ?? []).reduce((a, w) => a + (w.positions['${id}']?.qty ?? 0), 0)`)

// ---------- the session ----------

async function session(browser: Browser) {
  const mk = async (name: string): Promise<Player> => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // tsx names inline functions with a __name helper the page doesn't have; give it a do-nothing one.
    await ctx.addInitScript({ content: 'window.__name = (f) => f' })
    // (The one-time "new here?" tutorial offer would sit over buttons these players press: they have seen it.)
    await ctx.addInitScript({ content: "try { localStorage.setItem('moonrush:v1:tutOffered', 'true') } catch {}" })
    const page = await ctx.newPage()
    page.setDefaultTimeout(10_000)
    const p = { name, page }
    watch(p)
    return p
  }
  const alice = await mk('Alice'), bob = await mk('Bob')

  await step('Both players open the game', 'Two separate browsers load the game and show the "Pick your arena" screen.', async () => {
    for (const p of [alice, bob]) { act(p.name, 'Open the game'); await p.page.goto(URL); await p.page.getByText('Pick your arena').waitFor({ timeout: 30_000 }); await p.page.evaluate(() => (window as any).__flags.setState({ labsDev: true })) } // (pages hidden from players for now are switched on for the test: see the labs and cooking switches)
  })

  let code = ''
  await step('Alice creates a room', 'Alice clicks "Play with friends", types her name and creates a room. She should get a 5-letter room code.', async () => {
    act('Alice', 'Click "Play with friends"'); await alice.page.getByRole('button', { name: /Play with friends/ }).click()
    act('Alice', 'Type her name'); await alice.page.getByLabel('Your name').fill('BotAlice')
    act('Alice', 'Click "Create room"'); await alice.page.getByRole('button', { name: 'Create room' }).click()
    await alice.page.waitForFunction(() => !!(window as any).__game.getState().online?.code, null, { timeout: 15_000 })
    code = await game<string>(alice, '(s) => s.online.code')
    await shot(alice, 'room-created')
    return `room ${code}`
  })

  await step('Bob joins with the code', 'Bob clicks "Play with friends", types the code and joins. Both should see two players in the room.', async () => {
    act('Bob', 'Click "Play with friends"'); await bob.page.getByRole('button', { name: /Play with friends/ }).click()
    act('Bob', 'Type his name'); await bob.page.getByLabel('Your name').fill('BotBob')
    act('Bob', `Type the code ${code}`); await bob.page.getByLabel('Room code').fill(code)
    act('Bob', 'Click "Join"'); await bob.page.getByRole('button', { name: 'Join', exact: true }).click()
    for (const p of [alice, bob]) await p.page.waitForFunction(() => ((window as any).__game.getState().online?.players ?? []).length >= 2, null, { timeout: 15_000 })
  })

  await step('Alice starts the round for everyone', 'The host presses Start; both players should be in a running round with the same market.', async () => {
    act('Alice', 'Click "Start … for everyone"'); await alice.page.getByRole('button', { name: /Start .* for everyone/ }).click()
    for (const p of [alice, bob]) {
      await p.page.waitForFunction(() => (window as any).__game.getState().runStatus === 'running', null, { timeout: 15_000 })
      await p.page.evaluate(() => (window as any).__game.getState().setModal(null))
    }
    await alice.page.waitForTimeout(2500)
    await marketsAgree(alice, bob, 'the round started')
    await shot(alice, 'round-started')
  })

  let coin = ''
  await step('Alice buys, the server agrees', 'Alice buys a coin with the trade panel. Her screen and the server must agree on her wallet afterwards, and Bob must see her trade on the coin\'s tape.', async () => {
    coin = await game<string>(alice, `(s) => (s.market.tokens.find((t) => (t.status === 'bonding' || t.status === 'graduated') && t.liquidity > 20000) ?? s.market.tokens[0]).id`)
    await openCoin(alice, coin)
    await buyUi(alice)
    if (!((await held(alice, coin)) > 0)) throw new Error('pressed BUY but Alice holds none of the coin')
    await walletsAgree(alice, 'a buy')
    await bob.page.waitForTimeout(2000)
    const seen = await game<boolean>(bob, `(s) => (s.market.tokens.find((t) => t.id === '${coin}')?.tape ?? []).some((x) => x.side === 'buy' && x.pid && x.pid !== s.online?.you)`)
    if (!seen) addProblem({ severity: 'low', title: 'Bob did not see Alice\'s buy on the coin\'s trades', what: 'A player\'s buy should show on the other players\' trade list for that coin.', who: 'Bob', tech: `coin ${coin}: no buy with another player's pid in Bob's tape` })
  })

  await step('Bob buys the same coin', 'Bob buys the coin Alice bought. Both wallets must match the server, and both players must still see the same price.', async () => {
    await openCoin(bob, coin)
    await buyUi(bob)
    if (!((await held(bob, coin)) > 0)) throw new Error('pressed BUY but Bob holds none of the coin')
    await walletsAgree(bob, 'a buy')
    await marketsAgree(alice, bob, 'both bought the same coin')
  })

  await step('Both sell', 'Both players sell 100%. Their bags must be empty on the screen and on the server.', async () => {
    for (const p of [alice, bob]) {
      await sellAllUi(p)
      if ((await held(p, coin)) > 1e-6) throw new Error(`${p.name} still holds the coin after selling 100%`)
      await walletsAgree(p, 'a sell')
    }
  })

  let cooked = ''
  await step('Alice cooks a coin, Bob sees it', 'Alice launches a coin on the Cooking page. It must appear on Bob\'s market with Alice as the creator, at the same price, and Alice\'s dev bag must match the server.', async () => {
    await alice.page.evaluate(() => (window as any).__game.getState().setView('cooking'))
    await alice.page.waitForTimeout(700)
    const cookBtn = alice.page.locator('main button', { hasText: /^🍳 COOK/ }).first()
    for (let i = 0; i < 6 && !(await cookBtn.isVisible().catch(() => false)); i++) { act('Alice', 'Click "Randomize" (name taken)'); await alice.page.getByRole('button', { name: 'Randomize' }).first().click(); await alice.page.waitForTimeout(250) }
    const ticker = (await cookBtn.innerText()).replace(/^🍳 COOK \$?/, '').trim()
    act('Alice', `Click "COOK $${ticker}"`); await cookBtn.click()
    await alice.page.waitForTimeout(3000)
    cooked = await game<string>(alice, `(s) => s.market.tokens.find((t) => t.ticker === '${ticker}' && t.creator === 'you')?.id ?? ''`)
    if (!cooked) throw new Error(`no coin $${ticker} of Alice's on her own market`)
    await bob.page.waitForFunction((id) => (window as any).__game.getState().market.tokens.some((t: any) => t.id === id), cooked, { timeout: 10_000 }).catch(() => { throw new Error(`$${ticker} never appeared on Bob's market`) })
    const by = await game<string>(bob, `(s) => s.market.tokens.find((t) => t.id === '${cooked}')?.creatorName ?? ''`)
    if (!/Alice/.test(by)) addProblem({ severity: 'low', title: 'A cooked coin shows the wrong creator to other players', what: 'Bob sees Alice\'s new coin without her name as the creator.', who: 'Bob', tech: `creatorName on Bob's screen: "${by}"` })
    await walletsAgree(alice, 'cooking a coin with a dev buy')
    await marketsAgree(alice, bob, 'Alice cooked a coin')
    await shot(bob, 'sees-cooked-coin')
    return `$${ticker}`
  })

  await step('Alice sends Bob money', 'Alice sends Bob $500 from her main wallet. Her cash must drop, Bob\'s must rise by the same amount, and both must match the server.', async () => {
    const bobCash0 = await game<number>(bob, '(s) => s.portfolio.cash')
    const aliceCash0 = await game<number>(alice, '(s) => s.portfolio.cash')
    act('Alice', 'Send Bob $500')
    const r = await alice.page.evaluate(async () => {
      const s = (window as any).__game.getState()
      const to = s.online.players.find((p: any) => p.id !== s.online.you)?.id
      const { sendFunds } = await import('/src/net/client.ts' as string)
      return sendFunds({ to, asset: 'usdc', amount: 500, fromWallet: s.portfolio.accounts[0].id })
    })
    await bob.page.waitForTimeout(2500)
    const bobCash1 = await game<number>(bob, '(s) => s.portfolio.cash')
    const aliceCash1 = await game<number>(alice, '(s) => s.portfolio.cash')
    if (Math.abs(aliceCash0 - aliceCash1 - 500) > 1) throw new Error(`Alice's cash changed by ${(aliceCash1 - aliceCash0).toFixed(2)}, expected −500 (send result: ${JSON.stringify(r).slice(0, 200)})`)
    if (bobCash1 - bobCash0 < 499 || bobCash1 - bobCash0 > 500.01) throw new Error(`Bob's cash changed by ${(bobCash1 - bobCash0).toFixed(2)}, expected +500`)
    await walletsAgree(alice, 'sending money'); await walletsAgree(bob, 'receiving money')
  })

  await step('Chat', 'Alice writes in the room chat; Bob should see the message.', async () => {
    act('Alice', 'Open the room window'); await alice.page.evaluate(() => (window as any).__game.getState().setModal('lobby'))
    act('Alice', 'Type a chat message and press Enter')
    await alice.page.getByLabel('Chat message').fill('gm from the bots')
    await alice.page.getByLabel('Chat message').press('Enter')
    await bob.page.waitForFunction(() => ((window as any).__game.getState().online?.chat ?? []).some((c: any) => /gm from the bots/.test(c.text)), null, { timeout: 8000 }).catch(() => { throw new Error('Bob never got the message') })
    await alice.page.evaluate(() => (window as any).__game.getState().setModal(null))
  })

  if (SELFTEST) {
    act('Alice', 'SELF-TEST: give her screen $1,000 the server does not know about')
    await alice.page.evaluate(() => { const g = (window as any).__game; g.setState({ portfolio: { ...g.getState().portfolio, cash: g.getState().portfolio.cash + 1000 } }) })
    await walletsAgree(alice, 'the self-test')
  }

  // Both explore at once: random clicks, with wallet and market checks every 15 clicks.
  await step('Both players explore', `Each player clicks around on their own ${CLICKS} times at the same time. Every 15 clicks, each screen is checked against the server and against the other player.`, async () => {
    let r = SEED >>> 0
    const rand = () => { r = (r + 0x6d2b79f5) >>> 0; let t = r; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const explore = async (p: Player) => {
      for (let i = 0; i < CLICKS; i++) {
        const cands = await p.page.evaluate((avoid) => {
          const re = new RegExp(avoid, 'i')
          return [...document.querySelectorAll<HTMLElement>('button, [role="tab"], [class*="cursor-pointer"]')].map((el) => {
            const b = el.getBoundingClientRect()
            const label = (el.getAttribute('aria-label') || el.title || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 50)
            const hit = b.width > 2 && b.height > 2 && b.top >= 0 && b.top < innerHeight && b.left < innerWidth ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null
            return { label, x: b.left + b.width / 2, y: b.top + b.height / 2, ok: !!hit && (hit === el || el.contains(hit)) && !re.test(label) && !(el as HTMLButtonElement).disabled }
          }).filter((c) => c.ok && c.label)
        }, AVOID.source).catch(() => [])
        if (!cands.length) { await p.page.keyboard.press('Escape'); continue }
        const c = cands[Math.floor(rand() * cands.length)]
        act(p.name, `Click "${c.label}"`)
        await p.page.mouse.click(c.x, c.y).catch(() => {})
        await p.page.waitForTimeout(200)
        if (rand() < 0.08) await p.page.keyboard.press('Escape')
        for (const extra of p.page.context().pages()) if (extra !== p.page) await extra.close().catch(() => {})
        if (i % 15 === 14) { await p.page.waitForTimeout(1500); await walletsAgree(p, `${i + 1} random clicks`) }
        if (serverDied) return
      }
    }
    await Promise.all([explore(alice), explore(bob)])
    await marketsAgree(alice, bob, 'both explored')
  })

  // The server's own log: errors it caught (with the crash fix) or a crash.
  const caught = serverLog.split('\n').filter((l) => /failed:|Error|TypeError/.test(l)).slice(0, 10)
  if (caught.length) addProblem({ severity: 'high', title: 'The room server hit errors while the bots played', what: 'The server logged errors handling the players\' messages during normal play. Without the crash fix each of these would have stopped the server.', who: 'server', tech: caught.join('\n') })
}

// ---------- report ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const img = (f?: string) => (f && existsSync(f) ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : '')
function reportHtml(meta: { commit: string; branch: string; seconds: number }) {
  const order: Severity[] = ['high', 'medium', 'low']
  const sorted = [...problems].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const sevWord = { high: 'Serious', medium: 'Should fix', low: 'Minor' }
  const passed = checks.filter((c) => c.ok).length
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font: 11pt/1.45 'Segoe UI', system-ui, sans-serif; color: #1b1f24; }
  h1 { font-size: 22pt; margin: 0 0 2px } h2 { font-size: 14pt; margin: 22px 0 8px; border-bottom: 1.5px solid #1b1f24; padding-bottom: 3px }
  .sub { color: #5b6470; font-size: 9.5pt } .big { font-size: 13pt; font-weight: 600; margin: 14px 0 4px }
  .box { border: 1px solid #d5d9de; border-radius: 6px; padding: 10px 12px; margin: 10px 0; break-inside: avoid }
  .tag { display: inline-block; font-size: 8.5pt; font-weight: 700; padding: 1px 7px; border-radius: 10px; margin-right: 6px }
  .high { background: #fde2e1; color: #a1170f } .medium { background: #fff1d6; color: #8a5300 } .low { background: #e6eef7; color: #23507d }
  .pass { color: #1c7a35; font-weight: 700 } .fail { color: #a1170f; font-weight: 700 }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt } td, th { border-bottom: 1px solid #e3e6ea; padding: 4px 6px; text-align: left; vertical-align: top } th { background: #f3f5f7 }
  ol { margin: 4px 0 4px 18px; padding: 0 } pre { background: #f3f5f7; border-radius: 4px; padding: 7px 9px; font: 8pt/1.35 Consolas, monospace; white-space: pre-wrap; word-break: break-word }
  .claude { font-size: 8.5pt; color: #5b6470; margin-top: 8px; font-weight: 600 } img { max-width: 100%; max-height: 3.2in; border: 1px solid #d5d9de; border-radius: 4px; margin-top: 8px }
  </style></head><body>
  <h1>MOONRUSH online bots report</h1>
  <div class="sub">${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · branch <b>${esc(meta.branch)}</b> · commit ${esc(meta.commit)} · took ${Math.max(1, Math.round(meta.seconds / 60))} min · seed ${SEED}</div>
  <h2>The short version</h2>
  <div class="big">${problems.length ? `${problems.length} problem${problems.length > 1 ? 's' : ''} found.` : 'No problems found.'} ${passed} of ${checks.length} checks passed.</div>
  <p>Two bot players, <b>Alice</b> and <b>Bob</b>, each in their own hidden Chrome window, played together in a friends room on a room server running on this computer (not the live game). They traded, cooked a coin, sent each other money, chatted, and then both clicked around on their own at the same time. Throughout, the bots checked that <b>each screen matched the server</b> about the player's money, and that <b>both players saw the same market</b>.</p>
  <h2>Problems found</h2>
  ${sorted.length ? sorted.map((p) => `<div class="box"><div><span class="tag ${p.severity}">${sevWord[p.severity]}</span><b>${p.id}. ${esc(p.title)}</b></div>
    <p style="margin:6px 0 4px">${esc(p.what)}</p><div class="sub">Who: ${esc(p.who)} · seen ${p.times} time${p.times > 1 ? 's' : ''}</div>
    ${p.steps.length ? `<div style="margin-top:6px"><b>What happened just before</b><ol>${p.steps.slice(-8).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${img(p.screenshot) ? `<img src="${img(p.screenshot)}">` : ''}<div class="claude">FOR CLAUDE: technical details</div><pre>${esc(p.tech)}</pre></div>`).join('') : '<p>Nothing broke. 🎉</p>'}
  <h2>What the bots checked</h2>
  <table><tr><th style="width:24%">Check</th><th>What it tests</th><th style="width:9%">Result</th><th style="width:24%">Note</th></tr>
  ${checks.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.plain)}</td><td class="${c.ok ? 'pass' : 'fail'}">${c.ok ? 'PASS' : 'FAIL'}</td><td>${esc(c.note ?? '')}</td></tr>`).join('')}</table>
  <h2>What was NOT tested</h2><p>The World (it needs sign-in), more than two players, players dropping and reconnecting, and the live website.</p>
  <h2>For Claude</h2><pre>Full data: bot-reports/${STAMP}-online/report.json   Screenshots: bot-reports/${STAMP}-online/screenshots/
Re-run: npx tsx scripts/online-bots.ts --clicks ${CLICKS} --seed ${SEED}
Wallet checks compare useGame portfolio with window.__srvWallet.state (the server's last wallet answer) after waiting up to 6s.
Bot source: scripts/online-bots.ts. Fix on a new branch per problem and open a PR; never push to main (see CLAUDE.md).</pre></body></html>`
}

async function main() {
  const t0 = Date.now()
  const git = (c: string) => { try { return execSync(c, { cwd: ROOT }).toString().trim() } catch { return '?' } }
  for (const port of [8787, GAME_PORT]) if (!(await portFree(port))) { console.error(`Port ${port} is busy. Close the other game or room server first.`); process.exit(1) }
  console.log('Starting the room server and the game…')
  const srv = await startServer()
  const vite = await startGame()
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: !SHOW })
  try { await session(browser) } catch (e: any) {
    addProblem({ severity: 'high', title: serverDied ? 'The room server stopped during the session' : 'The bots could not finish', what: serverDied ? 'The room server process ended while the bots were playing. On the live game this would disconnect everyone.' : 'The online session stopped early, so this report is incomplete.', who: 'bot', tech: `${String(e?.message ?? e)}\n--- server log ---\n${serverLog.slice(-1500)}` })
  }
  const seconds = (Date.now() - t0) / 1000
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), commit: git('git rev-parse --short HEAD'), branch: git('git rev-parse --abbrev-ref HEAD'), seed: SEED, clicks: CLICKS, checks, problems, serverLog: serverLog.slice(-5000) }, null, 1))
  const page = await browser.newPage()
  await page.setContent(reportHtml({ commit: git('git rev-parse --short HEAD'), branch: git('git rev-parse --abbrev-ref HEAD'), seconds }), { waitUntil: 'load' })
  const pdf = join(OUT, 'report.pdf')
  await page.pdf({ path: pdf, format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;color:#888;width:100%;text-align:center">MOONRUSH online bots · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>', margin: { top: '0.6in', bottom: '0.7in', left: '0.6in', right: '0.6in' } })
  await browser.close(); vite.kill(); srv.kill()
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed, ${problems.length} problem(s) found.`)
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.note ? ` (${c.note})` : ''}`)
  for (const p of problems) console.log(`${p.severity.toUpperCase().padEnd(6)} ${p.title}`)
  console.log(`\nReport: ${pdf}`)
  process.exit(0)
}

main()
