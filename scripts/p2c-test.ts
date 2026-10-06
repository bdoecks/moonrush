// Phase 2 piece 3 check: cooking, bots, creator fees, cashback, airdrops and claims run on the server's wallets.
import { Room } from '../server/room'
import { coinLook, embeddedImage } from '../server/moderation'
import { saveSafe } from '../server/persist'
import { whole } from '../src/game/textRules'
import { cookToken, COOK_FEE } from '../src/game/marketEngine'
import { Rng } from '../src/utils/rng'
import { walletAddress } from '../src/utils/address'
import type { ServerMsg } from '../src/net/protocol'

const inbox: ServerMsg[] = []
const ws = { readyState: 1, send: (d: string) => inbox.push(JSON.parse(d)), close() {} } as never
const room = new Room('TESTA')
const r = room as unknown as { tick(): void; handle(pid: string, m: unknown): void; members: Map<string, { wallet: { cash: number; accounts: { id: string; balances: Record<string, number>; positions: Record<string, { qty: number }> }[] }; cashback?: Record<string, number> }> }
const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const lastWallet = () => [...inbox].reverse().find((m) => m.t === 'wallet') as Extract<ServerMsg, { t: 'wallet' }>

room.join(ws, { t: 'hello', name: 'Tester', avatar: '🐸', level: 1, playerId: 'p1' })
r.handle('p1', { t: 'start', mode: 'practice', durationTicks: null, engine: 'classic' })
const me = () => r.members.get('p1')!
const main = () => me().wallet.accounts[0]
const cash0 = me().wallet.cash
console.log('start cash', cash0)

// Swap USD into SOL so the dev wallet can pay.
r.handle('p1', { t: 'op', seq: 1, op: { kind: 'swap', from: 'usd', to: 'sol', amount: 2000, walletId: main().id } })
const sol0 = main().balances.sol
ok(sol0 > 0, `swapped into SOL: ${sol0.toFixed(3)}`)

// Cook with a dev buy of 1 SOL, marketing $50, and a 3-wallet bundle of 0.5 SOL each.
const spec = { name: 'Test Coin', ticker: 'TSTC', emoji: '🧪', hue: 100, description: '', chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, devBuy: 1, marketing: 50, narrative: 'dogs', socials: { x: true, tg: false, web: false }, style: 'fair', bundle: { wallets: 3, perWallet: 0.5, stagger: false } } as never
const cooked = cookToken(room.market, new Rng(123), spec)
const cashBefore = me().wallet.cash
r.handle('p1', { t: 'cook', seq: 2, ref: 2, token: cooked.token, money: { devWallet: main().id, devBuy: 1, bundle: { wallets: 3, perWallet: 0.5, stagger: false }, marketing: 50 } })
const w1 = lastWallet()
const tok = room.market.tokens.find((t) => t.id === cooked.token.id)
ok(!!tok && (tok as { creatorId?: string }).creatorId === 'p1', 'coin is on the shared market as the player\'s')
ok((tok as { devAddr?: string } | undefined)?.devAddr === walletAddress('p1', main().id, 'sol'), `coin carries its dev wallet's real address (trackable): ${(tok as { devAddr?: string } | undefined)?.devAddr}`)
ok(w1.ref === 2 && (w1.fills ?? []).length === 2, `server ran dev buy + bundle: ${(w1.fills ?? []).length} fills, ${(w1.failures ?? []).join(',')}`)
ok((w1.fills ?? [])[1]?.via === 'Bundle ×3', 'bundle fill labelled')
const fees = COOK_FEE + 50 + 3 * 0.4
ok(Math.abs(cashBefore - me().wallet.cash - fees) < 1e-6, `charged launch fees ${fees}: ${(cashBefore - me().wallet.cash).toFixed(2)}`)
ok(Math.abs(main().balances.sol - (sol0 - 2.5)) < 1e-6, `dev wallet paid 2.5 SOL: ${(sol0 - main().balances.sol).toFixed(4)}`)
const bag = main().positions[cooked.token.id]?.qty ?? 0
ok(bag > 0, `dev bag ${bag.toFixed(0)}`)
const cb1 = me().cashback?.sol ?? 0
ok(cb1 > 0, `cashback counted on the cook fills: ${cb1.toExponential(3)} SOL`)

// Cooking again right away is blocked (cooldown), and costs nothing.
const cashC = me().wallet.cash
const again = cookToken(room.market, new Rng(456), spec)
r.handle('p1', { t: 'cook', seq: 3, ref: 3, token: again.token, money: { devWallet: main().id, devBuy: 0, marketing: 0 } })
ok((lastWallet().failures ?? [])[0]?.includes('cooling') && me().wallet.cash === cashC, 'cooldown enforced by the server')

// A buy by the player: cashback grows.
r.handle('p1', { t: 'order', seq: 4, ref: 4, order: { side: 'buy', tokenId: cooked.token.id, walletIds: [main().id], usdEach: 100 } })
ok((me().cashback?.sol ?? 0) > cb1, 'cashback grows on orders')

// Volume bot: paid from the dev wallet on the server.
const solBot = main().balances.sol
r.handle('p1', { t: 'bot', tokenId: cooked.token.id, bot: { on: true, rate: 2000, budget: 50, spent: 0, volume: 0, startedTick: 0 } })
for (let i = 0; i < 5; i++) r.tick()
ok(main().balances.sol < solBot, `bot charged the dev wallet: ${(solBot - main().balances.sol).toFixed(5)} SOL`)
// Tampering: the game says the bot has spent nothing; the server keeps its own count.
r.handle('p1', { t: 'bot', tokenId: cooked.token.id, bot: { on: true, rate: 2000, budget: 50, spent: 0, volume: 0, startedTick: 0 } })
const bots = (room as unknown as { bots: Map<string, { spent: number }> }).bots
ok((bots.get(cooked.token.id)?.spent ?? 0) > 0, `server keeps the bot's spend: $${bots.get(cooked.token.id)?.spent.toFixed(3)}`)

// Creator fees accrue in the vault; claiming pays them into the dev wallet.
for (let i = 0; i < 40; i++) r.tick()
const cookedMap = (room as unknown as { cooked: Map<string, { vault: number }> }).cooked
const vault = cookedMap.get(cooked.token.id)!.vault
ok(vault > 0, `vault has ${vault.toExponential(3)} SOL of creator fees`)
const solClaim = main().balances.sol
r.handle('p1', { t: 'op', seq: 5, op: { kind: 'claimFees' } })
ok(Math.abs(main().balances.sol - solClaim - vault) < 1e-9 && cookedMap.get(cooked.token.id)!.vault === 0, 'claimed fees went to the dev wallet, vault empty')
ok(lastWallet().state.vaults?.[cooked.token.id] === 0, 'wallet message shows vaults')

// Cashback claim as USDC.
const pend = me().cashback!.sol
const cashCb = me().wallet.cash
r.handle('p1', { t: 'op', seq: 6, op: { kind: 'cashback', chains: ['sol'], as: 'usdc' } })
ok(me().wallet.cash > cashCb && me().cashback!.sol === 0, `cashback ${pend.toExponential(3)} SOL paid as $${(me().wallet.cash - cashCb).toFixed(4)} USDC`)

// Airdrop 10% of the dev bag to 5 holders; a fake queue can't dump more than was given.
const bagA = main().positions[cooked.token.id].qty
const give = bagA * 0.1
r.handle('p1', { t: 'airdrop', seq: 7, tokenId: cooked.token.id, walletId: main().id, qty: give, wallets: 5, target: 'holders', queue: [{ tokenId: cooked.token.id, atTick: room.market.tick + 2, usd: 0, wallet: 'x', side: 'sell', qty: 1e11 }] })
ok(Math.abs(main().positions[cooked.token.id].qty - (bagA - give)) < 1e-6, 'airdropped tokens left the dev wallet')
const q = (room.market.shillQueue ?? []).filter((x) => x.tokenId === cooked.token.id && x.side === 'sell')
ok(q.reduce((a, x) => a + (x.qty ?? 0), 0) <= give + 1e-6, 'dumpers capped at what was airdropped')

// Convert: SOL in the main wallet → BNB in the same wallet, one fee, on the server.
const solC = main().balances.sol
const bnbC = main().balances.bsc
r.handle('p1', { t: 'op', seq: 20, op: { kind: 'convert', from: 'sol', to: 'bsc', amount: 1, fromWallet: main().id, toWallet: main().id } })
const gotBnb = main().balances.bsc - bnbC
const rate = room.market.native.sol.price / room.market.native.bsc.price
ok(Math.abs(main().balances.sol - (solC - 1)) < 1e-9 && Math.abs(gotBnb - rate * 0.997) < 1e-6, `convert 1 SOL → ${gotBnb.toFixed(4)} BNB at the market rate minus 0.3%`)
r.handle('p1', { t: 'op', seq: 21, op: { kind: 'convert', from: 'bsc', to: 'usd', amount: 999, fromWallet: main().id, toWallet: main().id } })
ok(Math.abs(main().balances.bsc - (bnbC + gotBnb)) < 1e-9, 'converting more than you have is refused')

// The old trusted paths do nothing now.
const cashT = me().wallet.cash
r.handle('p1', { t: 'adjust', seq: 8, delta: { cash: 1e6, realized: 0, feesPaid: 0, balances: {}, positions: {}, trades: [], tradedTokens: [] } })
r.handle('p1', { t: 'trade', tokenId: cooked.token.id, side: 'buy', usd: 1e6, qty: 0 })
ok(me().wallet.cash === cashT, 'fake "adjust" money is ignored')

// Saving: the cooked coin and vault survive a restore.
const snap = JSON.parse(JSON.stringify(room.snapshot()))
const back = Room.restore(snap, null) as unknown as { cooked: Map<string, unknown>; members: Map<string, { cashback?: unknown; cooks?: number }>; dispose(): void }
ok(back.cooked.has(cooked.token.id) && back.members.get('p1')?.cooks === 1, 'cooked coins and cook count saved with the room')
back.dispose()

// The coin's look (name, ticker, description, picture) and its id are checked by the server before anything is
// charged: a changed game could send anything, and everyone in the room sees it.
for (let i = 0; i < 31; i++) r.tick() // past the kitchen cooldown
const chr = (...codes: number[]) => String.fromCharCode(...codes) // odd characters by number, so this file has none
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // a real 1 × 1 picture
const gifSized = (w: number, h: number) => `data:image/gif;base64,${Buffer.concat([Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0, 0, 0])]).toString('base64')}`
let seqL = 40
const tryCook = (look: Record<string, unknown>) => {
  seqL++
  const t = cookToken(room.market, new Rng(1000 + seqL), { ...spec, name: 'Look Coin', ticker: 'LOOK' }).token
  const token = { ...t, id: `look-${seqL}`, ...look }
  r.handle('p1', JSON.parse(JSON.stringify({ t: 'cook', seq: seqL, ref: seqL, token, money: { devWallet: main().id, devBuy: 0, marketing: 0 } }))) // as it arrives off the wire
  return { why: (lastWallet().failures ?? [])[0] ?? '', coin: room.market.tokens.find((x) => x.id === token.id) }
}
const cooksOf = () => (me() as unknown as { cooks?: number }).cooks
const cashL = me().wallet.cash
ok(tryCook({ name: 'x' }).why.includes('2–24'), 'a one-letter coin name is refused')
ok(tryCook({ name: chr(0x3164, 0x3164, 0x3164) }).why.includes('2–24') && tryCook({ name: '!! ??' }).why.includes('two letters'), 'a name of blank or invisible characters, or of punctuation only, is refused')
ok(tryCook({ ticker: 'lower' }).why.includes('Ticker') && tryCook({ ticker: 'WAYTOOLONGTICKER' }).why.includes('Ticker') && tryCook({ ticker: 'A B' }).why.includes('Ticker') && tryCook({ ticker: ['LOOK'] }).why.includes('Ticker'), 'a ticker that is not 2–8 capital letters or digits is refused')
ok(tryCook({ name: 'kys coin' }).why.includes('isn’t allowed'), 'a coin name with a blocked phrase is refused')
ok(tryCook({ ticker: 'ANIGGER' }).why.includes('isn’t allowed') && tryCook({ name: 'MyNigga Coin' }).why.includes('isn’t allowed') && tryCook({ name: `n${chr(0x2060)}igger coin` }).why.includes('isn’t allowed') && tryCook({ name: `nigg${chr(0x0430)} coin` }).why.includes('isn’t allowed'),
  'a slur inside a longer word, split by an invisible character, or spelled with look-alike letters is refused')
ok(typeof coinLook({ name: 'Maine Coon', ticker: 'MAINE', emoji: '🐱' }) !== 'string' && typeof coinLook({ name: 'Raccoon Spice', ticker: 'RACC', emoji: '🦝' }) !== 'string' && typeof coinLook({ name: 'Nigeria Rising', ticker: 'NGR', emoji: '🚀' }) !== 'string', 'innocent names that contain those letters are fine (Maine Coon, Raccoon Spice, Nigeria Rising)')
ok(tryCook({ ticker: 'TSTC' }).why.includes('already exists'), 'a ticker that is already live is refused')
ok(tryCook({ image: 'https://example.com/pixel.png' }).why.includes('uploaded'), 'a picture link is refused (every other player’s browser would fetch it)')
ok(tryCook({ image: 'data:image/svg+xml;base64,AAAA' }).why.includes('can’t be used') && tryCook({ image: 'javascript:alert(1)' }).why.includes('can’t be used') && tryCook({ image: 'data:image/png;base64,iVBORw0KGgo=' }).why.includes('can’t be used') && tryCook({ image: { toString: 1, valueOf: 1 } }).why.includes('can’t be used'),
  'a picture that is not an embedded JPG, WebP or GIF is refused')
ok(tryCook({ image: `data:image/gif;base64,${'A'.repeat(64_001)}` }).why.includes('too big'), 'an oversized picture is refused, not cut in half')
ok(me().wallet.cash === cashL && cooksOf() === 1, 'the refused launches cost nothing and do not count as a launch')
ok(tryCook({ image: gifSized(16000, 16000) }).why.includes('can’t be used') && tryCook({ image: gifSized(0, 10) }).why.includes('can’t be used') && !tryCook({ image: gifSized(1024, 1024), name: 'Big Pic', ticker: 'BIGP' }).why,
  'a small file that claims to be a huge picture (16,000 × 16,000) is refused; 1,024 × 1,024 is fine')
const cashAfterGood = me().wallet.cash
ok(cashAfterGood < cashL && cooksOf() === 2, 'the good launch was charged and counted')
for (let i = 0; i < 31; i++) r.tick()
ok(tryCook({ narrative: 'made-up' }).why.includes('narrative'), 'an unknown narrative is refused')
// The id: a list holding a live coin's id reads the same as that id once it is text, and used to take the coin's place.
const liveId = cooked.token.id
const liveBefore = JSON.stringify(room.market.tokens.find((x) => x.id === liveId)?.ticker)
ok(tryCook({ id: [liveId] }).why.includes('can’t be launched') && tryCook({ id: 'constructor' }).why.includes('can’t be launched') && tryCook({ id: { toString: 1, valueOf: 1 } }).why.includes('can’t be launched') && tryCook({ id: liveId }).why.includes('already exists'),
  'a launch whose id is a list, an object, a built-in name or a live coin’s id is refused')
ok(room.market.tokens.filter((x) => x.id === liveId).length === 1 && JSON.stringify(room.market.tokens.find((x) => x.id === liveId)?.ticker) === liveBefore, 'the live coin is still there, once, untouched')
ok(me().wallet.cash === cashAfterGood && cooksOf() === 2, 'those refused launches cost nothing either (only the one good launch was charged and counted)')
for (let i = 0; i < 31; i++) r.tick()
const rocket = chr(0xd83d, 0xde80)
const tidy = tryCook({ name: `  Tidy${chr(0x202e)}   Coin${chr(0xd83d)}\n`, ticker: 'TIDY', emoji: 'RUDE', hue: 9999, description: `a  retard  wrote this ${'xy '.repeat(39)}xy${rocket}`, image: GIF })
ok(!tidy.why && tidy.coin?.name === 'Tidy Coin' && tidy.coin.emoji === '🪙' && tidy.coin.hue === 360 && tidy.coin.description.startsWith('a ****** wrote this') && tidy.coin.image === GIF,
  `a good launch goes through cleaned up: "${tidy.coin?.name}" ${tidy.coin?.emoji} hue ${tidy.coin?.hue} "${tidy.coin?.description.slice(0, 22)}…" ${tidy.why}`)
const t3 = tidy.coin!
ok(t3.description.length <= 140 && whole(t3.name + t3.description + t3.emoji) === t3.name + t3.description + t3.emoji, 'no half emoji is left by the cut at 140 characters or by a half sent on purpose')
ok(typeof coinLook({ name: 'Family', ticker: 'FAM', emoji: `${chr(0xd83d, 0xdc68)}${chr(0x200d)}${chr(0xd83d, 0xdc69)}` }) !== 'string' && (coinLook({ name: 'Family', ticker: 'FAM', emoji: `${chr(0xd83d, 0xdc68)}${chr(0x200d)}${chr(0xd83d, 0xdc69)}` }) as { emoji: string }).emoji.length === 5 && (coinLook({ name: 'Sign', ticker: 'SIGN', emoji: chr(0x0fd5) }) as { emoji: string }).emoji === '🪙',
  'an emoji made of joined parts stays whole; a symbol that is not an emoji becomes the coin emoji')
// Saving: the database refuses half an emoji and the NUL character anywhere in a room.
const savedText = JSON.stringify(room.snapshot())
ok(saveSafe(savedText) === savedText, 'the room’s save has no half emoji and no NUL in it')
const bs = chr(92)
const cleaned = JSON.parse(saveSafe(JSON.stringify({ a: `x${chr(0xd83d)}y${chr(0)}z`, b: `${rocket} ${bs}ud83d` })))
ok(cleaned.a === `x${chr(0xfffd)}y${chr(0xfffd)}z` && cleaned.b === `${rocket} ${bs}ud83d`, 'if one ever gets in, the save swaps it for the unknown-character mark (a whole emoji and a typed backslash are left alone)')
// Trade records on the server carry no copy of the coin's picture (300 small trades made a 60 MB save).
r.handle('p1', { t: 'order', seq: ++seqL, ref: seqL, order: { side: 'buy', tokenId: tidy.coin!.id, walletIds: [main().id], usdEach: 20, autoSwap: true } })
const fillL = (lastWallet().fills ?? [])[0] as { image?: string; tokenId: string } | undefined
ok(fillL?.tokenId === tidy.coin!.id && fillL.image === undefined && !JSON.stringify((me().wallet as unknown as { trades: unknown[] }).trades).includes('data:image'), 'a buy of a coin with a picture: the trade record and the answer carry no copy of the picture')
// The picture goes out to everyone once, not again on every refresh turn.
const withPic = () => inbox.filter((m) => m.t === 'tick').filter((m) => ((m as unknown as { market: { tokens: { id: string; image?: string }[] } }).market.tokens.find((x) => x.id === tidy.coin!.id)?.image ?? '') !== '').length
for (let i = 0; i < 260; i++) r.tick()
ok(withPic() === 1, `over 260 ticks (two full refresh turns) the coin's picture was sent once: ${withPic()}`)
// Something a player did to their own coin: only the game's three kinds, in the server's own words.
const eventsNow = () => inbox.filter((m) => m.t === 'tick').flatMap((m) => (m as unknown as { events: { text: string; kind: string }[] }).events ?? [])
r.handle('p1', { t: 'event', event: { id: 1, tick: 1, time: 1, kind: 'alpha', tokenId: tidy.coin!.id, ticker: 'TIDY', text: 'GOING PARABOLIC join t.me/scam', icon: '🚀', tone: 'up' } })
r.handle('p1', { t: 'event', event: { id: 1, tick: 1, time: 1, kind: 'devsell', tokenId: tidy.coin!.id, ticker: 'TIDY', text: 'Dev (you) sold 40% of their $TIDY bag. visit scam.com', icon: '🚀', tone: 'up' } })
r.handle('p1', { t: 'event', event: { kind: 'devsell', tokenId: liveId, text: { toString: 1 } } })
r.tick()
const shown = eventsNow().filter((e) => /scam|PARABOLIC/.test(e.text))
const devLine = eventsNow().find((e) => e.kind === 'devsell' && e.text === 'Dev (Tester) sold 40% of their $TIDY bag')
ok(shown.length === 0 && !!devLine, `a made-up event is dropped and a real one goes out in the server's words: "${devLine?.text}"`)
const worldLook = { name: 'Visit scam.com', ticker: 'SCAM', emoji: '🐸' }
ok(typeof coinLook(worldLook, { noLinks: true }) === 'string' && typeof coinLook(worldLook) !== 'string', 'a link in a coin name is refused in the World only (as in chat)')
ok(String(coinLook({ name: 'Fine Coin', ticker: 'FINE', emoji: '🐸', description: 'join www.scam.io now' }, { noLinks: true })).includes('Links') && String(coinLook({ name: 'Fine Coin', ticker: 'FINE', emoji: '🐸', description: 'alpha in t.me/pumpgrp' }, { noLinks: true })).includes('Links'), 'a link in a World coin’s description is refused')
ok(typeof coinLook({ name: 'Trench Pup', ticker: 'TPUP', emoji: '🐶', description: 'Fair launch on pump.fun, no presale. Then bonk.fun and long.xyz' }, { noLinks: true }) !== 'string', 'naming the game’s own launchpads (pump.fun, bonk.fun, long.xyz) is not a link')
// The picture's size is read from the file's first bytes, for each kind the game's picker makes.
{
  const url = (type: string, bytes: number[]) => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
  const jpeg = (w: number, h: number) => [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3, ...Array(12).fill(0)]
  const webpX = (w: number, h: number) => [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, 0, 0, 0, 0, (w - 1) & 255, ((w - 1) >> 8) & 255, (w - 1) >> 16, (h - 1) & 255, ((h - 1) >> 8) & 255, (h - 1) >> 16]
  const webpLossy = (w: number, h: number) => [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, w & 255, w >> 8, h & 255, h >> 8]
  ok(embeddedImage(url('jpeg', jpeg(160, 160))) && embeddedImage(url('webp', webpX(160, 160))) && embeddedImage(url('webp', webpLossy(160, 160))) && embeddedImage(GIF), 'pictures the size the game makes (160 × 160) are accepted: JPG, both kinds of WebP, GIF')
  ok(!embeddedImage(url('jpeg', jpeg(20000, 20000))) && !embeddedImage(url('webp', webpX(16000, 16000))) && !embeddedImage(url('webp', webpLossy(16000, 100))), 'the same files claiming to be enormous are refused')
  ok(!embeddedImage(url('jpeg', ascii('GIF89a').concat([1, 0, 1, 0, 0, 0, 0]))) && !embeddedImage(url('gif', ascii('not a picture at all'))) && !embeddedImage(url('webp', [])), 'a file that is not what it says it is, or no picture at all, is refused')
}
// A coin saved with a picture link (before this check) comes back without it, and saved trades lose picture copies.
const snapL = JSON.parse(JSON.stringify(room.snapshot()))
snapL.market.tokens[0].image = 'https://example.com/pixel.png'
snapL.market.tokens[1].image = GIF
snapL.members[0].wallet.trades[0].image = 'https://example.com/pixel.png'
const backL = Room.restore(snapL, null)
const backMe = (backL as unknown as { members: Map<string, { wallet: { trades: { image?: string }[] } }> }).members.get('p1')!
ok(backL.market.tokens[0].image === undefined && backL.market.tokens[1].image === GIF && backMe.wallet.trades.every((t) => t.image === undefined), 'on load: a saved coin’s picture link is dropped, an uploaded picture is kept, trades carry no pictures')
backL.dispose()
room.dispose()
process.exit(0)
