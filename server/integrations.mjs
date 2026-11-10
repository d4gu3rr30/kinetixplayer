import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { resetVkToken } from './vk.mjs'
import { resetYandex } from './yandex.mjs'

const KEYS = { vk: 'VK_ACCESS_TOKEN', yandex: 'YANDEX_MUSIC_TOKEN', google: 'GOOGLE_CLIENT_ID', googleSecret: 'GOOGLE_CLIENT_SECRET' }
const LIMITS = { vk: [20, 900], yandex: [20, 2048], google: [20, 200], googleSecret: [10, 200] }
const LABELS = { vk: 'ВКонтакте', yandex: 'Яндекс Музыки', google: 'Google Client ID', googleSecret: 'Google Client Secret' }

function envFile() { return resolve(process.env.KINETIX_ENV_FILE || '.env') }
function current(key) { return String(process.env[key] || '').trim() }

export function integrationsStatus() {
  const vk = current(KEYS.vk)
  const yandex = current(KEYS.yandex)
  const google = current(KEYS.google)
  const googleSecret = current(KEYS.googleSecret)
  return {
    vk: { set: Boolean(vk), length: vk.length },
    yandex: { set: Boolean(yandex), length: yandex.length },
    google: { set: Boolean(google), length: google.length },
    googleSecret: { set: Boolean(googleSecret), length: googleSecret.length },
  }
}

function clean(name, raw) {
  let value = String(raw ?? '').trim().replace(/^OAuth\s+/i, '').replace(/^["']|["']$/g, '')
  if (!value) return ''
  const [min, max] = LIMITS[name]
  if (value.length < min || value.length > max) throw new Error(`${LABELS[name]} выглядит некорректно — проверьте, что скопировали значение целиком`)
  if (!/^[\x21-\x7e]+$/.test(value)) throw new Error(`${LABELS[name]} должен состоять из латинских букв, цифр и символов без пробелов`)
  if (name === 'google' && !value.endsWith('.apps.googleusercontent.com')) throw new Error('Client ID должен заканчиваться на .apps.googleusercontent.com')
  return value
}

function linePattern(key) { return new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`) }

export async function saveIntegrations(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Некорректный запрос')
  const updates = {}
  for (const name of Object.keys(KEYS)) {
    if (Object.hasOwn(input, name)) updates[name] = clean(name, input[name])
  }
  if (!Object.keys(updates).length) throw new Error('Нечего сохранять')

  const path = envFile()
  let original = ''
  try { original = await readFile(path, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw new Error('Не удалось прочитать .env') }
  let lines = original ? original.replace(/\n$/, '').split(/\r?\n/) : []

  for (const [name, value] of Object.entries(updates)) {
    const key = KEYS[name]
    const pattern = linePattern(key)
    if (!value) {
      lines = lines.filter(line => !pattern.test(line))
      continue
    }
    const line = `${key}=${value}`
    const index = lines.findIndex(item => pattern.test(item))
    if (index >= 0) lines[index] = line
    else lines.push(line)
  }

  const body = lines.join('\n') + (lines.length ? '\n' : '')
  const temp = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temp, body, { mode: 0o600 })
    await rename(temp, path)
  } catch (error) {
    try { await unlink(temp) } catch {}
    throw new Error(`Не удалось записать .env: ${error.message}`)
  }

  for (const [name, value] of Object.entries(updates)) {
    if (value) process.env[KEYS[name]] = value
    else delete process.env[KEYS[name]]
    if (name === 'vk') resetVkToken()
    if (name === 'yandex') resetYandex()
  }

  const status = integrationsStatus()
  return { ...status, saved: Object.keys(updates) }
}
