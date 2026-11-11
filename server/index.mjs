import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { Readable } from 'node:stream'
import { accountRoute, sharedMoment } from './accounts.mjs'
import { archiveDownload } from './archive.mjs'
import { cacheTrack, listCached, openCached, removeCached } from './offline.mjs'
import { buildArtistPage, buildArtistTracks, buildReleaseTracks } from './artistpage.mjs'
import { discoverArtists, lookupArtists, relatedArtists } from './artists.mjs'
import { resolveDeezerArtist, sameArtistName, searchArtistEntities } from './deezer.mjs'
import { probeVkToken, searchVk, vkEnabled, vkIssue, vkStream, vkStreamById } from './vk.mjs'
import { searchYandex, searchYandexGenre, yandexFull, yandexStream } from './yandex.mjs'
import { importPlaylist, recommendCollection, recommendMix, recommendTracks, searchYouTube, searchYouTubePlaylists, warmYouTubeStream, youtubeStream, ytdlp } from './ytdlp.mjs'
import { clearYouTubeAuth, setYouTubeAuth, testYouTubeAuth, youtubeAuthStatus } from './youtubeAuth.mjs'
import { integrationsStatus, saveIntegrations } from './integrations.mjs'

const port = Number(process.env.PORT || 8787)
const dist = resolve('dist')
let token = null
let tokenExpires = 0
let refreshToken = null
let pendingToken = null
const followingCache = new Map()
let artistPhotoCache = { expires: 0, photos: {} }
const artistNames = { 'the-weeknd': 'The Weeknd', 'billie-eilish': 'Billie Eilish', 'daft-punk': 'Daft Punk', 'arctic-monkeys': 'Arctic Monkeys', 'kendrick-lamar': 'Kendrick Lamar', 'lana-del-rey': 'Lana Del Rey', 'tyler-the-creator': 'Tyler, the Creator', 'tame-impala': 'Tame Impala', 'dua-lipa': 'Dua Lipa', radiohead: 'Radiohead', 'frank-ocean': 'Frank Ocean', 'fred-again': 'Fred Again', oasis: 'Oasis (band)', sza: 'SZA', gorillaz: 'Gorillaz', 'charli-xcx': 'Charli XCX', 'aphex-twin': 'Aphex Twin', 'massive-attack': 'Massive Attack', drake: 'Drake (musician)', 'kanye-west': 'Kanye West', 'nina-simone': 'Nina Simone', 'miles-davis': 'Miles Davis', 'hans-zimmer': 'Hans Zimmer', 'nils-frahm': 'Nils Frahm', bonobo: 'Bonobo (musician)', flume: 'Flume (musician)', bicep: 'Bicep (duo)', 'four-tet': 'Four Tet', metallica: 'Metallica', paramore: 'Paramore', m83: 'M83 (band)', 'men-i-trust': 'Men I Trust', joji: 'Joji (musician)', 'mac-miller': 'Mac Miller', 'molchat-doma': 'Molchat Doma', scriptonite: 'Scriptonite', monetochka: 'Monetochka (singer)', 'kedr-livanskiy': 'Kedr Livanskiy', ic3peak: 'IC3PEAK', zemfira: 'Zemfira' }
async function getArtistPhotos() {
  if (artistPhotoCache.expires > Date.now()) return artistPhotoCache.photos
  const titles = [...new Set(Object.values(artistNames))]
  const target = new URL('https://en.wikipedia.org/w/api.php')
  target.search = new URLSearchParams({ action: 'query', titles: titles.join('|'), prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '320', redirects: '1', format: 'json' }).toString()
  const response = await fetch(target, { headers: { 'user-agent': 'KinetixPlayer/1.0 (artist portraits; contact via repository)' }, signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error('Wikipedia photos unavailable')
  const data = await response.json()
  const pages = Object.values(data.query?.pages || {})
  const byTitle = new Map(pages.map(page => [page.title?.toLowerCase(), page]))
  const photos = Object.fromEntries(Object.entries(artistNames).map(([id, title]) => {
    const page = byTitle.get(title.toLowerCase())
    return [id, page?.thumbnail?.source ? { url: page.thumbnail.source, source: page.pageimage && page.thumbnail.source.includes('/wikipedia/commons/') ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage.replace(/^File:/, ''))}` : `https://en.wikipedia.org/?curid=${page.pageid}` } : null]
  }))
  artistPhotoCache = { expires: Date.now() + 24 * 60 * 60_000, photos }
  return photos
}

const catalogPhotoCache = new Map()
const catalogPhotoPending = new Map()
const artistImageCache = new Map()
let catalogPhotoStarts = []
async function catalogPhotoSlot() {
  for (;;) {
    const now = Date.now()
    catalogPhotoStarts = catalogPhotoStarts.filter(time => now - time < 1000)
    if (catalogPhotoStarts.length < 8) { catalogPhotoStarts.push(now); return }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
async function catalogArtistPhoto(name) {
  const key = String(name || '').trim().toLowerCase().slice(0, 80)
  if (!key) return null
  const cached = catalogPhotoCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.url
  const inflight = catalogPhotoPending.get(key)
  if (inflight) return inflight
  const task = (async () => {
    try {
      await catalogPhotoSlot()
      const artist = await resolveDeezerArtist(name)
      // Only trust a portrait when Deezer resolved the exact same artist name; otherwise show a monogram.
      if (!sameArtistName(artist.name, name)) {
        catalogPhotoCache.set(key, { url: null, expires: Date.now() + 60 * 60_000 })
        return null
      }
      const url = artist.picture_xl || artist.picture_big || artist.picture_medium || null
      if (!url || !/^https:\/\/[^/]+\.dzcdn\.net\//i.test(url)) {
        catalogPhotoCache.set(key, { url: null, expires: Date.now() + 60 * 60_000 })
        return null
      }
      catalogPhotoCache.set(key, { url, expires: Date.now() + 7 * 24 * 60 * 60_000 })
      return url
    } catch {
      catalogPhotoCache.set(key, { url: null, expires: Date.now() + 60 * 60_000 })
      return null
    } finally {
      catalogPhotoPending.delete(key)
    }
  })()
  catalogPhotoPending.set(key, task)
  return task
}

function json(res, status, value) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(value)) }
async function readJson(req) {
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > 512_000) throw new Error('Слишком большой запрос')
    chunks.push(chunk)
  }
  try { return Buffer.concat(chunks).toString('utf8') || '{}' } catch { throw new Error('Некорректный запрос') }
}
// CDNs throttle plain 200 media downloads, so upstream is always asked for a
// byte range. When the client did not send one we still answer with a 200 and
// the whole file length, exactly as a non-range request expects.
const upstreamRange = range => (range && String(range).trim()) || 'bytes=0-'
function proxyAudio(res, upstream, fallbackType, extra = {}, fullResponse = false) {
  const headers = { 'content-type': upstream.headers.get('content-type') || fallbackType || 'audio/mpeg', 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', ...extra }
  const names = fullResponse ? ['content-length'] : ['content-length', 'content-range']
  for (const name of names) { const value = upstream.headers.get(name); if (value) headers[name] = value }
  res.writeHead(fullResponse && upstream.status === 206 ? 200 : upstream.status, headers)
  if (!upstream.body) return res.end()
  Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res)
}
async function getToken() {
  if (token && Date.now() < tokenExpires - 60000) return token
  if (pendingToken) return pendingToken
  pendingToken = (async () => {
    const id = process.env.SOUNDCLOUD_CLIENT_ID
    const secret = process.env.SOUNDCLOUD_CLIENT_SECRET
    if (!id || !secret) throw new Error('SoundCloud credentials missing')
    const basic = Buffer.from(`${id}:${secret}`).toString('base64')
    const body = new URLSearchParams(refreshToken ? { grant_type: 'refresh_token', client_id: id, client_secret: secret, refresh_token: refreshToken } : { grant_type: 'client_credentials' })
    let response = await fetch('https://secure.soundcloud.com/oauth/token', { method: 'POST', headers: refreshToken ? { 'content-type': 'application/x-www-form-urlencoded' } : { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` }, body })
    if (!response.ok && refreshToken) { refreshToken = null; response = await fetch('https://secure.soundcloud.com/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${basic}` }, body: new URLSearchParams({ grant_type: 'client_credentials' }) }) }
    if (!response.ok) throw new Error(`SoundCloud authorization failed (${response.status})`)
    const data = await response.json()
    token = data.access_token
    refreshToken = data.refresh_token || null
    tokenExpires = Date.now() + (data.expires_in || 3600) * 1000
    return token
  })()
  try { return await pendingToken } finally { pendingToken = null }
}
const clean = s => String(s || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim()
function artistPlaceholder(name) {
  const letter = [...name.trim()][0]?.toUpperCase() || '?'
  const safe = letter.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  const hue = [...name].reduce((sum, ch) => sum + ch.codePointAt(0), 0) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,52%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},42%,20%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><text x="100" y="119" font-family="Inter,Arial,sans-serif" font-size="80" font-weight="700" fill="#fff" fill-opacity=".85" text-anchor="middle">${safe}</text></svg>`
}
const sendSvg = (res, svg) => {
  res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' })
  res.end(svg)
}
const withTimeout = (task, ms) => Promise.race([task, new Promise(resolve => setTimeout(() => resolve([]), ms))])
const genreCache = new Map()
const genreProfiles = {
  electronic: { label: 'Electronic', station: 'electronics', youtube: 'electronic music songs', local: 'электронная музыка', keywords: ['electronic', 'электрон'] },
  hiphop: { label: 'Hip Hop', station: 'rap', youtube: 'hip hop songs', local: 'хип-хоп', keywords: ['hip hop', 'hip-hop', 'хип-хоп', 'хипхоп', 'rap', 'рэп'] },
  indie: { label: 'Indie', station: 'indie', youtube: 'indie songs', local: 'инди музыка', keywords: ['indie', 'инди'] },
  pop: { label: 'Pop', station: 'pop', youtube: 'pop songs', local: 'поп музыка', keywords: ['pop', 'поп'] },
  rock: { label: 'Rock', station: 'allrock', youtube: 'rock songs', local: 'рок музыка', keywords: ['rock', 'рок'] },
  ambient: { label: 'Ambient', station: 'relax', youtube: 'ambient music', local: 'эмбиент музыка', keywords: ['ambient', 'эмбиент'] },
  house: { label: 'House', station: 'house', youtube: 'house music', local: 'хаус музыка', keywords: ['house', 'хаус'] },
  jazz: { label: 'Jazz', station: 'jazz', youtube: 'jazz standards', local: 'джаз', keywords: ['jazz', 'джаз'] },
  rnb: { label: 'R&B', station: 'rnb', youtube: 'r&b songs', local: 'r&b музыка', keywords: ['r&b', 'rnb', 'рнб'] },
  techno: { label: 'Techno', station: 'techno', youtube: 'techno music', local: 'техно музыка', keywords: ['techno', 'техно'] },
  classical: { label: 'Classical', station: 'classicalmusic', youtube: 'classical music', local: 'классическая музыка', keywords: ['classical', 'классик'] },
  lofi: { label: 'Lo-Fi', station: 'triphopgenre', youtube: 'lofi beats', local: 'lo-fi музыка', keywords: ['lofi', 'lo-fi', 'лоу-фай'] },
}
function genreNoise(track, profile) {
  const title = clean(track?.title)
  if (!title) return true
  const keywords = profile.keywords.map(clean).filter(Boolean)
  if (keywords.some(keyword => title === keyword)) return true
  return /(микс|mix|playlist|плейлист|сборник|compilation|подборка|best of|greatest hits|хиты|top \d+|топ)/i.test(title)
    && keywords.some(keyword => title.includes(keyword))
}
function interleaveGenreTracks(groups) {
  const seen = new Set()
  const tracks = []
  const longest = Math.max(0, ...groups.map(group => group.length))
  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      const track = group[index]
      if (!track?.title) continue
      const fingerprint = `${clean(track.artist)}|${clean(track.title)}`
      if (seen.has(fingerprint)) continue
      seen.add(fingerprint)
      tracks.push(track)
      if (tracks.length >= 60) return tracks
    }
  }
  return tracks
}
async function api(req, res, url) {
  if (await accountRoute(req, res, url)) return
  if (url.pathname === '/api/artists') { try { return json(res, 200, await discoverArtists({ genre: url.searchParams.get('genre') || 'all', language: url.searchParams.get('language') || 'all', cursor: url.searchParams.get('cursor') || '', query: url.searchParams.get('q') || '' })) } catch (error) { return json(res, 502, { error: error.message }) } }
  if (url.pathname === '/api/artists/lookup') { try { return json(res, 200, { artists: await lookupArtists((url.searchParams.get('ids') || '').split(',')) }) } catch (error) { return json(res, 502, { error: error.message }) } }
  if (url.pathname === '/api/artists/related') {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 120)
    const id = (url.searchParams.get('id') || '').replace(/^deezer-/, '').replace(/\D/g, '').slice(0, 20)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 8, 2), 12)
    if (!name && !id) return json(res, 400, { error: 'Укажите исполнителя' })
    try { return json(res, 200, await relatedArtists({ name, deezerId: id, limit })) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/artist-search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 100)
    if (!q) return json(res, 400, { error: 'Введите имя исполнителя' })
    try { return json(res, 200, { artists: await searchArtistEntities(q, { limit: 24 }) }) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/artist-page') {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 120)
    const id = (url.searchParams.get('id') || '').replace(/^deezer-/, '').replace(/\D/g, '').slice(0, 20)
    if (!name && !id) return json(res, 400, { error: 'Укажите исполнителя' })
    try { return json(res, 200, await buildArtistPage({ name, deezerId: id })) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/artist-tracks') {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 120)
    const id = (url.searchParams.get('id') || '').replace(/^deezer-/, '').replace(/\D/g, '').slice(0, 20)
    const requested = url.searchParams.get('source')
    const source = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    if (!name && !id) return json(res, 400, { error: 'Укажите исполнителя' })
    try { return json(res, 200, await buildArtistTracks({ name, deezerId: id, source })) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/artist-release') {
    const albumId = (url.searchParams.get('id') || '').replace(/\D/g, '').slice(0, 20)
    const artist = (url.searchParams.get('artist') || '').trim().slice(0, 120)
    if (!albumId) return json(res, 400, { error: 'Укажите релиз' })
    try { return json(res, 200, await buildReleaseTracks({ albumId, artist })) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/artist-photos') { try { return json(res, 200, { photos: await getArtistPhotos() }) } catch { return json(res, 200, { photos: {} }) } }
  if (url.pathname === '/api/artist-photo') {
    const name = (url.searchParams.get('name') || '').trim().slice(0, 80)
    if (!name) return json(res, 400, { error: 'Укажите исполнителя' })
    try {
      const photo = await catalogArtistPhoto(name)
      if (photo) {
        const cached = artistImageCache.get(photo)
        if (cached) {
          res.writeHead(200, { 'content-type': cached.type, 'content-length': String(cached.body.length), 'cache-control': 'public, max-age=604800' })
          return res.end(cached.body)
        }
        const upstream = await fetch(photo)
        if (upstream.ok) {
          const body = Buffer.from(await upstream.arrayBuffer())
          const type = upstream.headers.get('content-type') || 'image/jpeg'
          if (body.length && body.length < 3_000_000) {
            if (artistImageCache.size > 300) artistImageCache.clear()
            artistImageCache.set(photo, { type, body })
          }
          res.writeHead(200, { 'content-type': type, 'content-length': String(body.length), 'cache-control': 'public, max-age=604800' })
          return res.end(body)
        }
      }
    } catch {}
    return sendSvg(res, artistPlaceholder(name))
  }
  if (url.pathname === '/api/archive-download') {
    try {
      const { response, size } = await archiveDownload(url.searchParams.get('id') || '', url.searchParams.get('file') || '')
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(size), 'cache-control': 'private, no-store' })
      Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res)
    } catch (error) { return json(res, 400, { error: error.message }) }
    return
  }
  if (url.pathname === '/api/offline') {
    if (req.method === 'GET') { try { return json(res, 200, { tracks: await listCached() }) } catch (error) { return json(res, 500, { error: error.message }) } }
    if (req.method === 'POST') {
      let payload
      try { payload = JSON.parse(await readJson(req)) } catch (error) { return json(res, 400, { error: error.message || 'Некорректный запрос' }) }
      try { return json(res, 200, { track: await cacheTrack(payload?.track) }) } catch (error) { return json(res, 502, { error: error.message }) }
    }
    if (req.method === 'DELETE') {
      try { return json(res, 200, { track: await removeCached(url.searchParams.get('key') || '') }) } catch (error) { return json(res, 400, { error: error.message }) }
    }
    return json(res, 405, { error: 'Метод не поддерживается' })
  }
  if (url.pathname === '/api/offline/stream') {
    const opened = await openCached(url.searchParams.get('key') || '', req.headers.range)
    if (!opened) return json(res, 404, { error: 'Файл не найден в офлайн-кэше' })
    if (opened.invalid) { res.writeHead(416, { 'content-range': `bytes */${opened.size}` }); return res.end() }
    const length = opened.end - opened.start + 1
    res.writeHead(opened.status, { 'content-type': opened.type, 'content-length': String(length), 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=86400', ...(opened.status === 206 ? { 'content-range': `bytes ${opened.start}-${opened.end}/${opened.size}` } : {}) })
    opened.stream().on('error', () => res.destroy()).pipe(res)
    return
  }
  if (url.pathname === '/api/config') {
    let youtubeDl = false
    try { await ytdlp(); youtubeDl = true } catch {}
    return json(res, 200, { soundcloud: Boolean(process.env.SOUNDCLOUD_CLIENT_ID && process.env.SOUNDCLOUD_CLIENT_SECRET), archive: true, youtube: Boolean(process.env.YOUTUBE_API_KEY), youtubeDl, yandex: true, yandexFull: yandexFull(), vk: vkEnabled(), vkIssue: vkIssue(), offline: true, googleClientId: process.env.GOOGLE_CLIENT_ID || '', desktop: Boolean(process.env.KINETIX_DESKTOP), googleSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET) })
  }
  if (url.pathname === '/api/youtube-auth') {
    if (req.method === 'GET') { try { return json(res, 200, await youtubeAuthStatus()) } catch (error) { return json(res, 500, { error: error.message }) } }
    if (req.method === 'DELETE') { try { return json(res, 200, await clearYouTubeAuth()) } catch (error) { return json(res, 500, { error: error.message }) } }
    if (req.method === 'POST') {
      let payload
      try { payload = JSON.parse(await readJson(req)) } catch (error) { return json(res, 400, { error: error.message || 'Некорректный запрос' }) }
      try { return json(res, 200, await setYouTubeAuth(payload)) } catch (error) { return json(res, 400, { error: error.message }) }
    }
    return json(res, 405, { error: 'Метод не поддерживается' })
  }
  if (url.pathname === '/api/integrations') {
    if (req.method === 'GET') return json(res, 200, integrationsStatus())
    if (req.method === 'POST') {
      let payload
      try { payload = JSON.parse(await readJson(req)) } catch (error) { return json(res, 400, { error: error.message || 'Некорректный запрос' }) }
      try { return json(res, 200, await saveIntegrations(payload)) } catch (error) { return json(res, 400, { error: error.message }) }
    }
    return json(res, 405, { error: 'Метод не поддерживается' })
  }
  if (url.pathname === '/api/youtube-auth/test' && req.method === 'POST') {
    try { return json(res, 200, await testYouTubeAuth()) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/following') {
    const artists = (url.searchParams.get('artists') || '').split(',').map(name => name.trim()).filter(name => name && name.length <= 80).slice(0, 8)
    if (!artists.length) return json(res, 200, { tracks: [] })
    if (!process.env.SOUNDCLOUD_CLIENT_ID || !process.env.SOUNDCLOUD_CLIENT_SECRET) return json(res, 503, { error: 'Для отслеживания релизов нужны ключи SoundCloud' })
    const key = artists.join('|').toLowerCase()
    const cached = followingCache.get(key)
    if (cached && cached.expires > Date.now()) return json(res, 200, { tracks: cached.tracks })
    try {
      const accessToken = await getToken()
      const batches = await Promise.all(artists.map(async artist => {
        const target = new URL('https://api.soundcloud.com/tracks')
        target.search = new URLSearchParams({ q: artist, access: 'playable', limit: '30' }).toString()
        const response = await fetch(target, { headers: { authorization: `OAuth ${accessToken}`, accept: 'application/json; charset=utf-8' } })
        if (!response.ok) return []
        const data = await response.json()
        const entries = Array.isArray(data) ? data : data.collection || []
        return entries.filter(track => track.permalink_url && track.streamable !== false && (clean(track.metadata_artist || track.user?.username).includes(clean(artist)) || clean(track.title).includes(clean(artist))))
      }))
      const tracks = [...new Map(batches.flat().map(track => [track.id, track])).values()].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 24).map(track => ({ id: `sc:${track.id}`, title: track.title, artist: track.metadata_artist || track.user?.username || 'SoundCloud', artwork: track.artwork_url?.replace('-large', '-t500x500') || track.user?.avatar_url, url: track.permalink_url, duration: track.duration ? track.duration / 1000 : undefined, source: 'soundcloud' }))
      followingCache.set(key, { tracks, expires: Date.now() + 5 * 60_000 })
      return json(res, 200, { tracks })
    } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/genre') {
    const id = url.searchParams.get('genre') || ''
    const profile = genreProfiles[id]
    if (!profile) return json(res, 400, { error: 'Неизвестный жанр' })
    const mood = (url.searchParams.get('q') || '').trim().slice(0, 60)
    const refresh = url.searchParams.get('refresh') === '1'
    const requested = url.searchParams.get('source')
    const scope = ['all', 'local', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    const key = `${id}|${mood.toLocaleLowerCase()}|${scope}`
    const cached = genreCache.get(key)
    if (!refresh && cached && cached.expires > Date.now()) return json(res, 200, cached.data)
    const wantYoutube = scope === 'all' || scope === 'youtube'
    const wantYandex = scope === 'all' || scope === 'local' || scope === 'yandex'
    const wantVk = (scope === 'all' || scope === 'local' || scope === 'vk') && vkEnabled()
    const youtubeQuery = mood ? `${mood} music` : profile.youtube
    const localQuery = mood || profile.local
    const [rawYoutube, rawYandex, rawVk] = await Promise.all([
      wantYoutube ? withTimeout(searchYouTube(youtubeQuery, { limit: 30, mode: 'title', timeout: scope === 'youtube' ? 26000 : 12000 }).catch(error => { console.warn('Genre YouTube:', error.message); return [] }), scope === 'youtube' ? 28000 : 13000) : [],
      wantYandex ? withTimeout((mood
        ? searchYandex(localQuery, 24)
        : searchYandexGenre(profile.station, 30)
          .catch(error => { console.warn('Genre Yandex station:', error.message); return [] })
          .then(tracks => tracks.length ? tracks : searchYandex(profile.local, 24))
      ).catch(error => { console.warn('Genre Yandex:', error.message); return [] }), 16000) : [],
      wantVk ? withTimeout(searchVk(localQuery, 24, 'title').catch(error => { console.warn('Genre VK:', error.message); return [] }), 14000) : [],
    ])
    const youtube = rawYoutube.filter(track => !genreNoise(track, profile))
    const yandex = rawYandex.filter(track => !genreNoise(track, profile))
    const vk = rawVk.filter(track => !genreNoise(track, profile))
    const tracks = interleaveGenreTracks([youtube, yandex, vk])
    const data = { tracks, mood, sources: { youtube: youtube.length, yandex: yandex.length, vk: vkEnabled() ? vk.length : 0 } }
    if (!tracks.length && scope === 'all') return json(res, 502, { error: mood ? `По настроению «${mood}» ничего не нашлось` : 'Не удалось собрать треки жанра. Попробуйте ещё раз.' })
    if (genreCache.size > 160) genreCache.clear()
    genreCache.set(key, { data, expires: Date.now() + 8 * 60_000 })
    return json(res, 200, data)
  }
  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
    const mode = url.searchParams.get('mode') === 'artist' ? 'artist' : 'title'
    const requested = url.searchParams.get('source')
    const source = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    if (!q) return json(res, 400, { error: 'Введите запрос' })
    if (source === 'youtube') { try { return json(res, 200, { tracks: await searchYouTube(q, { limit: 30, mode }) }) } catch (error) { return json(res, 502, { error: error.message }) } }
    if (source === 'yandex') { try { return json(res, 200, { tracks: await searchYandex(q, 30) }) } catch (error) { return json(res, 502, { error: error.message }) } }
    if (source === 'vk') { try { return json(res, 200, { tracks: await searchVk(q, 30, mode) }) } catch (error) { return json(res, 502, { error: error.message }) } }
    const [youtube, yandex, vk] = await Promise.all([
      withTimeout(searchYouTube(q, { limit: 24, mode }).catch(error => { console.warn('YouTube search:', error.message); return [] }), 9000),
      withTimeout(searchYandex(q, 20).catch(error => { console.warn('Yandex search:', error.message); return [] }), 6000),
      vkEnabled() ? withTimeout(searchVk(q, 20, mode).catch(error => { console.warn('VK search:', error.message); return [] }), 6000) : Promise.resolve([]),
    ])
    return json(res, 200, { tracks: interleaveGenreTracks([youtube, yandex, vk]).slice(0, 60) })
  }
  if (url.pathname === '/api/playlist-search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 120)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 8, 1), 16)
    if (!q) return json(res, 400, { error: 'Введите запрос' })
    try { return json(res, 200, { playlists: await searchYouTubePlaylists(q, { limit }) }) }
    catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/playlist-import') {
    const target = (url.searchParams.get('url') || '').trim().slice(0, 1000)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 60, 1), 120)
    if (!target) return json(res, 400, { error: 'Вставьте ссылку на плейлист' })
    try { return json(res, 200, { playlist: await importPlaylist(target, { limit }) }) }
    catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/recommendations/collection' && req.method === 'POST') {
    let payload
    try { payload = JSON.parse(await readJson(req)) } catch (error) { return json(res, 400, { error: error.message || 'Некорректный запрос' }) }
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks.slice(0, 3).map(track => ({ id: String(track?.id || '').slice(0, 300), title: String(track?.title || '').slice(0, 160), artist: String(track?.artist || '').slice(0, 120) })).filter(track => track.title || track.artist) : []
    const limit = Math.min(Math.max(Number(payload?.limit) || 24, 8), 30)
    const requested = payload?.source
    const source = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    const refresh = Boolean(payload?.refresh)
    const avoid = Array.isArray(payload?.avoid) ? payload.avoid.slice(0, 60).map(item => ({ id: String(item?.id || '').slice(0, 300), title: String(item?.title || '').slice(0, 160), artist: String(item?.artist || '').slice(0, 120) })).filter(item => item.id || item.title) : []
    if (!tracks.length) return json(res, 400, { error: 'Добавьте треки в подборку' })
    try { return json(res, 200, await recommendCollection(tracks, { limit, refresh, source, avoid })) } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/recommendations/mix' && req.method === 'POST') {
    let payload
    try { payload = JSON.parse(await readJson(req)) } catch (error) { return json(res, 400, { error: error.message || 'Некорректный запрос' }) }
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks.slice(0, 40).map(track => ({ id: String(track?.id || '').slice(0, 300), title: String(track?.title || '').slice(0, 160), artist: String(track?.artist || '').slice(0, 120) })).filter(track => track.title || track.artist) : []
    const artists = Array.isArray(payload?.artists) ? payload.artists.slice(0, 20).map(name => String(name || '').slice(0, 120)).filter(Boolean) : []
    const excludeIds = Array.isArray(payload?.excludeIds) ? payload.excludeIds.slice(0, 500).map(id => String(id || '').slice(0, 300)).filter(Boolean) : []
    const knownArtists = Array.isArray(payload?.knownArtists) ? payload.knownArtists.slice(0, 100).map(name => String(name || '').slice(0, 120)).filter(Boolean) : []
    const avoid = Array.isArray(payload?.avoid) ? payload.avoid.slice(0, 60).map(item => ({ id: String(item?.id || '').slice(0, 300), title: String(item?.title || '').slice(0, 160), artist: String(item?.artist || '').slice(0, 120) })).filter(item => item.id || item.title) : []
    const limit = Math.min(Math.max(Number(payload?.limit) || 24, 8), 30)
    const requested = payload?.source
    const source = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    const refresh = Boolean(payload?.refresh)
    if (!tracks.length && !artists.length) return json(res, 400, { error: 'Добавь музыку в медиатеку или подпишись на исполнителей' })
    try { return json(res, 200, await recommendMix({ tracks, artists, excludeIds, knownArtists, avoid }, { limit, refresh, source })) }
    catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/recommendations') {
    const artist = (url.searchParams.get('artist') || '').trim().slice(0, 120)
    const title = (url.searchParams.get('title') || '').trim().slice(0, 160)
    const id = (url.searchParams.get('id') || '').trim().slice(0, 80)
    const scope = url.searchParams.get('scope') === 'artist' ? 'artist' : 'track'
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 24, 4), 30)
    const requested = url.searchParams.get('source')
    const source = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    const refresh = url.searchParams.get('refresh') === '1'
    let avoid = []
    try {
      const parsed = JSON.parse(url.searchParams.get('avoid') || '[]')
      if (Array.isArray(parsed)) avoid = parsed.slice(0, 60).map(item => ({ id: String(item?.id || '').slice(0, 300), title: String(item?.title || '').slice(0, 160), artist: String(item?.artist || '').slice(0, 120) })).filter(item => item.id || item.title)
    } catch { /* A malformed avoid list must not break recommendations. */ }
    if (!artist && !title && !id) return json(res, 400, { error: 'Нужен трек для рекомендаций' })
    try { return json(res, 200, await recommendTracks({ videoId: id, artist, title, scope, source, avoid }, { limit, refresh })) }
    catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/yt-search') {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 160)
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 40)
    const mode = url.searchParams.get('mode') === 'mix' ? 'title' : 'artist'
    const requested = url.searchParams.get('source')
    const source = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
    if (!q) return json(res, 400, { error: 'Введите исполнителя или подборку' })
    try {
      if (source === 'yandex') return json(res, 200, { tracks: await searchYandex(q, limit) })
      if (source === 'vk') return json(res, 200, { tracks: await searchVk(q, limit, mode === 'artist' ? 'artist' : 'title') })
      if (source === 'youtube') return json(res, 200, { tracks: await searchYouTube(q, { limit, mode }) })
      const [youtube, yandex, vk] = await Promise.all([
        searchYouTube(q, { limit, mode }).catch(() => []),
        searchYandex(q, limit).catch(() => []),
        vkEnabled() ? searchVk(q, limit, mode === 'artist' ? 'artist' : 'title').catch(() => []) : Promise.resolve([]),
      ])
      return json(res, 200, { tracks: interleaveGenreTracks([youtube, yandex, vk]).slice(0, limit) })
    } catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/yt-warm') {
    const videoId = url.searchParams.get('v') || ''
    if (!/^[\w-]{11}$/.test(videoId)) return json(res, 400, { error: 'Некорректный трек' })
    try { const entry = await warmYouTubeStream(videoId); return json(res, 200, { ok: true, type: entry.type }) }
    catch (error) { return json(res, 502, { error: error.message }) }
  }
  if (url.pathname === '/api/yt-stream') {
    const videoId = url.searchParams.get('v') || ''
    if (!/^[\w-]{11}$/.test(videoId)) return json(res, 400, { error: 'Некорректный трек' })
    try {
      const { response, type } = await youtubeStream(videoId, upstreamRange(req.headers.range))
      if (!response.ok && response.status !== 206) { const detail = await response.text().catch(() => ''); return json(res, 502, { error: `YouTube не отдал поток (${response.status}) ${detail.slice(0, 100)}` }) }
      proxyAudio(res, response, type, {}, !req.headers.range)
    } catch (error) { if (!res.headersSent) json(res, 502, { error: error.message }) }
    return
  }
  if (url.pathname === '/api/yandex-stream') {
    const trackId = (url.searchParams.get('id') || '').replace(/\D/g, '').slice(0, 20)
    if (!trackId) return json(res, 400, { error: 'Некорректный трек' })
    try {
      const { response, entry } = await yandexStream(trackId, upstreamRange(req.headers.range))
      if (!response.ok && response.status !== 206) return json(res, 502, { error: `Яндекс Музыка не отдала поток (${response.status})` })
      proxyAudio(res, response, entry.type, entry.preview ? { 'x-kinetix-preview': '1' } : {}, !req.headers.range)
    } catch (error) { if (!res.headersSent) json(res, 502, { error: error.message }) }
    return
  }
  if (url.pathname === '/api/vk-stream') {
    try {
      const id = url.searchParams.get('id') || ''
      const range = req.headers.range
      const response = id ? await vkStreamById(id, upstreamRange(range)) : await vkStream(url.searchParams.get('u'), upstreamRange(range))
      if (!response.ok && response.status !== 206) return json(res, 502, { error: `ВКонтакте не отдал поток (${response.status})` })
      proxyAudio(res, response, 'audio/mpeg', {}, !range)
    } catch (error) { if (!res.headersSent) json(res, 502, { error: error.message }) }
    return
  }
  if (url.pathname === '/api/video') {
    const artist = (url.searchParams.get('artist') || '').slice(0, 100)
    const title = (url.searchParams.get('title') || '').slice(0, 100)
    if (!process.env.YOUTUBE_API_KEY || !artist || !title) return json(res, 200, { url: null })
    try {
      const search = new URL('https://www.googleapis.com/youtube/v3/search')
      search.search = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: '5', q: `${artist} ${title} official music video`, key: process.env.YOUTUBE_API_KEY }).toString()
      const response = await fetch(search)
      if (!response.ok) return json(res, 200, { url: null })
      const data = await response.json()
      const match = (data.items || []).find(item => { const found = clean(item.snippet?.title); return found.includes(clean(artist)) && found.includes(clean(title)) && /official|music video|клип/i.test(found) })
      return json(res, 200, { url: match?.id?.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(match.id.videoId)}` : null })
    } catch { return json(res, 200, { url: null }) }
  }
  return json(res, 404, { error: 'Not found' })
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
async function staticFile(res, path) {
  const file = resolve(dist, `.${path}`)
  if (file !== dist && !file.startsWith(`${dist}${sep}`)) { res.writeHead(403); return res.end() }
  try { const item = await stat(file); if (item.isDirectory()) throw new Error('directory'); const body = await readFile(file); res.writeHead(200, { 'content-type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' }); res.end(body) } catch { try { const body = await readFile(resolve(dist, 'index.html')); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body) } catch { res.writeHead(404); res.end('Build the app first with npm run build') } }
}
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const stampTime = value => { const total = Math.max(0, Math.floor(Number(value) || 0)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` }
const shareStyles = `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(1200px 800px at 20% -10%,#1c2b12 0%,#0a0d08 52%,#070906 100%);color:#eef4e2;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.moment{position:relative;width:min(560px,100%);padding:26px 26px 22px;border:1px solid #ffffff14;border-radius:26px;background:linear-gradient(165deg,#141a10f2,#0b0e09f5);box-shadow:0 30px 90px #000a,inset 0 1px #ffffff0f;overflow:hidden}.glow{position:absolute;inset:-40% -20% auto;height:340px;background:radial-gradient(closest-side,#d7ff5726,transparent);pointer-events:none}.art{position:relative;width:100%;aspect-ratio:1;max-height:300px;object-fit:cover;border-radius:18px;border:1px solid #ffffff1a;box-shadow:0 18px 50px #0007;display:block;margin-bottom:20px}.eyebrow{position:relative;font-size:10px;font-weight:800;letter-spacing:1.6px;color:#d7ff57;text-transform:uppercase}.moment blockquote{position:relative;margin:16px 0 20px;display:grid;gap:9px;font-size:clamp(19px,4.6vw,25px);line-height:1.42;font-weight:600;letter-spacing:-.2px}.moment blockquote span{display:flex;gap:10px;align-items:baseline}.moment .time{flex:none;font-size:11px;font-weight:800;color:#a9bb8e;letter-spacing:.4px;font-variant-numeric:tabular-nums;padding-top:5px}.track{position:relative;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;padding-top:16px;border-top:1px solid #ffffff12}.track strong{font-size:15px}.track em{font-style:normal;font-size:12px;color:#9aa88a}.meta{position:relative;margin-top:6px;font-size:11px;color:#7f8c73}.cta{position:relative;display:inline-flex;align-items:center;justify-content:center;margin-top:20px;min-height:44px;padding:12px 20px;border-radius:12px;background:#d7ff57;color:#151a0c;font-size:12px;font-weight:800;text-decoration:none;letter-spacing:.4px}.watermark{position:relative;margin-top:26px;text-align:center;font-size:10px;letter-spacing:.55em;text-transform:lowercase;color:#eef4e2;opacity:.13;user-select:none}.missing{width:min(420px,100%);text-align:center}.missing h1{font-size:24px;margin:0 0 8px}.missing p{color:#93a184;font-size:13px;margin:0 0 20px}`
function shareHtml(shared, origin) {
  const { moment, owner } = shared
  const first = moment.lines?.[0]?.text || moment.track.title
  const withTime = (moment.lines || []).some(line => Number(line.at) > 0)
  const title = `«${first}» — ${moment.track.artist} · Kinetix`
  const description = `Момент из «${moment.track.title}» · ${moment.track.artist}`
  const artwork = /^https:\/\//.test(String(moment.track.artwork || '')) ? moment.track.artwork : ''
  const date = new Date(moment.createdAt || Date.now()).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"/>
<meta property="og:type" content="article"/><meta property="og:site_name" content="Kinetix"/>
<meta property="og:title" content="${escapeHtml(`«${first}» — ${moment.track.artist}`)}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:url" content="${escapeHtml(origin)}/m/${escapeHtml(moment.shareToken)}"/>
${artwork ? `<meta property="og:image" content="${escapeHtml(artwork)}"/><meta name="twitter:image" content="${escapeHtml(artwork)}"/>` : ''}
<meta name="twitter:card" content="${artwork ? 'summary_large_image' : 'summary'}"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/><meta name="twitter:description" content="${escapeHtml(description)}"/>
<style>${shareStyles}</style></head><body><main class="moment"><div class="glow"></div>
${artwork ? `<img class="art" src="${escapeHtml(artwork)}" alt="${escapeHtml(moment.track.title)}"/>` : ''}
<div class="eyebrow">МОМЕНТ · KINETIX</div>
<blockquote>${(moment.lines || []).map(line => `<span>${withTime ? `<i class="time">${stampTime(line.at)}</i>` : ''}<b>${escapeHtml(line.text)}</b></span>`).join('')}</blockquote>
<div class="track"><strong>${escapeHtml(moment.track.title)}</strong><em>${escapeHtml(moment.track.artist)}</em></div>
<div class="meta">${escapeHtml(owner?.name || 'Слушатель')} сохранил(а) этот момент · ${escapeHtml(date)}</div>
<a class="cta" href="/">Открыть Kinetix →</a>
<div class="watermark">kinetix</div>
</main></body></html>`
}
function missingShareHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Момент не найден · Kinetix</title><style>${shareStyles}</style></head><body><main class="moment missing"><div class="glow"></div><div class="eyebrow">KINETIX</div><h1 style="margin-top:14px">Этот момент не найден.</h1><p>Возможно, владелец удалил его или ссылка устарела.</p><a class="cta" href="/">Открыть Kinetix →</a><div class="watermark">kinetix</div></main></body></html>`
}
async function shareRoute(req, res, url) {
  const token = url.pathname.slice('/m/'.length).replace(/\/+$/, '')
  const shared = /^[a-f0-9]{16,64}$/.test(token) ? await sharedMoment(token).catch(() => null) : null
  const protocol = req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')
  const html = shared ? shareHtml(shared, `${protocol}://${req.headers.host || `localhost:${port}`}`) : missingShareHtml()
  res.writeHead(shared ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': shared ? 'public, max-age=300' : 'no-store' })
  res.end(html)
}
http.createServer((req, res) => { const url = new URL(req.url, `http://localhost:${port}`); if (url.pathname.startsWith('/api/')) api(req, res, url); else if (url.pathname.startsWith('/m/')) shareRoute(req, res, url).catch(() => { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Ошибка страницы') }); else staticFile(res, url.pathname) }).listen(port, process.env.KINETIX_HOST || undefined, () => { console.log(`Kinetix API / production server: http://localhost:${port}`); setTimeout(() => { probeVkToken().catch(() => {}) }, 1500) })
