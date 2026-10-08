// Bug reports and ideas: what a player may send, and what the game adds by itself. Pure (tested in
// scripts/bugs-test.ts). The database refuses anything outside the same limits (supabase/009_bug_reports.sql); an
// idea is a row of the same table with `kind: 'idea'` (supabase/010_ideas.sql).
import { tidyText } from './textRules'

export const BUG_MIN = 10
export const BUG_MAX = 2000
export const BUG_DOING_MAX = 1000
export const BUG_COOLDOWN_MS = 60_000 // one report a minute from one browser

export type BugStatus = 'open' | 'fixed' | 'wontfix'
export type ReportKind = 'bug' | 'idea'
/** What an idea asks for. */
export type IdeaWant = 'add' | 'change' | 'remove'
export const IDEA_WANTS: { id: IdeaWant; label: string; emoji: string }[] = [
  { id: 'add', label: 'Something to add', emoji: '➕' },
  { id: 'change', label: 'Something to change', emoji: '🔧' },
  { id: 'remove', label: 'Something to get rid of', emoji: '🗑️' },
]

export interface BugReport {
  id: number
  created_at: string
  user_id: string | null
  username: string | null
  what: string
  doing: string | null
  context: BugContext
  status: BugStatus
  note: string | null
  kind?: ReportKind // (not there on rows read before supabase/010_ideas.sql was run: a bug)
}

/** What the game knows about where the player was. Nothing private: no wallet, no balances, no email. */
export interface BugContext {
  page?: string // the tab they were on
  mode?: string // solo practice, a friends room, the World…
  engine?: string
  coin?: string // the ticker of the coin they had open
  version?: string
  screen?: string // "1920x1080"
  browser?: string
  errors?: string[] // the last few errors the game itself caught
  want?: IdeaWant // ideas: add, change or get rid of
}

/** Text as it will be stored: no control characters or half emoji, trimmed, cut to size. */
export const cleanBugText = (raw: string, max: number) => tidyText(String(raw ?? '')).slice(0, max).trim()

/** Why this report cannot be sent, or null when it can. */
export function bugProblem(what: string, lastSentAt: number, now: number): string | null {
  const text = cleanBugText(what, BUG_MAX)
  if (text.length < BUG_MIN) return `Tell us a bit more: at least ${BUG_MIN} characters.`
  if (now - lastSentAt < BUG_COOLDOWN_MS) return `Thanks for the last one. You can send another in ${Math.ceil((BUG_COOLDOWN_MS - (now - lastSentAt)) / 1000)} seconds.`
  return null
}

/** The row to insert. `context` is whatever the game gathered; every text in it is cut short. */
export function buildBugRow(o: { what: string; doing: string; userId: string | null; username: string; context: BugContext; idea?: { want: IdeaWant } }) {
  const short = (v: unknown, n: number) => (typeof v === 'string' && v ? cleanBugText(v, n) : undefined)
  const c = o.context
  const context: BugContext = {
    page: short(c.page, 30), mode: short(c.mode, 40), engine: short(c.engine, 20), coin: short(c.coin, 20), version: short(c.version, 40),
    screen: short(c.screen, 20), browser: short(c.browser, 160),
    errors: (c.errors ?? []).slice(0, 5).map((e) => cleanBugText(e, 300)).filter(Boolean),
  }
  // An idea says what it asks for, and carries no error list (errors belong to bug reports).
  if (o.idea) {
    context.want = IDEA_WANTS.some((w) => w.id === o.idea!.want) ? o.idea.want : 'add'
    delete context.errors
  }
  if (!context.errors?.length) delete context.errors
  return {
    // (A bug report names no kind: the column's default is 'bug', so reports go through before 010_ideas.sql is run.)
    ...(o.idea ? { kind: 'idea' as const } : {}),
    user_id: o.userId,
    username: cleanBugText(o.username, 40) || null,
    what: cleanBugText(o.what, BUG_MAX),
    doing: cleanBugText(o.doing, BUG_DOING_MAX) || null,
    context: JSON.parse(JSON.stringify(context)) as BugContext, // (drops the undefined ones)
  }
}
