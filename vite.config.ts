import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Multiplayer: the game server (npm run server, port 8787) is reached through /mp, same as in production.
  build: { chunkSizeWarningLimit: 2000 }, // the game ships as one ~1 MB bundle on purpose; don't warn about it
  server: { port: 5173, proxy: { '/mp': { target: 'ws://localhost:8787', ws: true } } },
})
