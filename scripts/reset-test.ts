// The World's starting balance as the admin sets it, and starting every World player over (Admin > Rooms).
//   npx tsx scripts/reset-test.ts
import { Room } from '../server/room'
import { candleStore, cookToken } from '../src/game/marketEngine'
import { Rng } from '../src/utils/rng'
import { WORLD_CODE, WORLD_START_BALANCE, WORLD_START_MAX, WORLD_START_MIN, worldStartOf, type ServerMsg } from '../src/net/protocol'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
type Tok = { id: string; ticker: string; status: string; chain: string; creatorId?: string; price: number }
type Mem = {
  info: { id: string; bot?: boolean; equity: number; startEquity: number; trades: number }
  brain?: unknown
  wallet?: { cash: number; startBalance: number; positions: Record<string, { qty: number }>; trades: unknown[]; accounts: { id: string; balances: Record<string, number> }[] }
  dev?: unknown; pnlCarry?: number; chainPnl?: unknown; trophies?: string[]; restarts?: number; lastRestart?: number; cookTicks?: number[]; social?: unknown
}
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, Mem>; market: { tokens: Tok[]; tick: number }; hall: unknown[]; cooked: Map<string, { pid: string }>; timer: ReturnType<typeof setInterval>; round: { startBalance?: number } }
const sock = (box: ServerMsg[]) => ({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} }) as never
const hello = (playerId: string) => ({ t: 'hello' as const, name: playerId.slice(2), avatar: '🐸', level: 1, playerId, verified: true })

const world = new Room(WORLD_CODE, true)
const r = world as unknown as R
clearInterval(r.timer)
for (let i = 0; i < 300; i++) r.tick()

// ── The starting balance ─────────────────────────────────────────────────────
const aliceBox: ServerMsg[] = []
world.join(sock(aliceBox), hello('u-alice'))
r.tick()
const alice = () => r.members.get('u-alice')!
ok(alice().wallet?.cash === WORLD_START_BALANCE && world.worldStart === WORLD_START_BALANCE, `before anything is set a new player starts with the usual $${WORLD_START_BALANCE}`)

aliceBox.length = 0
ok(world.setStartBalance(25_000) === 25_000 && world.worldStart === 25_000, 'the admin sets $25,000')
const told = aliceBox.find((m) => m.t === 'round') as Extract<ServerMsg, { t: 'round' }> | undefined
ok(!!told && worldStartOf(told.round) === 25_000 && told.market === undefined, 'every browser in the World is told, without its market being started again')
ok(alice().wallet?.cash === WORLD_START_BALANCE, "a wallet that already exists is not touched by the new figure")
world.join(sock([]), hello('u-bob'))
r.tick()
const bob = () => r.members.get('u-bob')!
ok(bob().wallet?.cash === 25_000 && bob().wallet?.startBalance === 25_000, 'a player who joins after that starts with $25,000 (and their profit is counted from there)')
const bots = () => [...r.members.values()].filter((m) => m.brain)
ok(bots().length > 0 && bots().every((m) => m.wallet?.startBalance === WORLD_START_BALANCE), `the World's ${bots().length} bots keep the usual balance`)
ok(world.setStartBalance(1) === WORLD_START_MIN && world.setStartBalance(1e15) === WORLD_START_MAX && world.setStartBalance(NaN) === null, `silly figures are held between $${WORLD_START_MIN} and $${WORLD_START_MAX}, and nonsense is refused`)
world.setStartBalance(25_000)
ok(new Room('ROOMA').setStartBalance(5000) === null, 'a room with friends has no starting balance to set (its mode decides)')
const saved = Room.restore(JSON.parse(JSON.stringify(world.snapshot())))
clearInterval((saved as unknown as R).timer)
ok(saved.worldStart === 25_000, 'the figure is saved with the World and comes back after a restart')
saved.dispose()
world.setStartBalance(WORLD_START_BALANCE)
ok(r.round.startBalance === undefined && world.worldStart === WORLD_START_BALANCE, 'setting the usual figure again leaves nothing special behind')
world.setStartBalance(25_000)

// ── Players trade and launch coins ───────────────────────────────────────────
r.handle('u-alice', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 3000, walletId: 'w-main' } })
r.handle('u-bob', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 3000, walletId: 'w-main' } })
const spec = (ticker: string) => ({ name: `${ticker} Coin`, ticker, emoji: '🧪', hue: 100, description: '', chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, devBuy: 1, marketing: 0, narrative: 'dogs', socials: { x: true, tg: false, web: false }, style: 'fair' }) as never
const cook = (pid: string, ticker: string, seq: number) => {
  const c = cookToken(world.market, new Rng(seq * 77 + ticker.length), spec(ticker))
  r.handle(pid, { t: 'cook', seq, ref: seq, token: c.token, money: { devWallet: 'w-main', devBuy: 1, marketing: 0 } })
  return c.token.id
}
const aliceCoin = cook('u-alice', 'ALCE', 2)
for (let i = 0; i < 20; i++) r.tick()
const bobCoin = cook('u-bob', 'BOBB', 2)
const has = (id: string) => r.market.tokens.some((t) => t.id === id)
ok(has(aliceCoin) && has(bobCoin), 'two players each launch a coin')
// Bob buys Alice's coin and a coin of the market's own; then an hour of life, so there are records to wipe.
const simCoin = r.market.tokens.find((t) => t.status === 'bonding' && t.chain === 'sol' && !t.creatorId)!
r.handle('u-bob', { t: 'order', seq: 3, ref: 3, order: { side: 'buy', tokenId: aliceCoin, walletIds: ['w-main'], usdEach: 300 } })
r.handle('u-bob', { t: 'order', seq: 4, ref: 4, order: { side: 'buy', tokenId: simCoin.id, walletIds: ['w-main'], usdEach: 300 } })
ok(!!bob().wallet!.positions[aliceCoin] && !!bob().wallet!.positions[simCoin.id], "Bob holds Alice's coin and one of the market's own")
for (let i = 0; i < 1500; i++) r.tick()
// Records that only time and seasons bring: put there by hand, so the wipe has something of every kind to clear.
Object.assign(alice(), { pnlCarry: -1234, trophies: ['S1 #1'], restarts: 2, lastRestart: Date.now(), chainPnl: { sol: 50, bsc: 0, hood: 0 } })
r.hall.push({ n: 1, name: 'Season 1', winners: [] })
ok(!!alice().dev && alice().wallet!.trades.length > 0, 'Alice has a coin-maker record and a trade history')
const socialBefore = JSON.stringify(alice().social ?? null)
// Carol is off line when it happens.
world.join(sock([]), hello('u-carol'))
r.tick()
r.handle('u-carol', { t: 'order', seq: 1, ref: 1, order: { side: 'buy', tokenId: simCoin.id, walletIds: ['w-main'], usdEach: 500 } })
world.leave('u-carol')
const carol = () => r.members.get('u-carol')!

// ── Start everyone over ──────────────────────────────────────────────────────
aliceBox.length = 0
const botCoinsBefore = r.market.tokens.filter((t) => t.creatorId && r.members.get(t.creatorId)?.brain).map((t) => t.id)
const simBefore = r.market.tokens.filter((t) => !t.creatorId).length
const tickBefore = r.market.tick
const res = world.resetWorld()
const players = [...r.members.values()].filter((m) => !m.brain)
ok(!!res && res.coins >= 2 && res.wallets >= players.length, `the reset answers what it did: ${res?.wallets} wallets, ${res?.coins} player coins removed`)
ok(players.every((m) => m.wallet?.cash === 25_000 && m.wallet.startBalance === 25_000 && Object.keys(m.wallet.positions).length === 0 && m.wallet.trades.length === 0), `all ${players.length} players have $25,000, no coins and no trade history`)
ok(carol().wallet?.cash === 25_000, 'a player who is off line is reset too')
ok(bots().every((m) => m.wallet?.cash === WORLD_START_BALANCE && Object.keys(m.wallet.positions).length === 0), 'the bots start over with their usual balance')
ok(!has(aliceCoin) && !has(bobCoin) && !r.cooked.has(aliceCoin) && !r.cooked.has(bobCoin) && !candleStore.has(aliceCoin), "the players' coins are off the market, with their charts and fee vaults")
ok(!r.market.tokens.some((t) => t.creatorId && !r.members.get(t.creatorId)?.brain), 'no coin made by a real player is left')
ok(botCoinsBefore.every(has) && r.market.tokens.filter((t) => !t.creatorId).length === simBefore && r.market.tick === tickBefore, `the rest of the market runs on untouched: ${simBefore} coins of its own and ${botCoinsBefore.length} bot coins are all still there`)
ok(players.every((m) => !m.dev && !m.pnlCarry && !m.chainPnl && !m.trophies && !m.restarts && !m.lastRestart && !(m.cookTicks?.length)) && r.hall.length === 0, 'records are at zero: coin-maker stats, profit history, trophies, restarts, launch limits, the hall of fame')
ok(JSON.stringify(alice().social ?? null) === socialBefore, 'followers and reputation are kept')
const w = aliceBox.find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }> | undefined
ok(!!w?.reset && w.state.cash === 25_000, 'a player who is on is told at once, with the fresh wallet')
let threw = ''
const box2: ServerMsg[] = []
try {
  for (let i = 0; i < 600; i++) r.tick()
  world.join(sock(box2), hello('u-carol'))
  r.handle('u-alice', { t: 'board' })
  r.tick()
} catch (e) {
  threw = String((e as Error)?.stack ?? e).slice(0, 300)
}
ok(!threw, `the World runs on for ten minutes after it, and Carol comes back${threw ? ': ' + threw : ''}`)
const welcome = box2.find((m) => m.t === 'welcome') as Extract<ServerMsg, { t: 'welcome' }> | undefined
ok(!!welcome && !welcome.market.tokens.some((t) => t.id === aliceCoin || t.id === bobCoin) && worldStartOf(welcome.round) === 25_000, 'what she is sent has no removed coin in it, and the new starting balance')
const pl = welcome?.players.filter((p) => !p.bot) ?? []
ok(pl.every((p) => p.startEquity === 25_000 && p.trades === 0), 'the player list shows everyone back at the start')
// A player can launch again straight away (the old launches do not count against the hourly limit).
r.handle('u-alice', { t: 'op', seq: 10, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 3000, walletId: 'w-main' } })
const again = cook('u-alice', 'ALCE', 11)
ok(has(again), 'Alice can launch a coin again, even under the old ticker')
const after = Room.restore(JSON.parse(JSON.stringify(world.snapshot())), world.chartSnapshot())
clearInterval((after as unknown as R).timer)
const a = after as unknown as R
ok(a.members.get('u-bob')?.wallet?.cash === 25_000 && !a.market.tokens.some((t) => t.id === bobCoin) && a.hall.length === 0, 'the reset World saves and loads as it is')
after.dispose()
ok(new Room('ROOMB').resetWorld() === null, 'only the World can be reset this way')
world.dispose()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
