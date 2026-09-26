# MOONRUSH — Meme Trading Arena

An arcade take on a memecoin trading terminal. **It's a game:** every token, price, trade, wallet and rival is simulated. No wallets, no blockchain, no real money.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
```

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · lightweight-charts (candles) · Recharts (portfolio) · lucide-react

## How the simulation works

- **Market engine** (`src/game/marketEngine.ts`): one tick per second = 6 simulated seconds. Each token is a regime-switching process (sideways → accumulation → pump → distribution → dump → recovery). On top of that come momentum, mean reversion to a slow anchor, a shared market-mood factor (correlation), fat-tailed jumps, and a per-archetype "bleed". Seven archetypes (bluechip, runner, grinder, bleeder, chaotic, rugger, sleeper) give recognizable personalities. The engine uses a seeded PRNG, so a market's evolution is reproducible from its seed.
- **Liquidity & fills**: trades execute against a constant-product pool (reserve = half the liquidity), so slippage is real, and there's a visible 1% arena fee.
- **Bonding curve**: new launches (every ~30s) start on a curve and graduate at $69K MC.
- **Rugs**: high-risk tokens have a hidden hazard. When a rug is scheduled, liquidity drains and warning events usually fire 15–45 ticks before the collapse.
- **Events** (`eventEngine.ts`): trending, whale buys, momentum spikes, panic selling, viral hype, smart-money accumulation, dev sells, KOL shills. Each one changes the token's hidden state.

## Chains

Every token lives on **Solana** (pay with SOL), **BNB Chain** (BNB) or **Robinhood Chain** (ETH).
- **Wallet:** you start with USD and swap into chain coins from the wallet chip or the Swap modal (0.3% fee). The chain coins have simulated prices that drift with market mood.
- **Buying:** buys spend the token's chain coin and sells pay back into it. Trade panel amounts, presets, instant trade and ⚡ quick-buys are all in chain units.
- **Auto-swap** (on by default, toggle in Settings) covers any shortfall from USD.
- **Chain switcher:** the ALL / SOL / BNB / HOOD switcher filters the market, the movers strip and Monitor.
- **Flavour:** each chain has its own address style.

## Launchpads & bonding curves

Each coin launches on a launchpad for its chain. The badges are simple original monograms, not the platforms' logos, and all curve numbers are game approximations (see `src/data/launchpads.ts`).

| Chain | Launchpads |
| --- | --- |
| Solana | pump.fun, bonk.fun, stonk.fun, Bags (1% creator royalty), Mayhem (an AI agent trades it for 24h) |
| BNB | OpenFour, Flap (buy/sell tax coins, tax paid to the creator) |
| Robinhood (ETH) | Pons v2, long.xyz |

- **Curve:** a constant-product curve with virtual reserves (x · y = k), priced in the chain's coin. For pump.fun that's 30 SOL / 1.073B tokens virtual, with 793.1M tokens sold on the curve.
- **Progress** is tokens sold ÷ curve tokens, the same as the "bonding %" on real pads.
- **Floor:** the price can't fall below the curve's start price.
- **Migration:** when the curve sells out (about an 85 SOL raise on pump.fun), the raise seeds a DEX pool (PumpSwap, Raydium, PancakeSwap…).
- **Fees:** each pad has its own curve fee, DEX fee and creator share. Tax coins add their buy/sell tax.
- **Rugs:** on a curve, a rug means the dev dumping into it; after migration the dev pulls the pool.
- **Stats windows:** every coin tracks rolling **1m / 5m / 1h / 24h** volume, txns, buys and sells. In the Table, the time tabs switch the Change, Vol and Txns columns (and sorting).
- **Filter panel** (Table toolbar and each Trenches column), in three tabs:
  - **Basic:** presets, launchpads and keywords.
  - **Metrics:** a stats window, plus min–max for bonding %, migrated ago, MC, liquidity, age, change, volume, txns, buys, sells, holders, top 10, dev, snipers, insiders and bundler. Each column only shows the metrics that apply to it, and in the Table the window follows the time tab.
  - **Audit & socials:** has X / TG / website / any social, mint disabled, LP burned, dev sold all / still holding, no bundle or wash flags, hide dead, tax / no tax.
- **Filters (GMGN-style):**
  - Each Trenches column (New Pairs / Final Stretch / Graduated) has its own **Filter** panel. It has launchpad tiles with coin counts, include/exclude keywords, min–max ranges (bonding %, MC, liquidity, volume, holders, txns, age, top 10, dev, snipers, insiders, bundler), and hide-dead / tax-only toggles.
  - Changes apply when you press Apply, and each column's filter is saved.
  - The Table view has a **Launchpad** dropdown.
  - **Presets:** load a built-in preset (pump.fun only, Clean, Fresh 5m, Almost bonded, Volume movers, Tax coins) or save the current filters as your own (name + icon). Your presets are shared across columns, and a column's header shows the preset it's using.

## Sniper (press N)

GMGN-style sniper bot: arm tasks that watch brand-new launches and auto-buy the ones that match.
- **Rules:** chain, launchpads, name contains / skip words, max dev %, needs socials, skip tax coins.
- **Buying:** it buys on the tick a coin launches, from the wallets you pick (or your selected ones), using a P slot's fees, slippage and anti-MEV (P3 turbo by default).
- **Exits:** optional take-profit / stop-loss sells only the part the task bought.
- **Limits:** each task stops after its max snipes.
- **The page shows:** tasks (pause / resume / delete), open sniped bags with live P&L, and a log of snipes and exits. Sniped fills are tagged 🎯 in your history.

## Search, PnL card, social tracker

- **Search** (top bar, or the ticker row on narrower screens; press `/`): find a token by name, ticker or contract address, a trader wallet by name or address, or your own wallets. Use ↑↓ and ↵ to pick a result.
- **PnL card:** a floating, draggable card opened from the **PnL** button in the bottom dock, the status bar or the mobile bar.
  - Shows Session PnL (resettable) or the whole Round, in USD or SOL.
  - Also shows balance, realized / unrealized, txs, win rate, a balance sparkline and 3 card styles.
- **Social tracker:** a bottom-dock tab next to Events. It streams X / TG posts (All / Following / Calls only), with follow buttons and a coin chip showing its move since the post.
- **Trade sidebar:** the buy / sell sidebar only shows on a coin's chart page, not on the Market table or Trenches.

## Wallet tracker (GMGN-style)

- **Where:** Track → Track for the full feed, the **Wallet tracker** bottom-dock tab for a compact one, and Track → Wallet to manage wallets. Tracked wallets, labels and settings carry over to new rounds.
- **Feed:** live trades by wallets you track, with quick filters for group, chain (SOL / BNB / HOOD) and buys / sells, a pause button, and a quick-buy on every row. The Tracked column counts how many of your wallets hold the coin now (🔥 at your cluster threshold).
- **Tracker settings** (gear or "Tracker settings" button):
  - **Alerts:** on/off, buys, sells, first buys only, minimum size, obey feed filters, pop-up, sound, and a cluster alert (2 / 3 / 5 tracked wallets in one coin).
  - **Feed filters:** chains, buys / sells, first buys only, min trade size, min / max MC at the trade, max coin age.
  - **Groups:** create and delete groups, then assign wallets on the Wallet tab.
- **Per wallet:** custom label, group, alerts on/off and separate buy / sell alerts. Search wallets by name, address or type to add them.
- **Alert pop-ups** show the trade and the coin's MC, with a quick-buy button; clicking one opens the coin, and ✕ closes it without opening. They sit in the **bottom-right corner** by default (above the dock when it's open), so they stay clear of page headers and settings. Market-event pop-ups share that stack without overlapping: tracker alerts carry a green **👁 TRACKED** tag, and market events are violet cards tagged **EVENT**. Change this under Tracker settings → Alerts → Pop-up position.

## Multi-wallet (GMGN-style)

You can have up to 10 wallets.
- **What each holds:** each wallet has its own SOL / BNB / ETH and its own bags. USD is a shared bank you can swap into any wallet.
- **Choosing wallets:** tick the ones to trade from with the wallet selector in the top bar, the trade panel or Instant Trade.
  - Buys run from **every** ticked wallet, each buying the full amount.
  - Sells take the same % of each ticked wallet's bag.
  - The first ticked wallet is your **primary**. It does dev buys and bundles when cooking, copy trades, and volume-bot fees, and it receives creator fees.
- **Manage wallets:** create (name + icon), rename, fund from USD, move coins between wallets, pick the primary, and delete (only when empty).
- **Portfolio:** the Portfolio tab and the positions dock show all wallets combined. The Portfolio tab can filter to one wallet, and history rows show which wallet traded.
- **New rounds:** your wallets carry over, emptied.
- **Older saves:** these move into a "Main" wallet automatically.

**Portfolio layout (GMGN-style):** three cards up top. **Realized PnL** has a chart that switches between PnL bars (realized PnL per time slice) and your balance line. **Analysis** shows total / unrealized PnL, win rate, TXs, total bought / sold, avg buy size, tokens traded, avg duration, fees, best and worst. **Distribution** shows PnL buckets plus trading habits: quick flips, bags held into a rug, positions closed below −50%, copy-trade fills. The Holding, Recent PnL and Activity tables have search, SOL / BNB / HOOD filters and click-to-sort columns. Holding can hide small (<$1) and rugged bags, Recent PnL filters Holding / Sold all, and Activity filters Buys / Sells and follows the selected wallet and period.

**Portfolio units:** switch between **USD** and **SOL · BNB · ETH**. In coin mode each row shows its own chain's coin, and totals break down per coin (e.g. "+0.52 SOL · −0.01 BNB").

## Instant Trade (press I)

A floating one-click panel, GMGN-style.
- **Buy** in the chain coin (SOL/BNB/ETH) or in **USD**.
- **Sell** by **%** of your bag, or by value in the chain coin or **USD**. A value sell works out how many tokens to sell so you receive about that amount after fees; a button marked ALL is worth more than your bag and sells everything.
- The stats row (Bal / Bought / Sold / PnL) switches between USD and the chain coin, and PnL between value and %.
- **Total / Position** picks what the stats row covers. **Total** counts every trade on the coin this round. **Position** counts only the position you hold now, starting from the first buy after your holdings were last at zero, so earlier closed trades don't mix in.
- Each unit has its own P1/P2/P3 presets; edit them with ✎. Your unit choices are saved.

## Trade settings (slippage, fees, anti-MEV)

Each P1/P2/P3 slot has separate **buy** and **sell** settings per chain. Open them from the ⚙ chip next to the P tabs in the trade panel, or under the Instant Trade buttons. By default P1 is cheap, P2 protected and P3 turbo.
- **Max slippage** (or Auto): if impact plus price movement exceeds it, the order fails and still burns the priority fee.
- **Priority fee / gas** and **tip:** paid in the chain coin on top of the order. More fee means faster landing, so the price has less time to move against you.
- **Anti-MEV:** private routing, so your orders can't be sandwiched, but they land slightly slower. Without it, big orders on thin pools can be sandwiched (a 🥪 toast tells you what it cost).
- The order preview shows the network fee, max slippage and speed, sandwich risk, and a "likely to fail" warning.
- Quick-buy buttons use the settings of their own P slot.

**Chart markers** (toggles under the chart):
- Your trades show as **B/S** arrows.
- The dev wallet shows as **DB/DS**. On coins you cooked, that's you.
- Wallets you track show as their avatar plus **B/S**.
- Several trades in one candle merge into one marker (×N).
- While you hold a coin, a dashed **My avg** line marks your average entry market cap (fees included), with its value on the price axis. It's green when you're above it and red when you're below, and it shows with the "My trades" toggle.

## Cooking (launch your own token)

The 🍳 Cooking tab (`C`) launches a fictional token on the MoonPad curve.
- **Your choices:** name, ticker, icon, narrative, socials, launch style (fair / hyped / stealth), marketing budget, and dev buy.
- **Custom picture:** upload, drag & drop, Ctrl+V, or paste an image link (X, Google Images → "Copy image address"). It's auto-cropped to a small square and saved with your save. If a site blocks copying, the link itself is kept and the emoji is the fallback.
- **Bundler:** buy the opening supply from 2–20 of your own wallets in the launch block. The audit only shows the dev wallet, but each launch has a chance of the bundle being spotted, and it can also be found later. Fewer, bigger wallets are easier to spot, and staggering the buys helps (for 1% extra in tips). When it's found, the audit shows 📦 BUNDLED, hype drops and holders sell. Your sells come out of the bundle wallets first.
- **Dev & side wallets:** pick which of your wallets **deploys** the coin; only that wallet counts as the dev (audit dev %, DB/DS chart markers, "dev sold" panic). Your other wallets can buy at launch (or any time later) and look like normal buyers.
  - **The catch:** sleuths may link a side wallet to the dev.
    - Buying in the launch block: ~35% chance.
    - Spread over the first minute: ~12%.
    - Later buys: ~4%.
    - A wallet funded directly from the dev wallet adds +25%. Funding from the USD bank leaves no trail.
  - Once linked, that wallet's bag counts as dev and its sells count as dev dumps.
- **Volume bot:** on any of your launches (Your launches → Bot). It buys and sells the same size from rotating wallets, adding volume and trades without moving the price. It costs about 1% of the volume in fees (paid in the chain's coin), and creator fees earn about half of that back. On small coins it attracts some real buyers. Once bots make up more than ~35% of volume, the coin is likely to be flagged 🤖 WASH, which kills the effect and hurts hype. It stops automatically at its budget.
- **Meta:** matching the rotating hot narrative gives extra hype.
- **Dev bag:** a big dev bag shows in the audit and scares buyers. Selling it is public and makes holders panic.
- **Earnings:** you earn 0.5% of your token's volume as creator fees, plus $250 if it graduates. There's a 30s cooldown and a maximum of 8 launches per round.

## CopyTrade

The CopyTrade tab (`Y`) ranks 24 simulated trader wallets: smart money, snipers, KOLs, whales, degens and fresh wallets.
- **Real trading:** each wallet trades the live market with its own cash (`src/game/walletEngine.ts`). Their fills move prices through the same pool you use.
- **Copying:** set fixed-$ or %-of-theirs sizing, a per-trade max, a total budget, copy-sells, take-profit / stop-loss, a skip for EXTREME-risk tokens, and a min liquidity.
- **Fills:** copies execute right after the source wallet, so you pay its price impact plus fees.
- **Balance** (headless check): copying skilled smart money is modestly profitable. Copying KOLs reliably loses, because they sell into their followers.

## Modes

| Mode | Balance | Clock | Goal |
|---|---|---|---|
| Practice | $100K (configurable) | none | learn |
| Challenge | $10K | 20 min | reach $25K |
| Arena | $10K | 15 min | best % return vs 20 rivals |
| Hardcore (Lv 5) | $5K | 15 min | 2× rug rate, bust below $500 |

**Round length:** the mode picker has a Round length row: *Mode default* (the clocks above), **15 min**, **30 min**, **1 hour** or **No limit**. It applies to any mode and is remembered for your next rounds. **End round** on the mode picker finishes a round early and shows results. A round you end before 5 minutes pays no round XP bonus.

## Keyboard

`/` search · `↑↓ ↵` navigate table · `B`/`S` buy/sell · `↵` confirm · `F` watch · `W` watchlist · `D`/`P`/`M`/`L` pages · `T` table/trenches · `Space` pause · `Esc` back · `?` help

## Layout

```
src/
  game/        marketEngine, tradingEngine, portfolioEngine, eventEngine, challengeEngine, leaderboardEngine, progression, store
  data/        tokens, players, events (all fictional)
  components/  TopBar, layout (dock, sidebar, mobile nav/sheet), tables, Toasts, Modals, discover/*, token/*
  pages/       DiscoverView, TokenView, PortfolioView, MissionsView, LeaderboardView
  hooks/       game loop, keyboard, flashes, derived selectors
  types/ utils/
```

Progress (XP, settings, the current round) is saved to `localStorage`. In dev builds the store is exposed as `window.__game` for debugging.
