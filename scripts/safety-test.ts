// Chat safety check: rate limit, repeats, blocked words, links in the World, strikes → auto-mute, admin mute, reports.
import { Room } from '../server/room'
import { moderate, nameBlocked } from '../server/moderation'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const sock = (box: ServerMsg[]) => ({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} }) as never

// The filter on its own.
ok(moderate('gm world, $FROG looks ready 🚀').ok && moderate('gm world, $FROG looks ready 🚀').text === 'gm world, $FROG looks ready 🚀', 'normal chat passes untouched')
ok(moderate('raccoon coin and some spice').text === 'raccoon coin and some spice', '"raccoon" and "spice" are not caught by mistake')
const masked = moderate('you are a retard lol')
ok(masked.ok && !/retard/i.test(masked.text) && masked.text.includes('***') && !!masked.strike, `slurs are masked: "${masked.text}"`)
ok(!/r3t4rd/i.test(moderate('you r3t4rd').text), 'swapping letters for numbers doesn\'t get around it')
ok(!moderate('kys loser').ok && !!moderate('kys loser').strike, 'threats / "kys" are refused')
ok(!moderate('free airdrop at scam-site.xyz/claim', { noLinks: true }).ok && moderate('free airdrop at scam-site.xyz/claim').ok, 'links are refused in the World only')
ok(moderate('check https://evil.com now', { noLinks: true }).reason === 'Links aren’t allowed in World chat.', 'the sender is told why')
ok(nameBlocked('xX_faggot_Xx') && !nameBlocked('DegenDave'), 'offensive names are caught')

// In a room.
const aBox: ServerMsg[] = []
const bBox: ServerMsg[] = []
const world = new Room(WORLD_CODE, true)
const w = world as unknown as { handle(pid: string, m: unknown): void; members: Map<string, { mutedUntil?: number; meter?: { times: number[]; lastAt?: number } }>; reports: { text: string; count: number; target: { id: string } }[]; summary(): { reports?: unknown[]; muted?: { id: string }[] } }
world.join(sock(aBox), { t: 'hello', name: 'Alice', avatar: '🐸', level: 1, playerId: 'u-alice', verified: true })
world.join(sock(bBox), { t: 'hello', name: 'Bob', avatar: '🦊', level: 1, playerId: 'u-bob', verified: true })
const chats = (box: ServerMsg[]) => box.filter((m) => m.t === 'chat') as Extract<ServerMsg, { t: 'chat' }>[]
const errors = (box: ServerMsg[]) => box.filter((m) => m.t === 'error').map((m) => (m as { message: string }).message)
const wait = () => { const m = w.members.get('u-alice')!.meter; if (m) { m.times = m.times.map((t) => t - 2000); m.lastAt = (m.lastAt ?? 0) - 2000 } } // pretend 2s passed

w.handle('u-alice', { t: 'chat', text: 'hello world' })
ok(chats(bBox).length === 1 && chats(bBox)[0].text === 'hello world', 'a normal message reaches everyone')
w.handle('u-alice', { t: 'chat', text: 'second message right away' })
ok(chats(bBox).length === 1 && errors(aBox).some((e) => /Slow down/.test(e)), 'sending again instantly is blocked ("Slow down")')
wait()
w.handle('u-alice', { t: 'chat', text: 'hello world' })
ok(chats(bBox).length === 1 && errors(aBox).some((e) => /just said that/.test(e)), 'repeating the same message is blocked')
wait()
w.handle('u-alice', { t: 'chat', text: 'buy now at pump-scam.xyz' })
ok(chats(bBox).length === 1 && errors(aBox).some((e) => /Links/.test(e)), 'links are blocked in World chat')
for (let i = 0; i < 12; i++) { wait(); w.handle('u-alice', { t: 'chat', text: `msg ${i}` }) }
ok(chats(bBox).length <= 10 && errors(aBox).some((e) => /too fast/.test(e)), `more than 10 messages a minute is blocked (${chats(bBox).length} got through)`)

// Bob reports one of Alice's messages; a made-up report is ignored.
const line = chats(bBox)[0]
w.handle('u-bob', { t: 'report', from: 'u-alice', time: line.time, text: 'something she never said' })
ok(w.reports.length === 0, 'a report of a message that was never sent is ignored')
w.handle('u-bob', { t: 'report', from: 'u-alice', time: line.time, text: line.text })
ok(w.reports.length === 1 && w.reports[0].target.id === 'u-alice' && w.reports[0].text === 'hello world' && (world.summary() as { reports?: unknown[] }).reports?.length === 1, 'a real report reaches the admin list')

// Admin mute.
world.mute('u-alice', 60)
aBox.length = 0
const before = chats(bBox).length
w.members.get('u-alice')!.meter = undefined
w.handle('u-alice', { t: 'chat', text: 'can anyone hear me' })
w.handle('u-alice', { t: 'post', text: 'my call $FROG', followers: 0, rep: 50, repeats: 0 })
ok(chats(bBox).length === before && errors(aBox).some((e) => /muted/.test(e)) && (world.summary() as { muted?: { id: string }[] }).muted?.[0]?.id === 'u-alice', 'a muted player can\'t chat or post, and shows as muted for the admin')
world.mute('u-alice', 0)
w.members.get('u-alice')!.meter = undefined
w.handle('u-alice', { t: 'chat', text: 'back again' })
ok(chats(bBox).length === before + 1, 'unmuting lets them talk again')

// Three bad messages → automatic 10-minute mute.
const bob = w.members.get('u-bob')!
for (const text of ['kys', 'kys now', 'kys again']) { if (bob.meter) bob.meter.times = []; w.handle('u-bob', { t: 'chat', text }) }
ok((bob.mutedUntil ?? 0) > Date.now() + 9 * 60_000 && errors(bBox).some((e) => /muted for 10 minutes/.test(e)), 'three refused messages mute the sender automatically for 10 minutes')

// Mutes and reports survive a restart.
world.mute('u-alice', 30)
const back = Room.restore(JSON.parse(JSON.stringify(world.snapshot())), null) as unknown as typeof w & { dispose(): void }
ok(back.reports.length === 1 && (back.members.get('u-alice')!.mutedUntil ?? 0) > Date.now(), 'reports and mutes are saved with the World')
back.dispose()
world.dispose()
process.exit(0)
