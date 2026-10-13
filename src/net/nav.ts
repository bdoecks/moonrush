// The browser's Back and Forward buttons, and an address for where the player is. Every page of the game and every
// open coin is a step in the browser's history: Back goes to what the player had open before (it used to leave the
// game), and the address bar names the page and the coin (`?page=trenches`, `?page=token&coin=WAFFLES-x7k2`), so a
// reload or a pasted link opens the same place when that coin is on this market. Browser only: nothing here touches
// money, the market or the server. Other things in the address (an invite's ?ref=, a test copy's switches) are kept.
import { useGame, type View } from '../game/store'

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
  if (page && VIEWS.includes(page)) go({ view: page as View, coin: q.get('coin') })
  let last = spotOf(useGame.getState())
  history.replaceState({ spot: last }, '', addressOf(last))
  useGame.subscribe((s) => {
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
