import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, delimiter, dirname, basename } from 'node:path'
import { searchVk, vkEnabled } from './vk.mjs'
import { searchYandex } from './yandex.mjs'

const isWindows = process.platform === 'win32'
const childEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
const searchCache = new Map()
const streamCache = new Map()
const pendingStreams = new Map()
const streamTtl = 90 * 60_000
const mediaTypes = { webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg' }
const titleNoise = /\s*[\(\[](official\s*(music\s*)?(video|audio|visualizer|lyric\s*video)|lyrics?|клип|премьера|premiere|m\/?v|audio|visualizer)[^\)\]]*[\)\]]\s*$/i
const catalogJunk = /(интервью|подкаст|podcast|interview|реакци|reaction|обзор|review|full album|альбом|плейлист|сборник|playlist|compilation)/i

let binary = null
let pending = null
let runtimeSupported = true
let preferredProfile = 0

const resolveQueue = []
let activeResolves = 0
const maxActiveResolves = 2

function withResolveSlot(task, urgent = false) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeResolves += 1
      task().then(resolve, reject).finally(() => {
        activeResolves -= 1
        const next = resolveQueue.shift()
        if (next) next()
      })
    }
    if (activeResolves < maxActiveResolves) run()
    else if (urgent) resolveQueue.unshift(run)
    else resolveQueue.push(run)
  })
}

function candidates() {
  if (process.env.YTDLP_PATH) return [[process.env.YTDLP_PATH, []]]
  const names = isWindows ? ['yt-dlp.exe', 'yt-dlp.cmd', 'yt-dlp.bat', 'yt-dlp'] : ['yt-dlp']
  const found = []
  for (const dir of String(process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = join(dir, name)
      if (existsSync(file)) found.push([file, []])
    }
  }
  found.push(['yt-dlp', []], ['python', ['-m', 'yt_dlp']], ['python3', ['-m', 'yt_dlp']])
  return found
}

function probe(command, prefix) {
  return new Promise(resolve => {
    let settled = false
    let child
    const done = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => { try { child?.kill() } catch {} ; done(false) }, 8000)
    try {
      child = spawn(command, [...prefix, '--version'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      return done(false)
    }
    child.on('error', () => done(false))
    child.on('close', code => done(code === 0))
  })
}

export async function ytdlp() {
  if (binary) return binary
  if (pending) return pending
  pending = (async () => {
    for (const [command, prefix] of candidates()) {
      if (await probe(command, prefix)) return { command, prefix }
    }
    throw new Error('yt-dlp не найден. Установите yt-dlp или укажите путь в YTDLP_PATH.')
  })()
  try {
    binary = await pending
    return binary
  } finally {
    pending = null
  }
}

async function runYtdlp(args, timeout = 30000) {
  const bin = await ytdlp()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, output) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(output)
    }
    const child = spawn(bin.command, [...bin.prefix, ...args], { windowsHide: true, env: childEnv })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { try { child.kill() } catch {} ; finish(new Error('yt-dlp не ответил вовремя')) }, timeout)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk })
    child.on('error', error => finish(error))
    const settle = code => {
      if (code === 0) return finish(null, stdout)
      const lines = stderr.split(/\r?\n/).filter(line => /error/i.test(line))
      const message = (lines.at(-1) || `yt-dlp завершился с кодом ${code}`).replace(/^ERROR:\s*/i, '').slice(0, 300)
      finish(new Error(message))
    }
    child.on('close', settle)
    // JS-рантайм yt-dlp иногда переживает родителя и держит пайпы открытыми,
    // поэтому после exit ждём закрытия потоков не дольше 400 мс.
    child.on('exit', code => setTimeout(() => settle(code), 400))
  })
}

function runYtdlpPartial(args, timeout) {
  return ytdlp().then(bin => new Promise(resolve => {
    const child = spawn(bin.command, [...bin.prefix, ...args], { windowsHide: true, env: childEnv })
    let stdout = ''
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(stdout)
    }
    const timer = setTimeout(() => { try { child.kill() } catch {} ; done() }, timeout)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', () => {})
    child.on('error', done)
    child.on('close', done)
  }))
}

function tidy(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim()
  for (let previous = ''; previous !== text;) {
    previous = text
    text = text.replace(titleNoise, '').trim()
  }
  return text
}

function describe(entry) {
  const channel = tidy(String(entry.channel || entry.uploader || '').replace(/\s*-\s*topic$/i, '').replace(/VEVO$/i, '').trim())
  const original = tidy(entry.title)
  const split = original.match(/^(.{1,60}?)\s+[-–—]\s+(.{1,140})$/)
  if (split && !/topic/i.test(String(entry.channel || ''))) return { artist: tidy(split[1]) || channel || 'YouTube', title: tidy(split[2]) || original }
  return { artist: channel || 'YouTube', title: original || 'Без названия' }
}

function prune(map, max) {
  if (map.size < max) return
  for (const [key, entry] of map) if (entry.expires < Date.now()) map.delete(key)
  while (map.size >= max) map.delete(map.keys().next().value)
}

function runtimeArgs() {
  const runtime = String(process.env.YTDLP_JS_RUNTIME || 'node').trim()
  return runtime && runtime !== 'none' ? ['--js-runtimes', runtime] : []
}

function authArgs() {
  const cookies = String(process.env.YTDLP_COOKIES || '').trim()
  if (cookies) return ['--cookies', cookies]
  const browser = String(process.env.YTDLP_COOKIES_FROM_BROWSER || '').trim()
  return browser ? ['--cookies-from-browser', browser] : []
}

export async function searchYouTube(query, { limit = 24, mode = 'title', timeout = 45000 } = {}) {
  const text = String(query || '').trim().slice(0, 160)
  if (!text) return []
  const count = Math.min(Math.max(limit, 1), 40)
  const key = `${mode}:${count}:${text.toLowerCase()}`
  const cached = searchCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.tracks
  const output = await runYtdlp([`ytsearch${count}:${text}`, '--flat-playlist', '--dump-single-json', '--no-warnings', '--socket-timeout', '15'], timeout)
  let data
  try { data = JSON.parse(output) } catch { throw new Error('YouTube вернул неожиданный ответ') }
  const tracks = []
  const seen = new Set()
  for (const entry of Array.isArray(data.entries) ? data.entries : []) {
    const videoId = String(entry.id || '')
    if (!/^[\w-]{11}$/.test(videoId)) continue
    const duration = Number(entry.duration) || undefined
    if (duration !== undefined && (duration < 20 || duration > (mode === 'artist' ? 720 : 3600))) continue
    const { artist, title } = describe(entry)
    if (mode === 'artist' && catalogJunk.test(title)) continue
    const fingerprint = `${title}|${artist}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    tracks.push({
      id: `yt:${videoId}`,
      title,
      artist,
      artwork: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      streamUrl: `/api/yt-stream?v=${videoId}`,
      duration,
      source: 'youtube',
    })
    if (tracks.length >= limit) break
  }
  prune(searchCache, 120)
  searchCache.set(key, { tracks, expires: Date.now() + 10 * 60_000 })
  return tracks
}

async function resolveOnce(videoId, profile) {
  const baseArgs = [
    '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio',
    '--no-playlist', '--no-warnings',
    '--socket-timeout', '10',
    '--retries', '1',
    '--extractor-retries', '1',
    ...(profile.anonymous ? [] : authArgs()), ...profile.args,
    '-j', `https://www.youtube.com/watch?v=${videoId}`,
  ]
  let output
  try {
    output = await runYtdlp(runtimeSupported ? [...runtimeArgs(), ...baseArgs] : baseArgs, profile.timeout)
  } catch (error) {
    if (!runtimeSupported || !/js-runtimes|no such option|unrecognized arguments/i.test(String(error?.message || ''))) throw error
    runtimeSupported = false
    output = await runYtdlp(baseArgs, profile.timeout)
  }
  let data
  try { data = JSON.parse(output) } catch { throw new Error('YouTube вернул неожиданный ответ') }
  const url = data.url || data.requested_downloads?.[0]?.url
  if (!url) throw new Error('YouTube не отдал аудиопоток для этого видео')
  let host = ''
  try { host = new URL(url).hostname } catch {}
  if (!/^https:\/\//.test(url) || !/(^|\.)googlevideo\.com$/i.test(host)) throw new Error('YouTube вернул небезопасную ссылку на поток')
  return {
    url,
    headers: data.http_headers || {},
    type: mediaTypes[data.ext] || 'audio/webm',
    expires: Date.now() + streamTtl,
  }
}

function friendlyStreamError(error) {
  const message = String(error?.message || '')
  if (/sign in to confirm|not a bot|age.?restrict/i.test(message)) return new Error('YouTube требует вход для этого видео. Добавьте cookies через YTDLP_COOKIES или выберите другой трек.')
  if (/unavailable|private video|has been removed|not available/i.test(message)) return new Error('Это видео недоступно на YouTube')
  if (/timed out|не ответил/i.test(message)) return new Error('YouTube не ответил вовремя — попробуйте ещё раз')
  return new Error(message || 'Не удалось получить поток YouTube')
}

export async function resolveYouTubeStream(videoId, urgent = false) {
  const cached = streamCache.get(videoId)
  if (cached && cached.expires > Date.now()) return cached
  const inflight = pendingStreams.get(videoId)
  if (inflight) return inflight
  const task = (async () => {
    const profiles = [
      { args: ['--extractor-args', 'youtube:player_client=visionos'], timeout: 16000 },
      { args: [], timeout: 18000 },
      // Stale signed-in cookies can make every request fail. A cookie-less
      // attempt is the fallback that keeps the wave alive.
      { args: [], timeout: 16000, anonymous: true },
      { args: ['--extractor-args', 'youtube:player_client=android_vr,web_safari'], timeout: 12000 },
    ]
    const order = [profiles[preferredProfile], ...profiles.filter((_, index) => index !== preferredProfile)]
    let lastError = null
    for (const profile of order) {
      try {
        const entry = await withResolveSlot(() => resolveOnce(videoId, profile), urgent)
        preferredProfile = profiles.indexOf(profile)
        prune(streamCache, 100)
        streamCache.set(videoId, entry)
        return entry
      } catch (error) {
        lastError = error
        if (/unavailable|private video|has been removed/i.test(String(error?.message || ''))) break
      }
    }
    throw friendlyStreamError(lastError)
  })()
  pendingStreams.set(videoId, task)
  try { return await task } finally { pendingStreams.delete(videoId) }
}

async function requestStream(entry, range) {
  return fetch(entry.url, { headers: { ...entry.headers, ...(range ? { range } : {}) } })
}

export async function youtubeStream(videoId, range) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt++) {
    let entry
    try { entry = await resolveYouTubeStream(videoId, true) }
    catch (error) {
      lastError = error
      if (attempt) throw error
      continue
    }
    let response
    try { response = await requestStream(entry, range) }
    catch {
      lastError = new Error('Не удалось подключиться к аудиопотоку YouTube')
      streamCache.delete(videoId)
      if (attempt) throw lastError
      continue
    }
    if ([403, 404, 410, 429].includes(response.status)) {
      try { await response.body?.cancel() } catch {}
      lastError = new Error(`YouTube не отдал поток (${response.status})`)
      streamCache.delete(videoId)
      if (attempt) break
      await new Promise(resolve => setTimeout(resolve, 350))
      continue
    }
    return { response, type: entry.type }
  }
  throw lastError || new Error('YouTube не отдал поток')
}

export async function warmYouTubeStream(videoId) {
  return resolveYouTubeStream(videoId)
}

function usableDownload(file) {
  try { const info = statSync(file); return info.isFile() && info.size > 0 } catch { return false }
}

export async function downloadYoutubeAudio(videoId, basePath, timeout = 180000) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Некорректный трек')
  let output = ''
  let failure = null
  try {
    output = await runYtdlp([
      `https://www.youtube.com/watch?v=${videoId}`,
      '-f', 'bestaudio[ext=m4a]/bestaudio/best',
      '--no-playlist',
      '--no-part',
      '--force-overwrites',
      '--no-warnings',
      '--socket-timeout', '20',
      '--retries', '2',
      '-o', `${basePath}.%(ext)s`,
      '--print', 'after_move:filepath',
      ...runtimeArgs(),
      ...authArgs(),
    ], timeout)
  } catch (error) {
    failure = error
  }
  const printed = String(output || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
  if (printed && usableDownload(printed)) return printed
  // Some ffmpeg builds fail the m4a container fix-up after the audio itself downloaded fine.
  const dir = dirname(basePath)
  const prefix = `${basename(basePath)}.`
  const leftovers = readdirSync(dir).filter(name => name.startsWith(prefix))
  const ready = leftovers.find(name => !/\.temp\.[^.]*$/i.test(name) && usableDownload(join(dir, name)))
  if (ready) {
    for (const name of leftovers) { if (name !== ready) try { unlinkSync(join(dir, name)) } catch {} }
    return join(dir, ready)
  }
  for (const name of leftovers) { try { unlinkSync(join(dir, name)) } catch {} }
  throw failure || new Error('yt-dlp не вернул путь к скачанному файлу')
}

const playlistSearchCache = new Map()
const playlistImportCache = new Map()
const recommendationCache = new Map()
const playlistHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'])
function bestArtwork(entry) {
  const list = Array.isArray(entry?.thumbnails) ? [...entry.thumbnails] : []
  return list.filter(item => /^https:\/\//.test(String(item?.url || ''))).sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0))[0]?.url || ''
}
function playlistCount(entry) {
  const value = Number(entry?.playlist_count ?? entry?.n_entries)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export async function searchYouTubePlaylists(query, { limit = 8 } = {}) {
  const text = String(query || '').trim().slice(0, 120)
  if (!text) return []
  const count = Math.min(Math.max(Number(limit) || 8, 1), 16)
  const key = `${count}:${text.toLowerCase()}`
  const cached = playlistSearchCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.playlists
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(text)}&sp=EgIQAw%253D%253D`
  const output = await runYtdlp([searchUrl, '--flat-playlist', '--dump-single-json', '--playlist-end', String(count), '--no-warnings', '--socket-timeout', '15', '--retries', '1'], 32000)
  let data
  try { data = JSON.parse(output) } catch { throw new Error('YouTube вернул неожиданный ответ') }
  const playlists = []
  const seen = new Set()
  for (const entry of Array.isArray(data.entries) ? data.entries : []) {
    const id = String(entry.id || '')
    if (!/^[\w-]{10,}$/.test(id) || seen.has(id)) continue
    seen.add(id)
    const artwork = bestArtwork(entry)
    playlists.push({
      id: `youtube:${id}`,
      source: 'youtube',
      title: tidy(entry.title) || 'Плейлист YouTube',
      owner: tidy(entry.channel || entry.uploader || 'YouTube'),
      artwork,
      url: /^https:\/\//.test(String(entry.url || '')) ? String(entry.url) : `https://www.youtube.com/playlist?list=${id}`,
      trackCount: playlistCount(entry),
      description: tidy(entry.description || '').slice(0, 200),
    })
    if (playlists.length >= count) break
  }
  prune(playlistSearchCache, 60)
  playlistSearchCache.set(key, { playlists, expires: Date.now() + 15 * 60_000 })
  return playlists
}

async function importPlaylistPartial(url, count, timeout = 22000) {
  const output = await runYtdlpPartial([url.toString(), '--flat-playlist', '--playlist-end', String(count), '--no-warnings', '--socket-timeout', '12', '--retries', '1', ...authArgs(), '--print', 'playlist:%(title)s\t%(channel,uploader)s', '--print', '%(id)s\t%(title)s\t%(channel,uploader)s\t%(duration)s\t%(thumbnail)s\t%(webpage_url)s'], timeout)
  const tracks = []
  const seen = new Set()
  let title = ''
  let owner = ''
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue
    const fields = line.split('\t')
    if (fields.length === 2) { if (!title) title = tidy(fields[0]); if (!owner) owner = tidy(fields[1]); continue }
    if (fields.length < 6) continue
    const [rawId, rawTitle, rawChannel, rawDuration, rawThumbnail, rawPage] = fields.map(value => value.trim())
    const duration = Number(rawDuration)
    const webpage = rawPage
    let track = null
    if (/^[\w-]{11}$/.test(rawId) && (/youtube\.com|youtu\.be/i.test(webpage) || !webpage || webpage === 'NA')) {
      const described = describe({ title: rawTitle, channel: rawChannel })
      track = { id: `yt:${rawId}`, title: described.title, artist: described.artist, artwork: /^https:\/\//.test(rawThumbnail) ? rawThumbnail : `https://i.ytimg.com/vi/${rawId}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${rawId}`, duration: Number.isFinite(duration) && duration > 0 ? duration : undefined, source: 'youtube' }
    } else if (/^https:\/\/(www\.|m\.)?soundcloud\.com\//i.test(webpage)) {
      const described = describe({ title: rawTitle, uploader: rawChannel })
      track = { id: `sc:${webpage}`, title: described.title, artist: tidy(rawChannel) || described.artist, artwork: /^https:\/\//.test(rawThumbnail) ? rawThumbnail : undefined, url: webpage, duration: Number.isFinite(duration) && duration > 0 ? duration : undefined, source: 'soundcloud' }
    }
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
    if (tracks.length >= count) break
  }
  if (!tracks.length) return null
  return { title: title || 'Чужой плейлист', owner: owner || 'Источник', artwork: tracks.find(track => track.artwork)?.artwork || '', url: url.toString(), source: /soundcloud\.com/i.test(url.hostname) ? 'soundcloud' : 'youtube', tracks }
}

function recommendationTrack(entry) {
  const videoId = String(entry?.id || '')
  if (!/^[\w-]{11}$/.test(videoId)) return null
  if (entry?.ie_key && entry.ie_key !== 'Youtube') return null
  const duration = Number(entry?.duration)
  if (Number.isFinite(duration) && (duration < 20 || duration > 1800)) return null
  const { artist, title } = describe(entry)
  if (catalogJunk.test(title)) return null
  return {
    id: `yt:${videoId}`,
    title,
    artist,
    artwork: bestArtwork(entry) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    streamUrl: `/api/yt-stream?v=${videoId}`,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    source: 'youtube',
  }
}

function mergeTracks(target, tracks) {
  const seen = new Set(target.map(track => track.id))
  for (const track of tracks) {
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    target.push(track)
  }
  return target
}

async function fastSeedSearch(query, timeout = 12000) {
  const text = String(query || '').trim().slice(0, 160)
  if (!text) return null
  const output = await runYtdlpPartial([`ytsearch5:${text}`, '--flat-playlist', '--no-warnings', '--socket-timeout', '8', '--retries', '1', '--print', '%(id)s\t%(title)s\t%(channel,uploader)s'], timeout)
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split('\t').map(value => value.trim())
    if (fields.length < 3 || !/^[\w-]{11}$/.test(fields[0])) continue
    if (fields[0].startsWith('UC')) continue
    const described = describe({ title: fields[1], channel: fields[2] })
    return { id: fields[0], title: described.title || 'Трек', artist: described.artist || 'YouTube' }
  }
  return null
}

function recommendationKey(track) {
  const clean = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return `${clean(track.artist)}|${clean(track.title)}`
}

const avoidVariants = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'remaster', 'remastered', 'visualizer', 'visualiser', 'clip', 'slowed', 'reverb', 'sped', 'nightcore', 'cover', 'live', 'version', 'edit', 'extended', 'radio', 'prod', 'feat', 'ft', 'hq', 'hd', '4k'])
function avoidTitleCore(value) {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter(word => word && !avoidVariants.has(word) && !/^\d{2,4}$/.test(word)).join(' ').trim()
}
function avoidIndex(avoid) {
  const ids = new Set()
  const cores = new Set()
  for (const entry of (Array.isArray(avoid) ? avoid : []).slice(0, 60)) {
    const id = String(entry?.id || '').slice(0, 300).trim()
    if (id) { ids.add(id); ids.add(id.replace(/^yt:/, '')); ids.add(`yt:${id.replace(/^yt:/, '')}`) }
    const core = avoidTitleCore(entry?.title)
    if (core) cores.add(core)
  }
  return {
    empty: !ids.size && !cores.size,
    ids,
    cores,
    match(track) {
      if (!track) return true
      const id = String(track.id || '')
      if (ids.has(id) || ids.has(id.replace(/^yt:/, ''))) return true
      const core = avoidTitleCore(track.title)
      return Boolean(core) && cores.has(core)
    },
  }
}
function applyAvoid(result, index) {
  if (!result || index.empty) return result
  return { ...result, tracks: (Array.isArray(result.tracks) ? result.tracks : []).filter(track => !index.match(track)) }
}

function mixRecommendations(lists, count, exclude) {
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
        if (!track || exclude.has(track.id) || seenId.has(track.id)) continue
        const key = recommendationKey(track)
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

async function externalRecommendations(wanted, query, count, refresh) {
  const text = String(query || '').trim().slice(0, 160)
  if (!text) return { yandex: [], vk: [] }
  const page = refresh ? 1 + Math.floor(Math.random() * 2) : 0
  const [yandex, vk] = await Promise.all([
    wanted === 'all' || wanted === 'yandex' ? searchYandex(text, count + 6, page).catch(() => []) : [],
    wanted === 'all' || wanted === 'vk' ? (vkEnabled() ? searchVk(text, count + 6, 'artist', page * 20).catch(() => []) : []) : [],
  ])
  return { yandex, vk }
}

export async function recommendTracks({ videoId, artist, title, scope = 'track', source = 'all', avoid = [] }, { limit = 24, refresh = false } = {}) {
  const wanted = ['all', 'youtube', 'yandex', 'vk'].includes(source) ? source : 'all'
  if (wanted === 'vk' && !vkEnabled()) throw new Error('Для ВКонтакте добавьте VK_ACCESS_TOKEN в .env')
  const avoidSet = avoidIndex(avoid)
  const count = Math.min(Math.max(Number(limit) || 24, 4), 30)
  const seedVideo = String(videoId || '').replace(/^yt:/, '')
  const cleanArtist = String(artist || '').trim().slice(0, 120)
  const cleanTitle = String(title || '').trim().slice(0, 160)
  const key = `${wanted}|${scope}|${/^[\w-]{11}$/.test(seedVideo) ? seedVideo : ''}|${cleanArtist}|${cleanTitle}`.toLowerCase()
  const cached = recommendationCache.get(key)
  if (!refresh && cached && cached.expires > Date.now()) return applyAvoid(cached.result, avoidSet)
  const extrasQuery = cleanArtist.split(',')[0].trim() || cleanArtist || cleanTitle
  const extrasTask = wanted === 'youtube' ? null : externalRecommendations(wanted, extrasQuery, count, refresh)
  if (wanted === 'yandex' || wanted === 'vk') {
    const extras = await extrasTask
    const exclude = new Set([`yt:${seedVideo}`, String(videoId || '')].filter(Boolean))
    const tracks = (wanted === 'yandex' ? extras.yandex : extras.vk).filter(track => !exclude.has(track.id)).slice(0, count)
    if (!tracks.length) throw new Error(wanted === 'vk' ? 'ВКонтакте не отдал похожие треки — проверьте токен или выберите другой трек' : 'Яндекс Музыка не отдала похожие треки — попробуйте другой трек')
    const result = { tracks, source: wanted, seed: { id: videoId || '', title: cleanTitle || 'Трек', artist: cleanArtist || 'Источник' } }
    prune(recommendationCache, 60)
    recommendationCache.set(key, { result, expires: Date.now() + 6 * 60_000 })
    return applyAvoid(result, avoidSet)
  }
  let seedId = scope === 'track' && /^[\w-]{11}$/.test(seedVideo) ? seedVideo : ''
  let seedArtist = cleanArtist
  let seedTitle = cleanTitle
  let tracks = []
  let directTracks = []
  if (!seedId && scope === 'artist') {
    const query = (cleanArtist || cleanTitle).trim()
    if (!query) throw new Error('Нужен исполнитель для рекомендаций')
    const direct = await searchYouTube(query, { limit: count, mode: 'artist', timeout: 20000 }).catch(() => [])
    for (const track of direct) {
      mergeTracks(tracks, [track])
      if (tracks.length >= count) break
    }
    if (refresh && tracks.length) {
      directTracks = tracks
      tracks = tracks.slice(0, Math.max(3, Math.ceil(count / 3)))
    }
    const first = tracks[0]
    if (first) { seedId = first.id.slice(3); seedArtist = cleanArtist || first.artist; seedTitle = cleanArtist || first.title }
  } else if (!seedId) {
    const query = (!cleanTitle ? cleanArtist || cleanTitle : `${cleanArtist} ${cleanTitle}`).trim()
    if (!query) throw new Error('Нужен трек или исполнитель для рекомендаций')
    const pick = await fastSeedSearch(query, 15000).catch(() => null)
    if (pick) {
      seedId = pick.id
      seedArtist = pick.artist
      seedTitle = pick.title
    }
  }
  const artistDirectEnough = scope === 'artist' && tracks.length >= Math.min(count, 8)
  const radioStart = refresh ? 2 + Math.floor(Math.random() * 14) : 1
  if (seedId && !artistDirectEnough) {
    try {
      const output = await runYtdlp([`https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`, '--flat-playlist', '--dump-single-json', '--playlist-start', String(radioStart), '--playlist-end', String(radioStart + count + 6), '--no-warnings', '--socket-timeout', '10', '--retries', '1', ...authArgs()], 22000)
      const data = JSON.parse(output)
      for (const entry of Array.isArray(data.entries) ? data.entries : []) {
        const track = recommendationTrack(entry)
        if (!track || track.id === `yt:${seedId}`) continue
        mergeTracks(tracks, [track])
        if (tracks.length >= count) break
      }
    } catch { /* the search fallback below still gives a useful mix */ }
  }
  if (seedId && tracks.length < Math.min(count, 8)) {
    const fallback = await importPlaylistPartial(new URL(`https://www.youtube.com/watch?v=${seedId}&list=RD${seedId}`), count + 4, 12000).catch(() => null)
    if (fallback) {
      for (const track of fallback.tracks) {
        if (track.id === `yt:${seedId}`) continue
        mergeTracks(tracks, [track.source === 'youtube' ? { ...track, streamUrl: `/api/yt-stream?v=${track.id.slice(3)}` } : track])
        if (tracks.length >= count) break
      }
    }
  }
  if (tracks.length < Math.min(count, 8)) {
    const primaryArtist = seedArtist.split(',')[0].trim()
    const query = scope === 'artist' ? primaryArtist : `${primaryArtist} ${seedTitle}`.trim()
    const extra = await searchYouTube(query || primaryArtist, { limit: Math.min(count, 20), mode: scope === 'artist' ? 'artist' : 'title', timeout: 18000 }).catch(() => [])
    for (const track of extra) {
      if (!/^yt:/.test(track.id) || track.id === `yt:${seedId}`) continue
      mergeTracks(tracks, [track])
      if (tracks.length >= count) break
    }
    if (!tracks.length && primaryArtist) {
      const retry = await searchYouTube(primaryArtist, { limit: Math.min(count, 20), mode: 'title', timeout: 14000 }).catch(() => [])
      for (const track of retry) {
        if (!/^yt:/.test(track.id) || track.id === `yt:${seedId}`) continue
        mergeTracks(tracks, [track])
        if (tracks.length >= count) break
      }
    }
  }
  if (extrasTask) {
    const extras = await extrasTask
    const exclude = new Set([`yt:${seedId}`, String(videoId || '')].filter(Boolean))
    tracks = mixRecommendations([tracks, extras.yandex, extras.vk], count, exclude)
  }
  if (directTracks.length && tracks.length < Math.min(count, 8)) {
    for (const track of directTracks) {
      mergeTracks(tracks, [track])
      if (tracks.length >= count) break
    }
  }
  if (!tracks.length) throw new Error(optsError(wanted))
  const result = { tracks, source: wanted, seed: { id: `yt:${seedId}`, title: seedTitle || 'Трек', artist: seedArtist || 'YouTube' } }
  prune(recommendationCache, 60)
  recommendationCache.set(key, { result, expires: Date.now() + (refresh ? 90_000 : 6 * 60_000) })
  return applyAvoid(result, avoidSet)
}

function optsError(wanted) {
  if (wanted === 'yandex') return 'Яндекс Музыка не отдала похожие треки — попробуйте другой трек'
  if (wanted === 'vk') return 'ВКонтакте не отдал похожие треки — проверьте токен или выберите другой трек'
  return 'Не удалось собрать похожие треки — попробуйте другой трек'
}

export async function recommendCollection(seeds, { limit = 24, refresh = false, source = 'all', avoid = [] } = {}) {  const wanted = ['all', 'youtube', 'yandex', 'vk'].includes(source) ? source : 'all'
  const clean = (Array.isArray(seeds) ? seeds : []).slice(0, 3).map(seed => ({
    id: String(seed?.id || '').trim().slice(0, 300),
    title: String(seed?.title || '').trim().slice(0, 160),
    artist: String(seed?.artist || '').trim().slice(0, 120),
  })).filter(seed => seed.title || seed.artist)
  if (!clean.length) throw new Error('Добавьте треки в подборку')
  const count = Math.min(Math.max(Number(limit) || 24, 8), 30)
  const key = `collection|${wanted}|${clean.map(seed => `${seed.id}|${seed.artist}|${seed.title}`).join('~')}|${count}`.toLowerCase()
  const cached = recommendationCache.get(key)
  if (!refresh && cached && cached.expires > Date.now()) return applyAvoid(cached.result, avoidIndex(avoid))
  const perSeed = Math.min(12, Math.max(6, Math.ceil(count / clean.length) + 2))
  const lists = await Promise.all(clean.map(seed => recommendTracks({ videoId: seed.id, artist: seed.artist, title: seed.title, scope: 'track', source: wanted }, { limit: perSeed, refresh }).then(result => result.tracks).catch(() => [])))
  const seen = new Set(clean.map(seed => seed.id).filter(Boolean))
  const tracks = []
  const cursors = lists.map(() => 0)
  while (tracks.length < count) {
    let progressed = false
    for (let index = 0; index < lists.length && tracks.length < count; index++) {
      while (cursors[index] < lists[index].length) {
        const track = lists[index][cursors[index]++]
        if (!track || seen.has(track.id)) continue
        seen.add(track.id)
        tracks.push(track)
        progressed = true
        break
      }
    }
    if (!progressed) break
  }
  if (!tracks.length) throw new Error('Не удалось собрать поток по подборке — попробуйте другие треки')
  const result = { tracks, source: wanted, collection: clean.map(({ id, title, artist }) => ({ id, title, artist })) }
  prune(recommendationCache, 60)
  recommendationCache.set(key, { result, expires: Date.now() + (refresh ? 90_000 : 6 * 60_000) })
  return applyAvoid(result, avoidIndex(avoid))
}

const nameKey = value => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

async function artistDirectTracks(name, wanted, count, refresh) {
  const page = refresh ? Math.floor(Math.random() * 2) : 0
  if (wanted === 'youtube') return searchYouTube(name, { limit: count, mode: 'artist', timeout: 18000 }).catch(() => [])
  if (wanted === 'yandex') return searchYandex(name, count, page).catch(() => [])
  if (wanted === 'vk') return vkEnabled() ? searchVk(name, count, 'artist', page * 20).catch(() => []) : []
  const [youtube, yandex, vk] = await Promise.all([
    searchYouTube(name, { limit: count, mode: 'artist', timeout: 18000 }).catch(() => []),
    searchYandex(name, count, page).catch(() => []),
    vkEnabled() ? searchVk(name, count, 'artist', page * 20).catch(() => []) : Promise.resolve([]),
  ])
  return mixRecommendations([youtube, yandex, vk], count, new Set())
}

export async function recommendMix({ tracks = [], artists = [], excludeIds = [], knownArtists = [], avoid = [] } = {}, { limit = 24, refresh = false, source = 'all' } = {}) {
  const wanted = ['all', 'youtube', 'yandex', 'vk'].includes(source) ? source : 'all'
  if (wanted === 'vk' && !vkEnabled()) throw new Error('Для ВКонтакте добавьте VK_ACCESS_TOKEN в .env')
  const avoidSet = avoidIndex(avoid)
  const count = Math.min(Math.max(Number(limit) || 24, 8), 30)
  const library = (Array.isArray(tracks) ? tracks : []).slice(0, 40).map(track => ({
    id: String(track?.id || '').trim().slice(0, 300),
    title: String(track?.title || '').trim().slice(0, 160),
    artist: String(track?.artist || '').trim().slice(0, 120),
  })).filter(track => track.title || track.artist)
  const follows = [...new Set((Array.isArray(artists) ? artists : []).map(name => String(name || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 20)
  if (!library.length && !follows.length) throw new Error('Добавь музыку в медиатеку или подпишись на исполнителей — и мы соберём микс под тебя')
  const known = new Set([...follows, ...library.map(track => track.artist)])
  for (const name of Array.isArray(knownArtists) ? knownArtists : []) known.add(String(name || '').slice(0, 120))
  const knownKeys = new Set([...known].map(nameKey).filter(Boolean))

  const exclude = new Set()
  const excludeKeys = new Set()
  for (const id of Array.isArray(excludeIds) ? excludeIds : []) { const clean = String(id || '').slice(0, 300); if (clean) exclude.add(clean) }
  for (const track of library) {
    if (track.id) { exclude.add(track.id); exclude.add(track.id.startsWith('yt:') ? track.id.slice(3) : `yt:${track.id}`) }
    const key = recommendationKey(track)
    if (key !== '|') excludeKeys.add(key)
  }
  const key = `mix|${wanted}|${count}|${[...library.map(track => `${track.id}|${track.artist}|${track.title}`), ...follows].sort().join('~')}`.toLowerCase()
  const cached = recommendationCache.get(key)
  if (!refresh && cached && cached.expires > Date.now()) return cached.result

  const rotate = list => {
    if (!refresh || list.length < 2) return list.slice()
    const offset = Math.floor(Math.random() * list.length)
    return [...list.slice(offset), ...list.slice(0, offset)]
  }
  const seedPicks = []
  for (const track of rotate(library)) {
    if (seedPicks.some(seed => nameKey(seed.artist) === nameKey(track.artist))) continue
    seedPicks.push(track)
    if (seedPicks.length >= 3) break
  }
  const followPicks = rotate(follows).slice(0, 3)
  const [seedLists, directLists] = await Promise.all([
    Promise.all(seedPicks.map(seed => recommendTracks({ videoId: seed.id, artist: seed.artist, title: seed.title, scope: 'track', source: wanted }, { limit: 7, refresh }).then(result => result.tracks).catch(() => []))),
    Promise.all(followPicks.map(name => artistDirectTracks(name, wanted, 8, refresh))),
  ])
  const radioSeeds = rotate(directLists.flat().filter(track => /^yt:/.test(track.id))).slice(0, 2)
  const radioLists = await Promise.all(radioSeeds.map(track => recommendTracks({ videoId: track.id, artist: track.artist, title: track.title, scope: 'track', source: wanted }, { limit: 6, refresh }).then(result => result.tracks).catch(() => [])))

  const cleanList = list => (Array.isArray(list) ? list : []).filter(track => track && !exclude.has(track.id) && !exclude.has(String(track.id).replace(/^yt:/, '')) && !excludeKeys.has(recommendationKey(track)) && !avoidSet.match(track))
  const followedTracks = mixRecommendations(directLists.map(cleanList), count, new Set())
  const similarTracks = mixRecommendations(radioLists.map(cleanList), count, new Set())
  const libraryTracks = mixRecommendations(seedLists.map(cleanList), count, new Set())
  let mixed = mixRecommendations([followedTracks, similarTracks, libraryTracks], count, new Set())
  if (mixed.length < Math.min(count, 8)) {
    const query = (seedPicks[0]?.artist || followPicks[0] || seedPicks[0]?.title || '').split(',')[0].trim()
    if (query) {
      const extra = await searchYouTube(query, { limit: Math.min(count, 20), mode: 'artist', timeout: 18000 }).catch(() => [])
      mixed = [...mixed, ...cleanList(extra).filter(track => !mixed.some(item => item.id === track.id))]
    }
  }
  const tracksOut = mixed.slice(0, count)
  if (!tracksOut.length) throw new Error('Не удалось собрать персональный микс — добавь ещё треки или смени источник')
  const newArtists = tracksOut.filter(track => !knownKeys.has(nameKey(track.artist))).length
  const result = {
    tracks: tracksOut,
    source: wanted,
    mix: { library: seedPicks.length, artists: followPicks.length, newArtists },
    seed: { id: '', title: 'Твоя медиатека', artist: followPicks.length ? `${followPicks.length} исполнителей` : 'персональный микс' },
  }
  prune(recommendationCache, 60)
  recommendationCache.set(key, { result, expires: Date.now() + (refresh ? 90_000 : 6 * 60_000) })
  const output = applyAvoid(result, avoidSet)
  if (!output.tracks.length) throw new Error('Почти всё в миксе попало в неинтересное — верни пару треков в настройках')
  return output
}

export async function importPlaylist(inputUrl, { limit = 60 } = {}) {  const raw = String(inputUrl || '').trim()
  if (!/^https:\/\//i.test(raw)) throw new Error('Вставьте ссылку на плейлист, начинающуюся с https://')
  let url
  try { url = new URL(raw) } catch { throw new Error('Некорректная ссылка на плейлист') }
  if (!playlistHosts.has(url.hostname.toLowerCase())) throw new Error('Поддерживаются плейлисты YouTube и SoundCloud')
  const count = Math.min(Math.max(Number(limit) || 60, 1), 120)
  const key = `${url.toString()}|${count}`
  const cached = playlistImportCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.playlist
  const output = await runYtdlp([url.toString(), '--flat-playlist', '--dump-single-json', '--playlist-end', String(count), '--no-warnings', '--socket-timeout', '15', '--retries', '1', ...authArgs()], 32000).catch(async error => {
    const fallback = await importPlaylistPartial(url, count).catch(() => null)
    if (!fallback) throw /не ответил вовремя/i.test(String(error?.message || '')) ? new Error('YouTube не отдал плейлист вовремя — попробуйте ещё раз') : error
    prune(playlistImportCache, 40)
    playlistImportCache.set(key, { playlist: fallback, expires: Date.now() + 5 * 60_000 })
    return null
  })
  if (!output) return playlistImportCache.get(key).playlist
  let data
  try { data = JSON.parse(output) } catch { throw new Error('Не удалось прочитать плейлист') }
  const entries = Array.isArray(data.entries) ? data.entries : data.id ? [data] : []
  const tracks = []
  const seen = new Set()
  for (const entry of entries) {
    const webpage = String(entry.webpage_url || entry.url || '')
    const youtubeId = String(entry.id || '')
    let track = null
    if ((entry.ie_key === 'Youtube' || /(^|\.)youtube\.com|youtu\.be/i.test(webpage)) && /^[\w-]{11}$/.test(youtubeId)) {
      const { artist, title } = describe(entry)
      track = {
        id: `yt:${youtubeId}`,
        title,
        artist,
        artwork: bestArtwork(entry) || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        duration: Number(entry.duration) || undefined,
        source: 'youtube',
      }
    } else if (entry.ie_key === 'Soundcloud' || /soundcloud\.com\//i.test(webpage)) {
      if (!/^https:\/\/(www\.|m\.)?soundcloud\.com\//i.test(webpage)) continue
      const { artist, title } = describe(entry)
      track = {
        id: `sc:${webpage}`,
        title,
        artist: tidy(entry.uploader || entry.channel || '') || artist,
        artwork: bestArtwork(entry),
        url: webpage,
        duration: Number(entry.duration) || undefined,
        source: 'soundcloud',
      }
    }
    if (!track || seen.has(track.id)) continue
    seen.add(track.id)
    tracks.push(track)
    if (tracks.length >= count) break
  }
  if (!tracks.length) throw new Error('В этом плейлисте не нашлось воспроизводимых треков')
  const playlist = {
    title: tidy(data.title || data.playlist_title || 'Чужой плейлист') || 'Чужой плейлист',
    owner: tidy(data.channel || data.uploader || data.creator || '') || 'Источник',
    artwork: bestArtwork(data) || tracks.find(track => track.artwork)?.artwork || '',
    url: url.toString(),
    source: /soundcloud\.com/i.test(url.hostname) ? 'soundcloud' : 'youtube',
    tracks,
  }
  prune(playlistImportCache, 40)
  playlistImportCache.set(key, { playlist, expires: Date.now() + 15 * 60_000 })
  return playlist
}
