import type { Track } from './types'

export type ListenPeriod = 'day' | 'month' | 'half' | 'year'
export type ArtistListen = { key: string; name: string; seconds: number }
type ArtistEntry = { name: string; seconds: number }
export type TrackListenEntry = { id: string; title: string; artist: string; artwork?: string; source: Track['source']; duration?: number; seconds: number }
export type ListenStats = {
  days: Record<string, Record<string, ArtistEntry>>
  tracks: Record<string, Record<string, TrackListenEntry>>
  hours: Record<string, number[]>
}

const STORE_PREFIX = 'kinetix:listen:v1:'
const PENDING_KEY = 'kinetix:listen:pending:v1'
const MAX_DAYS = 800
const DAY_MS = 86_400_000
const WINDOW_DAYS: Record<ListenPeriod, number> = { day: 1, month: 30, half: 182, year: 365 }
const cache = new Map<string, ListenStats>()
let lastPersist = 0

const storeKey = (userId: string) => `${STORE_PREFIX}${userId}`
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const trackKey = (artist: string, title: string) => `${artist.toLocaleLowerCase('ru-RU')}|${title.toLocaleLowerCase('ru-RU')}`

function emptyStats(): ListenStats { return { days: {}, tracks: {}, hours: {} } }

function read(userId: string): ListenStats {
  const cached = cache.get(userId)
  if (cached) return cached
  const stats = emptyStats()
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(userId)) || 'null') as Partial<ListenStats> | null
    if (raw && raw.days && typeof raw.days === 'object') stats.days = raw.days as ListenStats['days']
    if (raw && raw.tracks && typeof raw.tracks === 'object') stats.tracks = raw.tracks as ListenStats['tracks']
    if (raw && raw.hours && typeof raw.hours === 'object') {
      for (const [day, hours] of Object.entries(raw.hours)) {
        if (!Array.isArray(hours)) continue
        stats.hours[day] = Array.from({ length: 24 }, (_, index) => Number(hours[index]) || 0)
      }
    }
  } catch { /* Broken stats start over instead of blocking playback. */ }
  cache.set(userId, stats)
  return stats
}

function persist(userId: string, stats: ListenStats) {
  lastPersist = Date.now()
  try { localStorage.setItem(storeKey(userId), JSON.stringify(stats)) } catch { /* Quota: stats stay in memory for this session. */ }
}

function snapshot(stats: ListenStats): ListenStats { return { days: { ...stats.days }, tracks: { ...stats.tracks }, hours: { ...stats.hours } } }

function trimDays(stats: ListenStats) {
  const days = Object.keys(stats.days)
  if (days.length <= MAX_DAYS) return
  days.sort().slice(0, days.length - MAX_DAYS).forEach(old => { delete stats.days[old]; delete stats.tracks[old]; delete stats.hours[old] })
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TRACK_SOURCES = new Set<TrackListenEntry['source']>(['soundcloud', 'archive', 'audius', 'local', 'youtube', 'yandex', 'vk'])

// Transfer files are user input, so everything below is rebuilt from scratch
// instead of trusting the shapes the file claims to have.
function sanitizeStats(input: unknown): ListenStats {
  const stats = emptyStats()
  if (!input || typeof input !== 'object') return stats
  const raw = input as Partial<ListenStats>
  if (raw.days && typeof raw.days === 'object') {
    for (const [day, artists] of Object.entries(raw.days)) {
      if (!DAY_PATTERN.test(day) || !artists || typeof artists !== 'object') continue
      for (const [key, entry] of Object.entries(artists)) {
        const item = entry as Partial<ArtistEntry> | null
        const seconds = Number(item?.seconds)
        const name = String(item?.name || '').trim()
        if (!name || !Number.isFinite(seconds) || seconds <= 0) continue
        ;(stats.days[day] || (stats.days[day] = {}))[key] = { name, seconds }
      }
    }
  }
  if (raw.tracks && typeof raw.tracks === 'object') {
    for (const [day, tracks] of Object.entries(raw.tracks)) {
      if (!DAY_PATTERN.test(day) || !tracks || typeof tracks !== 'object') continue
      for (const [key, entry] of Object.entries(tracks)) {
        const item = entry as Partial<TrackListenEntry> | null
        const seconds = Number(item?.seconds)
        const title = String(item?.title || '').trim()
        const artist = String(item?.artist || '').trim()
        if (!title || !artist || !Number.isFinite(seconds) || seconds <= 0) continue
        const source = TRACK_SOURCES.has(item?.source as TrackListenEntry['source']) ? item!.source! : 'local'
        const duration = Number(item?.duration)
        ;(stats.tracks[day] || (stats.tracks[day] = {}))[key] = {
          id: String(item?.id || key),
          title,
          artist,
          artwork: typeof item?.artwork === 'string' && item.artwork ? item.artwork : undefined,
          source,
          duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
          seconds,
        }
      }
    }
  }
  if (raw.hours && typeof raw.hours === 'object') {
    for (const [day, hours] of Object.entries(raw.hours)) {
      if (!DAY_PATTERN.test(day) || !Array.isArray(hours)) continue
      stats.hours[day] = Array.from({ length: 24 }, (_, index) => {
        const value = Number(hours[index])
        return Number.isFinite(value) && value > 0 ? value : 0
      })
    }
  }
  return stats
}

function mergeInto(target: ListenStats, source: ListenStats) {
  for (const [day, artists] of Object.entries(source.days)) {
    const bucket = target.days[day] || (target.days[day] = {})
    for (const [key, entry] of Object.entries(artists)) {
      const current = bucket[key]
      if (current) { current.seconds += entry.seconds; current.name = entry.name || current.name }
      else bucket[key] = { name: entry.name, seconds: entry.seconds }
    }
  }
  for (const [day, tracks] of Object.entries(source.tracks)) {
    const bucket = target.tracks[day] || (target.tracks[day] = {})
    for (const [key, entry] of Object.entries(tracks)) {
      const current = bucket[key]
      if (current) {
        current.seconds += entry.seconds
        current.artwork = current.artwork || entry.artwork
        current.duration = current.duration || entry.duration
      } else bucket[key] = { ...entry }
    }
  }
  for (const [day, hours] of Object.entries(source.hours)) {
    const bucket = target.hours[day] || (target.hours[day] = Array.from({ length: 24 }, () => 0))
    for (let index = 0; index < 24; index++) bucket[index] = (bucket[index] || 0) + (hours[index] || 0)
  }
  trimDays(target)
}

function totalSeconds(stats: ListenStats): number {
  let total = 0
  for (const artists of Object.values(stats.days)) for (const entry of Object.values(artists)) total += entry.seconds
  return total
}

function readPending(): ListenStats | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    return sanitizeStats(JSON.parse(raw))
  } catch { return null }
}

export function flushListenStats() { for (const [userId, stats] of cache) persist(userId, stats) }

export function exportListenStats(userId: string): ListenStats {
  flushListenStats()
  return snapshot(read(userId))
}

/** Merges a transfer snapshot into the given account and returns the added seconds. */
export function importListenStats(userId: string, payload: unknown): number {
  const incoming = sanitizeStats(payload)
  const amount = totalSeconds(incoming)
  if (!amount) return 0
  const stats = read(userId)
  mergeInto(stats, incoming)
  persist(userId, stats)
  return amount
}

/** Keeps imported stats until the person signs in, then merges them into that account. */
export function stashPendingListenStats(payload: unknown): number {
  const incoming = sanitizeStats(payload)
  const amount = totalSeconds(incoming)
  if (!amount) return 0
  const pending = readPending() || emptyStats()
  mergeInto(pending, incoming)
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)) } catch { /* Quota: the stats stay in this session's cache only. */ }
  return amount
}

export function takePendingListenStats(userId: string): number {
  const pending = readPending()
  if (!pending) return 0
  try { localStorage.removeItem(PENDING_KEY) } catch { /* Nothing to clean up. */ }
  return importListenStats(userId, pending)
}

export function loadListenStats(userId: string): ListenStats { return snapshot(read(userId)) }

export function addListenTime(userId: string, track: Pick<Track, 'id' | 'title' | 'artist' | 'artwork' | 'source' | 'duration'>, seconds: number): ListenStats {
  const stats = read(userId)
  const artist = track.artist.trim()
  const title = track.title.trim()
  const amount = Math.min(seconds, 30)
  if (artist && amount >= .25) {
    const now = new Date()
    const day = dayKey(now)
    const bucket = stats.days[day] || (stats.days[day] = {})
    const key = artist.toLocaleLowerCase('ru-RU')
    const entry = bucket[key]
    if (entry) { entry.seconds += amount; entry.name = artist }
    else bucket[key] = { name: artist, seconds: amount }
    if (title && track.id) {
      const tracks = stats.tracks[day] || (stats.tracks[day] = {})
      const fingerprint = trackKey(artist, title)
      const listened = tracks[fingerprint]
      if (listened) { listened.seconds += amount; listened.artwork = track.artwork || listened.artwork; listened.duration = track.duration || listened.duration }
      else tracks[fingerprint] = { id: track.id, title, artist, artwork: track.artwork, source: track.source, duration: track.duration, seconds: amount }
    }
    const hours = stats.hours[day] || (stats.hours[day] = Array.from({ length: 24 }, () => 0))
    hours[now.getHours()] = (hours[now.getHours()] || 0) + amount
    const days = Object.keys(stats.days)
    if (days.length > MAX_DAYS) {
      days.sort().slice(0, days.length - MAX_DAYS).forEach(old => { delete stats.days[old]; delete stats.tracks[old]; delete stats.hours[old] })
    }
    // Serialising the whole stats store is one of the most expensive things this module can do;
    // batching it also keeps localStorage writes from blocking scroll frames.
    if (Date.now() - lastPersist > 15000) persist(userId, stats)
  }
  return snapshot(stats)
}

export function aggregateArtists(stats: ListenStats, period: ListenPeriod, now = new Date()): ArtistListen[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - (WINDOW_DAYS[period] - 1) * DAY_MS
  const min = dayKey(new Date(start))
  const totals = new Map<string, ArtistEntry>()
  for (const [day, artists] of Object.entries(stats.days)) {
    if (day < min) continue
    for (const [key, entry] of Object.entries(artists)) {
      const current = totals.get(key)
      if (current) current.seconds += entry.seconds
      else totals.set(key, { name: entry.name, seconds: entry.seconds })
    }
  }
  return [...totals]
    .filter(([, entry]) => entry.seconds >= 1)
    .map(([key, entry]) => ({ key, name: entry.name, seconds: entry.seconds }))
    .sort((a, b) => b.seconds - a.seconds)
}

export function totalListen(list: ArtistListen[]): number { return list.reduce((sum, item) => sum + item.seconds, 0) }

export function formatListenTime(seconds: number): string {
  const total = Math.round(seconds)
  if (total < 60) return '< 1 мин'
  const minutes = Math.round(total / 60)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours} ч ${rest} мин` : `${hours} ч`
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushListenStats)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushListenStats() })
}
