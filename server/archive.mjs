const archive = 'https://archive.org'
const metadataCache = new Map()
const searchCache = new Map()
const genreTerms = { electronic: 'electronic', hiphop: 'hiphop', indie: 'indie', pop: 'pop', rock: 'rock', ambient: 'ambient', house: 'house', jazz: 'jazz', rnb: 'rnb', techno: 'techno', classical: 'classical', lofi: 'lofi' }

async function metadata(identifier) {
  const cached = metadataCache.get(identifier)
  if (cached && cached.expires > Date.now()) return cached.data
  const response = await fetch(`${archive}/metadata/${encodeURIComponent(identifier)}`, { signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`Archive metadata ${response.status}`)
  const data = await response.json()
  metadataCache.set(identifier, { data, expires: Date.now() + 60 * 60_000 })
  return data
}

function licensed(value) {
  const license = String(value || '')
  return /^https?:\/\/creativecommons\.org\/(licenses|publicdomain)\//i.test(license)
}

function toTracks(item, maxPerItem) {
  const meta = item.metadata || {}
  if (!licensed(meta.licenseurl)) return []
  const files = (item.files || []).filter(file => /\.mp3$/i.test(file.name || '') && Number(file.size || 0) > 50000 && !/thumb|sample|preview/i.test(file.name || '')).sort((a, b) => (a.source === 'original' ? -1 : 1) - (b.source === 'original' ? -1 : 1)).slice(0, maxPerItem)
  return files.map(file => ({ id: `archive:${meta.identifier}:${file.name}`, title: String(file.title || file.name.replace(/\.[^.]+$/, '').replace(/^\d+[-_. ]*/, '').replace(/[_-]+/g, ' ')).trim().slice(0, 160), artist: String(file.artist || file.creator || meta.creator || 'Internet Archive').slice(0, 120), artwork: `${archive}/services/img/${encodeURIComponent(meta.identifier)}`, url: `${archive}/details/${encodeURIComponent(meta.identifier)}`, streamUrl: `${archive}/download/${encodeURIComponent(meta.identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`, duration: Number.parseFloat(file.length || file.duration || '') || undefined, source: 'archive', license: String(meta.licenseurl) }))
}

function terms(value) { return String(value || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 5).join(' ') }

export async function searchArchive({ query, genre, mode = 'title', limit = 32 }) {
  const safe = genre ? genreTerms[genre] : terms(query)
  if (!safe) return []
  const key = `${genre ? 'genre' : mode}:${safe.toLowerCase()}:${limit}`
  const cached = searchCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.tracks
  const expression = genre ? `mediatype:audio AND licenseurl:* AND subject:${safe}` : mode === 'artist' ? `mediatype:audio AND licenseurl:* AND creator:"${safe}"` : `mediatype:audio AND licenseurl:* AND title:"${safe}"`
  const url = new URL(`${archive}/advancedsearch.php`)
  url.search = new URLSearchParams({ q: expression, 'fl[]': 'identifier', rows: '32', page: '1', output: 'json' }).toString()
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`Поиск Internet Archive недоступен (${response.status})`)
  const result = await response.json()
  const identifiers = (result.response?.docs || []).map(item => item.identifier).filter(Boolean)
  const tracks = []
  for (let offset = 0; offset < identifiers.length && tracks.length < limit; offset += 8) {
    const batch = await Promise.allSettled(identifiers.slice(offset, offset + 8).map(metadata))
    for (const entry of batch) if (entry.status === 'fulfilled') tracks.push(...toTracks(entry.value, 5))
  }
  const normalize = value => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const wanted = normalize(safe)
  const matching = genre ? tracks : tracks.filter(track => normalize(mode === 'artist' ? track.artist : track.title).includes(wanted))
  const unique = [...new Map(matching.map(track => [track.id, track])).values()].slice(0, limit)
  searchCache.set(key, { tracks: unique, expires: Date.now() + 10 * 60_000 })
  return unique
}

export async function archiveDownload(identifier, filename) {
  if (!/^[a-z0-9][a-z0-9_.-]{2,100}$/i.test(identifier) || !filename || filename.includes('/') || filename.includes('\\') || filename.length > 250) throw new Error('Недопустимый файл')
  const item = await metadata(identifier)
  if (!licensed(item.metadata?.licenseurl)) throw new Error('Лицензия записи не позволяет загрузку')
  const file = (item.files || []).find(entry => entry.name === filename && /\.mp3$/i.test(entry.name) && Number(entry.size) > 50000 && Number(entry.size) <= 60_000_000)
  if (!file) throw new Error('MP3 недоступен или слишком велик')
  const response = await fetch(`${archive}/download/${encodeURIComponent(identifier)}/${encodeURIComponent(filename)}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok || !response.body) throw new Error('Не удалось загрузить MP3')
  return { response, size: Number(file.size) }
}
