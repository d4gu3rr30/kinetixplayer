import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './main'
import { isAndroid } from './platform'
import { installAndroidShell } from './android'

declare global {
  interface Window { __kinetixIntroDone?: () => void }
}

if (isAndroid) installAndroidShell()

const root = createRoot(document.getElementById('app')!)
root.render(<React.StrictMode><App/></React.StrictMode>)
requestAnimationFrame(() => requestAnimationFrame(() => window.__kinetixIntroDone?.()))
if (!isAndroid && 'serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
