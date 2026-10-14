// A coin opened in a new tab (right-click): the tab joins the room first and the coin is not here until the room has
// sent its market. Until then this covers the page, so the player does not see the market page flash by first.
import { useOpening } from '../net/nav'

export function OpeningCoin() {
  const coin = useOpening((s) => s.coin)
  const stop = useOpening((s) => s.stop)
  if (!coin) return null
  const ticker = coin.split('-')[0]
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-bg">
      <div className="size-9 animate-spin rounded-full border-2 border-line2 border-t-accent" />
      <div className="text-[15px] font-bold">Opening <span className="text-accent">${ticker}</span>…</div>
      <button onClick={stop} className="text-[12px] text-dim underline hover:text-ink">Go to the market instead</button>
    </div>
  )
}
