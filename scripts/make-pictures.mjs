// Makes the pictures that go with the story market's posts, once, ahead of time (never while the game runs).
//   node scripts/make-pictures.mjs            the test batch: the first 20 on the list
//   node scripts/make-pictures.mjs --all      every picture on the list that is not made yet
//   node scripts/make-pictures.mjs --list     what would be made, and what it would cost (asks nobody anything)
//   node scripts/make-pictures.mjs --schnell  the same with the cheaper model (flux-schnell), into its own folder
// Setup: put your Replicate token in the file called .env in this folder (never in the game, a commit or a chat):
//   REPLICATE_API_TOKEN=your-token-here
// Pictures land in bot-data/pictures/<model>/ (private: that folder is never uploaded). They are looked at, one by one,
// before any of them is moved into the game. A picture that exists is never made again, so a run can be stopped.
// The owner's rule holds here as everywhere: no real person, brand, place, famous animal or character, and no
// writing in a picture. A description says what IS there ("an empty hall"): "no people" makes the model draw people.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const TOKEN = process.env.REPLICATE_API_TOKEN?.trim()
const MODEL = process.argv.includes('--schnell') ? 'black-forest-labs/flux-schnell' : (process.env.PICTURE_MODEL ?? 'black-forest-labs/flux-dev')
const PRICE = MODEL.endsWith('schnell') ? 0.003 : MODEL.endsWith('dev') ? 0.025 : 0.04 // dollars a picture, as Replicate listed them (2026-10-10)
// (A folder for each model, so the same list can be made with two of them and compared side by side.)
const OUT = join(ROOT, 'bot-data', 'pictures', MODEL.split('/').pop())

// How a post's picture looks: something a passer-by took on a phone, not a studio shot.
const PHONE = 'amateur phone photo taken by a passer-by, ordinary daylight, slightly off-centre, a little soft, quiet empty surroundings, plain unmarked surfaces'
const PAPER = 'local newspaper photo, on-camera flash, slightly grainy, an empty room behind, plain unmarked surfaces'
// [file name, what is in it, the look]. The file name is the subject and what happened, as the game's posts have them.
const LIST = [
  ['otter-station-master', 'a river otter wearing a small plain navy cap, sitting on a bench on an empty train platform', PHONE],
  ['sloth-counts', 'a sloth sitting at a wooden table looking at a row of apples', PAPER],
  ['duck-library', 'a duck standing on the counter of an empty public library next to a stack of books', PHONE],
  ['dog-bus', 'a scruffy dog sitting alone on a seat of an empty city bus, looking out of the window', PHONE],
  ['cat-salad-bowl', 'a cat curled up asleep inside a large salad bowl on a kitchen counter', PHONE],
  ['hippo-hot-tub', 'a small hippo sitting in an outdoor hot tub in a back garden, looking content', PHONE],
  ['frog-backwards', 'a green frog on a garden path seen from behind, mid-step', PHONE],
  ['penguin-pool', 'a penguin standing at the edge of an empty indoor swimming pool at dusk', PHONE],
  ['horse-shoes', 'a horse in a stable doorway with a pile of mismatched human shoes on the straw beside it', PHONE],
  ['goat-meeting', 'a goat sitting upright on an office chair at an empty meeting table', PAPER],
  ['squirrel-fridge', 'a squirrel perched on the shelf of an open fridge in a kitchen', PHONE],
  ['bear-traffic-cone', 'a small bear cub hugging an orange traffic cone on a quiet empty road', PHONE],
  ['owl-fire-station', 'an owl perched on the bumper of a fire engine inside an empty fire station', PAPER],
  ['pig-shopping-cart', 'a pig sitting in a shopping cart in an empty supermarket car park', PHONE],
  ['koala-fountain', 'a wet koala sitting on the edge of a town square fountain, looking unbothered', PHONE],
  ['pancake-worried', 'a pancake on a plate with a worried face made of blueberries, in a staff kitchen', PHONE],
  ['pizza-counter', 'a whole pizza sitting untouched on a kitchen counter with a small paper crown on it', PHONE],
  ['robot-stuck-chair', 'a small round robot vacuum wedged under a wooden dining chair', PHONE],
  ['robot-crosswalk', 'a small boxy delivery robot waiting at the kerb of an empty pedestrian crossing', PHONE],
  ['console-attic', 'a dusty grey retro games console in an open cardboard box in an attic, lit by a torch', PHONE],
]

const args = process.argv.slice(2)
const todo = (args.includes('--all') ? LIST : LIST.slice(0, 20)).filter(([name]) => !existsSync(join(OUT, `${name}.webp`)))
console.log(`${LIST.length} pictures on the list, ${todo.length} to make with ${MODEL}: about $${(todo.length * PRICE).toFixed(2)}`)
if (args.includes('--list')) {
  for (const [name, what, look] of todo) console.log(`  ${name}: ${what}, ${look}`)
  process.exit(0)
}
if (!TOKEN) {
  console.error('No Replicate token found. Make (or open) the file called .env in the moonrush folder and add a line:\n  REPLICATE_API_TOKEN=your-token-here\nThen run this again. Never paste the token anywhere else.')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function make(prompt) {
  const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '4:3', output_format: 'webp', output_quality: 80, num_outputs: 1 } }),
  })
  if (!res.ok) throw new Error(`Replicate said ${res.status}: ${(await res.text()).slice(0, 300)}`)
  let p = await res.json()
  // (Not ready within the wait: ask again every two seconds, for two minutes at most.)
  for (let i = 0; i < 60 && p.status !== 'succeeded' && p.status !== 'failed' && p.status !== 'canceled'; i++) {
    await sleep(2000)
    p = await (await fetch(p.urls.get, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
  }
  if (p.status !== 'succeeded') throw new Error(`the picture was not made (${p.status}${p.error ? ': ' + p.error : ''})`)
  const url = Array.isArray(p.output) ? p.output[0] : p.output
  const img = await fetch(url)
  if (!img.ok) throw new Error(`could not fetch the picture (${img.status})`)
  return Buffer.from(await img.arrayBuffer())
}

let made = 0
for (const [name, what, look] of todo) {
  try {
    writeFileSync(join(OUT, `${name}.webp`), await make(`${what}, ${look}`))
    made++
    console.log(`  made ${name}.webp (${made} of ${todo.length})`)
  } catch (e) {
    console.error(`  FAILED ${name}: ${e.message}`)
    if (/401|402|403/.test(e.message)) { console.error('Stopping: the token was refused or the account has no credit.'); break }
  }
  await sleep(500)
}
console.log(`Done: ${made} made, about $${(made * PRICE).toFixed(2)} spent. They are in ${OUT}. Tell Claude, who looks at every one before any goes into the game.`)
