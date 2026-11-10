import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './main'
import { isAndroid } from './platform'
import { installAndroidShell } from './android'

declare global {
  interface Window { __kinetixIntroDone?: () => void; __kinetixSyncViewport?: () => void }
}

if (isAndroid) installAndroidShell()

// iOS keeps the layout viewport at full height when the keyboard opens and
// pans the visual viewport instead, so fixed overlays anchored to the layout
// viewport end up behind the keyboard. Expose the visible area as CSS vars.
function trackVisualViewport() {
  const root = document.documentElement
  const viewport = window.visualViewport
  let frame = 0
  const apply = () => {
    frame = 0
    const keyboard = parseFloat(getComputedStyle(root).getPropertyValue('--kb-inset')) || 0
    const visible = Math.min(viewport ? viewport.height : window.innerHeight, window.innerHeight - keyboard)
    root.style.setProperty('--vv-height', `${Math.round(visible)}px`)
    root.style.setProperty('--vv-top', `${Math.round(viewport ? viewport.offsetTop : 0)}px`)
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply) }
  window.__kinetixSyncViewport = apply
  apply()
  if (viewport) {
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
  } else {
    window.addEventListener('resize', schedule)
  }
}
trackVisualViewport()

const root = createRoot(document.getElementById('app')!)
root.render(<React.StrictMode><App/></React.StrictMode>)
requestAnimationFrame(() => requestAnimationFrame(() => window.__kinetixIntroDone?.()))
if (!isAndroid && 'serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
