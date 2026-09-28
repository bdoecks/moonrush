// The Supabase project behind MOONRUSH accounts. Both values are public by design (they ship in the web page);
// row-level security in the database decides what each player may read or write.
export const SUPABASE_URL = 'https://runsqcwjewhqejctpdkp.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_KZHkGozirmCppuIWWtC3tQ_Wa21wR0k'

/** Usernames: 3-16 letters, numbers or underscores (same rule as the database). */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/
