// Tiny synthesized UI sounds via WebAudio — no audio files, nothing plays unless sound is enabled.
export type Sfx = 'buy' | 'sell' | 'profit' | 'loss' | 'levelup' | 'achievement' | 'alert' | 'click' | 'rug'

let ctx: AudioContext | null = null

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.06, slideTo?: number) {
  if (!ctx) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, ctx.currentTime + start)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + dur)
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start)
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur)
  o.connect(g).connect(ctx.destination)
  o.start(ctx.currentTime + start)
  o.stop(ctx.currentTime + start + dur + 0.02)
}

export function playSfx(kind: Sfx) {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    return
  }
  switch (kind) {
    case 'buy': tone(520, 0, 0.08, 'square', 0.03); tone(780, 0.06, 0.1, 'square', 0.03); break
    case 'sell': tone(660, 0, 0.08, 'square', 0.03); tone(440, 0.06, 0.1, 'square', 0.03); break
    case 'profit': [523, 659, 784].forEach((f, i) => tone(f, i * 0.07, 0.14, 'triangle', 0.05)); break
    case 'loss': tone(300, 0, 0.3, 'sawtooth', 0.025, 150); break
    case 'levelup': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.2, 'triangle', 0.06)); break
    case 'achievement': [784, 988, 1175].forEach((f, i) => tone(f, i * 0.08, 0.16, 'sine', 0.06)); break
    case 'alert': tone(880, 0, 0.07, 'sine', 0.04); tone(880, 0.12, 0.07, 'sine', 0.04); break
    case 'click': tone(1200, 0, 0.03, 'square', 0.015); break
    case 'rug': tone(400, 0, 0.5, 'sawtooth', 0.04, 60); break
  }
}
