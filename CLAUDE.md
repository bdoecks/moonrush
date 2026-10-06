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
npx tsx scripts/curve-test.ts               # every price move is trades through the launchpads' own curve / pool maths; a player's fill is exact
npx tsx scripts/p2c-test.ts                 # server-run money (orders, cooking, bots, fees, cashback) and what a launch may carry
npx tsx scripts/world-test.ts               # World rules: always on, guests watch, wallets kept, admin reset
npx tsx scripts/bots-test.ts 2              # World bots over 2 simulated hours
npx tsx scripts/safety-test.ts              # chat safety: filter, rate limit, mute, reports
npx tsx scripts/seat-test.ts                # guest seats: only the browser with the seat key rejoins as that guest
npx tsx scripts/kol-test.ts                 # KOL copy traders: followers copy a KOL's buys and sells
npx tsx scripts/social-test.ts              # followers are the server's count: the World ignores claims, calls judged on the server
npx tsx scripts/charts-test.ts 30           # charts across a restart: short timeframes rebuilt from the real 1m candles
npx tsx scripts/windows-test.ts             # rolling 5m / 1h stats and the Lighthouse vs what really traded
npx tsx scripts/daily-test.ts               # daily challenges: three a day, each pays once, new day starts clean
npx tsx scripts/health-test.ts              # safety net: health verdicts, backups (stand-in database), World restore, admin routes
npx tsx scripts/world-soak.ts 8             # World size / speed over 8 simulated hours (run after market changes)
npx tsx scripts/market-report.ts            # the World in numbers (not pass/fail): read before and after tuning the market
npx tsx scripts/load-test.ts                # how many players the server holds: fake players in steps of 1…200 (5 min; run after wire changes)
npx tsx scripts/crowd-test.ts 3             # the 100 World bots: skill shows in results, dev dumps, pile-on limit, speed
npx vite build                              # production build
npm run bots                                # UI bots: play every page in hidden Chrome, PDF report (see below)
```

Every line of the test scripts prints PASS or FAIL. Add checks there when you add server behaviour.

**UI bots** (`scripts/ui-bots.ts`, solo play only): a checklist bot clicks through every page and main feature, then
an explorer bot clicks around on its own, favouring buttons it has tried least across runs (memory in
`bot-reports/explorer-memory.json`). Output: `bot-reports/<date>/report.pdf` for people, `report.json` for Claude.
Uses the installed Chrome/Edge (`CHROME_PATH` to override). `--clicks N`, `--seed S` to replay, `--show` to watch,
`--selftest` plants a crash and NaN cash to prove the bots notice. Add a step to `checklistBot` for new features.

**Online bots** (`scripts/online-bots.ts`, `npm run online-bots`): starts the room server (port 8787) and the game
(port 5197), then two players in separate browser contexts create and join a friends room, trade, cook, send money,
chat and click around together. After each action each screen is compared with `window.__srvWallet` (the server's
last wallet answer), and both players' markets are compared tick for tick. `--clicks N`, `--show`, `--selftest`.

**Market recorder** (`scripts/market-recorder.ts`, `npm run record`): read-only recording of real pump.fun
bonding-curve trades, launches and graduations from Solana logs (Helius free plan via `HELIUS_API_KEY` in `.env`, or
`--public`), for teaching bots. Wallets are saved only as salted hashes (salt in `bot-data/salt.txt`); real addresses
never leave this computer. `bot-data/` is gitignored. About 25 MB/min, so ~30 h/month fits the Helius free plan
(`--usage` tracks it). Optional `bot-data/watch.txt`: wallets or wallet-page links to follow. Never wire this into the
game or server: the game must not connect to real markets or money.

**Market learner** (`scripts/market-learner.ts`, `npm run learn`): replays the recordings coin by coin, profiles wallets
(return, entry age, hold time, size, loss cutting, dev / big sells), ranks them into skill levels (pro / good / average /
bad / degen by return) and styles (sniper, scalper, whale, diamond, degen, dumper), and writes `bot-data/brain.json`:
per style/level, buy lift by situation (age × market cap × last-minute move), size, exit multiple and timing, plus
market-wide dump stats (dev sells, big sells, pile-ons, rugs). Only aggregates, no wallet ids. Coins whose launch was
not recorded are left out of the age-based odds. Summary for people: `bot-data/brain-summary.md`.

**World bots** (`server/bots.ts`, `server/brainBots.ts`): 100 bots made from a fixed seed (`makeRoster`; don't reorder its
lists, wallets are saved per id), each with a style, skill level (pro → degen), persona (bet size, reaction time,
patience, mistake rate, tilt) and chat voice. Trading bots play from `server/data/market-brain.json` (copy
`bot-data/brain.json` there after `npm run learn` to update): buy odds by situation × a level-based eye for coin safety (`safety`: risk score, dev and top-10 share, holders, liquidity, recent pump; measured to predict dying coins in the World), sizes
(real SOL × `SIZE_SCALE`), exits from the real exit spread, moods from streaks. Chefs launch coins and dump on real
dev-sell timing (`DEV_DUMP_CHANCE` by level). Big bot sells on one coin are capped at `PILE_ON_LIMIT` per 10s. Bots not in
the roster (the original 20) are removed from the World with their wallets on boot. `WORLD_BOTS=20` on Render runs fewer.
Without the brain file the bots fall back to the old `STYLE` rules. To keep the World a steady size, a bot writes off
any bag in a dead or delisted coin as a realized loss (`botWriteOff`, through `runGiveAway`), and its own wallet keeps
only its last `BOT_TRADES_KEPT` trades (lifetime counts live in `brain.fills` / `brain.wins`; the public wallet still
shows 60). Without those, bags and history pile up for ever: check with `crowd-test` and `world-soak` after bot changes.
The crowd also talks like a room, not a trade log (`LINES` in `server/bots.ts`, never the line somebody just said): it
reacts to coins bonding and devs dumping, to a real player's launch or big buy (`react`, and `lookAt` makes bots likelier
to buy that coin for a while), and answers itself now and then. A chef sells out of a coin whose buyers have gone
(`fading`), and a bot dev's real bag shows as its coin's dev share (set in `tick()`; a player's understated one too).
Any dev selling their own coin, player or bot, costs it some of the crowd (`devSold`, the same rule the solo game has).
**A bot's name carries no label** (the owner's call: a robot on every chat line and trade made the World read as a
test). What it is stays true where it matters, so keep all of these when touching bots: `bot: true` on its player
card (`RoomPlayer`, `Player`) and public wallet (`SimWallet`); the "Simulated trader" note on its wallet page, on
its coin's dev panel and in the "cooked by" tooltip; the World paragraph in Help. **Bots are never ranked**: not on
the World boards or the Hall (`boardRows` skips them, old saved bot winners are filtered when sent), not in a
season's trophies, not in the "Online now" ranking; the World panel lists real players first. A World saved while
names carried the robot is cleaned on load (`unlabelBots`). The admin screens still mark them BOT.

**Trend coins**: the learner also writes `trends` (theme words found in real launch names, ranked by SOL traded). Only words on
the allow-list in `server/trendThemes.ts` count, so real people, brands, politics and crude words never reach the game;
never add such words there. Chefs launch `TREND_SHARE` (60%) of their coins on a trend (`trendCoin`: "Baby Horse",
"AGENTAI"…), never copying a real launch's name. When out of ideas (every theme has `TREND_CROWDED` live coins, or the brain is
older than `TREND_MAX_AGE_DAYS`), chefs launch the game's usual random coins, so launches never stop. Trends are as fresh as the last brain: to refresh, `npm run record`,
`npm run learn`, copy `bot-data/brain.json` to `server/data/market-brain.json`, open a PR.

## How it is deployed (read this before pushing)

- GitHub `bdoecks/moonrush`, branch `main`. **Every push to `main` deploys to Render within about a minute and
  restarts the server.** Rooms and the World are saved and come back, but everyone is disconnected for a moment.
- So: **work on a branch and open a pull request.** Only the owner decides when `main` moves ("push it"). Never push
  to `main` or merge a PR without the owner saying so.
- Render runs `npm ci --include=dev && npm run build`, then `npm run server`, which serves `dist/` and the
  WebSocket on one port. `/health` reports `{ ok, saving, rooms, players }`.
- To confirm a deploy, check `/health` or grep the live bundle for new text (Render's asset hashes differ from local).

## The safety net (health watch and backups)

- **`/health` is Render's "is the process alive" check and must always answer 200**, or Render restarts a server whose
  only problem is a slow database. The real verdict is **`/status`**: 200 `{ status: "ok" }`, or 503 with the problems
  in plain words. `server/health.ts` keeps the notes and `judge()` (pure, tested) turns them into problems: World not
  loaded, database not answering / slow, World not saved for 16 min, tick slow / stalled / throwing, memory near 512 MB,
  no backup for two days. `rooms: 0` on `/health` means the World has not loaded (it waits for the database for ever
  rather than start empty: `loadWorld` in `server/persist.ts`).
- **Who gets told:** `.github/workflows/health-watch.yml` asks `/status` and the database every 30 minutes; a failed
  run makes GitHub email the owner. The admin also gets a pop-up in the game (`AdminFloat`) and a Server health card
  (Admin → Switches & stats). A tick that throws is caught, counted and reported (`Room.timedTick`), not fatal.
- **Backups** (`server/backup.ts`, table `backups` from `supabase/008_backups.sql`): once a day the World (state and
  charts) and the account tables are copied, gzipped, into `backups`; 7 daily + about 4 weekly copies are kept. Admin →
  Backups: back up now, download, or Restore a World copy (`swapWorld`: the running World is itself backed up first,
  everyone connected is sent to the menu, and the old World is disposed BEFORE the copy loads because charts are kept
  by coin id). Logins (Supabase auth) are not in a backup. A backup is skipped while the database is failing checks.
- The World saves every 5 minutes and its charts every 15 (`WORLD_SAVE_MS`, `WORLD_CHARTS_MS`): each save rewrites a
  multi-MB row, and once a minute was enough to make the free database unresponsive for everything (2026-10-04).

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
| `server/bots.ts` | World bots: the 100-bot roster (personas, voices), styles, fallback coin picking, chat lines. |
| `server/brainBots.ts` | The market brain the World bots trade from (`server/data/market-brain.json`). |
| `server/persist.ts` | Saving rooms / the World to Supabase, gifts. |
| `server/health.ts`, `server/backup.ts` | The health watch (`/status`) and the daily backups / World restore. |
| `server/auth.ts`, `server/admin.ts` | Token checks, bans, the admin API. |
| `src/components`, `src/pages` | UI. |

## Rules that must hold

1. **The server is the judge of all money in rooms and the World.** The game shows a result instantly
   (optimistic) and tags it with a `ref`; the server runs the same shared function and its answer wins. Any new
   action that moves money must run in `server/room.ts`, through a function in `src/game/orders.ts` that both
   sides share. There is no "trust the client" path, and none may be added.
   Two more things the server keeps or checks itself, because they reach every other player:
   - **Followers and reputation** decide how many people a post reaches and how many copy a buy, so the server keeps
     them (`socialOf` / `judgeCalls` in `server/room.ts`, sent to the game as `social`; the game reads them through
     `socialNow`). The World starts everyone fresh and ignores what a message claims. A friends room starts from the
     player’s own profile once and keeps its own count; the game adds the *change* to the profile (`creditSocial`),
     never the room’s count. Known gaps: a call on your own coin that you then pump still counts, and `patch` still
     takes a coin’s hype from its dev’s browser (bounded).
   - **What a launch brings from the browser**: the coin’s id (only the game’s `TICKER-xxxx` shape, as text), its name,
     ticker, description and picture (`coinLook` in `server/moderation.ts`, before anything is charged: the form’s
     rules, the chat filter, and only uploaded JPG / WebP / GIF pictures of a sane size, because a picture link would
     make every player’s browser call a stranger’s computer). The rules the form can know are shared in
     `src/game/textRules.ts`; a launch the server still refuses is taken back in the game (`onWallet`). The `event`
     message is rewritten in the server’s own words (`ownCoinEvent`).
   Text is cleaned where it enters (`server/index.ts`): half an emoji or a NUL anywhere in a room makes the database
   refuse the save, so `saveSafe` in `server/persist.ts` is the last net. Cut player text with `cut()`, not `slice()`.
   Trade records on the server carry no copy of the coin’s picture (`setTradeImages`), and a picture is sent once.
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
7. **A price only moves when somebody trades.** A coin's price IS its reserves: on a launchpad curve the pad's
   virtual reserves (`src/data/launchpads.ts`, `src/game/curve.ts`: pump.fun's 30 SOL / 1,073,000,000 tokens and so
   on), after migration a constant-product pool seeded with the raise and the pad's LP tokens. `quoteBuy` /
   `quoteSell` are the only price maths. Nothing sets `t.price` by hand: simulated wallets trade
   through `fillSim`, players and bots through `applyPlayerTrade`, and the market's own pull on a coin (its regime,
   the mood, news, a rug) is worked out as before but only adds up in `sim.pend` until the tick's trades carry it
   (`tradeTo`, `joltByTrades`), as exactly the buying or selling it takes. So the tape always adds up to the chart,
   volume is at least what the move cost, a rug is insiders dumping real bags (liquidity is burned: nobody pulls a
   pool), a buy at the end of a curve is cut to what is left, a sold-out curve is closed until it migrates, and
   other people's trades that land before a player's order (lag, a sandwich) are real trades on the tape. The
   one thing that moves a dollar price without a trade is the chain coin itself (the reserves are SOL / BNB / ETH).
   `scripts/curve-test.ts` holds all of this; run it after touching the market.
   The regime model is written per classic 6-second tick and follows the clock (`DT`, `clockStep()`): on the
   real-time World one tick is a sixth of a step, so a migrated coin moves about 3% in a typical minute, not 10%
   (the engine on its own; in the World itself, with its bots, calls and tracked wallets, about 5% where it was
   about 20%: measure there, with `market-report` or a saved World, before telling anyone a number).
   Two things besides trades touch a pool, and neither moves a price: other liquidity providers top up a coin that
   has outgrown its launch pool (`POOL_FLOOR`: never under 2% of market cap), and a pool can't be sold below the
   price it has with the whole supply in it (`sellRoom`: a dead migrated coin keeps a few $K of market cap).
   **The simulated crowd can only sell what it bought**: the coins in real wallets (players on or off line, bots,
   tracked wallets: `TickOptions.held`, kept per coin in `sim.held`) are never the crowd's to sell, so the money
   behind a player's own bag stays in the curve / pool until that player sells. Whoever ticks a market passes
   `held` (the room and the solo store both do); without it a made-up whale can empty a curve under a dev who was
   first in.
8. **On the real-time engine (the World) every coin on a curve lives by order flow** (`stepFlow`), on every
   launchpad, whoever launched it: the crowd's own launches, the bot chefs' and a player's. A cooked coin's pull on
   the crowd (`flow.q`) comes from its launch score (`COOK_FLOW`); a big dev bag puts buyers off; what the classic
   engine calls `pressure` (a volume bot, marketing, a flagged bundle) is attention gained or lost; and it is
   written off only after `FLOW.devQuiet` without one buyer. A hot coin's clock slows (`pace`), so a winner takes
   minutes to bond, not half a minute, and the Final Stretch column holds coins people can trade. Once migrated, a
   crowd launch's insiders can dump into the pool (`rugProb` by archetype). Tuning any of it: read
   `npx tsx scripts/market-report.ts` before and after (columns, time to bond, launch odds, rugs an hour), then run
   `curve-test`, `crowd-test` and a long `world-soak` (coins must not pile up; `SIZE_CAP_MULT` keeps the giants few).
9. Player-facing behaviour follows Axiom Pro / GMGN where they have an equivalent. Check how they do it first.

## Conventions

- TypeScript, no semicolons, 2 spaces, single quotes, long lines are fine. Match the file you are in.
- Comments say *why*, in plain words, at about the density the file already has.
- Files are UTF-8 with emoji in strings. Edit with a real editor or a Node script. **Never rewrite source files
  with PowerShell** (`Set-Content` has corrupted the emoji before).
- Numbers on the wire are rounded to 6 significant digits (`round()` in `server/room.ts`).
- What a browser receives each second is the limit on how many can play. In the World a coin's on-screen statistics
  (`SLOW_FIELDS` in `server/room.ts`) go out every `SLOW_FIELD_TICKS` seconds, each coin on its own turn; anything a trade
  quote reads stays live. Full refreshes are staggered per coin and wallet (`KEYFRAME_TICKS`), never all on one tick.
- Feature switches the owner flips live are in Supabase `app_flags` (`src/game/flags.ts`). New risky features
  should ship behind one, admin-only at first (see the `world` flag).

## Where the project is

Done: accounts (Supabase), friends and global leaderboard, admin panel, server-run money (Phase 2), rooms and
the World saved across restarts, the World in admin preview, World bots, admin wallet resets, World leaderboards
(net worth and this week's profit, `boardRows` / `sendBoard` in `server/room.ts`, `WorldBoard.tsx`), bankruptcy
restart (op `bankrupt`: under $250 net worth, back to $1,000, once per 24h, losses carried in `pnlCarry`), Market
Lighthouse, Convert, Instant Trade settings, Trenches display settings, phone layout, chat safety
(`server/moderation.ts`: word filter, no links in the World, rate limit, strikes → auto-mute, reports, admin mute),
player counters (`supabase/006_activity.sql`, `track_activity` / `activity_summary`, admin Switches & stats tab),
share cards, KOL copy traders (`copyBuys` / `copySells`, main wallet only), dev wallets (🧑‍💻, max 3) with trackable
`devAddr`, tracker groups (`components/tracker/groups.tsx`), follower daily cap (`addFollowers`), Market Movement panel,
World seasons = calendar months (`game/worldSeason.ts`; boards per list via `{ t: 'board', list }`, Hall of Fame and
trophies in `closeSeasonIfDue`), DEX pools follow price on every trade (`poolFollows`).

Next, in order:
1. Launch: Render Starter plan so the server never sleeps, then turn the `world` flag on.
2. Watch the player counters for a few weeks (the number that matters: how many come back the next day).
3. If people come back: monetization, starting with cosmetics and a supporter pass. Never let in-game money cash
   out to real money, and rename real third-party brand names (pump.fun, Raydium…) before charging anyone.
4. Phase 4: ops and monitoring.

Known gaps: cashback tier still comes from the client's reported volume (bounded 10–30%); real referral links (the old fake referrals are off, `REFERRALS_ENABLED`).

## Working with the owner

- He is not a programmer. Explain in simple, click-by-click language. No jargon without a one-line meaning.
- He tests, then says "push it". Test locally first, say what you tested and what you could not test.
- Two Claudes may be working at once (his and the backend developer's). Before starting, pull `main`; say which
  files you plan to touch; keep pull requests small and about one thing.
