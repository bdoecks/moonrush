// Currency added to a player's round by an admin (their own, a room player's, or a gift waiting in the database).
import { CHAINS, fmtNative } from '../data/chains'
import type { Chain } from '../types'
import { fmtUsd } from '../utils/format'
import { aggregate } from './accounts'
import { useGame } from './store'

export type GiftAsset = 'usd' | Chain
export const GIFT_ASSETS: GiftAsset[] = ['usd', 'sol', 'bsc', 'hood']
export const giftLabel = (a: GiftAsset) => (a === 'usd' ? 'USD' : CHAINS[a].native)
export const fmtGift = (a: GiftAsset, n: number) => (a === 'usd' ? fmtUsd(n) : fmtNative(n, a))

/** Add currency to your current round: USD to the bank, chain coins to your main wallet. False if no round is running. */
export function giveLocal(asset: GiftAsset, amount: number, toast = true): boolean {
  const s = useGame.getState()
  if (s.runStatus !== 'running' || !(amount > 0) || !Number.isFinite(amount)) return false
  let p = s.portfolio
  if (asset === 'usd') p = { ...p, cash: p.cash + amount }
  else {
    const main = p.accounts?.[0]?.id
    p = aggregate({ ...p, accounts: (p.accounts ?? []).map((a) => (a.id === main ? { ...a, balances: { ...a.balances, [asset]: a.balances[asset] + amount } } : a)) })
  }
  s.patchState({ portfolio: p })
  if (toast) s.notify({ title: '🎁 RECEIVED', body: `${fmtGift(asset, amount)} added to ${asset === 'usd' ? 'your USD bank' : 'your main wallet'}`, tone: 'up', icon: '🎁' }, 'profit')
  return true
}
