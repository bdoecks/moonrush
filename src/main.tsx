import { useFlags } from './game/flags'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useGame } from './game/store'
import { startInvites } from './net/invites'
import { startNav } from './net/nav'

// Dev-only handle for inspecting game state from the console.
if (import.meta.env.DEV) Object.assign(window, { __game: useGame, __flags: useFlags })
// (Test copies only: open the game with ?stories in the address to look at the story market, tech coins and fakes.)
if (import.meta.env.DEV && new URLSearchParams(location.search).has('stories')) useFlags.setState({ sparksDev: true })

startInvites() // remembers an invite link's ?ref= code and applies it once you're signed in
startNav() // the browser's Back and Forward buttons move through the game's pages and coins

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
