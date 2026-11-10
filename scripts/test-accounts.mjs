import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const dir = await mkdtemp(join(tmpdir(), 'kinetix-test-'))
const port = 8799
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), KINETIX_DATA_FILE: join(dir, 'users.json') }, stdio: 'ignore' })
const base = `http://127.0.0.1:${port}`
let cookie = ''
async function call(path, method = 'GET', data) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  return { status: response.status, data: await response.json() }
}

try {
  for (let i = 0; i < 40; i++) { try { await fetch(`${base}/api/config`); break } catch { await new Promise(resolve => setTimeout(resolve, 100)) } }
  let result = await call('/api/auth/register', 'POST', { name: 'Тестовый слушатель', email: 'test@example.com', password: 'very-strong-password', artists: ['the-weeknd'] })
  assert.equal(result.status, 200)
  assert.equal(result.data.user.artists[0], 'the-weeknd')
  assert.equal(result.data.user.passwordHash, undefined)
  result = await call('/api/me')
  assert.equal(result.data.user.name, 'Тестовый слушатель')
  result = await call('/api/me', 'PATCH', { name: 'Новое имя', status: 'Слушаю музыку' })
  assert.equal(result.data.user.status, 'Слушаю музыку')
  result = await call('/api/me', 'PATCH', { artists: [] })
  assert.deepEqual(result.data.user.artists, [])
  result = await call('/api/me', 'PATCH', { artists: ['wiki-12345', 'the-weeknd'] })
  assert.deepEqual(result.data.user.artists, ['wiki-12345', 'the-weeknd'])
  result = await call('/api/moments', 'POST', { lines: [{ at: 12, text: 'Важная строка' }, { at: 15, text: 'Ещё одна' }], track: { id: 'sc:123', title: 'Песня', artist: 'Артист', artwork: 'https://example.com/art.jpg' } })
  assert.equal(result.status, 201)
  assert.equal(result.data.user.moments.length, 1)
  const momentId = result.data.moment.id
  result = await call(`/api/moments/${momentId}`, 'DELETE')
  assert.equal(result.data.user.moments.length, 0)
  result = await call('/api/auth/logout', 'POST')
  assert.equal(result.status, 200)
  result = await call('/api/me')
  assert.equal(result.data.user, null)
  result = await call('/api/auth/login', 'POST', { email: 'test@example.com', password: 'wrong-password' })
  assert.equal(result.status, 401)
  result = await call('/api/auth/login', 'POST', { email: 'test@example.com', password: 'very-strong-password' })
  assert.equal(result.status, 200)
  assert.equal(result.data.user.name, 'Новое имя')
  console.log('Account API: registration, skipped artists, dynamic artists, profile, moments, logout and login passed')
} finally {
  server.kill()
  await rm(dir, { recursive: true, force: true })
}
