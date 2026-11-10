import React, { useEffect, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, AudioLines, Check, CircleAlert, Download, ExternalLink, Eye, EyeOff, KeyRound, Loader2, MonitorSmartphone, Power, Rocket, ShieldCheck, Sparkles, SlidersHorizontal, Timer, MonitorPlay, ListOrdered, Trash2, Upload, Wand2, FileText, ThumbsDown, Undo2 } from 'lucide-react'
import type { Track } from './types'
import type { User } from './account'
import { isAndroid, isIOS } from './platform'
import { saveAndroidFile } from './android'
import { exportListenStats, flushListenStats, formatListenTime, importListenStats, stashPendingListenStats } from './listening'

export type Settings = { smoothUi: boolean; crossfade: number; autoplaySimilar: boolean; visualizer: boolean; rememberQueue: boolean; performanceMode: boolean; coverBackground: boolean }
export const DEFAULT_SETTINGS: Settings = { smoothUi: true, crossfade: 4, autoplaySimilar: true, visualizer: true, rememberQueue: true, performanceMode: false, coverBackground: true }
export const SETTINGS_KEY = 'kinetix:settings:v1'
export function loadSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch { return DEFAULT_SETTINGS }
}

const TRANSFER_KEYS = ['kinetix:favorites:v1', 'kinetix:media-library:v1', 'kinetix:history:v1', 'kinetix:dislikes:v1', 'kinetix:recommend-seeds:v1', 'kinetix:search-recent:v1']
const isTransferKey = (key: string) => TRANSFER_KEYS.includes(key) || key.startsWith('kinetix:listen:v1:')
const isListenKey = (key: string) => key.startsWith('kinetix:listen:v1:')
function transferSnapshot() {
  const local: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    // Stats move inside `listening`: the per-user key would point at the old account id.
    if (!key || !isTransferKey(key) || isListenKey(key)) continue
    local[key] = localStorage.getItem(key) || ''
  }
  return local
}
function localCounts() {
  const read = (key: string) => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.length : 0 } catch { return 0 } }
  return { favorites: read('kinetix:favorites:v1'), library: read('kinetix:media-library:v1') }
}
type TransferFile = { format?: string; version?: number; account?: unknown; local?: Record<string, unknown>; listening?: unknown }

type YouTubeStatus = { mode: 'off' | 'browser' | 'file'; browser: string; cookieCount: number; updatedAt: number; ytDlp: boolean; usingEnv: boolean }
const browsers = [
  { id: 'chrome', label: 'Chrome' },
  { id: 'edge', label: 'Edge' },
  { id: 'firefox', label: 'Firefox' },
  { id: 'brave', label: 'Brave' },
  { id: 'opera', label: 'Opera' },
  { id: 'vivaldi', label: 'Vivaldi' },
  { id: 'chromium', label: 'Chromium' },
  { id: 'safari', label: 'Safari' },
]

function Toggle({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return <label className="set-toggle">
    <span><b>{label}</b><small>{hint}</small></span>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} aria-label={label}/>
  </label>
}

const tokenSources = [
  { id: 'vk' as const, name: 'ВКонтакте', hint: 'Поиск и воспроизведение треков ВК. Нужен токен Standalone-приложения с доступом к аудио.', url: 'https://dev.vk.com/ru/api/access-token/getting-started', placeholder: 'vk1.a.…' },
  { id: 'yandex' as const, name: 'Яндекс Музыка', hint: 'Полные версии треков, тексты песен и поиск по каталогу Яндекса.', url: 'https://yandex-music.readthedocs.io/en/main/token.html', placeholder: 'Токен Яндекс Музыки' },
]

type TokenStatus = { set: boolean; length: number }
type Integrations = { vk: TokenStatus; yandex: TokenStatus; google: TokenStatus; googleSecret: TokenStatus }

export function SettingsView({ settings, onChange, onBack, onNotice, onConfigChange, dislikes, onRestoreDislike, onClearDislikes, user }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; onBack: () => void; onNotice: (message: string) => void; onConfigChange: () => void; dislikes: Track[]; onRestoreDislike: (track: Track) => void; onClearDislikes: () => void; user: User | null }) {
  const [status, setStatus] = useState<YouTubeStatus | null>(null)
  const [mode, setMode] = useState<'off' | 'browser' | 'file'>('off')
  const [browser, setBrowser] = useState('chrome')
  const [cookies, setCookies] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<{ ok: boolean; title?: string; error?: string } | null>(null)
  const [tokens, setTokens] = useState<Integrations | null>(null)
  const [tokenDraft, setTokenDraft] = useState({ vk: '', yandex: '' })
  const [tokenSaving, setTokenSaving] = useState<'' | 'vk' | 'yandex'>('')
  const [tokenReveal, setTokenReveal] = useState({ vk: false, yandex: false })
  const [googleDraft, setGoogleDraft] = useState({ id: '', secret: '' })
  const [googleSecretShown, setGoogleSecretShown] = useState(false)
  const [savingGoogle, setSavingGoogle] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [transferError, setTransferError] = useState('')
  const desktopBridge = window.kinetixApp
  const onDevice = isAndroid
  const desktopCookies = !isAndroid
  const [autoLaunch, setAutoLaunch] = useState<{ supported: boolean; enabled: boolean } | null>(null)
  const [autoLaunchBusy, setAutoLaunchBusy] = useState(false)
  const counts = localCounts()

  useEffect(() => {
    if (!desktopBridge) return
    let alive = true
    desktopBridge.autoLaunch().then(value => { if (alive) setAutoLaunch(value) }).catch(() => { if (alive) setAutoLaunch({ supported: false, enabled: false }) })
    return () => { alive = false }
  }, [desktopBridge])

  async function changeAutoLaunch(enabled: boolean) {
    if (!desktopBridge || autoLaunchBusy) return
    setAutoLaunchBusy(true)
    try {
      const next = await desktopBridge.setAutoLaunch(enabled)
      setAutoLaunch(next)
      onNotice(next.enabled ? 'Kinetix будет запускаться вместе с Windows' : 'Автозагрузка отключена')
    } catch { onNotice('Не удалось изменить автозагрузку') }
    finally { setAutoLaunchBusy(false) }
  }

  function adoptTokens(data: Integrations) { setTokens({ vk: data.vk, yandex: data.yandex, google: data.google, googleSecret: data.googleSecret }) }
  useEffect(() => {
    fetch('/api/integrations').then(r => r.json()).then(data => { if (data && !data.error) adoptTokens(data) }).catch(() => {})
  }, [])

  async function saveToken(name: 'vk' | 'yandex') {
    const value = tokenDraft[name].trim()
    if (!value) { onNotice('Вставьте токен в поле'); return }
    setTokenSaving(name)
    try {
      const response = await fetch('/api/integrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [name]: value }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить токен')
      adoptTokens(data)
      setTokenDraft(prev => ({ ...prev, [name]: '' }))
      onNotice(`${name === 'vk' ? 'Токен ВКонтакте сохранён' : 'Токен Яндекс Музыки сохранён'} ${onDevice ? 'на этом устройстве' : 'в .env'}`)
      onConfigChange()
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось сохранить токен') }
    finally { setTokenSaving('') }
  }
  async function removeToken(name: 'vk' | 'yandex') {
    setTokenSaving(name)
    try {
      const response = await fetch('/api/integrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [name]: '' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить токен')
      adoptTokens(data)
      onNotice(name === 'vk' ? 'Токен ВКонтакте удалён' : 'Токен Яндекс Музыки удалён')
      onConfigChange()
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось удалить токен') }
    finally { setTokenSaving('') }
  }

  async function saveGoogle() {
    const payload: Record<string, string> = {}
    if (googleDraft.id.trim()) payload.google = googleDraft.id.trim()
    if (googleDraft.secret.trim()) payload.googleSecret = googleDraft.secret.trim()
    if (!Object.keys(payload).length) { onNotice('Заполните Client ID'); return }
    setSavingGoogle(true)
    try {
      const response = await fetch('/api/integrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить настройки Google')
      adoptTokens(data)
      setGoogleDraft({ id: '', secret: '' })
      onNotice('Настройки Google сохранены')
      onConfigChange()
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось сохранить настройки Google') }
    finally { setSavingGoogle(false) }
  }
  async function removeGoogle() {
    setSavingGoogle(true)
    try {
      const response = await fetch('/api/integrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ google: '', googleSecret: '' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось удалить настройки Google')
      adoptTokens(data)
      onNotice('Вход через Google отключён')
      onConfigChange()
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось удалить настройки Google') }
    finally { setSavingGoogle(false) }
  }

  function downloadTransfer() {
    flushListenStats()
    const payload = {
      format: 'kinetix-transfer',
      version: 1,
      exportedAt: new Date().toISOString(),
      account: user ? { name: user.name, status: user.status, statusTrack: user.statusTrack || null, avatar: user.avatar, artists: user.artists, moments: user.moments, playlists: user.playlists } : null,
      listening: user ? exportListenStats(user.id) : null,
      local: transferSnapshot(),
    }
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    const name = `kinetix-transfer-${new Date().toISOString().slice(0, 10)}.json`
    if (isAndroid) {
      const savedText = isIOS ? 'Файл готов — выбери, куда сохранить' : 'Файл сохранён в Загрузки'
      void saveAndroidFile(name, 'application/json', blob).then(saved => onNotice(saved ? savedText : 'Не удалось сохранить файл'))
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    onNotice(user ? 'Файл с аккаунтом и коллекциями скачан' : 'Коллекции скачаны — войдите в аккаунт, чтобы включить в файл плейлисты и Моменты')
  }

  async function importTransfer(file: File) {
    setTransferBusy(true)
    setTransferError('')
    try {
      const data = JSON.parse(await file.text()) as TransferFile
      if (data.format !== 'kinetix-transfer' || data.version !== 1) throw new Error('Это не файл переноса Kinetix')
      const accountSkipped = Boolean(data.account && !user)
      if (data.account && user) {
        const response = await fetch('/api/me/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: data.account }) })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(result.error || 'Не удалось импортировать аккаунт')
      }
      let restored = 0
      let listenSeconds = 0
      const statsSources: unknown[] = []
      if (data.local && typeof data.local === 'object') for (const [key, value] of Object.entries(data.local)) {
        if (!isTransferKey(key) || typeof value !== 'string') continue
        if (isListenKey(key)) {
          // Older files keep stats under the previous account id: unwrap them here.
          try { statsSources.push(JSON.parse(value)) } catch { /* Broken stats are skipped instead of blocking the import. */ }
          continue
        }
        localStorage.setItem(key, value)
        restored++
      }
      if (data.listening) statsSources.unshift(data.listening)
      for (const stats of statsSources) listenSeconds += user ? importListenStats(user.id, stats) : stashPendingListenStats(stats)
      if (!data.account && !restored && !listenSeconds) throw new Error('В файле нет данных Kinetix')
      const statsNote = listenSeconds > 0 ? ` Статистика прослушивания: +${formatListenTime(listenSeconds)}${user ? '' : ' — добавится после входа в аккаунт'}.` : ''
      const accountNote = accountSkipped ? 'Коллекции импортированы. Войдите в аккаунт и повторите импорт для профиля и плейлистов.' : 'Данные импортированы. Перезагружаем плеер…'
      onNotice(accountNote + statsNote)
      setTimeout(() => window.location.reload(), 1500)
    } catch (cause) {
      setTransferError(cause instanceof Error ? cause.message : 'Не удалось импортировать данные')
    } finally {
      setTransferBusy(false)
    }
  }

  function adopt(next: YouTubeStatus) {
    setStatus(next)
    setMode(next.mode)
    setBrowser(next.browser || 'chrome')
  }
  useEffect(() => {
    fetch('/api/youtube-auth').then(r => r.json()).then(data => { if (data && !data.error) adopt(data) }).catch(() => {})
  }, [])

  async function saveAuth(payload: { mode: string; browser?: string; cookies?: string }) {
    setSaving(true); setTest(null)
    try {
      const response = await fetch('/api/youtube-auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось сохранить')
      adopt(data)
      onNotice(payload.mode === 'file' ? (onDevice ? 'Cookies сохранены на этом устройстве' : 'Cookies сохранены на этом компьютере') : payload.mode === 'browser' ? 'YouTube будет читать cookies из браузера' : 'Вход в YouTube отключён')
      if (payload.mode === 'file') setCookies('')
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось сохранить настройки YouTube') }
    finally { setSaving(false) }
  }
  async function disconnect() {
    setSaving(true); setTest(null)
    try {
      const response = await fetch('/api/youtube-auth', { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось отключить')
      adopt(data); onNotice('Вход в YouTube отключён')
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Не удалось отключить') }
    finally { setSaving(false) }
  }
  async function runTest() {
    setTesting(true); setTest(null)
    try {
      const response = await fetch('/api/youtube-auth/test', { method: 'POST' })
      const data = await response.json()
      if (!response.ok && !data.error) throw new Error('Проверка не удалась')
      setTest(data)
    } catch (error) { setTest({ ok: false, error: error instanceof Error ? error.message : 'Проверка не удалась' }) }
    finally { setTesting(false) }
  }

  const connected = status && status.mode !== 'off'
  const statusLabel = !status ? 'Проверяем…' : status.mode === 'off' ? 'Не подключено' : status.mode === 'browser' ? `Cookies из ${browsers.find(item => item.id === status.browser)?.label || status.browser}` : `cookies.txt · ${status.cookieCount} шт.`

  return <div className="settings-page">
    <div className="settings-hero">
      <button className="settings-back" onClick={onBack}><ArrowLeft size={16}/> Назад</button>
      <div className="settings-hero-grid">
        <div>
          <span className="settings-kicker"><Sparkles size={12}/> ЦЕНТР УПРАВЛЕНИЯ</span>
          <h1>Настройки<span className="settings-dot">.</span></h1>
          <p>{isAndroid ? 'Звук, источники и твой профиль — всё на устройстве.' : 'Звук, движение и вход в YouTube — всё в одном месте.'}</p>
        </div>
        <div className="settings-orbit" aria-hidden="true"><SlidersHorizontal size={54}/></div>
      </div>
    </div>

    <div className="settings-grid">
      <section className="set-card">
        <header><span className="set-icon"><AudioLines size={18}/></span><div><strong>Звук</strong><small>Как звучит переход между треками</small></div></header>
        <div className="set-crossfade">
          <div className="set-crossfade-head"><span><b>Плавный переход</b><small>{settings.crossfade ? `Плавное затухание ${settings.crossfade} с в конце трека` : 'Переход без затухания'}</small></span><b className="set-value">{settings.crossfade} с</b></div>
          <input type="range" min="0" max="10" step="1" value={settings.crossfade} onChange={event => onChange({ crossfade: Number(event.target.value) })} style={{ '--fill': `${settings.crossfade * 10}%` } as React.CSSProperties} aria-label="Длительность плавного перехода"/>
          <div className="set-scale"><span>Выкл</span><span>5 с</span><span>10 с</span></div>
        </div>
        <Toggle checked={settings.autoplaySimilar} onChange={value => onChange({ autoplaySimilar: value })} label="Бесшовная волна" hint="Очередь похожих из всех источников без остановки — недоступные пропускаются"/>
        <Toggle checked={settings.visualizer} onChange={value => onChange({ visualizer: value })} label="Визуализатор" hint="Живой эквалайзер у мини-плеера"/>
      </section>

      <section className="set-card">
        <header><span className="set-icon"><Wand2 size={18}/></span><div><strong>Интерфейс и сессия</strong><small>Мелочи, которые делают плеер твоим</small></div></header>
        <Toggle checked={settings.smoothUi} onChange={value => onChange({ smoothUi: value })} label="Плавные анимации" hint="Мягкие переходы, появления и hover-эффекты"/>
        <Toggle checked={settings.coverBackground} onChange={value => onChange({ coverBackground: value })} label="Фон от обложки" hint="Размытая обложка трека и цветовые акценты подстраиваются под каждый трек. Выключи, если хочешь спокойный тёмный фон"/>
        <Toggle checked={settings.performanceMode} onChange={value => onChange({ performanceMode: value })} label="Режим слабых устройств" hint="Убирает тяжёлую размытую подложку, backdrop-blur и фоновые эффекты — плеер и прокрутка остаются плавными даже на старых телефонах. Раскладка и управление не меняются"/>
        <Toggle checked={settings.rememberQueue} onChange={value => onChange({ rememberQueue: value })} label="Помнить очередь" hint="Возвращаться к очереди, истории и треку после перезапуска"/>
        <div className="set-note"><ListOrdered size={15}/><span>Очередь и историю можно открыть кнопкой <b>≡</b> в плеере.</span></div>
        <div className="set-note"><Timer size={15}/><span>Плавный переход работает для треков, которые играет сам плеер. Внешние окна SoundCloud управляются отдельно.</span></div>
      </section>

      <section className="set-card youtube-card">
        <header><span className="set-icon youtube"><MonitorPlay size={20}/></span><div><strong>Вход в YouTube</strong><small>Для возрастных и «не для ботов» видео</small></div><span className={`set-status ${connected ? 'on' : ''}`}>{connected ? <Check size={12}/> : <CircleAlert size={12}/>} {statusLabel}</span></header>
        <p className="youtube-lead">{onDevice ? 'YouTube иногда просит войти в аккаунт и пропускает трек. Вставь cookies из браузера — тогда возрастные и закрытые видео играют как обычные. Cookies остаются только на этом устройстве.' : 'YouTube иногда просит войти в аккаунт и пропускает трек. Плеер может взять cookies из твоего браузера — тогда возрастные и закрытые видео играют как обычные. Cookies остаются только на этом компьютере.'}</p>
        {desktopCookies && <div className="youtube-tabs">
          <button className={mode === 'browser' ? 'active' : ''} onClick={() => setMode('browser')}><MonitorSmartphone size={15}/> Из браузера</button>
          <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}><FileText size={15}/> cookies.txt</button>
        </div>}
        {desktopCookies && mode === 'browser' ? <div className="youtube-pane">
          <p className="youtube-hint">Выбери браузер, где ты вошёл в YouTube. Закрой его перед сохранением — так cookies прочитаются без блокировки.</p>
          <div className="browser-chips">{browsers.map(item => <button key={item.id} className={browser === item.id ? 'active' : ''} onClick={() => setBrowser(item.id)}>{item.label}</button>)}</div>
          <div className="youtube-actions">
            <button className="set-primary" disabled={saving} onClick={() => saveAuth({ mode: 'browser', browser })}>{saving ? <Loader2 className="spin" size={15}/> : <Check size={15}/>} Подключить {browsers.find(item => item.id === browser)?.label}</button>
            <button className="set-ghost" disabled={testing || !connected} onClick={runTest}>{testing ? <Loader2 className="spin" size={15}/> : <AudioLines size={15}/>} Проверить</button>
            {connected && <button className="set-danger" disabled={saving} onClick={disconnect}><Trash2 size={15}/> Отключить</button>}
          </div>
        </div> : <div className="youtube-pane">
          <p className="youtube-hint">{isIOS ? 'Открой youtube.com на компьютере, экспортируй cookies расширением вроде «Get cookies.txt LOCALLY» и вставь текст сюда — например, через Заметки или сохранённое сообщение. Поддерживается и JSON-экспорт.' : onDevice ? 'Открой youtube.com в браузере на компьютере, экспортируй cookies расширением вроде «Get cookies.txt LOCALLY» и вставь сюда. Поддерживается и JSON-экспорт.' : 'Экспортируй cookies расширением вроде «Get cookies.txt LOCALLY» с сайта youtube.com и вставь сюда. Поддерживается и JSON-экспорт.'}</p>
          <textarea value={cookies} onChange={event => setCookies(event.target.value)} placeholder={'# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t…\tSID\t…'} spellCheck={false} aria-label="Содержимое cookies.txt"/>
          <div className="youtube-actions">
            <button className="set-primary" disabled={saving || !cookies.trim()} onClick={() => saveAuth({ mode: 'file', cookies })}>{saving ? <Loader2 className="spin" size={15}/> : <ShieldCheck size={15}/>} Сохранить и подключить</button>
            <button className="set-ghost" disabled={testing || !connected} onClick={runTest}>{testing ? <Loader2 className="spin" size={15}/> : <AudioLines size={15}/>} Проверить</button>
            {connected && <button className="set-danger" disabled={saving} onClick={disconnect}><Trash2 size={15}/> Удалить cookies</button>}
          </div>
        </div>}
        {test && <div className={`youtube-test ${test.ok ? 'ok' : 'fail'}`}>{test.ok ? <><Check size={14}/> YouTube отвечает{test.title ? `: «${test.title}»` : ''}. Подключение работает.</> : <><CircleAlert size={14}/> {test.error || 'Проверка не удалась'}</>}</div>}
        <div className="youtube-foot"><ShieldCheck size={13}/> {onDevice ? 'Cookies хранятся только на этом устройстве и никуда не отправляются.' : <>Cookies хранятся локально в <code>.data/youtube-cookies.txt</code> и никогда не покидают этот компьютер.</>}</div>
      </section>

      <section className="set-card tokens-card">
        <header><span className="set-icon tokens"><KeyRound size={18}/></span><div><strong>Токены источников</strong><small>ВКонтакте и Яндекс Музыка</small></div></header>
        <p className="youtube-lead">{onDevice ? 'Вставь свой токен — плеер сохранит его на этом устройстве и сразу начнёт использовать ВКонтакте и Яндекс Музыку в поиске и рекомендациях.' : <>Вставь свой токен — плеер запишет его в <code>.env</code> и сразу начнёт использовать. Значения остаются только на этом компьютере.</>}</p>
        <div className="token-list">{tokenSources.map(source => {
          const state = tokens?.[source.id]
          const busy = tokenSaving === source.id
          const draft = tokenDraft[source.id]
          const shown = tokenReveal[source.id]
          return <div className={`token-row ${state?.set ? 'on' : ''}`} key={source.id}>
            <div className="token-head">
              <span className={`token-mark ${source.id}`}>{source.id === 'vk' ? 'VK' : 'Я'}</span>
              <div className="token-copy"><strong>{source.name}</strong><small>{!state ? 'Проверяем…' : state.set ? `Токен сохранён · ${state.length} символов` : 'Токен не добавлен'}</small></div>
              <span className={`set-status ${state?.set ? 'on' : ''}`}>{state?.set ? <Check size={12}/> : <CircleAlert size={12}/>} {state?.set ? 'Включено' : 'Выключено'}</span>
            </div>
            <p className="token-hint">{source.hint}</p>
            <div className="token-field">
              <input type={shown ? 'text' : 'password'} value={draft} placeholder={source.placeholder} spellCheck={false} autoComplete="off" aria-label={`Токен ${source.name}`} onChange={event => { const value = event.target.value; setTokenDraft(prev => ({ ...prev, [source.id]: value })) }}/>
              <button className="token-reveal" onClick={() => setTokenReveal(prev => ({ ...prev, [source.id]: !prev[source.id] }))} aria-label={shown ? 'Скрыть токен' : 'Показать токен'} title={shown ? 'Скрыть токен' : 'Показать токен'}>{shown ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
            </div>
            <div className="token-actions">
              <button className="set-primary" disabled={busy || !draft.trim()} onClick={() => saveToken(source.id)}>{busy ? <Loader2 className="spin" size={15}/> : <ShieldCheck size={15}/>} Сохранить</button>
              <a className="set-ghost" href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Как получить токен</a>
              {state?.set && <button className="set-danger" disabled={busy} onClick={() => removeToken(source.id)}><Trash2 size={15}/> Удалить</button>}
            </div>
          </div>
        })}</div>
        <div className="youtube-foot"><ShieldCheck size={13}/> {onDevice ? 'Токены хранятся только на этом устройстве и никуда не отправляются.' : <>Токены пишутся в <code>.env</code> и никуда не отправляются.</>}</div>
      </section>

      {!isAndroid && <section className="set-card google-card">
        <header><span className="set-icon tokens"><KeyRound size={18}/></span><div><strong>Вход через Google</strong><small>OAuth-клиент для настольного приложения</small></div><span className={`set-status ${tokens?.google?.set ? 'on' : ''}`}>{tokens?.google?.set ? <Check size={12}/> : <CircleAlert size={12}/>} {tokens?.google?.set ? 'Настроено' : 'Не настроено'}</span></header>
        <p className="youtube-lead">В <a className="set-ghost" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console <ExternalLink size={12}/></a> создайте OAuth-клиент типа <b>Desktop app</b> и вставьте сюда его Client ID. Секрет нужен только для клиента типа «Web application». Вход открывается в браузере и возвращается в Kinetix — Google не разрешает вход во встроенных окнах.</p>
        <div className="google-fields">
          <label className="google-field"><span>Client ID</span>
            <div className="token-field"><input type="text" value={googleDraft.id} placeholder="1234567890-abc…apps.googleusercontent.com" spellCheck={false} autoComplete="off" onChange={event => setGoogleDraft(prev => ({ ...prev, id: event.target.value }))}/></div>
          </label>
          <label className="google-field"><span>Client Secret <em>если клиент типа Web application</em></span>
            <div className="token-field">
              <input type={googleSecretShown ? 'text' : 'password'} value={googleDraft.secret} placeholder="GOCSPX-…" spellCheck={false} autoComplete="off" onChange={event => setGoogleDraft(prev => ({ ...prev, secret: event.target.value }))}/>
              <button className="token-reveal" type="button" onClick={() => setGoogleSecretShown(value => !value)} aria-label={googleSecretShown ? 'Скрыть секрет' : 'Показать секрет'}>{googleSecretShown ? <EyeOff size={16}/> : <Eye size={16}/>}</button>
            </div>
          </label>
        </div>
        <div className="token-actions">
          <button className="set-primary" disabled={savingGoogle || (!googleDraft.id.trim() && !googleDraft.secret.trim())} onClick={saveGoogle}>{savingGoogle ? <Loader2 className="spin" size={15}/> : <ShieldCheck size={15}/>} Сохранить</button>
          {tokens?.google?.set && <button className="set-danger" disabled={savingGoogle} onClick={removeGoogle}><Trash2 size={15}/> Удалить</button>}
        </div>
        <div className="youtube-foot"><ShieldCheck size={13}/> Для веб-клиента добавьте redirect URI <code>http://127.0.0.1:8788/api/auth/google/callback</code>. Значения хранятся в <code>.env</code> на этом компьютере.</div>
      </section>}

      <section className="set-card transfer-card">
        <header><span className="set-icon tokens"><ArrowLeftRight size={18}/></span><div><strong>Перенос данных</strong><small>Браузер ↔ приложение</small></div>{user && <span className="set-status on"><Check size={12}/> {user.email}</span>}</header>
        <p className="youtube-lead">Google подтверждает только вход: плейлисты, Моменты и коллекции каждая версия хранит локально, поэтому сами они не переносятся. Скачайте файл там, где уже есть музыка, и импортируйте в другой версии. Текущие плейлисты, Моменты и коллекции заменятся данными из файла.</p>
        <div className="transfer-stats">
          <span><b>{counts.favorites}</b> любимых</span>
          <span><b>{counts.library}</b> в медиатеке</span>
          {user && <span><b>{user.playlists.length}</b> плейлистов</span>}
          {user && <span><b>{user.moments.length}</b> Моментов</span>}
        </div>
        <div className="transfer-actions">
          <button className="set-primary" disabled={transferBusy} onClick={downloadTransfer}><Download size={15}/> {user ? 'Скачать аккаунт и коллекции' : 'Скачать коллекции'}</button>
          <label className={`transfer-upload ${transferBusy ? 'is-busy' : ''}`}>
            <Upload size={15}/> {transferBusy ? 'Импортируем…' : 'Импортировать файл'}
            <input type="file" accept={isIOS ? undefined : 'application/json,.json'} disabled={transferBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importTransfer(file) }}/>
          </label>
        </div>
        {transferError && <div className="transfer-error">{transferError}</div>}
        <div className="youtube-foot"><ShieldCheck size={13}/> Файл создаётся на этом устройстве и никуда не отправляется.</div>
      </section>

      <section className="set-card dislikes-card">
        <header><span className="set-icon dislike"><ThumbsDown size={18}/></span><div><strong>Неинтересные треки</strong><small>Что больше не должно попадаться</small></div>{dislikes.length > 0 && <span className="set-status">{dislikes.length}</span>}</header>
        <p className="youtube-lead">Отмечай треки через меню <b>⋯</b> — они пропускаются, убираются из истории и очереди, а похожие на них перестают попадаться в рекомендациях. Исполнитель при этом не блокируется.</p>
        {dislikes.length ? <>
          <div className="dislike-list">{dislikes.map(track => <div className="dislike-row" key={track.id}>
            <span className="dislike-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && '♫'}</span>
            <span className="dislike-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
            <button className="dislike-undo" onClick={() => onRestoreDislike(track)} aria-label={`Вернуть «${track.title}» в рекомендации`} title="Вернуть в рекомендации"><Undo2 size={15}/><span>Вернуть</span></button>
          </div>)}</div>
          <div className="dislike-actions"><button className="set-ghost" onClick={onClearDislikes}><Trash2 size={15}/> Очистить список</button></div>
        </> : <div className="set-note"><ThumbsDown size={15}/><span>Список пуст. Если трек не в настроение — открой <b>⋯</b> у него и выбери «Неинтересно».</span></div>}
      </section>

      {desktopBridge && autoLaunch?.supported && <section className="set-card desktop-card">
        <header><span className="set-icon desktop"><Rocket size={18}/></span><div><strong>Приложение</strong><small>Поведение настольной версии</small></div>{autoLaunch.enabled && <span className="set-status on"><Check size={12}/> В автозапуске</span>}</header>
        <Toggle checked={autoLaunch.enabled} disabled={autoLaunchBusy} onChange={changeAutoLaunch} label="Запускать при входе в Windows" hint="Kinetix откроется вместе с системой — плеер будет под рукой сразу после включения компьютера"/>
        <div className="set-note"><Power size={15}/><span>Настройка хранится в Windows и переживает обновления приложения. Закрытие окна убирает плеер в трей — музыка продолжает играть.</span></div>
      </section>}

      <section className="set-card set-about">
        <header><span className="set-icon"><Sparkles size={18}/></span><div><strong>Kinetix</strong><small>Твой ритм. Твои правила.</small></div></header>
        <div className="set-sources"><span>YouTube</span><span>Яндекс Музыка</span><span>ВКонтакте</span><span>Оффлайн-файлы</span></div>
        <p>Полные версии треков, неофициальные каталоги, моменты и рекомендации — в одном плеере.</p>
      </section>
    </div>
  </div>
}
