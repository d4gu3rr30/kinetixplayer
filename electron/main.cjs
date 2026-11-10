const { app, BrowserWindow, Menu, Tray, dialog, shell, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const http = require('node:http')
const net = require('node:net')

const appId = 'app.kinetix.player'
app.setAppUserModelId(appId)
app.setName('Kinetix')
app.setPath('userData', join(app.getPath('appData'), 'Kinetix'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const appRoot = app.getAppPath()
const userData = app.getPath('userData')
const toolsDir = app.isPackaged ? join(process.resourcesPath, 'tools') : join(appRoot, 'tools')
const iconPath = join(appRoot, 'build', 'icon.png')
const logPath = join(userData, 'server.log')
const dataFile = join(userData, 'data', 'users.json')

mkdirSync(userData, { recursive: true })
const log = createWriteStream(logPath, { flags: 'a' })

let server = null
let serverUrl = ''
let mainWindow = null
let tray = null
let trayHintShown = false
let quitting = false

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(start).catch(error => {
    log.write(`[boot] ${error.message}\n`)
    dialog.showErrorBox('Kinetix не запустился', `${error.message}\n\nПодробности: ${logPath}`)
    app.quit()
  })
}

function portBusy(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    let settled = false
    const done = busy => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(busy)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(450, () => done(false))
  })
}

function portBindable(port) {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

async function freePort(start = 8788) {
  for (let port = start; port <= start + 40; port += 1) {
    if (await portBusy(port)) continue
    if (await portBindable(port)) return port
  }
  throw new Error('Не удалось найти свободный порт для встроенного сервера')
}

async function pickPort() {
  const portFile = join(userData, 'port.json')
  // 8787 обычно занимает `npm run dev`, поэтому у настольного приложения свой адрес.
  let preferred = 8788
  try {
    const saved = Number(JSON.parse(readFileSync(portFile, 'utf8')).port)
    if (Number.isInteger(saved) && saved > 1024 && saved < 65536) preferred = saved
  } catch { /* first launch */ }
  let port = preferred
  if (await portBusy(port) || !(await portBindable(port))) port = await freePort()
  try { writeFileSync(portFile, JSON.stringify({ port })) } catch { /* read-only profile */ }
  return port
}

function waitForServer(url, timeout = 45000) {
  const deadline = Date.now() + timeout
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, response => {
        response.resume()
        if (response.statusCode && response.statusCode < 500) resolve()
        else retry()
      })
      request.on('error', retry)
      request.setTimeout(1200, () => request.destroy())
    }
    const retry = () => {
      if (quitting) return
      if (Date.now() > deadline) reject(new Error('Сервер не ответил вовремя'))
      else setTimeout(check, 180)
    }
    check()
  })
}

async function start() {
  Menu.setApplicationMenu(null)
  const port = await pickPort()
  serverUrl = `http://127.0.0.1:${port}`
  const serverCwd = appRoot
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    KINETIX_DESKTOP: '1',
    PORT: String(port),
    KINETIX_HOST: '127.0.0.1',
    KINETIX_DATA_FILE: dataFile,
    KINETIX_OFFLINE_DIR: join(userData, 'offline'),
    KINETIX_ENV_FILE: join(userData, '.env'),
    KINETIX_YOUTUBE_AUTH: join(userData, 'youtube-auth.json'),
    PATH: `${toolsDir};${process.env.PATH || ''}`,
  }
  const ytdlpPath = join(toolsDir, 'yt-dlp.exe')
  const nodePath = join(toolsDir, 'node.exe')
  if (existsSync(ytdlpPath)) env.YTDLP_PATH = ytdlpPath
  if (existsSync(nodePath)) env.YTDLP_JS_RUNTIME = `node:${nodePath}`

  server = spawn(process.execPath, [join(appRoot, 'server', 'index.mjs')], {
    cwd: serverCwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', chunk => log.write(chunk))
  server.stderr.on('data', chunk => log.write(chunk))
  server.on('error', error => log.write(`[spawn] ${error.message}\n`))
  server.on('exit', code => {
    log.write(`[exit] server stopped with code ${code}\n`)
    if (!quitting && !mainWindow) {
      dialog.showErrorBox('Kinetix не запустился', `Встроенный сервер завершился с кодом ${code}.\n\nПодробности: ${logPath}`)
      app.quit()
    }
  })

  try {
    await waitForServer(serverUrl)
  } catch (error) {
    log.write(`[boot] ${error.message}\n`)
    dialog.showErrorBox('Kinetix не запустился', `Не удалось поднять встроенный сервер.\n\n${error.message}\n\nПодробности: ${logPath}`)
    app.quit()
    return
  }

  createWindow()
  createTray()
}

function showWindow() {
  if (!mainWindow) {
    if (serverUrl) createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  if (tray) return
  const trayIcon = [
    join(appRoot, 'build', 'icon.ico'),
    join(appRoot, 'build', 'icon.png'),
    join(process.resourcesPath, 'icon.ico'),
  ].find(candidate => existsSync(candidate))
  if (!trayIcon) return
  tray = new Tray(trayIcon)
  tray.setToolTip('Kinetix — музыка в твоём ритме')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Kinetix', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit() } },
  ]))
  tray.on('click', () => showWindow())
  tray.on('double-click', () => showWindow())
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#101115',
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: 'Kinetix',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      preload: join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.loadURL(serverUrl)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('close', event => {
    if (quitting) return
    event.preventDefault()
    mainWindow.hide()
    if (!trayHintShown && tray) {
      trayHintShown = true
      try {
        tray.displayBalloon({
          iconType: 'info',
          title: 'Kinetix свёрнут в трей',
          content: 'Плеер продолжает играть. Кликните по значку, чтобы вернуться, или выберите «Выход» в его меню.',
        })
      } catch { /* balloon не поддерживается */ }
    }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(serverUrl)) return
    event.preventDefault()
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })

  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12' && input.type === 'keyDown') mainWindow.webContents.toggleDevTools()
      if (input.key === 'F5' && input.type === 'keyDown') mainWindow.reload()
    })
  }
}

function windowActionAllowed(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents)
}

ipcMain.on('window:minimize', event => {
  if (windowActionAllowed(event)) mainWindow.minimize()
})
ipcMain.on('window:toggle-maximize', event => {
  if (!windowActionAllowed(event)) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window:close', event => {
  if (windowActionAllowed(event)) mainWindow.close()
})
ipcMain.handle('window:is-maximized', event => windowActionAllowed(event) ? mainWindow.isMaximized() : false)

function autoLaunchState() {
  if (!app.isPackaged) return { supported: false, enabled: false }
  return { supported: true, enabled: app.getLoginItemSettings({ path: process.execPath }).openAtLogin }
}
ipcMain.handle('app:get-auto-launch', event => windowActionAllowed(event) ? autoLaunchState() : { supported: false, enabled: false })
ipcMain.handle('app:set-auto-launch', (event, enabled) => {
  if (!windowActionAllowed(event) || !app.isPackaged) return { supported: false, enabled: false }
  app.setLoginItemSettings({ path: process.execPath, openAtLogin: Boolean(enabled) })
  return autoLaunchState()
})

function stopServer() {
  if (!server || !server.pid) return
  const pid = server.pid
  server = null
  try {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
  } catch {
    try { process.kill(pid) } catch {}
  }
}

app.on('before-quit', () => { quitting = true; stopServer() })
app.on('window-all-closed', () => {
  if (tray) return
  quitting = true
  stopServer()
  app.quit()
})
