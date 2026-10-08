// Bug reports: what the game sends is clean, small and carries nothing private. (The database's own rules are in
// supabase/009_bug_reports.sql: anybody may add a report, only admins can read one.)
//   npx tsx scripts/bugs-test.ts
import { readFileSync } from 'node:fs'
import { BUG_COOLDOWN_MS, BUG_DOING_MAX, BUG_MAX, BUG_MIN, bugProblem, buildBugRow, cleanBugText } from '../src/game/bugReports'

const ok = (cond: boolean, what: string) => console.log(`${cond ? 'PASS' : 'FAIL'} ${what}`)
const now = 1_800_000_000_000

ok(bugProblem('short', 0, now) !== null && bugProblem('          ', 0, now) !== null && bugProblem('The sell button did nothing', 0, now) === null, `a report needs at least ${BUG_MIN} real characters`)
ok(bugProblem('The sell button did nothing', now - 5000, now) !== null && bugProblem('The sell button did nothing', now - BUG_COOLDOWN_MS - 1, now) === null, 'one report a minute from one browser')

const half = String.fromCharCode(0xd83d) // half of an emoji: the database refuses text that carries one
const nul = String.fromCharCode(0)
const row = buildBugRow({
  what: `  The chart froze${nul} ${half} when I sold  ` + 'x'.repeat(5000),
  doing: 'y'.repeat(5000),
  userId: null,
  username: 'A'.repeat(200),
  context: { page: 'token', mode: 'the World', engine: 'realistic', coin: 'HONK', version: 'live abc', screen: '1920x1080', browser: 'B'.repeat(900), errors: Array.from({ length: 30 }, (_, i) => `err ${i} ` + 'e'.repeat(900)) },
})
ok(row.what.length <= BUG_MAX && (row.doing?.length ?? 0) <= BUG_DOING_MAX && (row.username?.length ?? 0) <= 40, 'texts are cut to the sizes the database accepts')
ok(!row.what.includes(nul) && !row.what.includes(half) && row.what.startsWith('The chart froze'), 'no control characters or half emoji get through, and it is trimmed')
ok((row.context.errors?.length ?? 0) <= 5 && (row.context.browser?.length ?? 0) <= 160 && JSON.stringify(row.context).length < 3500, `what the game adds stays small (${JSON.stringify(row.context).length} characters)`)
ok(row.user_id === null && buildBugRow({ what: 'The chart froze when I sold', doing: '', userId: 'abc', username: '', context: {} }).doing === null, 'a guest sends as nobody, and an empty second answer is stored as empty')
const keys = Object.keys(row).sort().join()
ok(keys === 'context,doing,user_id,username,what' && Object.keys(row.context).every((k) => ['page', 'mode', 'engine', 'coin', 'version', 'screen', 'browser', 'errors'].includes(k)), 'a report carries the two answers and where the player was: no wallet, no balances, no email')
ok(cleanBugText('a\nb', 10) === 'a\nb' || cleanBugText('a\nb', 10) === 'a b', 'line breaks are kept or turned into spaces, never lost words')

// The database's side, read off the SQL the owner runs.
const sql = readFileSync(new URL('../supabase/009_bug_reports.sql', import.meta.url), 'utf8')
ok(/enable row level security/.test(sql) && /for select to authenticated using \(public\.is_admin\(\)\)/.test(sql) && !/for select[^;]*using \(true\)/.test(sql), 'only admins can read reports')
ok(/for insert to anon, authenticated/.test(sql) && /user_id is null or user_id = auth\.uid\(\)/.test(sql) && /status = 'open' and note is null/.test(sql), 'anybody can add one, only as themselves and only as a new open report')
ok(new RegExp(`between ${BUG_MIN} and ${BUG_MAX}`).test(sql) && new RegExp(`char_length\\(doing\\) <= ${BUG_DOING_MAX}`).test(sql), 'the database holds the same size limits as the game')
ok(/bug_report_limit/.test(sql) && /interval '1 day'\) >= 20/.test(sql) && /interval '1 hour'\) >= 60/.test(sql), 'there is a flood stop: 20 a day per account, 60 an hour for all guests together')
process.exit(0)
