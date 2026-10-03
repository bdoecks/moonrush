// UI tester bots: play the real game in a hidden Chrome window, the way a person would, and write down everything
// that breaks. Two kinds of bot run back to back:
//   1. The checklist bot walks a fixed route through every page and feature (open each tab, buy, sell, cook, the
//      chart, the dock, the menus, the phone layout) and checks the result of each step.
//   2. The explorer bot clicks around on its own. It keeps a memory file between runs and goes for the buttons it
//      has tried least, plus the ones that broke before, so every run covers ground the earlier runs missed.
// Everything they find goes into bot-reports/<date>/report.pdf (for people) and report.json (for Claude).
//
//   npx tsx scripts/ui-bots.ts                 # both bots, 300 explorer clicks
//   npx tsx scripts/ui-bots.ts --clicks 1000   # a longer explore
//   npx tsx scripts/ui-bots.ts --seed 42       # replay an explorer run exactly
//   npx tsx scripts/ui-bots.ts --show          # watch the bots play in a visible window
//   npx tsx scripts/ui-bots.ts --selftest      # break the game on purpose to prove the bots notice
//
// Solo play only: rooms, the World, sign-in and the admin panel need the server and an account, so they are listed
// in the report as not tested. Uses your installed Chrome or Edge (set CHROME_PATH to pick another).
import { chromium, type Browser, type Page } from 'playwright-core'
import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ---------- settings ----------

const args = process.argv.slice(2)
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const CLICKS = Number(arg('--clicks') ?? 300)
const SEED = Number(arg('--seed') ?? Math.floor(Math.random() * 1e9))
const SHOW = args.includes('--show')
const SELFTEST = args.includes('--selftest')
const PORT = 5199
const URL = `http://localhost:${PORT}/`
const ROOT = resolve(import.meta.dirname, '..')
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const OUT = join(ROOT, 'bot-reports', STAMP)
const SHOTS = join(OUT, 'screenshots')
const MEMORY_FILE = join(ROOT, 'bot-reports', 'explorer-memory.json')
mkdirSync(SHOTS, { recursive: true })

const NAV = [
  { id: 'discover', label: 'Discover', key: 'd' },
  { id: 'trenches', label: 'Trenches', key: 't' },
  { id: 'cooking', label: '🍳 Cooking', key: 'c' },
  { id: 'copytrade', label: 'CopyTrade', key: 'y' },
  { id: 'sniper', label: '🎯 Sniper', key: 'n' },
  { id: 'monitor', label: 'Monitor', key: 'o' },
  { id: 'track', label: 'Track', key: 'k' },
  { id: 'portfolio', label: 'Portfolio', key: 'p' },
  { id: 'rewards', label: 'Rewards', key: 'r' },
  { id: 'missions', label: 'Missions', key: 'm' },
  { id: 'leaderboard', label: 'Leaderboard', key: 'l' },
]

// The explorer never presses these: they wipe progress, leave the game, or open the account / room flows that need
// a server. Matched against the button's visible text, aria-label and title.
const AVOID = /reset|delete|wipe|erase|start over|sign in|sign out|log ?in|log ?out|upload|download|play with friends|create room|join|admin|ban|mute|report|clear (all|data|save)/i

// ---------- what the bots record ----------

type Severity = 'high' | 'medium' | 'low'
interface Problem {
  id: string
  severity: Severity
  title: string // one line, plain words
  what: string // what a player would notice
  where: string // page / feature
  steps: string[] // how to make it happen again
  tech: string // error text, stack, numbers: for Claude
  bot: 'checklist' | 'explorer'
  screenshot?: string
  times: number
}
interface Check { name: string; plain: string; ok: boolean; note?: string }

const problems: Problem[] = []
const checks: Check[] = []
let trail: string[] = [] // the last things a bot did, attached to anything that breaks
let currentBot: Problem['bot'] = 'checklist'
let currentPlace = 'start'

function addProblem(p: Omit<Problem, 'id' | 'times' | 'bot' | 'steps'> & { steps?: string[] }) {
  // The same error firing again and again is one problem seen many times, not many problems.
  const key = p.title + '|' + p.tech.split('\n')[0]
  const old = problems.find((x) => x.title + '|' + x.tech.split('\n')[0] === key)
  if (old) { old.times++; return old }
  const np: Problem = { ...p, id: `P${problems.length + 1}`, times: 1, bot: currentBot, steps: p.steps ?? [...trail] }
  problems.push(np)
  return np
}

// ---------- small helpers ----------

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
function act(s: string) { trail.push(s); if (trail.length > 12) trail = trail.slice(-12); if (SHOW) console.log('  ·', s) }

function findBrowser() {
  const tries = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ]
  const hit = tries.find((p) => p && existsSync(p))
  if (!hit) throw new Error('No Chrome or Edge found. Install Chrome, or set CHROME_PATH to a Chromium browser.')
  return hit
}

async function startGame(): Promise<ChildProcess> {
  const vite = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: ROOT })
  await new Promise<void>((ok, fail) => {
    const t = setTimeout(() => fail(new Error('The game did not start within 60 seconds')), 60_000)
    vite.stdout!.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); ok() } })
    vite.stderr!.on('data', (d) => { if (/EADDRINUSE|already in use/.test(String(d))) { clearTimeout(t); fail(new Error(`Port ${PORT} is busy: close the other copy of the game first`)) } })
  })
  return vite
}

type GameState = { view: string; modal: string | null; runStatus: string; cash: number; equity: number; trades: number; positions: Record<string, number>; balances: Record<string, number>; feesPaid: number; selectedId: string | null; tokens: number; myLaunches: number }
async function state(page: Page): Promise<GameState> {
  return page.evaluate(async () => {
    const s = (window as any).__game.getState()
    const pf = s.portfolio
    // The dev server serves the game's own modules, so total value comes from the same function the game uses.
    const { valuePortfolio } = await import('/src/game/portfolioEngine.ts' as string)
    const equity = valuePortfolio(pf, new Map(s.market.tokens.map((t: any) => [t.id, t])), s.market).equity as number
    const positions: Record<string, number> = {}
    for (const [id, p] of Object.entries<any>(pf.positions)) positions[id] = p.qty
    return {
      view: s.view, modal: s.modal, runStatus: s.runStatus, cash: pf.cash, equity,
      trades: pf.trades.length, positions, balances: { ...pf.balances }, feesPaid: pf.feesPaid, selectedId: s.selectedId,
      tokens: s.market.tokens.length, myLaunches: s.market.tokens.filter((t: any) => t.creator === 'you').length,
    }
  })
}

async function shot(page: Page, name: string) {
  const file = join(SHOTS, `${name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.jpg`)
  await page.screenshot({ path: file, type: 'jpeg', quality: 60 }).catch(() => {})
  return file
}

// Money must always make sense: no NaN, no negative balances, and a trade can't make value vanish.
async function checkMoney(page: Page, where: string) {
  const s = await state(page).catch(() => null)
  if (!s) return
  const bad: string[] = []
  if (!Number.isFinite(s.cash)) bad.push(`cash is ${s.cash}`)
  if (s.cash < -0.01) bad.push(`cash is negative: ${s.cash}`)
  for (const [c, n] of Object.entries(s.balances)) {
    if (!Number.isFinite(n)) bad.push(`${c} balance is ${n}`)
    else if (n < -1e-9) bad.push(`${c} balance is negative: ${n}`)
  }
  for (const [id, q] of Object.entries(s.positions)) if (!Number.isFinite(q) || q < -1e-9) bad.push(`position ${id} qty is ${q}`)
  if (bad.length) {
    addProblem({ severity: 'high', title: 'Money numbers went wrong', what: 'A wallet showed an impossible amount (not a number, or below zero).', where, tech: bad.join('\n'), screenshot: await shot(page, `money-${where}`) })
  }
}

// Watch the browser for errors and wire them into problems, tagged with what the bot was doing at the time.
function watch(page: Page) {
  page.on('pageerror', async (e) => {
    const p = addProblem({ severity: 'high', title: `The game crashed with an error: ${e.message.slice(0, 80)}`, what: 'Something in the game broke while the bot was using it. Players may see a frozen or blank screen.', where: currentPlace, tech: (e.stack ?? e.message).split('\n').slice(0, 8).join('\n') })
    if (!p.screenshot) p.screenshot = await shot(page, `crash-${p.id}`)
  })
  page.on('console', (m) => {
    const text = m.text()
    if (/\[wallet\] change not run on the server/.test(text)) {
      addProblem({ severity: 'high', title: 'A money change skipped the server', what: 'The game changed a wallet without telling the server. In online play this would be undone or cause a mismatch.', where: currentPlace, tech: text })
    } else if (m.type() === 'error' && !/favicon|Failed to load resource.*(supabase|404)|WebSocket|ERR_CONNECTION_REFUSED|\/mp\b/.test(text)) {
      addProblem({ severity: 'medium', title: `Error message in the game: ${text.slice(0, 80)}`, what: 'The game logged an error. It may not be visible to players, but something did not work as written.', where: currentPlace, tech: text.slice(0, 1500) })
    } else if (m.type() === 'warning' && /Warning:|Each child|unique "key"|Maximum update depth|Cannot update a component/.test(text)) {
      addProblem({ severity: 'low', title: `React warning: ${text.slice(0, 70)}`, what: 'A behind-the-scenes code warning. Usually harmless to players but worth tidying.', where: currentPlace, tech: text.slice(0, 1500) })
    }
  })
}

// A React crash with no error screen leaves the page empty. Catch that.
async function pageLooksAlive(page: Page) {
  return page.evaluate(() => (document.getElementById('root')?.innerText ?? '').trim().length > 40)
}

async function step(page: Page, name: string, plain: string, fn: () => Promise<string | void>) {
  currentPlace = name
  act(`Start: ${name}`)
  try {
    const note = await fn()
    if (!(await pageLooksAlive(page))) throw new Error('The screen went blank (the game crashed)')
    checks.push({ name, plain, ok: true, note: note || undefined })
  } catch (e: any) {
    const msg = String(e?.message ?? e).split('\n')[0].slice(0, 300)
    checks.push({ name, plain, ok: false, note: msg })
    addProblem({ severity: /blank|crash/i.test(msg) ? 'high' : 'medium', title: `${name} didn't work`, what: plain + ' This did not work: ' + msg, where: name, tech: String(e?.stack ?? e).slice(0, 1500), screenshot: await shot(page, `fail-${name}`) })
    // Get back to a known screen so one failure doesn't knock over every later check.
    await page.keyboard.press('Escape').catch(() => {})
    await page.evaluate(() => { const g = (window as any).__game.getState(); g.setModal(null); g.setView('discover') }).catch(() => {})
  }
  await checkMoney(page, name)
}

// The buy / sell panel on the right of a coin's chart (the tracker on the left is an <aside> too).
const tradePanel = (page: Page) => page.locator('aside').filter({ has: page.locator('button', { hasText: /^(BUY|SELL) / }) }).first()
// Coin-page checks start from a coin page even if an earlier failed check left the bot somewhere else.
async function onCoinPage(page: Page) {
  if ((await state(page)).view === 'token') return
  act('Go back to a coin page')
  await page.evaluate(() => { const g = (window as any).__game.getState(); g.setModal(null); g.setView('discover') })
  await page.waitForTimeout(400)
  await page.locator('main [class*="cursor-pointer"]').first().click()
  await page.waitForTimeout(1000)
}

const navButton = (page: Page, label: string) => page.locator('header nav button', { hasText: label }).first()
async function openNav(page: Page, n: (typeof NAV)[number]) {
  act(`Click the "${n.label}" tab at the top`)
  await navButton(page, n.label).click()
  await page.waitForTimeout(600)
  const s = await state(page)
  if (s.view !== n.id) throw new Error(`clicked "${n.label}" but the game is showing "${s.view}"`)
}

// ---------- bot 1: the checklist ----------

async function checklistBot(page: Page) {
  currentBot = 'checklist'
  console.log('Checklist bot: walking every page and feature…')

  await step(page, 'Game opens', 'The game should load and show the "Pick your arena" screen.', async () => {
    act('Open the game')
    await page.goto(URL)
    await page.getByText('Pick your arena').waitFor({ timeout: 20_000 })
    await shot(page, '01-start')
  })

  await step(page, 'Start a Practice round', 'Picking Practice should close the menu and start a round with $100,000.', async () => {
    act('Click "Practice"')
    await page.getByRole('button', { name: /Practice/ }).click()
    await page.waitForTimeout(1000)
    const s = await state(page)
    if (s.runStatus !== 'running') throw new Error(`round status is "${s.runStatus}", expected "running"`)
    if (s.modal) throw new Error(`the "${s.modal}" window is still open`)
  })

  for (const n of NAV) {
    await step(page, `${n.label.replace(/^\S+ /, '')} page`, `Clicking the ${n.label} tab should open that page with content on it.`, async () => {
      await openNav(page, n)
      await page.waitForTimeout(500)
      const text = await page.locator('main').innerText()
      if (text.trim().length < 30) throw new Error('the page opened but is nearly empty')
      await shot(page, `page-${n.id}`)
    })
  }

  await step(page, 'Keyboard shortcuts', 'Each page has a letter key (D, T, C, Y, N, O, K, P, R, M, L). Pressing it should jump to that page.', async () => {
    const wrong: string[] = []
    for (const n of NAV) {
      act(`Press the "${n.key.toUpperCase()}" key`)
      await page.locator('body').press(n.key)
      await page.waitForTimeout(250)
      const v = (await state(page)).view
      if (v !== n.id) wrong.push(`${n.key.toUpperCase()} opened "${v}" instead of "${n.id}"`)
    }
    if (wrong.length) throw new Error(wrong.join('; '))
  })

  await step(page, 'Open a coin', 'Clicking a coin on the Discover page should open its chart.', async () => {
    await openNav(page, NAV[0])
    act('Click the first coin in the Discover list')
    await page.locator('main [class*="cursor-pointer"]').first().click()
    await page.waitForTimeout(1200)
    const s = await state(page)
    if (s.view !== 'token') throw new Error(`the game is showing "${s.view}" instead of the coin page`)
    await shot(page, 'coin-page')
  })

  await step(page, 'Chart timeframes', 'Every chart timeframe button (1s up to 4H) and the Line / Candles switch should change the chart without errors.', async () => {
    await onCoinPage(page)
    for (const tf of ['1s', '5s', '30s', '1m', '5m', '15m', '1H', '4H', '1m']) {
      act(`Click the "${tf}" chart button`)
      await page.locator('main button', { hasText: new RegExp(`^${tf}$`) }).first().click()
      await page.waitForTimeout(250)
    }
    // These two are icon buttons with no text, so find them by their accessible name.
    for (const b of ['Line', 'Candles']) { act(`Click the "${b}" chart style button`); await page.getByRole('button', { name: b, exact: true }).first().click(); await page.waitForTimeout(200) }
  })

  await step(page, 'Coin page tabs', 'The tabs under the chart (Positions, Holders, Top Traders, Dev Token, Trades) should each open.', async () => {
    await onCoinPage(page)
    for (const t of ['Positions', 'Holders', 'Top Traders', 'Dev Token', 'Trades']) {
      act(`Click the "${t}" tab under the chart`)
      await page.locator('main button', { hasText: new RegExp(`^${t}`) }).first().click()
      await page.waitForTimeout(400)
    }
    await shot(page, 'coin-tabs')
  })

  let boughtId: string | null = null
  await step(page, 'Buy a coin', 'Choosing an amount and pressing BUY should give you some of the coin, and your total value should only drop by fees.', async () => {
    await onCoinPage(page)
    const before = await state(page)
    boughtId = before.selectedId
    act('Click the "Buy" side of the trade panel')
    await tradePanel(page).locator('button', { hasText: /^Buy/ }).first().click().catch(() => {})
    act('Click the second amount preset')
    const presets = tradePanel(page).locator('button').filter({ hasText: /^(0\.\d+|1|\$?\d+)$/ })
    await presets.nth(1).click()
    act('Click the big BUY button')
    await tradePanel(page).locator('button', { hasText: /^BUY / }).first().click()
    await page.waitForTimeout(1200)
    const after = await state(page)
    if (after.trades <= before.trades) throw new Error('pressed BUY but no trade appeared in the history')
    if (!boughtId || !(after.positions[boughtId] > 0)) throw new Error('pressed BUY but the wallet holds none of the coin')
    const lost = before.equity - after.equity
    if (before.equity > 0 && lost / before.equity > 0.05) throw new Error(`total value fell by $${lost.toFixed(2)} (${((lost / before.equity) * 100).toFixed(1)}%) on one small buy`)
    await shot(page, 'after-buy')
    return `bought; value change $${(-lost).toFixed(2)}`
  })

  await step(page, 'Sell the coin', 'Switching to Sell and selling 100% should empty the position.', async () => {
    if (!boughtId) throw new Error('skipped: the buy before this did not work')
    await onCoinPage(page)
    const before = await state(page)
    act('Click the "Sell" side of the trade panel')
    await tradePanel(page).locator('button', { hasText: /^Sell/ }).first().click()
    await page.waitForTimeout(300)
    act('Click "100%" (or MAX)')
    const all = tradePanel(page).locator('button', { hasText: /^(100%|MAX)$/ }).first()
    await all.click()
    act('Click the big SELL button')
    await tradePanel(page).locator('button', { hasText: /^SELL / }).first().click()
    await page.waitForTimeout(1200)
    const after = await state(page)
    if (after.trades <= before.trades) throw new Error('pressed SELL but no trade appeared in the history')
    if ((after.positions[boughtId] ?? 0) > (before.positions[boughtId] ?? 0) * 0.01) throw new Error(`still holding ${after.positions[boughtId]} after selling 100%`)
    await shot(page, 'after-sell')
  })

  await step(page, 'Watchlist', 'The star on a coin should add it to the watchlist, and pressing it again should remove it.', async () => {
    await onCoinPage(page)
    const count = () => page.evaluate(() => (window as any).__game.getState().watchlist.length as number)
    const a = await count()
    act('Click the watchlist star on the coin page')
    await page.getByRole('button', { name: 'Toggle watchlist' }).first().click()
    await page.waitForTimeout(300)
    const b = await count()
    act('Click the star again')
    await page.getByRole('button', { name: 'Toggle watchlist' }).first().click()
    await page.waitForTimeout(300)
    const c = await count()
    if (b === a) throw new Error('the star did not change the watchlist')
    if (c !== a) throw new Error('pressing the star twice did not put the watchlist back')
  })

  await step(page, 'Bottom panel tabs', 'On Discover, the bottom panel tabs (Positions, Watchlist, History, Events, Wallet tracker, Social tracker) should each open.', async () => {
    await openNav(page, NAV[0])
    for (const t of ['Positions', 'Watchlist', 'History', 'Events', 'Wallet tracker', 'Social tracker']) {
      act(`Click the "${t}" tab in the bottom panel`)
      await page.locator('main button', { hasText: new RegExp(`^${t}`) }).last().click()
      await page.waitForTimeout(300)
    }
    await shot(page, 'dock')
  })

  await step(page, 'Cook a coin', 'On Cooking, pressing the big COOK button should launch a new coin that you made.', async () => {
    await openNav(page, NAV[2])
    const before = await state(page)
    // A random name can clash with a coin already on the market ("$X already exists"): roll again, like a player would.
    const cookBtn = page.locator('main button', { hasText: /^🍳 COOK/ }).first()
    const taken = page.locator('main button', { hasText: /already exists/ }).first()
    if (await taken.isVisible().catch(() => false)) {
      const what = (await taken.innerText()).trim()
      addProblem({ severity: 'low', title: 'Cooking suggests a coin name that is already taken', what: `Opening the Cooking page fills in a name for you, but that name is already on the market, so the big button reads "${what}" and can't be pressed until you change it. A new player's first look at Cooking is a greyed-out button.`, where: 'Cooking page', tech: `Default name on first open of Cooking clashes with a live token: button text "${what}". The suggested name should skip tickers already in market.tokens.`, screenshot: await shot(page, 'cook-name-taken') })
    }
    for (let i = 0; i < 6 && !(await cookBtn.isVisible().catch(() => false)); i++) {
      act('Click "Randomize" for a new coin name (the last one was taken)')
      await page.getByRole('button', { name: 'Randomize' }).first().click()
      await page.waitForTimeout(250)
    }
    const ticker = (await cookBtn.innerText()).replace(/^🍳 COOK \$?/, '').trim()
    act(`Click the big "COOK $${ticker}" button`)
    await cookBtn.click()
    await page.waitForTimeout(1500)
    const after = await state(page)
    if (after.myLaunches <= before.myLaunches) throw new Error(`pressed COOK $${ticker} but no new coin of yours appeared on the market`)
    await shot(page, 'after-cook')
    return `launched $${ticker}`
  })

  await step(page, 'Settings and Help windows', 'The Settings and Help buttons should open their windows, and Escape should close them.', async () => {
    for (const w of ['Settings', 'Help']) {
      act(`Click the "${w}" button (top right)`)
      await page.getByRole('button', { name: w, exact: true }).first().click()
      await page.waitForTimeout(400)
      const open = (await state(page)).modal
      if (!open) throw new Error(`${w} did not open`)
      await shot(page, `window-${w}`)
      act('Press Escape')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
      if ((await state(page)).modal) throw new Error(`Escape did not close ${w}`)
    }
  })

  await step(page, 'Pause and resume', 'Pressing the space bar should pause the market, and pressing it again should resume it.', async () => {
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
    const paused = () => page.evaluate(() => (window as any).__game.getState().paused as boolean)
    const a = await paused()
    act('Press the space bar'); await page.keyboard.press('Space'); await page.waitForTimeout(300)
    const b = await paused()
    act('Press the space bar again'); await page.keyboard.press('Space'); await page.waitForTimeout(300)
    const c = await paused()
    if (a === b) throw new Error('space did not pause')
    if (c !== a) throw new Error('space did not resume')
  })

  const g = <T>(fn: string) => page.evaluate(`(() => { const s = window.__game.getState(); return (${fn})(s) })()`) as Promise<T>

  await step(page, 'Swap USD into chain coins', 'The wallet balance button opens Swap. "Quick split" should turn half your USD into SOL, BNB and ETH, and typing an amount and pressing Confirm should swap it, losing only the small swap fee.', async () => {
    const before = await state(page)
    act('Open Swap'); await page.evaluate(() => (window as any).__game.getState().setSwapOpen(true))
    await page.waitForTimeout(400)
    act('Click "Quick split half my USD"'); await page.getByRole('button', { name: /Quick split half my USD/ }).click()
    await page.waitForTimeout(500)
    const mid = await state(page)
    if (!(mid.balances.sol > 0 && mid.balances.bsc > 0 && mid.balances.hood > 0)) throw new Error(`after Quick split the chain balances are ${JSON.stringify(mid.balances)}`)
    act('Type 100 in the amount box and press Confirm')
    await page.getByPlaceholder('0.0').first().fill('100')
    await page.getByRole('button', { name: /^Confirm/ }).first().click()
    await page.waitForTimeout(500)
    const after = await state(page)
    if (JSON.stringify(after.balances) === JSON.stringify(mid.balances) && after.cash === mid.cash) throw new Error('pressed Confirm but no balance changed')
    const lost = before.equity - after.equity
    if (lost > before.equity * 0.02) throw new Error(`swapping lost $${lost.toFixed(2)} of value (over 2%)`)
    await shot(page, 'swap')
    act('Press Escape'); await page.keyboard.press('Escape')
    await page.evaluate(() => (window as any).__game.getState().setSwapOpen?.(false))
    return `value change $${(-lost).toFixed(2)}`
  })

  await step(page, 'Make a second wallet', 'In the wallet manager, typing a name and pressing "Create wallet" should add a new empty wallet.', async () => {
    const n0 = await g<number>('(s) => (s.portfolio.accounts ?? []).length')
    act('Open the wallet manager'); await page.evaluate(() => (window as any).__game.getState().setWalletsOpen(true))
    await page.waitForTimeout(400)
    act('Type "Bot wallet" and press "Create wallet"')
    await page.getByLabel('New wallet name').fill('Bot wallet')
    await page.getByRole('button', { name: 'Create wallet' }).click()
    await page.waitForTimeout(400)
    const n1 = await g<number>('(s) => (s.portfolio.accounts ?? []).length')
    await shot(page, 'wallets')
    act('Press Escape'); await page.keyboard.press('Escape')
    await page.evaluate(() => (window as any).__game.getState().setWalletsOpen(false))
    if (n1 !== n0 + 1) throw new Error(`wallets went from ${n0} to ${n1}`)
  })

  await step(page, 'Arm a sniper', 'On the Sniper page, pressing "Arm sniper" should add a sniper that waits for new launches.', async () => {
    await openNav(page, NAV[4])
    const n0 = await g<number>('(s) => (s.snipers ?? []).length')
    act('Click "Arm sniper"'); await page.getByRole('button', { name: 'Arm sniper' }).click()
    await page.waitForTimeout(500)
    const n1 = await g<number>('(s) => (s.snipers ?? []).length')
    await shot(page, 'sniper')
    if (n1 !== n0 + 1) throw new Error(`snipers went from ${n0} to ${n1}`)
  })

  await step(page, 'Copy a trader', 'On CopyTrade, pressing "Copy" on the first trader and then "Start copying" should start copying them.', async () => {
    await openNav(page, NAV[3])
    const n0 = await g<number>('(s) => (s.copies ?? []).length')
    act('Click "Copy" on the first trader'); await page.locator('main button', { hasText: /^\s*Copy\s*$/ }).first().click()
    await page.waitForTimeout(400)
    act('Click "Start copying …"'); await page.getByRole('button', { name: /^Start copying/ }).click()
    await page.waitForTimeout(500)
    const n1 = await g<number>('(s) => (s.copies ?? []).length')
    await shot(page, 'copytrade')
    await page.keyboard.press('Escape')
    if (n1 !== n0 + 1) throw new Error(`copies went from ${n0} to ${n1}`)
  })

  await step(page, 'Daily check-in', 'On Rewards → Daily, pressing "Check in" should give today\'s reward once, then say "come back tomorrow".', async () => {
    await openNav(page, NAV[8])
    act('Click the "Daily" tab'); await page.locator('main button', { hasText: /^Daily$/ }).first().click()
    await page.waitForTimeout(300)
    const btn = page.locator('main button', { hasText: /Check in|Checked in today/ }).first()
    const label0 = (await btn.innerText()).trim()
    if (/Checked in today/.test(label0)) return 'already checked in today'
    act(`Click "${label0}"`); await btn.click()
    await page.waitForTimeout(400)
    const label1 = (await btn.innerText()).trim()
    await shot(page, 'check-in')
    if (!/Checked in today/.test(label1)) throw new Error(`after checking in the button still reads "${label1}"`)
  })

  await step(page, 'Claim cashback', 'On Rewards → Cashback, "Claim all as USDC" should pay any cashback from your trades into your cash.', async () => {
    act('Click the "Cashback" tab'); await page.locator('main button', { hasText: /^Cashback$/ }).first().click()
    await page.waitForTimeout(300)
    const c0 = (await state(page)).cash
    act('Click "Claim all as USDC"'); await page.locator('main button', { hasText: /^Claim all as USDC$/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    const c1 = (await state(page)).cash
    if (c1 < c0 - 0.01) throw new Error(`claiming cashback lowered cash by $${(c0 - c1).toFixed(2)}`)
    return c1 > c0 ? `+$${(c1 - c0).toFixed(4)} claimed` : 'nothing to claim yet'
  })

  await step(page, 'Settings switches', 'In Settings, "Compact mode" and the game speed should switch on and back off.', async () => {
    act('Open Settings'); await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
    await page.waitForTimeout(300)
    const compact = () => g<boolean>('(s) => s.settings.compact')
    const a = await compact()
    act('Click the "Compact mode" switch'); await page.getByRole('switch', { name: 'Compact mode' }).click(); await page.waitForTimeout(200)
    const b = await compact()
    act('Click the "Compact mode" switch again'); await page.getByRole('switch', { name: 'Compact mode' }).click(); await page.waitForTimeout(200)
    const c = await compact()
    act('Click the "2×" speed'); await page.getByRole('button', { name: '2×', exact: true }).first().click(); await page.waitForTimeout(200)
    const fast = await g<number>('(s) => s.settings.speed ?? s.speed ?? 0')
    act('Click the "1×" speed'); await page.getByRole('button', { name: '1×', exact: true }).first().click(); await page.waitForTimeout(200)
    await page.keyboard.press('Escape')
    if (a === b) throw new Error('Compact mode did not switch on')
    if (c !== a) throw new Error('Compact mode did not switch back')
    return `speed after 2×: ${fast}`
  })

  await step(page, 'Search for a coin', 'Pressing "/" and typing a coin\'s ticker should find it; Enter should open its chart.', async () => {
    await openNav(page, NAV[0])
    const want = await g<{ id: string; ticker: string }>('(s) => { const t = s.market.tokens.find((x) => x.status === "bonding" || x.status === "graduated"); return { id: t.id, ticker: t.ticker } }')
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
    act('Press "/"'); await page.keyboard.press('/')
    await page.waitForTimeout(200)
    act(`Type "${want.ticker}" and press Enter`)
    await page.keyboard.type(want.ticker)
    await page.waitForTimeout(400)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(800)
    const s = await state(page)
    await shot(page, 'search')
    if (s.view !== 'token') throw new Error(`after Enter the game shows "${s.view}", not a coin`)
    const ticker = await g<string>('(s) => s.market.tokens.find((t) => t.id === s.selectedId)?.ticker ?? ""')
    if (ticker !== want.ticker) throw new Error(`searched for $${want.ticker} but opened $${ticker}`)
  })

  await step(page, 'Trenches quick buy', 'On Trenches, the quick-buy button on a coin (like "1 SOL") should buy it in one click.', async () => {
    await openNav(page, NAV[1])
    const t0 = (await state(page)).trades
    // The row's quick-buy button shows on hover, like Axiom.
    act('Hover the first coin in New Pairs and click its quick-buy button')
    const qb = page.locator('main button[title^="Quick buy "][title*="trade settings"]:not([disabled])').first()
    await qb.hover()
    await qb.click()
    await page.waitForTimeout(1000)
    const t1 = (await state(page)).trades
    await shot(page, 'trenches-buy')
    if (t1 <= t0) throw new Error('clicked quick buy but no trade happened')
  })

  await step(page, 'Other game modes', 'From the mode menu, Challenge and Arena should each start a fresh round with $10,000 and a timer, and Hardcore should stay locked for a new player (it needs level 5).', async () => {
    for (const [label, mode] of [['Challenge', 'challenge'], ['Arena', 'arena']] as const) {
      act('Open the mode menu'); await page.evaluate(() => (window as any).__game.getState().setModal('mode'))
      await page.waitForTimeout(300)
      const card = page.getByRole('button', { name: new RegExp(`^.{0,4}${label}`) }).first()
      act(`Click "${label}"`); await card.click()
      await page.waitForTimeout(500)
      // Mid-round, the first click only warns "Click again to abandon your current round".
      if (/Click again/.test(await card.innerText().catch(() => ''))) { act(`Click "${label}" again to confirm`); await card.click(); await page.waitForTimeout(800) }
      const s = await g<{ mode: string; run: string; start: number; dur: number | null }>('(s) => ({ mode: s.mode, run: s.runStatus, start: s.portfolio.startBalance, dur: s.runDuration })')
      if (s.mode !== mode || s.run !== 'running') throw new Error(`${label}: mode "${s.mode}", round "${s.run}"`)
      if (s.start !== 10_000) throw new Error(`${label} started with $${s.start}, expected $10,000`)
      if (!s.dur) throw new Error(`${label} has no timer`)
    }
    act('Open the mode menu'); await page.evaluate(() => (window as any).__game.getState().setModal('mode'))
    await page.waitForTimeout(300)
    act('Click "Hardcore" (locked)'); await page.getByRole('button', { name: /Hardcore/ }).first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
    const after = await g<string>('(s) => s.mode')
    await page.keyboard.press('Escape')
    if (after === 'hardcore') throw new Error('Hardcore started for a level 1 player')
  })

  await step(page, 'Phone layout', 'On a phone-sized screen, no page should be wider than the screen (no sideways scrolling).', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)
    const wide: string[] = []
    for (const n of NAV) {
      act(`On a phone screen, open ${n.label}`)
      await page.evaluate((v) => (window as any).__game.getState().setView(v), n.id)
      await page.waitForTimeout(400)
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      if (w > 392) { wide.push(`${n.label} is ${w}px wide`); await shot(page, `phone-wide-${n.id}`) }
    }
    await shot(page, 'phone')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(400)
    if (wide.length) {
      addProblem({ severity: 'low', title: 'Some pages scroll sideways on a phone', what: 'On a 390px-wide phone these pages are wider than the screen, so players have to scroll sideways.', where: 'Phone layout', tech: wide.join('\n'), steps: ['Open the game on a phone (or a 390px-wide window)', 'Open each page listed'], screenshot: join(SHOTS, `phone-wide-${NAV.find((n) => wide[0].startsWith(n.label))?.id}.jpg`) })
      return `${wide.length} page(s) too wide (see problems)`
    }
  })
}

// ---------- bot 2: the explorer ----------

interface Memory { runs: number; clicks: number; tried: Record<string, number>; broke: Record<string, number>; pages: Record<string, number> }
function loadMemory(): Memory {
  try { return JSON.parse(readFileSync(MEMORY_FILE, 'utf8')) } catch { return { runs: 0, clicks: 0, tried: {}, broke: {}, pages: {} } }
}

async function explorerBot(page: Page) {
  currentBot = 'explorer'
  const mem = loadMemory()
  const knownBefore = Object.keys(mem.tried).length
  const rand = rng(SEED)
  console.log(`Explorer bot: ${CLICKS} clicks (seed ${SEED}), remembers ${knownBefore} buttons from ${mem.runs} earlier run(s)…`)
  trail = []
  let newButtons = 0
  currentPlace = 'explorer start'
  if (SELFTEST) {
    // A crash and impossible money, planted on purpose: both must show up in the report or the bots are blind.
    act('SELF-TEST: throw an error and set cash to NaN')
    await page.evaluate(() => { setTimeout(() => { throw new Error('ui-bots self-test crash') }); const g = (window as any).__game; g.setState({ portfolio: { ...g.getState().portfolio, cash: NaN } }) })
    await page.waitForTimeout(300)
    await checkMoney(page, 'self-test')
    await page.evaluate(() => { const g = (window as any).__game; g.setState({ portfolio: { ...g.getState().portfolio, cash: 1000 } }) })
  }

  for (let i = 0; i < CLICKS; i++) {
    const s = await state(page).catch(() => null)
    if (!s || !(await pageLooksAlive(page))) {
      addProblem({ severity: 'high', title: 'The screen went blank while exploring', what: 'After a click the whole game disappeared. A player would have to reload.', where: currentPlace, tech: 'root element empty after: ' + trail.slice(-1)[0], screenshot: await shot(page, `blank-${i}`) })
      await page.goto(URL); await page.waitForTimeout(1500)
      await page.getByRole('button', { name: /Practice/ }).click().catch(() => {})
      continue
    }
    currentPlace = s.modal ? `${s.view} page, "${s.modal}" window` : `${s.view} page`
    mem.pages[s.view] = (mem.pages[s.view] ?? 0) + 1
    if (s.runStatus !== 'running' && !s.modal) await page.evaluate(() => (window as any).__game.getState().startRun('practice', { silent: true })).catch(() => {})

    // Every visible button / tab / checkbox the explorer may press, named the way a person would describe it.
    const cands = await page.evaluate((avoid) => {
      const re = new RegExp(avoid, 'i')
      const els = [...document.querySelectorAll<HTMLElement>('button, [role="button"], [role="tab"], input[type="checkbox"], select, [class*="cursor-pointer"]')]
      return els.map((el, idx) => {
        const r = el.getBoundingClientRect()
        const label = (el.getAttribute('aria-label') || el.title || el.innerText || (el as HTMLInputElement).value || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 50)
        const vis = r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden' && !(el as HTMLButtonElement).disabled
        const hit = vis ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
        return { idx, label, ok: vis && !!hit && (el === hit || el.contains(hit)) && !re.test(label) && !el.closest('a[target="_blank"]'), x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName }
      }).filter((c) => c.ok && c.label)
    }, AVOID.source)
    if (!cands.length) { await page.keyboard.press('Escape'); continue }

    // Pick by novelty: buttons pressed fewer times (across all runs) are far more likely to be picked, and buttons
    // that broke something before get re-checked. Numbers in labels are stripped so "Buy 1 SOL" on 50 coin rows
    // counts as one kind of button.
    const keyOf = (c: (typeof cands)[number]) => `${s.view}${s.modal ? '/' + s.modal : ''}:${c.label.replace(/[\d.,$%]+/g, '#').replace(/0x\S+/g, '0x…')}`
    const weights = cands.map((c) => { const k = keyOf(c); return 1 / (1 + (mem.tried[k] ?? 0)) ** 1.5 + (mem.broke[k] ? 0.5 : 0) })
    let r = rand() * weights.reduce((a, b) => a + b, 0)
    let pick = cands[0]
    for (let j = 0; j < cands.length; j++) { r -= weights[j]; if (r <= 0) { pick = cands[j]; break } }
    const key = keyOf(pick)
    if (!mem.tried[key]) newButtons++
    mem.tried[key] = (mem.tried[key] ?? 0) + 1
    mem.clicks++

    const nBefore = problems.reduce((a, p) => a + p.times, 0)
    act(`On the ${currentPlace}, click "${pick.label}"`)
    if (pick.tag === 'SELECT') {
      await page.locator('select').nth(0).selectOption({ index: 1 }).catch(() => {})
    } else {
      await page.mouse.click(pick.x, pick.y).catch(() => {})
    }
    // Sometimes type into whatever got focus, the way a player fills in a box.
    if (rand() < 0.15) {
      const typed = await page.evaluate(() => { const el = document.activeElement as HTMLInputElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.type !== 'checkbox' })
      if (typed) { const txt = ['1', '0.5', '100', '-5', '999999999', 'abc', ''][Math.floor(rand() * 7)]; act(`Type "${txt}" into the box`); await page.keyboard.type(txt); if (rand() < 0.5) { act('Press Enter'); await page.keyboard.press('Enter') } }
    }
    await page.waitForTimeout(180)
    if (rand() < 0.08) { act('Press Escape'); await page.keyboard.press('Escape') }
    // A second tab can open (share links etc.): close it and carry on.
    for (const p of page.context().pages()) if (p !== page) await p.close().catch(() => {})
    await checkMoney(page, currentPlace)
    if (problems.reduce((a, p) => a + p.times, 0) > nBefore) {
      mem.broke[key] = (mem.broke[key] ?? 0) + 1
      const p = problems[problems.length - 1]
      if (!p.screenshot) p.screenshot = await shot(page, `explore-${p.id}`)
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${CLICKS} clicks, ${problems.length} problem(s) so far`)
  }

  mem.runs++
  writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 1))
  const known = Object.keys(mem.tried).length
  checks.push({ name: 'Explorer', plain: `Clicked around on its own ${CLICKS} times, preferring buttons it had not tried before.`, ok: true, note: `${newButtons} button(s) it had never pressed before; it now knows ${known} (was ${knownBefore}). Run ${mem.runs}.` })
  return { newButtons, known, knownBefore, runs: mem.runs, pages: mem.pages }
}

// ---------- the report ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const img = (f?: string) => (f && existsSync(f) ? `data:image/jpeg;base64,${readFileSync(f).toString('base64')}` : '')

function reportHtml(meta: { commit: string; branch: string; seconds: number; explore: Awaited<ReturnType<typeof explorerBot>> | null }) {
  const order: Severity[] = ['high', 'medium', 'low']
  const sorted = [...problems].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || b.times - a.times)
  const passed = checks.filter((c) => c.ok).length
  const sevWord = { high: 'Serious', medium: 'Should fix', low: 'Minor' }
  const count = (s: Severity) => problems.filter((p) => p.severity === s).length
  const headline = !problems.length ? 'No problems found.' : `${problems.length} problem${problems.length > 1 ? 's' : ''} found: ${count('high')} serious, ${count('medium')} should fix, ${count('low')} minor.`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.6in 0.6in 0.7in }
  body { font: 11pt/1.45 'Segoe UI', system-ui, sans-serif; color: #1b1f24; }
  h1 { font-size: 22pt; margin: 0 0 2px } h2 { font-size: 14pt; margin: 22px 0 8px; border-bottom: 1.5px solid #1b1f24; padding-bottom: 3px }
  .sub { color: #5b6470; font-size: 9.5pt } .big { font-size: 13pt; font-weight: 600; margin: 14px 0 4px }
  .box { border: 1px solid #d5d9de; border-radius: 6px; padding: 10px 12px; margin: 10px 0; break-inside: avoid }
  .tag { display: inline-block; font-size: 8.5pt; font-weight: 700; padding: 1px 7px; border-radius: 10px; margin-right: 6px; vertical-align: 1px }
  .high { background: #fde2e1; color: #a1170f } .medium { background: #fff1d6; color: #8a5300 } .low { background: #e6eef7; color: #23507d }
  .pass { color: #1c7a35; font-weight: 700 } .fail { color: #a1170f; font-weight: 700 }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt } td, th { border-bottom: 1px solid #e3e6ea; padding: 4px 6px; text-align: left; vertical-align: top } th { background: #f3f5f7 }
  ol { margin: 4px 0 4px 18px; padding: 0 } li { margin: 1px 0 }
  pre { background: #f3f5f7; border-radius: 4px; padding: 7px 9px; font: 8pt/1.35 Consolas, monospace; white-space: pre-wrap; word-break: break-word; margin: 6px 0 0 }
  .claude { font-size: 8.5pt; color: #5b6470; margin-top: 8px; font-weight: 600 }
  img { max-width: 100%; max-height: 3.2in; border: 1px solid #d5d9de; border-radius: 4px; margin-top: 8px }
  </style></head><body>
  <h1>MOONRUSH bot test report</h1>
  <div class="sub">${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} · branch <b>${esc(meta.branch)}</b> · commit ${esc(meta.commit)} · took ${Math.round(meta.seconds / 60)} min · explorer seed ${SEED}</div>

  <h2>The short version</h2>
  <div class="big">${esc(headline)}</div>
  <p>Two bots played the game in a hidden Chrome window. The <b>checklist bot</b> went through every page and main feature on purpose and checked each result: <b>${passed} of ${checks.filter((c) => c.name !== 'Explorer').length + (meta.explore ? 1 : 0)} checks passed</b>. The <b>explorer bot</b> then clicked around on its own ${CLICKS} times${meta.explore ? `, pressing ${meta.explore.newButtons} buttons it had never tried before. Across ${meta.explore.runs} run(s) it has now tried ${meta.explore.known} different buttons, and each run goes for the ones it has tried least` : ''}.</p>
  <p>Problems are listed worst first. <b>Serious</b> means a crash, a blank screen or wrong money. <b>Should fix</b> means a feature didn't work or the game logged an error. <b>Minor</b> means layout or code tidiness.</p>

  <h2>Problems found</h2>
  ${sorted.length ? sorted.map((p) => `<div class="box">
    <div><span class="tag ${p.severity}">${sevWord[p.severity]}</span><b>${p.id}. ${esc(p.title)}</b></div>
    <p style="margin:6px 0 4px">${esc(p.what)}</p>
    <div class="sub">Where: ${esc(p.where)} · found by the ${p.bot} bot · seen ${p.times} time${p.times > 1 ? 's' : ''}</div>
    ${p.steps.length ? `<div style="margin-top:6px"><b>How to make it happen again</b> (what the bot did just before)<ol>${p.steps.slice(-8).map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    ${img(p.screenshot) ? `<img src="${img(p.screenshot)}">` : ''}
    <div class="claude">FOR CLAUDE: technical details</div><pre>${esc(p.tech)}</pre>
  </div>`).join('') : '<p>Nothing broke. 🎉</p>'}

  <h2>What the bots checked</h2>
  <table><tr><th style="width:22%">Check</th><th>What it tests</th><th style="width:9%">Result</th><th style="width:26%">Note</th></tr>
  ${checks.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.plain)}</td><td class="${c.ok ? 'pass' : 'fail'}">${c.ok ? 'PASS' : 'FAIL'}</td><td>${esc(c.note ?? '')}</td></tr>`).join('')}
  </table>
  <p style="margin-top:10px">Throughout every check, the bots also watched for <b>crashes</b>, <b>error messages</b>, <b>money that stopped making sense</b> (not a number, below zero), and the warning the game prints when a wallet changes without the server knowing.</p>

  <h2>What was NOT tested</h2>
  <p>The bots played <b>solo</b> on this computer. They did not test: playing with friends (rooms), the World, signing in and accounts, friends lists, the admin panel, or anything on the live website. Those need the game server and a real account, so they're a job for a later version of the bots.</p>

  <h2>For Claude</h2>
  <pre>Full data: bot-reports/${STAMP}/report.json   Screenshots: bot-reports/${STAMP}/screenshots/
Replay this exact explorer run: npx tsx scripts/ui-bots.ts --seed ${SEED} --clicks ${CLICKS}
Explorer memory (shared by all runs): bot-reports/explorer-memory.json
Bot source: scripts/ui-bots.ts. "Steps" are the bot's last actions before the problem, oldest first.
Fix on a new branch per problem and open a PR; never push to main (see CLAUDE.md).</pre>
  </body></html>`
}

// ---------- run ----------

async function main() {
  const t0 = Date.now()
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim() } catch { return '?' } })()
  const branch = (() => { try { return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim() } catch { return '?' } })()
  console.log('Starting the game…')
  const vite = await startGame()
  let browser: Browser | null = null
  let explore: Awaited<ReturnType<typeof explorerBot>> | null = null
  try {
    browser = await chromium.launch({ executablePath: findBrowser(), headless: !SHOW })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(8000) // a missing button fails in 8s instead of hanging for 30
    watch(page)
    await checklistBot(page)
    explore = await explorerBot(page)
  } catch (e: any) {
    addProblem({ severity: 'high', title: 'The bots could not finish', what: 'The test run stopped early, so the report below is incomplete.', where: currentPlace, tech: String(e?.stack ?? e).slice(0, 1500) })
  }

  const seconds = (Date.now() - t0) / 1000
  writeFileSync(join(OUT, 'report.json'), JSON.stringify({ when: new Date().toISOString(), commit, branch, seed: SEED, clicks: CLICKS, checks, problems, explore }, null, 1))
  const pdfBrowser = browser ?? (await chromium.launch({ executablePath: findBrowser(), headless: true }))
  const pdfPage = await pdfBrowser.newPage()
  await pdfPage.setContent(reportHtml({ commit, branch, seconds, explore }), { waitUntil: 'load' })
  const pdf = join(OUT, 'report.pdf')
  await pdfPage.pdf({ path: pdf, format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;color:#888;width:100%;text-align:center">MOONRUSH bot report · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>', margin: { top: '0.6in', bottom: '0.7in', left: '0.6in', right: '0.6in' } })
  await pdfBrowser.close()
  vite.kill()

  const failed = checks.filter((c) => !c.ok)
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed, ${problems.length} problem(s) found.`)
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.note ? ` (${c.note})` : ''}`)
  console.log(`\nReport: ${pdf}`)
  process.exit(0)
}

main()
