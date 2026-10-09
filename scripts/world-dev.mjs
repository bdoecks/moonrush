// Local testing only: the room server with World guests allowed to play (no account needed on this machine).
//   node scripts/world-dev.mjs            the World as players have it
//   node scripts/world-dev.mjs stories    …with the story market on (posts that coins get launched on)
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'server/index.ts')], { stdio: 'inherit', env: { ...process.env, WORLD_GUESTS_PLAY: '1', ...(process.argv.includes('stories') || process.argv.includes('larps') || process.argv.includes('tech') ? { STORY_MARKET: '1' } : {}), ...(process.argv.includes('tech') ? { STORY_TECH: '1' } : {}), ...(process.argv.includes('larps') ? { STORY_LARPS: '1' } : {}) } })
child.on('exit', (code) => process.exit(code ?? 0))
