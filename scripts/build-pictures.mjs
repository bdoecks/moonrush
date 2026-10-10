// Puts the story market's pictures into the game: every picture on the list that has been made AND kept (a rejected
// one is moved out of the folder, see make-pictures.mjs) is shrunk to feed size into public/posts/, and
// src/data/sparkPics.ts is written from the same list (which subject and happening each picture goes with).
//   node scripts/build-pictures.mjs
// Uses the installed Chrome / Edge to shrink them (CHROME_PATH to override), as the UI bots do.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { LIST } from './picture-list.mjs'
import { AVATARS } from './avatar-list.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FROM = join(ROOT, 'bot-data', 'pictures', 'flux-dev')
const TO = join(ROOT, 'public', 'posts')
const WIDTH = 640, HEIGHT = 480, QUALITY = 0.74
const { chromium } = createRequire(import.meta.url)('playwright-core')
const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p))
if (!exe) throw new Error('No Chrome or Edge found: set CHROME_PATH')

const have = LIST.filter((p) => existsSync(join(FROM, `${p.name}.webp`)))
// A short file name for each (the list's names carry the whole happening): the subject and a number.
const count = {}
const pics = have.map((p) => ({ ...p, file: `${p.word}-${(count[p.word] = (count[p.word] ?? 0) + 1)}` }))

mkdirSync(TO, { recursive: true })
for (const f of readdirSync(TO)) if (f.endsWith('.webp')) rmSync(join(TO, f))
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage()
let bytes = 0
for (const p of pics) {
  const src = `data:image/webp;base64,${readFileSync(join(FROM, `${p.name}.webp`)).toString('base64')}`
  const out = await page.evaluate(async ({ src, w, h, q }) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    // (Cover the frame: cut what sticks out, never squash.)
    const k = Math.max(w / img.width, h / img.height)
    c.getContext('2d').drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k)
    return c.toDataURL('image/webp', q).split(',')[1]
  }, { src, w: WIDTH, h: HEIGHT, q: QUALITY })
  const buf = Buffer.from(out, 'base64')
  bytes += buf.length
  writeFileSync(join(TO, `${p.file}.webp`), buf)
}
// The accounts' profile pictures: the kept ones, small and square, into public/faces under the account's handle
// (or pool-1, pool-2... for the ones the nobodies share: numbered again here, so a rejected one leaves no gap).
const FACES_FROM = join(ROOT, 'bot-data', 'pictures', 'avatars')
const FACES_TO = join(ROOT, 'public', 'faces')
mkdirSync(FACES_TO, { recursive: true })
for (const f of readdirSync(FACES_TO)) if (f.endsWith('.webp')) rmSync(join(FACES_TO, f))
const faces = AVATARS.filter((p) => existsSync(join(FACES_FROM, `${p.name}.webp`)))
const named = []
let pool = 0, faceBytes = 0
for (const p of faces) {
  const src = `data:image/webp;base64,${readFileSync(join(FACES_FROM, `${p.name}.webp`)).toString('base64')}`
  const out = await page.evaluate(async ({ src }) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const c = document.createElement('canvas')
    c.width = c.height = 160
    const k = Math.max(160 / img.width, 160 / img.height)
    c.getContext('2d').drawImage(img, (160 - img.width * k) / 2, (160 - img.height * k) / 2, img.width * k, img.height * k)
    return c.toDataURL('image/webp', 0.8).split(',')[1]
  }, { src })
  const buf = Buffer.from(out, 'base64')
  faceBytes += buf.length
  const file = p.handle ?? `pool-${++pool}`
  if (p.handle) named.push(p.handle)
  writeFileSync(join(FACES_TO, `${file}.webp`), buf)
}
writeFileSync(join(ROOT, 'src', 'data', 'sparkFaces.ts'), `// MADE BY scripts/build-pictures.mjs from scripts/avatar-list.mjs: do not edit by hand.\n// The profile pictures of the story market's accounts (public/faces/<name>.webp): the named accounts that have their\n// own, by handle, and how many the nobodies share (pool-1 ... pool-N). All made up, and none is a face.\nexport const SPARK_FACES: { named: string[]; pool: number } = ${JSON.stringify({ named, pool })}\n`)
await browser.close()

const by = {}
for (const p of pics) {
  const e = (by[p.word] ??= { any: [], did: {} })
  if (p.did) e.did[p.did] = p.file
  else e.any.push(p.file)
}
const ts = `// MADE BY scripts/build-pictures.mjs from scripts/picture-list.mjs: do not edit by hand.
// The pictures that go with the story market's posts (public/posts/<file>.webp), by what a post is about: \`did\` =
// the picture of one happening ("was promoted to station master"), \`any\` = plain pictures of the subject.
// Every picture is made up (generated ahead of time, looked at one by one): no real person, brand, place or animal.
export const SPARK_PICS: Record<string, { any: string[]; did: Record<string, string> }> = ${JSON.stringify(by, null, 1)}
`
writeFileSync(join(ROOT, 'src', 'data', 'sparkPics.ts'), ts)
console.log(`${faces.length} profile pictures in public/faces (${Math.round(faceBytes / 1024)} KB): ${named.length} accounts' own, ${pool} shared`)
console.log(`${pics.length} pictures in public/posts (${(bytes / 1048576).toFixed(1)} MB, ${Math.round(bytes / pics.length / 1024)} KB each), ${LIST.length - have.length} on the list not made or not kept`)
