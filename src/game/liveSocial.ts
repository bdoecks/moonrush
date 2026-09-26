// Live social feed hub — the plug for a real X / Twitter tracker.
//
// The game's own X/TG posts are simulated (socialEngine). Real posts will come from outside the game: X's API needs a
// secret bearer token, so it has to be called from a small server (or a paid feed provider), never from this page.
// That server forwards tweets to the browser (WebSocket / Server-Sent Events) and the client calls `pushLivePosts`;
// everything in the tracker dock's "Live X" tab then updates on its own. `connectLiveFeed` below is that client side.
import { useSyncExternalStore } from 'react'

export interface LivePost {
  id: string // the tweet id (used to de-duplicate)
  author: { name: string; handle: string; avatarUrl?: string; followers?: number; verified?: boolean }
  text: string
  createdAt: number // ms timestamp
  url?: string // link to the post
  media?: string[] // image urls
  tickers?: string[] // $CASHTAGS found in the text
  contracts?: string[] // contract addresses found in the text
}

export type LiveStatus = 'off' | 'connecting' | 'live' | 'error'

const MAX = 200
let state: { posts: LivePost[]; status: LiveStatus; error?: string } = { posts: [], status: 'off' }
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Add posts (newest first, de-duplicated by id). */
export function pushLivePosts(posts: LivePost[]) {
  if (!posts.length) return
  const seen = new Set(state.posts.map((p) => p.id))
  const fresh = posts.filter((p) => !seen.has(p.id))
  if (!fresh.length) return
  state = { ...state, posts: [...fresh, ...state.posts].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX) }
  emit()
}

export function setLiveStatus(status: LiveStatus, error?: string) {
  state = { ...state, status, error }
  emit()
}

export function useLiveFeed() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** $CASHTAGS and Solana / EVM contract addresses in a post's text. */
export function extractRefs(text: string) {
  return {
    tickers: [...new Set((text.match(/\$[A-Za-z][A-Za-z0-9]{1,11}/g) ?? []).map((t) => t.toUpperCase()))],
    contracts: [...new Set(text.match(/\b(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g) ?? [])],
  }
}

/**
 * Connect to your own feed server. It should send Server-Sent Events whose data is a LivePost (or an array of them).
 * Returns a function that disconnects.
 */
export function connectLiveFeed(url: string): () => void {
  setLiveStatus('connecting')
  let es: EventSource
  try {
    es = new EventSource(url)
  } catch (e) {
    setLiveStatus('error', String(e))
    return () => {}
  }
  es.onopen = () => setLiveStatus('live')
  es.onerror = () => setLiveStatus('error', 'Connection lost — retrying')
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as LivePost | LivePost[]
      const list = (Array.isArray(data) ? data : [data]).map((p) => ({ ...extractRefs(p.text), ...p }))
      pushLivePosts(list)
    } catch {
      /* ignore malformed messages */
    }
  }
  return () => {
    es.close()
    setLiveStatus('off')
  }
}
