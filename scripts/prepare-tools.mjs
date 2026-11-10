import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const tools = join(root, 'tools')
await mkdir(tools, { recursive: true })

async function size(file) {
  try { return (await stat(file)).size } catch { return 0 }
}

async function ensureCopy(source, target, label) {
  if (!existsSync(source)) {
    console.warn(`[tools] ${label}: источник не найден — ${source}`)
    return
  }
  if (await size(target) > 1024 * 1024) {
    console.log(`[tools] ${label}: уже на месте`)
    return
  }
  await copyFile(source, target)
  console.log(`[tools] ${label}: скопирован (${Math.round((await size(target)) / 1048576)} МБ)`)
}

async function download(url, target, label) {
  if (await size(target) > 5 * 1024 * 1024) {
    console.log(`[tools] ${label}: уже скачан`)
    return
  }
  console.log(`[tools] ${label}: скачиваем…`)
  const response = await fetch(url, { headers: { 'user-agent': 'Kinetix desktop build' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`)
  await writeFile(target, Buffer.from(await response.arrayBuffer()))
  console.log(`[tools] ${label}: готов (${Math.round((await size(target)) / 1048576)} МБ)`)
}

const nodeExe = join(tools, 'node.exe')
const ytdlpExe = join(tools, 'yt-dlp.exe')
const ffmpegExe = join(tools, 'ffmpeg.exe')

await ensureCopy(process.execPath, nodeExe, 'node.exe')
await download('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe', ytdlpExe, 'yt-dlp.exe')

let ffmpegStatic = ''
try {
  const imported = await import('ffmpeg-static')
  ffmpegStatic = imported.default || ''
} catch {
  ffmpegStatic = ''
}
if (ffmpegStatic) await ensureCopy(ffmpegStatic, ffmpegExe, 'ffmpeg.exe')
else console.warn('[tools] ffmpeg-static не установлен — офлайн-кэш может работать без конвертации')

if (existsSync(ytdlpExe)) {
  await new Promise(done => {
    const child = spawn(ytdlpExe, ['--version'], { windowsHide: true })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.on('error', () => { console.warn('[tools] yt-dlp.exe не запускается'); done() })
    child.on('close', code => {
      console.log(code === 0 ? `[tools] yt-dlp работает: ${output.trim()}` : `[tools] yt-dlp завершился с кодом ${code}`)
      done()
    })
  })
}

console.log(`[tools] папка: ${tools}`)
