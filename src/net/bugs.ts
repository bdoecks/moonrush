// Bug reports, browser side: send one (anybody), read and mark them (admins; the database decides who is one).
import { bugProblem, buildBugRow, type BugContext, type BugReport, type BugStatus } from '../game/bugReports'
import { useGame } from '../game/store'
import { load, save } from '../utils/storage'
import { useAccount } from './account'
import { supabase } from './supabase'

// The last few errors the game itself ran into, for a report to carry (most players cannot describe a crash).
const recent: string[] = []
if (typeof window !== 'undefined') {
  const note = (text: string) => {
    if (!text) return
    recent.unshift(text.slice(0, 300))
    recent.length = Math.min(recent.length, 5)
  }
  window.addEventListener('error', (e) => note(`${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`))
  window.addEventListener('unhandledrejection', (e) => note(`Unhandled: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`))
}

/** Where the player is right now, as far as the game knows. Nothing private. */
export function bugContext(): BugContext {
  const s = useGame.getState()
  const coin = s.view === 'token' ? s.market.tokens.find((t) => t.id === s.selectedId)?.ticker : undefined
  return {
    page: s.view,
    mode: s.online ? (s.online.code === 'WORLD' ? 'the World' : `friends room ${s.online.code}`) : `solo ${s.mode}`,
    engine: s.market.engine ?? 'classic',
    coin,
    version: import.meta.env.MODE === 'production' ? `live ${document.querySelector<HTMLScriptElement>('script[type="module"][src*="index-"]')?.src.match(/index-([\w-]+)\.js/)?.[1] ?? ''}`.trim() : 'test copy',
    screen: `${window.innerWidth}x${window.innerHeight}`,
    browser: navigator.userAgent,
    errors: [...recent],
  }
}

export const lastBugSentAt = () => load<number>('bugSentAt') ?? 0

export async function sendBugReport(what: string, doing: string): Promise<{ ok: boolean; error?: string }> {
  const problem = bugProblem(what, lastBugSentAt(), Date.now())
  if (problem) return { ok: false, error: problem }
  if (!supabase) return { ok: false, error: 'Reports cannot be sent from this copy of the game.' }
  const acc = useAccount.getState()
  const row = buildBugRow({ what, doing, userId: acc.userId, username: acc.profile?.username ?? load<string>('mpName') ?? '', context: bugContext() })
  const { error } = await supabase.from('bug_reports').insert(row)
  if (error) return { ok: false, error: /does not exist|schema cache/i.test(error.message) ? 'Reports are not switched on yet. Please try again later.' : error.message }
  save('bugSentAt', Date.now())
  return { ok: true }
}

// ── Admin ──
export async function loadBugReports(): Promise<{ rows: BugReport[]; error?: string }> {
  if (!supabase) return { rows: [], error: 'No database in this copy' }
  const { data, error } = await supabase.from('bug_reports').select('*').order('created_at', { ascending: false }).limit(300)
  return { rows: (data as BugReport[]) ?? [], error: error?.message }
}

export async function markBugReport(id: number, patch: { status?: BugStatus; note?: string | null }): Promise<string | null> {
  if (!supabase) return 'No database in this copy'
  const { error } = await supabase.from('bug_reports').update(patch).eq('id', id)
  return error?.message ?? null
}

export async function deleteBugReport(id: number): Promise<string | null> {
  if (!supabase) return 'No database in this copy'
  const { error } = await supabase.from('bug_reports').delete().eq('id', id)
  return error?.message ?? null
}

/** How many reports are still open (for the admin's tab label). Null when it cannot be read. */
export async function openBugCount(): Promise<number | null> {
  if (!supabase) return null
  const { count, error } = await supabase.from('bug_reports').select('id', { count: 'exact', head: true }).eq('status', 'open')
  return error ? null : count ?? 0
}
