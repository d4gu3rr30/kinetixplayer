import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'

type DesktopWindow = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximized: (callback: (value: boolean) => void) => () => void
}

type AutoLaunchState = { supported: boolean; enabled: boolean }
type DesktopApp = {
  autoLaunch: () => Promise<AutoLaunchState>
  setAutoLaunch: (enabled: boolean) => Promise<AutoLaunchState>
}

declare global {
  interface Window {
    kinetixWindow?: DesktopWindow
    kinetixApp?: DesktopApp
  }
}

export function hasDesktopWindow() {
  return typeof window !== 'undefined' && Boolean(window.kinetixWindow)
}

export function WindowBar() {
  const api = window.kinetixWindow
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!api) return
    let alive = true
    api.isMaximized().then(value => { if (alive) setMaximized(value) }).catch(() => {})
    const off = api.onMaximized(setMaximized)
    return () => { alive = false; off() }
  }, [api])

  if (!api) return null

  return <header className="desktop-titlebar">
    <div className="titlebar-brand">
      <img src="/kinetix-mark.svg" alt=""/>
      <span>kinetix<i>.</i></span>
      <small>настольное приложение</small>
    </div>
    <div className="titlebar-drag"/>
    <div className="titlebar-controls">
      <button type="button" title="Свернуть" aria-label="Свернуть" onClick={() => api.minimize()}><Minus size={14} strokeWidth={2.4}/></button>
      <button type="button" title={maximized ? 'Восстановить' : 'Развернуть'} aria-label={maximized ? 'Восстановить' : 'Развернуть'} onClick={() => api.toggleMaximize()}>{maximized ? <Copy size={13} strokeWidth={2.2}/> : <Square size={12} strokeWidth={2.2}/>}</button>
      <button type="button" className="titlebar-close" title="Закрыть в трей" aria-label="Закрыть в трей" onClick={() => api.close()}><X size={15} strokeWidth={2.4}/></button>
    </div>
  </header>
}
