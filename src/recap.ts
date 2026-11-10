import type { ListenStats, TrackListenEntry } from './listening'

export type RecapSeason = { active: boolean; year: number }
export type RecapArtist = { name: string; seconds: number; share: number }
export type RecapTrack = TrackListenEntry & { key: string }
export type RecapPart = { key: 'night' | 'morning' | 'day' | 'evening'; label: string; seconds: number; share: number }
export type RecapData = {
  year: number
  totalSeconds: number
  activeDays: number
  averageSeconds: number
  artistCount: number
  artists: RecapArtist[]
  tracks: RecapTrack[]
  newArtists: string[]
  months: number[]
  topMonth: number
  hours: number[]
  favoriteHour: number | null
  parts: RecapPart[]
  longestStreak: number
  topDay: { date: string; seconds: number } | null
  firstDay: string | null
  moments: number
  coverArt: string[]
}

const PARTS: Array<{ key: RecapPart['key']; label: string; from: number; to: number }> = [
  { key: 'night', label: 'Ночь', from: 0, to: 5 },
  { key: 'morning', label: 'Утро', from: 6, to: 11 },
  { key: 'day', label: 'День', from: 12, to: 17 },
  { key: 'evening', label: 'Вечер', from: 18, to: 23 },
]
const MIN_RECAP_SECONDS = 60

// The recap lights up for the whole holiday stretch: December 18 — January 15.
export function recapSeason(date = new Date()): RecapSeason {
  const month = date.getMonth()
  const day = date.getDate()
  const year = date.getFullYear()
  if (month === 11 && day >= 18) return { active: true, year }
  if (month === 0 && day <= 15) return { active: true, year: year - 1 }
  return { active: false, year: year - 1 }
}

export function recapYears(stats: ListenStats): number[] {
  const years = new Set<number>()
  for (const day of Object.keys(stats.days)) {
    const year = Number(day.slice(0, 4))
    if (Number.isFinite(year) && year > 2000) years.add(year)
  }
  return [...years].sort((a, b) => b - a)
}

function yearSeconds(stats: ListenStats, year: number): number {
  const prefix = `${year}-`
  let total = 0
  for (const [day, artists] of Object.entries(stats.days)) {
    if (!day.startsWith(prefix)) continue
    for (const entry of Object.values(artists)) total += Number(entry.seconds) || 0
  }
  return total
}

export function hasRecap(stats: ListenStats | null | undefined, year: number): boolean {
  return Boolean(stats && yearSeconds(stats, year) >= MIN_RECAP_SECONDS)
}

export function pickRecapYear(stats: ListenStats | null | undefined, preferred: number): number | null {
  if (!stats) return null
  for (const year of recapYears(stats)) {
    if (year <= preferred && yearSeconds(stats, year) >= MIN_RECAP_SECONDS) return year
  }
  return null
}

function longestStreak(days: string[]): number {
  let best = 0
  let run = 0
  let previous = 0
  for (const day of [...days].sort()) {
    const [year, month, date] = day.split('-').map(Number)
    const stamp = Date.UTC(year, month - 1, date)
    run = previous && stamp - previous === 86_400_000 ? run + 1 : 1
    previous = stamp
    if (run > best) best = run
  }
  return best
}

export function buildRecap(stats: ListenStats, year: number, moments: Array<{ createdAt: string }> = []): RecapData {
  const prefix = `${year}-`
  const artists = new Map<string, { name: string; seconds: number }>()
  const tracks = new Map<string, RecapTrack>()
  const priorArtists = new Set<string>()
  const months = Array.from({ length: 12 }, () => 0)
  const hours = Array.from({ length: 24 }, () => 0)
  const dayTotals = new Map<string, number>()
  let totalSeconds = 0

  for (const [day, entries] of Object.entries(stats.days)) {
    const inYear = day.startsWith(prefix)
    for (const [key, entry] of Object.entries(entries)) {
      if (!inYear) { if (day < prefix) priorArtists.add(key); continue }
      const seconds = Number(entry.seconds) || 0
      if (seconds <= 0) continue
      totalSeconds += seconds
      const known = artists.get(key)
      if (known) known.seconds += seconds
      else artists.set(key, { name: entry.name, seconds })
      dayTotals.set(day, (dayTotals.get(day) || 0) + seconds)
    }
    if (!inYear) continue
    for (const [key, entry] of Object.entries(stats.tracks?.[day] || {})) {
      const seconds = Number(entry.seconds) || 0
      if (seconds <= 0) continue
      const known = tracks.get(key)
      if (known) known.seconds += seconds
      else tracks.set(key, { ...entry, key, seconds })
    }
    const dayHours = stats.hours?.[day]
    if (Array.isArray(dayHours)) for (let hour = 0; hour < 24; hour++) hours[hour] += Number(dayHours[hour]) || 0
  }

  for (const day of dayTotals.keys()) months[Number(day.slice(5, 7)) - 1] += dayTotals.get(day) || 0

  const artistList: RecapArtist[] = [...artists.values()]
    .filter(item => item.seconds >= 1)
    .sort((a, b) => b.seconds - a.seconds)
    .map(item => ({ name: item.name, seconds: item.seconds, share: totalSeconds ? item.seconds / totalSeconds : 0 }))

  const trackList = [...tracks.values()].filter(item => item.seconds >= 1).sort((a, b) => b.seconds - a.seconds).slice(0, 5)
  const hourTotal = hours.reduce((sum, value) => sum + value, 0)
  const favoriteHour = hourTotal > 0 ? hours.indexOf(Math.max(...hours)) : null
  const parts: RecapPart[] = hourTotal > 0 ? PARTS.map(part => {
    const seconds = hours.slice(part.from, part.to + 1).reduce((sum, value) => sum + value, 0)
    return { key: part.key, label: part.label, seconds, share: seconds / hourTotal }
  }) : []

  const sortedDays = [...dayTotals.keys()].sort()
  const topDayKey = [...dayTotals.entries()].sort((a, b) => b[1] - a[1])[0] || null
  const newArtists = artistList.filter(item => !priorArtists.has(item.name.toLocaleLowerCase('ru-RU'))).map(item => item.name)
  const coverArt = [...new Set(trackList.map(item => item.artwork).filter((value): value is string => Boolean(value)))].slice(0, 4)
  const momentsCount = moments.filter(moment => String(moment.createdAt || '').slice(0, 4) === String(year)).length
  const activeDays = sortedDays.length

  return {
    year,
    totalSeconds,
    activeDays,
    averageSeconds: activeDays ? totalSeconds / activeDays : 0,
    artistCount: artistList.length,
    artists: artistList,
    tracks: trackList,
    newArtists,
    months,
    topMonth: months.some(value => value > 0) ? months.indexOf(Math.max(...months)) : -1,
    hours: hourTotal > 0 ? hours : [],
    favoriteHour,
    parts,
    longestStreak: longestStreak(sortedDays),
    topDay: topDayKey ? { date: topDayKey[0], seconds: topDayKey[1] } : null,
    firstDay: sortedDays[0] || null,
    moments: momentsCount,
    coverArt,
  }
}

export const MONTHS_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
export const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']

export function recapHoursLabel(seconds: number): { value: number; unit: 'ч' | 'мин' } {
  const minutes = Math.round(seconds / 60)
  return minutes >= 60 ? { value: Math.round(minutes / 60), unit: 'ч' } : { value: minutes, unit: 'мин' }
}

export function recapDayLabel(day: string | null): string {
  if (!day) return ''
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
