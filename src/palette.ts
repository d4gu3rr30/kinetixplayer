import { useEffect, useState } from 'react'

export type CoverPalette = { a: string; b: string; c: string }
type Bucket = { r: number; g: number; b: number; weight: number; hue: number }

const cache = new Map<string, CoverPalette>()
const failed = new Set<string>()
const CACHE_LIMIT = 120
const FAILED_LIMIT = 240

function rememberFailure(url: string) {
  failed.add(url)
  if (failed.size <= FAILED_LIMIT) return
  const oldest = failed.values().next().value
  if (oldest) failed.delete(oldest)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > .5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === red ? (green - blue) / delta + (green < blue ? 6 : 0) : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4
  return [hue * 60, saturation, lightness]
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = lightness - chroma / 2
  const [r, g, b] = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

const triplet = ([r, g, b]: [number, number, number]) => `${r} ${g} ${b}`

function analyze(image: HTMLImageElement): CoverPalette | null {
  if (typeof document === 'undefined') return null
  try {
    const size = 28
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.drawImage(image, 0, 0, size, size)
    const { data } = context.getImageData(0, 0, size, size)
    const buckets = new Map<number, Bucket>()
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 180) continue
      const [hue, saturation, lightness] = rgbToHsl(data[index], data[index + 1], data[index + 2])
      if (saturation < .16 || lightness < .12 || lightness > .9) continue
      const weight = saturation * saturation * (1 - Math.abs(lightness - .55)) + .01
      const slot = Math.floor(hue / 30) % 12
      const bucket = buckets.get(slot)
      if (bucket) {
        bucket.r += data[index] * weight
        bucket.g += data[index + 1] * weight
        bucket.b += data[index + 2] * weight
        bucket.weight += weight
      } else {
        buckets.set(slot, { r: data[index] * weight, g: data[index + 1] * weight, b: data[index + 2] * weight, weight, hue })
      }
    }
    const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight)
    if (!ranked.length) return null
    const distance = (one: number, other: number) => {
      const gap = Math.abs(one - other) % 360
      return Math.min(gap, 360 - gap)
    }
    const distinct = (used: number[], gap: number) => ranked.find(item => used.every(hue => distance(item.hue, hue) >= gap)) || null
    const primary = ranked[0]
    const secondary = distinct([primary.hue], 40) || ranked[1] || primary
    const tertiary = distinct([primary.hue, secondary.hue], 24) || secondary
    const tone = (bucket: Bucket, lightness: number, boost: number) => {
      const [hue, saturation] = rgbToHsl(bucket.r / bucket.weight, bucket.g / bucket.weight, bucket.b / bucket.weight)
      return triplet(hslToRgb(hue, clamp(saturation * boost, .35, .88), lightness))
    }
    return { a: tone(primary, .66, 1.15), b: tone(secondary, .58, 1.1), c: tone(tertiary, .24, .9) }
  } catch {
    return null
  }
}

export function useCoverPalette(url?: string | null): CoverPalette | null {
  const [loaded, setLoaded] = useState<{ url: string; palette: CoverPalette } | null>(null)
  useEffect(() => {
    if (!url || cache.has(url) || failed.has(url)) return
    let active = true
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      const palette = analyze(image)
      if (!palette) { rememberFailure(url); return }
      cache.set(url, palette)
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest) cache.delete(oldest)
      }
      if (active) setLoaded({ url, palette })
    }
    image.onerror = () => { rememberFailure(url) }
    image.src = url
    return () => { active = false }
  }, [url])
  const cached = url ? cache.get(url) : null
  return cached || (loaded && loaded.url === url ? loaded.palette : null)
}
