// Guest seats: a guest's id is public, so only the browser holding the seat's private key may rejoin as them.
import { Room } from '../server/room'
import type { ServerMsg } from '../src/net/protocol'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const sock = (box: ServerMsg[]) => ({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} }) as never
type R = { handle(pid: string, m: unknown): void; members: Map<string, { wallet?: { cash: number }; ws: unknown }>; timer: ReturnType<typeof setInterval> }

const room = new Room('SEATS')
const r = room as unknown as R
clearInterval(r.timer)
const hello = (playerId: string, key?: string, verified = false) => ({ t: 'hello' as const, name: playerId, avatar: '🐸', level: 1, playerId, key, verified })

ok(room.join(sock([]), hello('pAlice', 'alice-key')), 'a guest takes a seat with their key')
ok(room.join(sock([]), hello('pBob', 'bob-key')), 'a second guest takes a seat')
r.handle('pAlice', { t: 'start', mode: 'practice', durationTicks: null, engine: 'classic' })
const bobCash = r.members.get('pBob')!.wallet!.cash
const bobWs = r.members.get('pBob')!.ws

ok(!room.join(sock([]), hello('pBob', 'not-bobs-key')), 'joining as Bob with the wrong key is refused')
ok(!room.join(sock([]), hello('pBob')), 'joining as Bob with no key is refused')
ok(r.members.get('pBob')!.ws === bobWs, 'the real Bob stays connected')
r.handle('pAlice', { t: 'send', ref: 1, to: 'pBob', asset: 'usdc', amount: 1, usd: 1, main: true, fromWallet: 'w-main', fromAddr: 'x' })
ok(r.members.get('pBob')!.wallet!.cash === bobCash + 1, "Bob's wallet is untouched by the refused joins (only Alice's real $1 arrived)")

ok(room.join(sock([]), hello('pBob', 'bob-key')), 'Bob gets back in from another tab with his key')
ok(r.members.get('pBob')!.wallet!.cash === bobCash + 1, 'and keeps his wallet')

ok(room.join(sock([]), hello('u-signed', undefined, true)), 'a signed-in player joins without a key (their login proves who they are)')
ok(room.join(sock([]), hello('u-signed', undefined, true)), 'and rejoins from another device')

const back = Room.restore(JSON.parse(JSON.stringify(room.snapshot())))
clearInterval((back as unknown as R).timer)
ok(!back.join(sock([]), hello('pBob', 'not-bobs-key')), 'after a server restart, the wrong key is still refused')
ok(back.join(sock([]), hello('pBob', 'bob-key')), 'and the right key still works')
ok(!JSON.stringify(room.snapshot()).includes('bob-key'), 'the saved room holds only a hash of the key, never the key')
process.exit(0)
