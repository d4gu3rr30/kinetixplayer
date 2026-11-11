import { isAndroid, isIOS } from './platform'
import { artists as catalogArtists } from './catalog'
import type { Playlist, Track } from './types'

type MomentRecord = {
  id: string
  lines: { at: number; text: string }[]
  track: { id: string; title: string; artist: string; artwork: string; url: string; duration: number }
  createdAt: string
  shareToken?: string
}

type Account = {
  id: string
  email: string
  name: string
  status: string
  statusTrack: Track | null
  avatar: string
  artists: string[]
  moments: MomentRecord[]
  playlists: Playlist[]
  createdAt: string
}

type ArtistEntry = {
  id: string
  name: string
  tags: string[]
  tint: string
  language: string
  description: string
  popularity: number
}

type Avoid = { id?: string; title?: string; artist?: string }
type DeezerArtist = { id: number; name: string; picture_xl?: string; picture_big?: string; picture_medium?: string; nb_fan?: number; nb_album?: number; link?: string }

declare global {
  interface Window {
    kinetixAndroid?: { saveFile?: (name: string, mime: string, base64: string) => string; nowPlaying?: (payload: string) => void }
    __kinetixAndroidBack?: () => boolean
  }
}

const originalFetch = window.fetch.bind(window)
const ACCOUNT_KEY = 'kinetix:android-account:v1'
const nativePaths = new Set(['/api/config', '/api/health', '/api/yt-related', '/api/yt-warm', '/api/yt-stream', '/api/artist-photo',
  '/api/integrations', '/api/youtube-auth', '/api/youtube-auth/test',
  '/api/vk-search', '/api/yandex-search', '/api/vk-stream', '/api/yandex-stream'])

const PALETTE = ['#9b545d', '#607b6c', '#c49b5a', '#84736f', '#95705c', '#a0879b', '#bd9956', '#8277ac', '#b97684', '#778899', '#769c82', '#6f91a7', '#967f73', '#b58368', '#798e93', '#a3af4e']
const tagLabels: Record<string, string> = { hiphop: 'рэп', pop: 'поп', rock: 'рок', indie: 'инди', electronic: 'электроника', phonk: 'фонк', rnb: 'R&B', jazz: 'джаз', ambient: 'эмбиент', classical: 'классика', lofi: 'lo-fi', house: 'хаус', techno: 'техно' }
const GENRES: Record<string, string> = {
  electronic: 'electronic music songs',
  hiphop: 'hip hop songs',
  indie: 'indie songs',
  pop: 'pop songs',
  rock: 'rock songs',
  ambient: 'ambient music',
  house: 'house music',
  jazz: 'jazz standards',
  rnb: 'r&b songs',
  techno: 'techno music',
  classical: 'classical music',
  lofi: 'lofi beats',
  phonk: 'phonk music',
}

const CURATED: ArtistEntry[] = `kamz0ner|KAMZ0NER|hiphop,phonk|ru
kishlak|Кишлак|hiphop,indie|ru
ushira|ushira|hiphop,indie|ru
big-baby-tape|Big Baby Tape|hiphop|ru
kizaru|kizaru|hiphop|ru
boulevard-depo|Boulevard Depo|hiphop|ru
face|FACE|hiphop,rock|ru
gone-fludd|GONE.Fludd|hiphop|ru
saluki|SALUKI|hiphop,indie|ru
9mice|9mice|hiphop|ru
kai-angel|Kai Angel|hiphop|ru
lil-krystalll|LIL KRYSTALLL|hiphop|ru
molodoy-platon|Молодой Платон|hiphop|ru
obladaet|OBLADAET|hiphop|ru
toxi|Toxi$|hiphop|ru
lovv66|Lovv66|pop,hiphop|ru
dabbackwood|dabbackwood|hiphop,phonk|ru
serega-pirat|СЕРЕГА ПИРАТ|hiphop|ru
dzhizus|Джизус|hiphop,indie|ru
mukka|МУККА|pop,indie|ru
krasnoe-derevo|Красное дерево|hiphop|ru
smetana|Сметана|rock,indie|ru
kuok|Куок|hiphop|ru
skriptonit|Скриптонит|hiphop,rnb|ru
oxxxymiron|Oxxxymiron|hiphop|ru
miyagi-andy-panda|Miyagi & Andy Panda|hiphop,pop|ru
basta|Баста|hiphop|ru
lsp|LSP|hiphop,pop|ru
tri-dnya-dozhdya|Три дня дождя|indie,pop|ru
macan|MACAN|hiphop|ru
the-limba|The Limba|hiphop,pop|ru
rauf-faik|Rauf & Faik|rnb,pop|ru
jakone|Jakone|hiphop|ru
10age|10AGE|hiphop,indie|ru
guf|Guf|hiphop|ru
khaski|Хаски|hiphop,indie|ru
atl|ATL|electronic,hiphop|ru
slava-kpss|Слава КПСС|hiphop|ru
eldzhey|Элджей|pop,hiphop|ru
instasamka|INSTASAMKA|pop,hiphop|ru
monetochka|Монеточка|pop,indie|ru
zivert|Zivert|pop|ru
anna-asti|Anna Asti|pop|ru
niletto|Niletto|pop|ru
gayazovs-brothers|Gayazovs Brothers|pop|ru
dzharo-hanza|Джаро & Ханза|pop|ru
artik-asti|Artik & Asti|rnb,pop|ru
klava-koka|Клава Кока|pop|ru
dava|DAVA|pop|ru
mot|Мот|pop,hiphop|ru
lolita|Лолита|pop|ru
olga-buzova|Ольга Бузова|pop|ru
vanya-dmitrienko|Ваня Дмитриенко|pop,indie|ru
mari-kraymbreri|Мари Краймбрери|pop|ru
dora|Дора|pop,indie|ru
kino|Кино|rock|ru
molchat-doma|Молчат Дома|indie,electronic|ru
zemfira|Земфира|rock,indie|ru
ssshhhiiittt|ssshhhiiittt!|indie,rock|ru
delfin|Дельфин|indie,electronic|ru
splin|Сплин|rock|ru
mumiy-troll|Мумий Тролль|rock|ru
nautilus|Наутилус Помпилиус|rock|ru
agata-kristi|Агата Кристи|rock|ru
ic3peak|IC3PEAK|electronic,indie|ru
kedr-livanskiy|Кедр Ливанский|electronic,indie|ru
grechka|Гречка|indie,pop|ru
dayte-tank|Дайте танк (!)|indie,rock|ru
poshlaya-molly|Пошлая Молли|pop,rock|ru
shortparis|Shortparis|indie,electronic|ru
dvrst|DVRST|phonk,electronic|ru
kaito-shoma|Kaito Shoma|phonk,electronic|ru
lxst-cxntury|LXST CXNTURY|phonk,electronic|ru
ghostface-playa|Ghostface Playa|phonk,electronic|ru
voj|VØJ|phonk,electronic|ru
narvent|Narvent|phonk,electronic|ru
zavet|Zavet|phonk,electronic|ru
the-weeknd|The Weeknd|pop,rnb|en
drake|Drake|hiphop,rnb|en
taylor-swift|Taylor Swift|pop|en
billie-eilish|Billie Eilish|pop,indie|en
kendrick-lamar|Kendrick Lamar|hiphop|en
bad-bunny|Bad Bunny|pop|en
dua-lipa|Dua Lipa|pop|en
ariana-grande|Ariana Grande|pop,rnb|en
travis-scott|Travis Scott|hiphop|en
post-malone|Post Malone|pop,hiphop|en
sza|SZA|rnb,pop|en
doja-cat|Doja Cat|pop,hiphop|en
olivia-rodrigo|Olivia Rodrigo|pop,rock|en
sabrina-carpenter|Sabrina Carpenter|pop|en
charli-xcx|Charli xcx|pop,electronic|en
playboi-carti|Playboi Carti|hiphop|en
metallica|Metallica|rock|en
nirvana|Nirvana|rock|en
linkin-park|Linkin Park|rock|en
radiohead|Radiohead|rock,indie|en
arctic-monkeys|Arctic Monkeys|indie,rock|en
muse|Muse|rock|en
system-of-a-down|System of a Down|rock|en
rammstein|Rammstein|rock|en
bring-me-the-horizon|Bring Me The Horizon|rock|en
deftones|Deftones|rock|en
paramore|Paramore|rock,pop|en
twenty-one-pilots|Twenty One Pilots|rock,pop|en
kanye-west|Kanye West|hiphop|en
j-cole|J. Cole|hiphop|en
21-savage|21 Savage|hiphop|en
future|Future|hiphop|en
tyler-the-creator|Tyler, The Creator|hiphop,indie|en
asap-rocky|A$AP Rocky|hiphop|en
lil-baby|Lil Baby|hiphop|en
don-toliver|Don Toliver|hiphop,rnb|en
metro-boomin|Metro Boomin|hiphop|en
baby-keem|Baby Keem|hiphop|en
denzel-curry|Denzel Curry|hiphop|en
jpegmafia|JPEGMAFIA|hiphop,electronic|en
skrillex|Skrillex|electronic|en
fred-again|Fred again..|house,electronic|en
aphex-twin|Aphex Twin|electronic,ambient|en
four-tet|Four Tet|house,electronic|en
bicep|Bicep|techno,house|en
flume|Flume|electronic,pop|en
bonobo|Bonobo|ambient,house|en
nina-simone|Nina Simone|jazz,rnb|en
miles-davis|Miles Davis|jazz,ambient|en
hans-zimmer|Hans Zimmer|classical,ambient|en
nils-frahm|Nils Frahm|classical,ambient|en
men-i-trust|Men I Trust|indie,lofi|en
joji|Joji|rnb,lofi|en
mac-miller|Mac Miller|hiphop,jazz|en
daft-punk|Daft Punk|electronic,house|en
massive-attack|Massive Attack|electronic,ambient|en
oasis|Oasis|rock|en
frank-ocean|Frank Ocean|rnb,indie|en
lana-del-rey|Lana Del Rey|pop,indie|en
tame-impala|Tame Impala|indie,electronic|en
gorillaz|Gorillaz|indie,hiphop|en`.split('\n').map((line, index) => {
  const [slug, name, tags, language] = line.split('|')
  return { id: `artist-${slug}`, name, tags: tags.split(','), tint: PALETTE[hash(name) % PALETTE.length], language, description: tags.split(',').map(tag => tagLabels[tag] || tag).join(' · '), popularity: 100000 - index * 7 }
})

const registry = new Map<string, ArtistEntry>(CURATED.map(entry => [entry.id, entry]))
for (const artist of catalogArtists) {
  if (registry.has(artist.id)) continue
  registry.set(artist.id, { id: artist.id, name: artist.name, tags: artist.tags, tint: artist.tint, language: /[а-яё]/i.test(artist.name) ? 'ru' : 'en', description: artist.tags.map(tag => tagLabels[tag] || tag).join(' · '), popularity: 50000 })
}

function hash(value: string) { let result = 0; for (const char of String(value || '')) result = (result * 31 + char.codePointAt(0)!) >>> 0; return result }
function clean(value: unknown) { return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function normTitle(value: unknown) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(/\b(feat|ft|prod|remaster(ed)?|slowed|reverb|sped up|nightcore|official|video|audio|lyric(s)?|visualizer|clip|премьера|клип|версия)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
function words(value: unknown) { return new Set(normTitle(value).split(' ').filter(word => word.length > 2)) }
function titleScore(left: unknown, right: unknown) {
  const a = normTitle(left)
  const b = normTitle(right)
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
function artistScore(name: unknown, candidate: unknown) {
  const one = words(name)
  const two = words(candidate)
  let overlap = 0
  for (const word of one) if (two.has(word)) overlap++
  return Math.min(30, Math.round(overlap / Math.max(one.size, 1) * 30))
}
function fingerprint(track: { artist?: string; title?: string }) { return `${clean(track.artist)}|${clean(track.title)}` }
function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
function randomToken() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }

function send(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}
function fail(message: string, status = 400) { return send({ error: message }, status) }
function messageOf(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback }

async function deezer<T = Record<string, unknown>>(path: string): Promise<T> {
  const response = await originalFetch(`/__native/deezer?path=${encodeURIComponent(path)}`)
  const data = await response.json()
  if (!response.ok || (data && data.error)) throw new Error(typeof data?.error === 'string' ? data.error : 'Deezer недоступен')
  return data as T
}

async function ytSearch(query: string, limit = 20, mode: 'artist' | 'title' = 'title'): Promise<Track[]> {
  const params = new URLSearchParams({ q: query.slice(0, 160), limit: String(limit), mode })
  const response = await originalFetch(`/api/yt-search?${params}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'YouTube не ответил')
  return Array.isArray(data.tracks) ? data.tracks as Track[] : []
}
async function ytRelated(videoId: string, limit = 24): Promise<Track[]> {
  const response = await originalFetch(`/api/yt-related?v=${videoId}&limit=${limit}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'YouTube не ответил')
  return Array.isArray(data.tracks) ? data.tracks as Track[] : []
}
async function nativeSearch(path: '/api/vk-search' | '/api/yandex-search', query: string, limit: number, mode: 'artist' | 'title'): Promise<Track[]> {
  const params = new URLSearchParams({ q: query.slice(0, 160), limit: String(limit), mode })
  const response = await originalFetch(`${path}?${params}`)
  const data = await response.json()
  if (!response.ok) throw new Error(data?.error || 'Источник не ответил')
  return Array.isArray(data.tracks) ? data.tracks as Track[] : []
}
function vkSearch(query: string, limit = 20, mode: 'artist' | 'title' = 'title') { return nativeSearch('/api/vk-search', query, limit, mode) }
function yandexSearch(query: string, limit = 20) { return nativeSearch('/api/yandex-search', query, limit, 'title') }
function videoIdOf(track: { id?: string; url?: string }) {
  const id = String(track.id || '')
  if (id.startsWith('yt:') && /^[\w-]{11}$/.test(id.slice(3))) return id.slice(3)
  const url = String(track.url || '')
  const match = url.match(/[?&]v=([\w-]{11})/) || url.match(/youtu\.be\/([\w-]{11})/)
  return match ? match[1] : ''
}
function mergeTracks(...lists: Track[][]) {
  const seen = new Set<string>()
  const result: Track[] = []
  for (const list of lists) for (const track of list) {
    if (!track?.id || seen.has(track.id)) continue
    seen.add(track.id)
    result.push(track)
  }
  return result
}
function interleave(lists: Track[][], limit = 60) {
  const seen = new Set<string>()
  const result: Track[] = []
  const longest = Math.max(0, ...lists.map(list => list.length))
  for (let index = 0; index < longest && result.length < limit; index++) {
    for (const list of lists) {
      const track = list[index]
      if (!track?.id) continue
      const key = fingerprint(track)
      if (seen.has(track.id) || seen.has(`fp:${key}`)) continue
      seen.add(track.id)
      seen.add(`fp:${key}`)
      result.push(track)
      if (result.length >= limit) break
    }
  }
  return result
}
function parseAvoid(raw: string | null): Avoid[] {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, 60).map(item => ({ id: String(item?.id || '').slice(0, 300), title: String(item?.title || '').slice(0, 160), artist: String(item?.artist || '').slice(0, 120) })) : []
  } catch { return [] }
}
function isAvoided(track: Track, avoid: Avoid[]) {
  if (!avoid.length) return false
  const key = fingerprint(track)
  return avoid.some(item => (item.id && item.id === track.id) || (item.title && fingerprint({ artist: item.artist, title: item.title }) === key))
}
function genreNoise(track: Track, profile: string) {
  const title = String(track.title || '').toLocaleLowerCase()
  return /(микс|mix|playlist|плейлист|сборник|compilation|подборка|best of|greatest hits|хиты|top \d+|топ)/i.test(title) && profile.split(' ').some(word => word.length > 3 && title.includes(word))
}

function wallArtist(entry: ArtistEntry) {
  return { id: entry.id, name: entry.name, tags: entry.tags, tint: entry.tint, language: entry.language, description: entry.description, popularity: entry.popularity, image: `/api/artist-photo?name=${encodeURIComponent(entry.name)}`, imageSource: '' }
}
function deezerWallArtist(item: DeezerArtist) {
  const fans = Number(item.nb_fan) || 0
  const albums = Number(item.nb_album) || 0
  return { id: `deezer-${item.id}`, name: item.name, tags: ['all'], tint: PALETTE[hash(item.name) % PALETTE.length], language: 'all', popularity: fans, fans, albums, image: item.picture_xl || item.picture_big || item.picture_medium || '', imageSource: item.link || '', description: `${fans} слушателей · ${albums} релизов` }
}
function entryFor(id: string) {
  const entry = registry.get(id)
  if (entry) return entry
  const byName = CURATED.find(item => clean(item.name) === clean(id))
  return byName || null
}

async function artistsRoute(url: URL) {
  const genre = url.searchParams.get('genre') || 'all'
  const language = url.searchParams.get('language') || 'all'
  const query = (url.searchParams.get('q') || '').trim().slice(0, 80)
  const wanted = clean(query)
  let list = CURATED.filter(entry => {
    if (language !== 'all' && entry.language !== language) return false
    if (genre !== 'all' && !entry.tags.includes(genre)) return false
    if (wanted && !clean(entry.name).includes(wanted) && !clean(entry.name).split(' ').some(word => word.startsWith(wanted))) return false
    return true
  })
  if (wanted) {
    try {
      const found = await deezer<{ data?: DeezerArtist[] }>(`/search/artist?q=${encodeURIComponent(query)}&limit=24`)
      list = [...list, ...(found.data || []).map(item => ({ id: `deezer-${item.id}`, name: item.name, tags: ['all'], tint: PALETTE[hash(item.name) % PALETTE.length], language: 'all', description: '', popularity: Number(item.nb_fan) || 0 }))]
    } catch { /* The curated wall stays usable without Deezer. */ }
  }
  const seen = new Set<string>()
  const artists = list.filter(entry => { const key = clean(entry.name); if (!key || seen.has(key)) return false; seen.add(key); return true }).sort((a, b) => b.popularity - a.popularity).map(wallArtist)
  return send({ artists, cursor: null })
}

async function artistSearchRoute(url: URL) {
  const query = (url.searchParams.get('q') || '').trim().slice(0, 100)
  if (!query) return fail('Введите имя исполнителя')
  try {
    const found = await deezer<{ data?: DeezerArtist[] }>(`/search/artist?q=${encodeURIComponent(query)}&limit=24`)
    return send({ artists: (found.data || []).filter(item => item?.id && item.name).map(deezerWallArtist) })
  } catch (error) { return fail(messageOf(error, 'Не удалось найти исполнителей'), 502) }
}

async function relatedRoute(url: URL) {
  const name = (url.searchParams.get('name') || '').trim().slice(0, 120)
  const rawId = (url.searchParams.get('id') || '').replace(/^deezer-/, '').replace(/\D/g, '').slice(0, 20)
  const limit = clamp(Number(url.searchParams.get('limit')) || 8, 2, 12)
  try {
    const resolved = await resolveArtist(name, rawId)
    const related = await deezer<{ data?: DeezerArtist[] }>(`/artist/${resolved.id}/related?limit=${limit}`)
    return send({ artistId: `deezer-${resolved.id}`, artistName: resolved.name, artists: (related.data || []).slice(0, limit).filter(item => item?.id && item.name).map(item => ({ id: `deezer-${item.id}`, name: item.name, tags: ['all'], tint: PALETTE[hash(item.name) % PALETTE.length], language: 'all', image: item.picture_xl || item.picture_big || item.picture_medium || '', imageSource: item.link || '', description: `${Number(item.nb_fan) || 0} слушателей · ${Number(item.nb_album) || 0} релизов`, popularity: Number(item.nb_fan) || 0, fans: Number(item.nb_fan) || 0, albums: Number(item.nb_album) || 0 })) })
  } catch { return send({ artists: [] }) }
}

function lookupRoute(url: URL) {
  const ids = (url.searchParams.get('ids') || '').split(',').map(id => id.trim()).filter(Boolean)
  const artists = ids.map(id => entryFor(id)).filter((entry): entry is ArtistEntry => Boolean(entry)).map(wallArtist)
  return send({ artists })
}

async function photosRoute() {
  const photos: Record<string, { url: string; source: string }> = {}
  for (const entry of CURATED) photos[entry.id] = { url: `/api/artist-photo?name=${encodeURIComponent(entry.name)}`, source: '' }
  for (const artist of catalogArtists) if (!photos[artist.id]) photos[artist.id] = { url: `/api/artist-photo?name=${encodeURIComponent(artist.name)}`, source: '' }
  return send({ photos })
}

async function resolveArtist(name: string, id = ''): Promise<DeezerArtist> {
  if (/^\d{1,20}$/.test(id)) return deezer<DeezerArtist>(`/artist/${id}`)
  const raw = String(name || '').trim().slice(0, 120)
  if (!raw) throw new Error('Нужен исполнитель')
  const candidates = [...new Set([raw, raw.split(',')[0], raw.split('&')[0], raw.split(' feat')[0]].map(value => value.trim()).filter(Boolean))]
  const byFans = (a: DeezerArtist, b: DeezerArtist) => (Number(b.nb_fan) || 0) - (Number(a.nb_fan) || 0)
  let fallback: DeezerArtist | null = null
  for (const candidate of candidates) {
    const found = await deezer<{ data?: DeezerArtist[] }>(`/search/artist?q=${encodeURIComponent(candidate)}&limit=15`).catch(() => ({ data: [] }))
    const list = found.data || []
    if (!list.length) continue
    const key = clean(candidate)
    const exact = list.filter(item => clean(item.name) === key).sort(byFans)
    if (exact.length) return exact[0]
    const near = list.filter(item => { const value = clean(item.name); return value.includes(key) || key.includes(value) }).sort(byFans)
    if (near.length) return near[0]
    if (!fallback) fallback = list[0]
  }
  if (fallback) return fallback
  throw new Error('Исполнитель не найден в каталоге')
}

function coverOf(album: Record<string, unknown> | undefined) {
  return String(album?.cover_big || album?.cover_xl || album?.cover_medium || album?.cover || '')
}
function yearOf(value: unknown) { const year = Number(String(value || '').slice(0, 4)); return Number.isFinite(year) && year > 1900 && year < 2100 ? year : undefined }
function releaseOf(album: Record<string, unknown>) {
  if (!album?.id || !album.title) return null
  return { id: `deezer-${album.id}`, deezerId: Number(album.id), title: String(album.title), cover: coverOf(album), year: yearOf(album.release_date), date: String(album.release_date || ''), type: String(album.record_type || 'album'), trackCount: Number(album.nb_tracks) || 0, link: String(album.link || '') }
}
function mergeTrack(youtube: Track, deezerTrack: Record<string, unknown>, artistName: string): Track {
  const album = deezerTrack.album as Record<string, unknown> | undefined
  return { ...youtube, title: String(deezerTrack.title || youtube.title), artist: artistName || youtube.artist, artwork: coverOf(album) || youtube.artwork, duration: Number(youtube.duration) || Number(deezerTrack.duration) || undefined, preview: false }
}

async function artistPageRoute(url: URL) {
  const name = (url.searchParams.get('name') || '').trim().slice(0, 120)
  const id = (url.searchParams.get('id') || '').replace(/^deezer-/, '').replace(/\D/g, '').slice(0, 20)
  if (!name && !id) return fail('Укажите исполнителя')
  try {
    const artist = await resolveArtist(name, id)
    const [albums, related] = await Promise.all([
      deezer<{ data?: Record<string, unknown>[] }>(`/artist/${artist.id}/albums?limit=100`).catch(() => ({ data: [] })),
      deezer<{ data?: DeezerArtist[] }>(`/artist/${artist.id}/related?limit=12`).catch(() => ({ data: [] })),
    ])
    const seen = new Set<string>()
    const releases = (albums.data || []).map(releaseOf).filter((release): release is NonNullable<ReturnType<typeof releaseOf>> => Boolean(release)).filter(release => {
      const key = `${normTitle(release.title)}|${release.type}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    const alias = CURATED.find(entry => clean(entry.name) === clean(artist.name))
    return send({
      artist: { id: `deezer-${artist.id}`, aliasId: alias?.id || '', deezerId: artist.id, name: artist.name, image: artist.picture_xl || artist.picture_big || artist.picture_medium || '', fans: Number(artist.nb_fan) || 0, albums: Number(artist.nb_album) || releases.length, link: artist.link || '' },
      releases,
      related: (related.data || []).filter(item => item?.id && item.name).slice(0, 12).map(item => ({ id: `deezer-${item.id}`, name: item.name, image: item.picture_medium || item.picture_big || '', fans: Number(item.nb_fan) || 0, link: item.link || '' })),
    })
  } catch (error) { return fail(messageOf(error, 'Не удалось открыть исполнителя'), 502) }
}

async function artistTracksRoute(url: URL) {
  const name = (url.searchParams.get('name') || '').trim().slice(0, 120)
  const id = (url.searchParams.get('id') || '').replace(/^deezer-/, '').replace(/\D/g, '').slice(0, 20)
  if (!name && !id) return fail('Укажите исполнителя')
  try {
    const artist = await resolveArtist(name, id)
    const [top, searched, artistSearch, titleSearch] = await Promise.all([
      deezer<{ data?: Record<string, unknown>[] }>(`/artist/${artist.id}/top?limit=30`).catch(() => ({ data: [] })),
      deezer<{ data?: Record<string, unknown>[] }>(`/search/track?q=${encodeURIComponent(artist.name)}&limit=100`).catch(() => ({ data: [] })),
      ytSearch(artist.name, 30, 'artist').catch(() => []),
      ytSearch(artist.name, 30, 'title').catch(() => []),
    ])
    const youtube = mergeTracks(artistSearch, titleSearch)
    const popular = [...new Map([...(top.data || []), ...(searched.data || []).filter(item => (item.artist as { id?: number } | undefined)?.id === artist.id)].map(item => [String(item.id), item])).values()]
      .sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0))
    const used = new Set<string>()
    const tracks: Track[] = []
    for (const item of popular) {
      let best: Track | null = null
      let bestScore = 0
      for (const candidate of youtube) {
        if (used.has(candidate.id)) continue
        const score = titleScore(item.title, candidate.title) + artistScore(artist.name, candidate.artist) * .35 + (item.duration && candidate.duration && Math.abs(Number(item.duration) - candidate.duration) < 14 ? 12 : 0)
        if (score > bestScore) { best = candidate; bestScore = score }
      }
      if (best && bestScore >= 46) { used.add(best.id); tracks.push(mergeTrack(best, item, artist.name)) }
      if (tracks.length >= 30) break
    }
    for (const candidate of youtube) {
      if (tracks.length >= 30) break
      if (used.has(candidate.id)) continue
      if (youtube.length > 4 && artistScore(artist.name, candidate.artist) < 12) continue
      used.add(candidate.id)
      tracks.push(candidate)
    }
    const list = tracks.length ? tracks : youtube
    if (!list.length) return fail('Для этого исполнителя пока нет доступных треков', 502)
    return send({ artistId: `deezer-${artist.id}`, deezerId: artist.id, tracks: list.slice(0, 40), previews: false, source: 'youtube' })
  } catch (error) { return fail(messageOf(error, 'Не удалось собрать треки'), 502) }
}

async function artistReleaseRoute(url: URL) {
  const albumId = (url.searchParams.get('id') || '').replace(/\D/g, '').slice(0, 20)
  const artist = (url.searchParams.get('artist') || '').trim().slice(0, 120)
  if (!albumId) return fail('Укажите релиз')
  try {
    const album = await deezer<Record<string, unknown>>(`/album/${albumId}`)
    const artistName = artist || String((album.artist as { name?: string } | undefined)?.name || '')
    const release = releaseOf(album)
    if (!release) return fail('Релиз не найден', 404)
    const albumTracks = ((album.tracks as { data?: Record<string, unknown>[] } | undefined)?.data || []).slice(0, 60)
    const found = await ytSearch(`${String(album.title)} ${artistName}`.trim(), 40, 'title').catch(() => [])
    const used = new Set<string>()
    const tracks: Track[] = []
    for (const item of albumTracks) {
      let best: Track | null = null
      let bestScore = 0
      for (const candidate of found) {
        if (used.has(candidate.id)) continue
        const score = titleScore(item.title, candidate.title) + (item.duration && candidate.duration && Math.abs(Number(item.duration) - candidate.duration) < 14 ? 12 : 0)
        if (score > bestScore) { best = candidate; bestScore = score }
      }
      if (best && bestScore >= 46) { used.add(best.id); tracks.push(mergeTrack(best, item, artistName)) }
    }
    return send({ release, tracks, previews: false, previewCount: 0, source: 'youtube' })
  } catch (error) { return fail(messageOf(error, 'Не удалось открыть релиз'), 502) }
}

async function searchRoute(url: URL) {
  const query = (url.searchParams.get('q') || '').trim().slice(0, 160)
  const mode = url.searchParams.get('mode') === 'artist' ? 'artist' : 'title'
  const requested = url.searchParams.get('source') || ''
  const scope = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
  if (!query) return fail('Введите запрос')
  try {
    if (scope === 'youtube') return send({ tracks: await ytSearch(query, 30, mode) })
    if (scope === 'yandex') return send({ tracks: await yandexSearch(query, 30) })
    if (scope === 'vk') return send({ tracks: await vkSearch(query, 30, mode) })
    const settled = await Promise.allSettled([
      ytSearch(query, 24, mode),
      yandexSearch(query, 20),
      vkSearch(query, 20, mode),
    ])
    const tracks = interleave(settled.map(item => item.status === 'fulfilled' ? item.value : []), 60)
    if (!tracks.length) {
      const failed = settled.find(item => item.status === 'rejected')
      if (failed && failed.status === 'rejected') throw failed.reason
    }
    return send({ tracks })
  } catch (error) { return fail(messageOf(error, 'Не удалось выполнить поиск'), 502) }
}

async function ytSearchRoute(url: URL) {
  const query = (url.searchParams.get('q') || '').trim().slice(0, 160)
  const limit = clamp(Number(url.searchParams.get('limit')) || 30, 1, 40)
  const mode: 'artist' | 'title' = url.searchParams.get('mode') === 'mix' ? 'title' : 'artist'
  const requested = url.searchParams.get('source') || ''
  const scope = ['all', 'youtube', 'yandex', 'vk'].includes(requested) ? requested : 'all'
  if (!query) return fail('Введите исполнителя или подборку')
  try {
    if (scope === 'youtube') return send({ tracks: await ytSearch(query, limit, mode) })
    if (scope === 'yandex') return send({ tracks: await yandexSearch(query, limit) })
    if (scope === 'vk') return send({ tracks: await vkSearch(query, limit, mode) })
    const settled = await Promise.allSettled([
      ytSearch(query, limit, mode),
      yandexSearch(query, limit),
      vkSearch(query, limit, mode),
    ])
    const tracks = interleave(settled.map(item => item.status === 'fulfilled' ? item.value : []), limit)
    if (!tracks.length) {
      const failed = settled.find(item => item.status === 'rejected')
      if (failed && failed.status === 'rejected') throw failed.reason
    }
    return send({ tracks })
  } catch (error) { return fail(messageOf(error, 'Не удалось выполнить поиск'), 502) }
}

const genreCache = new Map<string, { data: unknown; expires: number }>()
async function genreRoute(url: URL) {
  const id = url.searchParams.get('genre') || ''
  const profile = GENRES[id]
  if (!profile) return fail('Неизвестный жанр')
  const mood = (url.searchParams.get('q') || '').trim().slice(0, 60)
  const requested = url.searchParams.get('source')
  const scope = ['all', 'local', 'youtube', 'yandex', 'vk'].includes(requested || '') ? requested! : 'all'
  const key = `${id}|${mood.toLocaleLowerCase()}|${scope}`
  const cached = genreCache.get(key)
  if (cached && cached.expires > Date.now()) return send(cached.data)
  try {
    const youtubeQuery = mood ? `${mood} music` : profile
    const localQuery = mood || profile
    const [rawYoutube, rawYandex, rawVk] = await Promise.all([
      scope === 'all' || scope === 'youtube' ? ytSearch(youtubeQuery, 30, 'title').catch(() => []) : Promise.resolve([]),
      scope === 'all' || scope === 'local' || scope === 'yandex' ? yandexSearch(localQuery, 24).catch(() => []) : Promise.resolve([]),
      scope === 'all' || scope === 'local' || scope === 'vk' ? vkSearch(localQuery, 24, 'title').catch(() => []) : Promise.resolve([]),
    ])
    const youtube = rawYoutube.filter(track => !genreNoise(track, profile))
    const yandex = rawYandex.filter(track => !genreNoise(track, profile))
    const vk = rawVk.filter(track => !genreNoise(track, profile))
    const tracks = interleave([youtube, yandex, vk])
    const data = { tracks, mood, sources: { youtube: youtube.length, yandex: yandex.length, vk: vk.length } }
    if (!tracks.length && scope === 'all') return fail(mood ? `По настроению «${mood}» ничего не нашлось` : 'Не удалось собрать треки жанра. Попробуйте ещё раз.', 502)
    if (genreCache.size > 60) genreCache.clear()
    genreCache.set(key, { data, expires: Date.now() + 6 * 60_000 })
    return send(data)
  } catch (error) { return fail(messageOf(error, 'Не удалось собрать треки жанра'), 502) }
}

async function recommendationsRoute(url: URL) {
  const artist = (url.searchParams.get('artist') || '').trim().slice(0, 120)
  const title = (url.searchParams.get('title') || '').trim().slice(0, 160)
  const id = (url.searchParams.get('id') || '').trim().slice(0, 80)
  const scope = url.searchParams.get('scope') === 'artist' ? 'artist' : 'track'
  const limit = clamp(Number(url.searchParams.get('limit')) || 24, 4, 30)
  const avoid = parseAvoid(url.searchParams.get('avoid'))
  if (!artist && !title && !id) return fail('Нужен трек для рекомендаций')
  const videoId = scope === 'track' ? videoIdOf({ id }) : ''
  const tasks: Promise<Track[]>[] = []
  if (videoId) tasks.push(ytRelated(videoId, Math.min(30, limit * 2)).catch(() => []))
  if (artist) tasks.push(ytSearch(`${artist}${scope === 'track' && title ? ` ${title}` : ''}`, Math.min(30, limit * 2), scope === 'artist' ? 'artist' : 'title').catch(() => []))
  const tracks = interleave(await Promise.all(tasks), 80).filter(track => !isAvoided(track, avoid)).slice(0, limit)
  if (!tracks.length) return fail('Не удалось собрать рекомендации. Попробуйте ещё раз.', 502)
  return send({ tracks })
}

async function recommendationMixRoute(body: Record<string, unknown>) {
  const tracks = Array.isArray(body?.tracks) ? body.tracks as { id?: string; artist?: string; title?: string }[] : []
  const artists = Array.isArray(body?.artists) ? body.artists.map(String).filter(Boolean).slice(0, 20) : []
  const exclude = new Set((Array.isArray(body?.excludeIds) ? body.excludeIds : []).map(String).slice(0, 500))
  const known = new Set((Array.isArray(body?.knownArtists) ? body.knownArtists : []).map(name => clean(name)).filter(Boolean))
  const avoid = Array.isArray(body?.avoid) ? body.avoid.slice(0, 60) as Avoid[] : []
  const limit = clamp(Number(body?.limit) || 24, 8, 30)
  if (!tracks.length && !artists.length) return fail('Добавь музыку в медиатеку или подпишись на исполнителей')
  const seeds = tracks.map(track => videoIdOf(track)).filter(Boolean).slice(0, 2)
  const names = [...new Set([...artists, ...tracks.map(track => String(track.artist || ''))].filter(Boolean))].slice(0, 5)
  const lists = await Promise.all([
    ...seeds.map(videoId => ytRelated(videoId, 24).catch(() => [])),
    ...names.slice(0, 3).map(name => ytSearch(name, 18, 'artist').catch(() => [])),
  ])
  const pool = interleave(lists, 120).filter(track => !exclude.has(track.id) && !isAvoided(track, avoid))
  if (!pool.length) return fail('Не удалось собрать микс. Попробуй ещё раз.', 502)
  const fresh = pool.filter(track => !known.has(clean(track.artist)))
  const familiar = pool.filter(track => known.has(clean(track.artist)))
  return send({ tracks: interleave([fresh, familiar], limit * 2).slice(0, limit) })
}

async function recommendationCollectionRoute(body: Record<string, unknown>) {
  const seeds = Array.isArray(body?.tracks) ? body.tracks.slice(0, 3) as { id?: string; artist?: string; title?: string }[] : []
  const avoid = Array.isArray(body?.avoid) ? body.avoid.slice(0, 60) as Avoid[] : []
  const limit = clamp(Number(body?.limit) || 24, 8, 30)
  if (!seeds.length) return fail('Добавьте треки в подборку')
  const tasks: Promise<Track[]>[] = []
  for (const seed of seeds) {
    const videoId = videoIdOf(seed)
    if (videoId) tasks.push(ytRelated(videoId, 20).catch(() => []))
    else if (seed.artist) tasks.push(ytSearch(`${seed.artist} ${seed.title || ''}`.trim(), 20, 'title').catch(() => []))
  }
  const tracks = interleave(await Promise.all(tasks), 80).filter(track => !isAvoided(track, avoid)).slice(0, limit)
  if (!tracks.length) return fail('Не удалось собрать поток по подборке. Попробуйте ещё раз.', 502)
  return send({ tracks })
}

function readAccount(): Account | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Account>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      id: String(parsed.id || randomId()),
      email: String(parsed.email || 'local@kinetix.app'),
      name: String(parsed.name || 'Слушатель').slice(0, 40),
      status: String(parsed.status || '').slice(0, 120),
      statusTrack: parsed.statusTrack || null,
      avatar: String(parsed.avatar || ''),
      artists: Array.isArray(parsed.artists) ? parsed.artists.filter(id => typeof id === 'string').slice(0, 50) : [],
      moments: Array.isArray(parsed.moments) ? parsed.moments.slice(0, 100) : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists.slice(0, 40) : [],
      createdAt: String(parsed.createdAt || new Date().toISOString()),
    }
  } catch { return null }
}
function writeAccount(account: Account) { try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account)) } catch { /* Storage is full: the session still works. */ } }
function ensureAccount(): Account {
  const stored = readAccount()
  if (stored) return stored
  const account: Account = { id: randomId(), email: 'local@kinetix.app', name: 'Слушатель', status: '', statusTrack: null, avatar: '', artists: [], moments: [], playlists: [], createdAt: new Date().toISOString() }
  writeAccount(account)
  return account
}
function publicUser(account: Account) { return { ...account, googleLinked: false } }

const SOURCES = new Set(['soundcloud', 'archive', 'audius', 'local', 'youtube', 'yandex', 'vk'])
function sanitizeTrack(input: Record<string, unknown> | null | undefined): Track | null {
  if (!input || typeof input !== 'object') return null
  const id = String(input.id || '').trim().slice(0, 300)
  const title = String(input.title || '').trim().slice(0, 150)
  const artist = String(input.artist || '').trim().slice(0, 150)
  const source = String(input.source || '').trim()
  if (!id || !title || !artist || !SOURCES.has(source)) return null
  const artwork = /^https:\/\//.test(String(input.artwork || '')) ? String(input.artwork).slice(0, 500) : ''
  const url = /^https:\/\//.test(String(input.url || '')) ? String(input.url).slice(0, 500) : ''
  const streamUrl = /^\/api\/(yt-stream|yandex-stream|vk-stream)\?[\x21-\x7e]{1,460}$/.test(String(input.streamUrl || '')) ? String(input.streamUrl) : ''
  const duration = Number(input.duration)
  return { id, title, artist, artwork, url, streamUrl, source: source as Track['source'], duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0, preview: Boolean(input.preview) }
}
function sanitizeTrackList(input: unknown) {
  const list = Array.isArray(input) ? input.slice(0, 200) : []
  const seen = new Set<string>()
  return list.map(item => sanitizeTrack(item as Record<string, unknown>)).filter((track): track is Track => { if (!track || seen.has(track.id)) return false; seen.add(track.id); return true })
}
function sanitizeCover(value: unknown) {
  const text = String(value || '')
  if (/^https:\/\//.test(text)) return text.slice(0, 500)
  if (/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(text) && text.length <= 400_000) return text
  return ''
}
function playlistDuration(playlist: Playlist) { return playlist.tracks.reduce((sum, track) => sum + (track.duration || 0), 0) }
function playlistSummary(playlist: Playlist, account: Account) {
  return { id: playlist.id, name: playlist.name, description: playlist.description, cover: playlist.cover, isPublic: playlist.isPublic, trackCount: playlist.tracks.length, duration: playlistDuration(playlist), owner: { name: account.name, avatar: account.avatar }, createdAt: playlist.createdAt, updatedAt: playlist.updatedAt, tracks: playlist.tracks.slice(0, 4) }
}
function normalizePlaylistQuery(value: unknown) { return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }

function accountRoute(method: string, url: URL, body: Record<string, unknown>): Response | Promise<Response> | null {
  const path = url.pathname
  if (path === '/api/me' && method === 'GET') { const account = ensureAccount(); return send({ user: publicUser(account) }) }
  if (path === '/api/auth/register' && method === 'POST') {
    const account = ensureAccount()
    const email = String(body.email || '').trim().toLowerCase()
    const name = String(body.name || '').trim()
    const password = String(body.password || '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) return fail('Введите корректный email')
    if (name.length < 2 || name.length > 40) return fail('Имя должно содержать от 2 до 40 символов')
    if (password.length < 10 || password.length > 200) return fail('Пароль должен содержать минимум 10 символов')
    const artists = Array.isArray(body.artists) ? [...new Set(body.artists.map(String))].filter(id => /^[a-z0-9-]{1,50}$/.test(id)).slice(0, 50) : []
    account.email = email
    account.name = name
    account.artists = artists
    writeAccount(account)
    return send({ user: publicUser(account) })
  }
  if (path === '/api/auth/login' && method === 'POST') return send({ user: publicUser(ensureAccount()) })
  if (path === '/api/auth/google' && method === 'POST') return fail('Google-вход недоступен в мобильной версии', 503)
  if (path === '/api/auth/google/start' && method === 'POST') return fail('Google-вход недоступен в мобильной версии', 503)
  if (path === '/api/auth/google/poll' && method === 'GET') return send({ status: 'error', error: 'Google-вход недоступен в мобильной версии' })
  if (path === '/api/auth/logout' && method === 'POST') return send({ ok: true })
  if (path === '/api/moments/shared/' && method === 'GET') return fail('Момент не найден', 404)
  if (path.startsWith('/api/moments/shared/') && method === 'GET') {
    const token = path.slice('/api/moments/shared/'.length)
    const account = ensureAccount()
    const moment = account.moments.find(item => item.shareToken === token)
    return moment ? send({ moment, owner: { name: account.name, avatar: account.avatar } }) : fail('Момент не найден', 404)
  }
  if (path === '/api/me/import' && method === 'POST') {
    const account = ensureAccount()
    const profile = body.profile as Record<string, unknown> | undefined
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return fail('Некорректный файл переноса')
    const name = profile.name === undefined ? account.name : String(profile.name).trim()
    if (name.length < 2 || name.length > 40) return fail('Имя должно содержать от 2 до 40 символов')
    const status = profile.status === undefined ? account.status : String(profile.status).trim()
    if (status.length > 120) return fail('Статус слишком длинный')
    let avatar = account.avatar
    if (profile.avatar !== undefined) {
      avatar = String(profile.avatar)
      if (avatar && !((/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar) && avatar.length <= 350_000) || (/^https:\/\/lh\d+\.googleusercontent\.com\//.test(avatar) && avatar.length <= 500))) return fail('Аватар в файле некорректен')
    }
    const artists = profile.artists === undefined ? account.artists : Array.isArray(profile.artists) ? [...new Set(profile.artists.map(String))].filter(id => /^[a-z0-9-]{1,50}$/.test(id)).slice(0, 50) : null
    if (!artists) return fail('Некорректный список исполнителей')
    let statusTrack = account.statusTrack
    if (profile.statusTrack !== undefined) {
      if (profile.statusTrack === null) statusTrack = null
      else { statusTrack = sanitizeTrack(profile.statusTrack as Record<string, unknown>); if (!statusTrack) return fail('Некорректный трек настроения') }
    }
    let playlists = account.playlists
    if (Array.isArray(profile.playlists)) playlists = profile.playlists.slice(0, 40).map(item => {
      const title = String((item as Record<string, unknown>)?.name || '').trim().slice(0, 60)
      if (!title) return null
      const now = new Date().toISOString()
      return { id: randomId(), name: title, description: String((item as Record<string, unknown>).description || '').trim().slice(0, 200), isPublic: Boolean((item as Record<string, unknown>).isPublic), cover: sanitizeCover((item as Record<string, unknown>).cover), tracks: sanitizeTrackList((item as Record<string, unknown>).tracks), createdAt: /^\d{4}-\d{2}-\d{2}T/.test(String((item as Record<string, unknown>).createdAt || '')) ? String((item as Record<string, unknown>).createdAt) : now, updatedAt: now } as Playlist
    }).filter((item): item is Playlist => Boolean(item))
    let moments = account.moments
    if (Array.isArray(profile.moments)) moments = profile.moments.slice(0, 100).map(item => {
      const record = item as Record<string, unknown>
      const lines = Array.isArray(record?.lines) ? record.lines.slice(0, 8).map(line => ({ at: Number((line as Record<string, unknown>)?.at), text: String((line as Record<string, unknown>)?.text || '').trim().slice(0, 300) })) : []
      const track = (record?.track || {}) as Record<string, unknown>
      const duration = Number(track.duration)
      if (!lines.length || lines.some(line => !line.text || !Number.isFinite(line.at) || line.at < 0) || !String(track.title || '').trim() || !String(track.artist || '').trim()) return null
      return { id: randomId(), lines, track: { id: String(track.id || '').slice(0, 300), title: String(track.title).slice(0, 150), artist: String(track.artist).slice(0, 150), artwork: /^https:\/\//.test(String(track.artwork || '')) ? String(track.artwork).slice(0, 500) : '', url: /^https:\/\//.test(String(track.url || '')) ? String(track.url).slice(0, 500) : '', duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0 }, createdAt: /^\d{4}-\d{2}-\d{2}T/.test(String(record.createdAt || '')) ? String(record.createdAt) : new Date().toISOString() } as MomentRecord
    }).filter((item): item is MomentRecord => Boolean(item))
    account.name = name
    account.status = status
    account.avatar = avatar
    account.artists = artists
    account.statusTrack = statusTrack
    account.playlists = playlists
    account.moments = moments
    writeAccount(account)
    return send({ user: publicUser(account) })
  }
  if (path === '/api/me' && method === 'PATCH') {
    const account = ensureAccount()
    if (body.name !== undefined) { const name = String(body.name).trim(); if (name.length < 2 || name.length > 40) return fail('Имя должно содержать от 2 до 40 символов'); account.name = name }
    if (body.status !== undefined) { const status = String(body.status).trim(); if (status.length > 120) return fail('Статус слишком длинный'); account.status = status }
    if (body.avatar !== undefined) {
      const avatar = String(body.avatar)
      if (avatar && !((/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar) && avatar.length <= 350_000) || (/^https:\/\/lh\d+\.googleusercontent\.com\//.test(avatar) && avatar.length <= 500))) return fail('Загрузите PNG, JPEG или WebP')
      account.avatar = avatar
    }
    if (body.artists !== undefined) {
      if (!Array.isArray(body.artists)) return fail('Некорректный список исполнителей')
      account.artists = [...new Set(body.artists.map(String))].filter(id => /^[a-z0-9-]{1,50}$/.test(id)).slice(0, 50)
    }
    if (body.statusTrack !== undefined) {
      if (body.statusTrack === null) account.statusTrack = null
      else { const track = sanitizeTrack(body.statusTrack as Record<string, unknown>); if (!track) return fail('Некорректный трек настроения'); account.statusTrack = track }
    }
    writeAccount(account)
    return send({ user: publicUser(account) })
  }
  if (path === '/api/moments' && method === 'POST') {
    const account = ensureAccount()
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 8).map(line => ({ at: Number((line as Record<string, unknown>).at), text: String((line as Record<string, unknown>).text || '').trim().slice(0, 300) })) : []
    const track = (body.track || {}) as Record<string, unknown>
    if (!lines.length || lines.some(line => !line.text || !Number.isFinite(line.at) || line.at < 0) || !String(track.title || '').trim() || !String(track.artist || '').trim()) return fail('Выберите строки и трек')
    if (account.moments.length >= 100) return fail('Достигнут лимит 100 моментов')
    const duration = Number(track.duration)
    const moment: MomentRecord = { id: randomId(), lines, track: { id: String(track.id || '').slice(0, 300), title: String(track.title).slice(0, 150), artist: String(track.artist).slice(0, 150), artwork: /^https:\/\//.test(String(track.artwork || '')) ? String(track.artwork).slice(0, 500) : '', url: /^https:\/\//.test(String(track.url || '')) ? String(track.url).slice(0, 500) : '', duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0 }, createdAt: new Date().toISOString() }
    account.moments.unshift(moment)
    writeAccount(account)
    return send({ user: publicUser(account), moment }, 201)
  }
  const shareMatch = path.match(/^\/api\/moments\/([a-zA-Z0-9-]{1,64})\/share$/)
  if (shareMatch && method === 'POST') {
    const account = ensureAccount()
    const moment = account.moments.find(item => item.id === shareMatch[1])
    if (!moment) return fail('Момент не найден', 404)
    if (!moment.shareToken) { moment.shareToken = randomToken(); writeAccount(account) }
    return send({ token: moment.shareToken, path: `/m/${moment.shareToken}` })
  }
  if (path.startsWith('/api/moments/') && method === 'DELETE') {
    const account = ensureAccount()
    const id = path.slice('/api/moments/'.length)
    const before = account.moments.length
    account.moments = account.moments.filter(item => item.id !== id)
    if (before === account.moments.length) return fail('Момент не найден', 404)
    writeAccount(account)
    return send({ user: publicUser(account) })
  }
  if (path === '/api/playlists' && method === 'GET') { const account = ensureAccount(); return send({ playlists: account.playlists }) }
  if (path === '/api/playlists' && method === 'POST') {
    const account = ensureAccount()
    const name = String(body.name || '').trim().slice(0, 60)
    const description = String(body.description || '').trim().slice(0, 200)
    if (!name) return fail('Название плейлиста обязательно')
    if (account.playlists.length >= 40) return fail('Достигнут лимит 40 плейлистов')
    const tracks = sanitizeTrackList(body.tracks)
    const track = sanitizeTrack(body.track as Record<string, unknown>)
    if (track && !tracks.some(item => item.id === track.id)) tracks.unshift(track)
    const now = new Date().toISOString()
    const playlist: Playlist = { id: randomId(), name, description, isPublic: Boolean(body.isPublic), cover: sanitizeCover(body.cover), tracks: tracks.slice(0, 200), createdAt: now, updatedAt: now }
    account.playlists = [playlist, ...account.playlists]
    writeAccount(account)
    return send({ user: publicUser(account), playlist }, 201)
  }
  if (path === '/api/playlists/discover' && method === 'GET') {
    const account = ensureAccount()
    const query = normalizePlaylistQuery(url.searchParams.get('q'))
    const found = account.playlists.filter(playlist => playlist.isPublic).filter(playlist => !query || normalizePlaylistQuery(`${playlist.name} ${playlist.description} ${playlist.tracks.slice(0, 80).map(track => `${track.title} ${track.artist}`).join(' ')}`).includes(query))
    return send({ playlists: found.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()).slice(0, 30).map(playlist => playlistSummary(playlist, account)) })
  }
  if (path.startsWith('/api/playlists/public/') && method === 'GET') {
    const account = ensureAccount()
    const id = path.slice('/api/playlists/public/'.length)
    const playlist = account.playlists.find(item => item.id === id && item.isPublic)
    return playlist ? send({ playlist, owner: { name: account.name, avatar: account.avatar } }) : fail('Плейлист не найден', 404)
  }
  const playlistMatch = path.match(/^\/api\/playlists\/([a-zA-Z0-9-]{1,64})(?:\/(tracks|copy))?$/)
  if (playlistMatch && playlistMatch[2] === 'copy' && method === 'POST') {
    const account = ensureAccount()
    const source = account.playlists.find(item => item.id === playlistMatch[1])
    if (!source) return fail('Плейлист не найден', 404)
    if (account.playlists.length >= 40) return fail('Достигнут лимит 40 плейлистов')
    const now = new Date().toISOString()
    const copy: Playlist = { id: randomId(), name: `${source.name} · копия`.slice(0, 60), description: source.description, isPublic: false, cover: source.cover, tracks: source.tracks.slice(0, 200), createdAt: now, updatedAt: now }
    account.playlists = [copy, ...account.playlists]
    writeAccount(account)
    return send({ user: publicUser(account), playlist: copy }, 201)
  }
  if (playlistMatch) {
    const account = ensureAccount()
    const playlist = account.playlists.find(item => item.id === playlistMatch[1])
    const action = playlistMatch[2] || ''
    if (!playlist) return fail('Плейлист не найден', 404)
    if (action === 'tracks' && method === 'POST') {
      const track = sanitizeTrack(body.track as Record<string, unknown>)
      if (!track) return fail('Некорректный трек')
      if (playlist.tracks.some(item => item.id === track.id)) return send({ user: publicUser(account), playlist, added: false })
      if (playlist.tracks.length >= 200) return fail('В плейлисте уже 200 треков')
      if (body.position === 'start') playlist.tracks.unshift(track)
      else playlist.tracks.push(track)
      playlist.updatedAt = new Date().toISOString()
      writeAccount(account)
      return send({ user: publicUser(account), playlist, added: true })
    }
    if (action === 'tracks' && method === 'DELETE') {
      const trackId = url.searchParams.get('trackId') || ''
      const before = playlist.tracks.length
      playlist.tracks = playlist.tracks.filter(item => item.id !== trackId)
      if (playlist.tracks.length === before) return fail('Трек не найден в плейлисте', 404)
      playlist.updatedAt = new Date().toISOString()
      writeAccount(account)
      return send({ user: publicUser(account), playlist })
    }
    if (!action && method === 'PATCH') {
      if (body.name !== undefined) {
        const name = String(body.name || '').trim().slice(0, 60)
        if (!name) return fail('Название плейлиста обязательно')
        playlist.name = name
      }
      if (body.description !== undefined) playlist.description = String(body.description || '').trim().slice(0, 200)
      if (body.isPublic !== undefined) playlist.isPublic = Boolean(body.isPublic)
      if (body.cover !== undefined) playlist.cover = sanitizeCover(body.cover)
      if (Array.isArray(body.order)) {
        const byId = new Map(playlist.tracks.map(item => [item.id, item]))
        const next: Track[] = []
        for (const id of body.order) { const item = byId.get(String(id)); if (item && !next.includes(item)) next.push(item) }
        for (const item of playlist.tracks) if (!next.includes(item)) next.push(item)
        playlist.tracks = next
      }
      if (Array.isArray(body.tracks)) playlist.tracks = sanitizeTrackList(body.tracks)
      playlist.updatedAt = new Date().toISOString()
      writeAccount(account)
      return send({ user: publicUser(account), playlist })
    }
    if (!action && method === 'DELETE') {
      account.playlists = account.playlists.filter(item => item.id !== playlist.id)
      writeAccount(account)
      return send({ user: publicUser(account) })
    }
    return fail('Метод не поддерживается', 405)
  }
  return null
}

async function handle(method: string, url: URL, body: Record<string, unknown>): Promise<Response> {
  const path = url.pathname
  if (path === '/api/config') return fail('Конфигурация недоступна', 500)
  if (path === '/api/search') return searchRoute(url)
  if (path === '/api/yt-search') return ytSearchRoute(url)
  if (path === '/api/genre') return genreRoute(url)
  if (path === '/api/recommendations') return recommendationsRoute(url)
  if (path === '/api/recommendations/mix' && method === 'POST') return recommendationMixRoute(body)
  if (path === '/api/recommendations/collection' && method === 'POST') return recommendationCollectionRoute(body)
  if (path === '/api/following') return send({ tracks: [] })
  if (path === '/api/video') return send({ url: null })
  if (path === '/api/offline') {
    if (method === 'GET') return send({ tracks: [] })
    return fail('Офлайн-кэш на сервере недоступен в мобильной версии', 400)
  }
  if (path === '/api/offline/stream') return fail('Файл не найден в офлайн-кэше', 404)
  if (path === '/api/archive-download') return fail('Скачивание архивов недоступно в мобильной версии', 400)
  if (path === '/api/playlist-search') return send({ playlists: [] })
  if (path === '/api/playlist-import') return fail('Импорт чужих плейлистов недоступен в мобильной версии', 502)
  if (path === '/api/integrations') {
    if (method === 'GET') return send({ vk: { set: false, length: 0 }, yandex: { set: false, length: 0 }, google: { set: false, length: 0 }, googleSecret: { set: false, length: 0 } })
    return fail('Токены недоступны в мобильной версии', 400)
  }
  if (path === '/api/youtube-auth') {
    if (method === 'GET') return send({ mode: 'off', browser: '', cookieCount: 0, updatedAt: 0, ytDlp: false, usingEnv: false })
    return fail('Вход в YouTube недоступен в мобильной версии', 400)
  }
  if (path === '/api/youtube-auth/test') return send({ ok: false, error: 'Вход в YouTube недоступен в мобильной версии' })
  if (path === '/api/artists') return artistsRoute(url)
  if (path === '/api/artists/lookup') return lookupRoute(url)
  if (path === '/api/artists/related') return relatedRoute(url)
  if (path === '/api/artist-search') return artistSearchRoute(url)
  if (path === '/api/artist-page') return artistPageRoute(url)
  if (path === '/api/artist-tracks') return artistTracksRoute(url)
  if (path === '/api/artist-release') return artistReleaseRoute(url)
  if (path === '/api/artist-photos') return photosRoute()
  const account = accountRoute(method, url, body)
  if (account) return account
  return fail('Недоступно в мобильной версии', 404)
}

async function readBody(init: RequestInit | undefined, request: Request | null, method: string) {
  if (init?.body && typeof init.body === 'string') {
    try { return JSON.parse(init.body) as Record<string, unknown> } catch { return {} }
  }
  if (request && method !== 'GET' && method !== 'HEAD') {
    try { return await request.clone().json() as Record<string, unknown> } catch { return {} }
  }
  return {}
}

async function androidFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : null
  const raw = request ? request.url : String(input)
  let url: URL
  try { url = new URL(raw, location.origin) } catch { return originalFetch(input as RequestInfo, init) }
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || nativePaths.has(url.pathname)) return originalFetch(input as RequestInfo, init)
  const method = (init?.method || request?.method || 'GET').toUpperCase()
  const body = await readBody(init, request, method)
  try { return await handle(method, url, body) }
  catch (error) { return fail(messageOf(error, 'Ошибка мобильной версии'), 500) }
}

export function installAndroidShell() {
  if (!isAndroid) return
  document.documentElement.classList.add('is-android')
  if (isIOS) document.documentElement.classList.add('is-ios')
  window.fetch = androidFetch as typeof fetch
}

export function saveAndroidData(name: string, mime: string, dataUrl: string) {
  const bridge = window.kinetixAndroid
  if (!bridge?.saveFile) return false
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    return Boolean(bridge.saveFile(name, mime, base64))
  } catch { return false }
}

export function saveAndroidFile(name: string, mime: string, blob: Blob): Promise<boolean> {
  return new Promise(resolve => {
    const bridge = window.kinetixAndroid
    if (!bridge?.saveFile) { resolve(false); return }
    const reader = new FileReader()
    reader.onerror = () => resolve(false)
    reader.onload = () => resolve(saveAndroidData(name, mime, String(reader.result || '')))
    reader.readAsDataURL(blob)
  })
}
