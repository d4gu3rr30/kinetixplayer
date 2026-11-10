import type { ListenStats, TrackListenEntry } from './listening'

export type PulseDay = { key: string; label: string; date: number; seconds: number; isToday: boolean }
export type WeekPulse = {
  days: PulseDay[]
  total: number
  previous: number
  change: number | null
  topTrack: TrackListenEntry | null
  topArtist: string | null
  bestDay: PulseDay | null
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MIN_WEEK_SECONDS = 60

const keyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

function daySeconds(stats: ListenStats, key: string): number {
  const artists = stats.days[key]
  if (!artists) return 0
  let total = 0
  for (const entry of Object.values(artists)) total += Number(entry.seconds) || 0
  return total
}

function weekKeys(now: Date): string[] {
  const keys: string[] = []
  for (let offset = 6; offset >= 0; offset--) keys.push(keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)))
  return keys
}

function previousKeys(now: Date): string[] {
  const keys: string[] = []
  for (let offset = 13; offset >= 7; offset--) keys.push(keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset)))
  return keys
}

export function buildWeekPulse(stats: ListenStats | null | undefined, now = new Date()): WeekPulse | null {
  if (!stats) return null
  const currentKeys = weekKeys(now)
  const today = keyOf(now)
  const days: PulseDay[] = currentKeys.map(key => {
    const date = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)))
    return { key, label: WEEKDAYS[date.getDay()], date: date.getDate(), seconds: daySeconds(stats, key), isToday: key === today }
  })
  const total = days.reduce((sum, day) => sum + day.seconds, 0)
  const previous = previousKeys(now).reduce((sum, key) => sum + daySeconds(stats, key), 0)
  const change = previous >= MIN_WEEK_SECONDS ? Math.round(((total - previous) / previous) * 100) : null
  const bestDay = days.reduce<PulseDay | null>((best, day) => day.seconds > (best?.seconds || 0) ? day : best, null)

  const tracks = new Map<string, TrackListenEntry>()
  const artists = new Map<string, { name: string; seconds: number }>()
  for (const key of currentKeys) {
    for (const entry of Object.values(stats.tracks[key] || {})) {
      const seconds = Number(entry.seconds) || 0
      if (seconds <= 0 || !entry.title || !entry.artist) continue
      const fingerprint = `${entry.artist.toLocaleLowerCase('ru-RU')}|${entry.title.toLocaleLowerCase('ru-RU')}`
      const known = tracks.get(fingerprint)
      if (known) {
        known.seconds += seconds
        known.artwork = known.artwork || entry.artwork
        known.duration = known.duration || entry.duration
      } else {
        tracks.set(fingerprint, { ...entry, seconds })
      }
    }
    for (const entry of Object.values(stats.days[key] || {})) {
      const seconds = Number(entry.seconds) || 0
      if (seconds <= 0) continue
      const fingerprint = entry.name.toLocaleLowerCase('ru-RU')
      const known = artists.get(fingerprint)
      if (known) known.seconds += seconds
      else artists.set(fingerprint, { name: entry.name, seconds })
    }
  }

  const topTrack = [...tracks.values()].sort((a, b) => b.seconds - a.seconds)[0] || null
  const topArtist = [...artists.values()].sort((a, b) => b.seconds - a.seconds)[0]?.name || null

  return { days, total, previous, change, topTrack, topArtist, bestDay }
}
