// Play with friends outside your home network: builds the game, starts the room server, and opens a free
// Cloudflare quick tunnel so anyone with the link can join. Run with `npm run play-online`; Ctrl+C stops it all.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = process.env.PORT || '8788' // not 8787, so it can run next to the dev server
const skipBuild = process.argv.includes('--no-build')

const CLOUDFLARED = [
  process.env.CLOUDFLARED,
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
].find((p) => p && existsSync(p)) ?? 'cloudflared'

const children = []
const stop = (code = 0) => {
  for (const c of children) c.kill()
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

// 1. Build the game so the server can hand it out.
if (!skipBuild) {
  console.log('Building the game…')
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
  const b = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn'], { cwd: root, stdio: 'inherit' })
  if (b.status !== 0) {
    console.error('Build failed.')
    process.exit(1)
  }
}

// 2. Start the room server (it also serves the built game).
const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const server = spawn(process.execPath, [tsx, 'server/index.ts'], { cwd: root, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'inherit'] })
children.push(server)
server.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`))
server.on('exit', (code) => {
  console.error(`Server stopped (${code}).`)
  stop(1)
})

// 3. Open the tunnel once the server is listening.
await new Promise((resolve) => server.stdout.once('data', resolve))
console.log('Opening a Cloudflare tunnel…')
const tunnel = spawn(CLOUDFLARED, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] })
children.push(tunnel)
let announced = false
const watch = (d) => {
  const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  if (m && !announced) {
    announced = true
    const line = '═'.repeat(m[0].length + 4)
    console.log(`\n╔${line}╗\n║  ${m[0]}  ║\n╚${line}╝`)
    console.log('Send this link to your friends. Open it yourself too, click "Play with friends",')
    console.log('create a room and share the code. Keep this window open while you play; Ctrl+C ends it.\n')
  }
}
tunnel.stdout.on('data', watch)
tunnel.stderr.on('data', watch)
tunnel.on('error', () => {
  console.error('Could not start cloudflared. Install it with: winget install Cloudflare.cloudflared')
  stop(1)
})
tunnel.on('exit', (code) => {
  console.error(`Tunnel closed (${code}).`)
  stop(1)
})
