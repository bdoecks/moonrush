import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { OpenAfterToggle } from '../components/chain'
import { HiddenToggle } from '../components/HideButton'
import { Trenches } from '../components/discover/Trenches'
import { TrenchDisplayButton } from '../components/discover/trenchDisplay'
import { useGame } from '../game/store'

/** GMGN-style Trenches: New Pairs · Final Stretch · Migrated columns, as its own page. */
export function TrenchesView() {
  const allTokens = useGame((s) => s.market.tokens)
  const chainFilter = useGame((s) => s.chainFilter)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase().replace(/^\$/, '')
  const tokens = useMemo(() => {
    const byChain = chainFilter === 'all' ? allTokens : allTokens.filter((t) => t.chain === chainFilter)
    return q ? byChain.filter((t) => t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) : byChain
  }, [allTokens, chainFilter, q])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1.5">
        <span className="px-1 text-[13px] font-bold">Trenches</span>
        <div className="relative min-w-[160px] max-w-[280px] flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter coins"
            className="h-7 w-full rounded-md border border-line2 bg-bg pl-7 pr-7 text-[12px] outline-none placeholder:text-dim focus:border-accent/60"
            aria-label="Filter trenches"
          />
          {query && <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-ink" aria-label="Clear filter"><X size={12} /></button>}
        </div>
        <div className="ml-auto flex items-center gap-1.5"><TrenchDisplayButton /><HiddenToggle /><OpenAfterToggle /></div>
      </div>
      <div className="min-h-0 flex-1">
        <Trenches tokens={tokens} />
      </div>
    </div>
  )
}
