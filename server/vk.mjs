const API = 'https://api.vk.com/method'
const searchCache = new Map()
const streamCache = new Map()
const audioHost = /(^|\.)(userapi\.com|vkuseraudio\.net|vk-cdn\.net|mycdn\.me|vk\.com)$/i
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
let tokenIssue = ''

function token() { return String(process.env.VK_ACCESS_TOKEN || '').trim() }
export function vkEnabled() { return Boolean(token()) }
export function vkIssue() { return vkEnabled() ? tokenIssue : '' }

function apiError(raw) {
  const message = String(raw || '')
  if (/access_token.*(expired|invalid)|user authorization failed|authorization failed/i.test(message)) {
    tokenIssue = 'Токен ВКонтакте истёк. Обновите VK_ACCESS_TOKEN в .env и перезапустите сервер.'
    return new Error(tokenIssue)
  }
  return new Error(message || 'ВКонтакте отклонил запрос')
}

async function call(method, params = {}, timeout = 12000) {
  if (!vkEnabled()) throw new Error('Для ВКонтакте добавьте VK_ACCESS_TOKEN в .env')
  const target = new URL(`${API}/${method}`)
  target.search = new URLSearchParams({ access_token: token(), v: '5.95', ...params }).toString()
  const response = await fetch(target, { headers: { accept: 'application/json', 'user-agent': userAgent }, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw new Error(`ВКонтакте недоступен (${response.status})`)
  const data = await response.json().catch(() => null)
  if (!data || data.error) throw apiError(data?.error?.error_msg)
  tokenIssue = ''
  return data.response
}

function trackId(item) { return `vk:${item.owner_id}_${item.id}` }
export function vkStreamUrl(id) { return `/api/vk-stream?id=${encodeURIComponent(id)}` }

function normalise(item) {
  if (!item || !item.url || item.id === undefined || item.owner_id === undefined) return null
  return {
    id: trackId(item),
    title: String(item.title || 'Без названия'),
    artist: String(item.artist || 'ВКонтакте'),
    artwork: item.album?.thumb?.photo_600 || item.album?.thumb?.photo_270 || undefined,
    streamUrl: vkStreamUrl(trackId(item)),
    duration: Number(item.duration) || undefined,
    source: 'vk',
  }
}

export async function searchVk(query, limit = 20, mode = 'title', offset = 0) {
  if (!vkEnabled()) throw new Error('Для ВКонтакте добавьте VK_ACCESS_TOKEN в .env')
  const text = String(query || '').trim().slice(0, 160)
  if (!text) return []
  const start = Math.max(0, Math.min(Number(offset) || 0, 200))
  const key = `${mode}:${start}:${text.toLowerCase()}`
  const cached = searchCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.tracks.slice(0, limit)
  const response = await call('audio.search', {
    q: text,
    count: String(Math.min(Math.max(limit, 1), 50)),
    ...(start ? { offset: String(start) } : {}),
    ...(mode === 'artist' ? { performer_only: '1' } : {}),
  })
  const items = Array.isArray(response) ? response : response?.items || []
  const tracks = items.map(normalise).filter(Boolean)
  if (searchCache.size > 120) searchCache.delete(searchCache.keys().next().value)
  searchCache.set(key, { tracks, expires: Date.now() + 5 * 60_000 })
  return tracks.slice(0, limit)
}

function hostAllowed(raw) {
  try {
    const target = new URL(raw)
    return target.protocol === 'https:' && audioHost.test(target.hostname)
  } catch { return false }
}

function fetchAudio(url, range) {
  return fetch(url, { headers: { 'user-agent': userAgent, ...(range ? { range } : {}) } })
}

async function resolveById(id, force = false) {
  const match = /^(?:vk:)?(-?\d+)_(\d+)$/.exec(String(id || '').trim())
  if (!match) throw new Error('Некорректный идентификатор трека ВКонтакте')
  const audioId = `${match[1]}_${match[2]}`
  const cached = streamCache.get(audioId)
  if (!force && cached && cached.expires > Date.now()) return cached
  const response = await call('audio.getById', { audios: audioId }, 10000)
  const item = Array.isArray(response) ? response[0] : response?.items?.[0]
  const url = String(item?.url || '')
  if (!url) throw new Error('ВКонтакте не отдал аудиопоток — трек удалён или скрыт')
  if (!hostAllowed(url)) throw new Error('ВКонтакте вернул небезопасную ссылку на поток')
  let expires = Date.now() + 30 * 60_000
  const signed = Number(new URL(url).searchParams.get('expires'))
  if (Number.isFinite(signed) && signed > 0) expires = Math.min(expires, signed * 1000 - 60_000)
  if (streamCache.size > 80) streamCache.delete(streamCache.keys().next().value)
  const entry = { url, expires }
  streamCache.set(audioId, entry)
  return entry
}

export async function vkStreamById(id, range) {
  const entry = await resolveById(id)
  let response = await fetchAudio(entry.url, range)
  if (response.ok || response.status === 206) return response
  try { await response.body?.cancel() } catch {}
  const fresh = await resolveById(id, true)
  response = await fetchAudio(fresh.url, range)
  return response
}

export async function vkStream(rawUrl, range) {
  const url = String(rawUrl || '')
  if (!hostAllowed(url)) throw new Error('Недопустимый источник ВКонтакте')
  return fetchAudio(url, range)
}

export function resetVkToken() {
  tokenIssue = ''
  searchCache.clear()
  streamCache.clear()
}

export async function probeVkToken() {
  if (!vkEnabled()) return false
  try {
    await call('users.get', {}, 8000)
    return true
  } catch (error) {
    if (!tokenIssue) tokenIssue = String(error?.message || 'Токен ВКонтакте не принят')
    return false
  }
}
