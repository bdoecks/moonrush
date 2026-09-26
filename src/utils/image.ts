// Turn user-supplied pictures into small square token icons that are cheap to keep in localStorage.

const SIZE = 160
const MAX_INPUT_BYTES = 8 * 1024 * 1024
const KEEP_GIF_BYTES = 350 * 1024 // small GIFs keep their animation

function loadImage(src: string, crossOrigin = false): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load'))
    img.referrerPolicy = 'no-referrer'
    img.src = src
  })
}

/** Center-crop to a square and scale down. Throws if the canvas is tainted (cross-origin without CORS). */
function toSquareDataUrl(img: HTMLImageElement): string {
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
  const webp = canvas.toDataURL('image/webp', 0.85)
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85)
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read'))
    r.readAsDataURL(file)
  })

export async function iconFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t an image (use PNG, JPG, GIF or WebP)')
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image is too big (max 8 MB)')
  const raw = await readAsDataUrl(file)
  if (file.type === 'image/gif' && file.size <= KEEP_GIF_BYTES) return raw
  try {
    return toSquareDataUrl(await loadImage(raw))
  } catch {
    throw new Error('Couldn’t read that image')
  }
}

/**
 * Accepts a direct image link (e.g. a pbs.twimg.com picture, or "Copy image address" from Google Images).
 * If the host allows it, the picture is shrunk into a data URL; otherwise the link itself is kept.
 */
export async function iconFromUrl(input: string): Promise<{ src: string; embedded: boolean }> {
  const url = input.trim()
  if (/^data:image\//i.test(url)) return { src: toSquareDataUrl(await loadImage(url)), embedded: true }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('That doesn’t look like a link')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only http(s) image links work')
  try {
    const img = await loadImage(parsed.href, true)
    try {
      return { src: toSquareDataUrl(img), embedded: true }
    } catch {
      return { src: parsed.href, embedded: false }
    }
  } catch {
    // CORS-less load (display only) as a fallback.
    try {
      await loadImage(parsed.href)
      return { src: parsed.href, embedded: false }
    } catch {
      throw new Error('Couldn’t load an image from that link. Right-click the picture → "Copy image address" and paste that.')
    }
  }
}

export const isSafeImageSrc = (s?: string) => !!s && (/^data:image\//i.test(s) || /^https?:\/\//i.test(s))
