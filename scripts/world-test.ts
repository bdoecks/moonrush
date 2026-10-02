// World check: always running, never pauses, guests only watch, players keep their wallet, it saves and comes back.
import { Room } from '../server/room'
import { WORLD_CODE, WORLD_START_BALANCE, type ServerMsg } from '../src/net/protocol'
import { BOT_ROSTER } from '../server/bots'
import { cookAllowance } from '../src/game/marketEngine'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const sock = (box: ServerMsg[]) => ({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} }) as never
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, { wallet?: { cash: number; startBalance: number; trades: unknown[] }; info: { spectator?: boolean } }>; market: { tick: number; tokens: { id: string; status: string; mcap: number }[] } }

const world = new Room(WORLD_CODE, true)
const w = world as unknown as R
ok(world.round.state === 'running' && world.round.durationTicks === null && world.round.engine === 'realistic', 'World round is running, endless, realistic')

// Nobody online: it still ticks.
const t0 = w.market.tick
for (let i = 0; i < 5; i++) w.tick()
ok(w.market.tick === t0 + 5, 'ticks with nobody online')

// A signed-in player joins and plays; a guest only watches.
const pBox: ServerMsg[] = []
const gBox: ServerMsg[] = []
world.join(sock(pBox), { t: 'hello', name: 'Player', avatar: '🐸', level: 1, playerId: 'u-aaa', verified: true })
world.join(sock(gBox), { t: 'hello', name: 'Guest', avatar: '👀', level: 1, playerId: 'g-bbb', verified: false })
const player = w.members.get('u-aaa')!
ok(player.wallet?.cash === WORLD_START_BALANCE && player.wallet.startBalance === WORLD_START_BALANCE, `player starts with $${player.wallet?.cash}`)
ok(!!w.members.get('g-bbb')?.info.spectator && !w.members.get('g-bbb')?.wallet, 'guest is a spectator with no wallet')
const coin = w.market.tokens.find((t) => t.status === 'bonding' || t.status === 'graduated')!
w.handle('g-bbb', { t: 'order', seq: 1, ref: 1, order: { side: 'buy', tokenId: coin.id, walletIds: ['w-main'], usdEach: 100 } })
w.handle('g-bbb', { t: 'chat', text: 'spam' })
ok(!gBox.some((m) => m.t === 'wallet') && !pBox.some((m) => m.t === 'chat'), 'guest orders and chat are ignored')
const players = [...pBox].reverse().find((m) => m.t === 'players') as Extract<ServerMsg, { t: 'players' }>
ok(players.players.some((p) => p.id === 'u-aaa') && !players.players.some((p) => p.id === 'g-bbb') && players.players.filter((p) => !p.bot).length === 1, 'player list shows players (and online bots), not guests')
w.handle('u-aaa', { t: 'start', mode: 'arena', durationTicks: 60 })
ok(world.round.state === 'running' && world.round.durationTicks === null, 'nobody can end or restart the World')

// The player trades, leaves; their wallet stays.
w.handle('u-aaa', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 500, walletId: 'w-main' } })
w.handle('u-aaa', { t: 'order', seq: 2, ref: 2, order: { side: 'buy', tokenId: coin.id, walletIds: ['w-main'], usdEach: 50 } })
const cashAfter = player.wallet!.cash
world.leave('u-aaa', w.members.get('u-aaa') as never && ((world as unknown as { members: Map<string, { ws: unknown }> }).members.get('u-aaa')!.ws as never))
world.leave('g-bbb', (world as unknown as { members: Map<string, { ws: unknown }> }).members.get('g-bbb')!.ws as never)
ok(!w.members.has('g-bbb'), 'guest is forgotten when they leave')
for (let i = 0; i < 3; i++) w.tick()
ok(w.members.get('u-aaa')?.wallet?.cash === cashAfter, 'player wallet kept while offline')

// Save and restore: still the World, same wallet, same tick.
const snap = JSON.parse(JSON.stringify(world.snapshot()))
const back = Room.restore(snap, null)
const b = back as unknown as R
ok(back.world && b.members.get('u-aaa')?.wallet?.cash === cashAfter && b.market.tick === w.market.tick, 'restored as the World with wallets')
const bt = b.market.tick
b.tick()
ok(b.market.tick === bt + 1, 'restored World ticks with nobody online')
// Coming back gives them their wallet (not a fresh one).
const back2: ServerMsg[] = []
back.join(sock(back2), { t: 'hello', name: 'Player', avatar: '🐸', level: 1, playerId: 'u-aaa', verified: true })
const wal = back2.find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>
ok(wal?.state.cash === cashAfter && wal.state.startBalance === WORLD_START_BALANCE, 'rejoining gets the same wallet and start balance')

// Leaderboards: everyone with a wallet is ranked (bots too), by net worth and by this week's profit.
type Board = Extract<ServerMsg, { t: 'board' }>
const askBoard = (): Board => {
  back2.length = 0
  ;(back as unknown as { boardCache: unknown }).boardCache = null
  b.handle('u-aaa', { t: 'board' })
  return back2.find((m) => m.t === 'board') as Board
}
const b1 = askBoard()
ok(!!b1 && b1.total === BOT_ROSTER.length + 1 && b1.worth.length === b1.total && b1.worth.every((r, i) => i === 0 || b1.worth[i - 1].equity >= r.equity), `board ranks all ${b1?.total} wallets by net worth`)
ok(!!b1.me && b1.me.row.id === 'u-aaa' && b1.me.worthRank >= 1 && b1.me.restartAt === null, `you're on it: #${b1.me?.worthRank} net worth, #${b1.me?.weekRank} this week`)
ok(b1.worth.filter((r) => r.bot).length === BOT_ROSTER.length, 'bots are on the board, flagged as bots')
// An admin gift is money put in: net worth goes up, profit doesn't.
const pnlBefore = b1.me!.row.pnl
back.grant('u-aaa', 5000, 'usd')
const b2 = askBoard()
ok(Math.abs(b2.me!.row.equity - b1.me!.row.equity - 5000) < 60 && Math.abs(b2.me!.row.pnl - pnlBefore) < 60, `a $5,000 gift raises net worth, not profit (pnl ${pnlBefore.toFixed(0)} → ${b2.me!.row.pnl.toFixed(0)})`)
// Bankruptcy restart: refused while you still have money…
back2.length = 0
b.handle('u-aaa', { t: 'op', seq: 50, op: { kind: 'bankrupt' } })
ok(back2.some((m) => m.t === 'error' && /broke/.test(m.message)) && (b.members.get('u-aaa')!.wallet!.cash > 1000), 'restart refused while not broke')
// …allowed once you're broke, back to $1,000, with the loss kept on your record…
const mw = b.members.get('u-aaa')! as unknown as { wallet: { cash: number; startBalance: number; accounts: { balances: Record<string, number>; positions: object }[]; balances: Record<string, number>; positions: object } }
const startBal = mw.wallet.startBalance
mw.wallet = { ...mw.wallet, cash: 40, balances: { sol: 0, bsc: 0, hood: 0 }, positions: {}, accounts: mw.wallet.accounts.map((a) => ({ ...a, balances: { sol: 0, bsc: 0, hood: 0 }, positions: {} })) } as never
const broke = askBoard()
back2.length = 0
b.handle('u-aaa', { t: 'op', seq: 51, op: { kind: 'bankrupt' } })
const rs = back2.find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>
const after = askBoard()
ok(!!rs?.reset && rs.state.cash === 1000 && /Fresh start/.test(rs.note ?? ''), 'broke player restarts with $1,000 and is told')
ok(Math.abs(after.me!.row.pnl - (40 - startBal)) < 1 && Math.abs(after.me!.row.week - broke.me!.row.week) < 1 && after.me!.row.restarts === 1, `the loss stays on the record: all-time ${after.me!.row.pnl.toFixed(0)}, this week ${after.me!.row.week.toFixed(0)}`)
ok(after.me!.restartAt !== null && after.me!.restartAt! > Date.now() + 23 * 3600_000, 'next restart is about 24 hours away')
// …and not again within a day, even if broke again.
mw.wallet = { ...(b.members.get('u-aaa')!.wallet as object), cash: 5 } as never
back2.length = 0
b.handle('u-aaa', { t: 'op', seq: 52, op: { kind: 'bankrupt' } })
ok(back2.some((m) => m.t === 'error' && /24 hours/.test(m.message)) && b.members.get('u-aaa')!.wallet!.cash === 5, 'a second restart inside 24 hours is refused')

// Admin reset: the player's wallet goes back to the start, and they're told right away.
back2.length = 0
ok(back.resetWallets('u-aaa') === 1, 'admin reset finds the player')
const rw = back2.find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>
const bw = b.members.get('u-aaa')!.wallet!
ok(!!rw?.reset && rw.state.cash === WORLD_START_BALANCE && bw.cash === WORLD_START_BALANCE && bw.trades.length === 0 && !Object.keys((bw as unknown as { positions: object }).positions).length, 'reset wallet is fresh, player told')
ok(back.resetWallets('nobody') === 0, 'resetting an unknown player does nothing')

// Run the World for a simulated while: the market stays a sensible size.
const t1 = Date.now()
for (let i = 0; i < 3000; i++) b.tick()
const live = b.market.tokens.filter((t) => t.status === 'bonding' || t.status === 'graduated').length
ok(b.market.tokens.length < 400, `after 3000 more ticks: ${b.market.tokens.length} coins (${live} live), ${((Date.now() - t1) / 3000).toFixed(1)} ms/tick`)
// Launch limits: per round in rooms, per rolling hour in the World (it never ends a round).
{
  const ten = Array.from({ length: 10 }, (_, i) => 1000 + i * 60)
  ok(cookAllowance(false, Array(8).fill(0), 5000, 1).blocked !== null && cookAllowance(false, Array(7).fill(0), 5000, 1).blocked === null, 'rooms: 8 launches per round')
  ok(cookAllowance(true, Array.from({ length: 9 }, (_, i) => i), 100_000, 1).blocked === null, 'World: 9 old launches do not count against you')
  const full = cookAllowance(true, ten, 1700, 1)
  ok(!!full.blocked && full.used === 10 && /next one in \d+ min/.test(full.blocked), `World: 10 in the last hour blocks the 11th ("${full.blocked}")`)
  ok(cookAllowance(true, ten, 1000 + 3600, 1).blocked === null, 'World: the oldest launch ages out after an hour')
}
world.dispose()
back.dispose()
process.exit(0)
