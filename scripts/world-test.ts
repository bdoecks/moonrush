// World check: always running, never pauses, guests only watch, players keep their wallet, it saves and comes back.
import { Room } from '../server/room'
import { WORLD_CODE, WORLD_START_BALANCE, type ServerMsg } from '../src/net/protocol'

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
ok(players.players.length === 1 && players.players[0].id === 'u-aaa', 'player list shows only players, not guests')
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
world.dispose()
back.dispose()
process.exit(0)
