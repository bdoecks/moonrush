# MOONRUSH — notes for Claude (and humans)

MOONRUSH is a memecoin **trading-sim game**: every coin, price, wallet and trade is simulated, no real money or
blockchain. It is live at https://moonrush-n2ft.onrender.com. The owner (bdoecks) compares everything to
**Axiom Pro** and **GMGN** and wants it to feel like them. A second developer works mostly on the backend.

Read this file before changing anything. `README.md` describes the simulation itself in more depth.

## Run it locally

Needs Node 22+.

```bash
npm install
npm run dev            # the game, http://localhost:5173 (Vite; proxies /mp to the room server)
npm run server:dev     # the room server, http://localhost:8787 (WebSocket path /mp), restarts on edits
```

- Solo play needs only `npm run dev`. Rooms and the World need the server too.
- No secrets are needed locally. Without `SUPABASE_SECRET_KEY` the server simply doesn't save rooms.
- **The World locally:** `node scripts/world-dev.mjs` runs the server with `WORLD_GUESTS_PLAY=1`, so you can trade
  in the World without signing in. Never set that variable in production.
- Two players on one PC: open a second tab with `?player=2`.
- In dev builds the store is on `window.__game` and the server's last wallet answer on `window.__srvWallet`.

## Checks to run before any push

```bash
npx tsc --noEmit -p tsconfig.app.json       # the game
npx tsc --noEmit -p tsconfig.server.json    # the server
npx tsx scripts/p2c-test.ts                 # 20 checks: server-run money (orders, cooking, bots, fees, cashback)
npx tsx scripts/world-test.ts               # World rules: always on, guests watch, wallets kept, admin reset
npx tsx scripts/bots-test.ts 2              # World bots over 2 simulated hours
npx tsx scripts/world-soak.ts 8             # World size / speed over 8 simulated hours (run after market changes)
npx vite build                              # production build
```

Every line of the test scripts prints PASS or FAIL. Add checks there when you add server behaviour.

## How it is deployed (read this before pushing)

- GitHub `bdoecks/moonrush`, branch `main`. **Every push to `main` deploys to Render within about a minute and
  restarts the server.** Rooms and the World are saved and come back, but everyone is disconnected for a moment.
- So: **work on a branch and open a pull request.** Only the owner decides when `main` moves ("push it"). Never push
  to `main` or merge a PR without the owner saying so.
- Render runs `npm ci --include=dev && npm run build`, then `npm run server`, which serves `dist/` and the
  WebSocket on one port. `/health` reports `{ ok, saving, rooms, players }`.
- To confirm a deploy, check `/health` or grep the live bundle for new text (Render's asset hashes differ from local).

## Secrets

- `src/net/supabaseConfig.ts` holds the Supabase URL and **publishable** key. Both are public by design.
- `SUPABASE_SECRET_KEY` exists **only** in Render's environment. Never put it in code, a commit, a log, a test, or
  a chat. `server/persist.ts` and `server/auth.ts` read it from `process.env`.
- Database changes are SQL files in `supabase/` (numbered). The owner runs them by hand in the Supabase SQL
  editor, so a new file needs a note telling him to run it.

## Where things live

| Path | What |
|---|---|
| `src/game/marketEngine.ts` | The market: coins, price moves, launches, bonding curves, rugs, candles. Shared by game and server. |
| `src/game/tradingEngine.ts` | One buy / sell / swap on one wallet (fees, slippage, MEV). |
| `src/game/orders.ts` | **Shared pure money functions** (`runBuy`, `runSell`, `runSwap`, `runTransfer`, `runGiveAway`, `payNative`, wallet state). The game and the server both call these. |
| `src/game/store.ts` | The game's state (Zustand): solo ticks, actions, optimistic results in rooms. |
| `src/net/protocol.ts` | Every message between game and server. Change both sides together. |
| `src/net/client.ts` | Browser side of rooms: connect, apply ticks, reconcile wallets. |
| `server/index.ts` | HTTP + WebSocket, identity, room lifecycle, saving, World boot. |
| `server/room.ts` | One room: shared market tick, players, **every player's wallet**, cooking, bots, fees, cashback, admin actions. |
| `server/bots.ts` | World bots: roster, styles, coin picking, chat lines. |
| `server/persist.ts` | Saving rooms / the World to Supabase, gifts. |
| `server/auth.ts`, `server/admin.ts` | Token checks, bans, the admin API. |
| `src/components`, `src/pages` | UI. |

## Rules that must hold

1. **The server is the judge of all money in rooms and the World.** The game shows a result instantly
   (optimistic) and tags it with a `ref`; the server runs the same shared function and its answer wins. Any new
   action that moves money must run in `server/room.ts`, through a function in `src/game/orders.ts` that both
   sides share. There is no "trust the client" path, and none may be added.
2. **Wallet messages are numbered.** The game sends `seq`; the server answers `wallet { ack, state }`; the game
   applies the server's balances only when `ack === seq`. Both restart the count on every connection.
3. Store changes the server also makes are wrapped in `quietly()`. In dev, an unreported money change logs
   `[wallet] change not run on the server` — treat that as a bug.
4. **Shared code must stay pure and server-safe.** Nothing under `src/game/` that the server imports may touch
   `window`, `localStorage`, React, or the Zustand store.
5. **The World** (`WORLD_CODE`, `Room(code, true)`) never pauses, never ends, and keeps wallets forever under the
   account id (`u-<uid>`). Guests are spectators. It must stay a steady size: see `WORLD_FADE_*` and run the soak
   test after touching market or delisting logic.
6. Solo play must keep working with no server at all.
7. Player-facing behaviour follows Axiom Pro / GMGN where they have an equivalent. Check how they do it first.

## Conventions

- TypeScript, no semicolons, 2 spaces, single quotes, long lines are fine. Match the file you are in.
- Comments say *why*, in plain words, at about the density the file already has.
- Files are UTF-8 with emoji in strings. Edit with a real editor or a Node script. **Never rewrite source files
  with PowerShell** (`Set-Content` has corrupted the emoji before).
- Numbers on the wire are rounded to 6 significant digits (`round()` in `server/room.ts`).
- Feature switches the owner flips live are in Supabase `app_flags` (`src/game/flags.ts`). New risky features
  should ship behind one, admin-only at first (see the `world` flag).

## Where the project is

Done: accounts (Supabase), friends and global leaderboard, admin panel, server-run money (Phase 2), rooms and
the World saved across restarts, the World in admin preview, World bots, admin wallet resets, World leaderboards
(net worth and this week's profit, `boardRows` / `sendBoard` in `server/room.ts`, `WorldBoard.tsx`), bankruptcy
restart (op `bankrupt`: under $250 net worth, back to $1,000, once per 24h, losses carried in `pnlCarry`), Market
Lighthouse, Convert, Instant Trade settings, Trenches display settings.

Next, in order:
1. Phone layout: the app lays out wider than a phone screen.
2. Phase 3 safety before strangers: chat limits, reporting, blocked words, admin mute.
3. Launch: Render Starter plan so the server never sleeps, then turn the `world` flag on.
4. Phase 4: ops and monitoring.

Known gaps: cashback tier still comes from the client's reported volume (bounded 10–30%); the app lays out wider
than a phone screen; real referral links (the old fake referrals are off, `REFERRALS_ENABLED`).

## Working with the owner

- He is not a programmer. Explain in simple, click-by-click language. No jargon without a one-line meaning.
- He tests, then says "push it". Test locally first, say what you tested and what you could not test.
- Two Claudes may be working at once (his and the backend developer's). Before starting, pull `main`; say which
  files you plan to touch; keep pull requests small and about one thing.
