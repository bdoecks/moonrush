// Browser side of multiplayer: connects to a room, turns the server's market updates into ticks for the local
// store, and sends your trades / status. Your wallet stays in this browser ("trust friends").
import { applyCandlePoints, candleStore, createMarket, migrateMarket, rebuildCandles, secPerTickOf, setClock } from '../game/marketEngine'
import { portfolioStats, valuePortfolio } from '../game/portfolioEngine'
import { levelFromXp } from '../game/progression'
import { nativePrice } from '../game/tradingEngine'
import { netHooks, roomRivals, useGame, type BotTickRun, type ChatLine, type MpSave, type OnlineState } from '../game/store'
import type { Chain, MarketEngine, MarketState, SimWallet, Token, Trade } from '../types'
import { load, remove, save } from '../utils/storage'
import { MP_PATH, type ClientMsg, type NetMarket, type NetToken, type RoundInfo, type ServerMsg, type TickMsg } from './protocol'

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
  const market: MarketState = { ...msg.market, tokens: msg.market.tokens.map((t) => localToken(t, prevTokens.get(t.id), me, true)) }

  // Charts: whole histories for new coins, recorded points for the rest.
  for (const [id, c] of Object.entries(msg.newCandles)) candleStore.set(id, c)
  for (const [id, pts] of Object.entries(msg.points)) if (!msg.newCandles[id]) applyCandlePoints(id, pts)
  const ids = new Set(market.tokens.map((t) => t.id))
  for (const id of candleStore.keys()) if (!ids.has(id)) candleStore.delete(id)

  const prevW = new Map(s.wallets.map((w) => [w.id, w]))
  const wallets = msg.wallets.map((w) => ({ ...w, trades: [...w.trades, ...(prevW.get(w.id)?.trades ?? [])].slice(0, WALLET_TRADES) }))

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
/** Your own coins keep `creator: 'you'`; your trades on the tape show as YOU. */
function localToken(t: NetToken, prev: Token | undefined, me: string, diff: boolean): Token {
  let tape = t.tape.map((e) => (e.pid === me ? { ...e, wallet: 'YOU', tag: 'you' as const } : e))
  // Merge new trades onto what we had, dropping local-only copies of our own trades (the server echo replaces them).
  if (diff && prev) tape = [...tape, ...prev.tape.filter((e) => !(e.tag === 'you' && !e.pid))].slice(0, TAPE_LEN)
  return { ...t, tape, creator: t.creatorId === me ? 'you' : undefined }
}

function localMarket(m: NetMarket, me: string): MarketState {
  return { ...m, tokens: m.tokens.map((t) => localToken(t, undefined, me, false)) }
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
    for (const tr of fresh.reverse()) send({ t: 'trade', tokenId: tr.tokenId, side: tr.side, usd: tr.value, qty: tr.qty })
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
