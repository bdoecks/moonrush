// The game's tutorials: trading, and deving (launching your own coin). A tutorial is a list of steps shown one at a
// time in a small card (components/Tutorial.tsx). A step either just explains (Next), or asks the player to DO
// something in the real game and moves on by itself when they have (`done`). Nothing here trades for the player.
// Pure data and small pure checks: no React, no store.
import type { LaunchRecord, Trade } from '../types'

export type TutorialId = 'trading' | 'deving'

/** What a step may look at to tell whether the player has done it. */
export interface TutorialView {
  view: string
  selectedId: string | null
  selectedIsMine: boolean // the open coin is one the player launched
  trades: Pick<Trade, 'side'>[] // newest first
  launches: Pick<LaunchRecord, 'tokenId'>[]
}
/** The same things as they stood when the step began: "a new buy" means one more than then. */
export interface TutorialBase {
  trades: number
  launches: number
}

export interface TutorialStep {
  title: string
  body: string[] // short paragraphs
  /** Parts of the screen to point at: the first one that is on screen gets the ring. */
  target?: string[]
  /** The player has done what the step asks (the step then moves on by itself). No `done`: a Next button. */
  done?: (v: TutorialView, base: TutorialBase) => boolean
  /** What to do, said on the card while it waits. */
  todo?: string
}

export interface TutorialDef {
  id: TutorialId
  name: string
  icon: string
  blurb: string
  minutes: number
  steps: TutorialStep[]
}

const fresh = (v: TutorialView, base: TutorialBase, side: 'buy' | 'sell') => v.trades.slice(0, Math.max(0, v.trades.length - base.trades)).some((t) => t.side === side)

export const TUTORIALS: Record<TutorialId, TutorialDef> = {
  trading: {
    id: 'trading', name: 'Trading', icon: '📈', minutes: 3,
    blurb: 'Pick a coin, read it, buy a little, sell it, and see what it really cost.',
    steps: [
      { title: 'This is a simulator', body: ['Every coin, price, wallet and trader here is made up. The money is play money: nothing you do costs or earns anything real.', 'This tutorial walks you through one whole trade. You do the clicking; it waits for you.'] },
      { title: 'Pick a coin', todo: 'Open Trenches or Discover and click any coin.', target: ['[data-tut="nav-trenches"]', '[data-tut="nav-discover"]'], body: ['Trenches shows coins by how far along they are: New Pairs (just launched), Final Stretch (close to bonding) and Graduated (bonded, now trading in a pool). Discover is the same market as a table.'], done: (v) => v.view === 'token' && !!v.selectedId },
      { title: 'Read it before you buy', target: ['[data-tut="coin-header"]'], body: ['The top of the page is the coin at a glance: market cap (what the whole coin is worth), liquidity (how much money is there to trade against), holders, and its risk tag.', 'Thin liquidity means your own buy moves the price. A HIGH or EXTREME risk tag means a big dev bag, a few wallets holding most of it, or both.'] },
      { title: 'The chart', target: ['[data-tut="chart"]'], body: ['Each candle is what the price did in that slice of time. The little faces and dots on it are trades: yours, the dev\'s, and wallets worth watching.', 'A coin that is already straight up is not a safer buy: holders who are up can sell into the crowd at any second.'] },
      { title: 'Buy a little', todo: 'Use the buy buttons to put a small amount into this coin.', target: ['[data-tut="trade"]'], body: ['Amounts are in the chain\'s coin (SOL on Solana). Start small: you can always buy more.'], done: (v, b) => fresh(v, b, 'buy') },
      { title: 'You hold a bag', target: ['[data-tut="trade"]', '[data-tut="chart"]'], body: ['Your buy is on the chart, and the position shows what you paid on average and what it is worth right now.', 'It is probably a little red already. That is not the coin falling: it is the fee and the price your own buy pushed up, which you would get back down on the way out.'] },
      { title: 'Sell it', todo: 'Switch to Sell and sell your bag (100%).', target: ['[data-tut="trade"]'], body: ['Selling works the same way in reverse: pick how much of the bag to sell.'], done: (v, b) => fresh(v, b, 'sell') },
      { title: 'What that trade cost', body: ['Every trade pays three things: the launchpad\'s fee (about 1% each way), a small network fee, and slippage (the price moves against you as your own order fills).', 'So a coin has to go UP by a few percent before a round trip breaks even. Buying whatever is running does not pay here: this market is built so that no simple rule makes money on average.'] },
      { title: 'What takes your money', body: ['Read these before every buy: the dev\'s share (a dev can dump their whole bag on you), the top 10 holders, snipers and bundles (wallets that got in first, cheap), and the crown tag (how many of this dev\'s past coins made it).', 'Most new coins die in minutes. The skill is in what you skip.'] },
      { title: 'You are set', body: ['That was a whole trade. From here: Trenches to hunt new coins, Track to follow wallets and callers, Portfolio for everything you hold, and Missions for goals that pay XP.', 'You can run this tutorial again any time from Help.'] },
    ],
  },
  deving: {
    id: 'deving', name: 'Deving', icon: '🍳', minutes: 4,
    blurb: 'Launch your own coin from a dev wallet, and run it: dev buys, dev sells, creator fees.',
    steps: [
      { title: 'What a dev does', body: ['A dev launches a coin and earns a small creator fee every time anybody trades it, plus a bonus if it bonds (fills its launch curve and moves to a pool).', 'Most launches die, and each one costs a launch fee. Deving is a bet on landing a winner, not a wage.'] },
      { title: 'Open the kitchen', todo: 'Open the Cooking tab.', target: ['[data-tut="nav-cooking"]'], body: ['Cooking is where a coin is made.'], done: (v) => v.view === 'cooking' },
      { title: 'Your dev wallet', target: ['[data-tut="cook-deploy"]'], body: ['A coin is launched from a dev wallet, never from your trading wallets. The game made one for you.', 'Its address is public on the coin\'s page: anybody can watch what the dev does. Only this wallet\'s buys and sells count as "the dev".'] },
      { title: 'Make it look alive', target: ['[data-tut="cook-vibe"]'], body: ['The Vibe check is how the launch looks to the market. A coin on the theme everybody wants right now (the meta), with socials and a description, pulls a crowd. A lazy one is dead in a minute.', 'It only shifts the odds. Luck does the rest.'] },
      { title: 'The dev buy', target: ['[data-tut="cook-vibe"]'], body: ['You can buy some of your own coin in the launch itself. Keep it small.', 'A dev sitting on a big share scares buyers off, and the launch snipers skip the coin, because a big dev bag is exactly what gets dumped on them.'] },
      { title: 'Cook it', todo: 'Fill in a name and ticker, then press the Cook button.', target: ['[data-tut="cook-button"]'], body: ['The launch fee is taken from your USD. The coin appears on the market at once.'], done: (v, b) => v.launches.length > b.launches },
      { title: 'Go to your coin', todo: 'Open your coin\'s page (it is tagged YOURS in Trenches, and listed under Portfolio).', target: ['[data-tut="nav-trenches"]'], body: ['Your coin trades like any other now. Other players and the simulated crowd can buy and sell it.'], done: (v) => v.view === 'token' && v.selectedIsMine },
      { title: 'The Dev panel', target: ['[aria-label="Dev panel"]', '[data-tut="dev-panel-open"]'], body: ['On your own coin you get the Dev panel: buy amounts and sell percentages that trade from the coin\'s dev wallet, whatever wallet you have selected for normal trading.', 'A dev buy shows as the dev buying. A dev sell shows as the dev selling, and costs the coin some of its crowd.'] },
      { title: 'Fees and bonding', target: ['[data-tut="coin-header"]'], body: ['"Creator rewards" on the coin\'s page is what your coin has earned you so far: press Claim to move it into the dev wallet.', 'If the coin bonds you get a bonus on top, and it keeps earning fees from the pool for as long as people trade it.'] },
      { title: 'That is deving', body: ['A good dev launches on the meta, keeps the dev bag small, and does not dump on the people who bought.', 'Your trading wallets can buy your coin too: those trades are not the dev\'s. You can run this tutorial again from Help.'] },
    ],
  },
}

/** A fresh base for the step that starts now. */
export const baseOf = (v: TutorialView): TutorialBase => ({ trades: v.trades.length, launches: v.launches.length })
