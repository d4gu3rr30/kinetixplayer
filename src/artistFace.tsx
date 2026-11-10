import { useState } from 'react'

export function ArtistFace({ name, image, className }: { name: string; image?: string; className?: string }) {
  const [stage, setStage] = useState(0)
  const candidates = [image, `/api/artist-photo?name=${encodeURIComponent(name)}&v=2`].filter((value): value is string => Boolean(value))
  const cls = ['artist-face', className].filter(Boolean).join(' ')
  const src = candidates[stage]
  if (!src) return <em className={cls}>{name.slice(0, 1).toUpperCase()}</em>
  return <img className={cls} src={src} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setStage(value => value + 1)}/>
}
