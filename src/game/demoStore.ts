// The demo on a tech coin's site (story market, stage 3): what was typed last and what came back. In the World and
// in rooms the server answers; in solo play the game works it out itself.
import { create } from 'zustand'

export interface DemoResult { tokenId: string; input: string; status: 'ok' | 'soon' | 'dead' | 'wait'; out?: string }
export const useDemo = create<{ last: DemoResult | null }>(() => ({ last: null }))
export const demoAsked = (tokenId: string, input: string) => useDemo.setState({ last: { tokenId, input, status: 'wait' } })
export const demoArrived = (r: { tokenId: string; input: string; status: 'ok' | 'soon' | 'dead'; out?: string }) => {
  const cur = useDemo.getState().last
  if (cur && cur.tokenId === r.tokenId && cur.input === r.input) useDemo.setState({ last: { tokenId: r.tokenId, input: r.input, status: r.status, out: r.out } })
}
