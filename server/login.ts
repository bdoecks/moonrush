// Sign in with a username (or an email) and a password. Supabase signs people in by email only, and emails must stay
// private, so the username is turned into its email HERE, with the server's secret key, and the password check goes
// to Supabase exactly as the game would send it. The game gets back the same session it would have got itself.
// Every failure gives the same answer, so nobody can use this to find out which usernames exist, and each address
// gets a handful of tries a minute.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SUPABASE_KEY, SUPABASE_URL } from '../src/net/supabaseConfig'

const SECRET = process.env.SUPABASE_SECRET_KEY?.trim() ?? ''
const TRIES_PER_MIN = 8
const tries = new Map<string, number[]>() // address → times of recent tries
const WRONG = 'Wrong username or password'

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, max = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', (c) => {
      s += c
      if (s.length > max) reject(new Error('too big'))
    })
    req.on('end', () => resolve(s))
    req.on('error', reject)
  })
}

/** The email behind a username (server-only: needs the secret key). */
async function emailOf(username: string): Promise<string | null> {
  if (SECRET.length < 20 || !/^[A-Za-z0-9_]{3,16}$/.test(username)) return null
  const h = { apikey: SECRET, Authorization: `Bearer ${SECRET}` }
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/profiles?username=ilike.${encodeURIComponent(username.replace(/_/g, '\\_'))}&select=id&limit=1`, { headers: h, signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ id: string }[]>) : []))
    .catch(() => [] as { id: string }[])
  if (!rows[0]?.id) return null
  const user = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${rows[0].id}`, { headers: h, signal: AbortSignal.timeout(5000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ email?: string }>) : null))
    .catch(() => null)
  return user?.email ?? null
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' })
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '?').split(',')[0].trim()
  const now = Date.now()
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < 60_000)
  if (recent.length >= TRIES_PER_MIN) return json(res, 429, { error: 'Too many tries. Wait a minute and try again.' })
  tries.set(ip, [...recent, now])
  if (tries.size > 5000) tries.clear()

  let body: { login?: unknown; password?: unknown }
  try {
    body = JSON.parse(await readBody(req))
  } catch {
    return json(res, 400, { error: 'Bad request' })
  }
  const login = String(body.login ?? '').trim()
  const password = String(body.password ?? '')
  if (!login || !password || password.length > 200) return json(res, 400, { error: WRONG })
  const email = login.includes('@') ? login : await emailOf(login)
  if (!email) return json(res, 401, { error: SECRET.length < 20 ? 'Sign in with your email here' : WRONG })
  // The same password check the game would make, from here.
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null)
  if (!r) return json(res, 502, { error: 'Could not reach the sign-in service. Try again.' })
  const data = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error_description?: string; msg?: string }
  if (!r.ok || !data.access_token || !data.refresh_token) {
    const why = String(data.error_description ?? data.msg ?? '')
    return json(res, 401, { error: /confirm/i.test(why) ? 'Confirm your email first (check your inbox)' : WRONG })
  }
  return json(res, 200, { access_token: data.access_token, refresh_token: data.refresh_token })
}
