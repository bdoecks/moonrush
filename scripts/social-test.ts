// Followers are kept by the server. A post reaches people by the server's count; the World starts everyone fresh and
// ignores what a message claims; calls are judged on the server; a friends room starts from the player's own profile
// once and then keeps count itself.
import { Room } from '../server/room'
import { WORLD_CODE, type ServerMsg } from '../src/net/protocol'
import { CALL_SETTLE_TICKS, FOLLOWER_CEILING, POST_COOLDOWN_TICKS } from '../src/game/socialEngine'
import type { SocialProfile } from '../src/types'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const sock = (box: ServerMsg[]) => ({ readyState: 1, send: (d: string | Buffer) => box.push(JSON.parse(String(d))), close() {} }) as never
type Coin = { id: string; ticker: string; status: string; liquidity: number; chain?: string }
type M = { social?: SocialProfile; meter?: unknown; wallet?: { accounts: { id: string }[] } }
type R = { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, M>; market: { tick: number; shillQueue?: { tokenId: string }[]; tokens: Coin[] } }
type SocialMsg = Extract<ServerMsg, { t: 'social' }>
const socials = (box: ServerMsg[]) => box.filter((m): m is SocialMsg => m.t === 'social')
const live = (t: Coin) => (t.status === 'bonding' || t.status === 'graduated') && t.liquidity > 15_000

// ─── The World ───────────────────────────────────────────────────────────────
const world = new Room(WORLD_CODE, true)
const w = world as unknown as R
const box: ServerMsg[] = []
const hello = { t: 'hello' as const, name: 'Caller', avatar: '🐸', level: 1, playerId: 'u-aaa', verified: true }
world.join(sock(box), hello)
const me = () => w.members.get('u-aaa')!
const first = socials(box)[0]?.social
ok(socials(box).length === 1 && first?.followers === 50 && first.rep === 30, `joining the World: the server tells the game its own count, a fresh start (${first?.followers} followers, rep ${first?.rep})`)

// A post that claims five million followers and a perfect reputation.
const [coin, coin2] = w.market.tokens.filter(live)
w.handle('u-aaa', { t: 'post', text: `$${coin.ticker} is going to run`, tokenId: coin.id, followers: 5_000_000, rep: 100, repeats: 0 })
w.tick()
const posted = box.filter((m) => m.t === 'tick').flatMap((m) => (m as { posts?: { author?: { pid?: string; followers: number; rep: number } }[] }).posts ?? []).find((p) => p.author?.pid === 'u-aaa')
ok(!!posted && posted.author!.followers <= 60 && posted.author!.rep === 30, `the post goes out with the server's count (${posted?.author?.followers} followers, rep ${posted?.author?.rep}), not the 5,000,000 the message claimed`)
ok(me().social?.posts === 1 && me().social?.calls.length === 1 && me().social!.followers <= 60, `the call is remembered on the server; a few likes moved followers to ${me().social?.followers}`)
ok(socials(box).length === 2 && socials(box)[1].social.posts === 1, 'the game is sent the new count after the post')

// A buy that claims to come from a huge KOL: nobody copies it.
const mainId = me().wallet!.accounts[0].id
w.handle('u-aaa', { t: 'order', seq: 1, ref: 1, order: { side: 'buy', tokenId: coin2.id, walletIds: [mainId], usdEach: 200, autoSwap: true, kol: { followers: 5_000_000, rep: 100 } } })
const answer = [...box].reverse().find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>
ok((answer.fills ?? []).length > 0 && !answer.note && !(w.market.shillQueue ?? []).some((q) => q.tokenId === coin2.id), 'a buy claiming 5,000,000 followers went through and brought no copy traders')

// The server judges the call when it is old enough, and tells the game.
const rep0 = me().social!.rep
for (let i = 0; i <= CALL_SETTLE_TICKS; i++) w.tick()
const judged = socials(box).find((m) => m.results?.length)
ok(!!judged && judged.results![0].tokenId === coin.id && me().social!.calls[0].settled === true && me().social!.rep !== rep0,
  `the call was judged by the server: ran ${judged?.results?.[0].x.toFixed(2)}x, rep ${rep0} → ${me().social?.rep}, followers ${judged?.results?.[0].dFollowers}`)

// Saved with the World, and told again on rejoining. A guest who only watches has no count.
const snap = JSON.parse(JSON.stringify(world.snapshot()))
const back = Room.restore(snap, null) as unknown as R & { dispose(): void }
ok(back.members.get('u-aaa')?.social?.posts === 1 && back.members.get('u-aaa')?.social?.followers === me().social!.followers, 'followers and calls are saved with the World')
back.dispose()
const box2: ServerMsg[] = []
world.join(sock(box2), hello)
ok(socials(box2)[0]?.social.followers === me().social!.followers && socials(box2)[0].social.rep === me().social!.rep, 'on rejoining, the game is told the server\'s count again')
const gBox: ServerMsg[] = []
world.join(sock(gBox), { t: 'hello', name: 'Guest', avatar: '👀', level: 1, playerId: 'g-bbb', verified: false })
ok(socials(gBox).length === 0 && !w.members.get('g-bbb')?.social, 'a World guest (watching only) has no count')
world.dispose()

// ─── A friends room ──────────────────────────────────────────────────────────
const room = new Room('SOCL')
const r = room as unknown as R
const rb: ServerMsg[] = []
room.join(sock(rb), { t: 'hello', name: 'Friend', avatar: '🐸', level: 1, playerId: 'p1' })
r.handle('p1', { t: 'start', mode: 'practice', durationTicks: null, engine: 'classic' })
const p1 = () => r.members.get('p1')!
ok(socials(rb).length === 0 && !p1().social, 'a friends room has no count for a player until it is needed')
r.handle('p1', { t: 'post', text: 'gm from my own profile', followers: 30_000, rep: 60, repeats: 0 })
const seeded = p1().social
ok(!!seeded && seeded.followers >= 30_000 && seeded.followers < 34_000 && seeded.rep === 60, `the first post starts the room from the player's own profile (${seeded?.followers} followers, rep ${seeded?.rep})`)
ok(socials(rb).at(-1)?.social.followers === seeded?.followers, 'and the game is sent that count')
for (let i = 0; i <= POST_COOLDOWN_TICKS; i++) r.tick()
p1().meter = undefined // the chat rate limit runs on real time; these posts are seconds apart in game time only
r.handle('p1', { t: 'post', text: 'now with many more followers, honest', followers: 900_000, rep: 100, repeats: 0 })
ok(p1().social?.posts === 2 && p1().social!.followers < 40_000 && p1().social!.rep === 60, `a later message claiming 900,000 is ignored (${p1().social?.followers} followers, rep ${p1().social?.rep})`)
p1().meter = undefined
r.handle('p1', { t: 'post', text: 'and again right away', followers: 30_000, rep: 60, repeats: 0 })
ok(p1().social?.posts === 2, 'a post inside the cooldown is not counted')
const pb: ServerMsg[] = []
room.join(sock(pb), { t: 'hello', name: 'Cheat', avatar: '🦊', level: 1, playerId: 'p2' })
r.handle('p2', { t: 'post', text: 'hello', followers: 5e12, rep: 5000, repeats: 0 })
ok(r.members.get('p2')?.social !== undefined && r.members.get('p2')!.social!.followers <= FOLLOWER_CEILING + 10_000 && r.members.get('p2')!.social!.rep === 100, `an absurd first claim is cut to the ceiling (${r.members.get('p2')?.social?.followers} followers, rep ${r.members.get('p2')?.social?.rep})`)
room.dispose()
process.exit(0)
