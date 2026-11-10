import { createHash } from 'node:crypto'

const API = 'https://api.music.yandex.net'
const searchCache = new Map()
const genreCache = new Map()
const artistCache = new Map()
const streamCache = new Map()
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

function token() { return String(process.env.YANDEX_MUSIC_TOKEN || '').trim() }
export function yandexFull() { return Boolean(token()) }

function requestHeaders() {
  const headers = { 'user-agent': userAgent, accept: 'application/json' }
  if (token()) headers.authorization = `OAuth ${token()}`
  return headers
}

function artworkOf(track) {
  const uri = track?.coverUri || track?.albums?.[0]?.coverUri
  return uri ? `https://${String(uri).replace('%%', '400x400')}` : undefined
}

function trackOf(track, url) {
  const artist = (track.artists || []).map(item => item.name).filter(Boolean).join(', ') || 'Яндекс Музыка'
  return {
    id: `yandex:${track.id}`,
    title: track.title || 'Без названия',
    artist,
    artwork: artworkOf(track),
    url,
    streamUrl: `/api/yandex-stream?id=${encodeURIComponent(track.id)}`,
    duration: track.durationMs ? track.durationMs / 1000 : undefined,
    source: 'yandex',
  }
}

function prune(map, max) {
  if (map.size < max) return
  for (const [key, entry] of map) if (entry.expires < Date.now()) map.delete(key)
  while (map.size >= max) map.delete(map.keys().next().value)
}

export async function searchYandex(query, limit = 20, page = 0) {
  const text = String(query || '').trim().slice(0, 160)
  if (!text) return []
  const pageIndex = Math.max(0, Math.min(Number(page) || 0, 4))
  const key = `${pageIndex}:${text.toLowerCase()}`
  const cached = searchCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.tracks.slice(0, limit)
  const target = new URL(`${API}/search`)
  target.search = new URLSearchParams({ text, type: 'track', page: String(pageIndex), nocorrect: 'false' }).toString()
  const response = await fetch(target, { headers: requestHeaders(), signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Яндекс Музыка недоступна (${response.status})`)
  const data = await response.json()
  const tracks = (data.result?.tracks?.results || [])
    .filter(track => track && track.id && track.available !== false)
    .map(track => trackOf(track, `https://music.yandex.ru/search?text=${encodeURIComponent(`${(track.artists || []).map(item => item.name).filter(Boolean).join(', ') || ''} ${track.title || ''}`.trim())}`))
  prune(searchCache, 120)
  searchCache.set(key, { tracks, expires: Date.now() + 10 * 60_000 })
  return tracks.slice(0, limit)
}

function normalizeName(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

async function findArtistEntity(name) {
  const target = new URL(`${API}/search`)
  target.search = new URLSearchParams({ text: String(name).slice(0, 160), type: 'artist', page: '0' }).toString()
  const response = await fetch(target, { headers: requestHeaders(), signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Яндекс Музыка недоступна (${response.status})`)
  const data = await response.json()
  const results = data.result?.artists?.results || []
  const wanted = normalizeName(name)
  return results.find(item => normalizeName(item.name) === wanted) || results[0] || null
}

export async function searchYandexArtist(name, limit = 34) {
  const text = String(name || '').trim().slice(0, 160)
  if (!text) return []
  const count = Math.max(1, Math.min(Number(limit) || 34, 50))
  const artist = await findArtistEntity(text)
  if (!artist?.id) return []
  const key = `${artist.id}:${count}`
  const cached = artistCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.tracks.slice(0, count)
  const target = new URL(`${API}/artists/${encodeURIComponent(artist.id)}/tracks`)
  target.searchParams.set('page', '0')
  target.searchParams.set('pageSize', String(count))
  const response = await fetch(target, { headers: requestHeaders(), signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Яндекс Музыка недоступна (${response.status})`)
  const data = await response.json()
  const tracks = (data.result?.tracks || [])
    .filter(track => track && track.id && track.available !== false)
    .map(track => trackOf(track, `https://music.yandex.ru/track/${track.id}`))
  prune(artistCache, 80)
  artistCache.set(key, { tracks, expires: Date.now() + 10 * 60_000 })
  return tracks.slice(0, count)
}

async function genreBatch(tag, batchId) {
  const target = new URL(`${API}/rotor/station/genre:${encodeURIComponent(tag)}/tracks`)
  target.searchParams.set('settings2', 'true')
  if (batchId) target.searchParams.set('batchId', batchId)
  const response = await fetch(target, { headers: requestHeaders(), signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Яндекс Музыка недоступна (${response.status})`)
  const data = await response.json()
  const result = data.result || {}
  return {
    batchId: String(result.batchId || ''),
    tracks: (Array.isArray(result.sequence) ? result.sequence : []).map(item => item?.track).filter(Boolean),
  }
}

export async function searchYandexGenre(tag, limit = 30) {
  const station = String(tag || '').trim()
  if (!station || !token()) return []
  const count = Math.max(1, Math.min(Number(limit) || 30, 60))
  const key = `${station}:${count}`
  const cached = genreCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.tracks.slice(0, count)
  const tracks = []
  const seen = new Set()
  let batchId = ''
  for (let round = 0; round < 12 && tracks.length < count; round++) {
    let batch
    try { batch = await genreBatch(station, batchId) }
    catch (error) { if (!tracks.length) throw error; break }
    batchId = batch.batchId
    let fresh = 0
    for (const track of batch.tracks) {
      if (!track.id || track.available === false || seen.has(track.id)) continue
      seen.add(track.id)
      fresh++
      tracks.push(trackOf(track, `https://music.yandex.ru/track/${track.id}`))
      if (tracks.length >= count) break
    }
    if (!fresh || !batchId) break
  }
  prune(genreCache, 60)
  genreCache.set(key, { tracks, expires: Date.now() + 10 * 60_000 })
  return tracks
}

async function resolveYandexStream(trackId) {
  const cached = streamCache.get(trackId)
  if (cached && cached.expires > Date.now()) return cached
  const infoResponse = await fetch(`${API}/tracks/${encodeURIComponent(trackId)}/download-info`, { headers: requestHeaders(), signal: AbortSignal.timeout(12000) })
  if (!infoResponse.ok) throw new Error(`Яндекс Музыка не отдала трек (${infoResponse.status})`)
  const info = await infoResponse.json()
  const options = (info.result || []).filter(item => item.downloadInfoUrl)
  options.sort((a, b) => Number(b.codec === 'mp3') - Number(a.codec === 'mp3') || (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0))
  const item = options[0]
  if (!item) throw new Error('Трек недоступен в Яндекс Музыке')
  const downloadInfo = await fetch(item.downloadInfoUrl, { signal: AbortSignal.timeout(12000) })
  if (!downloadInfo.ok) throw new Error('Не удалось получить ссылку на поток Яндекс Музыки')
  const xml = await downloadInfo.text()
  const host = xml.match(/<host>(.*?)<\/host>/)?.[1]
  const path = xml.match(/<path>(.*?)<\/path>/)?.[1]
  const timestamp = xml.match(/<ts>(.*?)<\/ts>/)?.[1]
  const salt = xml.match(/<s>(.*?)<\/s>/)?.[1]
  if (!host || !path || !timestamp || !salt) throw new Error('Не удалось подписать поток Яндекс Музыки')
  const signature = createHash('md5').update(`${salt}${path}`).digest('hex')
  const entry = {
    url: `https://${host}/get-mp3/${signature}/${timestamp}${path}`,
    preview: Boolean(item.preview),
    type: item.codec === 'aac' ? 'audio/mp4' : 'audio/mpeg',
    expires: Date.now() + 25 * 60_000,
  }
  prune(streamCache, 100)
  streamCache.set(trackId, entry)
  return entry
}

export async function yandexStream(trackId, range) {
  let entry = await resolveYandexStream(trackId)
  let response = await fetch(entry.url, { headers: range ? { range } : {} })
  if (response.status === 403 || response.status === 404 || response.status === 410) {
    streamCache.delete(trackId)
    entry = await resolveYandexStream(trackId)
    response = await fetch(entry.url, { headers: range ? { range } : {} })
  }
  return { response, entry }
}

export function resetYandex() {
  searchCache.clear()
  genreCache.clear()
  artistCache.clear()
  streamCache.clear()
}
