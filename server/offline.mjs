import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { archiveDownload } from './archive.mjs'
import { downloadYoutubeAudio } from './ytdlp.mjs'
import { vkStreamById } from './vk.mjs'
import { yandexStream } from './yandex.mjs'

const root = resolve(process.env.KINETIX_OFFLINE_DIR || '.data/offline')
const indexPath = join(root, 'index.json')
const maxBytes = 220 * 1024 * 1024
const sources = new Set(['youtube', 'yandex', 'vk', 'archive'])
const mediaTypes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg', opus: 'audio/ogg', aac: 'audio/aac' }
const typeExt = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/x-m4a': 'm4a' }
const pending = new Map()
let index = null
let writing = Promise.resolve()

function normalise(track) {
  if (!track || typeof track !== 'object') return null
  const id = String(track.id || '').trim().slice(0, 300)
  const title = String(track.title || '').trim().slice(0, 150)
  const artist = String(track.artist || '').trim().slice(0, 150)
  const source = String(track.source || '').trim()
  if (!id || !title || !artist || !sources.has(source)) return null
  const duration = Number(track.duration)
  return {
    id, title, artist, source,
    artwork: /^https:\/\//.test(String(track.artwork || '')) ? String(track.artwork).slice(0, 500) : '',
    duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0,
  }
}

function keyOf(track) {
  return createHash('sha1').update(`${track.id}|${track.title}|${track.artist}`).digest('hex').slice(0, 28)
}

async function load() {
  if (index) return index
  const raw = await readFile(indexPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { tracks: {} }
    throw error
  })
  index = { tracks: raw && typeof raw.tracks === 'object' ? raw.tracks : {} }
  return index
}

function persist() {
  writing = writing.catch(() => {}).then(async () => {
    const data = await load()
    await mkdir(root, { recursive: true })
    const temp = `${indexPath}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(data), { mode: 0o600 })
    await rename(temp, indexPath)
  })
  return writing
}

async function fileExists(file) {
  try { return (await stat(file)).isFile() } catch { return false }
}

function publicEntry(entry) {
  const { file, ...safe } = entry
  return { ...safe, size: Number(entry.size) || 0, available: true }
}

export async function listCached() {
  const data = await load()
  const entries = []
  let changed = false
  for (const [key, entry] of Object.entries(data.tracks)) {
    if (!entry || !entry.file || !(await fileExists(join(root, entry.file)))) { delete data.tracks[key]; changed = true; continue }
    entries.push({ ...publicEntry(entry), key })
  }
  if (changed) await persist()
  return entries.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
}

async function streamTo(response, temp) {
  if (!response.ok || !response.body) throw new Error('Источник не отдал файл для офлайн-кэша')
  let size = 0
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) callback(new Error('Трек слишком большой для офлайн-кэша'))
      else callback(null, chunk)
    },
  })
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(temp))
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
  return size
}

async function download(track, temp) {
  if (track.source === 'youtube') {
    const videoId = track.id.replace(/^(yt|youtube):/, '')
    const file = await downloadYoutubeAudio(videoId, temp)
    const ext = extname(file).slice(1).toLowerCase() || 'm4a'
    const size = (await stat(file)).size
    if (size > maxBytes) { await unlink(file).catch(() => {}); throw new Error('Трек слишком большой для офлайн-кэша') }
    return { file, ext, type: mediaTypes[ext] || 'audio/mpeg', size }
  }
  let response
  let type = 'audio/mpeg'
  if (track.source === 'yandex') {
    const trackId = track.id.replace(/^yandex:/, '')
    if (!/^\d{1,20}$/.test(trackId)) throw new Error('Некорректный трек Яндекс Музыки')
    const result = await yandexStream(trackId)
    response = result.response
    type = String(result.entry?.type || response.headers.get('content-type') || 'audio/mpeg').split(';')[0]
  } else if (track.source === 'vk') {
    if (!/^vk:-?\d+_\d+$/.test(track.id)) throw new Error('Некорректный трек ВКонтакте')
    response = await vkStreamById(track.id)
  } else {
    const match = /^archive:([^:]+):(.+)$/.exec(track.id)
    if (!match) throw new Error('Некорректный трек Archive')
    const result = await archiveDownload(match[1], match[2])
    response = result.response
  }
  const size = await streamTo(response, temp)
  return { file: temp, ext: typeExt[type] || 'mp3', type, size }
}

export async function cacheTrack(track) {
  const clean = normalise(track)
  if (!clean) throw new Error('Некорректный трек для офлайн-кэша')
  const key = keyOf(clean)
  const data = await load()
  const existing = data.tracks[key]
  if (existing && await fileExists(join(root, existing.file))) return publicEntry(existing)
  if (existing) { delete data.tracks[key]; await persist() }
  if (pending.has(key)) return pending.get(key)
  const task = (async () => {
    await mkdir(root, { recursive: true })
    const temp = join(root, `${key}.${randomUUID()}.part`)
    let downloaded
    try {
      downloaded = await download(clean, temp)
      const final = join(root, `${key}.${downloaded.ext}`)
      if (resolve(downloaded.file) !== resolve(final)) {
        await rename(downloaded.file, final)
        downloaded.file = final
      }
    } catch (error) {
      await unlink(temp).catch(() => {})
      const leftovers = await readdir(root).catch(() => [])
      await Promise.all(leftovers.filter(name => name.startsWith(`${key}.`)).map(name => unlink(join(root, name)).catch(() => {})))
      throw error
    }
    const entry = {
      key,
      id: clean.id,
      title: clean.title,
      artist: clean.artist,
      artwork: clean.artwork,
      duration: clean.duration,
      source: clean.source,
      file: downloaded.file.slice(root.length + 1),
      type: downloaded.type,
      size: downloaded.size,
      createdAt: new Date().toISOString(),
    }
    const current = await load()
    current.tracks[key] = entry
    await persist()
    return publicEntry(entry)
  })()
  pending.set(key, task)
  try { return await task } finally { pending.delete(key) }
}

export async function removeCached(key) {
  if (!/^[a-f0-9]{20,40}$/.test(String(key || ''))) throw new Error('Некорректный ключ кэша')
  const data = await load()
  const entry = data.tracks[key]
  if (!entry) throw new Error('Трек не найден в офлайн-кэше')
  delete data.tracks[key]
  await persist()
  await unlink(join(root, entry.file)).catch(() => {})
  return publicEntry(entry)
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!match || size <= 0) return null
  let start
  let end
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
    if (!Number.isFinite(start) || start > end || start >= size) return null
  }
  return { start, end }
}

export async function openCached(key, rangeHeader) {
  if (!/^[a-f0-9]{20,40}$/.test(String(key || ''))) return null
  const data = await load()
  const entry = data.tracks[key]
  if (!entry) return null
  const file = resolve(root, entry.file)
  if (!file.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) return null
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) return null
  const range = parseRange(rangeHeader, info.size)
  if (rangeHeader && !range) return { invalid: true, size: info.size }
  return {
    entry,
    path: file,
    size: info.size,
    status: range ? 206 : 200,
    start: range ? range.start : 0,
    end: range ? range.end : info.size - 1,
    type: entry.type || 'audio/mpeg',
    stream: () => createReadStream(file, range ? { start: range.start, end: range.end } : undefined),
  }
}
