import clsx from 'clsx'
import { AlertTriangle, Bot, Check, ChefHat, ChevronDown, Dices, Flame, Globe, Search, Send, Timer, AtSign } from 'lucide-react'
import { ChainBadge } from '../components/chain'
import { load, save } from '../utils/storage'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Card } from '../components/discover/Trenches'
import { ImagePicker } from '../components/cook/ImagePicker'
import { AirdropPanel, BundlerSection, SideWalletsSection, VolumeBotPanel } from '../components/cook/DevTools'
import { useWallets } from '../hooks/useWallets'
import { BUNDLE_WALLET_FEE, bundleDetectChance, STAGGER_FEE } from '../game/devTools'
import { EmptyState, Segmented, TokenIcon } from '../components/ui'
import { COOK_EMOJIS, NARRATIVES, narrativeLabel } from '../data/narratives'
import { postLaunchFee } from '../game/sparks'
import { COOK_FEE, cookAllowance, cookQuality, secPerTickOf, SUPPLY, vampBoost } from '../game/marketEngine'
import { COOK_COOLDOWN_TICKS, GRAD_BONUS, selectSpeed, useGame, validateCook } from '../game/store'
import { CREATOR_CUT, creatorRate, previewBuy, SWAP_FEE } from '../game/tradingEngine'
import { curveAt, curveLiquidityUsd, gradMcapUsd, gradRaise, launchMcapUsd } from '../game/curve'
import { defaultPad, LAUNCHPADS, padsFor } from '../data/launchpads'
import { PadBadge } from '../components/pad'
import { CHAIN_IDS, CHAINS, fmtNative } from '../data/chains'
import type { Chain, CookSpec, LaunchStyle, Narrative, Token } from '../types'
import { fmtAge, fmtClock, fmtCompact, fmtPct, fmtUsd, toneClass } from '../utils/format'

const PREFIXES = ['Baby', 'Based', 'Turbo', 'Sir', 'Mega', 'Lil', 'Super', 'Dark', 'Giga', 'Sleepy', 'Angry', 'Rich', 'Tiny', 'Cosmic']
const NOUNS: Record<Narrative, string[]> = {
  dogs: ['Pup', 'Woof', 'Doggo', 'Barkley', 'Shibe'],
  cats: ['Kitty', 'Meow', 'Purr', 'Tabby', 'Whisker'],
  frogs: ['Ribbit', 'Toad', 'Froggy', 'Croak', 'Lilypad'],
  ai: ['Agent', 'Neural', 'Circuit', 'Synth', 'Botling'],
  food: ['Burger', 'Taco', 'Noodle', 'Pizza', 'Dumpling'],
  space: ['Rocket', 'Comet', 'Astro', 'Orbit', 'Nebula'],
  absurd: ['Spoon', 'Sock', 'Rock', 'Vibe', 'Chair'],
  retro: ['Pixel', 'Arcade', 'Cart', 'Joystick', 'Sprite'],
}
const EMOJI_FOR: Record<Narrative, string[]> = {
  dogs: ['🐶', '🦊'], cats: ['🐱', '🐼'], frogs: ['🐸', '🍄'], ai: ['🤖', '🧠'], food: ['🍕', '🌮', '🍩'], space: ['🚀', '🌙', '👽'], absurd: ['🫠', '🗿', '🤡'], retro: ['👾', '🎲'],
}
const STYLES: { value: LaunchStyle; label: string; hint: string }[] = [
  { value: 'fair', label: 'Fair', hint: 'Balanced: some snipers, normal holder spread.' },
  { value: 'hyped', label: 'Hyped', hint: 'Big splash and early momentum, but snipers and insiders pile in and dump on you.' },
  { value: 'stealth', label: 'Stealth', hint: 'Quiet launch: almost no snipers, clean holders, slower start.' },
]
const MARKETING = [0, 100, 250, 500, 1000, 2500]
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

function randomIdentity(n: Narrative, tokens: Token[] = []) {
  // A suggestion whose ticker is already live would open the page on a greyed-out button: draw again a few times.
  const live = new Set(tokens.filter((t) => t.status !== 'dead' && t.status !== 'rugged').map((t) => t.ticker))
  for (let tries = 0; tries < 20; tries++) {
    const id = drawIdentity(n)
    if (!live.has(id.ticker) || tries === 19) return id
  }
  return drawIdentity(n)
}

function drawIdentity(n: Narrative) {
  const noun = pick(NOUNS[n])
  const pre = pick(PREFIXES)
  const ticker = (Math.random() < 0.5 ? noun : pre.slice(0, 2) + noun).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return { name: `${pre} ${noun}`, ticker, emoji: pick(EMOJI_FOR[n]), hue: Math.floor(Math.random() * 360) }
}

export function CookingView() {
  const meta = useGame((s) => s.market.meta)
  const metaUntil = useGame((s) => s.market.metaUntil ?? 0)
  const tick = useGame((s) => s.market.tick)
  const now = useGame((s) => s.market.time)
  const tokens = useGame((s) => s.market.tokens)
  const cash = useGame((s) => s.portfolio.cash)
  const launches = useGame((s) => s.launches)
  const lastCookTick = useGame((s) => s.lastCookTick)
  const running = useGame((s) => s.runStatus === 'running')
  const world = useGame((s) => !!s.online?.round.world)
  const online = useGame((s) => !!s.online)
  const engine = useGame((s) => s.market.engine)
  const speed = useGame(selectSpeed)
  const cook = useGame((s) => s.cook)
  const select = useGame((s) => s.select)
  const setModal = useGame((s) => s.setModal)

  const chainFilter = useGame((s) => s.chainFilter)
  const native = useGame((s) => s.market.native)
  const balances = useGame((s) => s.portfolio.balances)
  const wallets = useWallets()
  const autoSwap = useGame((s) => s.settings.autoSwap)
  const setSwapOpen = useGame((s) => s.setSwapOpen)
  const [spec, setSpec] = useState<CookSpec>(() => {
    const n = meta ?? 'dogs'
    const chain: Chain = chainFilter === 'all' ? 'sol' : chainFilter
    return { ...randomIdentity(n, tokens), chain, description: '', narrative: n, socials: { x: true, tg: false, web: false }, style: 'fair', marketing: 250, devBuy: CHAINS[chain].quick[1], pad: defaultPad(chain), tax: { buy: 0.03, sell: 0.03 }, bundle: { wallets: 0, perWallet: CHAINS[chain].quick[0], stagger: false } }
  })
  const up = (patch: Partial<CookSpec>) => setSpec((s) => ({ ...s, ...patch }))
  // Launching on a post (the story market, in the World): the posts the timeline has not settled yet, newest first.
  // (Not a tool's post: those coins need a site.) A post that settles while the form is open is let go of.
  const inWorld = useGame((s) => !!s.online?.round.world)
  const sparks = useGame((s) => s.market.sparks)
  const openPosts = inWorld ? (sparks ?? []).filter((x) => !x.picked && x.over === undefined && x.kind !== 'tech').slice(0, 12) : []
  const onPost = spec.onPost ? openPosts.find((x) => x.id === spec.onPost) : undefined
  useEffect(() => {
    if (spec.onPost && !onPost) setSpec((s) => ({ ...s, onPost: undefined }))
  }, [spec.onPost, onPost])
  const chainMeta = CHAINS[spec.chain]
  const px = native?.[spec.chain]?.price ?? chainMeta.basePrice
  const devUsd = spec.devBuy * px
  const setChain = (c: Chain) => {
    // Keep roughly the same dollar-size dev buy when switching chains.
    const newPx = native?.[c]?.price ?? CHAINS[c].basePrice
    const d = 10 ** CHAINS[c].decimals
    const conv = (v: number) => Math.round(((v * px) / newPx) * d) / d
    up({ chain: c, pad: defaultPad(c), devBuy: conv(spec.devBuy), bundle: { ...spec.bundle, perWallet: conv(spec.bundle.perWallet) } })
  }
  const bundleOn = spec.bundle.wallets > 0
  const bundleNative = bundleOn ? spec.bundle.wallets * spec.bundle.perWallet : 0
  const bundleUsd = bundleNative * px
  const bundleFees = bundleOn ? spec.bundle.wallets * BUNDLE_WALLET_FEE + (spec.bundle.stagger ? bundleUsd * STAGGER_FEE : 0) : 0

  // Dev buy, then the bundle, against the chosen launchpad's fresh curve (both paid in the chain's coin).
  const pad = LAUNCHPADS[spec.pad]
  const tax = pad.tax ? spec.tax : undefined
  const est = useMemo(() => {
    const at = (mcap: number) => ({ pad: spec.pad, tax, status: 'bonding', price: mcap / SUPPLY, liquidity: curveLiquidityUsd(spec.pad, mcap / SUPPLY / px, px) }) as Token
    let mcap = launchMcapUsd(spec.pad, px) * 1.0005
    const q = devUsd > 0 ? previewBuy(at(mcap), devUsd) : null
    const devPct = q ? (q.qty / SUPPLY) * 100 : 0
    if (q) mcap = q.newPrice * SUPPLY
    let bundlePct = 0
    if (bundleUsd > 0) {
      const b = previewBuy(at(mcap), bundleUsd)
      bundlePct = (b.qty / SUPPLY) * 100
      mcap = b.newPrice * SUPPLY
    }
    return { devPct, bundlePct, mcap }
  }, [devUsd, bundleUsd, spec.pad, tax, px])
  const detect = bundleDetectChance(spec.bundle.wallets, est.bundlePct, spec.bundle.stagger)
  const vampOrig = spec.vampOf ? tokens.find((t) => t.id === spec.vampOf) : undefined
  const quality = cookQuality(spec, meta, est.devPct, vampOrig)
  const vampLift = vampBoost(vampOrig)
  const launchFee = onPost ? postLaunchFee(onPost.by.followers) : COOK_FEE
  const usdCosts = launchFee + spec.marketing + bundleFees
  // The dev buy and bundle are paid by the deployer wallet.
  const devAcc = wallets.all.find((a) => a.id === spec.devWallet) ?? wallets.primary
  const nativeBal = devAcc?.balances[spec.chain] ?? 0
  const sideNative = (spec.sideBuys ?? []).filter((x) => x.walletId !== devAcc?.id).reduce((a, x) => a + x.amount, 0)
  const devShortUsd = Math.max(0, (spec.devBuy + bundleNative - nativeBal) * px)
  const cost = usdCosts + (autoSwap ? devShortUsd / (1 - SWAP_FEE) : 0)
  const devBlocked = devShortUsd > 0 && (!autoSwap || cost > cash + 1e-9)
  const cooldown = Math.max(0, COOK_COOLDOWN_TICKS - (tick - lastCookTick))
  const allow = cookAllowance(world, launches.map((l) => l.launchedTick), tick, secPerTickOf({ engine }))
  const error = validateCook(spec, tokens, online, world)
  const blocker = !running
    ? 'Start a round to cook'
    : error ?? (allow.blocked ? allow.blocked : cooldown > 0 ? `Kitchen cooling down (${cooldown}s)` : usdCosts > cash + 1e-9 ? `Need ${fmtUsd(usdCosts)} USD` : devBlocked ? `Not enough ${chainMeta.native}` : null)
  // Dev buy is capped at ~$3K; with auto-swap your spare USD counts toward it.
  const spendable = nativeBal + (autoSwap ? (Math.max(0, cash - usdCosts) * (1 - SWAP_FEE)) / px : 0)
  const maxDev = Math.max(0, Math.min(3000 / px, spendable - bundleNative))
  const devStep = chainMeta.quick[0] / 5
  // Bundle wallets: up to ~$500 each, from whatever the dev buy leaves.
  const maxPerWallet = Math.max(0, Math.min(500 / px, (spendable - spec.devBuy) / Math.max(1, spec.bundle.wallets || 1)))

  const preview: Token = useMemo(() => ({
    id: 'preview', chain: spec.chain, pad: spec.pad, tax, image: spec.image, name: spec.name || 'Your Token', ticker: spec.ticker || 'TICKER', emoji: spec.emoji, hue: spec.hue, createdAt: now, price: est.mcap / SUPPLY, supply: SUPPLY,
    mcap: est.mcap, ath: est.mcap, liquidity: curveLiquidityUsd(spec.pad, est.mcap / SUPPLY / px, px), volume: devUsd + bundleUsd, buys: (spec.devBuy > 0 ? 1 : 0) + spec.bundle.wallets, sells: 0, holders: (spec.devBuy > 0 ? 1 : 0) + spec.bundle.wallets,
    momentum: 0, momentumScore: 50, hype: 20 + quality * 70, volatility: 0.015, top10Pct: spec.style === 'stealth' ? 15 : spec.style === 'hyped' ? 35 : 22,
    devPct: est.devPct, bundlePct: est.bundlePct || undefined, snipers: spec.style === 'hyped' ? 14 : spec.style === 'stealth' ? 1 : 5, insidersPct: spec.style === 'hyped' ? 10 : 2, rugProb: 0,
    riskScore: 0, riskLevel: est.devPct > 15 ? 'HIGH' : est.devPct > 6 ? 'MEDIUM' : 'LOW', status: 'bonding', bondingProgress: curveAt(spec.pad, est.mcap / SUPPLY / px).progress,
    change: { '1m': 0, '5m': 0, '1h': 0, '24h': 0 }, tape: [], creator: 'you',
    sim: { archetype: 'runner', regime: 'sideways', regimeTicks: 0, drift: 0, volMult: 1, anchor: 0, meanRev: 0, beta: 0, pressure: 0, volBoost: 0, rugAt: null, baseTurnover: 0 },
  }), [spec, est, now, quality, devUsd, bundleUsd, px, tax])

  const [tab, setTab0] = useState<CookTab>(() => load<CookTab>('cookTab') ?? 'create')
  const setTab = (t: CookTab) => {
    setTab0(t)
    save('cookTab', t)
  }
  const [showEmojis, setShowEmojis] = useState(false)
  const sideCount = (spec.sideBuys ?? []).filter((x) => x.walletId !== devAcc?.id).length
  const [advanced, setAdvanced] = useState(() => bundleOn)

  const submit = () => {
    const id = cook(spec)
    if (id) {
      const n = spec.narrative
      setSpec((s) => ({ ...s, ...randomIdentity(n, tokens), description: '', image: undefined, vampOf: undefined }))
      setTab('launches') // see it go live
    }
  }

  const metaInfo = narrativeLabel(meta)
  const vibe = quality < 0.3 ? { label: 'Mid', icon: '😐', cls: 'text-muted' } : quality < 0.5 ? { label: 'Decent', icon: '🙂', cls: 'text-info' } : quality < 0.7 ? { label: 'Cooking', icon: '🔥', cls: 'text-warn' } : { label: 'Absolute banger', icon: '🚀', cls: 'text-up' }
  const totalEarned = launches.reduce((a, r) => a + r.fees, 0)

  const socialsOn = Object.values(spec.socials).filter(Boolean).length
  const creatorPct = (creatorRate({ pad: spec.pad, tax }) * 100).toFixed(1)
  const fmtFee = (f: number) => `${(f * 100).toFixed(2).replace(/\.?0+$/, '')}%`

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-3 p-3">
        {/* Header: title, tabs, meta, round stats */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-lg bg-warn/15 text-warn"><ChefHat size={18} /></div>
            <h1 className="font-display text-[17px] font-bold">Cooking</h1>
          </div>
          <div role="tablist" className="flex gap-1 rounded-md border border-line2 bg-bg p-0.5">
            {([['create', 'Create coin'], ['vamp', '🧛 Vamp coin'], ['launches', `My launches${launches.length ? ` · ${launches.length}` : ''}`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('rounded px-3 py-1 text-[12px] font-bold transition-colors', tab === k ? 'bg-raise text-ink' : 'text-dim hover:text-muted')}>
                {label}
              </button>
            ))}
          </div>
          {metaInfo && (
            <button onClick={() => { up({ narrative: meta! }); setTab('create') }} title="Use the meta narrative" className="flex items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] hover:bg-warn/15">
              <Flame size={13} className="text-warn" />
              <span className="text-[10px] uppercase tracking-wider text-warn/80">Meta</span>
              <span className="font-bold text-warn">{metaInfo.icon} {metaInfo.label}</span>
              <span className="num flex items-center gap-0.5 text-[10px] text-muted"><Timer size={10} />{fmtClock((metaUntil - tick) / speed)}</span>
            </button>
          )}
          <div className="ml-auto flex gap-4 text-right">
            <MiniStat label={allow.per === 'hour' ? 'Launches this hour' : 'Launches'}>{allow.used}/{allow.max}</MiniStat>
            <MiniStat label="Creator earnings"><span className="text-up">{fmtUsd(totalEarned)}</span></MiniStat>
            <MiniStat label="Kitchen">{cooldown > 0 ? <span className="text-warn">{cooldown}s</span> : <span className="text-up">Ready</span>}</MiniStat>
          </div>
        </div>

        {tab === 'launches' ? (
          <>
            <MyLaunches onCreate={() => setTab('create')} />
            <RecentlyCooked tokens={tokens} now={now} onOpen={(id) => select(id)} />
          </>
        ) : tab === 'vamp' ? (
          <VampPicker
            tokens={tokens}
            now={now}
            onVamp={(orig, style) => {
              setSpec((s) => vampSpec(s, orig, style))
              setTab('create')
            }}
          />
        ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-3">
            {/* ① Coin */}
            <Step n={1} title="Your coin" hint="Name, ticker, picture" right={
              <button onClick={() => up(randomIdentity(spec.narrative, tokens))} className="flex items-center gap-1 rounded border border-line2 px-2 py-0.5 text-[11px] text-muted hover:border-accent/50 hover:text-accent">
                <Dices size={12} /> Randomize
              </button>
            }>
              {openPosts.length > 0 && (
                <div className="mb-3 rounded-md border border-info/40 bg-info/5 px-2.5 py-2 text-[12px]">
                  <label className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink">Launch on a post</span>
                    <select value={spec.onPost ?? ''} onChange={(e) => up({ onPost: e.target.value || undefined })} className="min-w-0 flex-1 rounded border border-line2 bg-bg px-1.5 py-1 text-[12px] text-ink">
                      <option value="">No post: a coin of my own</option>
                      {openPosts.map((x) => <option key={x.id} value={x.id}>@{x.by.handle} ({fmtCompact(x.by.followers, '')}): {x.text.slice(0, 60)}</option>)}
                    </select>
                  </label>
                  {onPost && <p className="mt-1.5 text-muted"><b className="text-ink">@{onPost.by.handle}:</b> {onPost.text}<br /><span className="text-dim">Your coin joins the coins launched on this post. Type the name and ticker yourself: the timeline favours the coin spelled exactly as the post has it, with a clean risk tag. Other coins on the post may carry the same ticker. The launch fee on this post is <b className="text-ink">{fmtUsd(postLaunchFee(onPost.by.followers), 0)}</b>: the bigger the account, the more it costs. If the post is settled before you launch, the launch is refused and costs nothing.</span></p>}
                </div>
              )}
              {spec.vampOf && (
                <div className={clsx('mb-3 flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[12px]', vampLift > 0 ? 'border-accent/40 bg-accent/5' : 'border-warn/40 bg-warn/5')}>
                  <span className="text-[16px]">🧛</span>
                  {vampOrig ? (
                    <>
                      <span>
                        Vamping <b>${vampOrig.ticker}</b> <span className="num text-dim">{fmtCompact(vampOrig.mcap)} MC · 1h <span className={toneClass(vampOrig.change['1h'] ?? 0)}>{fmtPct(vampOrig.change['1h'] ?? 0)}</span></span>
                      </span>
                      <span className={clsx('num text-[11px] font-semibold', vampLift > 0 ? 'text-up' : 'text-warn')}>
                        {vampLift > 0 ? `riding its hype: +${Math.round(vampLift * 100)} vibe` : vampOrig.status === 'dead' || vampOrig.status === 'rugged' ? `it's ${vampOrig.status}: ${Math.round(vampLift * 100)} vibe` : 'not much hype to ride right now'}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">The coin you were vamping is gone.</span>
                  )}
                  <span className="text-[10px] text-dim">Your coin will be tagged as a vamp.</span>
                  <button onClick={() => up({ vampOf: undefined })} className="ml-auto rounded border border-line2 px-2 py-0.5 text-[11px] text-muted hover:text-ink">Stop vamping</button>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <ImagePicker image={spec.image} emoji={spec.emoji} hue={spec.hue} onChange={(image) => up({ image })} onHue={(hue) => up({ hue })} />
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                    <Field label="Name">
                      <input value={spec.name} maxLength={24} onChange={(e) => up({ name: e.target.value })} placeholder="Based Pup" className={inputCls} />
                    </Field>
                    <Field label="Ticker">
                      <div className="flex items-center rounded-md border border-line2 bg-bg pl-2 focus-within:border-accent/60">
                        <span className="text-dim">$</span>
                        <input value={spec.ticker} maxLength={10} onChange={(e) => up({ ticker: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="PUP" className="num h-8 w-full bg-transparent px-1 text-[13px] font-bold outline-none" />
                      </div>
                    </Field>
                  </div>
                  <Field label={`Description · optional (${spec.description.length}/140)`}>
                    <textarea value={spec.description} maxLength={140} rows={2} onChange={(e) => up({ description: e.target.value })} placeholder="The only pup that understands the chart. A good story adds a little trust." className={clsx(inputCls, 'h-auto resize-none py-1.5')} />
                  </Field>
                  <button onClick={() => setShowEmojis((v) => !v)} aria-expanded={showEmojis} className="flex items-center gap-1.5 text-[11px] text-muted hover:text-ink">
                    <span className="grid size-6 place-items-center rounded bg-raise text-[15px]">{spec.emoji}</span>
                    {spec.image ? 'Fallback emoji' : 'Emoji icon'} · <span className="text-accent">{showEmojis ? 'Done' : 'Change'}</span>
                    <ChevronDown size={12} className={clsx('transition-transform', showEmojis && 'rotate-180')} />
                  </button>
                </div>
              </div>
              {showEmojis && (
                <div className="mt-2 grid grid-cols-10 gap-1 rounded-md border border-line2 bg-bg p-1.5 sm:grid-cols-[repeat(20,minmax(0,1fr))]">
                  {COOK_EMOJIS.map((e) => (
                    <button key={e} onClick={() => up({ emoji: e })} className={clsx('grid aspect-square place-items-center rounded text-[16px] transition-colors', spec.emoji === e ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-raise')} aria-label={`Icon ${e}`}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </Step>

            {/* ② Chain + launchpad */}
            <Step n={2} title="Chain & launchpad" hint={`Earn ${creatorPct}% of volume · ${fmtUsd(GRAD_BONUS, 0)} bonus if it migrates`}>
              <div role="radiogroup" aria-label="Chain" className="grid grid-cols-3 gap-1.5">
                {CHAIN_IDS.map((c) => {
                  const m = CHAINS[c]
                  const on = spec.chain === c
                  return (
                    <button key={c} role="radio" aria-checked={on} onClick={() => setChain(c)} className={clsx('rounded-md border px-2.5 py-1.5 text-left transition-colors', on ? 'bg-raise' : 'border-line2 hover:bg-panel2')} style={on ? { borderColor: m.color } : undefined}>
                      <div className="truncate text-[12px] font-bold" style={{ color: m.color }}>{m.glyph} {m.name}</div>
                      <div className="num truncate text-[10px] text-dim">pay in {m.native} · hold {fmtNative(balances?.[c] ?? 0, c)}</div>
                    </button>
                  )
                })}
              </div>
              <div role="radiogroup" aria-label="Launchpad" className="mt-2 overflow-hidden rounded-md border border-line2">
                <div className="hidden grid-cols-[minmax(0,1.3fr)_1fr_1fr_0.7fr_0.8fr] gap-2 border-b border-line2 bg-bg px-2.5 py-1 text-[9px] font-semibold uppercase tracking-wider text-dim sm:grid">
                  <span>Launchpad</span><span className="text-right">Starts at</span><span className="text-right">Migrates at</span><span className="text-right">Fee</span><span className="text-right">You earn</span>
                </div>
                {padsFor(spec.chain).map((p) => {
                  const on = spec.pad === p.id
                  return (
                    <button
                      key={p.id}
                      role="radio"
                      aria-checked={on}
                      onClick={() => up({ pad: p.id })}
                      className={clsx('num grid w-full grid-cols-2 items-center gap-x-2 border-b border-line/50 px-2.5 py-1.5 text-left text-[11px] last:border-b-0 sm:grid-cols-[minmax(0,1.3fr)_1fr_1fr_0.7fr_0.8fr]', on ? 'bg-raise shadow-[inset_3px_0_0_var(--pc)]' : 'hover:bg-panel2')}
                      style={{ ['--pc' as string]: p.color }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 font-sans text-[12px] font-bold" style={{ color: p.color }}><PadBadge pad={p.id} size={16} /><span className="truncate">{p.name}</span></span>
                      <span className="text-right text-muted">{fmtCompact(launchMcapUsd(p.id, px))}</span>
                      <span className="text-right text-muted">{fmtCompact(gradMcapUsd(p.id, px))} <span className="text-dim">→ {p.dex}</span></span>
                      <span className="text-right text-dim">{fmtFee(p.fee)}</span>
                      <span className="text-right text-up" title={p.pumpSwap ? `On the curve, then a dynamic creator fee after migrating (${fmtFee(0.0095 * CREATOR_CUT)}, tapering to ${fmtFee(0.0005 * CREATOR_CUT)} as the coin grows)` : undefined}>{p.tax ? 'tax' : p.pumpSwap ? `${fmtFee(p.creatorFee * CREATOR_CUT)}→${fmtFee(0.0095 * CREATOR_CUT)}` : fmtFee(p.creatorFee * CREATOR_CUT)}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">{pad.blurb} <span className="text-dim">· {fmtNative(gradRaise(pad.id), spec.chain)} raise to migrate. Curve numbers are game approximations.</span></p>
              {pad.tax && (
                <div className="mt-2 grid gap-3 rounded-md border border-warn/30 bg-warn/5 p-2 sm:grid-cols-2">
                  {(['buy', 'sell'] as const).map((side) => (
                    <div key={side}>
                      <div className="flex justify-between text-[11px]"><span className="text-dim">{side === 'buy' ? 'Buy tax' : 'Sell tax'}</span><span className="num font-bold text-warn">{Math.round(spec.tax[side] * 100)}%</span></div>
                      <input type="range" min={0} max={0.1} step={0.01} value={spec.tax[side]} onChange={(e) => up({ tax: { ...spec.tax, [side]: Number(e.target.value) } })} className="w-full accent-[var(--accent)]" aria-label={`${side} tax`} />
                    </div>
                  ))}
                  <p className="text-[10px] text-dim sm:col-span-2">Taxes are paid to you on every trade, but high taxes scare buyers off and hurt the vibe.</p>
                </div>
              )}
            </Step>

            {/* ③ Hype */}
            <Step n={3} title="Hype" hint="What makes buyers show up">
              <Row label="Narrative">
                <div className="flex flex-wrap gap-1">
                  {NARRATIVES.map((n) => (
                    <button key={n.id} onClick={() => up({ narrative: n.id })} className={clsx('flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] font-semibold transition-colors', spec.narrative === n.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                      {n.icon} {n.label}
                      {n.id === meta && <span className="rounded bg-warn/20 px-1 text-[9px] text-warn">🔥 META</span>}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Launch style" hint={STYLES.find((s) => s.value === spec.style)!.hint}>
                <Segmented value={spec.style} onChange={(v) => up({ style: v })} options={STYLES.map((s) => ({ value: s.value, label: s.label }))} />
              </Row>
              <Row label="Socials" hint="Each adds hype and trust. Fictional, nothing gets posted.">
                <div className="flex flex-wrap gap-1">
                  {([['x', 'X', <AtSign size={12} key="x" />], ['tg', 'Telegram', <Send size={12} key="tg" />], ['web', 'Website', <Globe size={12} key="w" />]] as const).map(([k, label, icon]) => {
                    const on = spec.socials[k]
                    return (
                      <button key={k} aria-pressed={on} onClick={() => up({ socials: { ...spec.socials, [k]: !on } })} className={clsx('flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px] font-semibold transition-colors', on ? 'border-up/50 bg-up/10 text-up' : 'border-line2 text-dim hover:text-ink')}>
                        {icon}{label}{on && <Check size={11} />}
                      </button>
                    )
                  })}
                </div>
              </Row>
              <Row label="Marketing" hint="Spent on fictional shills: early buy pressure, diminishing returns.">
                <div className="flex flex-wrap gap-1">
                  {MARKETING.map((m) => (
                    <button key={m} onClick={() => up({ marketing: m })} className={clsx('num min-w-[44px] rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', spec.marketing === m ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line2 text-muted hover:text-ink')}>
                      {m === 0 ? 'None' : `$${m >= 1000 ? `${m / 1000}K` : m}`}
                    </button>
                  ))}
                </div>
              </Row>
            </Step>

            {/* ④ Dev wallet (deployer) + side buys */}
            <Step n={4} title="Dev wallet" hint="Which wallet deploys it (everyone can track it)">
              <SideWalletsSection spec={spec} onChange={up} />
            </Step>

            {/* ⑤ Dev buy + advanced */}
            <Step n={5} title="Dev buy" hint="Your own bag at launch" right={<span className="num text-[13px] font-bold" style={{ color: chainMeta.color }}>{fmtNative(spec.devBuy, spec.chain)} <span className="text-[10px] font-normal text-dim">≈{fmtUsd(devUsd, 0)}</span></span>}>
              <input type="range" min={0} max={Math.max(maxDev, spec.devBuy)} step={devStep} value={spec.devBuy} onChange={(e) => up({ devBuy: Number(e.target.value) })} className="w-full accent-[var(--accent)]" aria-label={`Dev buy amount in ${chainMeta.native}`} />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span className={clsx('num font-bold', est.devPct > 15 ? 'text-down' : est.devPct > 6 ? 'text-warn' : 'text-up')} title="Estimate: the exact launch price varies a little">≈{est.devPct.toFixed(1)}% of supply</span>
                <span className="text-dim">
                  You hold {fmtNative(nativeBal, spec.chain)}{devShortUsd > 0 && (autoSwap ? <span className="text-info"> · auto-swaps {fmtUsd(devShortUsd / (1 - SWAP_FEE))}</span> : <span className="text-warn"> · short</span>)}
                </span>
                <button onClick={() => setSwapOpen(true)} className="ml-auto rounded bg-raise px-1.5 py-px text-[10px] font-bold text-accent">Swap</button>
              </div>
              {est.devPct > 8 && (
                <p className="mt-1 flex items-start gap-1 text-[10px] text-warn"><AlertTriangle size={11} className="mt-px shrink-0" />Buyers can see a big dev bag in the audit, and it scares them off. Selling it later hits the price hard.</p>
              )}

              <div className="mt-3 rounded-md border border-line2">
                <button onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
                  <span className="text-[12px] font-bold">Advanced</span>
                  <span className="text-[11px] text-dim">bundle wallets</span>
                  {bundleOn && <span className="rounded bg-info/15 px-1.5 text-[10px] font-bold text-info">📦 Bundle ×{spec.bundle.wallets}</span>}
                  <ChevronDown size={14} className={clsx('ml-auto text-dim transition-transform', advanced && 'rotate-180')} />
                </button>
                {advanced && (
                  <div className="space-y-2 border-t border-line2 p-2">
                    <BundlerSection spec={spec} onChange={(bundle) => up({ bundle: { ...spec.bundle, ...bundle } })} est={est} detect={detect} bundleUsd={bundleUsd} bundleFees={bundleFees} maxPerWallet={maxPerWallet} />
                  </div>
                )}
              </div>
            </Step>
          </div>

          {/* Summary: preview, vibe, cost, cook */}
          <aside className="overflow-hidden rounded-md border border-line bg-panel lg:sticky lg:top-3 lg:self-start">
            <div className="border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted">Preview · how it shows in New Pairs</div>
            <Card t={preview} now={now} preview />

            <div data-tut="cook-vibe" className="border-t border-line p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Vibe check</span>
                <span className={clsx('text-[13px] font-bold', vibe.cls)}>{vibe.icon} {vibe.label}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line2">
                <div className="h-full bg-gradient-to-r from-down via-warn to-up transition-all duration-300" style={{ width: `${quality * 100}%` }} />
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                <Factor ok={spec.narrative === meta}>{spec.narrative === meta ? 'On meta' : 'Off meta'}</Factor>
                <Factor ok={socialsOn >= 2}>{socialsOn}/3 socials</Factor>
                <Factor ok={spec.marketing >= 250}>{spec.marketing ? `${fmtUsd(spec.marketing, 0)} marketing` : 'No marketing'}</Factor>
                <Factor ok={est.devPct <= 6}>Dev bag {est.devPct.toFixed(1)}%</Factor>
                {bundleOn && <Factor ok={detect < 0.3}>Bundle {Math.round(detect * 100)}% spot risk</Factor>}
                {spec.vampOf && <Factor ok={vampLift > 0}>{vampLift > 0 ? `Vamp riding $${vampOrig?.ticker}` : 'Vamp of a cold coin'}</Factor>}
              </ul>
            </div>

            <div className="border-t border-line p-3 text-[12px]">
              <Line label={onPost ? 'Launch fee (on a post) + marketing' : 'Launch fee + marketing'}>{fmtUsd(launchFee + spec.marketing, 0)}</Line>
              <Line label={`Dev buy · ${est.devPct.toFixed(1)}%`}>{fmtNative(spec.devBuy, spec.chain)} <span className="text-dim">≈{fmtUsd(devUsd, 0)}</span></Line>
              {bundleOn && <Line label={`Bundle ×${spec.bundle.wallets} · ${est.bundlePct.toFixed(1)}%`}>{fmtNative(bundleNative, spec.chain)} <span className="text-dim">+{fmtUsd(bundleFees, 0)} fees</span></Line>}
              {sideNative > 0 && <Line label={`Side buys · ${sideCount} wallet${sideCount > 1 ? 's' : ''}${spec.sideDelay ? ' (over 1 min)' : ''}`}>{fmtNative(sideNative, spec.chain)} <span className="text-dim">≈{fmtUsd(sideNative * px, 0)}</span></Line>}
              <div className="my-1.5 border-t border-line" />
              <Line label={<span className="font-semibold text-ink">Total</span>}><span className="text-[14px] font-bold">≈{fmtUsd(usdCosts + devUsd + bundleUsd, 0)}</span></Line>
              <div className="num mt-0.5 flex justify-between text-[10px] text-dim">
                <span>After: {fmtUsd(cash - cost, 0)} USD</span>
                <span>{fmtNative(Math.max(0, nativeBal - spec.devBuy - bundleNative), spec.chain)} in dev wallet</span>
              </div>
              {running ? (
                <button
                  data-tut="cook-button"
                  disabled={!!blocker}
                  onClick={submit}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-warn text-[14px] font-extrabold text-black transition-all hover:brightness-110 hover:shadow-[0_0_24px_-6px_#ffb020] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🍳 {blocker ?? `COOK $${spec.ticker}`}
                </button>
              ) : (
                <button onClick={() => setModal('mode')} className="mt-3 h-11 w-full rounded-md border border-accent/40 bg-accent/10 text-[13px] font-bold text-accent hover:bg-accent/20">Start a round to cook</button>
              )}
              <p className="mt-2 text-center text-[10px] text-dim">Luck still matters: a banger can flop and a mid launch can moon.</p>
            </div>
          </aside>
        </div>
        )}
      </div>
    </div>
  )
}

function Step({ n, title, hint, right, children }: { n: number; title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-panel p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-warn/15 text-[11px] font-bold text-warn">{n}</span>
        <h2 className="text-[13px] font-bold">{title}</h2>
        {hint && <span className="hidden truncate text-[11px] text-dim sm:inline">{hint}</span>}
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </section>
  )
}

/** One labelled row inside a step: label on the left, control on the right (stacks on phones). */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line/60 py-2 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3">
      <div className="pt-0.5 text-[12px] font-semibold text-muted">{label}</div>
      <div>
        {children}
        {hint && <p className="mt-1 text-[10px] text-dim">{hint}</p>}
      </div>
    </div>
  )
}

const inputCls = 'h-8 w-full rounded-md border border-line2 bg-bg px-2 text-[13px] outline-none placeholder:text-dim focus:border-accent/60'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-dim">{label}</span>
      {children}
    </label>
  )
}
function MiniStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-dim">{label}</div>
      <div className="num text-[13px] font-bold">{children}</div>
    </div>
  )
}
function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-dim">{label}</span>
      <span className="num">{children}</span>
    </div>
  )
}
function Factor({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <li className={clsx('flex items-center gap-1.5', ok ? 'text-up' : 'text-muted')}>{ok ? '✓' : '·'} {children}</li>
}

// ─── Vamp coin: clone a live coin to ride its hype ───────────────────────────
type CookTab = 'create' | 'vamp' | 'launches'
type VampStyle = 'exact' | 'baby' | 'two' | 'inu'
const VAMP_STYLES: { id: VampStyle; label: string }[] = [
  { id: 'exact', label: 'Exact copy' },
  { id: 'baby', label: 'Baby ___' },
  { id: 'two', label: '___ 2.0' },
  { id: 'inu', label: '___ Inu' },
]

function vampName(o: Pick<Token, 'name' | 'ticker'>, style: VampStyle) {
  switch (style) {
    case 'exact': return { name: o.name.slice(0, 24), ticker: o.ticker }
    case 'baby': return { name: `Baby ${o.name}`.slice(0, 24), ticker: `B${o.ticker}`.slice(0, 8) }
    case 'two': return { name: `${o.name} 2.0`.slice(0, 24), ticker: `${o.ticker.slice(0, 7)}2` }
    case 'inu': return { name: `${o.name} Inu`.slice(0, 24), ticker: `${o.ticker.slice(0, 5)}INU` }
  }
}

/** Fill the launch form from a live coin: its look, story, socials and launchpad; your money settings stay yours. */
function vampSpec(base: CookSpec, o: Token, style: VampStyle): CookSpec {
  const chain = o.chain
  const pad = padsFor(chain).some((p) => p.id === o.pad) ? o.pad : defaultPad(chain)
  const sameChain = chain === base.chain
  return {
    ...base,
    ...vampName(o, style),
    emoji: o.emoji,
    hue: o.hue,
    image: o.image,
    description: o.description ?? '',
    narrative: o.narrative ?? base.narrative,
    socials: o.socials ? { ...o.socials } : base.socials,
    chain,
    pad,
    devBuy: sameChain ? base.devBuy : CHAINS[chain].quick[1],
    bundle: sameChain ? base.bundle : { ...base.bundle, perWallet: CHAINS[chain].quick[0] },
    vampOf: o.id,
  }
}

function VampPicker({ tokens, now, onVamp }: { tokens: Token[]; now: number; onVamp: (t: Token, style: VampStyle) => void }) {
  const [q, setQ] = useState('')
  const [style, setStyle] = useState<VampStyle>(() => load<VampStyle>('vampStyle') ?? 'exact')
  const pickStyle = (s: VampStyle) => {
    setStyle(s)
    save('vampStyle', s)
  }
  const needle = q.trim().toLowerCase().replace('$', '')
  const vamps = new Map<string, number>()
  for (const t of tokens) if (t.vampOf) vamps.set(t.vampOf.id, (vamps.get(t.vampOf.id) ?? 0) + 1)
  // Hottest first: what people vamp is whatever is running right now.
  const list = tokens
    .filter((t) => (t.status === 'bonding' || t.status === 'graduated') && t.creator !== 'you' && (!needle || t.ticker.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle)))
    .sort((a, b) => b.hype + b.momentumScore + Math.max(-50, Math.min(200, (b.change['1h'] ?? 0) * 100)) - (a.hype + a.momentumScore + Math.max(-50, Math.min(200, (a.change['1h'] ?? 0) * 100))))
    .slice(0, 40)
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <div>
          <div className="text-[14px] font-bold">🧛 Vamp a coin</div>
          <div className="text-[11px] text-dim">Launch a copycat of something that's running and ride its hype. Hot coins give your launch a head start; cold ones don't.</div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Segmented value={style} onChange={pickStyle} options={VAMP_STYLES.map((s) => ({ value: s.id, label: s.label }))} />
          <div className="relative w-44">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coin" aria-label="Search coins to vamp" className="h-7 w-full rounded-md border border-line2 bg-bg pl-6 pr-2 text-[12px] outline-none placeholder:text-dim focus:border-accent/60" />
          </div>
        </div>
      </div>
      {list.length === 0 ? <EmptyState icon="🧛" title="Nothing to vamp" hint="No live coins match" /> : (
        <div className="divide-y divide-line/50">
          {list.map((t) => {
            const lift = vampBoost(t)
            const n = vamps.get(t.id) ?? 0
            const next = vampName(t, style)
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-panel2">
                <TokenIcon token={t} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-bold">
                    <span className="truncate">{t.ticker}</span>
                    <ChainBadge chain={t.chain} />
                    <span className="truncate text-[11px] font-normal text-dim">{t.name}</span>
                    {n > 0 && <span className="rounded bg-raise px-1 text-[9px] font-semibold text-muted" title="Copycats already out there">{n} vamp{n > 1 ? 's' : ''}</span>}
                  </div>
                  <div className="num text-[11px] text-muted">
                    {fmtCompact(t.mcap)} MC · 1h <span className={toneClass(t.change['1h'] ?? 0)}>{fmtPct(t.change['1h'] ?? 0)}</span> · {fmtAge(now - t.createdAt)} · {t.status === 'bonding' ? `curve ${t.bondingProgress.toFixed(0)}%` : 'migrated'}
                  </div>
                </div>
                <span className={clsx('num w-20 text-right text-[11px] font-semibold', lift >= 0.1 ? 'text-up' : lift > 0.03 ? 'text-warn' : 'text-dim')} title="How much hype your launch borrows">
                  {lift >= 0.1 ? '🔥 ' : ''}+{Math.round(Math.max(0, lift) * 100)} vibe
                </span>
                <button onClick={() => onVamp(t, style)} className="flex items-center gap-1 rounded-md bg-accent/15 px-2.5 py-1 text-[12px] font-bold text-accent hover:bg-accent/25" title={`Fill the launch form as ${next.name} ($${next.ticker})`}>
                  Vamp → ${next.ticker}
                </button>
              </div>
            )
          })}
        </div>
      )}
      <p className="px-3 py-2 text-[10px] text-dim">Vamping copies the name, ticker (or a spin-off), picture, story, socials and launchpad. You still set the dev buy, marketing and style, and can tweak anything before cooking.</p>
    </div>
  )
}

function MyLaunches({ onCreate }: { onCreate: () => void }) {
  const launches = useGame((s) => s.launches)
  const tokens = useGame((s) => s.market.tokens)
  const positions = useGame((s) => s.portfolio.positions)
  const trades = useGame((s) => s.portfolio.trades)
  const now = useGame((s) => s.market.time)
  const select = useGame((s) => s.select)
  const sell = useGame((s) => s.sell)
  const claim = useGame((s) => s.claimCreatorFees)
  const native = useGame((s) => s.market.native)
  const [openBot, setOpenBot] = useState<string | null>(null)
  const map = new Map(tokens.map((t) => [t.id, t]))
  const th = 'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-dim whitespace-nowrap'
  const td = 'px-3 py-2 whitespace-nowrap border-b border-line/50'
  const unclaimedUsd = launches.reduce((a, r) => a + (r.unclaimed ?? 0) * (native?.[r.chain ?? 'sol']?.price ?? CHAINS[r.chain ?? 'sol'].basePrice), 0)
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="text-[12px] font-bold">Your launches</div>
        <div className="text-[10px] text-dim">Net = creator earnings + bag + sells − fees, marketing, buys and bot costs</div>
        <button disabled={!(unclaimedUsd > 0.001)} onClick={() => claim()} title="Creator fees wait in the vault until you claim them (anything left is paid out when the round ends)" className="ml-auto flex items-center gap-1 rounded-md bg-up px-2.5 py-1 text-[11px] font-extrabold text-black hover:brightness-110 disabled:opacity-40">
          💰 Claim all creator fees · {fmtUsd(unclaimedUsd, unclaimedUsd < 10 ? 2 : 0)}
        </button>
      </div>
      {launches.length === 0 ? (
        <EmptyState icon="🍳" title="Nothing cooked yet this round" hint={<button onClick={onCreate} className="text-accent underline">Create your first coin</button>} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead>
              <tr>
                <th className={clsx(th, 'text-left')}>Token</th>
                <th className={clsx(th, 'text-right')}>Age</th>
                <th className={clsx(th, 'text-right')}>MC</th>
                <th className={clsx(th, 'text-right')}>Peak</th>
                <th className={clsx(th, 'text-left')}>Status</th>
                <th className={clsx(th, 'text-right')}>Your bag</th>
                <th className={clsx(th, 'text-left')}>Bundle / Bot</th>
                <th className={clsx(th, 'text-right')}>Creator earnings</th>
                <th className={clsx(th, 'text-right')}>Net</th>
                <th className={clsx(th, 'text-right')}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {launches.map((r) => {
                const t = map.get(r.tokenId)
                const pos = positions[r.tokenId]
                const bag = t && pos ? pos.qty * t.price : 0
                let bought = 0
                let sold = 0
                for (const tr of trades) {
                  if (tr.tokenId !== r.tokenId) continue
                  if (tr.side === 'buy') bought += tr.value
                  else sold += tr.value - tr.fee
                }
                const net = r.fees + bag + sold - bought - r.spent - (r.bot?.spent ?? 0)
                const status = t?.status ?? r.status
                const bundlePct = t?.bundlePct ?? 0
                const expanded = openBot === r.tokenId
                return (
                  <tr key={r.tokenId} className={clsx('hover:bg-panel2', expanded && 'bg-info/[0.04]')}>
                    <td className={td}>
                      <button onClick={() => t && select(t.id)} className="flex items-center gap-2 disabled:cursor-default" disabled={!t}>
                        <TokenIcon token={{ emoji: r.emoji, hue: r.hue, image: r.image, status: status === 'rugged' || status === 'dead' ? status : 'graduated' }} size={24} />
                        <span className="font-bold">{r.ticker}</span>
                        <span className="text-[11px] text-dim">{r.name}</span>
                      </button>
                    </td>
                    <td className={clsx(td, 'num text-right text-muted')}>{fmtAge(now - r.launchedTime)}</td>
                    <td className={clsx(td, 'num text-right font-semibold')}>{fmtCompact(t?.mcap ?? r.lastMcap)}</td>
                    <td className={clsx(td, 'num text-right text-warn')}>{fmtCompact(r.peakMcap)}</td>
                    <td className={td}>
                      {status === 'bonding' && t ? (
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-line2"><div className="h-full bg-warn" style={{ width: `${t.bondingProgress}%` }} /></div>
                          <span className="num text-[10px] text-warn">{t.bondingProgress.toFixed(0)}%</span>
                        </div>
                      ) : status === 'graduated' ? (
                        <span className="rounded bg-up/10 px-1.5 text-[10px] font-bold text-up">🎓 GRADUATED</span>
                      ) : (
                        <span className="rounded bg-line2 px-1.5 text-[10px] font-bold text-muted">DEAD</span>
                      )}
                    </td>
                    <td className={clsx(td, 'num text-right')}>{bag ? <>{fmtUsd(bag)} <span className="text-[10px] text-dim">({(((pos?.qty ?? 0) / SUPPLY) * 100).toFixed(1)}%)</span></> : <span className="text-dim">—</span>}</td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                        {(r.bundleQty ?? 0) > 0 && bundlePct > 0.05 ? (
                          t?.bundleFlagged
                            ? <span className="rounded bg-down/15 px-1.5 py-px text-down" title="Sleuths linked your bundle wallets">📦 {bundlePct.toFixed(1)}% FLAGGED</span>
                            : <span className="rounded bg-info/15 px-1.5 py-px text-info" title={`Hidden across ${r.bundleWallets} wallets`}>📦 {bundlePct.toFixed(1)}% hidden</span>
                        ) : r.bundleWallets ? <span className="text-dim">📦 sold</span> : null}
                        {r.bot?.on && <span className="flex items-center gap-1 rounded bg-info/15 px-1.5 py-px text-info"><span className="size-1.5 animate-pulse rounded-full bg-info" />BOT</span>}
                        {t?.washFlagged && <span className="rounded bg-down/15 px-1.5 py-px text-down">🤖 WASH</span>}
                        {!(r.bundleQty ?? 0) && !r.bundleWallets && !r.bot?.on && !t?.washFlagged && <span className="font-normal text-dim">—</span>}
                      </div>
                    </td>
                    <td className={clsx(td, 'num text-right')}>
                      <div className="text-up">{fmtUsd(r.fees)}</div>
                      <div className="flex items-center justify-end gap-1 text-[10px] text-dim">
                        {fmtNative(r.unclaimed ?? 0, r.chain ?? 'sol')} unclaimed
                        <button disabled={!((r.unclaimed ?? 0) > 1e-9)} onClick={() => claim(r.tokenId)} className="rounded bg-up/15 px-1 font-bold text-up hover:bg-up/25 disabled:opacity-30">Claim</button>
                      </div>
                    </td>
                    <td className={clsx(td, 'num text-right font-bold', toneClass(net))}>{net >= 0 ? '+' : ''}{fmtUsd(net)}</td>
                    <td className={clsx(td, 'text-right')}>
                      <div className="flex justify-end gap-1">
                        <button disabled={!t} onClick={() => t && select(t.id)} className="rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-ink disabled:opacity-30">Chart</button>
                        <button onClick={() => setOpenBot(expanded ? null : r.tokenId)} className={clsx('flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold', expanded || r.bot?.on ? 'border-info/50 bg-info/10 text-info' : 'border-line2 text-muted hover:text-ink')} aria-expanded={expanded}>
                          <Bot size={11} /> Bot · Airdrop
                        </button>
                        <button disabled={!pos} onClick={() => pos && sell(pos.qty / 2, r.tokenId, undefined, 'all')} className="rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:border-down/50 hover:text-down disabled:opacity-30" title="Sell half your dev bag (the market will notice)">Sell 50%</button>
                        <button disabled={!pos} onClick={() => pos && sell(pos.qty, r.tokenId, undefined, 'all')} className="rounded border border-down/40 bg-down/10 px-1.5 py-0.5 text-[10px] font-bold text-down hover:bg-down hover:text-white disabled:opacity-30" title="Dump your whole dev bag (the market will notice)">Dump bag</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {(() => {
        const r = launches.find((x) => x.tokenId === openBot)
        if (!r) return null
        return (
          <div className="border-t border-info/30 bg-info/[0.03]">
            <div className="flex items-center justify-between px-3 pt-2 text-[11px]">
              <span className="font-bold">${r.ticker} · dev tools</span>
              <button onClick={() => setOpenBot(null)} className="text-dim hover:text-ink">Close ✕</button>
            </div>
            <VolumeBotPanel key={r.tokenId} rec={r} t={map.get(r.tokenId)} />
            <AirdropPanel key={`drop-${r.tokenId}`} rec={r} t={map.get(r.tokenId)} />
          </div>
        )
      })()}
    </div>
  )
}

function RecentlyCooked({ tokens, now, onOpen }: { tokens: Token[]; now: number; onOpen: (id: string) => void }) {
  const recent = tokens.filter((t) => now - t.createdAt < 3600).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  return (
    <div className="rounded-md border border-line bg-panel">
      <div className="border-b border-line px-3 py-2 text-[12px] font-bold">Recently cooked on every chain</div>
      {recent.length === 0 ? (
        <EmptyState icon="🕳️" title="No launches in the last hour" />
      ) : (
        <div className="grid gap-px bg-line/50 sm:grid-cols-2 lg:grid-cols-5">
          {recent.map((t) => (
            <button key={t.id} onClick={() => onOpen(t.id)} className="flex items-center gap-2 bg-panel px-3 py-2 text-left hover:bg-panel2">
              <TokenIcon token={t} size={28} />
              <div className="min-w-0">
                <div className="flex items-center gap-1 text-[12px] font-bold">{t.ticker}{t.creator === 'you' && <span className="text-[9px] text-warn">🍳</span>}</div>
                <div className="num text-[10px] text-muted">{fmtCompact(t.mcap)} · {fmtAge(now - t.createdAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
