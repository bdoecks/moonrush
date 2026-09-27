// Browser side of multiplayer: connects to a room, turns the server's market updates into ticks for the local
// store, and sends your trades / status. Your wallet stays in this browser ("trust friends").
import { applyCandlePoints, candleStore, createMarket, migrateMarket, rebuildCandles, secPerTickOf, setClock } from '../game/marketEngine'
import { portfolioStats, valuePortfolio } from '../game/portfolioEngine'
import { levelFromXp } from '../game/progression'
import { seasonNumber } from '../game/season'
import { nativePrice } from '../game/tradingEngine'
import { netHooks, roomRivals, useGame, type BotTickRun, type ChatLine, type MpSave, type OnlineState } from '../game/store'
import type { Chain, MarketEngine, MarketState, SimWallet, TapeTrade, Token, Trade } from '../types'
import { walletAddress } from '../utils/address'
import { fmtCompact, fmtUsd } from '../utils/format'
import { aggregate } from '../game/accounts'
import { CHAINS } from '../data/chains'
import { load, remove, save } from '../utils/storage'
import { myAddresses, recordPlayerTrades, useFriends } from './friends'
import { MP_PATH, type ClientMsg, type MainHolding, type NetMarket, type NetToken, type RoundInfo, type SendAsset, type ServerMsg, type TickMsg, type TransferMsg } from './protocol'

const STATUS_MS = 2000
const TAPE_LEN = 40
const WALLET_TRADES = 60

let ws: WebSocket | null = null
let leaving = false
let retries = 0
let statusTimer: ReturnType<typeof setInterval> | null = null
let unsubTrades: (() => void) | null = null
let muted = false // while restoring / starting a round, don't echo the whole trade list to the server
let pending: { resolve: () => void; reject: (e: Error) => void } | null = null

// ─── Identity ────────────────────────────────────────────────────────────────
let sessionPid: string | null = null
/**
 * Your player id, kept in this browser so you can come back to a round later. A tab can override it
 * (sessionStorage `mp:pid`, or `?player=2` in the URL) to be a second player on the same PC — handy for testing.
 */
export function playerId(): string {
  if (sessionPid) return sessionPid
  try {
    const slot = new URLSearchParams(location.search).get('player')
    if (slot) sessionStorage.setItem('mp:pid', `${load<string>('mpPid') ?? 'p'}-${slot}`)
    sessionPid = sessionStorage.getItem('mp:pid') ?? load<string>('mpPid')
  } catch {
    /* storage blocked */
  }
  if (!sessionPid) {
    sessionPid = `p${Math.random().toString(36).slice(2, 10)}`
    save('mpPid', sessionPid)
  }
  return sessionPid
}
export const mpSaveKey = () => `mpSave:${playerId()}`

export const mpProfile = () => ({ name: load<string>('mpName') ?? '', avatar: load<string>('mpAvatar') ?? '🐸' })
export const setMpProfile = (name: string, avatar: string) => {
  save('mpName', name)
  save('mpAvatar', avatar)
}

function serverUrl() {
  const env = (import.meta.env.VITE_MP_URL as string | undefined)?.trim()
  if (env) return env
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${MP_PATH}`
}

// ─── Connect / leave ─────────────────────────────────────────────────────────
/** Create a room (`create`) or join one by code. Resolves once you're in. */
export function joinRoom(opts: { create?: boolean; room?: string; name: string; avatar: string }): Promise<void> {
  leaving = false
  retries = 0
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    open(opts)
  })
}

export function leaveRoom() {
  leaving = true
  stopLoops()
  ws?.close(1000, 'left')
  ws = null
  useGame.getState().leaveRoom()
}

/** On page load: if you were in a room, go back into it. */
export function resumeRoom() {
  const notice = load<string>('mpNotice')
  if (notice) {
    remove('mpNotice')
    useGame.getState().notify({ title: 'LEFT ROOM', body: notice, tone: 'warn', icon: '🚪' })
  }
  const room = load<{ code: string }>('mpRoom')
  const { name, avatar } = mpProfile()
  if (!room?.code || !name) return
  joinRoom({ room: room.code, name, avatar }).catch(() => {
    remove('mpRoom')
    remove(mpSaveKey())
    useGame.getState().notify({ title: 'ROOM CLOSED', body: `Room ${room.code} isn't open any more. Back to single-player.`, tone: 'warn', icon: '🚪' })
  })
}

function open(opts: { create?: boolean; room?: string; name: string; avatar: string }) {
  const sock = new WebSocket(serverUrl())
  ws = sock
  sock.onopen = () => {
    const s = useGame.getState()
    send({ t: 'hello', name: opts.name, avatar: opts.avatar, level: levelFromXp(s.profile.xp).level, playerId: playerId(), room: opts.room, create: opts.create })
  }
  sock.onmessage = (e) => {
    let msg: ServerMsg
    try {
      msg = JSON.parse(String(e.data))
    } catch {
      return
    }
    onMessage(msg)
  }
  sock.onclose = (ev) => {
    if (ws !== sock) return
    ws = null
    if (leaving) return
    const s = useGame.getState()
    if (ev.code === 4000) {
      // Same player opened the game in another tab: that tab plays now, this one steps aside.
      stopLoops()
      netHooks.send = null
      if (s.online) s.patchState({ online: { ...s.online, conn: 'reconnecting' } })
      s.notify({ title: 'OPENED IN ANOTHER TAB', body: 'This room is now playing in your other tab. Reload here to take it back.', tone: 'warn', icon: '🗂' })
      return
    }
    if (pending) {
      // Never got in.
      pending.reject(new Error('Could not reach the multiplayer server'))
      pending = null
      return
    }
    if (!s.online) return
    // Server unreachable for ~2 minutes: stop retrying and go back to solo instead of trying forever.
    if (retries >= 12) {
      save('mpNotice', `Lost connection to room ${s.online.code}. You're back in single-player.`)
      leaveRoom()
      return
    }
    // Dropped mid-game: keep playing on the last market we saw and try to get back in.
    useGame.getState().patchState({ online: { ...s.online, conn: 'reconnecting' } })
    const delay = Math.min(10_000, 1000 * 2 ** retries++)
    setTimeout(() => {
      if (!leaving && !ws) open({ room: s.online!.code, name: opts.name, avatar: opts.avatar })
    }, delay)
  }
}

export function send(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

// ─── Sending coins to friends ────────────────────────────────────────────────
export type SendResult = { ok: boolean; error?: string; toName?: string }
let sendRef = 0
const sends = new Map<number, { apply: () => void; resolve: (r: SendResult) => void }>()

/** A coin amount with up to 4 decimals ("1.2345"). */
export const fmtAmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 4 : 3 })

export const assetLabel = (a: SendAsset) => (a === 'usdc' ? 'USDC' : CHAINS[a].native)

/** How much of an asset you can send from a wallet (USDC comes from the shared USD bank). */
export function sendable(asset: SendAsset, walletId: string) {
  const p = useGame.getState().portfolio
  return asset === 'usdc' ? p.cash : p.accounts?.find((a) => a.id === walletId)?.balances[asset] ?? 0
}

/**
 * Send SOL / BNB / ETH / USDC to another player: to their main wallet (`to` = player id) or to a wallet address
 * they gave you. From your main wallet they see your name; from a side wallet they only see its address.
 * Transfers count like deposits/withdrawals, so they don't change anyone's % return on the leaderboard.
 */
export function sendFunds(o: { to?: string; toAddr?: string; asset: SendAsset; amount: number; fromWallet: string }): Promise<SendResult> {
  const s = useGame.getState()
  if (!s.online || !ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: 'Not connected to a room' })
  if (s.runStatus !== 'running') return Promise.resolve({ ok: false, error: 'Transfers work during a round' })
  if (!(o.amount > 0)) return Promise.resolve({ ok: false, error: 'Enter an amount' })
  if (o.amount > sendable(o.asset, o.fromWallet) + 1e-12) return Promise.resolve({ ok: false, error: `Not enough ${assetLabel(o.asset)} in that wallet` })
  const main = mainWalletId()
  const fromMain = o.asset === 'usdc' || !main || o.fromWallet === main
  const usd = o.asset === 'usdc' ? o.amount : o.amount * nativePrice(s.market, o.asset)
  const ref = ++sendRef
  return new Promise((resolve) => {
    sends.set(ref, {
      resolve,
      apply: () => {
        const amount = Math.min(o.amount, sendable(o.asset, o.fromWallet))
        moveFunds(o.asset, -amount, o.fromWallet, -usd * (amount / o.amount))
      },
    })
    send({ t: 'send', ref, to: o.to, toAddr: o.toAddr, asset: o.asset, amount: o.amount, usd, main: fromMain, fromAddr: walletAddress(playerId(), main ? o.fromWallet : 'main', 'sol') })
    setTimeout(() => {
      if (!sends.delete(ref)) return
      resolve({ ok: false, error: 'No answer from the room. Nothing was sent.' })
    }, 8000)
  })
}

/** Add (or take away) coins in one wallet; the round's starting balance moves with it, like a deposit. */
function moveFunds(asset: SendAsset, amount: number, walletId: string, usd: number) {
  const s = useGame.getState()
  let p = s.portfolio
  if (asset === 'usdc') p = { ...p, cash: Math.max(0, p.cash + amount) }
  else p = aggregate({ ...p, accounts: (p.accounts ?? []).map((a) => (a.id === walletId ? { ...a, balances: { ...a.balances, [asset]: Math.max(0, a.balances[asset] + amount) } } : a)) })
  p = { ...p, startBalance: Math.max(1, p.startBalance + usd), dayStartEquity: p.dayStartEquity + usd }
  s.patchState({ portfolio: p })
}

function onRecv(msg: TransferMsg) {
  const s = useGame.getState()
  const accounts = s.portfolio.accounts ?? []
  const main = accounts[0]?.id ?? 'w-main'
  const to = msg.toAddr ? accounts.find((a) => walletAddress(playerId(), a.id, 'sol') === msg.toAddr) ?? accounts[0] : accounts[0]
  moveFunds(msg.asset, msg.amount, to?.id ?? main, msg.usd)
  const amt = msg.asset === 'usdc' ? fmtUsd(msg.amount) : `${fmtAmt(msg.amount)} ${assetLabel(msg.asset)}`
  s.notify({ title: 'COINS RECEIVED', body: `${amt} from ${msg.from} → ${to ? `${to.emoji} ${to.name}` : 'your wallet'}`, tone: 'up', icon: '💸' }, 'click')
}

// ─── Incoming ────────────────────────────────────────────────────────────────
function onMessage(msg: ServerMsg) {
  const st = useGame.getState()
  switch (msg.t) {
    case 'welcome':
      return onWelcome(msg)
    case 'players': {
      if (!st.online) return
      const online: OnlineState = { ...st.online, hostId: msg.hostId, players: msg.players }
      return st.patchState({ online, players: roomRivals(online) })
    }
    case 'round':
      return onRound(msg.round, msg.market, msg.wallets)
    case 'tick':
      return onTick(msg)
    case 'candles':
      if (msg.candles) candleStore.set(msg.tokenId, msg.candles)
      return
    case 'chat': {
      if (!st.online) return
      const line: ChatLine = { from: msg.from, name: msg.name, avatar: msg.avatar, text: msg.text, time: msg.time }
      return st.patchState({ online: { ...st.online, chat: [...st.online.chat, line].slice(-60) } })
    }
    case 'sendResult': {
      const p = sends.get(msg.ref)
      if (!p) return
      sends.delete(msg.ref)
      if (msg.ok) p.apply()
      return p.resolve({ ok: msg.ok, error: msg.error, toName: msg.toName })
    }
    case 'recv':
      return onRecv(msg)
    case 'error':
      if (pending) {
        pending.reject(new Error(msg.message))
        pending = null
        leaving = true
        ws?.close()
      } else if (/no room/i.test(msg.message)) {
        // The room closed (server restarted or everyone left long ago): stop retrying and go back to solo.
        save('mpNotice', `Room ${st.online?.code ?? ''} closed. You're back in single-player.`)
        leaveRoom()
      } else st.notify({ title: 'ROOM', body: msg.message, tone: 'warn', icon: '⚠️' })
      return
  }
}

function onWelcome(msg: Extract<ServerMsg, { t: 'welcome' }>) {
  const s = useGame.getState()
  const wasOnline = !!s.online
  const online: OnlineState = { code: msg.code, you: msg.you, hostId: msg.hostId, players: msg.players, round: msg.round, conn: 'open', chat: s.online?.chat ?? [] }
  save('mpRoom', { code: msg.code })
  retries = 0
  netHooks.send = send

  const market = migrateMarket(localMarket(msg.market, msg.you))
  setClock(secPerTickOf(market)) // the room's clock (Classic 6x or Realistic real-time)
  // The server doesn't send whole chart histories on join: rebuild them, then fill in the open coin's real one.
  rebuildCandles(market)
  muted = true
  s.patchState({
    online, market, wallets: msg.wallets, socialFeed: msg.posts, events: msg.events, walletFeed: [], paused: false,
    settings: { ...s.settings, speed: 1 }, // the room runs at 1x
    selectedId: market.tokens.some((t) => t.id === s.selectedId) ? s.selectedId : pickDefault(market),
    players: roomRivals(online),
  })
  const round = msg.round
  if (round.state === 'running') {
    const saved = load<MpSave>(mpSaveKey())
    if (saved && saved.code === msg.code && saved.roundId === round.id) {
      // Back into the round you were playing (reload or dropped connection).
      s.patchState({
        portfolio: saved.portfolio, launches: saved.launches, runStats: saved.runStats, runTicks: saved.runTicks, challenges: saved.challenges,
        copies: saved.copies, snipers: saved.snipers, alerts: saved.alerts, lastCookTick: saved.lastCookTick, result: saved.result,
        runStatus: saved.runStatus, mode: saved.mode, runDuration: saved.runDuration, watchlist: saved.watchlist,
        modal: saved.runStatus === 'finished' ? 'results' : null,
      })
    } else if (!wasOnline || useGame.getState().runStatus !== 'running') {
      // Joining a round already in progress: you get the time that's left.
      const left = round.durationTicks ? Math.max(30, round.durationTicks - (market.tick - round.startTick)) : null
      useGame.getState().startRun(round.mode, { durationTicks: left, silent: true })
    }
  } else if (!wasOnline) {
    s.patchState({ runStatus: 'select', modal: 'lobby' })
  }
  muted = false
  seedPlayerTrades(market, msg.you)
  if (useGame.getState().selectedId) send({ t: 'candles', tokenId: useGame.getState().selectedId! })
  startLoops()
  if (pending) {
    pending.resolve()
    pending = null
  } else if (wasOnline) s.notify({ title: 'RECONNECTED', body: `Back in room ${msg.code}`, tone: 'up', icon: '🔌' })
}

function onRound(round: RoundInfo, net?: NetMarket, wallets?: SimWallet[]) {
  const s = useGame.getState()
  if (!s.online) return
  const online = { ...s.online, round }
  if (round.state === 'running' && net) {
    // Everyone builds the opening charts from the same seed, so they match the server's exactly.
    candleStore.clear()
    createMarket(round.seed, round.startTime, round.engine ?? 'classic') // also sets the room's clock
    const market = localMarket(net, s.online.you)
    remove(mpSaveKey())
    useFriends.getState().clearTrades()
    muted = true
    s.patchState({ online, market, wallets: wallets ?? s.wallets, events: [], socialFeed: [], walletFeed: [], selectedId: pickDefault(market), players: roomRivals(online) })
    useGame.getState().startRun(round.mode, { durationTicks: round.durationTicks })
    muted = false
    return
  }
  s.patchState({ online })
  if (round.state === 'ended') useGame.getState().endRoundOnline()
}

function onTick(msg: TickMsg) {
  const s = useGame.getState()
  if (!s.online) return
  const me = s.online.you
  const prevTokens = new Map(s.market.tokens.map((t) => [t.id, t]))
  const myAddrs = ownAddrs()
  // Coins arrive as diffs: merge each onto what we had. A coin we've never seen comes in full (new, or a keyframe);
  // a stray partial one for an unknown coin waits for the next keyframe.
  const tokens: Token[] = []
  const others: { t: Token; e: TapeTrade }[] = []
  for (const d of msg.market.tokens) {
    const prev = prevTokens.get(d.id)
    if (!prev && !d.sim) continue
    const t = localToken(d, prev, me, myAddrs)
    tokens.push(t)
    const seen = new Set(prev?.tape.map((e) => e.id))
    for (const e of d.tape ?? []) if (!seen.has(e.id) && e.tag !== 'you' && (e.pid || e.addr) && e.pid !== me && !(e.addr && myAddrs.has(e.addr))) others.push({ t, e })
  }
  const market: MarketState = { ...msg.market, tokens }
  // Other players' trades: logged for their leaderboard profile; ones you follow alert you.
  for (const { trade, watch } of recordPlayerTrades(others).slice(0, 3)) {
    s.notify({ title: watch.label, body: `${trade.side === 'buy' ? 'Bought' : 'Sold'} ${fmtUsd(trade.usd, trade.usd < 10 ? 2 : 0)} of $${trade.ticker} @ ${fmtCompact(trade.mcap)} MC`, tone: trade.side === 'buy' ? 'up' : 'down', icon: '👁', tokenId: trade.tokenId })
  }

  // Charts: whole histories for new coins, recorded points for the rest.
  for (const [id, c] of Object.entries(msg.newCandles)) candleStore.set(id, c)
  for (const [id, pts] of Object.entries(msg.points)) if (!msg.newCandles[id]) applyCandlePoints(id, pts)
  const ids = new Set(market.tokens.map((t) => t.id))
  for (const id of candleStore.keys()) if (!ids.has(id)) candleStore.delete(id)

  // Only wallets that changed are sent; the rest stay as they were.
  const changed = new Map(msg.wallets.map((w) => [w.id, w]))
  const wallets = s.wallets.map((w) => {
    const d = changed.get(w.id)
    return d ? { ...w, ...d, trades: [...(d.trades ?? []), ...w.trades].slice(0, WALLET_TRADES) } : w
  })

  // Your volume bots run on the server; you pay for them here, and stop them when the money runs out.
  const botRuns = new Map<string, BotTickRun>()
  const botCost = new Map<string, Record<Chain, number>>()
  if (s.runStatus === 'running') {
    for (const r of s.launches) {
      if (!r.bot?.on) continue
      const t = market.tokens.find((x) => x.id === r.tokenId)
      const run = msg.bots[r.tokenId]
      if (!t || (t.status !== 'bonding' && t.status !== 'graduated')) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: `$${r.ticker} is ${t?.status ?? 'gone'}` })
      else if (r.bot.spent >= r.bot.budget) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: 'budget used up' })
      else if (run) {
        const devW = r.devWallet ?? s.portfolio.accounts?.[0]?.id ?? 'w-main'
        const acc = s.portfolio.accounts?.find((a) => a.id === devW)
        const cost = botCost.get(devW) ?? { sol: 0, bsc: 0, hood: 0 }
        if ((acc?.balances[t.chain] ?? 0) * nativePrice(market, t.chain) - cost[t.chain] < run.cost) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: `out of ${t.chain.toUpperCase()}` })
        else {
          cost[t.chain] += run.cost
          botCost.set(devW, cost)
          botRuns.set(r.tokenId, { vol: run.vol, cost: run.cost })
        }
      }
    }
  }

  // Your own posts come back with the crowd's reaction: count the likes toward followers and fill in the call.
  const mine = msg.posts.filter((p) => p.author?.pid === me)
  if (mine.length && s.profile.social) {
    let soc = s.profile.social
    for (const p of mine) {
      const i = soc.calls.findIndex((c) => !c.settled && c.likes === 0 && c.tokenId === p.tokenId)
      const calls = i >= 0 ? soc.calls.map((c, k) => (k === i ? { ...c, postId: p.id, likes: p.likes ?? 0 } : c)) : soc.calls
      soc = { ...soc, calls, followers: soc.followers + Math.round((p.likes ?? 0) * 0.1) }
      s.notify(p.tokenId
        ? { title: 'CALL POSTED', body: `$${p.ticker} · ${p.likes ?? 0} likes · ${p.buyers ? `${p.buyers} aped 🦍` : 'nobody bit yet'}`, tone: p.buyers ? 'up' : 'info', icon: '📣', tokenId: p.tokenId }
        : { title: 'POSTED', body: `${p.likes ?? 0} likes`, tone: 'info', icon: '🐦' })
    }
    s.patchState({ profile: { ...s.profile, social: soc } })
  }

  s.tick({
    market,
    newEvents: msg.events.filter((e) => e.by !== me), // your own cooks / dev sells were already shown here
    wr: { wallets, actions: msg.actions },
    newPosts: msg.posts,
    botRuns,
    botCost,
    players: roomRivals(s.online),
  })
}

// ─── Wire → local ────────────────────────────────────────────────────────────
/**
 * A coin from the server (full, or a diff merged onto what we had). Your own coins keep `creator: 'you'`; your trades
 * on the tape show as YOU.
 */
function localToken(d: Partial<NetToken> & { id: string }, prev: Token | undefined, me: string, mine: Set<string>): Token {
  const fresh = (d.tape ?? []).map((e) => (e.pid === me || (e.addr && mine.has(e.addr)) ? { ...e, wallet: 'YOU', tag: 'you' as const } : e))
  // New trades go on top of what we had, dropping local-only copies of our own trades (the server echo replaces them).
  const tape = prev ? [...fresh, ...prev.tape.filter((e) => !(e.tag === 'you' && !e.pid && !e.addr))].slice(0, TAPE_LEN) : fresh
  const t = { ...(prev ?? {}), ...d, tape } as Token
  return { ...t, creator: t.creatorId === me ? 'you' : undefined }
}

function localMarket(m: NetMarket, me: string): MarketState {
  const mine = ownAddrs()
  return { ...m, tokens: m.tokens.map((t) => localToken(t, undefined, me, mine)) }
}

/** Your wallets' addresses on every chain (your side-wallet trades come back under these). */
function ownAddrs() {
  const s = useGame.getState()
  const ids = s.portfolio.accounts?.map((a) => a.id) ?? []
  return myAddresses(playerId(), ids.length ? ids : ['main'], ['sol'])
}

function mainHoldings(): MainHolding[] {
  const p = useGame.getState().portfolio
  const pos = p.accounts?.[0]?.positions ?? p.positions
  return Object.values(pos)
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.costBasis - a.costBasis)
    .slice(0, 30)
    .map((x) => ({ tokenId: x.tokenId, qty: x.qty, cost: x.costBasis, openedAt: x.openedAt }))
}

/** The public main wallet (the first one); every other wallet is a stealth side wallet. */
function mainWalletId() {
  return useGame.getState().portfolio.accounts?.[0]?.id
}

/** Seed the player-trade log from what's already on the tapes when you join. */
function seedPlayerTrades(market: MarketState, me: string) {
  const mine = ownAddrs()
  const found: { t: Token; e: TapeTrade }[] = []
  for (const t of market.tokens) for (const e of t.tape) if (e.tag !== 'you' && (e.pid || e.addr) && e.pid !== me && !(e.addr && mine.has(e.addr))) found.push({ t, e })
  found.sort((a, b) => a.e.time - b.e.time)
  recordPlayerTrades(found)
}

function pickDefault(m: MarketState) {
  return [...m.tokens].filter((t) => t.status === 'graduated').sort((a, b) => b.hype - a.hype)[0]?.id ?? m.tokens[0]?.id ?? null
}

// ─── Outgoing loops ──────────────────────────────────────────────────────────
function startLoops() {
  stopLoops()
  // Every new fill of yours (buy, sell, instant, copy, sniper…) goes to the server so everyone feels the impact.
  const key = (tr: Trade) => `${tr.id}|${tr.walletId ?? ''}|${tr.tick}|${tr.side}|${tr.qty}`
  unsubTrades = useGame.subscribe((s, prev) => {
    if (muted || !s.online || s.portfolio.trades === prev.portfolio.trades) return
    const seen = new Set(prev.portfolio.trades.map(key))
    const fresh = s.portfolio.trades.filter((tr) => !seen.has(key(tr)) && tr.status === 'FILLED')
    if (fresh.length > 8 && fresh.length === s.portfolio.trades.length) return // a whole list swapped in, not new fills
    const main = mainWalletId()
    for (const tr of fresh.reverse()) {
      const wid = tr.walletId ?? main ?? 'main'
      // One address per wallet (its Solana-style id) so it can be followed on every chain.
      send({ t: 'trade', tokenId: tr.tokenId, side: tr.side, usd: tr.value, qty: tr.qty, addr: walletAddress(playerId(), main ? wid : 'main', 'sol'), main: !main || wid === main })
    }
  })
  const report = () => {
    const s = useGame.getState()
    if (!s.online) return
    const map = new Map(s.market.tokens.map((t) => [t.id, t]))
    const v = valuePortfolio(s.portfolio, map, s.market)
    const st = portfolioStats(s.portfolio, v)
    const running = s.runStatus === 'running' || s.runStatus === 'finished'
    // Once your round is over, your standing is frozen at the final result.
    const equity = s.runStatus === 'finished' && s.result ? s.result.finalEquity : v.equity
    send({
      t: 'status', equity, startEquity: running ? s.portfolio.startBalance : 0, trades: st.tradeCount, wins: Math.round(st.winRate * st.tradeCount),
      level: levelFromXp(s.profile.xp).level, finished: s.runStatus === 'finished',
      // Your real season points, so everyone in the room sees your actual tier.
      seasonPoints: s.profile.season?.id === seasonNumber() ? s.profile.season.points : 0,
      // Your main wallet's bags are public on-chain; side wallets are never included.
      holdings: running ? mainHoldings() : [],
      addrs: [...ownAddrs()], // private: lets friends send coins to a wallet by its address
      protect: [...Object.keys(s.portfolio.positions), ...s.watchlist, ...(s.selectedId ? [s.selectedId] : [])],
    })
  }
  report()
  statusTimer = setInterval(report, STATUS_MS)
  // Opening a coin fetches its real chart from the server (joiners start with rebuilt ones).
  let lastSel = useGame.getState().selectedId
  const unsubSel = useGame.subscribe((s) => {
    if (s.online && s.selectedId && s.selectedId !== lastSel) {
      lastSel = s.selectedId
      send({ t: 'candles', tokenId: s.selectedId })
    }
  })
  const unsubT = unsubTrades
  unsubTrades = () => {
    unsubT()
    unsubSel()
  }
}

function stopLoops() {
  if (statusTimer) clearInterval(statusTimer)
  statusTimer = null
  unsubTrades?.()
  unsubTrades = null
}

export const sendChat = (text: string) => send({ t: 'chat', text })
export const startRound = (mode: RoundInfo['mode'], durationTicks: number | null, engine: MarketEngine = 'classic') => send({ t: 'start', mode, durationTicks, engine })
