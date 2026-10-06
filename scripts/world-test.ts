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

// Leaderboards: every real player with a wallet is ranked, by net worth and by this week's profit. Bots never are.
type Board = Extract<ServerMsg, { t: 'board' }>
const askBoard = (list?: string): Board => {
  back2.length = 0
  ;(back as unknown as { boardCache: unknown }).boardCache = null
  b.handle('u-aaa', { t: 'board', ...(list ? { list } : {}) })
  return back2.find((m) => m.t === 'board') as Board
}
const b1 = askBoard()
// (A second real player, so there is somebody to be ranked against.)
const other: ServerMsg[] = []
back.join(sock(other), { t: 'hello', name: 'Second', avatar: '🐶', level: 1, playerId: 'u-ccc', verified: true })
ok(!!b1 && b1.list === 'worth' && b1.total === 1 && b1.rows.length === 1, `with ${BOT_ROSTER.length} bots in the World and one real player, the board ranks 1`)
const b1b = askBoard()
ok(b1b.total === 2 && b1b.rows.length === 2 && b1b.rows.every((r, i) => i === 0 || b1b.rows[i - 1].equity >= r.equity), `a second real player joins: the board ranks ${b1b.total}, by net worth`)
ok(!!b1.me && b1.me.row.id === 'u-aaa' && b1.me.rank >= 1 && b1.me.restartAt === null, `you're on it: #${b1.me?.rank} net worth`)
ok(['worth', 'day', 'week', 'season', 'sol', 'bsc', 'hood', 'dev'].every((list) => { const x = askBoard(list); return x.rows.every((r) => !r.id.startsWith('bot-') && !r.bot) && x.total <= 2 }), 'no bot is on any of the eight boards')
// The other lists: today / season / each chain are ranked by their own number; the season is the calendar month.
for (const list of ['day', 'week', 'season', 'sol', 'bsc', 'hood'] as const) {
  const bl = askBoard(list)
  const val = (r: (typeof bl.rows)[number]) => (list === 'day' ? r.day : list === 'week' ? r.week : list === 'season' ? r.season : r.chains[list])
  ok(bl.list === list && bl.rows.every((r, i) => i === 0 || val(bl.rows[i - 1]) >= val(r)), `${list} board is sorted by ${list} profit (${bl.rows.length} rows, season ${bl.season.n}: ${bl.season.name})`)
}
// An admin gift is money put in: net worth goes up, profit doesn't.
const pnlBefore = b1.me!.row.pnl
back.grant('u-aaa', 5000, 'usd')
const b2 = askBoard()
ok(Math.abs(b2.me!.row.equity - b1.me!.row.equity - 5000) < 60 && Math.abs(b2.me!.row.pnl - pnlBefore) < 60, `a $5,000 gift raises net worth, not profit (pnl ${pnlBefore.toFixed(0)} → ${b2.me!.row.pnl.toFixed(0)})`)
// A month ends: the season closes, its winners get trophies and go into the Hall of Fame.
{
  const r = back as unknown as { seasonKey: string | null; hall: { n: number; winners: { list: string; name: string }[] }[]; members: Map<string, { trophies?: string[]; seasonBase?: { key: string; pnl: number }; info: { bot?: boolean } }> }
  // Pretend last month: everyone's season counters belong to it. The bots made far more than the players did.
  const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)).toISOString().slice(0, 7)
  r.seasonKey = lastMonth
  for (const m of r.members.values()) m.seasonBase = { key: lastMonth, pnl: (m.seasonBase?.pnl ?? 0) - (m.info.bot ? 50_000 + Math.random() * 500 : 300) }
  // (A season closed by an older version, when bots were still ranked, is already in the Hall.)
  r.hall = [{ n: 0, name: 'An older season', winners: [{ list: 'season', name: 'somebot', bot: true }, { list: 'season', name: 'Player' }] }] as never
  const bh = askBoard('season')
  const champs = bh.hall[0]?.winners ?? []
  const people = new Set(['Player', 'Second'])
  ok(bh.hall.length === 2 && champs.some((w) => w.list === 'season') && champs.every((w) => people.has(w.name)), `season closed into the Hall of Fame, real players only: ${champs.map((w) => `${w.list}: ${w.name}`).join(', ')}`)
  ok([...r.members.values()].some((m) => !m.info.bot && m.trophies?.some((t) => t.startsWith('🏆'))) && [...r.members.values()].every((m) => !m.info.bot || !m.trophies?.length), 'the season champion got a 🏆 trophy, and no bot got any')
  ok(bh.hall[1].winners.length === 1 && bh.hall[1].winners[0].name === 'Player', 'a bot that won an older season is not shown in the Hall (the real winners of that season still are)')
  ok(r.seasonKey !== lastMonth, 'the new season started')
}
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
// A World saved while bot names carried a robot: it comes back with plain names everywhere a player can see one.
{
  const mark = ` ${String.fromCodePoint(0x1f916)}`
  const old = JSON.parse(JSON.stringify(world.snapshot())) as { members: { info: { id: string; name: string; bot?: boolean } }[]; wallets: { id: string; name: string; bot?: boolean }[]; market: { tokens: { id: string; creatorName?: string; creatorId?: string; tape: { wallet: string }[] }[] }; posts: { author?: { name: string } }[]; events: { text: string }[] }
  const bot = BOT_ROSTER[0]
  for (const m of old.members) if (m.info.bot) m.info.name += mark
  for (const x of old.wallets) if (x.bot) x.name += mark
  const t = old.market.tokens.find((x) => x.tape.length > 1)!
  Object.assign(t, { creatorName: bot.name + mark, creatorId: bot.id })
  t.tape[0].wallet = bot.name + mark
  old.posts.unshift({ author: { name: bot.name + mark } } as never)
  old.events.unshift({ id: 1, tick: 1, time: 1, kind: 'cook', text: `${String.fromCodePoint(0x1f916)} Somebody cooked $ABC and ${bot.name}${mark} cooked $XYZ`, icon: 'x', tone: 'info' } as never)
  const again = Room.restore(old as never, null)
  const a = again as unknown as { members: Map<string, { info: { name: string; bot?: boolean } }>; wallets: { id: string; name: string; bot?: boolean }[]; market: typeof old.market; posts: typeof old.posts; events: typeof old.events }
  const names = [...a.members.values()].filter((m) => m.info.bot).map((m) => m.info.name)
  ok(names.length === BOT_ROSTER.length && names.every((n) => !n.includes(mark.trim())) && a.members.get(bot.id)!.info.name === bot.name && a.wallets.filter((x) => x.bot).every((x) => !x.name.includes(mark.trim())), 'an older save comes back with plain bot names: players and their public wallets')
  const t2 = a.market.tokens.find((x) => x.id === t.id)!
  ok(t2.creatorName === bot.name && t2.tape[0].wallet === bot.name && a.posts[0].author!.name === bot.name, '…and on the coins they launched, the trades list and their old posts')
  ok(a.events[0].text === `${String.fromCodePoint(0x1f916)} Somebody cooked $ABC and ${bot.name} cooked $XYZ`, "…and in old events (a real player's robot avatar is left alone)")
  again.dispose()
}
world.dispose()
back.dispose()
process.exit(0)
