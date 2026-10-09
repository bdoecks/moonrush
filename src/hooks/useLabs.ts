// CopyTrade, Sniper and Monitor are behind the `labs` switch (Admin > Switches): off, only admins see them.
import { useFlags } from '../game/flags'
import { useAccount } from '../net/account'

export function useLabs() {
  const on = useFlags((s) => s.labs || (import.meta.env.DEV && !!s.labsDev))
  const admin = useAccount((s) => s.admin)
  return on || admin
}

/** The Cooking page is behind its own switch (`cooking`): off, only admins see it and nobody can launch a coin. */
export function useCooking() {
  const on = useFlags((s) => s.cooking || (import.meta.env.DEV && !!s.labsDev))
  const admin = useAccount((s) => s.admin)
  return on || admin
}

/** The story market (posts that coins get launched on) is behind the `sparks` switch: off, only an admin's own solo game runs it. */
export function useSparks() {
  const on = useFlags((s) => s.sparks || (import.meta.env.DEV && !!s.sparksDev))
  const admin = useAccount((s) => s.admin)
  return on || admin
}

/** Real or larp (stage 2 of the story market) is behind the `larps` switch, the same way. */
export function useLarps() {
  const on = useFlags((s) => s.larps || (import.meta.env.DEV && !!s.sparksDev))
  const admin = useAccount((s) => s.admin)
  return on || admin
}
