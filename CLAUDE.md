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
npx tsx scripts/story-test.ts 1 0.25 3      # a coin's story feed, what stories do to trading, that copying them is not free money (8 min)
npx tsx scripts/fair-test.ts 4              # no simple rule makes money in the World (run 4 to 6 side by side with --json, then `sum`; after ANY market change)
npx tsx scripts/fair-test.ts classic        # the same on the classic engine (solo play's default)
npx tsx scripts/minds-test.ts 1 0.25        # trader types: each mind acts only on what it says, on lines a player could have read
npx tsx scripts/source-test.ts              # the data-source plug: outside data cleaned, dated, honest about its source; stale lists dropped
npx tsx scripts/scale-test.ts               # what a World player is sent: only the open coin's chart and tape, no hidden state, under budget (6 min)
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
| `src/game/storyEngine.ts`, `traderMinds.ts`, `traderView.ts`, `dataSources.ts` | V2: a coin's story feed, trader types, a tracked trader on a coin, the door for outside data. |
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
   - **A player's public card** (`{ t: 'card', id }` → `sendCard` in `server/room.ts`, shown by
     `components/PlayerCard.tsx`; every player name in the World opens it through `useOpenPlayer`): net worth and
     profit as on the boards, plus the MAIN wallet's bags and latest trades, the way anybody could read them off a
     chain. Side wallets are never on it (they trade under a bare address). It is built from the wallet the server
     holds, not from the `status` a game reports, so it is there for players who are off line and can't be dressed
     up; a watching guest may ask too. Keep it that way: nothing private (no side wallets, no account details).
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
   **The simulated market is also fair**: no predictable push may be left for a buyer to ride (see "The fair
   market" in the V2 section and `TOPS` in `marketEngine.ts`). Run `fair-test` after touching any of it, and give
   every new push (an event, a tool, a kind of wallet) its answer in the same change.
9. Player-facing behaviour follows Axiom Pro / GMGN where they have an equivalent. Check how they do it first.

## Conventions

- TypeScript, no semicolons, 2 spaces, single quotes, long lines are fine. Match the file you are in.
- Comments say *why*, in plain words, at about the density the file already has.
- Files are UTF-8 with emoji in strings. Edit with a real editor or a Node script. **Never rewrite source files
  with PowerShell** (`Set-Content` has corrupted the emoji before).
- Numbers on the wire are rounded to 6 significant digits (`round()` in `server/room.ts`).
- What a browser receives each second is the limit on how many can play (see "Stage 5" in the V2 section: a World
  tick carries no chart points and only real players' trades). In the World a coin's on-screen statistics
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

## V2: stories, the fair market, tracked traders, trader types, the data plug, scale

The owner's brief for V2 was a professional real-time trading terminal: stories that move the market, tracked traders
on the chart, trader types, an honest data-source plug, and scale. It was built and measured in a separate test copy
(the folder `moonrush-v2` next to this one, on the owner's PC) and brought into the game in one piece on his word on
2026-10-08. The notes below are that copy's, as measured there.

**Stage 1, stories: done (2026-10-06).** Test: `npx tsx scripts/story-test.ts [World hours=2] [warm-up=0.5] [A/B hours=3]`.

- A coin has a feed of **beats** (`Token.beats`, newest first, `BEATS_KEPT`), shown on the coin page's Story tab
  (`components/token/StoryFeed.tsx`) and pinned on its chart (`bubbles.ts`, `PriceChart.tsx`, the "Story" and "Events"
  switches under the chart). A minute after a beat it says what the price did next (`move`).
- **Three kinds of content, never mixed up.** A beat's `src` says which, and every place that shows a beat shows it
  (`SRC_META` in `components/token/beatMeta.ts`): `market` = facts read off this simulated market's trades and events;
  `story` = generated narrative, and every account, outlet and brand in it is invented (`src/data/stories.ts`: never
  add a real name or a parody of one); `trend` = outside data, a theme from the real launches the owner recorded,
  worded with its date so nobody takes it for a live feed. `market.trends` is a `TrendFeed` with its `source` and
  `asOf`: solo play ships a labelled sample (`src/data/trends.ts`), the World's server uses the brain's recording
  (`worldTrends()` in `server/brainBots.ts`). A real data provider plugs in by producing a `TrendFeed`. The approved
  theme words are shared now (`src/data/themeWords.ts`; `server/trendThemes.ts` re-exports them).
- `tickStories(market, input)` (`src/game/storyEngine.ts`) runs after `tickSocial` wherever a market ticks: `advanceLocal`
  in the store and `tick()` in the room. It has its own dice (the market's seed and tick), and **it never touches a
  price** (the test checks every tick). A development's followers are queued orders like a call's readers
  (`shillQueue`; `sellAfter` = that buyer flips exactly what the buy got, some ticks later) plus a little attention.
- **A post reaches the feed a few seconds after it was made** (`STORY.seenAfter`, `market.beatQueue`): its fastest
  followers are in first, as with a real post. The beat is stamped with when it was made, so its pin sits where the
  move starts. This is what keeps the feed from being a buy signal; the Help text says so to players.
- A story has an arc (`meme`, `caller`, `community`, `builder`, `whale`), heats up as posts land (bigger accounts
  join), can turn sour at any step (`drama`: holders sell), and fades. Its lines never repeat within a story, and a
  line that refers back ("that partnership was made up", marked `[partner]` in the text file) is only used when that
  happened.
- All tuning is in one object, `STORY`. `STORY.pull = 0` tells the same kind of beats with nobody acting on them: the
  test runs the market both ways to see what stories themselves do.
- Wire: beats travel like trades (new ones whole, changed ones as `{ id, seq, move }`, `lastBeatSeq` in the room;
  `mergeBeats` in the browser). The engine's queues (`shillQueue`, `beatQueue`) are not sent at all any more (orders
  and posts that have not happened yet are nobody's to read), and the trend list comes once, in the welcome.
- Measured in the World with its bots (1 h, `story-test`): a story post moves its coin about +5% before it can be read;
  a drama leaves it 6 to 10% lower a minute later; a coin's feed gets 2 to 3 lines a minute while its story runs;
  about 15 stories run at a time; the feed is under 1% of what a browser receives. **Buying every story post when it
  shows loses money**: -5% after 30 s, -6% after a minute, -9% after two, -13% after five (`fair-test`, with the fair
  market below; before it, on the live game's drifting market, a story post made +4 to +15% like everything else).
  Stories cost the server about 1.4 ms a tick on the dev PC (7.7 → 9.2 ms). The World's save is 10 to 15% bigger
  (the feeds): when this moves to the real game, decide whether feeds are saved or start empty after a restart.
  (Measured before the fair market: with stories on, slightly fewer coins bonded, 2.6% of launches against 3.1%.)

**The fair market: done (2026-10-07), on the owner's word ("close the trick first").** Found while measuring stage 1:
the market itself paid whoever bought what was running (so did the live game until V2 came in). `scripts/fair-test.ts` is
the measure: a paper trader puts $100, fees included, on rules anybody can follow, in a World with its bots
(`npx tsx scripts/fair-test.ts 4`, several runs added up with `sum`; `FAIR_REPO=<folder>` measures another copy, read
only) and on the classic engine (`npx tsx scripts/fair-test.ts classic`). A rule that makes money on average is a hole.

- **Before (the game as it was until 2026-10-08)** (World, 12 h; average after fees at 30 s / 1 min / 2 min / 5 min): a coin first
  reaching 40% of its curve +19 / +32 / +52 / +77%; any launch as it appears +24% in 30 s (3 in 4 win); a bot chef's
  launch +93% in 30 s; a coin that has just bonded +18 / +40 / +70 / +120% (9 in 10 win); a "trending" event
  +22 / +38 / +56 / +79%; a migrated coin up 25% in a minute +5 / +10 / +18 / +26%. A coin at 40% bonded 19 times in
  100 where its price allowed 10. Classic engine: first reaching 22% +6 / +11 / +16 / +22%, a "viral" event +34% in
  2 min, just bonded +46% in 2 min.
- **After** (World, 24 h): first reaching 40% -0 / -1 / -1 / -4%; 50% and 60% between +3 and -2%; a bot
  chef's launch -3 / -2 / -1 / +1%; just bonded +1 / -1 / -2 / -3%; "trending" 0 / +1 / +2 / -2%; a migrated coin up
  25% in a minute -4 / -3 / -2 / -4%. Held to the end (it bonds, dies or 15 minutes pass) every rule loses 5 to 13%.
  A coin at 40% bonds 8 times in 100 (its price allows 10), at 60% 23 (23), at 80% 43 (45). Classic: every rule
  between -13% and +5%, none clearly above zero.
- **What does it** is listed above `TOPS` in `marketEngine.ts` (read that first). In short: on a real-time curve the
  crowd's net buying carries a matching chance that holders dump into it (`TOPS`, `climbOf`, `topTakes`), the crowd
  buys no more than could be dumped back and nothing in a coin nobody holds, and first holders come in one go before
  anybody can be ahead (`snipe`, `launchBlock`); the crowd trades against orders from outside it and against event
  jumps (`outsideNet`, `flow.jolt`, `sim.jolt`); every coin the regime model moves (pools, classic curves) gets a
  matching chance of a jump against its pull (steps 4a / 4b of `tickMarket`); a pool opens with no pull (`migrate`);
  good news is announced when it has played out (`lateEvents`), warnings at once. `TOPS.k = 0` switches it off.
- **A real player's own launch is left alone on its curve** (`rules` in `stepFlow`; a bot chef's coin carries
  `flow.botDev` and is not): cooking goes as in the live game (curve-test: 19 of 45 strong launches bonded, 2 of 45
  lazy ones; market-report: lazy 0%, decent 14%, strong 45%). Whoever buys a real player's running launch still rides
  it, as in the live game: that is the cook's game, the owner's to change. Once bonded it is a pool like any other.
- **What it costs.** About 1% of launches bond (22 an hour in
  the World, was 62; real pump.fun: 0.2 to 2.7%), so the Migrated column holds about 48 coins (was 90) and New about
  29 (was 36). The Final Stretch is kept at 7 to 8 (was 10) by a slower clock high on a curve (`FLOW.stretchPace`:
  no odds change), so bonding takes longer (half within 3.6 min, was 2.8). Charts on running coins show sudden dumps,
  pools jump both ways. A bot chef's coin appears already about 40% up its curve (its snipers and its post's readers
  are its launch block). The bots end a 3-hour test between 0% (pros) and -12% (degens); skill still shows. On the
  classic engine a 20-hour market bonds 9 to 17 coins (was 41). More winners without reopening the hole: make
  launches open higher (the launch block, `snipe`), never by letting a running coin drift.
- **What is still against a buyer is readable**: a dev who holds a bag (crowd devs sell into a pump: `FLOW.devDump`),
  a rug in a pool, a post everybody has acted on, and the fees. That is why "any coin, any moment" loses 7 to 13%.
- Dials: `TOPS` (k, drop, scare, keep), `FLOW.hotPace` / `stretchPace` / `crowdHold` / `left`, `POOL_DROP`,
  `GRAD_SUPPLY`. `FLOW.exit` (a quiet coin's holders selling out) is OFF on purpose: on, every buy lost a fifth.
- **A new signal needs a new rule in `fair-test`.** The rules there are the ones the game shows today (curve lines,
  price runs, bonding, crashes, calls, events, large buys, story posts, bot chefs' launches). Stage 2 and 3 will show
  more (tracked traders on the chart, trader types): add each as a paper rule when it is built, and it must not pay.
- A World saved before V2 keeps running: a bot chef's coin from before has no `botDev` and plays as a player's until
  it ends (rehearsed on a World saved by the old code before the push).

**Stage 2, tracked traders on the chart: done (2026-10-08).** `src/game/traderView.ts` (pure: `tradersOn`, a colour
per tracked wallet by its place in `trackedWallets`), the coin page's Tracked tab (`components/token/TrackedTab.tsx`:
position, share of supply, average entry, unrealized / realized, history, Track / Untrack), and on the chart
(`PriceChart.tsx`, `bubbles.ts`): tracked trades ringed in the trader's colour (`Bubble.tint`), a dashed
average-entry line per tracked holder (marker kind `entries`, "Trader avg", the six biggest), and click a row to
pick one trader out (`traderFocus.ts`). Browser only: nothing new on the wire or the server. A wallet remembers 60
trades, so realized profit on a coin is what those show. `fair-test` has the matching rules ("copying a
smart-money / KOL / sniper / whale / World bot's first buy"): all lose 3 to 19% (World, 18 h). UI bots have a
"Tracked tab" step.

**Stage 3, trader types: done (2026-10-08).** `src/game/traderMinds.ts`: besides its style a tracked wallet has a
mind (`mindOf`: narrative, FOMO, contrarian, panic, swing; from its id and style, so nothing is saved; snipers and
the World bots have none). A mind reads only what a player can (the coin's `beats`, its five-minute change, its
status), never a line younger than `MIND.seen` seconds, and makes `MIND.share` of the wallet's entries
(`mindEntry`) and its exits first (`mindExit`), in `tickWallets`. A trade a mind made carries `why`
(`WalletTrade`, `WalletAction`): shown under the trade on the wallet's profile and the Tracked tab, and as the
"why" of the feed's opened / sold lines. Test: `npx tsx scripts/minds-test.ts 1 0.25` (each mind acts only on what
it says). Measured: minds make about a third of these wallets' trades. **Found with `fair-test`:** with minds
sending KOLs into whatever was running, a KOL's followers (the 1 to 3x crowd buys behind a KOL's buy) made a coin
at 80% of its curve pay +9% in two minutes. So only a KOL's own pick brings followers, and a KOL's mind picks few of
its entries (`MIND.kolShare`). After: every rule in `fair-test` loses or is flat, World (24 h) and classic.

**Stage 4, the data-source plug: done (2026-10-08).** One thing comes into the game from outside: which themes are
hot in real launches (a `TrendFeed`). `src/game/dataSources.ts` is the door: `cleanFeed` (only approved theme words
from `themeWords.ts` get in, it must carry an `asOf` date, a theme's narrative is the game's own), `isStale` (older
than `TREND_MAX_AGE_DAYS`, the one number shared with trend coins: the story engine then stops leaning on it) and
`describeSources` (the three kinds of content: simulated, generated, outside data). `server/trendSource.ts` is the
plug: a provider if one is configured (`TREND_FEED_URL` or `TREND_FEED_FILE`, `TREND_FEED_NAME`,
`TREND_FEED_MINUTES`; shape in `server/data/trend-feed.example.json`), else the owner's recording, else the sample.
**Nothing is configured, so no request is made: never give it a made-up address or call a recording live.** A
provider that fails keeps its last good list until that list's own date runs out. `/sources` on the server says
what is in use (never the provider's address). A new list reaches the World's players once, in a tick. Help shows
"Where the data comes from" (`components/DataSources.tsx`). Test: `npx tsx scripts/source-test.ts` (23 checks; its
"provider" is a temp file and a local test server, nothing leaves the PC). The owner has not picked a provider, so
on Render none of the `TREND_FEED_*` variables is set.

**Stage 5, scale (send each World player less): done (2026-10-08).** In the World only (`server/room.ts`; friends
rooms are as before): a tick carries no chart points and, of the tapes, only real players' trades; the coin a
player has open (`Member.focus`, set when their browser asks for its chart with `candles`) is sent that coin's
points and whole tape in a `focus` message just ahead of each tick, built once per coin; the `candles` answer
carries the coin's tape. A market cap rides on its price; `hype` is a slow field; a coin's hidden `sim` goes out as
a stand-in (`WIRE_SIM`: a joining browser still sketches opening charts from it, and stripping it bare crashed the
join) and the market's `seed` as 0, which closes the old "a cheater could read sim" gap. Browser:
`focusNext` / `mergeTape` in `src/net/client.ts`. Measured (100 bots, this PC): a tick 42.7 -> 27 KB raw; a player
56 -> 37 KB a second raw, 15.7 -> 9.5 KB compressed, 0.9 -> 0.4 ms of processor; `load-test`'s estimate for the
Starter plan about doubles. **What a player gives up:** the Holders / Top Traders tabs of a coin now start from its
last 40 trades when it is opened (they used to build up from everything seen since joining). Test:
`npx tsx scripts/scale-test.ts` (11 checks, 6 min). Next wins, not built: the per-coin `win` statistics (13% of
a tick), whole wallets resent on every trade (13%), the list of coin ids every tick (7%).

Also open after stage 1:
- (Done in stage 5: in the World a coin's `sim` and the market's `seed` no longer reach browsers. Friends rooms still send them.)
- (Done in stage 4: a trend list older than 14 days is marked out of date and no story leans on it.)
- (Done with the fair market: stories were measured again on it, `story-test` and the "a story post" rule in `fair-test`.)

The five stages, as agreed: 2) tracked traders on the chart (a colour each, average-entry line, position, share
of supply, profit, history); 3) trader types that react to stories (narrative trader, contrarian, panic seller, FOMO,
swing) on top of the real-data brain; 4) the data-source plug with provenance; 5) scale (send each player less).

## Working with the owner

- He is not a programmer. Explain in simple, click-by-click language. No jargon without a one-line meaning.
- He tests, then says "push it". Test locally first, say what you tested and what you could not test.
- Two Claudes may be working at once (his and the backend developer's). Before starting, pull `main`; say which
  files you plan to touch; keep pull requests small and about one thing.
