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
import { LIST } from './picture-list.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'))
const TOKEN = process.env.REPLICATE_API_TOKEN?.trim()
const MODEL = process.argv.includes('--schnell') ? 'black-forest-labs/flux-schnell' : (process.env.PICTURE_MODEL ?? 'black-forest-labs/flux-dev')
const PRICE = MODEL.endsWith('schnell') ? 0.003 : MODEL.endsWith('dev') ? 0.025 : 0.04 // dollars a picture, as Replicate listed them (2026-10-10)
// (A folder for each model, so the same list can be made with two of them and compared side by side.)
const OUT = join(ROOT, 'bot-data', 'pictures', MODEL.split('/').pop())

// The list is in scripts/picture-list.mjs (about 300; each entry says which subject and happening it goes with).
const args = process.argv.slice(2)
const todo = (args.includes('--all') ? LIST : LIST.slice(0, 20)).filter((p) => !existsSync(join(OUT, `${p.name}.webp`)))
console.log(`${LIST.length} pictures on the list, ${todo.length} to make with ${MODEL}: about $${(todo.length * PRICE).toFixed(2)}`)
if (args.includes('--list')) {
  for (const p of todo) console.log(`  ${p.name}: ${p.what}, ${p.look}`)
  process.exit(0)
}
if (!TOKEN) {
  console.error('No Replicate token found. Make (or open) the file called .env in the moonrush folder and add a line:\n  REPLICATE_API_TOKEN=your-token-here\nThen run this again. Never paste the token anywhere else.')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function make(prompt, tries = 0) {
  const res = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '4:3', output_format: 'webp', output_quality: 80, num_outputs: 1 } }),
  })
  // (Replicate lets a small account make 6 pictures a minute: told to wait, wait as long as it says and ask again.)
  if (res.status === 429 && tries < 8) {
    const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 10)
    await sleep((wait + 1) * 1000)
    return make(prompt, tries + 1)
  }
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
for (const { name, what, look } of todo) {
  try {
    writeFileSync(join(OUT, `${name}.webp`), await make(`${what}, ${look}`))
    made++
    console.log(`  made ${name}.webp (${made} of ${todo.length})`)
  } catch (e) {
    console.error(`  FAILED ${name}: ${e.message}`)
    if (/401|402|403/.test(e.message)) { console.error('Stopping: the token was refused or the account has no credit.'); break }
  }
  await sleep(10_500) // (six a minute)
}
console.log(`Done: ${made} made, about $${(made * PRICE).toFixed(2)} spent. They are in ${OUT}. Tell Claude, who looks at every one before any goes into the game.`)
