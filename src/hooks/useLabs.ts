// CopyTrade, Sniper and Monitor are behind the `labs` switch (Admin > Switches): off, only admins see them.
import { useFlags } from '../game/flags'
import { useAccount } from '../net/account'

export function useLabs() {
  const on = useFlags((s) => s.labs || (import.meta.env.DEV && !!s.labsDev))
  const admin = useAccount((s) => s.admin)
  return on || admin
}
