import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, ImageDown, Link2, LogOut, Mail, Music2, Play, Search, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import { artistById, artistByName, genres, registerArtists } from './catalog'
import { ArtistFace } from './artistFace'
import { request } from './api'
import { GoogleButton } from './google'
import { usePresence } from './presence'
import { ArtistPicker } from './artistDiscovery'
import { aggregateArtists, formatListenTime, totalListen, type ListenPeriod, type ListenStats } from './listening'
import type { Playlist, Track } from './types'

export type Moment = { id: string; lines: { at: number; text: string }[]; track: { id: string; title: string; artist: string; artwork: string; url: string; duration?: number }; createdAt: string }
export type User = { id: string; email: string; name: string; status: string; statusTrack?: Track | null; avatar: string; artists: string[]; moments: Moment[]; playlists: Playlist[]; googleLinked?: boolean; createdAt: string }
const genreNames: Record<string, string> = Object.fromEntries(genres.map(item => [item.id, item.label]))
const trackArt = (track: Track) => track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : { background: 'linear-gradient(145deg,#d7ff57,#47632a)' }

type ArtistPhoto = { url: string; source: string } | null
let photoCache: Record<string, ArtistPhoto> | null = null
function useArtistPhotos() {
  const [photos, setPhotos] = useState<Record<string, ArtistPhoto>>(photoCache || {})
  useEffect(() => { if (photoCache) return; let active = true; fetch('/api/artist-photos').then(response => response.json()).then(data => { photoCache = data.photos || {}; if (active) setPhotos(photoCache!) }).catch(() => {}); return () => { active = false } }, [])
  return photos
}
function Avatar({ user, size = 'normal' }: { user: User | null; size?: 'normal' | 'large' }) { return <div className={`profile-avatar ${size === 'large' ? 'profile-avatar-large' : ''}`}>{user?.avatar ? <img src={user.avatar} alt="Аватар"/> : <span>{user?.name?.slice(0, 1).toUpperCase() || 'K'}</span>}</div> }

const stamp = (seconds: number) => { const value = Math.max(0, Math.round(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }

const LISTEN_PERIODS: { id: ListenPeriod; label: string; scope: string }[] = [
  { id: 'day', label: 'Сегодня', scope: 'сегодня' },
  { id: 'month', label: 'Месяц', scope: 'за месяц' },
  { id: 'half', label: 'Полгода', scope: 'за полгода' },
  { id: 'year', label: 'Год', scope: 'за год' },
]
const artistsLabel = (count: number) => count % 10 === 1 && count % 100 !== 11 ? `${count} исполнитель` : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? `${count} исполнителя` : `${count} исполнителей`
const artistVisual = (name: string, photos: Record<string, ArtistPhoto>) => {
  const artist = artistByName(name)
  return { id: artist?.id || '', tint: artist?.tint || '#3f4d33', image: artist?.id ? photos[artist.id]?.url : undefined }
}

function PeriodTabs({ period, onChange }: { period: ListenPeriod; onChange: (period: ListenPeriod) => void }) {
  return <div className="listening-tabs" role="tablist" aria-label="Период статистики">
    {LISTEN_PERIODS.map(item => <button key={item.id} role="tab" aria-selected={period === item.id} className={period === item.id ? 'is-active' : ''} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>
}

function ListeningTop({ stats, photos, onArtist }: { stats?: ListenStats; photos: Record<string, ArtistPhoto>; onArtist: (artist: { id?: string; name: string; image?: string }) => void }) {
  const [period, setPeriod] = useState<ListenPeriod>('year')
  const [open, setOpen] = useState(false)
  const openGate = usePresence(open)
  const list = useMemo(() => stats ? aggregateArtists(stats, period) : [], [stats, period])
  const total = useMemo(() => totalListen(list), [list])
  const hasHistory = Boolean(stats && Object.keys(stats.days).length)
  const top = list.slice(0, 3)
  const order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : top.length ? [0] : []
  const scope = LISTEN_PERIODS.find(item => item.id === period)?.scope || ''
  const openArtist = (name: string) => { const visual = artistVisual(name, photos); onArtist({ id: visual.id || undefined, name, image: visual.image }) }
  return <div className="listening-section">
    <div className="section-heading profile-heading listening-heading">
      <div><span className="section-kicker">ТВОЁ ВРЕМЯ В МУЗЫКЕ</span><h2>Личный топ <span className="heading-star">✳</span></h2></div>
      <div className="profile-heading-actions">
        {list.length > 0 && <span className="listening-total"><i/>{formatListenTime(total)} <em>{scope}</em></span>}
        {list.length > 3 && <button className="view-all" onClick={() => setOpen(true)}>Все · {list.length} ↗</button>}
      </div>
    </div>
    {hasHistory && <PeriodTabs period={period} onChange={setPeriod}/>}
    {top.length ? <div className={`listening-podium count-${top.length}`}>{order.map((index, position) => {
      const item = top[index]
      const rank = index + 1
      const visual = artistVisual(item.name, photos)
      return <article key={item.key} className={`podium-spot rank-${rank}`} style={{ '--delay': position, '--share': `${Math.max(8, item.seconds / top[0].seconds * 100)}%` } as CSSProperties}>
        <span className="podium-rank">{rank === 1 ? 'ТОП 01' : `0${rank}`}</span>
        <button className="podium-avatar" style={{ background: visual.tint }} onClick={() => openArtist(item.name)} aria-label={`Открыть ${item.name}`}>
          <ArtistFace name={item.name} image={visual.image} className="artist-face"/>
          <i className="podium-ring"/>
        </button>
        <strong className="podium-name">{item.name}</strong>
        <span className="podium-time">{formatListenTime(item.seconds)}</span>
        <span className="podium-bar"><i/></span>
      </article>
    })}</div> : <div className="listening-empty"><span className="listening-empty-orbit"><Sparkles size={18}/></span><span><strong>{hasHistory ? 'За этот период пока тихо.' : 'Твой топ ещё пуст.'}</strong><em>{hasHistory ? 'Выбери другой период — время за него уже записано.' : 'Включи музыку — и Kinetix начнёт считать твоё время вместе с исполнителями.'}</em></span></div>}
    {openGate.mounted && <div className={`modal-backdrop ${openGate.closing ? 'is-closing' : ''}`} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false) }}>
      <div className="auth-modal listening-modal" role="dialog" aria-modal="true" aria-label="Всё прослушанное время">
        <button className="modal-close" onClick={() => setOpen(false)} aria-label="Закрыть"><X size={20}/></button>
        <div className="auth-eyebrow">ТВОЯ ИСТОРИЯ В МИНУТАХ</div>
        <h2>Всё <em>время.</em></h2>
        <p>Сколько ты слушал каждого исполнителя. Период можно менять в любой момент.</p>
        <PeriodTabs period={period} onChange={setPeriod}/>
        <div className="listening-modal-list">
          {list.map((item, index) => {
            const visual = artistVisual(item.name, photos)
            return <button key={item.key} className="listen-row" style={{ '--i': Math.min(index, 18) } as CSSProperties} onClick={() => { setOpen(false); openArtist(item.name) }}>
              <span className="listen-rank">{String(index + 1).padStart(2, '0')}</span>
              <span className="listen-avatar" style={{ background: visual.tint }}><ArtistFace name={item.name} image={visual.image} className="artist-face"/></span>
              <span className="listen-copy"><span className="listen-top"><strong>{item.name}</strong><em>{formatListenTime(item.seconds)}</em></span><span className="listen-bar"><i style={{ width: `${Math.max(3, item.seconds / list[0].seconds * 100)}%` }}/></span></span>
              <span className="listen-share">{Math.round(item.seconds / total * 100)}%</span>
            </button>
          })}
          {!list.length && <p className="followed-modal-empty">За этот период пока нет прослушиваний.</p>}
        </div>
        <div className="followed-modal-footer"><span>{LISTEN_PERIODS.find(item => item.id === period)?.label} · {formatListenTime(total)}</span><span>{artistsLabel(list.length)}</span></div>
      </div>
    </div>}
  </div>
}

function MomentCard({ moment, index, active, onDelete, onPlay, onShare, onSaveImage }: { moment: Moment; index: number; active: boolean; onDelete: (id: string) => void; onPlay: (moment: Moment, at?: number) => void; onShare: (moment: Moment) => void; onSaveImage: (moment: Moment) => void }) {
  const featured = index === 0
  const withTime = moment.lines.some(line => line.at > 0)
  const hue = [...moment.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360
  const style = { '--moment-hue': hue } as CSSProperties
  const artwork = moment.track.artwork ? `url("${moment.track.artwork.replace(/"/g, '')}")` : undefined
  return <article className={`moment-card ${featured ? 'moment-featured' : ''} ${active ? 'is-playing' : ''}`} style={style}>
    {featured && moment.track.artwork && <span className="moment-art-backdrop" style={{ backgroundImage: artwork }}/>}
    <span className="moment-aurora"/>
    <div className="moment-card-top">
      <span className="moment-quote-mark">“</span>
      <span className="moment-badge">{active ? 'ИГРАЕТ СЕЙЧАС' : featured ? 'ПОСЛЕДНИЙ МОМЕНТ' : `МОМЕНТ ${String(index + 1).padStart(2, '0')}`}</span>
      <button className="moment-play" onClick={() => onPlay(moment, moment.lines[0]?.at || 0)} aria-label={`Включить ${moment.track.title} с сохранённой строки`} title={withTime ? `Вернуться на ${stamp(moment.lines[0].at)}` : 'Включить трек'}><Play size={15} fill="currentColor"/></button>
    </div>
    <blockquote>{moment.lines.map((line, lineIndex) => <span key={`${line.at}-${lineIndex}`} style={{ '--line': lineIndex } as CSSProperties}>
      {withTime && <button className="moment-line-time" onClick={() => onPlay(moment, line.at)} title={`Вернуться на ${stamp(line.at)}`}>{stamp(line.at)}</button>}
      <span>{line.text}</span>
    </span>)}</blockquote>
    <div className="moment-track">
      <span className="moment-art" style={artwork ? { backgroundImage: artwork } : undefined}>{!moment.track.artwork && '♫'}</span>
      <span className="moment-track-copy"><strong>{moment.track.title}</strong><small>{moment.track.artist}</small></span>
      <span className="moment-equalizer" aria-hidden="true"><i/><i/><i/><i/></span>
      <button className="moment-share" onClick={() => onShare(moment)} aria-label="Поделиться ссылкой на Момент" title="Поделиться ссылкой"><Link2 size={15}/></button>
      <button className="moment-save-image" onClick={() => onSaveImage(moment)} aria-label="Сохранить карточку Момента" title="Сохранить карточку-картинку"><ImageDown size={15}/></button>
      <button className="moment-delete" onClick={() => onDelete(moment.id)} aria-label="Удалить Момент" title="Удалить Момент"><Trash2 size={15}/></button>
    </div>
    <div className="moment-footer">
      <time>{new Date(moment.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
      <button className="moment-return" onClick={() => onPlay(moment, moment.lines[0]?.at || 0)}>{withTime ? 'Вернуться в строку' : 'Включить трек'} <ArrowRight size={13}/></button>
    </div>
  </article>
}

function MomentsSection({ moments, activeId, playing, onDelete, onPlay, onShare, onSaveImage }: { moments: Moment[]; activeId?: string; playing?: boolean; onDelete: (id: string) => void; onPlay: (moment: Moment, at?: number) => void; onShare: (moment: Moment) => void; onSaveImage: (moment: Moment) => void }) {
  const label = moments.length % 10 === 1 && moments.length % 100 !== 11 ? 'момент' : [2, 3, 4].includes(moments.length % 10) && ![12, 13, 14].includes(moments.length % 100) ? 'момента' : 'моментов'
  return <>
    <div className="section-heading profile-heading"><div><span className="section-kicker">СТРОКИ, КОТОРЫЕ ОСТАЛИСЬ</span><h2>Мои Моменты <span className="heading-star">✳</span></h2></div>{moments.length > 0 && <span className="moments-count">{moments.length} {label}</span>}</div>
    {moments.length ? <div className="moments-grid">{moments.map((moment, index) => <MomentCard key={moment.id} moment={moment} index={index} active={Boolean(playing && activeId === moment.track.id)} onDelete={onDelete} onPlay={onPlay} onShare={onShare} onSaveImage={onSaveImage}/>)}</div> : <div className="moment-empty">
      <div className="moment-empty-orbit"><span>“</span></div>
      <h3>Твои истории начнутся со строки.</h3>
      <p>Открой трек с текстом, выбери одну или несколько строк и сохрани их в Момент. А потом возвращайся ровно к тому месту, где это было сказано.</p>
      <div className="moment-empty-steps"><span><b>01</b>Включи трек</span><span><b>02</b>Выбери строки</span><span><b>03</b>Вернись в момент</span></div>
    </div>}
  </>
}

export function AuthDialog({ onClose, onAuthenticated, googleClientId, desktop }: { onClose: () => void; onAuthenticated: (user: User) => void; googleClientId: string; desktop?: boolean }) {
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [step, setStep] = useState<'form' | 'artists'>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [googleUser, setGoogleUser] = useState<User | null>(null)
  async function googleAuth(idToken: string) {
    setBusy(true); setError('')
    try {
      const result = await request<{ user: User; newAccount: boolean }>('/api/auth/google', 'POST', { idToken })
      if (result.newAccount) { setGoogleUser(result.user); setMode('register'); setStep('artists') }
      else { onAuthenticated(result.user); onClose() }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось войти через Google') }
    finally { setBusy(false) }
  }
  async function googleSignedIn(user: User, newAccount: boolean) {
    setError('')
    if (newAccount) { setGoogleUser(user); setMode('register'); setStep('artists') }
    else { onAuthenticated(user); onClose() }
  }
  async function submit(skip = false) {
    setError('')
    if (mode === 'register' && step === 'form') { if (name.trim().length < 2 || !email.includes('@') || password.length < 10) { setError('Укажите имя, email и пароль от 10 символов'); return } setStep('artists'); return }
    setBusy(true)
    try { if (googleUser) { const result = await request<{ user: User }>('/api/me', 'PATCH', { artists: skip ? [] : selected }); onAuthenticated(result.user); onClose(); return } const result = await request<{ user: User }>(mode === 'register' ? '/api/auth/register' : '/api/auth/login', 'POST', mode === 'register' ? { name, email, password, artists: skip ? [] : selected } : { email, password }); onAuthenticated(result.user); onClose() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Ошибка входа') }
    finally { setBusy(false) }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className={`auth-modal ${step === 'artists' ? 'artist-step-modal' : ''}`} role="dialog" aria-modal="true" aria-label="Аккаунт Kinetix"><button className="modal-close" onClick={onClose} aria-label="Закрыть"><X size={20}/></button>{step === 'artists' && mode === 'register' ? <>{!googleUser && <button className="back-link" onClick={() => setStep('form')}><ArrowLeft size={15}/> Назад</button>}<div className="auth-eyebrow">ШАГ 02 / ТВОЙ ЗВУК</div><h2>Кого будем<br/><em>слушать вместе?</em></h2><p>Выбирай любимых исполнителей. Каждый выбор откроет похожих — так Kinetix узнает твой вкус.</p><ArtistPicker selected={selected} onChange={setSelected}/><div className="auth-footer"><span>Выбрано: {selected.length}</span><button className="discovery-skip" disabled={busy} onClick={() => submit(true)}>Пропустить</button><button className="primary-btn" disabled={busy} onClick={() => submit()}>{googleUser ? 'Сохранить выбор' : 'Создать аккаунт'} <ArrowRight size={16}/></button></div></> : <><div className="auth-symbol">✳</div><div className="auth-eyebrow">KINETIX / ТВОЁ ПРОСТРАНСТВО</div><h2>{mode === 'register' ? <>Музыка становится<br/><em>личной.</em></> : <>Снова в своём<br/><em>ритме.</em></>}</h2><p>{mode === 'register' ? 'Создай профиль и собирай важные строки в свои Моменты.' : 'Войди, чтобы открыть профиль и сохранённые Моменты.'}</p><GoogleButton clientId={googleClientId} desktop={desktop} onCredential={googleAuth} onUser={googleSignedIn}/><div className="auth-divider"><span>или через email</span></div><form onSubmit={e => { e.preventDefault(); submit() }}>{mode === 'register' && <label>Твоё имя<input value={name} onChange={e => setName(e.target.value)} maxLength={40} autoComplete="name" placeholder="Как тебя зовут?" required/></label>}<label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" required/></label><label>Пароль<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 10 : undefined} placeholder="Минимум 10 символов" required/></label>{error && <div className="form-error">{error}</div>}<button className="primary-btn auth-submit" disabled={busy}>{mode === 'register' ? 'Выбрать исполнителей' : 'Войти'} <ArrowRight size={16}/></button></form><div className="auth-switch">{mode === 'register' ? 'Уже есть аккаунт?' : 'Ещё нет аккаунта?'} <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError('') }}>{mode === 'register' ? 'Войти' : 'Зарегистрироваться'}</button></div></>}{step === 'artists' && error && <div className="form-error">{error}</div>}</div></div>
}

type FollowedArtist = { id: string; name: string; tint: string; image?: string; tags: string[] }

function FollowedRail({ followed, motion, onArtist }: { followed: FollowedArtist[]; motion: boolean; onArtist: (artist: { id: string; name: string; image?: string }) => void }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const hoverable = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches, [])
  useEffect(() => {
    const track = trackRef.current
    if (!track || followed.length < 2 || !motion) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let last = 0
    let half = 0
    let position = 0
    let interacting = false
    let resumeAt = 0
    let ratio = 1
    const measure = () => {
      const next = track.scrollWidth / 2
      if (!Number.isFinite(next) || next <= 0) return
      ratio = half > 0 ? Math.min(1, Math.max(0, position / half)) : 1
      half = next
      position = Math.min(half, Math.max(1, half * ratio))
      track.scrollLeft = position
    }
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    measure()
    const step = (now: number) => {
      if (!last) last = now
      const delta = Math.min(64, now - last)
      last = now
      if (!pausedRef.current && !interacting && now >= resumeAt && half > track.clientWidth + 8) {
        position -= delta * 0.032
        if (position <= 1) position += half
        track.scrollLeft = position
      } else {
        position = track.scrollLeft
      }
      frame = requestAnimationFrame(step)
    }
    const grab = () => { interacting = true; position = track.scrollLeft }
    const release = () => { interacting = false; position = track.scrollLeft; last = 0; resumeAt = performance.now() + 2400 }
    const settle = () => { resumeAt = performance.now() + 2400; last = 0 }
    track.addEventListener('pointerdown', grab)
    track.addEventListener('touchstart', grab, { passive: true })
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    track.addEventListener('touchend', release, { passive: true })
    track.addEventListener('touchcancel', release, { passive: true })
    track.addEventListener('wheel', settle, { passive: true })
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame); observer.disconnect()
      track.removeEventListener('pointerdown', grab)
      track.removeEventListener('touchstart', grab)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      track.removeEventListener('touchend', release)
      track.removeEventListener('touchcancel', release)
      track.removeEventListener('wheel', settle)
    }
  }, [followed.length, motion])
  return <div className={`followed-rail ${paused ? 'is-paused' : ''}`} {...(hoverable ? { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) } : {})} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
    {followed.length ? <div className="followed-track" ref={trackRef}>
      {[...followed, ...followed].map((artist, index) => {
        const copy = index >= followed.length
        return <button key={`${artist.id}-${copy ? 'copy' : 'main'}`} className="followed-chip" tabIndex={copy ? -1 : undefined} aria-hidden={copy || undefined} style={{ '--i': Math.min(index % followed.length, 14) } as CSSProperties} onClick={() => onArtist({ id: artist.id, name: artist.name, image: artist.image })}>
          <span className="followed-avatar" style={{ background: artist.tint }}><ArtistFace name={artist.name} image={artist.image} className="artist-face"/><i className="followed-ring"/></span>
          <strong>{artist.name}</strong>
          <small>Слушать <ArrowRight size={11}/></small>
        </button>
      })}
    </div> : <p className="followed-empty">Пока никого нет. Добавь исполнителей в настройках профиля.</p>}
  </div>
}

export function ProfileView({ user, onUpdate, onLogout, onDeleteMoment, onPlayMoment, onShareMoment, onSaveMomentImage, onArtist, googleClientId, desktop, onGoogleUser, onGoogleAuth, currentTrackId, playing, listenStats, motion = true, onPlayTrack, recapYear, recapActive, onOpenRecap }: { user: User; onUpdate: (patch: Partial<User>) => Promise<void>; onLogout: () => Promise<void>; onDeleteMoment: (id: string) => Promise<void>; onPlayMoment: (moment: Moment, at?: number) => void; onShareMoment: (moment: Moment) => void; onSaveMomentImage: (moment: Moment) => void; onArtist: (artist: { id?: string; name: string; image?: string }) => void; googleClientId: string; desktop: boolean; onGoogleUser: (user: User) => void; onGoogleAuth: (idToken: string) => Promise<void>; currentTrackId?: string; playing?: boolean; listenStats?: ListenStats; motion?: boolean; onPlayTrack?: (track: Track) => void; recapYear?: number | null; recapActive?: boolean; onOpenRecap?: (year: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [editingArtists, setEditingArtists] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const editingGate = usePresence(editing)
  const artistsGate = usePresence(editingArtists)
  const listGate = usePresence(listOpen)
  const [listQuery, setListQuery] = useState('')
  const [dynamicArtists, setDynamicArtists] = useState<Array<{ id: string; name: string; tags: string[]; tint: string; image?: string }>>([])
  const [name, setName] = useState(user.name)
  const [status, setStatus] = useState(user.status)
  const [avatar, setAvatar] = useState(user.avatar)
  const [chosen, setChosen] = useState(user.artists)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const photos = useArtistPhotos()
  function beginEdit() { setName(user.name); setStatus(user.status); setAvatar(user.avatar); setChosen(user.artists); setEditing(true) }
  function beginArtists() { setChosen(user.artists); setError(''); setEditingArtists(true) }
  useEffect(() => { const ids = user.artists.filter(id => id.startsWith('wiki-') || id.startsWith('ruwiki-') || id.startsWith('artist-') || id.startsWith('deezer-')); if (!ids.length) return; fetch(`/api/artists/lookup?ids=${encodeURIComponent(ids.join(','))}`).then(r => r.json()).then(data => { registerArtists(data.artists || []); setDynamicArtists(data.artists || []) }).catch(() => {}) }, [user.artists.join(',')])
  async function saveArtists() { setBusy(true); setError(''); try { await onUpdate({ artists: chosen }); setEditingArtists(false) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить') } finally { setBusy(false) } }
  async function upload(file: File | undefined) { if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10_000_000) { setError('Выберите PNG, JPEG или WebP до 10 МБ'); return } const url = URL.createObjectURL(file); const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256; const context = canvas.getContext('2d'); if (context) { const side = Math.min(image.width, image.height); context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256); setAvatar(canvas.toDataURL('image/jpeg', .82)); setError('') } URL.revokeObjectURL(url) }; image.onerror = () => { setError('Не удалось прочитать изображение'); URL.revokeObjectURL(url) }; image.src = url }
  async function save() { setBusy(true); setError(''); try { await onUpdate({ name, status, avatar, artists: chosen }); setEditing(false) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить') } finally { setBusy(false) } }
  const followed = user.artists.flatMap(id => {
    const artist = artistById(id) || dynamicArtists.find(item => item.id === id)
    if (!artist) return []
    return [{ id, name: artist.name, tint: artist.tint, tags: artist.tags || [], image: photos[id]?.url || dynamicArtists.find(item => item.id === id)?.image }]
  })
  const listFiltered = followed.filter(artist => !listQuery.trim() || artist.name.toLowerCase().includes(listQuery.trim().toLowerCase()))
  return <section className="profile-page"><div className="page-kicker">KINETIX / ЛИЧНОЕ ПРОСТРАНСТВО</div><div className="profile-hero"><div className="profile-hero-glow"/><div className="profile-hero-rings"/><div className="profile-hero-spark"><Sparkles size={30}/></div><Avatar user={user} size="large"/><div className="profile-hero-text"><span>ТВОЙ ПРОФИЛЬ</span><h1>{user.name}<i>.</i></h1><p>{user.status || 'Добавь пару слов о себе — это твоя музыка и твоя история.'}</p><small><Mail size={13}/>{user.email}</small></div><button className="outline-btn" onClick={beginEdit}><Settings2 size={16}/> Настройки профиля</button></div><div className={`status-track ${user.statusTrack ? 'has-track' : ''}`}>{user.statusTrack ? <>
      <button className="status-track-main" onClick={() => onPlayTrack?.(user.statusTrack!)} aria-label={`Включить ${user.statusTrack.title}`}>
        <span className="status-track-art" style={trackArt(user.statusTrack)}/>
        <span className="status-track-copy"><small>МОЁ НАСТРОЕНИЕ</small><strong>{user.statusTrack.title}</strong><em>{user.statusTrack.artist}</em></span>
        <span className="status-track-play"><Play size={15} fill="currentColor"/></span>
      </button>
      <button className="status-track-remove" onClick={() => { void onUpdate({ statusTrack: null }) }} aria-label="Убрать трек из настроения" title="Убрать из настроения"><X size={15}/></button>
    </> : <div className="status-track-empty"><span className="status-track-icon"><Music2 size={18}/></span><span><small>МОЁ НАСТРОЕНИЕ</small><strong>Пока тишина</strong><em>Добавь трек из меню «⋯» — и он появится здесь.</em></span></div>}</div>{!user.googleLinked && <div className="google-link-panel"><span>Добавь вход через Google к своему профилю</span><GoogleButton clientId={googleClientId} desktop={desktop} onCredential={idToken => { onGoogleAuth(idToken).catch(cause => setError(cause instanceof Error ? cause.message : "Ошибка Google")) }} onUser={onGoogleUser}/>{error && !editing && <div className="form-error">{error}</div>}</div>}<div className="profile-stats"><div><span className="profile-stat-icon">✦</span><strong>{user.moments.length}</strong><span>Моментов</span></div><div><strong>{user.artists.length}</strong><span>Исполнителей</span></div><div><strong>∞</strong><span>Историй впереди</span></div></div><ListeningTop stats={listenStats} photos={photos} onArtist={onArtist}/>{recapYear && onOpenRecap ? <button className={`profile-recap ${recapActive ? 'is-live' : ''}`} onClick={() => onOpenRecap(recapYear)}><span className="profile-recap-glow"/><span className="profile-recap-icon"><Sparkles size={20}/></span><span className="profile-recap-copy"><small>{recapActive ? 'KINETIX · ИТОГИ ГОДА' : 'ИТОГИ ПРОШЛОГО ГОДА'}</small><strong>Твой {recapYear} <em>в музыке</em></strong><em>{recapActive ? 'Год уже звучит — посмотри, из чего он сложился.' : 'Собран из твоих прослушиваний, треков и моментов.'}</em></span><span className="profile-recap-year" aria-hidden="true">{recapYear}</span><span className="profile-recap-go">Смотреть <ArrowRight size={15}/></span></button> : null}<MomentsSection moments={user.moments} activeId={currentTrackId} playing={playing} onDelete={onDeleteMoment} onPlay={onPlayMoment} onShare={onShareMoment} onSaveImage={onSaveMomentImage}/><div className="section-heading profile-heading"><div><span className="section-kicker">В ТВОЁМ ПОЛЕ ЗРЕНИЯ</span><h2>Отслеживаемые исполнители</h2></div><div className="profile-heading-actions">{followed.length > 0 && <button className="view-all" onClick={() => { setListQuery(''); setListOpen(true) }}>Все · {followed.length} ↗</button>}<button className="view-all" onClick={beginArtists}>Открыть сетку ↗</button></div></div><FollowedRail followed={followed} motion={motion} onArtist={onArtist}/><button className="logout-button" onClick={onLogout}><LogOut size={16}/> Выйти из аккаунта</button>{editingGate.mounted && <div className={`modal-backdrop ${editingGate.closing ? 'is-closing' : ''}`} role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditing(false) }}><div className="auth-modal edit-modal" role="dialog" aria-modal="true" aria-label="Изменить профиль"><button className="modal-close" onClick={() => setEditing(false)}><X size={20}/></button><div className="auth-eyebrow">НАСТРОЙКИ ПРОФИЛЯ</div><h2>Твоё <em>пространство.</em></h2><p className="edit-intro">Имя, фотография и статус создают твой музыкальный образ.</p><div className="avatar-edit"><div className="profile-avatar">{avatar ? <img src={avatar} alt="Новый аватар"/> : name.slice(0, 1)}</div><button onClick={() => fileRef.current?.click()}><Camera size={16}/> Выбрать фото</button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => upload(e.target.files?.[0])}/></div><label>Имя<input value={name} onChange={e => setName(e.target.value)} maxLength={40}/></label><label>Статус<input value={status} onChange={e => setStatus(e.target.value)} maxLength={120} placeholder="Что играет внутри?"/></label><strong className="edit-label">Любимые исполнители</strong><button className="outline-btn" onClick={() => { setEditing(false); setEditingArtists(true) }}>Открыть сетку исполнителей ↗</button>{error && <div className="form-error">{error}</div>}<button className="primary-btn auth-submit" onClick={save} disabled={busy}>Сохранить <Check size={16}/></button></div></div>}{artistsGate.mounted && <div className={`modal-backdrop discovery-backdrop ${artistsGate.closing ? 'is-closing' : ''}`}><div className="auth-modal artist-step-modal" role="dialog" aria-modal="true" aria-label="Выбор отслеживаемых исполнителей"><button className="modal-close" onClick={() => setEditingArtists(false)} aria-label="Закрыть"><X size={20}/></button><div className="auth-eyebrow">ТВОЯ МУЗЫКАЛЬНАЯ КАРТА</div><h2>Отслеживаемые <em>исполнители.</em></h2><p>Перетаскивай сетку и открывай новых артистов.</p><ArtistPicker selected={chosen} onChange={setChosen} onOpenArtist={artist => { setEditingArtists(false); onArtist(artist) }}/><div className="auth-footer"><span>Выбрано: {chosen.length}</span>{error && <span className="form-error">{error}</span>}<button className="primary-btn" onClick={saveArtists} disabled={busy}>Сохранить выбор <Check size={16}/></button></div></div></div>}{listGate.mounted && <div className={`modal-backdrop ${listGate.closing ? 'is-closing' : ''}`} role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setListOpen(false) }}><div className="auth-modal followed-modal" role="dialog" aria-modal="true" aria-label="Все отслеживаемые исполнители"><button className="modal-close" onClick={() => setListOpen(false)} aria-label="Закрыть"><X size={20}/></button><div className="auth-eyebrow">ТВОЁ ПОЛЕ ЗРЕНИЯ</div><h2>Все <em>исполнители.</em></h2><label className="followed-search"><Search size={16}/><input value={listQuery} onChange={e => setListQuery(e.target.value)} placeholder="Найти среди своих" aria-label="Найти исполнителя"/>{listQuery && <button type="button" onClick={() => setListQuery('')} aria-label="Очистить поиск"><X size={13}/></button>}</label><div className="followed-modal-list">{listFiltered.map(artist => <button key={artist.id} className="followed-modal-row" onClick={() => { setListOpen(false); onArtist({ id: artist.id, name: artist.name, image: artist.image }) }}><span className="followed-modal-avatar" style={{ background: artist.tint }}><ArtistFace name={artist.name} image={artist.image} className="artist-face"/></span><span className="followed-modal-copy"><strong>{artist.name}</strong><small>{artist.tags.slice(0, 3).map(tag => genreNames[tag] || tag).join(' · ') || 'Артист'}</small></span><span className="followed-modal-open">Открыть <ArrowRight size={13}/></span></button>)}{!listFiltered.length && <p className="followed-modal-empty">Никого не нашли.</p>}</div><div className="followed-modal-footer"><span>В поле зрения: {followed.length}</span><button className="outline-btn" onClick={() => { setListOpen(false); beginArtists() }}>Изменить список</button></div></div></div>}</section>
}







