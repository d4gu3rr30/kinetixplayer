const base = 'https://api.deezer.com'
const cache = new Map()

async function get(path) {
  const cached = cache.get(path)
  if (cached && cached.expires > Date.now()) return cached.data
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(9000) })
  if (!response.ok) throw new Error(`Deezer недоступен (${response.status})`)
  const data = await response.json()
  if (data.error) throw new Error(data.error.message || 'Ошибка каталога Deezer')
  cache.set(path, { data, expires: Date.now() + 5 * 60_000 })
  return data
}

const clean = value => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const tints = ['#9b545d', '#607b6c', '#c49b5a', '#84736f', '#95705c', '#a0879b', '#bd9956', '#8277ac', '#b97684', '#778899', '#769c82', '#6f91a7', '#967f73', '#b58368', '#798e93', '#a3af4e']
function tintFor(value) { let hash = 0; for (const char of String(value || '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0; return tints[hash % tints.length] }

export async function searchArtistEntities(query, { limit = 20 } = {}) {
  const text = String(query || '').trim().slice(0, 100)
  if (!text) return []
  const found = await get(`/search/artist?q=${encodeURIComponent(text)}&limit=${Math.min(Math.max(Number(limit) || 20, 1), 40)}`)
  return (found.data || []).filter(item => item?.id && item.name).map(item => ({
    id: `deezer-${item.id}`,
    name: item.name,
    image: item.picture_medium || item.picture_big || '',
    imageSource: item.link || '',
    tags: ['all'],
    tint: tintFor(item.name),
    popularity: Number(item.nb_fan) || 0,
    fans: Number(item.nb_fan) || 0,
    albums: Number(item.nb_album) || 0,
    description: `${Number(item.nb_fan) || 0} слушателей · ${Number(item.nb_album) || 0} релизов`,
    link: item.link || '',
  }))
}

export async function deezerArtist(id) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Неверный исполнитель')
  return get(`/artist/${id}`)
}
export async function deezerArtistTop(id) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Неверный исполнитель')
  return get(`/artist/${id}/top?limit=30`)
}
export async function deezerSearchTracks(query, { limit = 100 } = {}) {
  const text = String(query || '').trim().slice(0, 100)
  if (!text) return { data: [] }
  return get(`/search/track?q=${encodeURIComponent(text)}&limit=${Math.min(Math.max(Number(limit) || 100, 1), 100)}`)
}
export async function deezerArtistAlbums(id) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Неверный исполнитель')
  return get(`/artist/${id}/albums?limit=100`)
}
export async function deezerArtistRelated(id) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Неверный исполнитель')
  return get(`/artist/${id}/related?limit=12`)
}
export async function deezerAlbum(id) {
  if (!/^\d{1,20}$/.test(String(id))) throw new Error('Неверный альбом')
  return get(`/album/${id}`)
}

export function sameArtistName(left, right) {
  const a = clean(left)
  const b = clean(right)
  if (!a || !b) return false
  if (a === b) return true
  const generic = /^(band|music|official|group|the band|the group)$/
  if (a.startsWith(`${b} `) && generic.test(a.slice(b.length + 1))) return true
  if (b.startsWith(`${a} `) && generic.test(b.slice(a.length + 1))) return true
  return false
}

export async function resolveDeezerArtist(name, id) {
  if (/^\d{1,20}$/.test(String(id || ''))) return deezerArtist(id)
  const raw = String(name || '').trim().slice(0, 120)
  if (!raw) throw new Error('Нужен исполнитель')
  const candidates = [...new Set([raw, raw.split(',')[0], raw.split('&')[0], raw.split(' feat')[0]].map(value => value.trim()).filter(Boolean))]
  const byFans = (a, b) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0)
  let fallback = null
  for (const candidate of candidates) {
    const found = await get(`/search/artist?q=${encodeURIComponent(candidate)}&limit=15`).catch(() => null)
    const list = found?.data || []
    if (!list.length) continue
    const key = clean(candidate)
    // Several Deezer artists can share a name (FACE, Kino, ...): the most followed one is the real match.
    const exact = list.filter(item => clean(item.name) === key).sort(byFans)
    if (exact.length) return exact[0]
    const near = list.filter(item => { const value = clean(item.name); return value.includes(key) || key.includes(value) }).sort(byFans)
    if (near.length) return near[0]
    if (!fallback) fallback = list[0]
  }
  if (fallback) return fallback
  throw new Error('Исполнитель не найден в Deezer')
}
