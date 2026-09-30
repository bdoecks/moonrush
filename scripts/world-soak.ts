// World soak: run the World for simulated hours and watch its size, speed and memory.
import { Room } from '../server/room'
import { candleStore } from '../src/game/marketEngine'
import { WORLD_CODE } from '../src/net/protocol'

const hours = Number(process.argv[2] ?? 6)
const world = new Room(WORLD_CODE, true)
const w = world as unknown as { tick(): void; market: { tokens: { status: string }[] } }
let t = Date.now()
for (let h = 1; h <= hours; h++) {
  for (let i = 0; i < 3600; i++) w.tick()
  const live = w.market.tokens.filter((x) => x.status === 'bonding' || x.status === 'graduated').length
  const snap = JSON.stringify(world.snapshot()).length
  console.log(`hour ${h}: ${w.market.tokens.length} coins (${live} live), charts ${candleStore.size}, save ${(snap / 1024).toFixed(0)} KB, ${((Date.now() - t) / 3600).toFixed(1)} ms/tick, heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(0)} MB`)
  t = Date.now()
}
world.dispose()
process.exit(0)
