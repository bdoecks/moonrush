import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './supabaseConfig'

// Opened from a "reset your password" email? (Our link carries ?reset=1; Supabase's own marks it type=recovery.) Read
// before the client below takes the sign-in out of the address.
export const openedFromReset = typeof location !== 'undefined' && (/[?&]reset=1\b/.test(location.search) || /type=recovery/.test(location.hash + location.search))

// The claude.ai share copy (VITE_NO_MP) has no accounts.
const off = import.meta.env.VITE_NO_MP === '1'

export const supabase: SupabaseClient | null = off ? null : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
