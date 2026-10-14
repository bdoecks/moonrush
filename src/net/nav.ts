// The browser's Back and Forward buttons, and an address for where the player is. Every page of the game and every
// open coin is a step in the browser's history: Back goes to what the player had open before (it used to leave the
// game), and the address bar names the page and the coin (`?page=trenches`, `?page=token&coin=WAFFLES-x7k2`), so a
// reload or a pasted link opens the same place when that coin is on this market. Browser only: nothing here touches
// money, the market or the server. Other things in the address (an invite's ?ref=, a test copy's switches) are kept.
import { create } from 'zustand'
import { useGame, type View } from '../game/store'

/** The coin a new tab is opening while it joins the room: the page shows "Opening…" instead of the market meanwhile. */
export const useOpening = create<{ coin: string | null; stop: () => void }>((set) => ({ coin: null, stop: () => set({ coin: null }) }))

type Spot = { view: View; coin: string | null }
const VIEWS: readonly string[] = ['discover', 'trenches', 'token', 'portfolio', 'missions', 'leaderboard', 'cooking', 'copytrade', 'sniper', 'monitor', 'track', 'rewards']

const spotOf = (s: { view: View; selectedId: string | null }): Spot => ({ view: s.view, coin: s.view === 'token' ? s.selectedId : null })
const same = (a: Spot, b: Spot) => a.view === b.view && a.coin === b.coin

function addressOf(spot: Spot): string {
  const u = new URL(location.href)
  if (spot.view === 'discover') u.searchParams.delete('page')
  else u.searchParams.set('page', spot.view)
  if (spot.coin) u.searchParams.set('coin', spot.coin)
  else u.searchParams.delete('coin')
  return u.pathname + u.search + u.hash
}

/**
 * The address of a coin's page, for a link a browser can open in a new tab. Only where a second tab can be the same
 * game: in a room or the World, where the server runs the market and keeps the wallet, and a new tab joins as the same
 * player. In solo play the market lives in the tab itself, so a second tab would be a second market: no link there.
 */
export function coinHref(id: string, online: boolean): string | undefined {
  if (!online || typeof location === 'undefined') return undefined
  const u = new URL(location.href)
  u.searchParams.set('page', 'token')
  u.searchParams.set('coin', id)
  return u.pathname + u.search
}

/**
 * What a coin's link does with a click. A plain click opens the coin here, as before. With Ctrl, Cmd or Shift, or the
 * middle button, the browser opens the link in a new tab or window and this tab stays where it is. A click on a button
 * inside the link (quick buy, hide, the leaf) is that button's: it never follows the link.
 */
export function coinClick(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; button: number; target: EventTarget | null; preventDefault(): void }, href: string | undefined, open: () => void) {
  const onButton = !!(e.target as Element | null)?.closest?.('button, input, select, textarea, [role="button"]')
  if (onButton) return e.preventDefault()
  if (href && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1)) return
  e.preventDefault()
  open()
}

/**
 * A right-click on a coin opens it in a new browser tab straight away (the owner's ask: no menu in between). Only where
 * a coin has a link (see coinHref); in solo play the browser's own menu shows as before. A right-click on a text box
 * inside the coin's row keeps its menu (paste).
 */
export function coinMenu(e: { target: EventTarget | null; preventDefault(): void }, href: string | undefined) {
  if (!href || (e.target as Element | null)?.closest?.('input, textarea')) return
  e.preventDefault()
  window.open(href, '_blank')
}

/** Go to a place from the history or the address. A coin that is not on this market any more opens the market page. */
function go(spot: Spot) {
  const s = useGame.getState()
  if (spot.view === 'token') {
    const there = !!spot.coin && s.market.tokens.some((t) => t.id === spot.coin)
    useGame.setState(there ? { view: 'token', selectedId: spot.coin } : { view: s.backView && s.backView !== 'token' ? s.backView : 'discover' })
  } else if (VIEWS.includes(spot.view)) useGame.setState({ view: spot.view })
}

export function startNav() {
  if (typeof window === 'undefined' || !window.history?.pushState) return
  let moving = false // a step the browser made (Back / Forward): show it, do not add it to the history again
  // An address that names a place (a reload, a link): open it. Else the address takes the place the game opened on.
  const q = new URLSearchParams(location.search)
  const page = q.get('page')
  const coin = q.get('coin')
  if (page && VIEWS.includes(page)) go({ view: page as View, coin })
  // A coin opened in a new tab: this tab joins the room first (net/client.ts, resumeRoom), and the coin is not here
  // until the room has sent its market. Open it when it arrives; give up after half a minute or when the player goes
  // somewhere else themselves.
  let wanted = page === 'token' && coin && !useGame.getState().market.tokens.some((t) => t.id === coin) ? coin : null
  const wantedUntil = Date.now() + 30_000
  if (wanted) {
    useOpening.setState({ coin: wanted })
    setTimeout(() => useOpening.setState({ coin: null }), 30_000)
  }
  let last = spotOf(useGame.getState())
  history.replaceState({ spot: last }, '', addressOf(last))
  useGame.subscribe((s) => {
    if (wanted) {
      if (Date.now() > wantedUntil || s.view === 'token' || !useOpening.getState().coin) {
        wanted = null
        useOpening.setState({ coin: null })
      }
      else if (s.market.tokens.some((t) => t.id === wanted)) {
        const id = wanted
        wanted = null
        useOpening.setState({ coin: null })
        moving = true
        try {
          useGame.setState({ view: 'token', selectedId: id })
          last = spotOf(useGame.getState())
          history.replaceState({ spot: last }, '', addressOf(last))
        } finally {
          moving = false
        }
        return
      }
    }
    const now = spotOf(s)
    if (same(now, last)) return
    last = now
    if (!moving) history.pushState({ spot: now }, '', addressOf(now))
  })
  window.addEventListener('popstate', (e) => {
    const spot = (e.state as { spot?: Spot } | null)?.spot
    if (!spot) return
    moving = true
    try {
      go(spot)
      // (Where it really ended up, when the coin was gone: the address should say that, not the coin.)
      const now = spotOf(useGame.getState())
      if (!same(now, spot)) history.replaceState({ spot: now }, '', addressOf(now))
      last = now
    } finally {
      moving = false
    }
  })
}
