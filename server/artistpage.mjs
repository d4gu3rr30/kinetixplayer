import { findCuratedByName } from './curated.mjs'
import { deezerAlbum, deezerArtistAlbums, deezerArtistRelated, deezerArtistTop, deezerSearchTracks, resolveDeezerArtist } from './deezer.mjs'
import { searchVk, vkEnabled } from './vk.mjs'
import { searchYandex, searchYandexArtist } from './yandex.mjs'
import { searchYouTube } from './ytdlp.mjs'

const pageCache = new Map()
const tracksCache = new Map()
const releaseCache = new Map()
const cacheTtl = 10 * 60_000

function prune(map, max) {
  if (map.size < max) return
  for (const [key, entry] of map) if (entry.expires < Date.now()) map.delete(key)
  while (map.size >= max) map.delete(map.keys().next().value)
}
function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\(\[][^)\]]*[\)\]]/g, ' ')
    .replace(/\b(feat|ft|prod|remaster(ed)?|slowed|reverb|sped up|nightcore|official|video|audio|lyric(s)?|visualizer|clip|премьера|клип|версия)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
function words(value) { return new Set(normalize(value).split(' ').filter(word => word.length > 2)) }
function titleScore(left, right) {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 100
  if (a.length > 4 && b.length > 4 && (a.includes(b) || b.includes(a))) return 72
  const one = words(a)
  const two = words(b)
  let overlap = 0
  for (const word of one) if (two.has(word)) overlap++
  const ratio = overlap / Math.max(one.size, two.size, 1)
  return ratio > .5 ? Math.round(ratio * 58) : 0
}
function artistScore(name, candidate) {
  const one = words(name)
  const two = words(candidate)
  let overlap = 0
  for (const word of one) if (two.has(word)) overlap++
  return Math.min(30, Math.round(overlap / Math.max(one.size, 1) * 30))
}
function yearOf(value) {
  const year = Number(String(value || '').slice(0, 4))
  return Number.isFinite(year) && year > 1900 && year < 2100 ? year : undefined
}
function coverOf(album) {
  return album?.cover_big || album?.cover_xl || album?.cover_medium || album?.cover || ''
}
function releaseOf(album) {
  if (!album?.id || !album.title) return null
  return {
    id: `deezer-${album.id}`,
    deezerId: album.id,
    title: album.title,
    cover: coverOf(album),
    year: yearOf(album.release_date),
    date: album.release_date || '',
    type: album.record_type || 'album',
    trackCount: Number(album.nb_tracks) || 0,
    link: album.link || '',
  }
}
function relatedOf(item) {
  if (!item?.id || !item.name) return null
  return { id: `deezer-${item.id}`, name: item.name, image: item.picture_medium || item.picture_big || '', fans: Number(item.nb_fan) || 0, link: item.link || '' }
}
function mergeTrack(youtube, deezer, artistName) {
  return {
    ...youtube,
    title: deezer.title || youtube.title,
    artist: artistName || youtube.artist,
    artwork: coverOf(deezer.album) || youtube.artwork,
    duration: Number(youtube.duration) || Number(deezer.duration) || undefined,
    preview: false,
  }
}

export async function buildArtistPage({ name, deezerId }) {
  const key = String(deezerId || name || '').toLocaleLowerCase().trim()
  const cached = pageCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  const artist = await resolveDeezerArtist(name, deezerId)
  const [albums, related] = await Promise.all([
    deezerArtistAlbums(artist.id).catch(() => ({ data: [] })),
    deezerArtistRelated(artist.id).catch(() => ({ data: [] })),
  ])
  const releases = (albums.data || []).map(releaseOf).filter(Boolean)
  const seen = new Set()
  const uniqueReleases = releases.filter(release => {
    const fingerprint = `${normalize(release.title)}|${release.type}`
    if (seen.has(fingerprint)) return false
    seen.add(fingerprint)
    return true
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const data = {
    artist: {
      id: `deezer-${artist.id}`,
      aliasId: findCuratedByName(artist.name)?.id || '',
      deezerId: artist.id,
      name: artist.name,
      image: artist.picture_xl || artist.picture_big || artist.picture_medium || '',
      fans: Number(artist.nb_fan) || 0,
      albums: Number(artist.nb_album) || uniqueReleases.length,
      link: artist.link || '',
    },
    releases: uniqueReleases,
    related: (related.data || []).map(relatedOf).filter(Boolean).slice(0, 12),
  }
  prune(pageCache, 80)
  pageCache.set(key, { data, expires: Date.now() + cacheTtl })
  return data
}

function mixTracks(lists, count) {
  const seenId = new Set()
  const seenKey = new Set()
  const queues = lists.map(list => Array.isArray(list) ? list.slice() : [])
  const result = []
  let stalled = 0
  while (result.length < count && stalled < 20) {
    let progressed = false
    for (const queue of queues) {
      while (queue.length) {
        const track = queue.shift()
        if (!track || seenId.has(track.id)) continue
        const key = `${normalize(track.artist)}|${normalize(track.title)}`
        if (seenKey.has(key)) continue
        seenId.add(track.id); seenKey.add(key)
        result.push(track); progressed = true
        break
      }
      if (result.length >= count) break
    }
    stalled = progressed ? 0 : stalled + 1
  }
  return result
}

export async function buildArtistTracks({ name, deezerId, source = 'all' }) {
  const wanted = ['all', 'youtube', 'yandex', 'vk'].includes(source) ? source : 'all'
  if (wanted === 'vk' && !vkEnabled()) throw new Error('Для ВКонтакте добавьте VK_ACCESS_TOKEN в .env')
  const key = `${String(deezerId || name || '').toLocaleLowerCase().trim()}|${wanted}`
  const cached = tracksCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  const artist = await resolveDeezerArtist(name, deezerId)
  const wantYoutube = wanted === 'all' || wanted === 'youtube'
  const yandexArtistTracks = () => searchYandexArtist(artist.name, 34)
    .catch(() => [])
    .then(list => list.length ? list : searchYandex(artist.name, 34).catch(() => []))
  const [top, searched, artistSearch, titleSearch, yandexList, vkList] = await Promise.all([
    wantYoutube ? deezerArtistTop(artist.id).catch(() => ({ data: [] })) : { data: [] },
    wantYoutube ? deezerSearchTracks(artist.name).catch(() => ({ data: [] })) : { data: [] },
    wantYoutube ? searchYouTube(artist.name, { limit: 30, mode: 'artist', timeout: 22000 }).catch(() => []) : [],
    wantYoutube ? searchYouTube(artist.name, { limit: 30, mode: 'title', timeout: 22000 }).catch(() => []) : [],
    wanted === 'all' || wanted === 'yandex' ? yandexArtistTracks() : [],
    wanted === 'all' || wanted === 'vk' ? searchVk(artist.name, 30, 'artist').catch(() => []) : [],
  ])
  const youtube = []
  const seenYouTube = new Set()
  for (const track of [...artistSearch, ...titleSearch]) {
    if (!track || seenYouTube.has(track.id)) continue
    seenYouTube.add(track.id)
    youtube.push(track)
  }
  const popular = [...new Map([...(top.data || []), ...(searched.data || []).filter(item => item.artist?.id === artist.id)].map(item => [item.id, item])).values()]
    .sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0))
  const used = new Set()
  const tracks = []
  for (const item of popular) {
    let best = null
    let bestScore = 0
    for (const candidate of youtube) {
      if (used.has(candidate.id)) continue
      const score = titleScore(item.title, candidate.title) + artistScore(artist.name, candidate.artist) * .35 + (item.duration && candidate.duration && Math.abs(item.duration - candidate.duration) < 14 ? 12 : 0)
      if (score > bestScore) { best = candidate; bestScore = score }
    }
    if (best && bestScore >= 46) {
      used.add(best.id)
      tracks.push(mergeTrack(best, item, artist.name))
    }
    if (tracks.length >= 30) break
  }
  for (const candidate of youtube) {
    if (tracks.length >= 30) break
    if (used.has(candidate.id)) continue
    const score = artistScore(artist.name, candidate.artist)
    if (youtube.length > 4 && score < 12) continue
    used.add(candidate.id)
    tracks.push(candidate)
  }
  let list
  if (wanted === 'yandex') list = yandexList.slice(0, 34)
  else if (wanted === 'vk') list = vkList.slice(0, 34)
  else if (wanted === 'youtube') list = tracks
  else list = mixTracks([tracks, yandexList, vkList], 40)
  if (!list.length) throw new Error(wanted === 'vk' ? 'ВКонтакте не отдал треки этого исполнителя' : 'Для этого исполнителя пока нет доступных треков')
  const data = { artistId: `deezer-${artist.id}`, deezerId: artist.id, tracks: list, previews: false, source: wanted }
  prune(tracksCache, 80)
  tracksCache.set(key, { data, expires: Date.now() + cacheTtl })
  return data
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index]).catch(() => null)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function buildReleaseTracks({ albumId, artist }) {
  if (!/^\d{1,20}$/.test(String(albumId || ''))) throw new Error('Неверный релиз')
  const key = String(albumId)
  const cached = releaseCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  const album = await deezerAlbum(albumId)
  const artistName = String(artist || '').trim() || album.artist?.name || ''
  const release = releaseOf(album)
  const albumTracks = (album.tracks?.data || []).slice(0, 60)
  const [searched, artistTracks] = await Promise.all([
    searchYouTube(`${album.title} ${artistName}`.trim(), { limit: 40, mode: 'title', timeout: 18000 }).catch(() => []),
    buildArtistTracks({ name: artistName, deezerId: album.artist?.id }).catch(() => null),
  ])
  const youtube = [...new Map([...searched, ...((artistTracks?.tracks || []).filter(track => track.source === 'youtube'))].map(track => [track.id, track])).values()]
  const used = new Set()
  const matches = new Map()
  const pick = (item, pool) => {
    let best = null
    let bestScore = 0
    for (const candidate of pool) {
      if (used.has(candidate.id)) continue
      const score = titleScore(item.title, candidate.title) + (item.duration && candidate.duration && Math.abs(item.duration - candidate.duration) < 14 ? 12 : 0)
      if (score > bestScore) { best = candidate; bestScore = score }
    }
    return best && bestScore >= 46 ? best : null
  }
  for (const item of albumTracks) {
    const best = pick(item, youtube)
    if (best) { used.add(best.id); matches.set(item.id, best) }
  }
  const missing = albumTracks.filter(item => !matches.has(item.id))
  const year = yearOf(album.release_date) || 0
  const recent = year >= new Date().getFullYear() - 2
  if (missing.length && (recent || youtube.length < 8) && missing.length <= 18) {
    const extra = await mapLimit(missing, 4, async item => {
      const found = await searchYouTube(`${artistName} ${item.title}`.trim(), { limit: 4, mode: 'title', timeout: 9000 }).catch(() => [])
      const best = pick(item, found)
      return best ? { item, best } : null
    })
    for (const hit of extra) if (hit && !used.has(hit.best.id)) { used.add(hit.best.id); matches.set(hit.item.id, hit.best) }
  }
  const tracks = []
  for (const item of albumTracks) {
    const best = matches.get(item.id)
    if (best) tracks.push(mergeTrack(best, item, artistName))
  }
  const data = { release, tracks, previews: false, previewCount: 0, source: 'youtube' }
  prune(releaseCache, 60)
  releaseCache.set(key, { data, expires: Date.now() + 15 * 60_000 })
  return data
}
