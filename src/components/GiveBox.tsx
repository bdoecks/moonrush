import clsx from 'clsx'
import { Gift } from 'lucide-react'
import { useState } from 'react'
import { CHAINS } from '../data/chains'
import { fmtGift, giftLabel, giveLocal, GIFT_ASSETS, type GiftAsset } from '../game/gifts'
import { useGame } from '../game/store'
import { useAccount } from '../net/account'
import { adminAct } from '../net/adminApi'
import type { RoomPlayer } from '../net/protocol'
import { supabase } from '../net/supabase'

const PRESETS: Record<GiftAsset, number[]> = { usd: [1_000, 10_000, 100_000, 1_000_000], sol: [1, 10, 100, 1000], bsc: [0.5, 5, 50, 500], hood: [0.1, 1, 10, 100] }

/**
 * Admin: give USD / SOL / BNB / ETH to yourself (instant), a player in a room (instant), or any account by
 * username (waits in their gift box until they're in a round, then lands within a minute).
 */
export function GiveBox({ room: roomProp, players, initialTo, compact }: { room?: string; players?: RoomPlayer[]; initialTo?: string; compact?: boolean }) {
  const me = useAccount((s) => s.profile?.username)
  const myId = useGame((s) => s.online?.you)
  const myRoom = useGame((s) => s.online?.code)
  const room = roomProp ?? myRoom
  const running = useGame((s) => s.runStatus === 'running')
  const notify = useGame((s) => s.notify)
  const [to, setTo] = useState(initialTo ?? 'me') // 'me' | 'room:<playerId>' | 'account'
  const [username, setUsername] = useState('')
  const [asset, setAsset] = useState<GiftAsset>('usd')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const amt = Number(amount)
  const others = (players ?? []).filter((p) => p.id !== myId)

  const say = (ok: boolean, body: string) => notify(ok ? { title: 'ADMIN', body, tone: 'info', icon: '🎁' } : { title: 'ADMIN FAILED', body, tone: 'warn', icon: '⚠️' })
  const send = async () => {
    if (!(amt > 0)) return
    setBusy(true)
    try {
      if (to === 'me' && room && myId) {
        // In a room your wallet is on the server: it adds the currency there.
        if (!running) say(false, 'Start a round first: currency goes into your current round')
        else if (await adminAct({ action: 'grant', room, playerId: myId, asset, amount: amt }, `Gave yourself ${fmtGift(asset, amt)}`)) setAmount('')
      } else if (to === 'me') {
        if (giveLocal(asset, amt)) setAmount('')
        else say(false, 'Start a round first: currency goes into your current round')
      } else if (to.startsWith('room:')) {
        const p = others.find((x) => `room:${x.id}` === to)
        if (await adminAct({ action: 'grant', room, playerId: to.slice(5), asset, amount: amt }, `Gave ${p?.name ?? 'player'} ${fmtGift(asset, amt)}`)) setAmount('')
      } else {
        if (!supabase) return
        const name = username.trim()
        const { data } = await supabase.from('profiles').select('id, username').ilike('username', name.replace(/_/g, '\\_')).maybeSingle()
        if (!data) return say(false, `No account called "${name}"`)
        // Yourself by name while you're playing: just add it now.
        if (data.username === me && running && !room) {
          giveLocal(asset, amt)
          setAmount('')
          return
        }
        const { error } = await supabase.from('gifts').insert({ user_id: data.id, asset, amount: amt })
        if (error) return say(false, error.message)
        say(true, `Sent ${fmtGift(asset, amt)} to ${data.username}. It lands in their game within a minute of them playing a round.`)
        setAmount('')
      }
    } finally {
      setBusy(false)
    }
  }

  const chip = (on: boolean) => clsx('rounded border px-1.5 py-0.5 text-[11px] font-semibold', on ? 'border-warn/60 bg-warn/10 text-warn' : 'border-line2 text-muted hover:text-ink')
  return (
    <div className="space-y-2 text-[11px]">
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">To</div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setTo('me')} className={chip(to === 'me')}>🫵 Me{me ? ` (${me})` : ''}</button>
          {others.map((p) => (
            <button key={p.id} onClick={() => setTo(`room:${p.id}`)} className={chip(to === `room:${p.id}`)}>{p.avatar} {p.name}</button>
          ))}
          <button onClick={() => setTo('account')} className={chip(to === 'account')}>👤 Any account…</button>
        </div>
        {to === 'account' && (
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Their username" className="mt-1 h-7 w-full rounded border border-line2 bg-bg px-1.5 outline-none focus:border-warn/60" />
        )}
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-dim">Currency</div>
        <div className="flex gap-1">
          {GIFT_ASSETS.map((a) => (
            <button key={a} onClick={() => { setAsset(a); setAmount('') }} className={chip(asset === a)} style={asset === a && a !== 'usd' ? { color: CHAINS[a].color } : undefined}>{giftLabel(a)}</button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 flex flex-wrap gap-1">
          {PRESETS[asset].map((v) => (
            <button key={v} onClick={() => setAmount(String(v))} className={chip(amt === v)}>{fmtGift(asset, v)}</button>
          ))}
        </div>
        <div className="flex gap-1">
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} inputMode="decimal" placeholder={`Amount in ${giftLabel(asset)}`} className={clsx('num min-w-0 flex-1 rounded border border-line2 bg-bg px-1.5 outline-none focus:border-warn/60', compact ? 'h-7' : 'h-8')} />
          <button disabled={busy || !(amt > 0) || (to === 'account' && !username.trim())} onClick={send} className="flex items-center gap-1 rounded bg-warn px-2.5 font-bold text-black hover:brightness-110 disabled:opacity-40">
            <Gift size={12} /> Give
          </button>
        </div>
      </div>
      <p className="text-[9px] leading-snug text-dim">
        {to === 'me' ? 'Goes straight into your current round (USD to your bank, coins to your main wallet).' : to.startsWith('room:') ? 'Lands in their round right away.' : 'Waits in their gift box and lands in their round within a minute once they are playing.'}
      </p>
    </div>
  )
}
