// One player in several tabs (a coin opened in a new browser tab): every tab stays connected, each counts its own
// wallet messages and has its own open coin, and the wallet is the same in all of them.
//   npx tsx scripts/tabs-test.ts
import { Room } from '../server/room'
import type { ServerMsg } from '../src/net/protocol'

let bad = 0
const ok = (cond: boolean, what: string) => {
  if (!cond) bad++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
}
type Sock = { readyState: number; got: ServerMsg[]; closed?: number; send(d: unknown): void; close(code?: number): void }
const sock = (): Sock => {
  const s: Sock = { readyState: 1, got: [], send: (d) => s.got.push(JSON.parse(String(d))), close: (code) => { s.closed = code; s.readyState = 3 } }
  return s
}
type M = { wallet?: { cash: number }; ws: unknown; ack: number; tabs?: Map<unknown, { ack: number; focus?: string }>; info: { online: boolean } }
type R = { handleFrom(ws: unknown, pid: string, m: unknown): void; handle(pid: string, m: unknown): void; members: Map<string, M>; timer: ReturnType<typeof setInterval>; tick(): void }
const room = new Room('TABS')
const r = room as unknown as R
clearInterval(r.timer)
const hello = (playerId: string) => ({ t: 'hello' as const, name: playerId, avatar: '🐸', level: 1, playerId, key: `${playerId}-key`, verified: false })
const wallets = (s: Sock) => s.got.filter((m): m is Extract<ServerMsg, { t: 'wallet' }> => m.t === 'wallet')
const lastWallet = (s: Sock) => wallets(s).at(-1)!

const a1 = sock(), b1 = sock()
room.join(a1 as never, hello('pAlice'))
room.join(b1 as never, hello('pBob'))
r.handle('pAlice', { t: 'start', mode: 'practice', durationTicks: null, engine: 'classic' })
const a2 = sock()
ok(room.join(a2 as never, hello('pAlice')), 'the same player joins from a second tab')
ok(a1.closed === undefined && a1.readyState === 1, 'the first tab is not closed (it used to be told to step aside)')
ok(r.members.get('pAlice')!.tabs?.size === 2, 'the room keeps both connections')
ok(a2.got.some((m) => m.t === 'welcome') && wallets(a2).length > 0, 'the new tab is sent the room and the wallet')

// A wallet message from each tab, each numbered by that tab's own count. (A wallet-layout message carries a number;
// a transfer carries none and is answered under the number its tab is at.)
const cash0 = r.members.get('pAlice')!.wallet!.cash
const send = (ref: number) => ({ t: 'send', ref, to: 'pBob', asset: 'usdc', amount: 5, usd: 5, main: true, fromWallet: 'w-main', fromAddr: 'x' })
const layout = (seq: number) => ({ t: 'layout', seq, layout: { accounts: [{ id: 'w-main', name: 'Main', emoji: '🙂', createdAt: 0 }] } })
const [n1, n2] = [wallets(a1).length, wallets(a2).length]
r.handleFrom(a1, 'pAlice', layout(1))
ok(wallets(a1).length > n1 && lastWallet(a1).ack === 1, 'the first tab gets its answer under its own number (1)')
ok(wallets(a2).length > n2 && lastWallet(a2).ack === 0, 'the second tab gets the same wallet, under ITS number (0: it has sent nothing), so it takes it')
r.handleFrom(a2, 'pAlice', layout(1))
ok(lastWallet(a2).ack === 1 && lastWallet(a1).ack === 1, 'a message from the second tab: it is at 1 now, and the first tab is told under its own 1')
r.handleFrom(a1, 'pAlice', layout(2))
ok(lastWallet(a1).ack === 2 && lastWallet(a2).ack === 1, 'the counts do not mix: the first tab is at 2, the second still at 1')
r.handleFrom(a1, 'pAlice', send(1))
ok(r.members.get('pAlice')!.wallet!.cash === cash0 - 5, 'a transfer sent from the first tab leaves the wallet once')
r.handleFrom(a2, 'pAlice', send(2))
ok(r.members.get('pAlice')!.wallet!.cash === cash0 - 10 && lastWallet(a1).state.cash === cash0 - 10 && lastWallet(a2).state.cash === cash0 - 10, 'a transfer from the second tab leaves the same wallet, and both tabs show the same cash')
ok(lastWallet(a1).ack === 2 && lastWallet(a2).ack === 1, 'each still under its own number')

// What a player should see wherever they are reaches every tab of theirs.
const b2 = sock()
room.join(b2 as never, hello('pBob'))
const recv = (s: Sock) => s.got.filter((m) => m.t === 'recv').length
const [r1, r2] = [recv(b1), recv(b2)]
r.handleFrom(a1, 'pAlice', send(4))
ok(recv(b1) === r1 + 1 && recv(b2) === r2 + 1, 'money that arrives is announced in both of the receiver\'s tabs')
const [t1, t2] = [a1.got.length, a2.got.length]
r.tick()
ok(a1.got.length > t1 && a2.got.length > t2 && a1.got.at(-1)!.t === a2.got.at(-1)!.t, 'the market ticks in both tabs')

// Each tab has its own open coin.
const world = new Room('WORLD', true) as unknown as R & { join: Room['join']; market: { tokens: { id: string }[] } }
clearInterval(world.timer)
process.env.WORLD_GUESTS_PLAY = '1'
const w1 = sock(), w2 = sock()
world.join(w1 as never, hello('pCara'))
world.join(w2 as never, hello('pCara'))
const [c1, c2] = [world.market.tokens[0].id, world.market.tokens[1].id]
world.handleFrom(w1, 'pCara', { t: 'candles', tokenId: c1 })
world.handleFrom(w2, 'pCara', { t: 'candles', tokenId: c2 })
const cara = world.members.get('pCara')!
ok(cara.tabs!.get(w1)!.focus === c1 && (cara.ws === w2 ? (cara as unknown as { focus: string }).focus : cara.tabs!.get(w2)!.focus) === c2, 'each tab has its own coin open on the server')
ok(w1.got.some((m) => m.t === 'candles' && m.tokenId === c1) && !w1.got.some((m) => m.t === 'candles' && m.tokenId === c2), 'a chart that one tab asked for is not sent to the other')

// Closing tabs: only the last one leaving is the player leaving.
room.leave('pAlice', a1 as never)
ok(r.members.get('pAlice')!.info.online && r.members.get('pAlice')!.ws === a2, 'closing one tab leaves the player online, served by the other')
const cashNow = r.members.get('pAlice')!.wallet!.cash
r.handleFrom(a2, 'pAlice', layout(2))
r.handleFrom(a2, 'pAlice', send(5))
ok(r.members.get('pAlice')!.wallet!.cash === cashNow - 5 && lastWallet(a2).ack === 2, 'and that tab carries on under its own count')
const before = r.members.get('pAlice')!.wallet!.cash
r.handleFrom(a1, 'pAlice', send(6))
ok(r.members.get('pAlice')!.wallet!.cash === before, 'a tab the room no longer keeps is not listened to')
room.leave('pAlice', a2 as never)
ok(!r.members.get('pAlice')!.info.online && r.members.get('pAlice')!.ws === null, 'closing the last tab takes the player offline')

// Too many tabs: the oldest steps aside.
const many = Array.from({ length: 7 }, () => sock())
for (const s of many) room.join(s as never, hello('pDan'))
ok(many[0].closed === 4000 && many.slice(1).every((s) => s.closed === undefined) && r.members.get('pDan')!.tabs!.size === 6, 'a seventh tab closes the oldest one (told "opened in another tab"), the other six stay')

// Nothing about connections is saved.
const saved = JSON.stringify(room.snapshot())
ok(!saved.includes('"tabs"') && !saved.includes('readyState'), 'the saved room holds no connections')
const back = Room.restore(JSON.parse(saved)) as unknown as R
clearInterval(back.timer)
ok(back.members.get('pAlice')!.ws === null && !back.members.get('pAlice')!.tabs?.size, 'and a room brought back has everybody offline until they reconnect')

console.log(bad ? `${bad} check(s) failed` : 'all checks passed')
process.exit(bad ? 1 : 0)
