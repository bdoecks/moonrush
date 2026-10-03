import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useGame } from './game/store'
import { startInvites } from './net/invites'

// Dev-only handle for inspecting game state from the console.
if (import.meta.env.DEV) Object.assign(window, { __game: useGame })

startInvites() // remembers an invite link's ?ref= code and applies it once you're signed in

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
