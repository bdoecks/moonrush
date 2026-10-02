import { Check, Copy, Download, Send, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { SIM_SEC_PER_TICK } from '../game/marketEngine'
import { useGame } from '../game/store'
import { useAccount } from '../net/account'
import { mpProfile } from '../net/client'
import { fmtAge, fmtCompact, fmtPct, fmtUsd } from '../utils/format'
import { isSafeImageSrc } from '../utils/image'
import { Modal } from './ui'

// Share cards: one click turns a win (or a brutal loss) into a picture with the game's link on it, to copy, save or
// post. The picture is drawn on a canvas right here in the browser; nothing is uploaded anywhere.

/** Where the card sends people. A local dev address would be useless on a shared picture. */
const LIVE_URL = 'https://moonrush-n2ft.onrender.com'
const gameUrl = () => (/^(localhost|127\.|\[::1\])/.test(location.hostname) ? LIVE_URL : location.origin)

export interface ShareData {
  title: string // "$PEPE" or "This round"
  sub: string // small line under the title
  token?: { emoji: string; hue: number; image?: string } // a coin's card shows its icon
  pnl: number // USD
  pct: number // fraction (1.5 = +150%)
  stats: [label: string, value: string][] // up to four, along the bottom
}

export const useShare = create<{ data: ShareData | null; open: (d: ShareData) => void; close: () => void }>((set) => ({
  data: null,
  open: (data) => set({ data }),
  close: () => set({ data: null }),
}))

if (import.meta.env.DEV) (window as unknown as { __share: typeof useShare }).__share = useShare // for testing a card by hand

const signedUsd =(n: number) => `${n >= 0 ? '+' : '-'}${Math.abs(n) >= 1e6 ? fmtCompact(Math.abs(n)) : fmtUsd(Math.abs(n))}`

/** Open the share card for one coin: everything you did on it across all your wallets this round. */
export function shareToken(tokenId: string) {
  const s = useGame.getState()
  const trades = s.portfolio.trades.filter((t) => t.tokenId === tokenId)
  const t = s.market.tokens.find((x) => x.id === tokenId)
  const pos = s.portfolio.positions[tokenId]
  const last = trades[0] // newest first
  if (!last && !pos) return
  let bought = 0
  let sold = 0
  let realized = 0
  let firstTick = s.market.tick
  let lastTick = 0
  for (const tr of trades) {
    firstTick = Math.min(firstTick, tr.tick)
    lastTick = Math.max(lastTick, tr.tick)
    if (tr.side === 'buy') bought += tr.value
    else {
      sold += tr.value - tr.fee
      realized += tr.pnl ?? 0
    }
  }
  const holding = pos && t ? pos.qty * t.price : 0
  const unrealized = pos ? holding - pos.costBasis : 0
  const pnl = realized + unrealized
  const spent = bought || pos?.costBasis || 0
  const heldTicks = (pos ? s.market.tick : lastTick) - (trades.length ? firstTick : (pos?.openedAt ?? s.market.tick))
  const ticker = t?.ticker ?? last?.ticker ?? '?'
  useShare.getState().open({
    title: `$${ticker}`,
    sub: `${pos ? 'Holding' : 'Sold all'} · held ${fmtAge(Math.max(0, heldTicks) * SIM_SEC_PER_TICK)}`,
    token: { emoji: t?.emoji ?? last?.emoji ?? '🪙', hue: t?.hue ?? last?.hue ?? 120, image: t?.image ?? last?.image },
    pnl,
    pct: spent > 0 ? pnl / spent : 0,
    stats: [
      ['Bought', fmtCompact(spent)],
      ['Sold', sold > 0 ? fmtCompact(sold) : '--'],
      ['Holding', pos ? fmtCompact(holding) : '--'],
    ],
  })
}

// ─── Drawing ─────────────────────────────────────────────────────────────────
const W = 1200
const H = 675
const UP = '#19d989'
const DOWN = '#ff4d6a'
const MONO = "'JetBrains Mono', ui-monospace, Consolas, monospace"
const DISPLAY = "'Space Grotesk', 'Inter', sans-serif"
const SANS = "'Inter', ui-sans-serif, system-ui, sans-serif"

const loadImg = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    // Pictures from other sites must come with permission to be copied, or the finished card can't be saved.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

/** Largest font size (from `max` down) at which `text` fits in `width`. */
function fit(c: CanvasRenderingContext2D, text: string, font: (px: number) => string, max: number, width: number) {
  let px = max
  for (; px > 24; px -= 4) {
    c.font = font(px)
    if (c.measureText(text).width <= width) break
  }
  c.font = font(px)
  return px
}

async function draw(d: ShareData, player: string): Promise<HTMLCanvasElement> {
  // The card uses the game's own fonts; make sure they're loaded before drawing with them.
  await Promise.all([`700 80px ${MONO}`, `700 40px ${DISPLAY}`, `600 24px ${SANS}`].map((f) => document.fonts?.load(f).catch(() => {})))
  const icon = d.token && isSafeImageSrc(d.token.image) ? await loadImg(d.token.image!) : null
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c6ff3d'
  const up = d.pnl >= 0
  const tone = up ? UP : DOWN
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext('2d')!

  // Background: near-black, a green or red glow from the top left, and a faint grid.
  c.fillStyle = '#07080a'
  c.fillRect(0, 0, W, H)
  const glow = c.createRadialGradient(140, 0, 0, 140, 0, 820)
  glow.addColorStop(0, up ? 'rgba(25,217,137,0.34)' : 'rgba(255,77,106,0.34)')
  glow.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = glow
  c.fillRect(0, 0, W, H)
  c.strokeStyle = 'rgba(255,255,255,0.035)'
  c.lineWidth = 1
  for (let x = 60; x < W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke() }
  for (let y = 45; y < H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke() }

  // The big rocket / skull on the right, behind everything.
  c.save()
  c.globalAlpha = 0.9
  c.font = `220px ${SANS}`
  c.textAlign = 'right'
  c.textBaseline = 'middle'
  c.fillText(up ? '🚀' : '💀', W - 70, 300)
  c.restore()

  // Top row: the moon mark and name on the left, the player on the right.
  const PAD = 64
  c.save()
  c.translate(PAD, 52)
  c.scale(1.5, 1.5) // the logo's own 32-unit drawing
  c.fillStyle = accent
  c.beginPath(); c.arc(16, 16, 10, 0, Math.PI * 2); c.fill()
  c.globalCompositeOperation = 'destination-out'
  c.beginPath(); c.arc(21, 12, 9, 0, Math.PI * 2); c.fill()
  c.globalCompositeOperation = 'source-over'
  c.strokeStyle = accent
  c.lineWidth = 2.6
  c.lineCap = 'round'
  c.beginPath(); c.moveTo(6, 27); c.lineTo(13, 20); c.stroke()
  c.restore()
  c.textBaseline = 'middle'
  c.textAlign = 'left'
  c.font = `700 34px ${DISPLAY}`
  if ('letterSpacing' in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '4px'
  c.fillStyle = '#e7e9ee'
  c.fillText('MOON', PAD + 62, 78)
  const moonW = c.measureText('MOON').width
  c.fillStyle = accent
  c.fillText('RUSH', PAD + 62 + moonW, 78)
  if ('letterSpacing' in c) (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = '0px'
  if (player) {
    c.textAlign = 'right'
    c.font = `600 26px ${SANS}`
    c.fillStyle = '#8b93a1'
    c.fillText(player, W - PAD, 78)
    c.textAlign = 'left'
  }

  // The coin (icon, ticker) or the period.
  let x = PAD
  const rowY = 190
  if (d.token) {
    const S = 84
    c.save()
    roundRect(c, x, rowY - S / 2, S, S, 16)
    c.clip()
    if (icon) {
      const side = Math.min(icon.naturalWidth, icon.naturalHeight)
      c.drawImage(icon, (icon.naturalWidth - side) / 2, (icon.naturalHeight - side) / 2, side, side, x, rowY - S / 2, S, S)
    } else {
      const g = c.createRadialGradient(x + S * 0.3, rowY - S * 0.25, 0, x + S * 0.3, rowY - S * 0.25, S)
      g.addColorStop(0, `hsl(${d.token.hue} 80% 55% / 0.75)`)
      g.addColorStop(1, `hsl(${(d.token.hue + 40) % 360} 70% 22%)`)
      c.fillStyle = g
      c.fillRect(x, rowY - S / 2, S, S)
      c.font = `48px ${SANS}`
      c.textAlign = 'center'
      c.fillText(d.token.emoji, x + S / 2, rowY + 4)
      c.textAlign = 'left'
    }
    c.restore()
    x += S + 24
  }
  c.fillStyle = '#e7e9ee'
  fit(c, d.title, (px) => `700 ${px}px ${DISPLAY}`, 56, 560 - (x - PAD))
  c.fillText(d.title, x, rowY - 18)
  c.font = `500 24px ${SANS}`
  c.fillStyle = '#8b93a1'
  c.fillText(d.sub, x, rowY + 28)

  // The number everyone looks at.
  const pctText = fmtPct(d.pct, 1)
  c.fillStyle = tone
  c.textBaseline = 'alphabetic'
  fit(c, pctText, (px) => `700 ${px}px ${MONO}`, 150, 690)
  c.fillText(pctText, PAD - 4, 400)
  c.font = `600 44px ${MONO}`
  c.fillText(signedUsd(d.pnl), PAD, 462)

  // Stats along the bottom.
  const stats = d.stats.slice(0, 4)
  const colW = Math.min(250, (W - PAD * 2) / Math.max(1, stats.length))
  stats.forEach(([label, value], i) => {
    const sx = PAD + i * colW
    c.font = `500 20px ${SANS}`
    c.fillStyle = '#5b6370'
    c.fillText(label.toUpperCase(), sx, 530)
    c.font = `600 30px ${MONO}`
    c.fillStyle = '#e7e9ee'
    c.fillText(value, sx, 568)
  })

  // Footer: where to play, and that none of it is real money.
  c.fillStyle = 'rgba(255,255,255,0.08)'
  c.fillRect(PAD, 600, W - PAD * 2, 1)
  c.textBaseline = 'middle'
  c.font = `600 22px ${SANS}`
  c.fillStyle = accent
  c.fillText(`Play free: ${gameUrl().replace(/^https?:\/\//, '')}`, PAD, 636)
  c.textAlign = 'right'
  c.font = `500 18px ${SANS}`
  c.fillStyle = '#5b6370'
  c.fillText('Simulated trading game · virtual money · fictional tokens', W - PAD, 636)
  return canvas
}

// ─── The window ──────────────────────────────────────────────────────────────
/** Mounted once in the app; shows the card whenever something calls `useShare.open` / `shareToken`. */
export function ShareHost() {
  const data = useShare((s) => s.data)
  const close = useShare((s) => s.close)
  if (!data) return null
  return <ShareWindow data={data} onClose={close} />
}

function ShareWindow({ data, onClose }: { data: ShareData; onClose: () => void }) {
  const notify = useGame((s) => s.notify)
  const username = useAccount((s) => s.profile?.username)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState('')
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [posted, setPosted] = useState<'copied' | 'manual' | null>(null) // after Post on X: what's left for you to do
  useEffect(() => {
    let live = true
    let made = ''
    const guest = mpProfile().name
    const player = username || (/^(guest|anon)$/i.test(guest) ? '' : guest) // a placeholder name isn't worth printing
    void draw(data, player)
      .then((canvas) => new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png')))
      .then((b) => {
        if (!live) return
        if (!b) return setFailed(true)
        made = URL.createObjectURL(b)
        setBlob(b)
        setUrl(made)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [data, username])

  const text = `${data.title} ${fmtPct(data.pct, 1)} (${signedUsd(data.pnl)}) on MOONRUSH, the memecoin trading game. Fake money, real bragging rights.`
  const fileName = `moonrush-${data.title.replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'pnl'}.png`
  const copyImage = async () => {
    if (!blob) return false
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      return true
    } catch {
      return false
    }
  }
  const onCopy = async () => {
    if (await copyImage()) notify({ title: 'COPIED', body: 'Picture copied. Paste it anywhere (Ctrl+V).', tone: 'info', icon: '📋' })
    else notify({ title: "CAN'T COPY HERE", body: 'This browser won’t copy pictures. Use Download.', tone: 'warn', icon: '⚠️' })
  }
  const onPost = async () => {
    // X can't take a picture from a link, so the picture goes on the clipboard and the post opens with the words and the game's link.
    const ok = await copyImage()
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(gameUrl())}`, '_blank', 'noopener')
    setPosted(ok ? 'copied' : 'manual') // stays on screen (a pop-up would be gone by the time you come back from X)
  }
  // Phones: the system share sheet (Messages, Discord, X…) with the picture attached.
  const file = blob ? new File([blob], fileName, { type: 'image/png' }) : null
  const canNative = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  const onNative = () => file && void navigator.share({ files: [file], text, url: gameUrl() }).catch(() => {})

  const btn = 'flex h-9 min-w-max flex-1 items-center justify-center gap-1.5 rounded-md border border-line2 px-2 text-[12px] font-semibold text-muted hover:text-ink disabled:opacity-40'
  return (
    <Modal title="Share" onClose={onClose} wide>
      <div className="overflow-hidden rounded-lg border border-line2 bg-bg" style={{ aspectRatio: `${W} / ${H}` }}>
        {url ? <img src={url} alt={text} className="size-full" /> : <div className="grid size-full place-items-center text-[12px] text-dim">{failed ? 'Could not make the picture in this browser.' : 'Making your card…'}</div>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => void onCopy()} disabled={!blob} className="flex h-9 min-w-max flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-2 text-[12px] font-bold text-accent-ink disabled:opacity-40">{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy picture'}</button>
        <a href={url || undefined} download={fileName} aria-disabled={!url} className={btn}><Download size={13} /> Download</a>
        <button onClick={() => void onPost()} disabled={!blob} className={btn}><Send size={13} /> Post on X <span className="font-normal text-dim">(then paste)</span></button>
        {canNative && <button onClick={onNative} className={btn}><Share2 size={13} /> Share…</button>}
      </div>
      {posted && (
        <div className="mt-3 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-[12px] text-ink">
          {posted === 'copied' ? (
            <><b>One more step:</b> the picture is copied. In the X post, click the text box and press <b>Ctrl+V</b> (on a phone: hold, then Paste) to add it.</>
          ) : (
            <><b>One more step:</b> this browser can’t copy pictures. Click <b>Download</b>, then attach the saved picture to your X post.</>
          )}
        </div>
      )}
      <p className="mt-2 text-[10px] text-dim">X doesn’t let websites attach pictures to a post, so the picture is copied for you to paste. It’s made on your device and only goes where you put it.</p>
    </Modal>
  )
}
