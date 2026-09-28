import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './supabaseConfig'

// The claude.ai share copy (VITE_NO_MP) has no accounts.
const off = import.meta.env.VITE_NO_MP === '1'

export const supabase: SupabaseClient | null = off ? null : createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
