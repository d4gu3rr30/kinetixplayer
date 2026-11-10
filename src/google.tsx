import { useEffect, useRef, useState } from 'react'
import type { User } from './account'

type GoogleIdentity = { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void }) => void; renderButton: (target: HTMLElement, options: Record<string, string | number>) => void } } }
declare global { interface Window { google?: GoogleIdentity } }

let scriptPromise: Promise<void> | null = null
function loadGoogle() {
  if (window.google) return Promise.resolve()
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { scriptPromise = null; reject(new Error('Не удалось загрузить вход Google')) }
    document.head.appendChild(script)
  })
  return scriptPromise
}

type PollResult = { status: 'pending' } | { status: 'ok'; user: User; newAccount: boolean } | { status: 'error' | 'expired'; error?: string }

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

type GoogleButtonProps = {
  clientId: string
  desktop?: boolean
  onCredential: (idToken: string) => void
  onUser?: (user: User, newAccount: boolean) => void
}

export function GoogleButton({ clientId, desktop, onCredential, onUser }: GoogleButtonProps) {
  const target = useRef<HTMLDivElement>(null)
  const callback = useRef(onCredential)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  callback.current = onCredential
  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!clientId || desktop || !target.current) return
    let cancelled = false
    loadGoogle().then(() => {
      if (cancelled || !target.current || !window.google) return
      target.current.replaceChildren()
      window.google.accounts.id.initialize({ client_id: clientId, callback: response => { if (response.credential) callback.current(response.credential) } })
      window.google.accounts.id.renderButton(target.current, { theme: 'filled_black', shape: 'pill', size: 'large', text: 'continue_with', width: Math.min(target.current.clientWidth, 400) })
    }).catch(cause => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true }
  }, [clientId, desktop])

  async function startDesktop() {
    if (!onUser || busy) return
    setBusy(true)
    setError('')
    try {
      const start = await fetch('/api/auth/google/start', { method: 'POST' })
      const data = await start.json()
      if (!start.ok || !data.url) throw new Error(data.error || 'Не удалось начать вход через Google')
      window.open(data.url, '_blank')
      const deadline = Date.now() + 180_000
      while (alive.current && Date.now() < deadline) {
        await wait(1500)
        if (!alive.current) return
        const response = await fetch(`/api/auth/google/poll?state=${encodeURIComponent(data.state)}`)
        const result: PollResult = await response.json()
        if (result.status === 'ok') return onUser(result.user, result.newAccount)
        if (result.status === 'error' || result.status === 'expired') throw new Error(result.error || 'Вход через Google не завершён')
      }
      throw new Error('Время входа истекло — попробуйте ещё раз')
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : 'Не удалось войти через Google')
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  if (desktop && onUser) {
    return <div className="google-button-wrap">
      {clientId
        ? <button type="button" className="google-desktop-button" onClick={startDesktop} disabled={busy}>
            <span className="google-g">G</span>
            {busy ? 'Ждём подтверждения в браузере…' : 'Продолжить с Google'}
          </button>
        : <button type="button" className="google-pending-button" disabled><span className="google-g">G</span> Продолжить с Google</button>}
      {clientId && !busy && <small className="google-desktop-note">Вход откроется в браузере и вернётся в Kinetix</small>}
      {!clientId && <small className="google-setup">Добавьте Google Client ID в настройках Kinetix — раздел «Вход через Google».</small>}
      {error && <small className="google-error">{error}</small>}
    </div>
  }

  return clientId ? <div className="google-button-wrap"><div ref={target} className="google-button"/>{error && <small>{error}</small>}</div> : <div className="google-button-wrap google-button-pending"><button className="google-pending-button" disabled><span className="google-g">G</span> Продолжить с Google</button><small className="google-setup">Вход через Google пока не настроен владельцем приложения.</small></div>
}
