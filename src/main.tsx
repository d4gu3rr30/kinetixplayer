import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Plus, Music2, Download, Check, Heart, Play, Pause, SkipBack, SkipForward, Volume2, ListMusic, House, Library, ExternalLink, X, ChevronDown, Sparkles, WifiOff, RotateCcw, Bookmark, UserRound, Settings2, Maximize2, Minimize2, Flame, Loader2, MoreHorizontal, ListStart, ListEnd, Wand2, ArrowRight, Trash2, ListOrdered, FolderPlus, FileText, ThumbsDown } from 'lucide-react'
import { QueuePanel } from './queue'
import { SwipeRow } from './swipe'
import { SettingsView, loadSettings, SETTINGS_KEY, type Settings } from './settings'
import { artistById, artistByName, registerArtists, type Genre } from './catalog'
import { AuthDialog, ProfileView, type Moment, type User } from './account'
import { addListenTime, loadListenStats, takePendingListenStats, type ListenStats, type TrackListenEntry } from './listening'
import { RecapOverlay } from './recapView'
import { hasRecap, pickRecapYear, recapSeason } from './recap'
import { useCoverPalette } from './palette'
import { ArtistView, type ArtistRef } from './artistPage'
import { request } from './api'
import { HomeView, CollectionView, GenreView, type GenreSources, type SearchSource } from './views'
import { CatalogView } from './CatalogView'
import type { CatalogEntry } from './catalogData'
import { MomentDialog } from './moments'
import { PlaylistCover, PlaylistPicker, PlaylistsView } from './playlists'
import { Presence } from './presence'
import { RecommendationsView } from './recommendations'
import type { Track } from './types'
import { Visualizer } from './Visualizer'
import { WindowBar, hasDesktopWindow } from './windowbar'
import { isAndroid, isIOS } from './platform'
import { saveAndroidData } from './android'
import './style.css'
import './features.css'
import './discovery.css'
import './polish.css'
import './lyrics-polish.css'
import './catalog.css'
import './playlists.css'
import './refresh.css'
import './recommendations.css'
import './artist.css'
import './queue.css'
import './settings.css'
import './profile.css'
import './enhancements.css'
import './home.css'
import './genres.css'
import './android.css'
import './picker.css'
import './search.css'
import './mobile.css'
import './ui-polish.css'
import './recap.css'
import './ambient.css'
import './pulse.css'
import './performance.css'
import './windowbar.css'

type Lyric = { at: number; text: string }
type View = 'home' | 'search' | 'library' | 'favorites' | 'offline' | 'profile' | 'genre' | 'catalog' | 'playlists' | 'recommendations' | 'artist' | 'settings'
type SCWidget = { bind: (event: string, cb: (data?: { currentPosition?: number; duration?: number }) => void) => void; play: () => void; pause: () => void; seekTo: (ms: number) => void; setVolume: (volume: number) => void; getDuration: (cb: (ms: number) => void) => void }
declare global { interface Window { SC?: { Widget: ((frame: HTMLIFrameElement) => SCWidget) & { Events: Record<string, string> } }; kinetixNow?: { update: (payload: Record<string, unknown>) => void }; __kinetixRemote?: (action: string, value?: number) => void } }

const FAVORITES_KEY = 'kinetix:favorites:v1'
const MEDIA_KEY = 'kinetix:media-library:v1'
const LEGACY_KEY = 'kinetix:library:v1'
const QUEUE_KEY = 'kinetix:queue:v1'
const HISTORY_KEY = 'kinetix:history:v1'
const CURRENT_KEY = 'kinetix:current:v1'
const RECOMMEND_SEEDS_KEY = 'kinetix:recommend-seeds:v1'
const DISLIKE_KEY = 'kinetix:dislikes:v1'
const stripTrack = (track: Track): Track => { const { blob, ...rest } = track; return rest }
const VARIANT_WORDS = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'remaster', 'remastered', 'visualizer', 'visualiser', 'clip', 'slowed', 'reverb', 'sped', 'nightcore', 'cover', 'live', 'version', 'edit', 'extended', 'radio', 'prod', 'feat', 'ft', 'hq', 'hd', '4k'])
const titleCore = (title: string) => String(title || '').toLocaleLowerCase('ru-RU').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(word => word && !VARIANT_WORDS.has(word) && !/^\d{2,4}$/.test(word)).join(' ').trim()
function isSimilarTo(track: Track, other: Track) {
  if (track.id === other.id) return true
  const core = titleCore(track.title)
  const bad = titleCore(other.title)
  if (!core || !bad) return false
  return core === bad
}
const avoidHint = (dislikes: Track[]) => dislikes.slice(0, 60).map(track => ({ id: track.id, title: track.title, artist: track.artist }))
const withoutDisliked = (tracks: Track[], dislikes: Track[]) => tracks.filter(track => !dislikes.some(bad => isSimilarTo(bad, track)))
function restoreTracks(key: string): Track[] {
  if (!loadSettings().rememberQueue) return []
  try { return (JSON.parse(localStorage.getItem(key) || '[]') as Track[]).map(track => hydrateStoredTrack(track)).filter((track): track is Track => Boolean(track)) } catch { return [] }
}
function loadDislikes(): Track[] {
  try { return (JSON.parse(localStorage.getItem(DISLIKE_KEY) || '[]') as Track[]).filter(track => Boolean(track?.id)) } catch { return [] }
}
const formatTime = (time: number) => Number.isFinite(time) && time >= 0 ? `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, '0')}` : '—:—'
function readDuration(audio: HTMLAudioElement): number {
  if (Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration
  try {
    for (let index = audio.seekable.length - 1; index >= 0; index--) {
      const end = audio.seekable.end(index)
      if (Number.isFinite(end) && end > 0) return end
    }
  } catch { /* seekable throws until the stream exposes ranges */ }
  return 0
}
const artStyle = (track: Track, index = 0): React.CSSProperties => track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : { background: ['linear-gradient(145deg,#e3a27a,#775877 65%,#322b48)','linear-gradient(145deg,#4d827e,#263c5b 65%,#181d38)','linear-gradient(145deg,#8c789d,#483e70 65%,#25243b)'][index % 3] }
type NowPlayingTrack = Pick<Track, 'title' | 'artist' | 'artwork' | 'duration'>
function pushNowPlaying(track: NowPlayingTrack | null, playing: boolean, duration: number, elapsed: number) {
  const payload = track
    ? { action: 'update', title: track.title, artist: track.artist || 'Kinetix', artwork: track.artwork || '', duration: Math.max(0, duration || track.duration || 0), elapsed: Math.max(0, elapsed), rate: playing ? 1 : 0 }
    : { action: 'clear' }
  try { window.kinetixNow?.update(payload) } catch { /* The native bridge is absent in a browser. */ }
  try { window.kinetixAndroid?.nowPlaying?.(JSON.stringify(payload)) } catch { /* The Android bridge is absent in a browser. */ }
  if (!('mediaSession' in navigator)) return
  const session = navigator.mediaSession
  if (!track) { session.metadata = null; session.playbackState = 'none'; return }
  try {
    session.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist || 'Kinetix',
      album: 'Kinetix',
      artwork: track.artwork ? [{ src: track.artwork, sizes: '480x360', type: 'image/jpeg' }] : [],
    })
    session.playbackState = playing ? 'playing' : 'paused'
    const total = Math.max(0, duration || track.duration || 0)
    if (total > 1) session.setPositionState({ duration: total, position: Math.min(Math.max(0, elapsed), total - .25), playbackRate: 1 })
  } catch { /* Media Session is an optional progressive enhancement. */ }
}
const parseLrc = (input: string): Lyric[] => input.split(/\r?\n/).flatMap(line => { const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/); return match ? [{ at: Number(match[1]) * 60 + Number(match[2]), text: match[3].trim() }] : [] }).sort((a, b) => a.at - b.at)
function trackFromMoment(moment: Moment): Track | null {
  const id = moment.track.id || ''
  const stored = Number(moment.track.duration)
  const duration = Number.isFinite(stored) && stored > 0 ? stored : undefined
  const base = { id, title: moment.track.title, artist: moment.track.artist, artwork: moment.track.artwork || undefined, url: moment.track.url || undefined, duration }
  if (id.startsWith('yt:') || id.startsWith('youtube:')) { const videoId = id.replace(/^(yt|youtube):/, ''); return /^[\w-]{11}$/.test(videoId) ? { ...base, source: 'youtube', streamUrl: `/api/yt-stream?v=${videoId}` } : null }
  if (id.startsWith('yandex:')) return { ...base, source: 'yandex', streamUrl: `/api/yandex-stream?id=${encodeURIComponent(id.slice(7))}` }
  if (id.startsWith('vk:')) return { ...base, source: 'vk', streamUrl: `/api/vk-stream?id=${encodeURIComponent(id)}` }
  if (id.startsWith('archive:')) { const [, identifier, ...file] = id.split(':'); return identifier && file.length ? { ...base, source: 'archive', streamUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${file.map(encodeURIComponent).join('/')}` } : null }
  if (id.startsWith('sc:')) return { ...base, source: 'soundcloud', url: id.slice(3) }
  return null
}
const warmedYouTube = new Set<string>()
const failedYouTube = new Map<string, number>()
const warmedYandex = new Map<string, number>()
function hydrateStoredTrack(track: Track, offline: Track[] = []): Track | null {
  const id = track.id || ''
  if (id.startsWith('vk:')) return { ...track, source: 'vk', streamUrl: `/api/vk-stream?id=${encodeURIComponent(id)}` }
  if (track.streamUrl) return track
  if (id.startsWith('yt:') || id.startsWith('youtube:')) { const videoId = id.replace(/^(yt|youtube):/, ''); return /^[\w-]{11}$/.test(videoId) ? { ...track, streamUrl: `/api/yt-stream?v=${videoId}` } : null }
  if (id.startsWith('yandex:')) return { ...track, streamUrl: `/api/yandex-stream?id=${encodeURIComponent(id.slice(7))}` }
  if (id.startsWith('archive:')) { const [, identifier, ...file] = id.split(':'); return identifier && file.length ? { ...track, streamUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${file.map(encodeURIComponent).join('/')}` } : null }
  if (id.startsWith('sc:')) return track.url ? { ...track, source: 'soundcloud' } : null
  if (track.source === 'local') { const stored = offline.find(item => item.id === id); return stored ? { ...track, blob: stored.blob } : null }
  return null
}
function warmYouTube(track: Track): Promise<void> | void {
  const videoId = track.id.replace(/^yt:/, '')
  if (!/^[\w-]{11}$/.test(videoId) || warmedYouTube.has(videoId)) return
  const failedAt = failedYouTube.get(videoId)
  if (failedAt && Date.now() - failedAt < 2 * 60_000) return
  warmedYouTube.add(videoId)
  const fail = () => { warmedYouTube.delete(videoId); failedYouTube.set(videoId, Date.now()) }
  return fetch(`/api/yt-warm?v=${videoId}`).then(response => { if (!response.ok) fail() }).catch(fail)
}
function prefetchYouTube(track?: Track | null) { if (track?.source === 'youtube') void warmYouTube(track) }
function interleaveGenreParts(parts: { youtube: Track[]; yandex: Track[]; vk: Track[] }) {
  const seen = new Set<string>()
  const merged: Track[] = []
  const longest = Math.max(parts.youtube.length, parts.yandex.length, parts.vk.length)
  for (let index = 0; index < longest; index++) {
    for (const key of ['youtube', 'yandex', 'vk'] as const) {
      const track = parts[key][index]
      if (!track) continue
      const fingerprint = `${track.artist}|${track.title}`.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
      if (seen.has(track.id) || seen.has(fingerprint)) continue
      seen.add(track.id)
      seen.add(fingerprint)
      merged.push(track)
    }
  }
  return merged
}
function warmList(tracks: Track[], count = 3) {
  tracks.filter(track => track.source === 'youtube').slice(0, count).forEach((track, index) => {
    setTimeout(() => { void warmYouTube(track) }, index * 900)
  })
}
function warmStream(track?: Track | null): Promise<void> | void {
  if (!track || track.offlineKey) return
  if (track.source === 'youtube') return warmYouTube(track)
  if (track.source !== 'yandex' && track.source !== 'vk') return
  const url = track.source === 'yandex'
    ? track.streamUrl || `/api/yandex-stream?id=${encodeURIComponent(track.id.replace(/^yandex:/, ''))}`
    : `/api/vk-stream?id=${encodeURIComponent(track.id)}`
  const warmedAt = warmedYandex.get(url)
  if (warmedAt && Date.now() - warmedAt < 20 * 60_000) return
  warmedYandex.set(url, Date.now())
  return fetch(url, { headers: { Range: 'bytes=0-1' }, cache: 'no-store' }).then(response => { void response.body?.cancel() }).catch(() => { warmedYandex.delete(url) })
}

function openDb(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open('kinetix-offline', 1); request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
async function saveOffline(track: Track) { const db = await openDb(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').put(track); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close() }
async function getOffline(): Promise<Track[]> { const db = await openDb(); const result = await new Promise<Track[]>((resolve, reject) => { const request = db.transaction('tracks').objectStore('tracks').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }); db.close(); return result }
async function removeOffline(id: string) { const db = await openDb(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }); db.close() }
type OfflineEntry = { key: string; id: string; title: string; artist: string; artwork?: string; duration?: number; source: Track['source']; size?: number; createdAt?: string }
function serverOfflineTrack(entry: OfflineEntry): Track {
  return { id: entry.id, offlineKey: entry.key, title: entry.title, artist: entry.artist, artwork: entry.artwork || undefined, duration: entry.duration || undefined, source: entry.source, streamUrl: `/api/offline/stream?key=${entry.key}`, folder: 'Офлайн-кэш' }
}

function loadCorsImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    if (!url) { resolve(null); return }
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}
function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath()
  if (typeof context.roundRect === 'function') { context.roundRect(x, y, width, height, radius); return }
  context.moveTo(x + radius, y)
  context.arcTo(x + width, y, x + width, y + height, radius)
  context.arcTo(x + width, y + height, x, y + height, radius)
  context.arcTo(x, y + height, x, y, radius)
  context.arcTo(x, y, x + width, y, radius)
  context.closePath()
}
function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const rows: string[] = []
  let current = ''
  for (const word of words) {
    const next = current ? `${current} ${word}` : word
    if (context.measureText(next).width <= maxWidth || !current) current = next
    else { rows.push(current); current = word }
  }
  if (current) rows.push(current)
  return rows.length ? rows : ['']
}
async function renderMomentCard(moment: Moment, ownerName: string): Promise<string> {
  const width = 1080
  const height = 1350
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Не удалось нарисовать карточку')
  const image = await loadCorsImage(moment.track.artwork || '')
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#19220f')
  gradient.addColorStop(.55, '#0c1108')
  gradient.addColorStop(1, '#070906')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  if (image) {
    context.save()
    context.filter = 'blur(46px) saturate(1.15)'
    const scale = Math.max(width / image.width, height / image.height) * 1.16
    const dw = image.width * scale
    const dh = image.height * scale
    context.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh)
    context.restore()
  }
  const shade = context.createLinearGradient(0, 0, 0, height)
  shade.addColorStop(0, 'rgba(6,9,4,.62)')
  shade.addColorStop(.42, 'rgba(6,9,4,.8)')
  shade.addColorStop(1, 'rgba(5,7,4,.94)')
  context.fillStyle = shade
  context.fillRect(0, 0, width, height)
  const glow = context.createRadialGradient(width * .16, 0, 0, width * .16, 0, 900)
  glow.addColorStop(0, 'rgba(215,255,87,.14)')
  glow.addColorStop(1, 'rgba(215,255,87,0)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)
  const artSize = 210
  const artX = (width - artSize) / 2
  const artY = 92
  context.save()
  context.shadowColor = 'rgba(0,0,0,.6)'
  context.shadowBlur = 50
  context.shadowOffsetY = 20
  roundRect(context, artX, artY, artSize, artSize, 26)
  context.fillStyle = '#1a2214'
  context.fill()
  context.restore()
  if (image) {
    context.save()
    roundRect(context, artX, artY, artSize, artSize, 26)
    context.clip()
    const side = Math.min(image.width, image.height)
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, artX, artY, artSize, artSize)
    context.restore()
  }
  context.save()
  roundRect(context, artX, artY, artSize, artSize, 26)
  context.strokeStyle = 'rgba(255,255,255,.16)'
  context.lineWidth = 2
  context.stroke()
  context.restore()
  context.textBaseline = 'alphabetic'
  context.fillStyle = '#d7ff57'
  context.font = '800 21px "Inter", Arial, sans-serif'
  context.fillText('МОМЕНТ · KINETIX', 110, 358)
  const lines = moment.lines || []
  const withTime = lines.some(line => Number(line.at) > 0)
  const maxWidth = withTime ? 780 : 860
  const startY = 420
  const footerY = 1168
  const available = footerY - startY - 50
  let fontSize = 52
  let layout: { rows: string[]; time: string | null }[] = []
  for (const size of [52, 46, 40, 36, 32, 28, 25, 22]) {
    fontSize = size
    context.font = `600 ${size}px "Inter", Arial, sans-serif`
    layout = lines.map(line => ({ rows: wrapCanvasText(context, line.text, maxWidth), time: withTime && Number(line.at) > 0 ? formatTime(Number(line.at)) : null }))
    const total = layout.reduce((sum, item) => sum + item.rows.length, 0)
    if (total * size * 1.34 <= available) break
  }
  let y = startY
  const lineHeight = fontSize * 1.34
  for (const item of layout) {
    context.font = `700 ${Math.max(17, Math.round(fontSize * .44))}px "Inter", Arial, sans-serif`
    context.fillStyle = '#9db083'
    const textX = item.time ? 176 : 110
    if (item.time) context.fillText(item.time, 110, y)
    context.font = `600 ${fontSize}px "Inter", Arial, sans-serif`
    context.fillStyle = '#f1f6e6'
    for (const row of item.rows) {
      context.fillText(row, textX, y)
      y += lineHeight
    }
    y += fontSize * .18
  }
  context.fillStyle = 'rgba(255,255,255,.14)'
  context.fillRect(110, footerY, 860, 1)
  context.fillStyle = '#eef4e2'
  context.font = '700 32px "Inter", Arial, sans-serif'
  context.fillText(moment.track.title, 110, footerY + 62)
  context.fillStyle = '#a4b295'
  context.font = '500 24px "Inter", Arial, sans-serif'
  context.fillText(moment.track.artist, 110, footerY + 104)
  const date = new Date(moment.createdAt || Date.now()).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  context.textAlign = 'right'
  context.fillStyle = '#8d9b7f'
  context.font = '500 20px "Inter", Arial, sans-serif'
  context.fillText(`${ownerName} · ${date}`, 970, footerY + 62)
  context.textAlign = 'center'
  context.fillStyle = 'rgba(238,244,226,.15)'
  context.font = '500 22px "Inter", Arial, sans-serif'
  context.fillText('k i n e t i x', width / 2, 1318)
  context.textAlign = 'left'
  return canvas.toDataURL('image/png')
}

function Logo({ small = false }: { small?: boolean }) { return <div className={`brand ${small ? 'brand-small' : ''}`}><img className="brand-mark-image" src="/kinetix-mark.svg" alt=""/><span>kinetix<span className="brand-dot">.</span></span></div> }

function App() {
  const [view, setView] = useState<View>('home')
  const [query, setQuery] = useState('')
  const [searchNonce, setSearchNonce] = useState(0)
  const [searchSource, setSearchSource] = useState<SearchSource>('all')
  const [recommendSource, setRecommendSource] = useState<SearchSource>('all')
  const [catalogSource, setCatalogSource] = useState<SearchSource>('all')
  const [artistSource, setArtistSource] = useState<SearchSource>('all')
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNoticeState] = useState('')
  const [noticeKey, setNoticeKey] = useState(0)
  const [noticeLeaving, setNoticeLeaving] = useState(false)
  const [apiReady, setApiReady] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [apiConfig, setApiConfig] = useState({ youtubeDl: false, yandexFull: false, vk: false, vkIssue: '', soundcloud: false })
  const [googleClientId, setGoogleClientId] = useState('')
  const [desktopApp, setDesktopApp] = useState(hasDesktopWindow)
  const [favorites, setFavorites] = useState<Track[]>(() => { try { const stored = localStorage.getItem(FAVORITES_KEY); if (stored) return JSON.parse(stored); return JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]') } catch { return [] } })
  const [dislikes, setDislikes] = useState<Track[]>(loadDislikes)
  const dislikeKey = dislikes.map(track => track.id).join('|')
  const [mediaLibrary, setMediaLibrary] = useState<Track[]>(() => { try { return JSON.parse(localStorage.getItem(MEDIA_KEY) || '[]') } catch { return [] } })
  const [offline, setOffline] = useState<Track[]>([])
  const [serverOffline, setServerOffline] = useState<Track[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [serverCachingId, setServerCachingId] = useState<string | null>(null)
  const [current, setCurrent] = useState<Track | null>(() => { try { if (!loadSettings().rememberQueue) return null; const stored = JSON.parse(localStorage.getItem(CURRENT_KEY) || 'null'); return stored ? hydrateStoredTrack(stored) : null } catch { return null } })
  const [queue, setQueue] = useState<Track[]>(() => restoreTracks(QUEUE_KEY))
  const [history, setHistory] = useState<Track[]>(() => restoreTracks(HISTORY_KEY))
  const [queueOpen, setQueueOpen] = useState(false)
  const [playerMenu, setPlayerMenu] = useState(false)
  const [mobileMenu, setMobileMenu] = useState<'overlay' | 'mini' | null>(null)
  const [holdingMini, setHoldingMini] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [position, setPosition] = useState(0)
  const [seekDraft, setSeekDraft] = useState<number | null>(null)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(80)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [lyrics, setLyrics] = useState<Lyric[]>([])
  const [plainLyrics, setPlainLyrics] = useState('')
  const [lyricsStatus, setLyricsStatus] = useState('Выберите трек, чтобы увидеть текст')
  const [video, setVideo] = useState<string | null>(null)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [mobileLyricsFull, setMobileLyricsFull] = useState(false)
  const [showLyrics, setShowLyrics] = useState(false)
  const [lyricsExpanded, setLyricsExpanded] = useState(false)
  const [loop, setLoop] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [dynamicArtistCount, setDynamicArtistCount] = useState(0)
  const [authOpen, setAuthOpen] = useState(false)
  const [genre, setGenre] = useState<Genre | null>(null)
  const [genreTracks, setGenreTracks] = useState<Track[]>([])
  const [genreLoading, setGenreLoading] = useState(false)
  const [genreYoutubeLoading, setGenreYoutubeLoading] = useState(false)
  const [genreError, setGenreError] = useState('')
  const [genreMood, setGenreMood] = useState('')
  const [genreQuery, setGenreQuery] = useState('')
  const [genreSource, setGenreSource] = useState<SearchSource>('all')
  const [genreSources, setGenreSources] = useState<GenreSources | null>(null)
  const [genreNonce, setGenreNonce] = useState(0)
  const genreParts = useRef<{ youtube: Track[]; yandex: Track[]; vk: Track[] }>({ youtube: [], yandex: [], vk: [] })
  const [catalogArtist, setCatalogArtist] = useState<CatalogEntry | null>(null)
  const [catalogTracks, setCatalogTracks] = useState<Track[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [artistStack, setArtistStack] = useState<ArtistRef[]>([])
  const artistReturn = useRef<View>('home')
  const settingsReturn = useRef<View>('home')
  const [followingTracks, setFollowingTracks] = useState<Track[]>([])
  const [listenStats, setListenStats] = useState<ListenStats | null>(null)
  const [recapOpenYear, setRecapOpenYear] = useState<number | null>(null)
  const coverBackground = settings.coverBackground && !settings.performanceMode
  const coverPalette = useCoverPalette(coverBackground ? current?.artwork : null)
  const ambientStyle = useMemo(() => {
    const style: Record<string, string> = {}
    if (coverBackground && current?.artwork) style['--art-url'] = `url("${current.artwork.replace(/"/g, '')}")`
    if (coverPalette) {
      style['--art-a'] = coverPalette.a
      style['--art-b'] = coverPalette.b
      style['--art-c'] = coverPalette.c
    }
    return style as React.CSSProperties
  }, [coverBackground, current?.artwork, coverPalette])
  const [selectingMoment, setSelectingMoment] = useState(false)
  const [momentLines, setMomentLines] = useState<number[]>([])
  const [playlistPickerTrack, setPlaylistPickerTrack] = useState<Track | null>(null)
  const [pendingPickerTrack, setPendingPickerTrack] = useState<Track | null>(null)
  const [playlistFocus, setPlaylistFocus] = useState<{ id: string; nonce: number } | null>(null)
  const [recommendSeed, setRecommendSeed] = useState<{ track: Track; scope: 'track' | 'artist'; nonce: number } | null>(null)
  const [recommendations, setRecommendations] = useState<Track[]>([])
  const [recommendLoading, setRecommendLoading] = useState(false)
  const [recommendError, setRecommendError] = useState('')
  const [recommendMode, setRecommendMode] = useState<'mix' | 'seed' | 'collection'>('mix')
  const [mixNonce, setMixNonce] = useState(0)
  const [recommendSeeds, setRecommendSeeds] = useState<Track[]>(() => { try { return JSON.parse(localStorage.getItem(RECOMMEND_SEEDS_KEY) || '[]') as Track[] } catch { return [] } })
  const [collectionNonce, setCollectionNonce] = useState(0)
  const [homeLaunching, setHomeLaunching] = useState(false)
  const [statusPrompt, setStatusPrompt] = useState<Track | null>(null)
  const [offlineFolder, setOfflineFolder] = useState('all')
  const audioRef = useRef<HTMLAudioElement>(null)
  const lyricsScrollRef = useRef<HTMLDivElement>(null)
  const mobileLyricsScrollRef = useRef<HTMLDivElement>(null)
  const miniTrackRef = useRef<HTMLDivElement>(null)
  const miniSwipe = useRef<{ pointerId: number; startX: number; startY: number; dx: number; axis: 'x' | 'y' | null; active: boolean } | null>(null)
  const miniSwipeSuppress = useRef(false)
  const miniSwipeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const miniPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const miniPressStart = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const longPressFired = useRef(false)
  const playerMenuRef = useRef<HTMLDivElement>(null)
  const overlayMenuRef = useRef<HTMLDivElement>(null)
  const miniMenuRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const widgetRef = useRef<SCWidget | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const objectUrlRef = useRef<string | null>(null)
  const errorRetries = useRef(0)
  const streamRecover = useRef({ id: '', at: 0 })
  const autoSkipGuard = useRef({ count: 0, at: 0 })
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlaySwipe = useRef<{ pointerId: number; startX: number; startY: number; dy: number; active: boolean; startedAt: number } | null>(null)
  const recommendFresh = useRef(false)
  const waveLoading = useRef(false)
  const waveCooldown = useRef(0)
  const waveNotified = useRef(false)
  const playedWaveIds = useRef(new Set<string>())
  const removedFromQueue = useRef(new Set<string>())
  const pendingSeek = useRef<{ id: string; at: number; until: number; hardUntil: number } | null>(null)
  const seekWatch = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentRef = useRef<Track | null>(null)
  const soundCloudSeek = useRef(0)
  const lyricsHoldUntil = useRef(0)
  const lyricsHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeLineRef = useRef(-1)
  const seekDraftRef = useRef<number | null>(null)
  const seekInputRef = useRef<HTMLInputElement>(null)
  const overlaySeekInputRef = useRef<HTMLInputElement>(null)
  const positionRef = useRef(0)
  const positionShownRef = useRef(0)
  const lyricsRef = useRef<Lyric[]>([])
  const durationRef = useRef(0)
  const userRef = useRef<User | null>(null)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const soundCloudClock = useRef({ position: 0, at: 0 })
  const fadeTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fadeInPending = useRef(false)
  const fadingOut = useRef(false)
  function rampVolume(target: number, seconds: number) {
    const audio = audioRef.current
    if (!audio) return
    if (fadeTimer.current) { clearInterval(fadeTimer.current); fadeTimer.current = null }
    if (seconds <= 0) { audio.volume = target; return }
    const start = audio.volume
    const startedAt = performance.now()
    fadeTimer.current = setInterval(() => {
      if (!audioRef.current) { if (fadeTimer.current) clearInterval(fadeTimer.current); fadeTimer.current = null; return }
      const progress = Math.min(1, (performance.now() - startedAt) / (seconds * 1000))
      audioRef.current.volume = Math.max(0, Math.min(1, start + (target - start) * progress))
      if (progress >= 1) { if (fadeTimer.current) clearInterval(fadeTimer.current); fadeTimer.current = null }
    }, 55)
  }
  function applyVolume(value: number) {
    const next = Math.max(0, Math.min(100, value))
    if (audioRef.current) audioRef.current.volume = next / 100
    if (current?.source === 'soundcloud') widgetRef.current?.setVolume(next)
  }
  function changeVolume(value: number) {
    const next = Math.max(0, Math.min(100, Number(value) || 0))
    fadeInPending.current = false
    if (fadeTimer.current) { clearInterval(fadeTimer.current); fadeTimer.current = null }
    setVolume(next)
    applyVolume(next)
  }
  const yandexNotice = useRef(false)
  const noticeId = useRef(0)
  function setNotice(message: string) { noticeId.current++; setNoticeState(message); setNoticeKey(noticeId.current); setNoticeLeaving(false) }
  function closeNotice() { const id = noticeId.current; setNoticeLeaving(true); setTimeout(() => { if (noticeId.current === id) setNoticeState('') }, 320) }
  const [activeLine, setActiveLine] = useState(-1)
  lyricsRef.current = lyrics
  durationRef.current = duration
  function lineIndexAt(lines: Lyric[], seconds: number) {
    let active = -1
    for (let index = 0; index < lines.length; index++) if (lines[index].at <= seconds + .15) active = index
    return active
  }
  function paintSeek(input: HTMLInputElement | null, seconds: number, syncValue: boolean) {
    if (!input) return
    const max = Math.max(Number(input.max) || 0, 1)
    const value = Math.min(Math.max(0, seconds), max)
    if (syncValue && Math.abs(Number(input.value) - value) > .02) input.value = String(value)
    input.style.setProperty('--fill', `${value / max * 100}%`)
  }
  function paintPlayhead(seconds: number, force = false) {
    if (!force && seekDraftRef.current !== null) return
    paintSeek(seekInputRef.current, seconds, true)
    paintSeek(overlaySeekInputRef.current, seconds, true)
  }
  // The playhead is painted straight into the sliders; React state only moves once per second
  // and when the active lyric line changes, so playback no longer re-renders the whole app at 40 fps.
  function applyPlayhead(next: number, force = false) {
    const value = Number.isFinite(next) ? Math.max(0, next) : 0
    positionRef.current = value
    paintPlayhead(value, force)
    const index = lineIndexAt(lyricsRef.current, value)
    if (index !== activeLineRef.current) { activeLineRef.current = index; setActiveLine(index) }
    if (force || Math.abs(value - positionShownRef.current) >= 1) { positionShownRef.current = value; setPosition(value) }
  }
  function endSeek() {
    seekDraftRef.current = null
    setSeekDraft(null)
    paintPlayhead(positionRef.current, true)
  }
  currentRef.current = current
  userRef.current = user
  const seekLine = useMemo(() => {
    if (seekDraft === null || !lyrics.length) return null
    let index = 0
    lyrics.forEach((line, i) => { if (line.at <= seekDraft + .05) index = i })
    return { text: lyrics[index].text || '♪', prev: lyrics[index - 1]?.text || '', next: lyrics[index + 1]?.text || '' }
  }, [seekDraft, lyrics])
  const seekPercent = Math.min(100, Math.max(0, (seekDraft ?? position) / Math.max(duration, 1) * 100))
  function lyricContainers() { return [lyricsScrollRef.current, mobileLyricsScrollRef.current].filter((node): node is HTMLDivElement => Boolean(node)) }
  function sizeLyricSpacers() {
    for (const container of lyricContainers()) container.style.setProperty('--lyric-gap', `${Math.max(0, Math.round(container.clientHeight / 2 - 22))}px`)
  }
  function centerLyrics(index: number) {
    if (index < 0) return
    sizeLyricSpacers()
    for (const container of lyricContainers()) {
      const line = container.querySelector<HTMLElement>(`[data-line-index="${index}"]`)
      if (!line) continue
      const box = container.getBoundingClientRect()
      const rect = line.getBoundingClientRect()
      const top = container.scrollTop + rect.top - box.top - (box.height - rect.height) / 2
      container.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    }
  }
  function holdLyricsSync() {
    lyricsHoldUntil.current = Date.now() + 3200
    if (lyricsHoldTimer.current) clearTimeout(lyricsHoldTimer.current)
    lyricsHoldTimer.current = setTimeout(() => { lyricsHoldUntil.current = 0; centerLyrics(activeLineRef.current) }, 3200)
  }
  useEffect(() => { seekDraftRef.current = seekDraft }, [seekDraft])
  useEffect(() => {
    if (playing) { paintPlayhead(positionRef.current); return }
    applyPlayhead(positionRef.current, true)
  }, [playing])
  useEffect(() => {
    const index = lineIndexAt(lyrics, positionRef.current)
    if (index !== activeLineRef.current) { activeLineRef.current = index; setActiveLine(index) }
  }, [lyrics])
  useEffect(() => { paintPlayhead(positionRef.current) }, [duration])
  useEffect(() => {
    if (activeLine < 0 || Date.now() < lyricsHoldUntil.current) return
    const frame = requestAnimationFrame(() => centerLyrics(activeLine))
    return () => cancelAnimationFrame(frame)
  }, [activeLine, showLyrics, playerOpen, lyricsExpanded, mobileLyricsFull, lyrics.length])
  useEffect(() => {
    const nodes = new Set<HTMLDivElement>()
    const interact = () => holdLyricsSync()
    const observer = new ResizeObserver(() => { sizeLyricSpacers(); if (Date.now() >= lyricsHoldUntil.current) centerLyrics(activeLineRef.current) })
    function connect() {
      for (const node of lyricContainers()) {
        if (nodes.has(node)) continue
        nodes.add(node)
        node.addEventListener('wheel', interact, { passive: true })
        node.addEventListener('touchmove', interact, { passive: true })
        node.addEventListener('pointerdown', interact)
        observer.observe(node)
      }
      sizeLyricSpacers()
    }
    connect()
    // Overlay mounts one render after the flag flips, so pick up fresh refs once it exists
    const timer = setTimeout(() => { connect(); if (Date.now() >= lyricsHoldUntil.current) centerLyrics(activeLineRef.current) }, 90)
    return () => {
      clearTimeout(timer)
      for (const node of nodes) {
        node.removeEventListener('wheel', interact)
        node.removeEventListener('touchmove', interact)
        node.removeEventListener('pointerdown', interact)
      }
      observer.disconnect()
    }
  }, [lyrics.length, showLyrics, playerOpen, lyricsExpanded, mobileLyricsFull])
  useEffect(() => () => { if (lyricsHoldTimer.current) clearTimeout(lyricsHoldTimer.current); if (seekWatch.current) clearInterval(seekWatch.current) }, [])
  useEffect(() => { if (!playerOpen) setMobileLyricsFull(false) }, [playerOpen])
  useEffect(() => () => { if (miniSwipeTimer.current) clearTimeout(miniSwipeTimer.current); if (miniPressTimer.current) clearTimeout(miniPressTimer.current) }, [])
  useEffect(() => { setMobileMenu(null) }, [playerOpen, current?.id])
  useEffect(() => {
    if (!isAndroid) return
    window.__kinetixAndroidBack = () => {
      if (mobileMenu) { setMobileMenu(null); return true }
      if (playerMenu) { setPlayerMenu(false); return true }
      if (playlistPickerTrack) { setPlaylistPickerTrack(null); return true }
      if (queueOpen) { setQueueOpen(false); return true }
      if (authOpen) { setAuthOpen(false); return true }
      if (recapOpenYear !== null) { setRecapOpenYear(null); return true }
      if (mobileLyricsFull) { setMobileLyricsFull(false); return true }
      if (lyricsExpanded) { setLyricsExpanded(false); return true }
      if (playerOpen) { setPlayerOpen(false); return true }
      if (showLyrics) { setShowLyrics(false); return true }
      if (view === 'settings') { setView(settingsReturn.current); return true }
      if (view === 'artist') { closeArtist(); return true }
      if (view !== 'home') { setView('home'); return true }
      return false
    }
    return () => { delete window.__kinetixAndroidBack }
  }, [mobileMenu, playerMenu, playlistPickerTrack, queueOpen, authOpen, recapOpenYear, mobileLyricsFull, lyricsExpanded, playerOpen, showLyrics, view, artistStack])
  const availableMomentLines = useMemo(() => lyrics.length ? lyrics.filter(line => line.text) : plainLyrics.split(/\r?\n/).map(text => ({ at: 0, text: text.trim() })).filter(line => line.text), [lyrics, plainLyrics])
  const activeArtist = artistStack.length ? artistStack[artistStack.length - 1] : null

  useEffect(() => { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.map(({ blob, ...track }) => track))) }, [favorites])
  useEffect(() => { try { localStorage.setItem(DISLIKE_KEY, JSON.stringify(dislikes.map(stripTrack))) } catch { /* Storage can be full or blocked. */ } }, [dislikes])
  useEffect(() => { try { localStorage.setItem(RECOMMEND_SEEDS_KEY, JSON.stringify(recommendSeeds.map(stripTrack))) } catch { /* Storage can be full or blocked. */ } }, [recommendSeeds])
  useEffect(() => { localStorage.setItem(MEDIA_KEY, JSON.stringify(mediaLibrary.map(({ blob, ...track }) => track))) }, [mediaLibrary])
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    document.documentElement.dataset.motion = settings.smoothUi ? 'smooth' : 'off'
    document.documentElement.dataset.perf = settings.performanceMode ? 'low' : 'high'
  }, [settings])
  useEffect(() => {
    if (!settings.rememberQueue) { localStorage.removeItem(QUEUE_KEY); localStorage.removeItem(HISTORY_KEY); localStorage.removeItem(CURRENT_KEY); return }
    const strip = (list: Track[]) => list.filter(track => track.source !== 'local').map(({ blob, ...track }) => track)
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(strip(queue)))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(strip(history)))
      if (current && current.source !== 'local') { const { blob, ...rest } = current; localStorage.setItem(CURRENT_KEY, JSON.stringify(rest)) } else localStorage.removeItem(CURRENT_KEY)
    } catch { /* Storage can be full or blocked: playback still works without persistence. */ }
  }, [queue, history, current, settings.rememberQueue])
  useEffect(() => { if (!notice) return; const timer = setTimeout(closeNotice, 3900); return () => clearTimeout(timer) }, [noticeKey, notice])
  useEffect(() => {
    if (!playerMenu) return
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node) || !playerMenuRef.current?.contains(event.target)) setPlayerMenu(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlayerMenu(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey) }
  }, [playerMenu])
  useEffect(() => {
    if (!mobileMenu) return
    const close = (event: PointerEvent) => {
      const node = event.target
      if (!(node instanceof Node)) { setMobileMenu(null); return }
      if ((mobileMenu === 'mini' ? miniMenuRef.current : overlayMenuRef.current)?.contains(node)) return
      if (mobileMenu === 'mini' && node instanceof HTMLElement && node.closest('.player-bar')) return
      setMobileMenu(null)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileMenu(null) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', onKey) }
  }, [mobileMenu])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [view, genre?.id, catalogArtist?.id, activeArtist?.id, activeArtist?.name])
  async function refreshServerOffline() {
    try {
      const response = await fetch('/api/offline')
      if (!response.ok) return
      const data = await response.json()
      if (Array.isArray(data.tracks)) setServerOffline(data.tracks.map(serverOfflineTrack))
    } catch { /* The server cache is optional: the app keeps working from streams. */ }
  }
  useEffect(() => { getOffline().then(setOffline).catch(() => setNotice('Не удалось открыть оффлайн-хранилище')); void refreshServerOffline() }, [])
  useEffect(() => { folderRef.current?.setAttribute('webkitdirectory', ''); folderRef.current?.setAttribute('directory', '') }, [])
  useEffect(() => () => { if (fadeTimer.current) clearInterval(fadeTimer.current) }, [])
  function loadConfig() {
    fetch('/api/config').then(r => r.json()).then(data => { setApiReady(Boolean(data.ready || data.soundcloud)); setConfigLoaded(true); setGoogleClientId(data.googleClientId || ''); setDesktopApp(Boolean(data.desktop) || hasDesktopWindow()); setApiConfig({ youtubeDl: Boolean(data.youtubeDl), yandexFull: Boolean(data.yandexFull), vk: Boolean(data.vk), vkIssue: String(data.vkIssue || ''), soundcloud: Boolean(data.soundcloud) }) }).catch(() => setConfigLoaded(true))
  }
  useEffect(() => { loadConfig() }, [])
  useEffect(() => {
    if (!configLoaded) return
    const usable = (value: SearchSource) => {
      if (value === 'all') return true
      if (isAndroid) {
        if (value === 'youtube') return apiConfig.youtubeDl
        if (value === 'yandex') return apiConfig.yandexFull
        if (value === 'vk') return apiConfig.vk && !apiConfig.vkIssue.trim()
        return false
      }
      return value === 'yandex' || (value === 'youtube' ? apiConfig.youtubeDl : apiConfig.vk && !apiConfig.vkIssue.trim())
    }
    if (!usable(searchSource)) setSearchSource('all')
    if (!usable(recommendSource)) setRecommendSource('all')
    if (!usable(catalogSource)) setCatalogSource('all')
    if (!usable(genreSource)) setGenreSource('all')
    if (!usable(artistSource)) setArtistSource('all')
  }, [configLoaded, apiConfig.youtubeDl, apiConfig.yandexFull, apiConfig.vk, apiConfig.vkIssue, searchSource, recommendSource, catalogSource, genreSource, artistSource])
  useEffect(() => { request<{ user: User | null }>('/api/me').then(result => setUser(result.user)).catch(() => {}) }, [])
  useEffect(() => { const ids = user?.artists.filter(id => id.startsWith('wiki-') || id.startsWith('ruwiki-') || id.startsWith('artist-') || id.startsWith('deezer-')) || []; if (!ids.length) return; fetch(`/api/artists/lookup?ids=${encodeURIComponent(ids.join(','))}`).then(r => r.json()).then(data => { registerArtists(data.artists || []); setDynamicArtistCount((value) => value + 1) }).catch(() => {}) }, [user?.artists.join(',')])
  useEffect(() => { setMomentLines([]); setSelectingMoment(false) }, [current?.id])
  useEffect(() => { errorRetries.current = 0; setBuffering(Boolean(current && current.source !== 'soundcloud' && current.source !== 'local')) }, [current?.id])
  useEffect(() => {
    if (!current) { pushNowPlaying(null, false, 0, 0); return }
    pushNowPlaying(current, playing, duration, positionRef.current)
  }, [current?.id, current?.title, current?.artist, current?.artwork, current?.duration, playing, duration])
  useEffect(() => {
    window.__kinetixRemote = (action, value) => {
      if (action === 'play') { if (!playing) setPlaying(true); return }
      if (action === 'pause') { if (playing) setPlaying(false); return }
      if (action === 'toggle') { setPlaying(!playing); return }
      if (action === 'next') { skip(1); return }
      if (action === 'previous') { skip(-1); return }
      if (action === 'seek' && Number.isFinite(value) && current) { seek(value as number); requestSeek(current, value as number, 12000) }
    }
    return () => { delete window.__kinetixRemote }
  })
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const actions: [MediaSessionAction, string][] = [['play', 'play'], ['pause', 'pause'], ['nexttrack', 'next'], ['previoustrack', 'previous'], ['stop', 'pause']]
    for (const [name, action] of actions) {
      try { session.setActionHandler(name, () => window.__kinetixRemote?.(action)) } catch { /* This action is unsupported here. */ }
    }
    try { session.setActionHandler('seekto', details => { if (typeof details.seekTime === 'number') window.__kinetixRemote?.('seek', details.seekTime) }) } catch { /* This action is unsupported here. */ }
    return () => {
      for (const [name] of actions) { try { session.setActionHandler(name, null) } catch { /* Already detached. */ } }
      try { session.setActionHandler('seekto', null) } catch { /* Already detached. */ }
    }
  }, [])
  useEffect(() => {
    if (!genre || view !== 'genre') return
    const controller = new AbortController()
    const base = new URLSearchParams({ genre: genre.id, source: 'local' })
    const youtube = new URLSearchParams({ genre: genre.id, source: 'youtube' })
    if (genreMood) { base.set('q', genreMood); youtube.set('q', genreMood) }
    if (genreNonce) { base.set('refresh', '1'); youtube.set('refresh', '1') }
    genreParts.current = { youtube: [], yandex: [], vk: [] }
    setGenreLoading(true); setGenreYoutubeLoading(true); setGenreError(''); setGenreTracks([]); setGenreSources(null)
    let failure = ''
    const apply = (tracks: Track[]) => {
      if (controller.signal.aborted || !tracks.length) return
      const parts = genreParts.current
      for (const track of tracks) {
        const bucket = track.source === 'yandex' ? 'yandex' : track.source === 'vk' ? 'vk' : 'youtube'
        if (!parts[bucket].some(item => item.id === track.id)) parts[bucket].push(track)
      }
      setGenreTracks(interleaveGenreParts(parts))
      setGenreSources({ youtube: parts.youtube.length, yandex: parts.yandex.length, vk: parts.vk.length })
      warmList(tracks, 3)
    }
    const load = (params: URLSearchParams, done: (ok: boolean) => void) => fetch(`/api/genre?${params}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось открыть жанр'); return result })
      .then(result => { apply(result.tracks || []); done(true) })
      .catch(error => { if (!failure) failure = error instanceof Error ? error.message : 'Не удалось открыть жанр'; done(false) })
    Promise.all([
      load(base, ok => { if (ok && !controller.signal.aborted) setGenreLoading(false) }),
      load(youtube, () => { if (!controller.signal.aborted) setGenreYoutubeLoading(false) }),
    ]).then(() => {
      if (controller.signal.aborted) return
      setGenreLoading(false); setGenreYoutubeLoading(false)
      if (!genreParts.current.youtube.length && !genreParts.current.yandex.length && !genreParts.current.vk.length) {
        setGenreError(failure || 'В этом жанре пока нет доступных треков. Попробуй другое настроение.')
      }
    })
    return () => controller.abort()
  }, [genre?.id, view, genreMood, genreNonce])
  useEffect(() => {
    if (view !== 'catalog' || !catalogArtist) { setCatalogTracks([]); setCatalogLoading(false); setCatalogError(''); return }
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError(''); setCatalogTracks([])
    fetch(`/api/yt-search?q=${encodeURIComponent(catalogArtist.query)}&limit=30&mode=${catalogArtist.kind === 'mix' ? 'mix' : 'artist'}&source=${catalogSource}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось открыть каталог'); return result })
      .then(result => { if (controller.signal.aborted) return; const tracks: Track[] = result.tracks || []; setCatalogTracks(tracks); warmList(tracks, 3) })
      .catch(error => { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : 'Не удалось открыть каталог') })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [view, catalogArtist?.id, catalogSource])
  useEffect(() => {
    if (view !== 'recommendations' || recommendMode !== 'mix') return
    const library = withoutDisliked([...new Map([...mediaLibrary, ...favorites, ...history, ...recommendSeeds].filter(track => track?.id && track.title).map(track => [track.id, track])).values()], dislikes)
    const artists = [...new Set((user?.artists || []).map(id => artistById(id)?.name).filter((name): name is string => Boolean(name)))]
    if (!library.length && !artists.length) { setRecommendations([]); setRecommendLoading(false); setRecommendError(''); return }
    const controller = new AbortController()
    const refresh = recommendFresh.current
    recommendFresh.current = false
    const excludeIds = [...new Set([...library.map(track => track.id), ...offline.map(track => track.id)])]
    const knownArtists = [...new Set([...artists, ...library.map(track => track.artist)])]
    setRecommendLoading(true); setRecommendError(''); setRecommendations([])
    fetch('/api/recommendations/mix', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tracks: library.slice(0, 40).map(stripTrack), artists, excludeIds, knownArtists, limit: 24, source: recommendSource, refresh, avoid: avoidHint(dislikes) }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось собрать микс'); return result })
      .then(result => { if (!controller.signal.aborted) { const tracks = withoutDisliked((result.tracks || []) as Track[], dislikes); setRecommendations(tracks); warmList(tracks, 3) } })
      .catch(cause => { if (!controller.signal.aborted) setRecommendError(cause instanceof Error ? cause.message : 'Не удалось собрать микс') })
      .finally(() => { if (!controller.signal.aborted) setRecommendLoading(false) })
    return () => controller.abort()
  }, [view, recommendMode, recommendSource, mixNonce, user?.artists.join(','), dislikeKey])
  useEffect(() => {
    if (view !== 'recommendations' || recommendMode !== 'seed' || !recommendSeed) { setRecommendations([]); setRecommendLoading(false); setRecommendError(''); return }
    const controller = new AbortController()
    const { track, scope } = recommendSeed
    const refresh = recommendFresh.current
    recommendFresh.current = false
    const params = new URLSearchParams({ artist: track.artist, title: scope === 'artist' ? '' : track.title, id: track.id, scope, limit: '24', source: recommendSource })
    if (refresh) params.set('refresh', '1')
    const avoid = avoidHint(dislikes).slice(0, 24)
    if (avoid.length) params.set('avoid', JSON.stringify(avoid))
    setRecommendLoading(true); setRecommendError(''); setRecommendations([])
    fetch(`/api/recommendations?${params}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось собрать рекомендации'); return result })
      .then(result => { if (!controller.signal.aborted) { const tracks = withoutDisliked((result.tracks || []) as Track[], dislikes); setRecommendations(tracks); warmList(tracks, 3) } })
      .catch(cause => { if (!controller.signal.aborted) setRecommendError(cause instanceof Error ? cause.message : 'Не удалось собрать рекомендации') })
      .finally(() => { if (!controller.signal.aborted) setRecommendLoading(false) })
    return () => controller.abort()
  }, [view, recommendSeed, recommendMode, recommendSource, dislikeKey])
  useEffect(() => {
    if (view !== 'recommendations' || recommendMode !== 'collection') return
    if (!recommendSeeds.length) { setRecommendations([]); setRecommendLoading(false); setRecommendError(''); return }
    const controller = new AbortController()
    const refresh = recommendFresh.current
    recommendFresh.current = false
    setRecommendLoading(true); setRecommendError(''); setRecommendations([])
    fetch('/api/recommendations/collection', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tracks: recommendSeeds.slice(0, 3).map(stripTrack), limit: 24, source: recommendSource, refresh, avoid: avoidHint(dislikes) }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Не удалось собрать поток по подборке'); return result })
      .then(result => { if (!controller.signal.aborted) { const tracks = withoutDisliked((result.tracks || []) as Track[], dislikes); setRecommendations(tracks); warmList(tracks, 3) } })
      .catch(cause => { if (!controller.signal.aborted) setRecommendError(cause instanceof Error ? cause.message : 'Не удалось собрать поток по подборке') })
      .finally(() => { if (!controller.signal.aborted) setRecommendLoading(false) })
    return () => controller.abort()
  }, [view, recommendMode, recommendSeeds, collectionNonce, recommendSource, dislikeKey])
  useEffect(() => { if (!user?.artists.length || !apiReady) { setFollowingTracks([]); return } const names = user.artists.map(artistById).filter((artist): artist is NonNullable<typeof artist> => Boolean(artist)).slice(0, 8).map(artist => artist.name); const controller = new AbortController(); fetch(`/api/following?artists=${encodeURIComponent(names.join(','))}`, { signal: controller.signal }).then(response => response.json()).then(result => { if (!controller.signal.aborted) setFollowingTracks(result.tracks || []) }).catch(() => {}); return () => controller.abort() }, [user?.artists.join(','), apiReady, dynamicArtistCount])
  useEffect(() => { if (!current || current.source !== 'soundcloud' || !frameRef.current || !window.SC) return; const widget = window.SC.Widget(frameRef.current); widgetRef.current = widget; const e = window.SC.Widget.Events; widget.bind(e.READY, () => { widget.setVolume(volume); widget.getDuration(ms => setDuration(ms / 1000)); const seekAt = soundCloudSeek.current; if (seekAt > 0) { soundCloudSeek.current = 0; widget.seekTo(seekAt * 1000); soundCloudClock.current = { position: seekAt, at: performance.now() }; applyPlayhead(seekAt, true) } if (playing) widget.play() }); widget.bind(e.PLAY, () => { soundCloudClock.current = { position: soundCloudClock.current.position, at: performance.now() }; setPlaying(true) }); widget.bind(e.PAUSE, () => setPlaying(false)); widget.bind(e.FINISH, () => { setPlaying(false); if (loop) { widget.seekTo(0); widget.play() } else if (queue.length > 1) skip(1); else if (settings.autoplaySimilar) autoplaySimilar() }); widget.bind(e.PLAY_PROGRESS, data => { if (data?.currentPosition !== undefined) { soundCloudClock.current = { position: data.currentPosition / 1000, at: performance.now() }; applyPlayhead(data.currentPosition / 1000) } }); return () => { widgetRef.current = null } }, [current?.id, loop, settings.autoplaySimilar])
  useEffect(() => { const audio = audioRef.current; if (current?.source !== 'soundcloud' && audio) { if (!fadeTimer.current && !fadeInPending.current) audio.volume = volume / 100; if (playing) startAudio(audio); else audio.pause() } else if (current?.source === 'soundcloud') { widgetRef.current?.setVolume(volume) } }, [playing, volume, current?.id])
  useEffect(() => { if (!current) return; setLyrics([]); setPlainLyrics(''); setLyricsStatus('Ищем синхронный текст…'); setVideo(null); const controller = new AbortController(); const params = new URLSearchParams({ track_name: current.title, artist_name: current.artist }); if (current.fullDuration || current.duration) params.set('duration', String(Math.round(current.fullDuration || current.duration || 0))); fetch(`https://lrclib.net/api/get?${params}`, { headers: { 'Lrclib-Client': 'Kinetix/1.0 (local app)' }, signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(String(r.status)); return r.json() }).then(data => { if (data.syncedLyrics) setLyrics(parseLrc(data.syncedLyrics)); else if (data.plainLyrics) setPlainLyrics(data.plainLyrics); else setLyricsStatus('Для этого трека текст пока не найден') }).catch(() => setLyricsStatus('Для этого трека текст пока не найден')); if (current.source === 'youtube') setVideo(current.url || null); else fetch(`/api/video?artist=${encodeURIComponent(current.artist)}&title=${encodeURIComponent(current.title)}`, { signal: controller.signal }).then(r => r.json()).then(data => setVideo(data.url || null)).catch(() => {}); return () => controller.abort() }, [current?.id])
  useEffect(() => {
    const text = query.trim()
    if (!text || text.includes('soundcloud.com/')) { setResults([]); setLoading(false); return }
    setResults([])
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    const controller = new AbortController()
    searchTimeout.current = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}&mode=title&source=${searchSource}`, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Ошибка поиска')
        setResults(data.tracks || [])
        warmList(data.tracks || [], 3)
      } catch (error) {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : 'Ошибка поиска')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 380)
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); controller.abort() }
  }, [query, searchSource, searchNonce])
  useEffect(() => {
    if (!playing || !current) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      if (now - last >= 32) {
        const next = current.source === 'soundcloud' ? soundCloudClock.current.position + (now - soundCloudClock.current.at) / 1000 : audioRef.current?.currentTime
        if (next !== undefined && seekDraftRef.current === null) applyPlayhead(Math.min(next, durationRef.current || next))
        last = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, current?.id, current?.source])
  useEffect(() => {
    if (!playing || !current || queue.length < 2) return
    const index = queue.findIndex(track => track.id === current.id)
    if (index < 0) return
    // Warm three ahead in parallel. Earlier entries stay warm: nothing evicts them, so roughly the last ten played tracks keep their resolved stream.
    for (let step = 1; step <= 3; step++) {
      const track = queue[(index + step) % queue.length]
      if (track.id === current.id) break
      void warmStream(track)
    }
  }, [playing, current?.id, queue])
  useEffect(() => {
    if (!playing || !current || !settings.autoplaySimilar) return
    const index = queue.findIndex(track => track.id === current.id)
    const upcoming = index >= 0 ? queue.length - index - 1 : queue.filter(track => track.id !== current.id).length
    if (upcoming >= 2) return
    const timer = setTimeout(() => { void extendWave() }, 2200)
    return () => clearTimeout(timer)
  }, [playing, current?.id, queue, settings.autoplaySimilar])
  useEffect(() => {
    if (!user) { setListenStats(null); return }
    // Stats imported without a session wait until the account exists on this install.
    takePendingListenStats(user.id)
    setListenStats(loadListenStats(user.id))
  }, [user?.id])
  useEffect(() => {
    if (!playing || !current || !user) return
    const userId = user.id
    const track = current
    const readPlayhead = () => track.source === 'soundcloud'
      ? soundCloudClock.current.position + (performance.now() - soundCloudClock.current.at) / 1000
      : audioRef.current?.currentTime ?? 0
    let mark = readPlayhead()
    let published = Date.now()
    const timer = setInterval(() => {
      const audio = audioRef.current
      if (track.source !== 'soundcloud' && (!audio || audio.paused)) return
      const now = readPlayhead()
      const delta = now - mark
      mark = now
      if (delta < .25 || delta > 8) return
      const stats = addListenTime(userId, track, delta)
      // Weekly pulse and the year recap do not need to refresh every two seconds:
      // publishing them at a slower rhythm keeps idle scrolling free of re-renders.
      if (Date.now() - published >= 15000) { published = Date.now(); setListenStats(stats) }
    }, 2000)
    return () => { clearInterval(timer); if (userRef.current?.id === userId) setListenStats(loadListenStats(userId)) }
  }, [playing, current?.id, user?.id])

  function select(track: Track, list: Track[] = [track], startAt = 0) {
    if (current && current.id !== track.id) setHistory(prev => prev[0]?.id === current.id ? prev : [{ ...current }, ...prev].slice(0, 40))
    const audio = audioRef.current
    const sameLoaded = Boolean(current && current.id === track.id && audio && current.source !== 'soundcloud' && track.source !== 'soundcloud')
    if (sameLoaded && audio) {
      const known = readDuration(audio) || duration || track.duration || track.fullDuration || 0
      const target = known > 0 ? Math.min(Math.max(0, startAt), Math.max(0, known - .25)) : Math.max(0, startAt)
      if (target > 0) {
        try { audio.currentTime = target } catch { /* The stream may still be loading: requestSeek retries until it lands. */ }
        requestSeek(track, target, 6000)
      } else {
        pendingSeek.current = null
        stopSeekWatch()
      }
      if (audio.paused) audio.play().catch(() => setPlaying(false))
      setQueue(list); seekDraftRef.current = null; setSeekDraft(null); setDuration(known); applyPlayhead(target, true); setCurrent(track); setPlaying(true); setBuffering(false)
      return
    }
    if (current && current.id === track.id && track.source === 'soundcloud') {
      soundCloudSeek.current = startAt
      soundCloudClock.current = { position: startAt, at: performance.now() }
      widgetRef.current?.seekTo(startAt * 1000)
      widgetRef.current?.play()
      setQueue(list); seekDraftRef.current = null; setSeekDraft(null); applyPlayhead(startAt, true); setCurrent(track); setPlaying(true); setBuffering(false)
      return
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    requestSeek(track, startAt, 12000)
    soundCloudSeek.current = track.source === 'soundcloud' ? startAt : 0
    fadeInPending.current = settings.crossfade > 0
    fadingOut.current = false
    setQueue(list); seekDraftRef.current = null; setSeekDraft(null); applyPlayhead(startAt, true)
    soundCloudClock.current = { position: startAt, at: performance.now() }
    setDuration(Number.isFinite(track.duration) && track.duration! > 0 ? track.duration! : Number.isFinite(track.fullDuration) && track.fullDuration! > 0 ? track.fullDuration! : 0)
    setCurrent(track); setPlaying(true)
    setBuffering(track.source === 'youtube' || track.source === 'yandex' || track.source === 'vk')
    if (track.source === 'local' && track.blob) { objectUrlRef.current = URL.createObjectURL(track.blob); setTimeout(() => audioRef.current?.play().catch(() => setPlaying(false)), 40) }
    if (track.source === 'yandex' && !apiConfig.yandexFull && !yandexNotice.current) { yandexNotice.current = true; setNotice('Яндекс Музыка без токена: 30-секундное превью. Полный трек — с YANDEX_MUSIC_TOKEN в .env') }
  }
  function handleAudioError(event: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget
    if (audio.error?.code === 1) return
    if (!current) return
    if ((current.source === 'youtube' || current.source === 'yandex' || current.source === 'vk') && current.streamUrl && errorRetries.current < 2) {
      errorRetries.current += 1
      const resume = Number.isFinite(audio.currentTime) ? audio.currentTime : positionRef.current
      setBuffering(true)
      setNotice('Поток прервался — переподключаем…')
      audio.src = `${current.streamUrl}${current.streamUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`
      audio.load()
      audio.play().catch(() => {})
      if (resume > 1) requestSeek(current, resume, 15000)
      return
    }
    if (settings.autoplaySimilar && queue.length > 1) {
      const now = Date.now()
      if (now - autoSkipGuard.current.at > 45000) autoSkipGuard.current.count = 0
      if (autoSkipGuard.current.count >= 2) {
        setBuffering(false)
        setPlaying(false)
        setNotice(current.source === 'youtube' ? 'YouTube не отдаёт поток — включите или перезапустите VPN' : 'Сеть не отвечает — проверьте VPN и попробуйте снова')
        return
      }
      const index = queue.findIndex(track => track.id === current.id)
      const next = queue[index >= 0 ? (index + 1) % queue.length : 0]
      if (next && next.id !== current.id) {
        autoSkipGuard.current = { count: autoSkipGuard.current.count + 1, at: now }
        setBuffering(false)
        setNotice(`«${current.title}» недоступен — волна идёт дальше`)
        skip(1)
        return
      }
    }
    setBuffering(false)
    setPlaying(false)
    setNotice(current.source === 'youtube' ? 'YouTube не отдал поток. Включите VPN и попробуйте ещё раз или выберите другой трек.' : 'Не удалось загрузить поток. Проверьте VPN и попробуйте ещё раз.')
  }
  function stopSeekWatch() {
    if (seekWatch.current) { clearInterval(seekWatch.current); seekWatch.current = null }
  }
  function applySeekTarget(target: { id: string; at: number; until: number }) {
    const audio = audioRef.current
    if (!audio || currentRef.current?.id !== target.id || audio.readyState < 1 || audio.seeking) return
    const known = readDuration(audio)
    const goal = known > 1 ? Math.min(target.at, Math.max(0, known - .25)) : target.at
    if (audio.readyState >= 2 && Math.abs(audio.currentTime - goal) < 1) { pendingSeek.current = null; stopSeekWatch(); return }
    if (Math.abs(audio.currentTime - goal) < .35) return
    try { audio.currentTime = goal; applyPlayhead(goal, true) } catch { /* Retry on the next tick while the stream exposes its timeline. */ }
  }
  function startSeekWatch() {
    if (seekWatch.current) return
    seekWatch.current = setInterval(() => {
      const target = pendingSeek.current
      if (!target) { stopSeekWatch(); return }
      if (currentRef.current?.id !== target.id || Date.now() > target.hardUntil) { pendingSeek.current = null; stopSeekWatch(); return }
      const audio = audioRef.current
      if (Date.now() > target.until) {
        if (audio && audio.readyState < 2 && !audio.error) target.until = Date.now() + 6000
        else { pendingSeek.current = null; stopSeekWatch(); return }
      }
      applySeekTarget(target)
    }, 200)
  }
  function requestSeek(track: Track, at: number, hold = 9000) {
    if (!(at > 0)) { pendingSeek.current = null; stopSeekWatch(); return }
    const now = Date.now()
    pendingSeek.current = { id: track.id, at, until: now + hold, hardUntil: now + hold + 30000 }
    startSeekWatch()
  }
  function applyPendingSeek(audio: HTMLAudioElement) {
    const target = pendingSeek.current
    if (!target || currentRef.current?.id !== target.id) return
    if (audio.readyState < 1) { startSeekWatch(); return }
    applySeekTarget(target)
    if (pendingSeek.current) startSeekWatch()
  }
  function handleLoadedMetadata(event: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget
    const known = readDuration(audio)
    if (known > 0) setDuration(known)
    applyPendingSeek(audio)
  }
  function handleDurationChange(event: React.SyntheticEvent<HTMLAudioElement>) {
    const known = readDuration(event.currentTarget)
    if (known > 0) setDuration(known)
  }
  function handleCanPlay(event: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget
    if (!(duration > 0)) { const known = readDuration(audio); if (known > 0) setDuration(known) }
    applyPendingSeek(audio)
    setBuffering(false)
  }
  function handleProgress(event: React.SyntheticEvent<HTMLAudioElement>) {
    if (duration > 0) return
    const known = readDuration(event.currentTarget)
    if (known > 0) setDuration(known)
  }
  function reloadStream(audio: HTMLAudioElement, track: Track, url: string) {
    streamRecover.current = { id: track.id, at: Date.now() }
    const resume = positionRef.current
    audio.src = `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`
    audio.load()
    if (resume > 1) requestSeek(track, resume, 15000)
  }
  function startAudio(audio: HTMLAudioElement) {
    const track = currentRef.current
    const url = track?.streamUrl || ''
    const dead = Boolean(audio.error) || audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
    if (dead && track && url) reloadStream(audio, track, url)
    audio.play().catch(() => {
      // Safari will not restart an element whose transfer died, so hand it a
      // fresh URL once instead of leaving the play button doing nothing.
      const recent = streamRecover.current.id === track?.id && Date.now() - streamRecover.current.at < 4000
      if (!track || !url || recent) { setPlaying(false); return }
      reloadStream(audio, track, url)
      audio.play().catch(() => setPlaying(false))
    })
  }
  function togglePlay() { if (!current) return; if (current.source === 'soundcloud') { playing ? widgetRef.current?.pause() : widgetRef.current?.play() } else { if (!playing && audioRef.current && audioRef.current.volume < .01 && !fadeTimer.current) rampVolume(volume / 100, .4); setPlaying(!playing) } }
  function seek(value: number) { applyPlayhead(value, true); soundCloudClock.current = { position: value, at: performance.now() }; current?.source === 'soundcloud' ? widgetRef.current?.seekTo(value * 1000) : audioRef.current && (audioRef.current.currentTime = value); if (current) pushNowPlaying(current, playing, durationRef.current, value) }
  function toggleFavorite(track: Track) { const exists = favorites.some(t => t.id === track.id); setFavorites(exists ? favorites.filter(t => t.id !== track.id) : [track, ...favorites]); setNotice(exists ? 'Убрано из любимых' : 'Добавлено в любимые') }
  function toggleLibrary(track: Track) { const exists = mediaLibrary.some(t => t.id === track.id); setMediaLibrary(exists ? mediaLibrary.filter(t => t.id !== track.id) : [track, ...mediaLibrary]); setNotice(exists ? 'Убрано из медиатеки' : 'Добавлено в медиатеку') }
  async function importUrl(value: string) { const url = value.trim(); if (!/^https:\/\/(www\.|m\.)?soundcloud\.com\//i.test(url)) { setNotice('Вставьте ссылку на публичный трек'); return } setLoading(true); try { const response = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`); if (!response.ok) throw new Error('Трек не найден'); const data = await response.json(); const titleParts = String(data.title || 'Внешний трек').split(' by '); const track: Track = { id: `sc:${url}`, title: titleParts[0], artist: titleParts.slice(1).join(' by ') || 'Внешний источник', artwork: data.thumbnail_url, url, source: 'soundcloud' }; setMediaLibrary(prev => prev.some(t => t.id === track.id) ? prev : [track, ...prev]); select(track); setQuery(''); setNotice('Трек добавлен') } catch { setNotice('Не удалось загрузить трек. Проверьте ссылку и доступность.') } finally { setLoading(false) } }
  async function playFeatured() { setLoading(true); try { const response = await fetch('/api/genre?genre=electronic'); const data = await response.json(); const track = data.tracks?.[0] as Track | undefined; if (!response.ok || !track) throw new Error(data.error || 'Не удалось подобрать трек'); select(track, data.tracks) } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось включить музыку') } finally { setLoading(false) } }
  function continueListening() {
    const track = current || history[0] || null
    if (!track) { void playFeatured(); return }
    if (current) select(current, queue.length ? queue : [current], positionRef.current)
    else select(track, [track])
  }
  async function addFiles(files: FileList | null, fromFolder = false) {
    if (!files?.length) return
    const added: Track[] = []
    const folders = new Set<string>()
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('audio/')) continue
      const base = file.name.replace(/\.[^.]+$/, '')
      const parts = base.split(' - ')
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || ''
      const folder = fromFolder && relative.includes('/') ? relative.split('/').slice(0, -1).join('/') : ''
      if (folder) folders.add(folder)
      const track: Track = { id: `local:${crypto.randomUUID()}`, title: parts.length > 1 ? parts.slice(1).join(' - ') : base, artist: parts.length > 1 ? parts[0] : 'Мои файлы', source: 'local', blob: file }
      if (folder) track.folder = folder
      await saveOffline(track)
      added.push(track)
    }
    setOffline(prev => [...added, ...prev])
    if (added.length) {
      setOfflineFolder('all')
      setView('offline')
      setNotice(folders.size ? `Добавлено ${added.length} файл(ов) из ${folders.size} папок` : `${added.length} файл(ов) доступны оффлайн`)
    } else setNotice('Поддерживаются аудиофайлы')
  }
  async function deleteLocal(track: Track) {
    if (track.offlineKey) {
      try {
        const response = await fetch(`/api/offline?key=${encodeURIComponent(track.offlineKey)}`, { method: 'DELETE' })
        if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Не удалось удалить кэш') }
        setServerOffline(prev => prev.filter(item => item.offlineKey !== track.offlineKey))
        if (current?.id === track.id) { setCurrent(null); setPlaying(false) }
        setNotice('Трек удалён из офлайн-кэша')
      } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось удалить кэш') }
      return
    }
    await removeOffline(track.id); setOffline(prev => prev.filter(t => t.id !== track.id)); if (current?.id === track.id) { setCurrent(null); setPlaying(false) } setNotice('Файл удалён из оффлайн-хранилища')
  }
  async function cacheOfflineTrack(track: Track) {
    if (serverCachingId) return
    if (!['youtube', 'yandex', 'vk', 'archive'].includes(track.source)) { setNotice('Этот источник нельзя сохранить офлайн'); return }
    if (track.offlineKey || serverOffline.some(item => item.id === track.id)) { setNotice('Трек уже доступен офлайн'); return }
    setServerCachingId(track.id)
    setNotice(`Скачиваем «${track.title}» на сервер — можно продолжать слушать`)
    try {
      const response = await fetch('/api/offline', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ track: stripTrack(track) }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось скачать трек')
      if (result.track) setServerOffline(prev => [serverOfflineTrack(result.track), ...prev.filter(item => item.offlineKey !== result.track.key)])
      setNotice(`«${track.title}» доступен офлайн`)
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось скачать трек') }
    finally { setServerCachingId(null) }
  }
  async function deleteOfflineFolder(folder: string) {
    const targets = offline.filter(track => track.folder === folder)
    if (!targets.length) return
    await Promise.all(targets.map(track => removeOffline(track.id).catch(() => {})))
    const ids = new Set(targets.map(track => track.id))
    setOffline(prev => prev.filter(track => !ids.has(track.id)))
    setQueue(prev => prev.filter(track => !ids.has(track.id)))
    setHistory(prev => prev.filter(track => !ids.has(track.id)))
    setFavorites(prev => prev.filter(track => !ids.has(track.id)))
    setMediaLibrary(prev => prev.filter(track => !ids.has(track.id)))
    if (current && ids.has(current.id)) { setCurrent(null); setPlaying(false) }
    setOfflineFolder('all')
    setNotice(`Папка «${folder.split('/').pop()}» удалена · ${targets.length} файл(ов)`)
  }
  function swipeDelete(track: Track) {
    if (track.source === 'local' || track.offlineKey) { void deleteLocal(track); return }
    if (!favorites.some(item => item.id === track.id) && !mediaLibrary.some(item => item.id === track.id)) { setNotice('Трек уже не сохранён в твоей коллекции'); return }
    setFavorites(prev => prev.filter(item => item.id !== track.id))
    setMediaLibrary(prev => prev.filter(item => item.id !== track.id))
    setNotice('Трек убран из твоей коллекции')
  }
  function markNotInterested(track: Track) {
    const similar = (item: Track) => isSimilarTo(track, item)
    const remaining = queue.filter(item => !similar(item))
    if (current?.id === track.id) {
      const index = queue.findIndex(item => item.id === track.id)
      const next = queue.slice(index + 1).find(item => !similar(item)) || remaining[0] || null
      if (next && next.id !== track.id) select(next, remaining.length ? remaining : [next])
      else { setQueue([]); setCurrent(null); setPlaying(false) }
    } else {
      setQueue(prev => prev.filter(item => !similar(item)))
    }
    setHistory(prev => prev.filter(item => !similar(item)))
    setRecommendations(prev => prev.filter(item => !similar(item)))
    setRecommendSeed(prev => prev && similar(prev.track) ? null : prev)
    setDislikes(prev => prev.some(item => item.id === track.id) ? prev : [stripTrack(track), ...prev].slice(0, 200))
    setNotice(`«${track.title}» больше не попадётся — похожие треки тоже`)
  }
  function restoreDislike(track: Track) {
    setDislikes(prev => prev.filter(item => item.id !== track.id))
    setNotice(`«${track.title}» снова может попадаться в рекомендациях`)
  }
  function clearDislikes() {
    setDislikes([])
    setNotice('Список неинтересных очищен')
  }
  async function downloadArchiveTrack(track: Track) {
    if (track.source !== 'archive' || downloadingId) return
    const match = track.id.match(/^archive:([^:]+):(.+)$/)
    if (!match) return
    setDownloadingId(track.id)
    try {
      const response = await fetch(`/api/archive-download?id=${encodeURIComponent(match[1])}&file=${encodeURIComponent(match[2])}`)
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'Ошибка загрузки') }
      const blob = await response.blob()
      const copy: Track = { ...track, id: `local:${track.id}`, source: 'local', blob, streamUrl: undefined }
      await saveOffline(copy)
      setOffline(previous => [copy, ...previous.filter(item => item.id !== copy.id)])
      setNotice('Трек сохранён для прослушивания без сети')
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось загрузить трек') }
    finally { setDownloadingId(null) }
  }
  function skip(direction: number, force = false) {
    if (!current) return
    if (direction < 0 && !force && positionRef.current > 3) { seek(0); return }
    const list = queue.length ? queue : current.source === 'local' ? offline : mediaLibrary.length ? mediaLibrary : favorites
    const index = list.findIndex(t => t.id === current.id)
    if (list.length > 1 && index >= 0) select(list[(index + direction + list.length) % list.length], list)
    else seek(Math.max(0, Math.min(durationRef.current || Infinity, positionRef.current + direction * 15)))
  }
  function beginMiniSwipe(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || !window.matchMedia('(max-width: 680px)').matches) return
    if ((event.target as HTMLElement).closest('button, a, input, label')) return
    miniSwipe.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dx: 0, axis: null, active: false }
    miniSwipeSuppress.current = false
  }
  function moveMiniSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const state = miniSwipe.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      state.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      if (state.axis !== 'x') { miniSwipe.current = null; return }
      state.active = true
      miniSwipeSuppress.current = true
      if (miniTrackRef.current) miniTrackRef.current.style.transition = 'none'
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is a progressive enhancement. */ }
    }
    if (state.axis !== 'x') return
    state.dx = dx
    const el = miniTrackRef.current
    if (!el) return
    const shift = Math.max(-92, Math.min(92, dx * .62))
    el.style.transform = `translate3d(${shift}px, 0, 0)`
    el.style.opacity = String(Math.max(.5, 1 - Math.abs(shift) / 210))
  }
  function endMiniSwipe(event: React.PointerEvent<HTMLDivElement>) {
    const state = miniSwipe.current
    if (!state || state.pointerId !== event.pointerId) return
    miniSwipe.current = null
    const el = miniTrackRef.current
    if (!state.active || !el) return
    const direction = state.dx < 0 ? 1 : -1
    if (miniSwipeTimer.current) clearTimeout(miniSwipeTimer.current)
    el.style.transition = ''
    if (Math.abs(state.dx) < 48) {
      el.style.transform = ''
      el.style.opacity = ''
      miniSwipeTimer.current = setTimeout(() => { miniSwipeSuppress.current = false }, 280)
      return
    }
    el.style.transform = `translate3d(${direction * -68}px, 0, 0)`
    el.style.opacity = '0'
    miniSwipeTimer.current = setTimeout(() => {
      skip(direction, true)
      const node = miniTrackRef.current
      if (!node) { miniSwipeSuppress.current = false; return }
      node.style.transition = 'none'
      node.style.transform = `translate3d(${direction * 42}px, 0, 0)`
      void node.offsetWidth
      node.style.transition = ''
      node.style.transform = ''
      node.style.opacity = ''
      miniSwipeTimer.current = setTimeout(() => { miniSwipeSuppress.current = false }, 340)
    }, 150)
  }
  function beginOverlaySwipe(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return
    if ((event.target as HTMLElement).closest('button, a, input, label, .overlay-lyrics, .overlay-progress, .overlay-controls, .player-menu')) return
    overlaySwipe.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dy: 0, active: false, startedAt: performance.now() }
  }
  function moveOverlaySwipe(event: React.PointerEvent<HTMLDivElement>) {
    const state = overlaySwipe.current
    if (!state || state.pointerId !== event.pointerId) return
    const dy = event.clientY - state.startY
    const dx = event.clientX - state.startX
    if (!state.active) {
      if (dy < 6) return
      // Lock the gesture on the first real movement. A clearly sideways swipe
      // still belongs to the carousels below, but a little drift must not kill
      // the pull-down.
      if (Math.abs(dx) > 24 && Math.abs(dx) > dy * 1.4) { overlaySwipe.current = null; return }
      state.active = true
      const el = overlayRef.current
      if (el) el.style.transition = 'none'
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is a progressive enhancement. */ }
    }
    state.dy = Math.max(0, dy)
    const el = overlayRef.current
    if (!el) return
    el.style.translate = `0 ${state.dy}px`
    el.style.scale = String(Math.max(.94, 1 - state.dy / 2400))
  }
  function endOverlaySwipe(event: React.PointerEvent<HTMLDivElement>) {
    const state = overlaySwipe.current
    if (!state || state.pointerId !== event.pointerId) return
    overlaySwipe.current = null
    const el = overlayRef.current
    if (!state.active || !el) return
    const elapsed = Math.max(1, performance.now() - state.startedAt)
    const collapse = state.dy > 96 || (state.dy > 48 && state.dy / elapsed > .45)
    el.style.transition = 'translate .24s cubic-bezier(.22,.8,.28,1), scale .24s ease'
    if (collapse) {
      el.style.translate = '0 108vh'
      el.style.scale = '.9'
      window.setTimeout(() => setPlayerOpen(false), 170)
      return
    }
    el.style.translate = '0 0px'
    el.style.scale = ''
    window.setTimeout(() => { if (overlayRef.current) { overlayRef.current.style.transition = ''; overlayRef.current.style.translate = '' } }, 260)
  }
  const waveKey = (track: Track) => `${track.artist}|${track.title}`
    .toLocaleLowerCase()
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/\b(official|video|audio|lyrics?|remaster(ed)?|visuali[sz]er|4k|hd|hq)\b/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  async function fetchWave(seed: Track) {
    const params = new URLSearchParams({ artist: seed.artist, title: seed.title, id: seed.id, scope: 'track', limit: '26', source: 'all' })
    const avoid = avoidHint(dislikes).slice(0, 24)
    if (avoid.length) params.set('avoid', JSON.stringify(avoid))
    const response = await fetch(`/api/recommendations?${params}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Волна не отвечает')
    const nearby = [...(current ? [current] : []), ...queue, ...history]
    const known = new Set(nearby.map(track => track.id).filter(Boolean))
    const fingerprints = new Set(nearby.map(waveKey))
    const list: Track[] = []
    for (const track of Array.isArray(data.tracks) ? data.tracks as Track[] : []) {
      if (!track?.id || !track.title || !track.artist) continue
      if (known.has(track.id) || playedWaveIds.current.has(track.id) || removedFromQueue.current.has(track.id) || fingerprints.has(waveKey(track))) continue
      if (dislikes.some(bad => isSimilarTo(bad, track))) continue
      known.add(track.id)
      fingerprints.add(waveKey(track))
      list.push(track)
      if (list.length >= 10) break
    }
    return list
  }
  async function extendWave() {
    if (!current || waveLoading.current || Date.now() < waveCooldown.current) return []
    waveLoading.current = true
    try {
      const tracks = await fetchWave(current)
      if (!tracks.length) { waveCooldown.current = Date.now() + 90_000; return [] }
      setQueue(list => {
        const base = list.length ? list : current ? [current] : []
        const ids = new Set(base.map(track => track.id))
        const fresh = tracks.filter(track => !ids.has(track.id))
        fresh.forEach(track => playedWaveIds.current.add(track.id))
        return fresh.length ? [...base, ...fresh] : base
      })
      warmList(tracks, 3)
      if (!waveNotified.current) { waveNotified.current = true; setNotice('Бесшовная волна: дальше — похожие треки из всех источников') }
      return tracks
    } catch { waveCooldown.current = Date.now() + 60_000; return [] }
    finally { waveLoading.current = false }
  }
  async function autoplaySimilar() {
    if (!current) return false
    const tracks = await extendWave()
    if (!tracks.length) return false
    const seed = currentRef.current || current
    select(tracks[0], [seed, ...tracks.filter(track => track.id !== seed.id)])
    return true
  }
  function handleTimeUpdate(event: React.SyntheticEvent<HTMLAudioElement>) {
    const audio = event.currentTarget
    applyPlayhead(audio.currentTime)
    const crossfade = settings.crossfade
    if (!crossfade || fadingOut.current || !playing) return
    const known = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration
    if (known > crossfade * 2 && known - audio.currentTime <= crossfade && known - audio.currentTime > 0) {
      fadingOut.current = true
      rampVolume(0, Math.min(crossfade, Math.max(.4, known - audio.currentTime)))
    }
  }
  function handlePlaying() {
    autoSkipGuard.current = { count: 0, at: 0 }
    setBuffering(false)
    if (audioRef.current) applyPendingSeek(audioRef.current)
    if (fadeInPending.current) {
      fadeInPending.current = false
      rampVolume(volume / 100, Math.max(1, Math.min(settings.crossfade, 6)))
    } else if (!fadeTimer.current) {
      const audio = audioRef.current
      if (audio) audio.volume = volume / 100
    }
  }
  async function saveMoment() {
    if (!current || !momentLines.length) return
    if (!user) { setSelectingMoment(false); setAuthOpen(true); return }
    try {
      const audio = audioRef.current
      const synced = lyrics.length > 0
      const lines = [...momentLines].sort((a, b) => a - b).map(index => { const line = availableMomentLines[index]; return { at: synced ? Math.max(0, line?.at || 0) : 0, text: line?.text || '' } })
      const playable = (audio ? readDuration(audio) : 0) || duration
      const track = { ...current, duration: playable > 0 ? playable : current.duration }
      const result = await request<{ user: User }>('/api/moments', 'POST', { lines, track })
      setUser(result.user)
      setMomentLines([])
      setSelectingMoment(false)
      setNotice('Момент сохранён в профиле')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось сохранить Момент') }
  }
  function openMomentDialog() { setMomentLines([]); setSelectingMoment(true) }
  function toggleMomentLine(index: number) {
    if (momentLines.includes(index)) { setMomentLines(lines => lines.filter(item => item !== index)); return }
    if (momentLines.length >= 8) return
    setMomentLines(lines => [...lines, index])
  }
  async function updateProfile(patch: Partial<User>) { const result = await request<{ user: User }>('/api/me', 'PATCH', patch); setUser(result.user); setNotice('Профиль обновлён') }
  async function deleteMoment(id: string) { try { const result = await request<{ user: User }>(`/api/moments/${id}`, 'DELETE'); setUser(result.user); setNotice('Момент удалён') } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось удалить Момент') } }
  async function playMoment(moment: Moment, at = moment.lines[0]?.at || 0) {
    const direct = trackFromMoment(moment)
    if (direct) {
      const known = [current, ...queue, ...results, ...catalogTracks, ...genreTracks, ...mediaLibrary, ...favorites, ...offline].find((track): track is Track => Boolean(track && track.id === direct.id))
      const prepared: Track = { ...direct, duration: direct.duration || known?.duration, fullDuration: known?.fullDuration }
      select(prepared, [prepared], at)
      setNotice(at > 0 ? `Возвращаемся на ${formatTime(at)} — «${moment.track.title}»` : `Включаем «${moment.track.title}»`)
      return
    }
    setLoading(true)
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(`${moment.track.artist} ${moment.track.title}`)}&mode=title&source=all`)
      const data = await response.json()
      const tracks = Array.isArray(data.tracks) ? data.tracks as Track[] : []
      const found = tracks.find(track => track.title.toLowerCase() === moment.track.title.toLowerCase()) || tracks[0]
      if (!found) { setNotice('Не удалось найти этот трек в источниках'); return }
      select(found, tracks, at)
      setNotice(at > 0 ? `Возвращаемся на ${formatTime(at)} — «${moment.track.title}»` : `Включаем «${moment.track.title}»`)
    } catch { setNotice('Не удалось включить трек из Момента') }
    finally { setLoading(false) }
  }
  async function playStatsTrack(track: TrackListenEntry, scope: 'итогов' | 'недели', onResolved?: () => void) {
    const known = [current, ...queue, ...results, ...catalogTracks, ...genreTracks, ...mediaLibrary, ...favorites, ...offline].find((item): item is Track => Boolean(item && item.id === track.id))
    const direct: Track = { id: track.id, title: track.title, artist: track.artist, artwork: track.artwork, source: track.source, duration: track.duration }
    const restored = known || hydrateStoredTrack(direct)
    if (restored) { onResolved?.(); select(restored, [restored]); return }
    setLoading(true)
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(`${track.artist} ${track.title}`)}&mode=title&source=all`)
      const data = await response.json()
      const tracks = Array.isArray(data.tracks) ? data.tracks as Track[] : []
      const plain = (value: string) => value.toLocaleLowerCase('ru-RU').replace(/\s*[([].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      const found = tracks.find(item => plain(item.title) === plain(track.title))
      if (!found) { setNotice(scope === 'итогов' ? 'Трек из итогов сейчас недоступен в источниках' : 'Главный трек недели сейчас недоступен в источниках'); return }
      onResolved?.()
      select(found, tracks)
    } catch { setNotice(scope === 'итогов' ? 'Не удалось включить трек из итогов' : 'Не удалось включить главный трек недели') }
    finally { setLoading(false) }
  }
  async function shareMoment(moment: Moment) {
    try {
      const result = await request<{ path: string }>(`/api/moments/${moment.id}/share`, 'POST')
      const url = `${window.location.origin}${result.path}`
      const first = moment.lines[0]?.text || moment.track.title
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: `«${first}» — ${moment.track.artist}`, text: `Момент из «${moment.track.title}» в Kinetix`, url })
          return
        } catch (cause) { if (cause instanceof DOMException && cause.name === 'AbortError') return }
      }
      try { await navigator.clipboard.writeText(url); setNotice('Ссылка на момент скопирована') }
      catch { setNotice(`Ссылка на момент: ${url}`) }
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось поделиться моментом') }
  }
  async function saveMomentImage(moment: Moment) {
    try {
      const dataUrl = await renderMomentCard(moment, user?.name || 'Слушатель')
      const name = `kinetix-moment-${moment.id.slice(0, 8)}.png`
      if (isAndroid) {
        saveAndroidData(name, 'image/png', dataUrl)
        setNotice(isIOS ? 'Карточка готова — выбери, куда сохранить' : 'Карточка Момента сохранена в Загрузки')
        return
      }
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = name
      link.click()
      setNotice('Карточка Момента сохранена')
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось сохранить карточку') }
  }
  async function logout() { await request('/api/auth/logout', 'POST'); setUser(null); setView('home'); setNotice('Вы вышли из аккаунта') }
  async function linkGoogle(idToken: string) { const result = await request<{ user: User }>('/api/auth/google', 'POST', { idToken }); setUser(result.user); setNotice('Google аккаунт привязан') }
  function adoptGoogleUser(account: User) { setUser(account); setNotice('Google аккаунт привязан') }
  function openArtist(ref: ArtistRef) {
    const name = String(ref?.name || '').trim()
    if (!name) return
    if (view !== 'artist') artistReturn.current = view
    setArtistStack(stack => {
      const last = stack[stack.length - 1]
      if (last && last.name.toLocaleLowerCase() === name.toLocaleLowerCase()) return stack
      return [...stack, { ...ref, name }]
    })
    setView('artist')
    setShowLyrics(false)
  }
  function closeArtist() {
    if (artistStack.length > 1) { setArtistStack(artistStack.slice(0, -1)); return }
    setArtistStack([])
    setView(artistReturn.current)
  }
  async function toggleFollowArtist(target: { id: string; name: string; image?: string }) {
    if (!user) { setAuthOpen(true); setNotice('Войдите в аккаунт, чтобы отслеживать исполнителей'); return }
    const followed = user.artists.includes(target.id)
    try {
      const result = await request<{ user: User }>('/api/me', 'PATCH', { artists: followed ? user.artists.filter(id => id !== target.id) : [...user.artists, target.id] })
      setUser(result.user)
      setNotice(followed ? `«${target.name}» больше не в поле зрения` : `«${target.name}» теперь в твоём поле зрения`)
      if (!followed) fetch(`/api/artists/lookup?ids=${encodeURIComponent(target.id)}`).then(response => response.json()).then(data => { const items = data.artists || []; registerArtists(items); setDynamicArtistCount(value => value + 1) }).catch(() => {})
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось обновить исполнителей') }
  }
  function openGenre(selected: Genre) { setGenre(selected); setGenreMood(''); setGenreQuery(''); setGenreSource('all'); setGenreNonce(0); setView('genre') }
  function refreshGenre() { setGenreNonce(value => value + 1) }
  function toggleGenreMood(value: string) { setGenreMood(current => current === value ? '' : value); setGenreQuery('') }
  function playGenre() { playTracks(genreShown) }
  function openSettings() { if (view !== 'settings') settingsReturn.current = view; setPlayerOpen(false); setView('settings') }
  function playerMenuContent(close: () => void) {
    if (!current) return null
    const moodActive = user?.statusTrack?.id === current.id
    return <>
      <button role="menuitem" onClick={() => { close(); openRecommendationsFor(current, 'track') }}><Sparkles size={16}/><span>Рекомендации по треку</span></button>
      <button role="menuitem" className={moodActive ? 'is-active' : ''} onClick={() => { close(); setStatusTrack(moodActive ? null : current) }}><Music2 size={16}/><span>{moodActive ? 'Убрать из настроения' : 'В моё настроение'}</span></button>
      <button role="menuitem" className={loop ? 'is-active' : ''} onClick={() => { close(); setLoop(!loop) }}><RotateCcw size={16}/><span>{loop ? 'Повтор включён' : 'Повтор трека'}</span></button>
      <button role="menuitem" className="is-danger" onClick={() => { close(); markNotInterested(current) }}><ThumbsDown size={16}/><span>Неинтересно</span></button>
      <div className="player-menu-sep"/>
      <button role="menuitem" onClick={() => { close(); openSettings() }}><Settings2 size={16}/><span>Настройки</span></button>
    </>
  }
  function beginMiniPress(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || !window.matchMedia('(max-width: 680px)').matches) return
    if ((event.target as HTMLElement).closest('button, a, input, label')) return
    if (mobileMenu === 'mini') return
    longPressFired.current = false
    if (miniPressTimer.current) clearTimeout(miniPressTimer.current)
    miniPressStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    setHoldingMini(true)
    miniPressTimer.current = setTimeout(() => {
      miniPressTimer.current = null
      longPressFired.current = true
      setHoldingMini(false)
      setPlayerMenu(false)
      setMobileMenu('mini')
      try { navigator.vibrate?.(12) } catch { /* Vibration is optional. */ }
    }, 480)
  }
  function moveMiniPress(event: React.PointerEvent<HTMLDivElement>) {
    const start = miniPressStart.current
    if (!start || start.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) endMiniPress()
  }
  function endMiniPress() {
    if (miniPressTimer.current) { clearTimeout(miniPressTimer.current); miniPressTimer.current = null }
    miniPressStart.current = null
    setHoldingMini(false)
  }
  function openCatalog() { setCatalogArtist(null); setView('catalog') }
  function openCatalogArtist(entry: CatalogEntry) {
    if (entry.kind === 'artist') { setCatalogArtist(null); openArtist({ id: entry.id, name: entry.name, tint: entry.tint, tags: entry.tags }); return }
    setCatalogArtist(entry); setView('catalog')
  }
  function playCatalog() { if (catalogTracks.length) select(catalogTracks[0], catalogTracks) }
  function playTracks(tracks: Track[], index = 0) {
    const playable = tracks.map(track => hydrateStoredTrack(track, offline)).filter((track): track is Track => Boolean(track))
    if (!playable.length) { setNotice('В этой подборке пока нет воспроизводимых треков'); return }
    const safeIndex = Math.min(Math.max(0, index), playable.length - 1)
    select(playable[safeIndex], playable)
  }
  function openPlaylist(id: string) { setPlaylistFocus({ id, nonce: Date.now() }); setView('playlists') }
  function playNext(track: Track) {
    const item = hydrateStoredTrack(track, offline)
    if (!item) { setNotice('Этот трек нельзя поставить в очередь'); return }
    if (!current) { select(item); return }
    setQueue(list => {
      const base = list.length ? list : [current]
      const rest = base.filter(entry => entry.id !== item.id)
      const anchor = rest.findIndex(entry => entry.id === current.id)
      rest.splice(anchor >= 0 ? anchor + 1 : 0, 0, item)
      return rest
    })
    setNotice(`«${item.title}» играет следующим`)
  }
  function queueTrack(track: Track) {
    const item = hydrateStoredTrack(track, offline)
    if (!item) { setNotice('Этот трек нельзя добавить в очередь'); return }
    setQueue(list => {
      const base = list.length ? list : current ? [current] : []
      return base.some(entry => entry.id === item.id) ? base : [...base, item]
    })
    if (!current) { select(item); return }
    setNotice(`«${item.title}» добавлен в конец очереди`)
  }
  function removeFromQueue(track: Track) {
    // A removed track must not sneak back through the seamless wave right away,
    // so its id stays off the wave for the rest of the session.
    removedFromQueue.current.add(track.id)
    const nowIndex = current ? queue.findIndex(entry => entry.id === current.id) : -1
    if (!queue.some((entry, index) => entry.id === track.id && index !== nowIndex)) return
    setQueue(list => {
      const activeIndex = current ? list.findIndex(entry => entry.id === current.id) : -1
      const index = list.findIndex((entry, position) => entry.id === track.id && position !== activeIndex)
      if (index < 0) return list
      const next = [...list]
      next.splice(index, 1)
      return next
    })
    waveCooldown.current = Date.now() + 6000
    setNotice(`«${track.title}» убран из очереди`)
  }
  function removeHistory(track: Track) { setHistory(list => list.filter(entry => entry.id !== track.id)) }
  function commitQueueOrder(historyNext: Track[], upcomingNext: Track[]) {
    setHistory(historyNext)
    setQueue(list => {
      const nowIndex = current ? list.findIndex(entry => entry.id === current.id) : -1
      const head = nowIndex >= 0 ? list.slice(0, nowIndex + 1) : []
      const tail = upcomingNext.map(track => hydrateStoredTrack(track, offline)).filter((track): track is Track => Boolean(track))
      return [...head, ...tail]
    })
  }
  function clearUpcoming() {
    setQueue(list => {
      if (!current) return []
      const index = list.findIndex(entry => entry.id === current.id)
      return index >= 0 ? list.slice(0, index + 1) : list.filter(entry => entry.id === current.id)
    })
  }
  function openRecommendations() {
    setRecommendMode('mix')
    setRecommendLoading(true)
    setView('recommendations')
  }
  function openRecommendationsFor(track: Track, scope: 'track' | 'artist' = 'track') {
    setRecommendMode('seed')
    setRecommendSeed({ track, scope, nonce: Date.now() })
    setRecommendLoading(true)
    setView('recommendations')
  }
  function openRecommendationCollection() { setRecommendMode('collection'); setRecommendLoading(true); setView('recommendations') }
  async function playRecommendationsNow() {
    if (homeLaunching) return
    setHomeLaunching(true)
    try {
      const library = withoutDisliked([...new Map([...mediaLibrary, ...favorites, ...history, ...recommendSeeds].filter(track => track?.id && track.title).map(track => [track.id, track])).values()], dislikes)
      const artists = [...new Set((user?.artists || []).map(id => artistById(id)?.name).filter((name): name is string => Boolean(name)))]
      if (!library.length && !artists.length) { openRecommendations(); return }
      const response = await fetch('/api/recommendations/mix', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tracks: library.slice(0, 40).map(stripTrack), artists, excludeIds: [...new Set([...library.map(track => track.id), ...offline.map(track => track.id)])], knownArtists: [...new Set([...artists, ...library.map(track => track.artist)])], limit: 10, source: recommendSource, refresh: false, avoid: avoidHint(dislikes) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Не удалось собрать микс')
      const tracks = withoutDisliked(Array.isArray(result.tracks) ? result.tracks as Track[] : [], dislikes)
      if (!tracks.length) { setNotice('Пока не удалось собрать микс — открой рекомендации'); openRecommendations(); return }
      select(tracks[0], tracks)
      warmList(tracks, 3)
      setNotice('Рекомендации уже играют — листай дальше без остановки')
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Не удалось запустить рекомендации') }
    finally { setHomeLaunching(false) }
  }
  function changeRecommendMode(mode: 'mix' | 'seed' | 'collection') {
    setRecommendMode(mode)
    setRecommendLoading(true)
    if (mode === 'seed' && !recommendSeed) {
      const track = current || favorites[0] || mediaLibrary[0] || followingTracks[0] || seedTracks[0] || null
      if (track) setRecommendSeed({ track, scope: 'track', nonce: Date.now() })
    }
  }
  function toggleRecommendSeed(track: Track) {
    const exists = recommendSeeds.some(item => item.id === track.id)
    if (!exists && recommendSeeds.length >= 12) { setNotice('В подборке уже 12 треков — сначала убери что-нибудь'); return }
    setRecommendSeeds(prev => exists ? prev.filter(item => item.id !== track.id) : [...prev, stripTrack(track)])
    setNotice(exists ? 'Убрано из подборки рекомендаций' : 'Добавлено в подборку рекомендаций')
  }
  function removeRecommendSeed(id: string) { setRecommendSeeds(prev => prev.filter(track => track.id !== id)) }
  function clearRecommendSeeds() { setRecommendSeeds([]); setNotice('Подборка рекомендаций очищена') }
  async function saveStatusTrack(track: Track | null) {
    if (!user) { setAuthOpen(true); setNotice('Войдите в аккаунт, чтобы закрепить настроение'); return }
    try {
      const result = await request<{ user: User }>('/api/me', 'PATCH', { statusTrack: track ? stripTrack(track) : null })
      setUser(result.user)
      setStatusPrompt(null)
      setNotice(track ? `«${track.title}» теперь в твоём настроении` : 'Настроение очищено')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось обновить настроение') }
  }
  function setStatusTrack(track: Track | null) {
    if (!track) { void saveStatusTrack(null); return }
    if (!user) { setAuthOpen(true); setNotice('Войдите в аккаунт, чтобы закрепить настроение'); return }
    if (user.statusTrack && user.statusTrack.id !== track.id) { setStatusPrompt(track); return }
    void saveStatusTrack(track)
  }
  const seedTracks = useMemo(() => {
    const pool = [...favorites, ...mediaLibrary, ...followingTracks, ...results, ...catalogTracks, ...genreTracks]
    return [...new Map(pool.filter(track => track?.id && track.title).map(track => [track.id, track])).values()]
  }, [favorites, mediaLibrary, followingTracks, results, catalogTracks, genreTracks])
  const tasteNames = useMemo(() => {
    const names = new Set<string>()
    for (const id of user?.artists || []) { const artist = artistById(id); if (artist) names.add(artist.name) }
    const lists = [followingTracks, mediaLibrary, favorites, history.slice(0, 40), recommendSeeds, ...(user?.playlists || []).map(playlist => playlist.tracks)]
    for (const list of lists) for (const track of list) if (track.artist && track.artist !== 'Мои файлы') names.add(track.artist)
    return [...names].slice(0, 80)
  }, [user?.artists.join(','), user?.playlists, followingTracks, mediaLibrary, favorites, history, recommendSeeds])
  const recommendationArt = useMemo(() => [...new Set([current?.artwork, ...favorites.map(track => track.artwork), ...mediaLibrary.map(track => track.artwork), ...seedTracks.map(track => track.artwork)].filter((value): value is string => Boolean(value)))].slice(0, 4), [current?.artwork, favorites, mediaLibrary, seedTracks])
  const mixReady = Boolean(mediaLibrary.length || favorites.length || user?.artists.length)
  const genreNeedle = genreQuery.trim().toLocaleLowerCase()
  const genreShown = useMemo(() => {
    const bySource = genreSource === 'all' ? genreTracks : genreTracks.filter(track => track.source === genreSource)
    if (!genreNeedle) return bySource
    return bySource.filter(track => `${track.title} ${track.artist}`.toLocaleLowerCase().includes(genreNeedle))
  }, [genreTracks, genreNeedle, genreSource])
  const offlineFolders = useMemo(() => [...new Set(offline.map(track => track.folder).filter((folder): folder is string => Boolean(folder)))].sort((a, b) => a.localeCompare(b)), [offline])
  useEffect(() => { if (offlineFolder !== 'all' && !offlineFolders.includes(offlineFolder)) setOfflineFolder('all') }, [offlineFolders, offlineFolder])
  const season = useMemo(() => recapSeason(), [])
  const homeRecapYear = useMemo(() => listenStats && season.active && hasRecap(listenStats, season.year) ? season.year : null, [listenStats, season])
  const profileRecapYear = useMemo(() => user ? pickRecapYear(listenStats, season.year) : null, [user, listenStats, season])
  const offlineTotal = offline.length + serverOffline.length
  const offlineTracks = offlineFolder === 'all' ? [...offline, ...serverOffline] : offline.filter(track => track.folder === offlineFolder)
  const shown = view === 'search' ? results : view === 'offline' ? offlineTracks : view === 'favorites' ? favorites : mediaLibrary
  const recentTracks = mediaLibrary.length ? mediaLibrary : favorites
  const trackListProps = { current, playing, onSelect: select, onSave: toggleFavorite, saved: favorites, onAddToLibrary: toggleLibrary, inLibrary: mediaLibrary, onDelete: deleteLocal, onDownload: downloadArchiveTrack, onCache: cacheOfflineTrack, serverOffline, cachingId: serverCachingId, offline, downloadingId, onPlaylist: (track: Track) => setPlaylistPickerTrack(track), onPlayNext: playNext, onQueue: queueTrack, onRecommend: (track: Track) => openRecommendationsFor(track, 'track'), onSimilar: (track: Track) => openRecommendationsFor(track, 'artist'), onArtist: openArtist, onStatus: setStatusTrack, statusTrackId: user?.statusTrack?.id, collection: recommendSeeds, onCollection: toggleRecommendSeed, onSwipeDelete: swipeDelete, swipeContext: view, onDislike: markNotInterested }
  const stageKey = view === 'artist' ? `artist:${activeArtist?.id || activeArtist?.name || ''}` : view === 'genre' ? `genre:${genre?.id || ''}` : view === 'catalog' ? `catalog:${catalogArtist?.id || 'all'}` : view

  return <div className={`app-shell ${desktopApp ? 'has-windowbar' : ''}`} style={ambientStyle}>
    <WindowBar/>
    <div className={`app-ambient ${coverBackground && current?.artwork ? 'has-art' : ''}`} aria-hidden="true">
      <span className="ambient-cover" key={current?.artwork || 'idle'}/>
      <span className="ambient-orb ambient-orb-a"/>
      <span className="ambient-orb ambient-orb-b"/>
      <span className="ambient-veil"/>
    </div>
    <aside className="sidebar">
      <Logo />
      <div className="sidebar-scroll">
        <div className="sidebar-label">МУЗЫКА</div>
        <nav className="side-nav">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><House size={19}/> Главная</button>
          <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}><Search size={19}/> Поиск</button>
          <button className={view === 'catalog' ? 'active' : ''} onClick={openCatalog}><Flame size={19}/> Каталоги</button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><Library size={19}/> Медиатека</button>
          <button className={view === 'playlists' ? 'active' : ''} onClick={() => setView('playlists')}><ListMusic size={19}/> Плейлисты <span className="nav-count">{user?.playlists.length || 0}</span></button>
          <button className={view === 'offline' ? 'active' : ''} onClick={() => setView('offline')}><Download size={19}/> Оффлайн <span className="nav-count">{offlineTotal}</span></button>
          <button className={view === 'profile' ? 'active' : ''} onClick={() => user ? setView('profile') : setAuthOpen(true)}><UserRound size={19}/> Профиль</button>
        </nav>
        <div className="sidebar-label collection-label">ТВОЯ КОЛЛЕКЦИЯ</div>
        <div className="side-collection">
          <button className={`collection-item ${view === "favorites" ? "selected" : ""}`} onClick={() => setView("favorites")}><span className="collection-icon"><Heart size={17} fill="currentColor"/></span><span className="collection-copy"><strong>Любимые треки</strong><small>Отмечено сердечком</small></span><span className="muted-count">{favorites.length}</span><span className="collection-sheen"/></button>
          {(user?.playlists || []).slice(0, 4).map(playlist => <button key={playlist.id} className="collection-item playlist-collection-item" onClick={() => openPlaylist(playlist.id)}><span className="collection-playlist-cover"><PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name} size="mini"/></span><span className="collection-copy"><strong>{playlist.name}</strong><small>{playlist.tracks.length} {playlist.tracks.length === 1 ? 'трек' : 'треков'}</small></span><span className="collection-sheen"/></button>)}
          {user && !user.playlists.length && <button className="collection-item playlist-collection-item is-new" onClick={() => setView('playlists')}><span className="collection-playlist-cover"><ListMusic size={16}/></span><span className="collection-copy"><strong>Собрать первый</strong><small>Свой плейлист</small></span><span className="collection-sheen"/></button>}
          {Boolean(user?.playlists.length) && <button className="collection-all" onClick={() => setView('playlists')}><span>Все плейлисты</span><span className="collection-all-count">{user!.playlists.length}</span><ArrowRight size={13}/></button>}
        </div>
      </div>
      <div className="sidebar-bottom"><div className="sidebar-orb">✦</div><p>Твой ритм.<br/><strong>Твои правила.</strong></p><div className="sidebar-bottom-actions"><button onClick={() => fileRef.current?.click()}>Добавить музыку <Plus size={15}/></button><button onClick={() => folderRef.current?.click()} title="Добавить папку с музыкой">Папка <FolderPlus size={14}/></button></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="mobile-logo"><Logo small/></div><div className="top-search"><Search size={19}/><input type="search" name="kinetix-search" autoComplete="off" spellCheck={false} value={query} onChange={e => { setQuery(e.target.value); if (e.target.value) setView('search') }} onKeyDown={e => { if (e.key === 'Enter' && query.includes('soundcloud.com/')) importUrl(query) }} placeholder="Исполнитель или трек" aria-label="Поиск музыки"/><span className="search-shortcut">⌘ K</span></div><button className="top-import" onClick={() => fileRef.current?.click()}><Plus size={18}/><span>Добавить музыку</span></button><button className="top-settings" onClick={openSettings} aria-label="Настройки приложения" title="Настройки"><Settings2 size={17}/></button><button className="avatar avatar-button" onClick={() => user ? setView('profile') : setAuthOpen(true)} aria-label={user ? 'Открыть профиль' : 'Войти в аккаунт'}>{user?.avatar ? <img src={user.avatar} alt=""/> : user?.name?.slice(0,1).toUpperCase() || 'K'}</button></header>
      {(view === 'library' || view === 'playlists' || view === 'offline') && <div className="lib-switch" role="tablist" aria-label="Медиатека">
        <button role="tab" aria-selected={view === 'library'} className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><Library size={16}/> Треки</button>
        <button role="tab" aria-selected={view === 'playlists'} className={view === 'playlists' ? 'active' : ''} onClick={() => setView('playlists')}><ListMusic size={16}/> Плейлисты{user?.playlists.length ? <span>{user.playlists.length}</span> : null}</button>
        <button role="tab" aria-selected={view === 'offline'} className={view === 'offline' ? 'active' : ''} onClick={() => setView('offline')}><Download size={16}/> Оффлайн{offlineTotal ? <span>{offlineTotal}</span> : null}</button>
      </div>}
      <div className="view-stage" key={stageKey}>
      {view === 'home' ?
        <HomeView key={dynamicArtistCount}
          onSearch={() => setView('search')}
          onImport={() => fileRef.current?.click()}
          onGenre={openGenre}
          onArtist={openArtist}
          onCatalog={openCatalog}
          onCatalogArtist={openCatalogArtist}
          onRecommendations={() => openRecommendations()}
          onRecommendationsNow={() => void playRecommendationsNow()}
          recommendationsLaunching={homeLaunching}
          onRecommendCollection={openRecommendationCollection}
          onContinue={continueListening}
          onPlayHistory={track => select(track, [track])}
          onPlayPulseTrack={track => void playStatsTrack(track, 'недели')}
          onOpenView={next => setView(next)}
          onOpenPlaylist={openPlaylist}
          collectionCount={recommendSeeds.length}
          collectionArt={[...new Set(recommendSeeds.map(track => track.artwork).filter((value): value is string => Boolean(value)))].slice(0, 3)}
          recommendationArt={recommendationArt}
          recommendSource={recommendSource}
          onRecommendSource={setRecommendSource}
          vkEnabled={apiConfig.vk}
          vkIssue={apiConfig.vkIssue}
          yandexFull={apiConfig.yandexFull}
          youtubeDl={apiConfig.youtubeDl}
          user={user}
          apiReady={apiReady}
          followedCount={followingTracks.length}
          followedTracks={<TrackList tracks={followingTracks.slice(0, 5)} {...trackListProps}/>}
          recent={recentTracks.length ? <TrackList tracks={recentTracks.slice(0, 5)} {...trackListProps}/> : <div className="empty-small"><Music2 size={22}/> Добавленные треки появятся здесь. Нажми «+» на треке или сохрани его сердечком.</div>}
          current={current}
          history={history}
          favoritesCount={favorites.length}
          libraryCount={mediaLibrary.length}
          listenStats={listenStats}
          recapYear={homeRecapYear}
          onOpenRecap={() => setRecapOpenYear(homeRecapYear)}
        /> : view === 'recommendations' ?
        <RecommendationsView seed={recommendSeed?.track || null} scope={recommendSeed?.scope || 'track'} mode={recommendMode} collection={recommendSeeds} tracks={recommendations} loading={recommendLoading} error={recommendError} current={current} playing={playing} source={recommendSource} onSource={setRecommendSource} vkEnabled={apiConfig.vk} vkIssue={apiConfig.vkIssue} yandexFull={apiConfig.yandexFull} youtubeDl={apiConfig.youtubeDl} mixArt={recommendationArt} mixReady={mixReady} onBack={() => setView('home')} onPlayAll={() => playTracks(recommendations, 0)} onShuffle={() => playTracks([...recommendations].sort(() => Math.random() - .5), 0)} onRefresh={() => { recommendFresh.current = true; if (recommendMode === 'seed') setRecommendSeed(seed => seed ? { ...seed, nonce: Date.now() } : seed); else if (recommendMode === 'collection') setCollectionNonce(value => value + 1); else setMixNonce(value => value + 1) }} onSearch={() => setView('search')} onFindSeeds={() => setView('search')} onModeChange={changeRecommendMode} onRemoveSeed={removeRecommendSeed} onClearCollection={clearRecommendSeeds} trackList={<TrackList tracks={recommendations} {...trackListProps}/>}/> : view === 'artist' && activeArtist ?
        <ArtistView key={activeArtist.id || activeArtist.name}
          artist={activeArtist}
          fallbackId={artistByName(activeArtist.name)?.id || (activeArtist.id?.startsWith('artist-') ? activeArtist.id : undefined)}
          user={user}
          followedIds={user?.artists || []}
          tint={activeArtist.tint || artistByName(activeArtist.name)?.tint}
          tags={activeArtist.tags?.length ? activeArtist.tags : artistByName(activeArtist.name)?.tags}
          source={artistSource}
          onSource={setArtistSource}
          vkEnabled={apiConfig.vk}
          vkIssue={apiConfig.vkIssue}
          yandexFull={apiConfig.yandexFull}
          youtubeDl={apiConfig.youtubeDl}
          onTracksLoaded={tracks => warmList(tracks, 3)}
          onBack={closeArtist}
          onToggleFollow={toggleFollowArtist}
          onArtist={openArtist}
          onPlayTracks={playTracks}
          onRecommendations={(seed, scope) => openRecommendationsFor(seed || { id: '', title: '', artist: activeArtist.name, source: 'youtube' }, scope)}
          onLogin={() => setAuthOpen(true)}
          renderTracks={tracks => <TrackList tracks={tracks} {...trackListProps}/>}
          onNotice={setNotice}
        /> : view === 'playlists' ?
        <PlaylistsView user={user} current={current} playing={playing} seedTracks={seedTracks} focus={playlistFocus} onUserUpdate={setUser} onPlayTracks={playTracks} onNotice={setNotice} onLogin={() => setAuthOpen(true)} onSearchMusic={() => setView('search')}/> : view === 'profile' && user ?
        <ProfileView user={user} onUpdate={updateProfile} onLogout={logout} onDeleteMoment={deleteMoment} onPlayMoment={playMoment} onShareMoment={shareMoment} onSaveMomentImage={saveMomentImage} onArtist={openArtist} googleClientId={googleClientId} desktop={desktopApp} onGoogleUser={adoptGoogleUser} onGoogleAuth={linkGoogle} currentTrackId={current?.id} playing={playing} listenStats={listenStats || undefined} motion={settings.smoothUi} onPlayTrack={track => select(track)} recapYear={profileRecapYear} recapActive={season.active} onOpenRecap={year => setRecapOpenYear(year)}/> : view === 'settings' ?
        <SettingsView settings={settings} onChange={patch => setSettings(prev => ({ ...prev, ...patch }))} onBack={() => setView(settingsReturn.current === 'settings' ? 'home' : settingsReturn.current)} onNotice={setNotice} onConfigChange={loadConfig} dislikes={dislikes} onRestoreDislike={restoreDislike} onClearDislikes={clearDislikes} user={user}/> : view === 'catalog' ?
        <CatalogView selected={catalogArtist} loading={catalogLoading} error={catalogError} tracksCount={catalogTracks.length} youtubeDl={apiConfig.youtubeDl} yandexFull={apiConfig.yandexFull} vkEnabled={apiConfig.vk} vkIssue={apiConfig.vkIssue} source={catalogSource} onSource={setCatalogSource} onSelect={openCatalogArtist} onClear={() => setCatalogArtist(null)} onPlayAll={playCatalog} onShuffle={() => playTracks([...catalogTracks].sort(() => Math.random() - .5))} tasteNames={tasteNames} motion={settings.smoothUi} trackList={<TrackList tracks={catalogTracks} {...trackListProps}/>}/> : view === 'genre' && genre ?
        <GenreView genre={genre} tracksCount={genreTracks.length} shownCount={genreShown.length} sources={genreSources} loading={genreLoading || (genreSource === 'youtube' && genreYoutubeLoading)} error={genreError} mood={genreMood} query={genreQuery} yandexFull={apiConfig.yandexFull} youtubeDl={apiConfig.youtubeDl} vkEnabled={apiConfig.vk} vkIssue={apiConfig.vkIssue} source={genreSource} onSource={setGenreSource} setQuery={setGenreQuery} onMood={toggleGenreMood} onRefresh={refreshGenre} onPlayAll={playGenre} onGenre={openGenre} trackList={<TrackList tracks={genreShown} {...trackListProps}/>}/> :
        <CollectionView
          view={view === 'search' || view === 'offline' || view === 'favorites' ? view : 'library'}
          query={query}
          setQuery={setQuery}
          searchSource={searchSource}
          setSearchSource={setSearchSource}
          vkEnabled={apiConfig.vk}
          vkIssue={apiConfig.vkIssue}
          yandexFull={apiConfig.yandexFull}
          youtubeDl={apiConfig.youtubeDl}
          onImportUrl={importUrl}
          onImportFile={() => fileRef.current?.click()}
          onImportFolder={() => folderRef.current?.click()}
          folders={offlineFolders}
          activeFolder={offlineFolder}
          setActiveFolder={setOfflineFolder}
          onDeleteFolder={folder => void deleteOfflineFolder(folder)}
          apiReady={apiReady}
          loading={loading}
          shownCount={shown.length}
          tracks={shown}
          trackList={<TrackList tracks={shown} {...trackListProps}/>}
          onSearch={() => setView('search')}
          onArtist={openArtist}
          onGenre={openGenre}
          onPlayAll={() => playTracks(shown, 0)}
          onShuffle={() => playTracks([...shown].sort(() => Math.random() - .5), 0)}
          onSubmitSearch={value => { setQuery(value); setSearchNonce(nonce => nonce + 1) }}
          suggestions={tasteNames}
        />}
      </div>
      </main>
    <aside className={`right-panel ${showLyrics ? 'panel-open' : ''} ${lyrics.length ? 'has-synced-lyrics' : ''} ${lyricsExpanded ? 'lyrics-expanded' : ''}`} aria-hidden={!showLyrics}><div className="right-top"><span>О ТРЕКЕ</span><button onClick={() => setShowLyrics(false)} aria-label="Закрыть подробности"><X size={20}/></button></div>{current ? <><div className="now-art" style={artStyle(current)}><div className="now-art-shine"/><div className="now-art-foreground" style={artStyle(current)}/></div><div className="now-info"><div><h2>{current.title}</h2><button className="now-artist" onClick={() => openArtist({ name: current.artist })} title={`Открыть ${current.artist}`}>{current.artist}</button></div><div className="now-actions"><button className={mediaLibrary.some(t => t.id === current.id) ? 'added' : ''} onClick={() => toggleLibrary(current)} aria-label="Добавить в медиатеку" title="Добавить в медиатеку">{mediaLibrary.some(t => t.id === current.id) ? <Check size={19}/> : <Plus size={19}/>}</button><button className={favorites.some(t => t.id === current.id) ? 'liked' : ''} onClick={() => toggleFavorite(current)} aria-label="Добавить в любимые" title="Добавить в любимые"><Heart size={20} fill={favorites.some(t => t.id === current.id) ? 'currentColor' : 'none'}/></button><button onClick={() => setPlaylistPickerTrack(current)} aria-label="Добавить в плейлист" title="Добавить в плейлист"><ListMusic size={19}/></button></div></div><div className="source-chip"><span className="source-dot"/> {current.offlineKey ? 'Офлайн-кэш сервера' : current.source === 'youtube' ? 'YouTube · полный трек' : current.source === 'yandex' ? `Яндекс Музыка${apiConfig.yandexFull ? ' · полный трек' : ' · превью 30 с'}` : current.source === 'vk' ? 'ВКонтакте · полный трек' : current.source === 'soundcloud' ? 'Внешний источник' : current.source === 'archive' ? 'Internet Archive' : current.source === 'audius' ? 'Audius · полный трек' : 'Оффлайн-файл'} {current.source === 'youtube' && current.url && <a href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Открыть на YouTube</a>}{current.source === 'yandex' && current.url && <a href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Открыть в Яндекс Музыке</a>}{current.license && current.url && <a href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Запись и лицензия</a>}{video && current.source !== 'youtube' && <a href={video} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Смотреть клип</a>}</div><div className="lyrics-box"><div className="lyrics-heading"><div><ListMusic size={18}/><strong>Текст песни</strong></div><div className="lyrics-heading-actions"><span>{lyrics.length ? 'СИНХРОНИЗИРОВАН' : ''}</span><button onClick={() => setLyricsExpanded(value => !value)} aria-label={lyricsExpanded ? 'Свернуть текст' : 'Развернуть текст'} title={lyricsExpanded ? 'Свернуть текст' : 'Развернуть текст'}>{lyricsExpanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button></div></div><div className={`lyrics-lines ${lyrics.length ? 'is-synced' : ''}`} ref={lyricsScrollRef}>{lyrics.length ? lyrics.map((line, i) => <button data-line-index={i} key={`${line.at}-${i}`} className={i === activeLine ? 'active-line' : ''} onClick={() => seek(line.at)}>{line.text || '♪'}</button>) : plainLyrics ? <pre>{plainLyrics}</pre> : <div className="lyrics-placeholder"><span>♫</span>{lyricsStatus}</div>}</div><div className="lyrics-credit">Текст предоставлен <a href="https://lrclib.net" target="_blank" rel="noreferrer">LRCLIB ↗</a></div></div></> : <div className="right-empty"><div className="right-empty-orb"><Music2 size={32}/></div><h3>Включи музыку.<br/>Остальное — за нами.</h3><p>Здесь появится обложка, текст по строчкам и ссылка на клип.</p></div>}<div className="right-footer"><Sparkles size={16}/> Музыка в твоём ритме</div></aside>
    {current && <div className={`player-bar ${holdingMini ? 'is-holding' : ''}`} onClick={event => {
      if (!window.matchMedia('(max-width: 680px)').matches) return
      if ((event.target as HTMLElement).closest('button, a, input, label')) return
      if (longPressFired.current) { longPressFired.current = false; return }
      if (mobileMenu === 'mini') { setMobileMenu(null); return }
      if (miniSwipeSuppress.current) { miniSwipeSuppress.current = false; return }
      setPlayerOpen(true)
    }} onPointerDown={beginMiniPress} onPointerMove={moveMiniPress} onPointerUp={endMiniPress} onPointerCancel={endMiniPress} onPointerLeave={endMiniPress}>{mobileMenu === 'mini' && <div className="player-menu mini-menu" ref={miniMenuRef} role="menu">{playerMenuContent(() => setMobileMenu(null))}</div>}{settings.visualizer && !settings.performanceMode && current.source !== 'soundcloud' && <Visualizer audioRef={audioRef} playing={playing}/>}<div className={`player-seek ${seekDraft !== null ? 'is-seeking' : ''}`}><span className="seek-time seek-time-left">{formatTime(seekDraft ?? position)}</span><span className="seek-time seek-time-right">{duration > 0 ? formatTime(duration) : '—:—'}</span>{seekDraft !== null && <div className="seek-bubble" style={{ left: `clamp(184px, ${seekPercent}%, calc(100% - 184px))` }}><span className="seek-bubble-time">{formatTime(seekDraft)} <em>/</em> {duration > 0 ? formatTime(duration) : '—:—'}</span>{seekLine ? <span className="seek-bubble-lyric"><small>{seekLine.prev}</small><strong>{seekLine.text}</strong><small>{seekLine.next}</small></span> : <strong className="seek-bubble-empty">Перемотка</strong>}</div>}<input ref={seekInputRef} type="range" min="0" max={Math.max(duration, 1)} defaultValue={0} onChange={e => { const value = Number(e.target.value); seekDraftRef.current = value; paintSeek(e.currentTarget, value, false); setSeekDraft(value) }} onPointerUp={e => { seek(Number(e.currentTarget.value)); seekDraftRef.current = null; setSeekDraft(null) }} onPointerCancel={endSeek} onKeyUp={e => { seek(Number(e.currentTarget.value)); seekDraftRef.current = null; setSeekDraft(null) }} onBlur={endSeek} aria-label="Позиция трека" title="Перемотка"/></div><div className="player-track" ref={miniTrackRef} onClick={() => { if (miniSwipeSuppress.current) { miniSwipeSuppress.current = false; return } if (!window.matchMedia('(max-width: 680px)').matches) setShowLyrics(true) }} onPointerDown={beginMiniSwipe} onPointerMove={moveMiniSwipe} onPointerUp={endMiniSwipe} onPointerCancel={endMiniSwipe}><div className="mini-art" style={artStyle(current)}/><div><strong>{current.title}</strong><button className={`player-artist ${buffering ? 'is-buffering' : ''}`} onClick={event => { event.stopPropagation(); openArtist({ name: current.artist }) }} title={buffering ? `Загружаем поток · ${current.artist}` : `Открыть ${current.artist}`}>{current.artist}</button></div><button className={`player-add ${mediaLibrary.some(t => t.id === current.id) ? 'active' : ''}`} onClick={event => { event.stopPropagation(); toggleLibrary(current) }} aria-label={mediaLibrary.some(t => t.id === current.id) ? 'Убрать из медиатеки' : 'Добавить в медиатеку'} title={mediaLibrary.some(t => t.id === current.id) ? 'Убрать из медиатеки' : 'В медиатеку'}>{mediaLibrary.some(t => t.id === current.id) ? <Check size={16}/> : <Plus size={17}/>}</button><button className={`player-like ${favorites.some(t => t.id === current.id) ? 'liked' : ''}`} onClick={event => { event.stopPropagation(); toggleFavorite(current) }} aria-label={favorites.some(t => t.id === current.id) ? 'Убрать из любимых' : 'Добавить в любимые'}><Heart size={18} fill={favorites.some(t => t.id === current.id) ? 'currentColor' : 'none'}/></button><button className="player-add player-playlist" onClick={event => { event.stopPropagation(); setPlaylistPickerTrack(current) }} aria-label="Добавить в плейлист" title="В плейлист"><ListMusic size={17}/></button>{availableMomentLines.length > 0 && <button className="player-moment" onClick={event => { event.stopPropagation(); openMomentDialog() }} aria-label="Сохранить Момент" title="Сохранить Момент"><Bookmark size={16}/></button>}</div><div className="player-center"><div className="player-controls"><button className="desktop-control" onClick={() => skip(-1)} aria-label="Предыдущий трек"><SkipBack size={19} fill="currentColor"/></button><button className={`main-play ${buffering ? 'is-buffering' : ''}`} onClick={togglePlay} aria-label={buffering ? 'Загружаем трек' : playing ? 'Пауза' : 'Воспроизвести'}>{buffering ? <Loader2 className="spin" size={20}/> : playing ? <Pause size={20} fill="currentColor"/> : <Play size={20} fill="currentColor"/>}</button><button className="desktop-control" onClick={() => skip(1)} aria-label="Следующий трек"><SkipForward size={19} fill="currentColor"/></button></div></div><div className="player-extra"><button className={queueOpen ? 'active-loop' : ''} onClick={() => setQueueOpen(true)} aria-label="Очередь и история" title="Очередь и история"><ListOrdered size={19}/></button><button className={showLyrics ? 'active-loop' : ''} onClick={() => setShowLyrics(!showLyrics)} aria-label="Текст песни" title="Текст песни"><FileText size={18}/></button><label className="volume-control"><Volume2 size={18}/><input type="range" min="0" max="100" value={volume} onChange={e => changeVolume(Number(e.target.value))} aria-label="Громкость" style={{ '--fill': `${volume}%` } as React.CSSProperties}/></label><div className="player-menu-wrap" ref={playerMenuRef}><button className={`player-more ${playerMenu ? 'is-open' : ''}`} onClick={() => setPlayerMenu(value => !value)} aria-label="Ещё действия" aria-haspopup="menu" aria-expanded={playerMenu} title="Ещё действия"><MoreHorizontal size={19}/></button>{playerMenu && <div className="player-menu" role="menu">{playerMenuContent(() => setPlayerMenu(false))}</div>}</div></div></div>}
    <nav className="mobile-nav"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><House size={21}/>Главная</button><button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}><Search size={21}/>Поиск</button><button className={view === 'catalog' ? 'active' : ''} onClick={openCatalog}><Flame size={21}/>Каталоги</button><button className={view === 'library' || view === 'playlists' || view === 'offline' ? 'active' : ''} onClick={() => setView('library')}><Library size={21}/>Медиатека</button><button className={view === 'profile' ? 'active' : ''} onClick={() => user ? setView('profile') : setAuthOpen(true)}><UserRound size={21}/>Профиль</button></nav>
    {current?.source === 'soundcloud' && <div className="sc-widget"><iframe ref={frameRef} title="Внешний плеер" allow="autoplay" src={`https://w.soundcloud.com/player/?url=${encodeURIComponent(current.url || '')}&color=%23d7ff57&auto_play=true&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`}/></div>}
    {current && current.source !== 'soundcloud' && <audio ref={audioRef} crossOrigin="anonymous" src={current.source === 'local' ? objectUrlRef.current || undefined : current.streamUrl} onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata} onDurationChange={handleDurationChange} onProgress={handleProgress} onLoadStart={() => setBuffering(true)} onWaiting={() => setBuffering(true)} onCanPlay={handleCanPlay} onPlaying={handlePlaying} onEnded={() => { if (loop) { audioRef.current!.currentTime = 0; audioRef.current!.play() } else if (queue.length > 1) skip(1); else if (settings.autoplaySimilar) autoplaySimilar().then(started => { if (!started) setPlaying(false) }); else setPlaying(false) }} onError={handleAudioError}/ >}
    <Presence open={playerOpen && Boolean(current)}>{playerOpen && current && <div className={`mobile-player-overlay ${mobileLyricsFull ? 'lyrics-full' : ''}`} ref={overlayRef} onPointerDown={beginOverlaySwipe} onPointerMove={moveOverlaySwipe} onPointerUp={endOverlaySwipe} onPointerCancel={endOverlaySwipe}><div className="overlay-grabber" aria-hidden="true"/><div className="overlay-header"><button className="overlay-close" onClick={() => setPlayerOpen(false)}><ChevronDown size={25}/> СЕЙЧАС ИГРАЕТ</button><div className="overlay-head-actions"><button className="overlay-settings" onClick={() => setQueueOpen(true)} aria-label="Очередь и история"><ListOrdered size={20}/></button><button className="overlay-settings" onClick={openSettings} aria-label="Настройки приложения"><Settings2 size={20}/></button><div className="player-menu-wrap overlay-menu-wrap" ref={overlayMenuRef}><button className={`overlay-settings ${mobileMenu === 'overlay' ? 'is-open' : ''}`} onClick={() => setMobileMenu(mobileMenu === 'overlay' ? null : 'overlay')} aria-label="Ещё действия" aria-haspopup="menu" aria-expanded={mobileMenu === 'overlay'}><MoreHorizontal size={20}/></button>{mobileMenu === 'overlay' && <div className="player-menu overlay-player-menu" role="menu">{playerMenuContent(() => setMobileMenu(null))}</div>}</div></div></div><div className="overlay-art" style={artStyle(current)}/><div className="overlay-title"><div><h2>{current.title}</h2><button className={`overlay-artist ${buffering ? 'is-buffering' : ''}`} onClick={() => openArtist({ name: current.artist })}>{current.artist}</button></div><div className="overlay-title-actions"><button onClick={() => toggleLibrary(current)} aria-label={mediaLibrary.some(t => t.id === current.id) ? 'Убрать из медиатеки' : 'Добавить в медиатеку'}>{mediaLibrary.some(t => t.id === current.id) ? <Check size={20}/> : <Plus size={20}/>}</button><button onClick={() => toggleFavorite(current)} aria-label={favorites.some(t => t.id === current.id) ? 'Убрать из любимых' : 'Добавить в любимые'}><Heart fill={favorites.some(t => t.id === current.id) ? 'currentColor' : 'none'}/></button><button onClick={() => setPlaylistPickerTrack(current)} aria-label="Добавить в плейлист"><ListMusic size={20}/></button></div></div><div className="overlay-progress"><input ref={overlaySeekInputRef} type="range" min="0" max={Math.max(duration, 1)} defaultValue={0} onChange={e => { const value = Number(e.target.value); seekDraftRef.current = value; paintSeek(e.currentTarget, value, false); setSeekDraft(value) }} onPointerUp={e => { seek(Number(e.currentTarget.value)); seekDraftRef.current = null; setSeekDraft(null) }} onPointerCancel={endSeek} onKeyUp={e => { seek(Number(e.currentTarget.value)); seekDraftRef.current = null; setSeekDraft(null) }} onBlur={endSeek}/><div><span>{formatTime(position)}</span><span>{duration > 0 ? formatTime(duration) : '—:—'}</span></div></div><div className="overlay-controls"><button onClick={() => skip(-1)}><SkipBack fill="currentColor"/></button><button className="overlay-play" onClick={togglePlay}>{buffering ? <Loader2 className="spin"/> : playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button><button onClick={() => skip(1)}><SkipForward fill="currentColor"/></button></div>{current.source === 'youtube' && current.url && <a className="overlay-video" href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Открыть на YouTube</a>}{current.source === 'yandex' && current.url && <a className="overlay-video" href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Открыть в Яндекс Музыке{apiConfig.yandexFull ? '' : ' · здесь превью 30 с'}</a>}{current.source === 'soundcloud' && <a className="overlay-video" href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Открыть источник</a>}{current.source === 'archive' && <a className="overlay-video" href={current.url} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Запись и лицензия на Archive.org</a>}{video && current.source !== 'youtube' && <a className="overlay-video" href={video} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Смотреть клип</a>}<div className="overlay-lyrics"><div className="overlay-lyrics-head"><strong><ListMusic size={17}/> Текст песни</strong><div className="overlay-lyrics-actions">{availableMomentLines.length > 0 && <button className="overlay-moment" onClick={() => openMomentDialog()} aria-label="Сохранить Момент" title="Сохранить Момент"><Bookmark size={17}/><span>Момент</span></button>}{(lyrics.length > 0 || Boolean(plainLyrics)) && <button className="overlay-lyrics-toggle" onClick={() => setMobileLyricsFull(value => !value)} aria-label={mobileLyricsFull ? 'Свернуть текст' : 'Текст на весь экран'} title={mobileLyricsFull ? 'Свернуть текст' : 'Текст на весь экран'}>{mobileLyricsFull ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}<span>{mobileLyricsFull ? 'Свернуть' : 'Весь текст'}</span></button>}</div></div><div className={lyrics.length ? 'is-synced' : undefined} ref={mobileLyricsScrollRef}>{lyrics.length ? lyrics.map((line, i) => <button data-line-index={i} className={activeLine === i ? 'active-line' : ''} key={i} onClick={() => seek(line.at)}>{line.text || '♪'}</button>) : plainLyrics ? <pre>{plainLyrics}</pre> : lyricsStatus}</div></div></div>}</Presence>
    <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }}/>
    <input ref={folderRef} type="file" accept="audio/*" multiple hidden onChange={e => { addFiles(e.target.files, true); e.target.value = '' }}/>
    <Presence open={queueOpen}>{queueOpen && <QueuePanel current={current} queue={queue} history={history} library={mediaLibrary} favorites={favorites} playing={playing} onSelect={select} onRemove={removeFromQueue} onPlayNext={playNext} onRemoveHistory={removeHistory} onCommit={commitQueueOrder} onClearUpcoming={clearUpcoming} onClearHistory={() => setHistory([])} onLibrary={toggleLibrary} onFavorite={toggleFavorite} onPlaylist={track => { setQueueOpen(false); setPlaylistPickerTrack(track) }} onArtist={track => { setQueueOpen(false); openArtist({ name: track.artist }) }} onDislike={track => { setQueueOpen(false); markNotInterested(track) }} onClose={() => setQueueOpen(false)}/>}</Presence>
    {current && availableMomentLines.length > 0 && <button className="moment-launch" onClick={openMomentDialog}><Bookmark size={16}/> Сохранить Момент</button>}
    <Presence open={selectingMoment && Boolean(current) && availableMomentLines.length > 0}>{selectingMoment && current && availableMomentLines.length > 0 && <MomentDialog track={current} lines={availableMomentLines} selected={momentLines} onToggle={toggleMomentLine} onSave={saveMoment} onClose={() => setSelectingMoment(false)} user={user} synced={lyrics.length > 0} currentLine={lyrics.length ? activeLine : -1}/>}</Presence>
    <Presence open={authOpen}>{authOpen && <AuthDialog googleClientId={googleClientId} desktop={desktopApp} onClose={() => setAuthOpen(false)} onAuthenticated={account => { setUser(account); const resumePicker = pendingPickerTrack; setPendingPickerTrack(null); if (resumePicker) { setPlaylistPickerTrack(resumePicker); return } if (momentLines.length) setTimeout(() => setSelectingMoment(true), 0); if (view !== 'playlists') setView('profile') }}/ >}</Presence>
    <Presence open={Boolean(playlistPickerTrack)}>{playlistPickerTrack && <PlaylistPicker track={playlistPickerTrack} user={user} onClose={() => setPlaylistPickerTrack(null)} onUserUpdate={setUser} onNotice={setNotice} onLogin={() => { setPendingPickerTrack(playlistPickerTrack); setPlaylistPickerTrack(null); setAuthOpen(true) }}/>}</Presence>
    <Presence open={Boolean(statusPrompt) && Boolean(user?.statusTrack)}>{statusPrompt && user?.statusTrack && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setStatusPrompt(null) }}><div className="auth-modal status-confirm" role="dialog" aria-modal="true" aria-label="Заменить трек настроения"><button className="modal-close" onClick={() => setStatusPrompt(null)} aria-label="Закрыть"><X size={20}/></button><div className="auth-eyebrow">МОЁ НАСТРОЕНИЕ</div><h2>Заменить <em>трек?</em></h2><div className="status-swap"><span className="status-swap-item"><span className="status-swap-art" style={artStyle(user.statusTrack)}/><span><strong>{user.statusTrack.title}</strong><small>{user.statusTrack.artist}</small></span></span><ArrowRight size={16}/><span className="status-swap-item is-new"><span className="status-swap-art" style={artStyle(statusPrompt)}/><span><strong>{statusPrompt.title}</strong><small>{statusPrompt.artist}</small></span></span></div><p>В настроении может быть только один трек. «{user.statusTrack.title}» заменится на «{statusPrompt.title}».</p><div className="status-confirm-actions"><button className="rec-ghost" onClick={() => setStatusPrompt(null)}>Оставить старый</button><button className="primary-btn" onClick={() => void saveStatusTrack(statusPrompt)}>Заменить <Check size={15}/></button></div></div></div>}</Presence>
    {recapOpenYear !== null && listenStats && <RecapOverlay year={recapOpenYear} stats={listenStats} moments={user?.moments} onClose={() => setRecapOpenYear(null)} onPlayTrack={track => void playStatsTrack(track, 'итогов', () => setRecapOpenYear(null))} onArtist={name => { setRecapOpenYear(null); openArtist({ name }) }}/>}
    {notice && <div key={noticeKey} className={`toast ${noticeLeaving ? 'toast-leaving' : ''} ${/не удалось|ошибка|недоступ|не найден/i.test(notice) ? 'toast-error' : ''}`} role="status" aria-live="polite"><span className="toast-symbol"><Sparkles size={17}/></span><span className="toast-message">{notice}</span><button onClick={closeNotice} aria-label="Закрыть уведомление"><X size={17}/></button><span className="toast-timer"/></div>}
  </div>
}

function TrackList({ tracks, current, playing, onSelect, onSave, saved, onAddToLibrary, inLibrary, onDelete, onDownload, onCache, serverOffline, cachingId, offline, downloadingId, onPlaylist, onPlayNext, onQueue, onRecommend, onSimilar, onArtist, onStatus, statusTrackId, collection, onCollection, onSwipeDelete, swipeContext, onDislike }: { tracks: Track[]; current: Track | null; playing: boolean; onSelect: (track: Track, list: Track[]) => void; onSave: (track: Track) => void; saved: Track[]; onAddToLibrary: (track: Track) => void; inLibrary: Track[]; onDelete: (track: Track) => void; onDownload: (track: Track) => void; onCache: (track: Track) => void; serverOffline: Track[]; cachingId: string | null; offline: Track[]; downloadingId: string | null; onPlaylist: (track: Track) => void; onPlayNext: (track: Track) => void; onQueue: (track: Track) => void; onRecommend: (track: Track) => void; onSimilar: (track: Track) => void; onArtist: (artist: ArtistRef) => void; onStatus: (track: Track | null) => void; statusTrackId?: string; collection: Track[]; onCollection: (track: Track) => void; onSwipeDelete: (track: Track) => void; swipeContext: View; onDislike: (track: Track) => void }) {
  const [menu, setMenu] = useState<{ track: Track; x: number; y: number; up: boolean } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('keydown', onKey) }
  }, [menu])
  function openMenu(event: React.MouseEvent<HTMLButtonElement>, track: Track) {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 254
    const height = 520
    setMenu({
      track,
      x: Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12)),
      y: rect.bottom + height + 12 > window.innerHeight ? Math.max(12, Math.min(rect.top - height - 8, window.innerHeight - height - 12)) : rect.bottom + 8,
      up: rect.bottom + height + 12 > window.innerHeight,
    })
  }
  function run(action: () => void) { setMenu(null); action() }
  const menuLayer = menu && createPortal(<div className="track-menu-layer">
    <div className="track-menu-backdrop" onPointerDown={() => setMenu(null)}/>
    <div className={`track-menu ${menu.up ? 'is-up' : ''}`} role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
      <div className="track-menu-head">
        <span className="track-menu-art" style={artStyle(menu.track)}/>
        <span className="track-menu-copy"><strong>{menu.track.title}</strong><small>{menu.track.artist}</small></span>
      </div>
      <div className="track-menu-group">
        <button role="menuitem" onClick={() => run(() => onPlayNext(menu.track))}><ListStart size={16}/><span>Играть следующим</span></button>
        <button role="menuitem" onClick={() => run(() => onQueue(menu.track))}><ListEnd size={16}/><span>В конец очереди</span></button>
        <button role="menuitem" onClick={() => run(() => onRecommend(menu.track))}><Wand2 size={16}/><span>Рекомендации по треку</span></button>
        <button role="menuitem" onClick={() => run(() => onSimilar(menu.track))}><Sparkles size={16}/><span>Найти похожее</span></button>
        <button role="menuitem" onClick={() => run(() => onStatus(statusTrackId === menu.track.id ? null : menu.track))}><Music2 size={16}/><span>{statusTrackId === menu.track.id ? 'Убрать из моего настроения' : 'В моё настроение'}</span></button>
        <button role="menuitem" onClick={() => run(() => onCollection(menu.track))}><ListMusic size={16}/><span>{collection.some(item => item.id === menu.track.id) ? 'Убрать из подборки рекомендаций' : 'В подборку рекомендаций'}</span></button>
        <button role="menuitem" onClick={() => run(() => onArtist({ name: menu.track.artist }))}><UserRound size={16}/><span>Перейти к исполнителю</span></button>
      </div>
      <div className="track-menu-sep"/>
      <div className="track-menu-group">
        <button role="menuitem" onClick={() => run(() => onPlaylist(menu.track))}><ListMusic size={16}/><span>Добавить в плейлист</span></button>
        <button role="menuitem" onClick={() => run(() => onSave(menu.track))}><Heart size={16} fill={saved.some(item => item.id === menu.track.id) ? 'currentColor' : 'none'}/><span>{saved.some(item => item.id === menu.track.id) ? 'Убрать из любимых' : 'В любимые'}</span></button>
        {menu.track.source !== 'local' && <button role="menuitem" onClick={() => run(() => onAddToLibrary(menu.track))}><Plus size={16}/><span>{inLibrary.some(item => item.id === menu.track.id) ? 'Убрать из медиатеки' : 'В медиатеку'}</span></button>}
        {menu.track.source === 'archive' && <button role="menuitem" disabled={downloadingId === menu.track.id || Boolean(menu.track.offlineKey) || offline.some(item => item.id === `local:${menu.track.id}`)} onClick={() => run(() => onDownload(menu.track))}><Download size={16}/><span>{downloadingId === menu.track.id ? 'Скачиваем…' : offline.some(item => item.id === `local:${menu.track.id}`) ? 'Уже скачано в браузер' : 'Скачать в браузер'}</span></button>}
        {(menu.track.source === 'youtube' || menu.track.source === 'yandex' || menu.track.source === 'vk' || menu.track.source === 'archive') && <button role="menuitem" disabled={cachingId === menu.track.id || Boolean(menu.track.offlineKey) || serverOffline.some(item => item.id === menu.track.id)} onClick={() => run(() => onCache(menu.track))}><WifiOff size={16}/><span>{cachingId === menu.track.id ? 'Скачиваем на сервер…' : menu.track.offlineKey || serverOffline.some(item => item.id === menu.track.id) ? 'Доступен офлайн' : 'Скачать на сервер (офлайн)'}</span></button>}
      </div>
      <div className="track-menu-sep"/>
      <div className="track-menu-group">
        <button role="menuitem" className="danger" onClick={() => run(() => onDislike(menu.track))} title="Трек пропустится и уйдёт из истории, а похожие перестанут попадаться"><ThumbsDown size={16}/><span>Неинтересно</span></button>
      </div>
      {(menu.track.url || menu.track.source === 'local' || menu.track.offlineKey) && <><div className="track-menu-sep"/><div className="track-menu-group">
        {menu.track.url && <a role="menuitem" href={menu.track.url} target="_blank" rel="noreferrer" onClick={() => setMenu(null)}><ExternalLink size={16}/><span>Открыть источник</span></a>}
        {(menu.track.source === 'local' || menu.track.offlineKey) && <button role="menuitem" className="danger" onClick={() => run(() => onDelete(menu.track))}><Trash2 size={16}/><span>{menu.track.offlineKey ? 'Удалить из кэша' : 'Удалить файл'}</span></button>}
      </div></>}
    </div>
  </div>, document.body)
  return <div className="track-list">{tracks.map((track, index) => {
    const isSaved = saved.some(item => item.id === track.id)
    const isInLibrary = inLibrary.some(item => item.id === track.id)
    return <SwipeRow key={track.id} id={track.id}
      left={[{ key: 'next', label: 'Следующим', icon: <ListStart size={17}/>, tone: 'queue', onAction: () => onPlayNext(track) }]}
      right={[
        { key: 'remove', tone: 'danger', onAction: () => onSwipeDelete(track), label: track.source === 'local' || track.offlineKey ? 'Удалить' : swipeContext === 'favorites' ? 'Из любимых' : 'Убрать', icon: <Trash2 size={17}/> },
        { key: 'save', tone: 'save', onAction: () => track.source === 'local' ? onSave(track) : onAddToLibrary(track), label: track.source === 'local' ? (isSaved ? 'В любимых' : 'В любимые') : isInLibrary ? 'В медиатеке' : 'В медиатеку', icon: track.source === 'local' ? <Heart size={17} fill={isSaved ? 'currentColor' : 'none'}/> : isInLibrary ? <Check size={17}/> : <Plus size={17}/> },
      ]}>
      <div className={`track-row ${current?.id === track.id ? 'playing-track' : ''}`} onPointerEnter={() => prefetchYouTube(track)}>
        <button className="track-primary" onClick={() => onSelect(track, tracks)}><span className="track-index">{String(index + 1).padStart(2, '0')}</span><span className="track-art" style={artStyle(track, index)}>{current?.id === track.id && playing ? <span className="equalizer"><i/><i/><i/></span> : <Play size={15} fill="currentColor"/>}</span><span className="track-name"><strong>{track.title}</strong><small>{track.artist}</small></span></button>
        <span className="track-source">{(track.source === 'local' || track.offlineKey) ? <><WifiOff size={14}/> {track.offlineKey ? 'Кэш сервера' : 'Оффлайн'}</> : <><span className="source-dot"/> {track.source === 'youtube' ? 'YouTube' : track.source === 'yandex' ? 'Яндекс Музыка' : track.source === 'vk' ? 'ВКонтакте' : track.source === 'archive' ? 'Archive' : track.source === 'audius' ? 'Audius · полностью' : 'Внешний источник'}</>}</span>
        <span className="track-duration">{track.duration ? formatTime(track.duration) : '—:—'}</span>
        {track.source !== 'local' && !track.offlineKey ? <button className={`track-add ${isInLibrary ? 'active' : ''}`} onClick={() => onAddToLibrary(track)} aria-label={isInLibrary ? 'Убрать из медиатеки' : 'Добавить в медиатеку'} title={isInLibrary ? 'Убрать из медиатеки' : 'Добавить в медиатеку'}>{isInLibrary ? <Check size={17}/> : <Plus size={17}/>}</button> : <span className="track-add-spacer" aria-hidden="true"/>}
        <button className={`track-action ${isSaved ? 'is-liked' : ''}`} onClick={() => track.source === 'local' || track.offlineKey ? onDelete(track) : onSave(track)} aria-label={track.offlineKey ? 'Удалить из кэша' : track.source === 'local' ? 'Удалить файл' : 'Сохранить'}>{track.source === 'local' || track.offlineKey ? <X size={17}/> : <Heart size={18} fill={isSaved ? 'currentColor' : 'none'}/>}</button>
        <button className={`track-more ${menu?.track.id === track.id ? 'active' : ''}`} onClick={event => openMenu(event, track)} aria-label="Ещё действия" aria-haspopup="menu" aria-expanded={menu?.track.id === track.id} title="Ещё действия"><MoreHorizontal size={19}/></button>
      </div>
    </SwipeRow>
  })}{menuLayer}</div>
}

export default App




