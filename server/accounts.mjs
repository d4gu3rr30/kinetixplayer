import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { OAuth2Client } from 'google-auth-library'

const scrypt = promisify(scryptCallback)
const dataPath = resolve(process.env.KINETIX_DATA_FILE || '.data/users.json')
const cookieName = 'kinetix_session'
const sessionLifetime = 30 * 24 * 60 * 60 * 1000
const loginAttempts = new Map()
const googleClient = new OAuth2Client()
const googlePending = new Map()
const googleTickets = new Map()
const googleFlowTtl = 10 * 60_000
let loading
let writing = Promise.resolve()

async function db() {
  if (!loading) loading = readFile(dataPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { users: [], sessions: [] }
    throw error
  })
  return loading
}

function persist() {
  writing = writing.catch(() => {}).then(async () => {
    const current = await db()
    await mkdir(dirname(dataPath), { recursive: true })
    const temp = `${dataPath}.${randomUUID()}.tmp`
    await writeFile(temp, JSON.stringify(current), { mode: 0o600 })
    await rename(temp, dataPath)
  })
  return writing
}

function reply(res, status, value, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(JSON.stringify(value))
}

async function body(req) {
  let length = 0
  const chunks = []
  for await (const chunk of req) {
    length += chunk.length
    if (length > 3_000_000) throw new Error('Слишком большой запрос')
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw new Error('Некорректный JSON') }
}

function tokenHash(token) { return createHash('sha256').update(token).digest('hex') }
function publicUser(user) { const { passwordHash, salt, googleSub, ...safe } = user; return { ...safe, playlists: Array.isArray(user.playlists) ? user.playlists : [], statusTrack: user.statusTrack || null, googleLinked: Boolean(googleSub) } }
export async function sharedMoment(token) {
  if (!/^[a-f0-9]{16,64}$/.test(String(token || ''))) return null
  const data = await db()
  for (const owner of data.users) for (const moment of Array.isArray(owner.moments) ? owner.moments : []) {
    if (moment.shareToken === token) return { moment, owner: { name: owner.name, avatar: owner.avatar } }
  }
  return null
}
const trackSources = new Set(['soundcloud', 'archive', 'audius', 'local', 'youtube', 'yandex', 'vk'])
function sanitizeTrack(input) {
  if (!input || typeof input !== 'object') return null
  const id = String(input.id || '').trim().slice(0, 300)
  const title = String(input.title || '').trim().slice(0, 150)
  const artist = String(input.artist || '').trim().slice(0, 150)
  const source = String(input.source || '').trim()
  if (!id || !title || !artist || !trackSources.has(source)) return null
  const artwork = /^https:\/\//.test(String(input.artwork || '')) ? String(input.artwork).slice(0, 500) : ''
  const url = /^https:\/\//.test(String(input.url || '')) ? String(input.url).slice(0, 500) : ''
  const streamUrl = /^\/api\/(yt-stream|yandex-stream|vk-stream)\?[\x21-\x7e]{1,460}$/.test(String(input.streamUrl || '')) ? String(input.streamUrl) : ''
  const duration = Number(input.duration)
  return { id, title, artist, artwork, url, streamUrl, source, duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0, preview: Boolean(input.preview) }
}
function sanitizePlaylistTrackList(input) {
  const list = Array.isArray(input) ? input.slice(0, 200) : []
  const seen = new Set()
  return list.map(sanitizeTrack).filter(track => { if (!track || seen.has(track.id)) return false; seen.add(track.id); return true })
}
function sanitizeCover(value) {
  const text = String(value || '')
  if (/^https:\/\//.test(text)) return text.slice(0, 500)
  if (/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(text) && text.length <= 400_000) return text
  return ''
}
function playlistDuration(playlist) { return playlist.tracks.reduce((sum, track) => sum + (track.duration || 0), 0) }
function playlistSummary(playlist, owner) {
  return { id: playlist.id, name: playlist.name, description: playlist.description, cover: playlist.cover, isPublic: playlist.isPublic, trackCount: playlist.tracks.length, duration: playlistDuration(playlist), owner: { name: owner.name, avatar: owner.avatar }, createdAt: playlist.createdAt, updatedAt: playlist.updatedAt, tracks: playlist.tracks.slice(0, 4) }
}
function normalizePlaylistQuery(value) { return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
function cookie(req, value, age) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https'
  return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`
}
function sessionToken(req) { const entry = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`)); return entry?.slice(cookieName.length + 1) }
async function currentUser(req) {
  const token = sessionToken(req)
  if (!token) return null
  const data = await db()
  const session = data.sessions.find(item => item.hash === tokenHash(token) && item.expires > Date.now())
  return session ? data.users.find(item => item.id === session.userId) || null : null
}
async function createSession(user) {
  const token = randomBytes(32).toString('hex')
  const data = await db()
  data.sessions = data.sessions.filter(item => item.expires > Date.now())
  data.sessions.push({ hash: tokenHash(token), userId: user.id, expires: Date.now() + sessionLifetime })
  await persist()
  return token
}
async function startSession(req, res, user) {
  const token = await createSession(user)
  reply(res, 200, { user: publicUser(user) }, { 'set-cookie': cookie(req, token, Math.floor(sessionLifetime / 1000)) })
}
async function passwordHash(password, salt) { return (await scrypt(password, salt, 64)).toString('hex') }
function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const url = new URL(origin)
    const host = req.headers.host?.split(':')[0]
    return url.hostname === host && (url.port === '5173' || url.host === req.headers.host)
  } catch { return false }
}

function pruneGoogleFlows() {
  const now = Date.now()
  for (const [key, entry] of googlePending) if (entry.created + googleFlowTtl < now) googlePending.delete(key)
  for (const [key, entry] of googleTickets) if (entry.created + googleFlowTtl < now) googleTickets.delete(key)
}

async function googleSignIn(payload, signedIn = null) {
  if (!payload?.sub || !payload.email || !payload.email_verified) return { error: 'Google не подтвердил email' }
  const data = await db()
  let user = data.users.find(item => item.googleSub === payload.sub)
  let newAccount = false
  if (user && signedIn && user.id !== signedIn.id) return { error: 'Этот Google-аккаунт уже привязан к другому профилю' }
  if (!user && signedIn) {
    if (signedIn.googleSub && signedIn.googleSub !== payload.sub) return { error: 'К профилю уже привязан другой Google-аккаунт' }
    signedIn.googleSub = payload.sub
    await persist()
    user = signedIn
  }
  if (!user) {
    const existing = data.users.find(item => item.email === payload.email.toLowerCase())
    if (existing) {
      if (signedIn?.id !== existing.id) return { error: 'Этот email уже зарегистрирован. Войдите по паролю, затем привяжите Google в профиле.' }
      existing.googleSub = payload.sub
      await persist()
      user = existing
    } else {
      const salt = randomBytes(16).toString('hex')
      user = { id: randomUUID(), email: payload.email.toLowerCase(), name: String(payload.name || payload.given_name || 'Слушатель').slice(0, 40), status: '', statusTrack: null, avatar: /^https:\/\//.test(payload.picture || '') ? payload.picture : '', artists: [], moments: [], googleSub: payload.sub, salt, passwordHash: await passwordHash(randomBytes(32).toString('hex'), salt), createdAt: new Date().toISOString() }
      data.users.push(user)
      newAccount = true
    }
  }
  return { user, newAccount }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}

function googlePage(res, status, title, text) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kinetix · ${escapeHtml(title)}</title><style>
    :root{color-scheme:dark}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101115;color:#e9ece4;font:16px/1.5 "Segoe UI",system-ui,sans-serif}
    .card{max-width:420px;padding:44px 38px;border-radius:26px;background:radial-gradient(circle at 20% 0%,#d7ff5714,transparent 60%),#15171c;border:1px solid #ffffff12;text-align:center;box-shadow:0 30px 80px #00000070}
    .mark{width:58px;height:58px;margin:0 auto 20px;border-radius:18px;display:grid;place-items:center;background:#d7ff57;color:#111;font-weight:800;font-size:26px}
    h1{margin:0 0 10px;font-size:24px;letter-spacing:-.02em}
    p{margin:0;color:#aab2a6}
  </style></head><body><div class="card"><div class="mark">K</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div></body></html>`)
}

export async function accountRoute(req, res, url) {
  if (!['/api/me', '/api/me/import', '/api/auth/register', '/api/auth/login', '/api/auth/google', '/api/auth/google/start', '/api/auth/google/callback', '/api/auth/google/poll', '/api/auth/logout', '/api/moments', '/api/playlists'].includes(url.pathname) && !url.pathname.startsWith('/api/moments/') && !url.pathname.startsWith('/api/playlists/')) return false
  try {
    if (req.method !== 'GET' && !sameOrigin(req)) return reply(res, 403, { error: 'Недопустимый источник запроса' }), true
    if (url.pathname === '/api/me' && req.method === 'GET') return reply(res, 200, { user: (user => user ? publicUser(user) : null)(await currentUser(req)) }), true
    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const input = await body(req)
      const email = String(input.email || '').trim().toLowerCase()
      const name = String(input.name || '').trim()
      const password = String(input.password || '')
      const artists = Array.isArray(input.artists) ? [...new Set(input.artists)].filter(id => typeof id === 'string' && /^[a-z0-9-]{1,50}$/.test(id)).slice(0, 50) : []
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) return reply(res, 400, { error: 'Введите корректный email' }), true
      if (name.length < 2 || name.length > 40) return reply(res, 400, { error: 'Имя должно содержать от 2 до 40 символов' }), true
      if (password.length < 10 || password.length > 200) return reply(res, 400, { error: 'Пароль должен содержать минимум 10 символов' }), true
      const data = await db()
      if (data.users.some(user => user.email === email)) return reply(res, 409, { error: 'Аккаунт с таким email уже существует' }), true
      const salt = randomBytes(16).toString('hex')
      const user = { id: randomUUID(), email, name, status: '', statusTrack: null, avatar: '', artists, moments: [], salt, passwordHash: await passwordHash(password, salt), createdAt: new Date().toISOString() }
      data.users.push(user)
      await startSession(req, res, user)
      return true
    }
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const input = await body(req)
      const email = String(input.email || '').trim().toLowerCase()
      const key = `${req.socket.remoteAddress}:${email}`
      const attempts = loginAttempts.get(key) || { count: 0, reset: 0 }
      if (attempts.count >= 8 && attempts.reset > Date.now()) return reply(res, 429, { error: 'Слишком много попыток. Попробуйте позже.' }), true
      const data = await db()
      const user = data.users.find(item => item.email === email)
      const candidate = await passwordHash(String(input.password || ''), user?.salt || 'invalid-user-salt')
      const valid = user && timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(user.passwordHash, 'hex'))
      if (!valid) { loginAttempts.set(key, { count: attempts.reset > Date.now() ? attempts.count + 1 : 1, reset: Date.now() + 15 * 60_000 }); return reply(res, 401, { error: 'Неверный email или пароль' }), true }
      loginAttempts.delete(key)
      await startSession(req, res, user)
      return true
    }
    if (url.pathname === '/api/auth/google' && req.method === 'POST') {
      if (!process.env.GOOGLE_CLIENT_ID) return reply(res, 503, { error: 'Google OAuth Client ID не настроен' }), true
      const input = await body(req)
      const idToken = String(input.idToken || '')
      if (idToken.length < 100 || idToken.length > 10000) return reply(res, 400, { error: 'Некорректный Google токен' }), true
      let payload
      try { const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID }); payload = ticket.getPayload() } catch { return reply(res, 401, { error: 'Не удалось проверить Google-вход' }), true }
      const result = await googleSignIn(payload, await currentUser(req))
      if (result.error) return reply(res, 409, { error: result.error }), true
      await startSession(req, res, result.user)
      return true
    }
    if (url.pathname === '/api/auth/google/start' && req.method === 'POST') {
      const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
      if (!clientId) return reply(res, 503, { error: 'Google-вход пока не настроен: добавьте Client ID в настройках Kinetix' }), true
      const host = String(req.headers.host || '')
      if (!/^(127\.0\.0\.1|localhost):\d{2,5}$/i.test(host)) return reply(res, 400, { error: 'Недопустимый адрес возврата' }), true
      pruneGoogleFlows()
      const signedIn = await currentUser(req)
      const state = randomBytes(24).toString('hex')
      const verifier = randomBytes(48).toString('base64url')
      const redirectUri = `http://${host}/api/auth/google/callback`
      googlePending.set(state, { verifier, redirectUri, linkUserId: signedIn?.id || null, created: Date.now() })
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })
      return reply(res, 200, { url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state }), true
    }
    if (url.pathname === '/api/auth/google/callback' && req.method === 'GET') {
      const state = String(url.searchParams.get('state') || '')
      const entry = googlePending.get(state)
      googlePending.delete(state)
      const fail = (status, title, text) => {
        if (state) googleTickets.set(state, { error: text, created: Date.now() })
        return googlePage(res, status, title, text)
      }
      if (!entry || entry.created + googleFlowTtl < Date.now()) return fail(400, 'Ссылка устарела', 'Начните вход заново из приложения Kinetix.'), true
      if (url.searchParams.get('error')) return fail(400, 'Вход отменён', 'Можно закрыть эту вкладку и вернуться в Kinetix.'), true
      const code = String(url.searchParams.get('code') || '')
      if (!code) return fail(400, 'Google не вернул код доступа', 'Начните вход заново из приложения Kinetix.'), true
      const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim()
      const form = new URLSearchParams({ code, client_id: clientId, redirect_uri: entry.redirectUri, grant_type: 'authorization_code', code_verifier: entry.verifier })
      const secret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim()
      if (secret) form.set('client_secret', secret)
      let tokens
      try {
        const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
        tokens = await response.json()
        if (!response.ok) throw new Error(tokens.error_description || tokens.error || 'Google отклонил вход')
      } catch (error) {
        return fail(502, 'Google не завершил вход', String(error.message || 'Попробуйте ещё раз')), true
      }
      if (!tokens.id_token) return fail(502, 'Google не вернул профиль', 'Попробуйте ещё раз из приложения Kinetix.'), true
      let payload
      try { const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience: clientId }); payload = ticket.getPayload() } catch { return fail(401, 'Не удалось проверить Google', 'Попробуйте ещё раз из приложения Kinetix.'), true }
      const signedIn = entry.linkUserId ? (await db()).users.find(item => item.id === entry.linkUserId) || null : null
      const result = await googleSignIn(payload, signedIn)
      if (result.error) return fail(409, 'Вход не завершён', result.error), true
      googleTickets.set(state, { user: result.user, newAccount: result.newAccount, created: Date.now() })
      return googlePage(res, 200, 'Готово!', 'Вернитесь в Kinetix — вход уже выполнен. Эту вкладку можно закрыть.'), true
    }
    if (url.pathname === '/api/auth/google/poll' && req.method === 'GET') {
      const state = String(url.searchParams.get('state') || '')
      const ticket = googleTickets.get(state)
      if (!ticket) return reply(res, 200, { status: 'pending' }), true
      googleTickets.delete(state)
      if (ticket.created + googleFlowTtl < Date.now()) return reply(res, 200, { status: 'expired', error: 'Время входа истекло' }), true
      if (ticket.error) return reply(res, 200, { status: 'error', error: ticket.error }), true
      const token = await createSession(ticket.user)
      return reply(res, 200, { status: 'ok', user: publicUser(ticket.user), newAccount: ticket.newAccount }, { 'set-cookie': cookie(req, token, Math.floor(sessionLifetime / 1000)) }), true
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = sessionToken(req)
      if (token) { const data = await db(); data.sessions = data.sessions.filter(item => item.hash !== tokenHash(token)); await persist() }
      reply(res, 200, { ok: true }, { 'set-cookie': cookie(req, '', 0) })
      return true
    }
    if (url.pathname.startsWith('/api/moments/shared/') && req.method === 'GET') {
      const token = url.pathname.slice('/api/moments/shared/'.length)
      const shared = await sharedMoment(token)
      return shared ? reply(res, 200, shared) : reply(res, 404, { error: 'Момент не найден' }), true
    }
    const user = await currentUser(req)
    if (!user) return reply(res, 401, { error: 'Сначала войдите в аккаунт' }), true
    if (url.pathname === '/api/me/import' && req.method === 'POST') {
      const input = await body(req)
      const profile = input.profile
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return reply(res, 400, { error: 'Некорректный файл переноса' }), true
      const name = profile.name === undefined ? user.name : String(profile.name).trim()
      if (name.length < 2 || name.length > 40) return reply(res, 400, { error: 'Имя должно содержать от 2 до 40 символов' }), true
      const status = profile.status === undefined ? user.status : String(profile.status).trim()
      if (status.length > 120) return reply(res, 400, { error: 'Статус слишком длинный' }), true
      let avatar = user.avatar
      if (profile.avatar !== undefined) {
        avatar = String(profile.avatar)
        if (avatar && !((/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar) && avatar.length <= 350_000) || (/^https:\/\/lh\d+\.googleusercontent\.com\//.test(avatar) && avatar.length <= 500))) return reply(res, 400, { error: 'Аватар в файле некорректен' }), true
      }
      const artists = profile.artists === undefined ? user.artists : Array.isArray(profile.artists) ? [...new Set(profile.artists)].filter(id => typeof id === 'string' && /^[a-z0-9-]{1,50}$/.test(id)).slice(0, 50) : null
      if (!artists) return reply(res, 400, { error: 'Некорректный список исполнителей' }), true
      let statusTrack = user.statusTrack
      if (profile.statusTrack !== undefined) {
        if (profile.statusTrack === null) statusTrack = null
        else { statusTrack = sanitizeTrack(profile.statusTrack); if (!statusTrack) return reply(res, 400, { error: 'Некорректный трек настроения' }), true }
      }
      let playlists = Array.isArray(user.playlists) ? user.playlists : []
      if (Array.isArray(profile.playlists)) playlists = profile.playlists.slice(0, 40).map(item => {
        const title = String(item?.name || '').trim().slice(0, 60)
        if (!title) return null
        const now = new Date().toISOString()
        return { id: randomUUID(), name: title, description: String(item.description || '').trim().slice(0, 200), isPublic: Boolean(item.isPublic), cover: sanitizeCover(item.cover), tracks: sanitizePlaylistTrackList(item.tracks), createdAt: /^\d{4}-\d{2}-\d{2}T/.test(String(item.createdAt || '')) ? String(item.createdAt) : now, updatedAt: now }
      }).filter(Boolean)
      let moments = Array.isArray(user.moments) ? user.moments : []
      if (Array.isArray(profile.moments)) moments = profile.moments.slice(0, 100).map(item => {
        const lines = Array.isArray(item?.lines) ? item.lines.slice(0, 8).map(line => ({ at: Number(line?.at), text: String(line?.text || '').trim().slice(0, 300) })) : []
        const track = item?.track || {}
        const duration = Number(track.duration)
        if (!lines.length || lines.some(line => !line.text || !Number.isFinite(line.at) || line.at < 0) || !String(track.title || '').trim() || !String(track.artist || '').trim()) return null
        return { id: randomUUID(), lines, track: { id: String(track.id || '').slice(0, 300), title: String(track.title).slice(0, 150), artist: String(track.artist).slice(0, 150), artwork: /^https:\/\//.test(String(track.artwork || '')) ? String(track.artwork).slice(0, 500) : '', url: /^https:\/\//.test(String(track.url || '')) ? String(track.url).slice(0, 500) : '', duration: Number.isFinite(duration) && duration > 0 ? Math.min(Math.round(duration), 86_400) : 0 }, createdAt: /^\d{4}-\d{2}-\d{2}T/.test(String(item.createdAt || '')) ? String(item.createdAt) : new Date().toISOString() }
      }).filter(Boolean)
      user.name = name
      user.status = status
      user.avatar = avatar
      user.artists = artists
      user.statusTrack = statusTrack
      user.playlists = playlists
      user.moments = moments
      await persist()
      return reply(res, 200, { user: publicUser(user) }), true
    }
    if (url.pathname === '/api/me' && req.method === 'PATCH') {
      const input = await body(req)
      if (input.name !== undefined) { const name = String(input.name).trim(); if (name.length < 2 || name.length > 40) return reply(res, 400, { error: 'Имя должно содержать от 2 до 40 символов' }), true; user.name = name }
      if (input.status !== undefined) { const status = String(input.status).trim(); if (status.length > 120) return reply(res, 400, { error: 'Статус слишком длинный' }), true; user.status = status }
      if (input.avatar !== undefined) { const avatar = String(input.avatar); if (avatar && !((/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(avatar) && avatar.length <= 350_000) || (/^https:\/\/lh\d+\.googleusercontent\.com\//.test(avatar) && avatar.length <= 500))) return reply(res, 400, { error: 'Загрузите PNG, JPEG или WebP' }), true; user.avatar = avatar }
      if (input.artists !== undefined) { if (!Array.isArray(input.artists)) return reply(res, 400, { error: 'Некорректный список исполнителей' }), true; user.artists = [...new Set(input.artists)].filter(id => typeof id === 'string' && /^[a-z0-9-]{1,50}$/.test(id)).slice(0, 50) }
      if (input.statusTrack !== undefined) {
        if (input.statusTrack === null) user.statusTrack = null
        else { const track = sanitizeTrack(input.statusTrack); if (!track) return reply(res, 400, { error: 'Некорректный трек настроения' }), true; user.statusTrack = track }
      }
      await persist()
      return reply(res, 200, { user: publicUser(user) }), true
    }
    if (url.pathname === '/api/moments' && req.method === 'POST') {
      const input = await body(req)
      const lines = Array.isArray(input.lines) ? input.lines.slice(0, 8).map(line => ({ at: Number(line.at), text: String(line.text || '').trim().slice(0, 300) })) : []
      const track = input.track || {}
      if (!lines.length || lines.some(line => !line.text || !Number.isFinite(line.at) || line.at < 0) || !String(track.title || '').trim() || !String(track.artist || '').trim()) return reply(res, 400, { error: 'Выберите строки и трек' }), true
      if (user.moments.length >= 100) return reply(res, 400, { error: 'Достигнут лимит 100 моментов' }), true
      const trackDuration = Number(track.duration)
      const moment = { id: randomUUID(), lines, track: { id: String(track.id || '').slice(0, 300), title: String(track.title).slice(0, 150), artist: String(track.artist).slice(0, 150), artwork: /^https:\/\//.test(String(track.artwork || '')) ? String(track.artwork).slice(0, 500) : '', url: /^https:\/\//.test(String(track.url || '')) ? String(track.url).slice(0, 500) : '', duration: Number.isFinite(trackDuration) && trackDuration > 0 ? Math.min(Math.round(trackDuration), 86_400) : 0 }, createdAt: new Date().toISOString() }
      user.moments.unshift(moment)
      await persist()
      return reply(res, 201, { user: publicUser(user), moment }), true
    }
    const shareMatch = url.pathname.match(/^\/api\/moments\/([a-zA-Z0-9-]{1,64})\/share$/)
    if (shareMatch && req.method === 'POST') {
      const moment = user.moments.find(item => item.id === shareMatch[1])
      if (!moment) return reply(res, 404, { error: 'Момент не найден' }), true
      if (!moment.shareToken) { moment.shareToken = randomBytes(12).toString('hex'); await persist() }
      return reply(res, 200, { token: moment.shareToken, path: `/m/${moment.shareToken}` }), true
    }
    if (url.pathname.startsWith('/api/moments/') && req.method === 'DELETE') {
      const id = url.pathname.slice('/api/moments/'.length)
      const count = user.moments.length
      user.moments = user.moments.filter(item => item.id !== id)
      if (count === user.moments.length) return reply(res, 404, { error: 'Момент не найден' }), true
      await persist()
      return reply(res, 200, { user: publicUser(user) }), true
    }
    if (url.pathname === '/api/playlists' && req.method === 'GET') {
      return reply(res, 200, { playlists: Array.isArray(user.playlists) ? user.playlists : [] }), true
    }
    if (url.pathname === '/api/playlists' && req.method === 'POST') {
      const input = await body(req)
      const name = String(input.name || '').trim().slice(0, 60)
      const description = String(input.description || '').trim().slice(0, 200)
      if (!name) return reply(res, 400, { error: 'Название плейлиста обязательно' }), true
      const playlists = Array.isArray(user.playlists) ? user.playlists : []
      if (playlists.length >= 40) return reply(res, 400, { error: 'Достигнут лимит 40 плейлистов' }), true
      const tracks = sanitizePlaylistTrackList(input.tracks)
      const track = sanitizeTrack(input.track)
      if (track && !tracks.some(item => item.id === track.id)) tracks.unshift(track)
      const now = new Date().toISOString()
      const playlist = { id: randomUUID(), name, description, isPublic: Boolean(input.isPublic), cover: sanitizeCover(input.cover), tracks: tracks.slice(0, 200), createdAt: now, updatedAt: now }
      user.playlists = [playlist, ...playlists]
      await persist()
      return reply(res, 201, { user: publicUser(user), playlist }), true
    }
    if (url.pathname === '/api/playlists/discover' && req.method === 'GET') {
      const query = normalizePlaylistQuery(url.searchParams.get('q'))
      const data = await db()
      const found = []
      for (const owner of data.users) for (const playlist of Array.isArray(owner.playlists) ? owner.playlists : []) {
        if (!playlist.isPublic) continue
        if (query && !normalizePlaylistQuery(`${playlist.name} ${playlist.description} ${playlist.tracks.slice(0, 80).map(track => `${track.title} ${track.artist}`).join(' ')}`).includes(query)) continue
        found.push(playlistSummary(playlist, owner))
      }
      found.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      return reply(res, 200, { playlists: found.slice(0, 30) }), true
    }
    if (url.pathname.startsWith('/api/playlists/public/') && req.method === 'GET') {
      const id = url.pathname.slice('/api/playlists/public/'.length)
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(id)) return reply(res, 400, { error: 'Некорректный плейлист' }), true
      const data = await db()
      for (const owner of data.users) {
        const playlist = (Array.isArray(owner.playlists) ? owner.playlists : []).find(item => item.id === id)
        if (playlist && playlist.isPublic) return reply(res, 200, { playlist, owner: { name: owner.name, avatar: owner.avatar } }), true
      }
      return reply(res, 404, { error: 'Плейлист не найден' }), true
    }
    const playlistMatch = url.pathname.match(/^\/api\/playlists\/([a-zA-Z0-9-]{1,64})(?:\/(tracks|copy))?$/)
    if (playlistMatch && playlistMatch[2] === 'copy' && req.method === 'POST') {
      const data = await db()
      let sourceOwner = null
      let source = null
      for (const candidate of data.users) {
        const found = (Array.isArray(candidate.playlists) ? candidate.playlists : []).find(item => item.id === playlistMatch[1])
        if (found) { sourceOwner = candidate; source = found; break }
      }
      if (!source) return reply(res, 404, { error: 'Плейлист не найден' }), true
      if (!source.isPublic && sourceOwner.id !== user.id) return reply(res, 403, { error: 'Этот плейлист закрыт' }), true
      const playlists = Array.isArray(user.playlists) ? user.playlists : []
      if (playlists.length >= 40) return reply(res, 400, { error: 'Достигнут лимит 40 плейлистов' }), true
      const now = new Date().toISOString()
      const copy = { id: randomUUID(), name: `${source.name} · копия`.slice(0, 60), description: source.description, isPublic: false, cover: source.cover, tracks: source.tracks.slice(0, 200), createdAt: now, updatedAt: now }
      user.playlists = [copy, ...playlists]
      await persist()
      return reply(res, 201, { user: publicUser(user), playlist: copy }), true
    }
    if (playlistMatch) {
      const playlist = (Array.isArray(user.playlists) ? user.playlists : []).find(item => item.id === playlistMatch[1])
      const action = playlistMatch[2] || ''
      if (!playlist) return reply(res, 404, { error: 'Плейлист не найден' }), true
      if (action === 'tracks' && req.method === 'POST') {
        const input = await body(req)
        const track = sanitizeTrack(input.track)
        if (!track) return reply(res, 400, { error: 'Некорректный трек' }), true
        if (playlist.tracks.some(item => item.id === track.id)) return reply(res, 200, { user: publicUser(user), playlist, added: false }), true
        if (playlist.tracks.length >= 200) return reply(res, 400, { error: 'В плейлисте уже 200 треков' }), true
        if (input.position === 'start') playlist.tracks.unshift(track)
        else playlist.tracks.push(track)
        playlist.updatedAt = new Date().toISOString()
        await persist()
        return reply(res, 200, { user: publicUser(user), playlist, added: true }), true
      }
      if (action === 'tracks' && req.method === 'DELETE') {
        const trackId = url.searchParams.get('trackId') || ''
        const before = playlist.tracks.length
        playlist.tracks = playlist.tracks.filter(item => item.id !== trackId)
        if (playlist.tracks.length === before) return reply(res, 404, { error: 'Трек не найден в плейлисте' }), true
        playlist.updatedAt = new Date().toISOString()
        await persist()
        return reply(res, 200, { user: publicUser(user), playlist }), true
      }
      if (!action && req.method === 'PATCH') {
        const input = await body(req)
        if (input.name !== undefined) {
          const name = String(input.name || '').trim().slice(0, 60)
          if (!name) return reply(res, 400, { error: 'Название плейлиста обязательно' }), true
          playlist.name = name
        }
        if (input.description !== undefined) playlist.description = String(input.description || '').trim().slice(0, 200)
        if (input.isPublic !== undefined) playlist.isPublic = Boolean(input.isPublic)
        if (input.cover !== undefined) playlist.cover = sanitizeCover(input.cover)
        if (Array.isArray(input.order)) {
          const byId = new Map(playlist.tracks.map(item => [item.id, item]))
          const next = []
          for (const id of input.order) { const item = byId.get(String(id)); if (item && !next.includes(item)) next.push(item) }
          for (const item of playlist.tracks) if (!next.includes(item)) next.push(item)
          playlist.tracks = next
        }
        if (Array.isArray(input.tracks)) playlist.tracks = sanitizePlaylistTrackList(input.tracks)
        playlist.updatedAt = new Date().toISOString()
        await persist()
        return reply(res, 200, { user: publicUser(user), playlist }), true
      }
      if (!action && req.method === 'DELETE') {
        user.playlists = (Array.isArray(user.playlists) ? user.playlists : []).filter(item => item.id !== playlist.id)
        await persist()
        return reply(res, 200, { user: publicUser(user) }), true
      }
      return reply(res, 405, { error: 'Method not allowed' }), true
    }
    return reply(res, 405, { error: 'Method not allowed' }), true
  } catch (error) { return reply(res, 500, { error: error.message || 'Ошибка сервера' }), true }
}


