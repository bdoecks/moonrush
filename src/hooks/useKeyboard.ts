import { useEffect } from 'react'
import { cookingVisible, labsVisible } from '../game/flags'
import { useGame } from '../game/store'

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  if (!e) return false
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable
}

/** Global keyboard-first shortcuts. Never fire while the user is typing in a field (except Esc). */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const s = useGame.getState()
      if (ev.key === 'Escape') {
        if (isTyping(ev.target)) {
          ;(ev.target as HTMLElement).blur()
          return
        }
        if (s.modal && !(s.modal === 'mode' && s.runStatus === 'select')) return s.setModal(null)
        if (s.sheetOpen) return s.setSheetOpen(false)
        if (s.view === 'token') return s.setView(s.backView === 'token' ? 'discover' : s.backView)
        if (s.view !== 'discover') return s.setView('discover')
        return
      }
      if (isTyping(ev.target) || ev.ctrlKey || ev.metaKey || ev.altKey) return
      if (s.modal) return
      const k = ev.key.toLowerCase()
      const handled = (() => {
        switch (k) {
          case '/': s.focusSearch(); return true
          case 'b': s.requestTrade('buy'); return true
          case 's': s.requestTrade('sell'); return true
          case 'w': s.setDockTab('watchlist'); return true
          case 'f': if (s.selectedId) s.toggleWatch(s.selectedId); return true
          case 'i':
            if (s.view !== 'token' && s.selectedId) s.setView('token')
            s.toggleInstant(s.view !== 'token' ? true : undefined)
            return true
          case 'p': s.setView('portfolio'); return true
          case 'd': s.setView('discover'); return true
          case 'm': s.setView('missions'); return true
          case 'c': if (!cookingVisible()) return false; s.setView('cooking'); return true
          // (CopyTrade, Sniper and Monitor: only while they are shown, see the `labs` switch.)
          case 'y': if (!labsVisible()) return false; s.setView('copytrade'); return true
          case 'n': if (!labsVisible()) return false; s.setView('sniper'); return true
          case 'o': if (!labsVisible()) return false; s.setView('monitor'); return true
          case 'k': s.setView('track'); return true
          case 'r': s.setView('rewards'); return true
          case 'l': s.setView('leaderboard'); return true
          case 't': s.setView('trenches'); return true
          case 'h': case '?': s.setModal('help'); return true
          case ' ': s.togglePause(); return true
          default: return false
        }
      })()
      if (handled) ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
