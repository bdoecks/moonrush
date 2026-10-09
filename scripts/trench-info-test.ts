// The Trenches card's "who is in it": KOLs and smart money holding a coin, and the dev's migrated / launched.
//   npx tsx scripts/trench-info-test.ts
import { crowdCode, crowdFromCode, crowdMap, crowdOf, devRecord, devRecordBad, devRecordGood, storyLines, storyLive } from '../src/game/coinCrowd'
import { devHistory } from '../src/game/ledger'
import { createMarket, tickMarket } from '../src/game/marketEngine'
import { createWallets, tickWallets } from '../src/game/walletEngine'
import { Rng } from '../src/utils/rng'
import type { SimWallet } from '../src/types'

let failed = 0
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
  if (!cond) failed++
}
const w = (id: string, style: SimWallet['style'], positions: Record<string, number>) => ({ id, style, positions: Object.fromEntries(Object.entries(positions).map(([k, qty]) => [k, { qty, cost: 1 }])) }) as unknown as SimWallet
const list = [w('k1', 'kol', { A: 5, B: 1 }), w('k2', 'kol', { A: 2 }), w('s1', 'smart', { A: 9, C: 3 }), w('wh', 'whale', { A: 100 }), w('sn', 'sniper', { B: 4 }), w('k3', 'kol', { C: 0 })]
ok(crowdOf(list, 'A').kols === 2 && crowdOf(list, 'A').smart === 1, 'a coin held by two KOLs and one smart-money wallet says 2 and 1')
ok(crowdOf(list, 'B').kols === 1 && crowdOf(list, 'B').smart === 0, 'whales and snipers are not counted as either')
ok(crowdOf(list, 'C').kols === 0 && crowdOf(list, 'C').smart === 1, 'a wallet that has sold everything is not counted')
ok(crowdOf(list, 'nobody').kols === 0 && crowdOf(list, 'nobody').smart === 0, 'a coin nobody tracked holds says 0 and 0')
ok(crowdMap(list) === crowdMap(list) && crowdMap([...list]) !== crowdMap(list), 'the counts are worked out once per wallet list, and again when the list changes')
const code = crowdCode(list, 'A')
ok(crowdFromCode(code).kols === 2 && crowdFromCode(code).smart === 1, 'the one-number form reads back the same')

// The dev's record, on a real market.
const rng = new Rng(4242)
let market = createMarket(4242)
let wallets = createWallets(new Rng(99))
for (let i = 0; i < 400; i++) {
  market = tickMarket(market, rng, { rugMult: 1, protectedIds: new Set() }).market
  wallets = tickWallets(wallets, market, rng).wallets
}
const tokens = market.tokens
ok(tokens.every((t) => { const r = devRecord(t); return r.total === devHistory(t).length + 1 && r.migrated <= r.total && r.migrated >= 0 }), `every one of ${tokens.length} coins: launched = the dev's earlier coins plus this one, migrated never more than launched`)
const grad = tokens.find((t) => t.status === 'graduated')
const curve = tokens.find((t) => t.status === 'bonding')
ok(!!grad && devRecord(grad).migrated === devHistory(grad).filter((c) => c.status === 'migrated').length + 1, 'a coin that has migrated counts itself')
ok(!!curve && devRecord(curve).migrated === devHistory(curve).filter((c) => c.status === 'migrated').length, 'a coin still on its curve does not')
ok(tokens.some((t) => devRecord(t).total === 1) && tokens.some((t) => devRecord(t).total >= 5), 'first-time devs show 0/1 or 1/1, serial launchers show long records')
const mine = devRecord({ ...curve!, id: 'mine-3' }, [{ tokenId: 'mine-1', status: 'graduated' }, { tokenId: 'mine-2', status: 'dead' }, { tokenId: 'mine-3', status: 'bonding' }])
ok(mine.migrated === 1 && mine.total === 3, "your own coin reads your own launches: 1 migrated out of 3, this one counted once")
ok(devRecordBad({ migrated: 0, total: 9 }) && !devRecordBad({ migrated: 0, total: 1 }) && !devRecordBad({ migrated: 2, total: 9 }), 'red only for a dev with several coins behind them and almost none migrated (a first coin is never red)')
ok(devRecordGood({ migrated: 1, total: 1 }) && devRecordGood({ migrated: 3, total: 10 }) && !devRecordGood({ migrated: 1, total: 20 }) && !devRecordGood({ migrated: 0, total: 1 }), 'gold for a dev with one in four or better')
const held = tokens.filter((t) => crowdOf(wallets, t.id).kols + crowdOf(wallets, t.id).smart > 0).length
ok(held > 0 && tokens.every((t) => { const c = crowdOf(wallets, t.id); return c.kols === wallets.filter((x) => x.style === 'kol' && (x.positions[t.id]?.qty ?? 0) > 0).length && c.smart === wallets.filter((x) => x.style === 'smart' && (x.positions[t.id]?.qty ?? 0) > 0).length }), `on a running market the counts match the wallets one by one (${held} of ${tokens.length} coins have a KOL or smart money in)`)
// The story leaf.
const beat = (id: number, src: 'market' | 'story' | 'trend', time: number) => ({ id, seq: id, time, kind: 'post', tone: 'info', src, text: 'line ' + id, mcap: 1 }) as never
const feed = { beats: [beat(5, 'market', 990), beat(4, 'story', 980), beat(3, 'trend', 900), beat(2, 'story', 500), beat(1, 'story', 100)] }
ok(storyLines(feed).map((b) => b.id).join() === '4,3,2' && storyLines(feed, 1).length === 1, 'the leaf shows the newest three story lines, and leaves out the facts the market reads off trades')
ok(storyLive(feed, 1000) && !storyLive(feed, 5000) && !storyLive({ beats: [beat(9, 'market', 999)] }, 1000) && !storyLive({}, 1000) && storyLines({}).length === 0, 'it is green only while a story line is recent; a coin with no story, or only trade facts, is grey')
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(0)
