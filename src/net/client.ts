// Browser side of multiplayer: connects to a room, turns the server's market updates into ticks for the local
// store, and sends your orders / status. The server runs your wallets (it's the judge); this shows results instantly.
import { chartReplaced } from '../game/chartRev'
import { applyCandlePoints, candleStore, createMarket, migrateMarket, rebuildCandles, secPerTickOf, setClock, SUPPLY, type CandlePoint } from '../game/marketEngine'
import { mergeSparks } from '../game/sparks'
import { newPortfolio, portfolioStats, valuePortfolio } from '../game/portfolioEngine'
import { levelFromXp } from '../game/progression'
import { seasonNumber } from '../game/season'
import { nativePrice } from '../game/tradingEngine'
import { creditSocial, freshSocial } from '../game/socialEngine'
import { netHooks, notifyCallResult, quietly, roomRivals, useGame, type BotTickRun, type ChatLine, type MpSave, type OnlineState } from '../game/store'
import type { Chain, MarketEngine, MarketState, SimWallet, TapeTrade, Token } from '../types'
import { walletAddress } from '../utils/address'
import { fmtCompact, fmtUsd } from '../utils/format'
import { aggregate } from '../game/accounts'
import { CHAINS } from '../data/chains'
import { load, remove, save } from '../utils/storage'
import { myAddresses, recordPlayerTrades, useFriends } from './friends'
import { accessToken, accountPlayerId, useAccount } from './account'
import { giveLocal } from '../game/gifts'
import { diffWallet, layoutOf, mergeWalletState } from '../game/orders'
import { cashbackOf } from '../game/rewardsEngine'
import { useWorldBoard } from './worldBoard'
import { usePlayerCard } from './playerCard'
import { mergeBeats } from '../game/storyEngine'
import { MP_PATH, WORLD_CODE, type ClientMsg, type MainHolding, type NetMarket, type RoundInfo, type SendAsset, type ServerMsg, type TickMsg, type TokenDiff, type TransferMsg } from './protocol'

const STATUS_MS = 2000
const TAPE_LEN = 40
const WALLET_TRADES = 60

let ws: WebSocket | null = null
let leaving = false
let retries = 0
let statusTimer: ReturnType<typeof setInterval> | null = null
let unsubTrades: (() => void) | null = null
let unsubWallet: (() => void) | null = null
let seq = 0 // wallet messages sent on this connection
let lastLayout = ''
const cooking = new Map<number, string>() // launches sent to the server and not answered yet: order number → coin id
let muted = false // while restoring / starting a round, don't echo the whole trade list to the server
let pending: { resolve: () => void; reject: (e: Error) => void } | null = null

// ─── Identity ────────────────────────────────────────────────────────────────
let sessionPid: string | null = null
/**
 * Your player id, kept in this browser so you can come back to a round later. A tab can override it
 * (sessionStorage `mp:pid`, or `?player=2` in the URL) to be a second player on the same PC — handy for testing.
 */
export function playerId(): string {
  // Signed in: your account is your player, on every device (a tab override still wins, for testing).
  let override = false
  try {
    override = !!new URLSearchParams(location.search).get('player') || !!sessionStorage.getItem('mp:pid')
  } catch {
    /* storage blocked */
  }
  const acc = accountPlayerId()
  if (acc && !override) return acc
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

/**
 * This browser's private key for a guest player id. Ids are public (everyone in a room sees them), so the server
 * lets a guest back into their seat only with the key it saw first. Never sent anywhere but the hello.
 */
function seatKey(pid: string): string {
  let k = load<string>(`mpKey:${pid}`)
  if (!k) {
    const bytes = new Uint8Array(18)
    crypto.getRandomValues(bytes)
    k = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    save(`mpKey:${pid}`, k)
  }
  return k
}

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
  sock.onopen = async () => {
    const s = useGame.getState()
    const token = await accessToken()
    send({ t: 'hello', name: opts.name, avatar: opts.avatar, level: levelFromXp(s.profile.xp).level, playerId: playerId(), room: opts.room, create: opts.create, token, key: seatKey(playerId()) })
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
      netHooks.order = null
      netHooks.op = null
      netHooks.wallet = null
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
    send({ t: 'send', ref, to: o.to, toAddr: o.toAddr, asset: o.asset, amount: o.amount, usd, main: fromMain, fromWallet: o.fromWallet, fromAddr: walletAddress(playerId(), main ? o.fromWallet : 'main', 'sol') })
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
  quietly(() => s.patchState({ portfolio: p })) // the server moves this money in its own wallets too
}

/**
 * Your wallets as the server has them. The server is the judge: its fills replace the ones shown instantly, and its
 * balances win, but only once it has handled every wallet message we sent (otherwise the next answer will).
 */
/**
 * Take back a launch the server did not accept: the coin, its row in My launches, the launch it used up, its events,
 * queued side buys and watchlist entry. The kitchen cooldown stays, so a refused name cannot be tried over and over.
 */
function undoLaunch(cookId: string, why: string) {
  const s = useGame.getState()
  quietly(() => s.patchState({
    launches: s.launches.filter((r) => r.tokenId !== cookId),
    runStats: { ...s.runStats, cooked: Math.max(0, (s.runStats.cooked ?? 0) - 1) },
    market: { ...s.market, tokens: s.market.tokens.filter((t) => t.id !== cookId) },
    events: s.events.filter((e) => e.tokenId !== cookId),
    sideQueue: s.sideQueue.filter((q) => q.tokenId !== cookId),
    watchlist: s.watchlist.filter((id) => id !== cookId),
    portfolio: { ...s.portfolio, trades: s.portfolio.trades.filter((t) => t.tokenId !== cookId) },
  }))
  s.notify({ title: 'LAUNCH REFUSED', body: why, tone: 'warn', icon: '🍳' }, 'alert')
}

function onWallet(msg: Extract<ServerMsg, { t: 'wallet' }>) {
  if (import.meta.env.DEV) (window as unknown as { __srvWallet: unknown }).__srvWallet = msg // test copies only: inspect the server's answer
  const s = useGame.getState()
  if (!s.online || s.runStatus === 'select') return
  if (msg.reset) {
    const fresh = newPortfolio(msg.state.startBalance ?? s.portfolio.startBalance)
    quietly(() => s.patchState({ portfolio: mergeWalletState({ ...fresh, accounts: msg.state.accounts, active: msg.state.active }, msg.state), launches: [], copies: [], sideQueue: [], rewards: { ...s.rewards, cashback: { ...cashbackOf(s.rewards), pending: { sol: 0, bsc: 0, hood: 0 } } } }))
    s.notify(msg.note ? { title: 'FRESH START', body: msg.note, tone: 'info', icon: '🌱' } : { title: 'WALLET RESET', body: `An admin reset your wallet. You're starting fresh with ${fmtUsd(msg.state.cash, 0)}.`, tone: 'warn', icon: '🔄' }, 'alert')
    useGame.getState().requestBoard()
    return
  }
  if (msg.note) s.notify({ title: 'COPY TRADERS', body: msg.note, tone: 'info', icon: '👥' }) // e.g. your followers copying your buy
  let p = s.portfolio
  // A launch the server refused (it has rules the form can't check, like blocked words): its answer lists every coin
  // you cooked under `vaults`, and a refused one is not there. The server charged and counted nothing, so the launch
  // is taken back here too (the coin, its row in My launches, the used launch and the cooldown), and the reason is
  // always said.
  const cookId = msg.ref !== undefined ? cooking.get(msg.ref) : undefined
  if (msg.ref !== undefined) cooking.delete(msg.ref)
  const refused = !!cookId && !(cookId in (msg.state.vaults ?? {}))
  if (refused && cookId) undoLaunch(cookId, `${(msg.failures ?? []).join(' · ') || 'The server refused this coin.'} Nothing was charged.`)
  if (msg.ref !== undefined) {
    const mine = refused ? [] : p.trades.filter((t) => t.ref === msg.ref)
    // The server lists fills in the order they ran; the trade list is newest first. Labels only the game knows (copy
    // trade, sniper task…) carry over onto the matching server fill, and so does the coin's picture (the server's
    // records carry no copy of it).
    const picture = (id: string) => s.market.tokens.find((t) => t.id === id)?.image
    const fills = [...(msg.fills ?? [])].reverse().map((f, i) => {
      const row = mine[i]?.tokenId === f.tokenId ? mine[i] : undefined // (an old row of another coin must never lend its picture)
      const image = f.image ?? picture(f.tokenId) ?? row?.image
      return { ...f, ...(row?.via && !f.via ? { via: row.via } : {}), ...(image ? { image } : {}) }
    })
    p = { ...p, trades: [...fills, ...p.trades.filter((t) => t.ref !== msg.ref)] }
    if (mine.length && !(msg.fills ?? []).length) {
      s.notify({ title: 'ORDER FAILED ON THE SERVER', body: (msg.failures ?? []).join(' · ') || 'The server rejected it. Your wallet was put back.', tone: 'warn', icon: '⛔' }, 'alert')
    } else if (mine.length) {
      // The server filled a different size than the screen showed (e.g. you had less than you thought): say so.
      const shown = mine.reduce((a, t) => a + t.value, 0)
      const real = (msg.fills ?? []).reduce((a, t) => a + t.value, 0)
      if (shown > 0 && Math.abs(real - shown) / shown > 0.05) {
        s.notify({ title: 'ORDER ADJUSTED BY THE SERVER', body: `Filled ${fmtUsd(real)} instead of ${fmtUsd(shown)}${(msg.failures ?? []).length ? ` · ${msg.failures!.join(' · ')}` : ''}`, tone: 'warn', icon: '⚖️' }, 'alert')
      }
    }
  }
  if (msg.ack === seq) p = mergeWalletState(p, msg.state)
  if (p !== s.portfolio) quietly(() => s.patchState({ portfolio: p }))
  // Cashback and creator-fee vaults are counted on the server too: show its numbers.
  if (msg.ack === seq) {
    const g = useGame.getState()
    const cb = cashbackOf(g.rewards)
    const vaults = msg.state.vaults
    g.patchState({
      ...(msg.state.cashback ? { rewards: { ...g.rewards, cashback: { ...cb, pending: { ...msg.state.cashback } } } } : {}),
      ...(vaults ? { launches: g.launches.map((r) => (r.tokenId in vaults ? { ...r, unclaimed: vaults[r.tokenId] } : r)) } : {}),
    })
  }
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
      if (msg.candles) {
        candleStore.set(msg.tokenId, msg.candles)
        chartReplaced(msg.tokenId) // the chart on screen draws the real history in place of the one sketched on joining
      }
      // (World: the coin's tape comes with its chart. While this coin was not the open one, only real players'
      // trades on it were sent.)
      if (msg.tape && st.online) {
        const mine = ownAddrs()
        const me = st.online.you
        const tape = msg.tape.map((e) => (e.pid === me || (e.addr && mine.has(e.addr)) ? { ...e, wallet: 'YOU', tag: 'you' as const } : e))
        st.patchState({ market: { ...st.market, tokens: st.market.tokens.map((t) => (t.id === msg.tokenId ? { ...t, tape: mergeTape(tape, t.tape) } : t)) } })
      }
      return
    case 'focus':
      // (World: the open coin's chart points and trades, for the tick that follows. See onTick.)
      focusNext.set(msg.tokenId, { points: msg.points, tape: msg.tape })
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
    case 'wallet':
      return onWallet(msg)
    case 'social': {
      // Your followers and reputation as the server has them, and any calls it has just judged.
      if (!st.online) return
      for (const r of msg.results ?? []) notifyCallResult(st.notify, r)
      const online: OnlineState = { ...st.online, social: msg.social }
      // The World's count is its own and leaves your solo profile alone. A friends room started from your profile
      // and then keeps its own count too, but what you gain or lose there is yours to keep: the CHANGE since the
      // last message is added to your profile. The room's count itself is never copied over it (coming back to an
      // old room, or opening it on another device, must not undo what you earned since).
      if (st.online.round.world) return st.patchState({ online })
      const mine = { ...freshSocial(), ...(st.profile.social ?? {}) }
      let dF = 0, dRep = 0
      if (msg.joined) {
        // (Re)joined. If this page already had the count (a reconnect), the change since then is what the profile is
        // still owed, whether or not the messages about it arrived (a line can die without anyone noticing). A fresh
        // page has nothing to compare with: only the calls judged while you were away.
        const seen = st.online.social
        if (seen) { dF = msg.social.followers - seen.followers; dRep = msg.social.rep - seen.rep }
        else for (const r of msg.results ?? []) { dF += r.dFollowers; dRep += r.dRep }
      } else {
        // Before the room's first message it had just been started from your profile, so that is what it changed from.
        const before = st.online.social ?? mine
        dF = msg.social.followers - before.followers
        dRep = msg.social.rep - before.rep
      }
      return st.patchState({ online, ...(dF || dRep ? { profile: { ...st.profile, social: creditSocial(mine, dF, dRep) } } : {}) })
    }
    case 'board':
      return useWorldBoard.setState({ board: msg })
    case 'card':
      // (Only the card that is open: an answer to a name clicked before this one is dropped.)
      if (usePlayerCard.getState().id === msg.id) usePlayerCard.setState({ card: msg.card })
      return
    case 'notice':
      return st.notify({ title: 'ANNOUNCEMENT', body: msg.text, tone: 'info', icon: '📢' }, 'alert')
    case 'kicked':
      // Removed by an admin: back to single-player, and don't try to reconnect.
      save('mpNotice', msg.reason)
      remove('mpRoom')
      return leaveRoom()
    case 'grant':
      // Currency from an admin: into your round.
      quietly(() => giveLocal(msg.asset ?? 'usd', msg.amount ?? msg.usd)) // the server added it to its wallets too
      return
    case 'error':
      if (pending) {
        pending.reject(new Error(msg.message))
        pending = null
        leaving = true
        ws?.close()
      } else if (/banned/i.test(msg.message)) {
        save('mpNotice', msg.message)
        remove('mpRoom')
        leaveRoom()
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
  const online: OnlineState = { code: msg.code, you: msg.you, hostId: msg.hostId, players: msg.players, round: msg.round, conn: 'open', chat: s.online?.chat ?? [], spectator: msg.spectator, social: s.online?.code === msg.code ? s.online.social : undefined } // (a reconnect keeps the count shown until the server sends it again)
  save('mpRoom', { code: msg.code })
  retries = 0
  netHooks.send = send
  // Phase 2: your wallets in the room are run by the server. Every wallet message is numbered (restarting on each
  // connection, like the server) so we know which of its answers already include everything we sent.
  seq = 0
  lastLayout = ''
  // Order numbers start again on a new connection: the numbers on trades already settled are dropped, or a new
  // order with the same number would replace an old row. A launch whose answer never arrived (the line dropped) is
  // settled from the market the server just sent: there, or it never happened.
  if (s.portfolio.trades.some((t) => t.ref !== undefined)) quietly(() => s.patchState({ portfolio: { ...s.portfolio, trades: s.portfolio.trades.map(({ ref: _old, ...t }) => t) } }))
  for (const id of cooking.values()) if (!msg.market.tokens.some((t) => t.id === id)) undoLaunch(id, 'That launch did not reach the server (the connection dropped). Nothing was charged.')
  cooking.clear()
  netHooks.order = (order) => {
    const n = ++seq
    send({ t: 'order', seq: n, ref: n, order })
    return n
  }
  netHooks.op = (op) => send({ t: 'op', seq: ++seq, op })
  netHooks.wallet = (m) => {
    const n = ++seq
    send({ ...m, seq: n, ...(m.t === 'cook' ? { ref: n } : {}) } as ClientMsg)
    if (m.t === 'cook') cooking.set(n, m.token.id)
    return n
  }

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

/** World: what arrived for the open coin just ahead of the next tick. */
const focusNext = new Map<string, { points?: CandlePoint[]; tape?: TapeTrade[] }>()
/** Two lists of trades as one, newest first, each trade once. */
const mergeTape = (a: TapeTrade[], b: TapeTrade[]) => {
  const seen = new Set<number>()
  return [...a, ...b].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).sort((x, y) => y.id - x.id).slice(0, TAPE_LEN)
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
  for (const d0 of msg.market.tokens) {
    const prev = prevTokens.get(d0.id)
    if (!prev && !d0.sim) continue
    // (World: the open coin's trades came just ahead of this tick; with them its tape is whole again.)
    const extra = focusNext.get(d0.id)?.tape
    const d = extra ? { ...d0, tape: mergeTape(extra, d0.tape ?? []) } : d0
    const t = localToken(d, prev, me, myAddrs)
    tokens.push(t)
    const seen = new Set(prev?.tape.map((e) => e.id))
    for (const e of d.tape ?? []) if (!seen.has(e.id) && e.tag !== 'you' && (e.pid || e.addr) && e.pid !== me && !(e.addr && myAddrs.has(e.addr))) others.push({ t, e })
  }
  // (The trend list comes once, in the welcome. The story market's posts come as the new and the changed ones.)
  const market: MarketState = { ...msg.market, tokens, trends: msg.market.trends ?? s.market.trends, sparks: mergeSparks(s.market.sparks, msg.market.sparks, tokens, msg.market.time) }
  // Other players' trades: logged for their leaderboard profile; ones you follow alert you.
  for (const { trade, watch } of recordPlayerTrades(others).slice(0, 3)) {
    s.notify({ title: watch.label, body: `${trade.side === 'buy' ? 'Bought' : 'Sold'} ${fmtUsd(trade.usd, trade.usd < 10 ? 2 : 0)} of $${trade.ticker} @ ${fmtCompact(trade.mcap)} MC`, tone: trade.side === 'buy' ? 'up' : 'down', icon: '👁', tokenId: trade.tokenId })
  }

  // Charts: whole histories for new coins, recorded points for the rest.
  for (const [id, c] of Object.entries(msg.newCandles)) candleStore.set(id, c)
  for (const [id, pts] of Object.entries(msg.points)) if (!msg.newCandles[id]) applyCandlePoints(id, pts)
  for (const [id, f] of focusNext) if (f.points && !msg.newCandles[id]) applyCandlePoints(id, f.points)
  focusNext.clear()
  const ids = new Set(market.tokens.map((t) => t.id))
  for (const id of candleStore.keys()) if (!ids.has(id)) candleStore.delete(id)

  // Only wallets that changed are sent; the rest stay as they were.
  const changed = new Map(msg.wallets.map((w) => [w.id, w]))
  const wallets = s.wallets.map((w) => {
    const d = changed.get(w.id)
    return d ? { ...w, ...d, trades: [...(d.trades ?? []), ...w.trades].slice(0, WALLET_TRADES) } : w
  })

  // Your volume bots run on the server and are paid from your dev wallet there (your wallet update arrives with the
  // tick); this just keeps each bot's spend / volume and stops it when the server does.
  const botRuns = new Map<string, BotTickRun>()
  const botCost = new Map<string, Record<Chain, number>>()
  if (s.runStatus === 'running') {
    for (const r of s.launches) {
      if (!r.bot?.on) continue
      const t = market.tokens.find((x) => x.id === r.tokenId)
      const run = msg.bots[r.tokenId]
      if (run?.stop) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: run.stop })
      else if (!t || (t.status !== 'bonding' && t.status !== 'graduated')) botRuns.set(r.tokenId, { vol: 0, cost: 0, stop: `$${r.ticker} is ${t?.status ?? 'gone'}` })
      else if (run) botRuns.set(r.tokenId, { vol: run.vol, cost: run.cost })
    }
  }

  // Your own posts come back with the crowd's reaction. (What they did to your followers comes from the server
  // too, in its `social` message.)
  for (const p of msg.posts) {
    if (p.author?.pid !== me) continue
    s.notify(p.tokenId
      ? { title: 'CALL POSTED', body: `$${p.ticker} · ${p.likes ?? 0} likes · ${p.buyers ? `${p.buyers} aped 🦍` : 'nobody bit yet'}`, tone: p.buyers ? 'up' : 'info', icon: '📣', tokenId: p.tokenId }
      : { title: 'POSTED', body: `${p.likes ?? 0} likes`, tone: 'info', icon: '🐦' })
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
function localToken(d: TokenDiff, prev: Token | undefined, me: string, mine: Set<string>): Token {
  const fresh = (d.tape ?? []).map((e) => (e.pid === me || (e.addr && mine.has(e.addr)) ? { ...e, wallet: 'YOU', tag: 'you' as const } : e))
  // New trades go on top of what we had, dropping local-only copies of our own trades (the server echo replaces them).
  const tape = prev ? [...fresh, ...prev.tape.filter((e) => !(e.tag === 'you' && !e.pid && !e.addr))].slice(0, TAPE_LEN) : fresh
  // Story beats arrive like trades: new ones whole and changed ones as patches, laid over what we had.
  const { beats: sent, ...rest } = d
  const beats = mergeBeats(prev?.beats, sent)
  const t = { ...(prev ?? {}), ...rest, tape, ...(beats ? { beats } : {}) } as Token
  // (World: a market cap is not sent with a price change: it is the price times the supply.)
  if (rest.price !== undefined && rest.mcap === undefined) t.mcap = rest.price * SUPPLY
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
  // Every trade, cook, airdrop, bot and claim runs on the server (the judge), so nothing is reported from here.
  unsubTrades = () => {}
  // Wallet layout: names / order / which wallets you trade from are yours to choose.
  unsubWallet = useGame.subscribe((s, prev) => {
    if (muted || !s.online || s.runStatus !== 'running') return
    const lay = JSON.stringify(layoutOf(s.portfolio))
    if (lay !== lastLayout) {
      lastLayout = lay
      send({ t: 'layout', seq: ++seq, layout: layoutOf(s.portfolio) })
    }
    // Test copies: a money change the server wasn't told about would be undone by its next answer. Flag it.
    if (import.meta.env.DEV && s.portfolio !== prev.portfolio && netHooks.quiet === 0 && prev.runStatus === 'running') {
      const delta = diffWallet(prev.portfolio, s.portfolio)
      if (delta && (Math.abs(delta.cash) > 1e-6 || Object.keys(delta.balances).length || Object.keys(delta.positions).length)) console.warn('[wallet] change not run on the server', delta)
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
      cbVolume: cashbackOf(s.rewards).volume, cbAuto: cashbackOf(s.rewards).auto, // your cashback tier and auto-claim
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
  unsubWallet?.()
  unsubWallet = null
}

export const sendChat = (text: string) => send({ t: 'chat', text })
/** Report a chat message to the admins. */
export const reportChat = (from: string, time: number, text: string) => send({ t: 'report', from, time, text })

/** Into the public World: signed in, you play under your account; as a guest you watch. */
export function joinWorld() {
  const acc = useAccount.getState().profile
  const saved = mpProfile()
  const name = acc?.username ?? (saved.name || 'Guest')
  const avatar = acc?.avatar ?? saved.avatar
  setMpProfile(name, avatar)
  return joinRoom({ room: WORLD_CODE, name, avatar })
}
export const startRound = (mode: RoundInfo['mode'], durationTicks: number | null, engine: MarketEngine = 'classic') => send({ t: 'start', mode, durationTicks, engine })
