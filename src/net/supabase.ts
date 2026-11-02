import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './supabaseConfig'

// Opened from a "reset your password" email? (Our link carries ?reset=1; Supabase's own marks it type=recovery.) Read
// before the client below takes the sign-in out of the address.
export const openedFromReset = typeof location !== 'undefined' && (/[?&]reset=1\b/.test(location.search) || /type=recovery/.test(location.hash + location.search))

// "Remember me": on (the default), you stay signed in as before. Off, you are signed out when the browser closes: a
// cookie with no end date (the browser drops it when it closes) marks that this browser session is still the one you
// signed in on; without it, the saved sign-in is wiped before the client below reads it. All tabs share both.
const REMEMBER_KEY = 'moonrush:rememberMe'
export const rememberMe = () => {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0'
  } catch {
    return true
  }
}
export function setRememberMe(on: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? '1' : '0')
    document.cookie = 'mr_alive=1; path=/; SameSite=Lax' // this browser session counts as signed in
  } catch {
    /* storage blocked */
  }
}
if (typeof document !== 'undefined' && !rememberMe() && !document.cookie.split('; ').includes('mr_alive=1')) {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k)
  } catch {
    /* storage blocked */
  }
}

// The claude.ai share copy (VITE_NO_MP) has no accounts.
const off = import.meta.env.VITE_NO_MP === '1'

export const supabase: SupabaseClient | null = off ? null : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
