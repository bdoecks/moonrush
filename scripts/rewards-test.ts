// World rewards that pay money: the daily check-in (once a day, the server keeps the streak) and missions (capped a
// day). Paid like a gift: net worth goes up, trading profit doesn't.
import { Room } from '../server/room'
import { CHECKIN_REWARDS, REWARD_USD_PER_DAY } from '../src/game/rewardsEngine'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const box: ServerMsg[] = []
const world = new Room(WORLD_CODE, true)
type M = { wallet: { cash: number; startBalance: number }; checkIn?: { day: string; streak: number } }
const w = world as unknown as { handle(id: string, m: unknown): void; members: Map<string, M>; snapshot(): unknown; timer: ReturnType<typeof setInterval> }
clearInterval(w.timer)
world.join({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} } as never, { t: 'hello', name: 'P', avatar: '🐸', level: 1, playerId: 'u-p', verified: true })
const me = () => w.members.get('u-p')!
const lastNote = () => ([...box].reverse().find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>)?.note ?? ''
let seq = 1
const op = (o: unknown) => w.handle('u-p', { t: 'op', seq: seq++, op: o })

const cash0 = me().wallet.cash
const start0 = me().wallet.startBalance
op({ kind: 'reward', what: 'checkin' })
ok(me().wallet.cash === cash0 + CHECKIN_REWARDS[0] && me().wallet.startBalance === start0 + CHECKIN_REWARDS[0], `day 1 check-in pays $${CHECKIN_REWARDS[0]}, counted as money put in (not profit): "${lastNote()}"`)
op({ kind: 'reward', what: 'checkin' })
ok(me().wallet.cash === cash0 + CHECKIN_REWARDS[0], 'a second check-in the same day pays nothing')

// A streak: yesterday's check-in makes today day 2.
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
me().checkIn = { day: yesterday, streak: 6 }
const c1 = me().wallet.cash
op({ kind: 'reward', what: 'checkin' })
ok(me().wallet.cash === c1 + CHECKIN_REWARDS[6] && me().checkIn?.streak === 7, `after six days in a row, today is day 7: +$${CHECKIN_REWARDS[6]}`)

// Missions: paid, but never more than the daily cap, and never more than $2,500 for one.
const c2 = me().wallet.cash
op({ kind: 'reward', what: 'mission', usd: 300, title: 'Make 75 trades' })
ok(me().wallet.cash === c2 + 300 && /Make 75 trades: \+\$300/.test(lastNote()), `a mission pays its money: "${lastNote()}"`)
op({ kind: 'reward', what: 'mission', usd: 1_000_000, title: 'Made up' })
ok(me().wallet.cash === c2 + 300 + 2_500, 'one mission pays at most $2,500, whatever the game asks')
for (let i = 0; i < 5; i++) op({ kind: 'reward', what: 'mission', usd: 2_500, title: 'More' })
ok(me().wallet.cash === c2 + REWARD_USD_PER_DAY && /used up/.test(lastNote()), `mission money stops at $${REWARD_USD_PER_DAY.toLocaleString('en-US')} a day: "${lastNote()}"`)

// It's kept across a restart (so a restart doesn't hand out a second check-in).
const back = Room.restore(JSON.parse(JSON.stringify(world.snapshot())), null) as unknown as { members: Map<string, M>; handle(id: string, m: unknown): void; dispose(): void }
ok(back.members.get('u-p')?.checkIn?.day === new Date().toISOString().slice(0, 10), 'the check-in day is saved with the World')
back.dispose()
world.dispose()
process.exit(0)
