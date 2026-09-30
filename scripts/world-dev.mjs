// Local testing only: the room server with World guests allowed to play (no account needed on this machine).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(process.execPath, [join(root, 'node_modules/tsx/dist/cli.mjs'), join(root, 'server/index.ts')], { stdio: 'inherit', env: { ...process.env, WORLD_GUESTS_PLAY: '1' } })
child.on('exit', (code) => process.exit(code ?? 0))
