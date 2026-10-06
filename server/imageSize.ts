// The pixel size of a picture, read from the first bytes of the file (nothing is decoded).
// Why the server looks: a tiny file can claim to be enormous (16,000 × 16,000 pixels of one colour is a few KB), and
// every browser that draws it has to unpack all of it. A coin's picture is drawn in every player's lists, so one such
// file would freeze the game for everybody. Only the three kinds the game's own picture picker makes are read.

export interface ImageSize { type: 'gif' | 'jpeg' | 'webp'; w: number; h: number }

export function imageSize(b: Buffer): ImageSize | null {
  const tag = (from: number, to: number) => b.toString('latin1', from, to)
  // GIF: "GIF87a" or "GIF89a", then width and height, two bytes each, low byte first.
  if (b.length >= 10 && /^GIF8[79]a$/.test(tag(0, 6))) return { type: 'gif', w: b.readUInt16LE(6), h: b.readUInt16LE(8) }
  // WebP: "RIFF" (size) "WEBP", then the first chunk says which flavour it is.
  if (b.length >= 30 && tag(0, 4) === 'RIFF' && tag(8, 12) === 'WEBP') {
    const kind = tag(12, 16)
    if (kind === 'VP8X') return { type: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
    if (kind === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { type: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
    if (kind === 'VP8L' && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21)
      return { type: 'webp', w: 1 + (bits & 0x3fff), h: 1 + ((bits >>> 14) & 0x3fff) }
    }
    return null
  }
  // JPEG: FF D8, then segments. The size is in the first "start of frame" segment.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 <= b.length) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m === 0xff) { i++; continue } // padding between segments
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) }
      if (m === 0xda || m === 0xd9) return null // the picture data began without a frame header
      if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue } // markers that carry no length
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}
