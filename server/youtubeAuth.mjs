import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { ytdlp } from './ytdlp.mjs'

const configPath = resolve(process.env.KINETIX_YOUTUBE_AUTH || '.data/youtube-auth.json')
const cookiesPath = resolve(dirname(configPath), 'youtube-cookies.txt')
const browsers = new Set(['chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium', 'safari'])
const probeVideo = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
let state = { mode: 'off', browser: 'chrome', updatedAt: 0 }

async function persist() {
  await mkdir(dirname(configPath), { recursive: true })
  const temp = `${configPath}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify(state), { mode: 0o600 })
  await rename(temp, configPath)
}

export function applyEnv() {
  if (state.mode === 'file') {
    process.env.YTDLP_COOKIES = cookiesPath
    delete process.env.YTDLP_COOKIES_FROM_BROWSER
  } else if (state.mode === 'browser') {
    process.env.YTDLP_COOKIES_FROM_BROWSER = state.browser
    delete process.env.YTDLP_COOKIES
  } else {
    delete process.env.YTDLP_COOKIES
    delete process.env.YTDLP_COOKIES_FROM_BROWSER
  }
}

try {
  const stored = JSON.parse(await readFile(configPath, 'utf8'))
  if (stored && ['off', 'browser', 'file'].includes(stored.mode)) state = { mode: stored.mode, browser: browsers.has(stored.browser) ? stored.browser : 'chrome', updatedAt: Number(stored.updatedAt) || 0 }
} catch { /* First run: no saved YouTube credentials yet. */ }
applyEnv()

export async function youtubeAuthStatus() {
  let cookieCount = 0
  if (state.mode === 'file') {
    try { cookieCount = (await readFile(cookiesPath, 'utf8')).split(/\r?\n/).filter(line => line && !line.startsWith('#') && /youtube\.com/.test(line)).length } catch { cookieCount = 0 }
  }
  let ready = false
  try { await ytdlp(); ready = true } catch { ready = false }
  return { mode: state.mode, browser: state.browser, cookieCount, updatedAt: state.updatedAt, ytDlp: ready, usingEnv: Boolean(process.env.YTDLP_COOKIES || process.env.YTDLP_COOKIES_FROM_BROWSER) && !state.updatedAt }
}

function normalizeCookies(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('Вставьте содержимое cookies.txt')
  if (raw.startsWith('[') || raw.startsWith('{')) {
    let data
    try { data = JSON.parse(raw) } catch { throw new Error('Не удалось прочитать JSON с cookies') }
    const list = Array.isArray(data) ? data : Array.isArray(data.cookies) ? data.cookies : []
    if (!list.length) throw new Error('В JSON не найдено cookies')
    const lines = ['# Netscape HTTP Cookie File']
    for (const item of list) {
      const domain = String(item.domain || '').trim()
      if (!domain) continue
      const include = domain.startsWith('.') ? 'TRUE' : 'FALSE'
      const expires = Math.round(Number(item.expirationDate || item.expires || 0)) || 0
      lines.push([domain, include, String(item.path || '/'), item.secure ? 'TRUE' : 'FALSE', expires, String(item.name || ''), String(item.value || '')].join('\t'))
    }
    if (lines.length < 2) throw new Error('В JSON не найдено cookies')
    return { text: `${lines.join('\n')}\n`, count: lines.length - 1 }
  }
  if (!raw.startsWith('# Netscape') && !/\tyoutube\.com|\t\.youtube\.com/.test(raw)) throw new Error('Это не похоже на cookies.txt из браузера')
  const count = raw.split(/\r?\n/).filter(line => line && !line.startsWith('#') && /youtube\.com/.test(line)).length
  if (!count) throw new Error('В файле нет cookies YouTube')
  return { text: raw, count }
}

export async function setYouTubeAuth(input = {}) {
  const mode = ['off', 'browser', 'file'].includes(input.mode) ? input.mode : 'off'
  const browser = browsers.has(String(input.browser)) ? String(input.browser) : 'chrome'
  if (mode === 'off') {
    state = { mode: 'off', browser, updatedAt: Date.now() }
    await persist()
    applyEnv()
    return youtubeAuthStatus()
  }
  if (mode === 'browser') {
    state = { mode: 'browser', browser, updatedAt: Date.now() }
    await persist()
    applyEnv()
    return youtubeAuthStatus()
  }
  const { text } = normalizeCookies(input.cookies)
  await mkdir(dirname(cookiesPath), { recursive: true })
  await writeFile(cookiesPath, text, { mode: 0o600 })
  state = { mode: 'file', browser, updatedAt: Date.now() }
  await persist()
  applyEnv()
  return youtubeAuthStatus()
}

export async function clearYouTubeAuth() {
  state = { mode: 'off', browser: state.browser, updatedAt: Date.now() }
  await persist()
  applyEnv()
  await unlink(cookiesPath).catch(() => {})
  return youtubeAuthStatus()
}

export async function testYouTubeAuth() {
  const bin = await ytdlp()
  const args = [...bin.prefix, '--simulate', '--no-warnings', '--socket-timeout', '15', '--dump-single-json', probeVideo]
  if (state.mode === 'file') args.push('--cookies', cookiesPath)
  else if (state.mode === 'browser') args.push('--cookies-from-browser', state.browser)
  return new Promise(resolve => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result) }
    const child = spawn(bin.command, args, { windowsHide: true })
    const timer = setTimeout(() => { try { child.kill() } catch {} ; done({ ok: false, error: 'YouTube не ответил за 45 секунд' }) }, 45_000)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { if (stderr.length < 4000) stderr += chunk })
    child.on('error', error => done({ ok: false, error: error.message }))
    child.on('close', code => {
      if (code === 0 && stdout.trim()) {
        try {
          const data = JSON.parse(stdout.split(/\r?\n/).find(line => line.startsWith('{')) || stdout)
          return done({ ok: true, title: String(data.title || '').slice(0, 120), duration: Math.round(Number(data.duration) || 0) })
        } catch { return done({ ok: true }) }
      }
      const line = stderr.split(/\r?\n/).filter(entry => /error/i.test(entry)).at(-1) || ''
      const message = line.replace(/^ERROR:\s*/i, '').trim().slice(0, 300) || `yt-dlp завершился с кодом ${code}`
      done({ ok: false, error: message })
    })
  })
}
