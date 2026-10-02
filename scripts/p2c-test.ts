// Phase 2 piece 3 check: cooking, bots, creator fees, cashback, airdrops and claims run on the server's wallets.
import { Room } from '../server/room'
import { cookToken, COOK_FEE } from '../src/game/marketEngine'
import { Rng } from '../src/utils/rng'
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
const spec = { name: 'Test Coin', ticker: 'TSTC', emoji: '🧪', hue: 100, description: '', chain: 'sol', pad: 'pump', tax: { buy: 0, sell: 0 }, devBuy: 1, marketing: 50, narrative: 'meme', socials: { x: true, tg: false, web: false }, style: 'fair', bundle: { wallets: 3, perWallet: 0.5, stagger: false } } as never
const cooked = cookToken(room.market, new Rng(123), spec)
const cashBefore = me().wallet.cash
r.handle('p1', { t: 'cook', seq: 2, ref: 2, token: cooked.token, money: { devWallet: main().id, devBuy: 1, bundle: { wallets: 3, perWallet: 0.5, stagger: false }, marketing: 50 } })
const w1 = lastWallet()
const tok = room.market.tokens.find((t) => t.id === cooked.token.id)
ok(!!tok && (tok as { creatorId?: string }).creatorId === 'p1', 'coin is on the shared market as the player\'s')
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
room.dispose()
process.exit(0)
