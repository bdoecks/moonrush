import clsx from 'clsx'
import { ImagePlus, Link2, Loader2, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { iconFromFile, iconFromUrl } from '../../utils/image'
import { TokenIcon } from '../ui'

interface Props {
  image?: string
  emoji: string
  hue: number
  onChange: (image: string | undefined) => void
  onHue: (hue: number) => void
}

/** Token picture: upload, drag & drop, paste (Ctrl+V) or an image link from X, Google Images, etc. */
export function ImagePicker({ image, emoji, hue, onChange, onHue }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  const run = async (job: () => Promise<{ src: string; note?: string }>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const r = await job()
      onChange(r.src)
      if (r.note) setNote(r.note)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t use that image')
    } finally {
      setBusy(false)
    }
  }
  const applyFile = (f: File) => run(async () => ({ src: await iconFromFile(f) }))
  const applyUrl = (u: string) =>
    run(async () => {
      const r = await iconFromUrl(u)
      setUrl('')
      return { src: r.src, note: r.embedded ? undefined : 'That site blocks copying, so the link itself is saved. If it goes offline, your emoji shows instead.' }
    })

  // Ctrl+V anywhere on the Cooking page: an image on the clipboard becomes the token picture.
  const applyFileRef = useRef(applyFile)
  useEffect(() => {
    applyFileRef.current = applyFile
  })
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        void applyFileRef.current(file)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
          if (file) void applyFile(file)
          else {
            const dropped = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
            if (dropped) void applyUrl(dropped)
          }
        }}
        title="Click to upload, or drop / paste an image"
        className={clsx('group relative rounded-lg ring-2 ring-offset-2 ring-offset-panel transition-all', over ? 'ring-accent' : 'ring-transparent hover:ring-line2')}
        aria-label="Token picture"
      >
        <TokenIcon token={{ emoji, hue, status: 'graduated', image }} size={88} />
        <span className={clsx('absolute inset-0 grid place-items-center rounded-md bg-black/60 text-[10px] font-bold text-white transition-opacity', over || busy ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <span className="flex flex-col items-center gap-0.5"><ImagePlus size={18} />{over ? 'Drop it' : 'Upload'}</span>}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void applyFile(f)
          e.target.value = ''
        }}
      />
      <div className="flex gap-1">
        <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1 rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:text-ink"><Upload size={11} /> Upload</button>
        {image && <button type="button" onClick={() => { onChange(undefined); setNote(null) }} className="flex items-center gap-1 rounded border border-line2 px-1.5 py-0.5 text-[10px] font-semibold text-muted hover:border-down/50 hover:text-down"><Trash2 size={11} /> Remove</button>}
      </div>
      {!image && <input type="range" min={0} max={359} value={hue} onChange={(e) => onHue(Number(e.target.value))} className="w-24 accent-[var(--accent)]" aria-label="Icon colour" />}
      <form
        className="flex w-[200px] items-center rounded-md border border-line2 bg-bg focus-within:border-accent/60"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) void applyUrl(url)
        }}
      >
        <Link2 size={12} className="ml-1.5 shrink-0 text-dim" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste image link…" className="h-7 min-w-0 flex-1 bg-transparent px-1.5 text-[11px] outline-none placeholder:text-dim" aria-label="Image link" />
        <button type="submit" disabled={!url.trim() || busy} className="h-7 shrink-0 rounded-r-md px-2 text-[10px] font-bold text-accent disabled:opacity-40">Use</button>
      </form>
      <p className="w-[200px] text-center text-[9px] leading-snug text-dim">
        Upload, drag &amp; drop, or <b className="text-muted">Ctrl+V</b> an image. From X or Google Images: right-click the picture → <i>Copy image address</i> and paste the link.
      </p>
      {error && <p className="w-[200px] text-center text-[10px] leading-snug text-down">{error}</p>}
      {note && <p className="w-[200px] text-center text-[10px] leading-snug text-warn">{note}</p>}
    </div>
  )
}
