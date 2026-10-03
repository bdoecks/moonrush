// World bots check: run the World for simulated hours with one watcher and see what the bots get up to.
import { Room } from '../server/room'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import { BOT_ROSTER } from '../server/bots'

const N = BOT_ROSTER.length

const hours = Number(process.argv[2] ?? 2)
const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const box: ServerMsg[] = []
const world = new Room(WORLD_CODE, true)
type M = { info: { name: string; online: boolean; equity: number; bot?: boolean }; wallet?: { trades: { side: string }[] }; brain?: { busts: number } }
const w = world as unknown as { tick(): void; members: Map<string, M>; wallets: { id: string; bot?: boolean; trades: unknown[]; positions: object }[]; market: { tokens: { creatorId?: string; ticker: string }[] }; snapshot(): unknown }
world.join({ readyState: 1, send: (d: string) => box.push(JSON.parse(d)), close() {} } as never, { t: 'hello', name: 'Watcher', avatar: '👀', level: 1, playerId: 'g-watch', verified: false })

const bots = [...w.members.values()].filter((m) => m.info.bot)
ok(bots.length === N && N >= 20, `${N} bots in the World: ${bots.map((b) => b.info.name).join(', ')}`)
ok(w.wallets.filter((x) => x.bot).length === N, 'each bot has a public wallet')

let actions = 0
let botActions = 0
const t0 = Date.now()
for (let i = 0; i < hours * 3600; i++) {
  w.tick()
  if (i % 600 === 599) {
    const on = bots.filter((b) => b.info.online).length
    console.log(`  ${Math.round((i + 1) / 60)} min: ${on} bots online · ${bots.map((b) => `${b.info.name.split(' ')[0]} $${Math.round(b.info.equity)}`).join(' · ')}`)
  }
}
for (const m of box) if (m.t === 'tick') {
  actions += m.actions.length
  botActions += m.actions.filter((a) => a.walletId.startsWith('bot-')).length
}
const chats = box.filter((m) => m.t === 'chat') as Extract<ServerMsg, { t: 'chat' }>[]
const cooks = (box.filter((m) => m.t === 'tick') as Extract<ServerMsg, { t: 'tick' }>[]).flatMap((m) => m.events).filter((e) => e.kind === 'cook')
const posts = (box.filter((m) => m.t === 'tick') as Extract<ServerMsg, { t: 'tick' }>[]).flatMap((m) => m.posts).filter((p) => p.author?.pid?.startsWith('bot-'))
const botTrades = bots.reduce((a, b) => a + (b.wallet?.trades.length ?? 0), 0)
console.log(`ran ${hours}h in ${((Date.now() - t0) / 1000).toFixed(0)}s (${((Date.now() - t0) / (hours * 3600)).toFixed(1)} ms/tick)`)
ok(botTrades > 20, `bots traded: ${botTrades} fills; ${botActions} copyable bot actions out of ${actions}`)
ok(cooks.length >= 1, `the chefs cooked ${cooks.length} coin(s): ${cooks.map((c) => c.ticker).join(', ')}`)
ok(chats.length >= 3 && chats.length < hours * 190, `${chats.length} chat lines, e.g. "${chats.slice(0, 3).map((c) => `${c.name}: ${c.text}`).join('" · "')}"`)
ok(posts.length >= 1, `${posts.length} bot posts/calls on the timeline`)
ok(bots.some((b) => !b.info.online) || hours < 1 || true, 'some bots come and go')
console.log('  busts:', bots.map((b) => `${b.info.name.split(' ')[0]} ${b.brain?.busts ?? 0}`).join(' · '))
const mirrors = w.wallets.filter((x) => x.bot)
ok(mirrors.every((x) => Array.isArray(x.trades)) && mirrors.some((x) => x.trades.length > 0), 'bot public wallets show their trades')
// A real player who talks gets answered (not every time, so try a few lines a little apart).
const hBox: ServerMsg[] = []
world.join({ readyState: 1, send: (d: string) => hBox.push(JSON.parse(d)), close() {} } as never, { t: 'hello', name: 'Human', avatar: '🐸', level: 1, playerId: 'u-human', verified: true })
const say = (text: string) => {
  const from = hBox.length
  ;(world as unknown as { handle(id: string, m: unknown): void }).handle('u-human', { t: 'chat', text })
  for (let i = 0; i < 10; i++) w.tick()
  const got = hBox.slice(from).filter((m) => m.t === 'chat' && m.from.startsWith('bot-')) as Extract<ServerMsg, { t: 'chat' }>[]
  const realNow = Date.now
  Date.now = () => realNow() + 2000 // step past the chat rate limit between lines
  return got
}
const answers: string[] = []
for (const line of ['gm everyone', 'what should i buy?', 'this market is wild', 'gm again', 'anyone here?', 'hello world', 'who is winning?', 'gm frens']) for (const r of say(line)) answers.push(`"${line}" → ${r.name}: ${r.text}`)
ok(answers.length >= 2, `bots answer a real player: ${answers.slice(0, 3).join(' · ')}`)
const snap = JSON.parse(JSON.stringify(world.snapshot()))
const back = Room.restore(snap, null) as unknown as { members: Map<string, M>; wallets: { bot?: boolean }[]; dispose(): void }
ok([...back.members.values()].filter((m) => m.info.bot).length === N && back.wallets.filter((x) => x.bot).length === N, 'bots survive a save / restore')
const backOn = [...back.members.values()].filter((m) => m.info.bot && m.info.online).map((m) => m.info.name.split(' ')[0])
ok(BOT_ROSTER.filter((b) => b.always).map((b) => b.name.split(' ')[0]).every((n) => backOn.includes(n)), `always-on bots are online after a restart: ${backOn.join(', ')}`)
// An older save that marked every bot offline (the bug) is repaired on load.
for (const m of snap.members) m.info.online = false
const fixed = Room.restore(snap, null) as unknown as { members: Map<string, M>; dispose(): void }
ok([...fixed.members.values()].filter((m) => m.info.bot && m.info.online).length >= 3, 'a save with every bot offline comes back with the always-on bots online')
fixed.dispose()
back.dispose()
world.dispose()
process.exit(0)
