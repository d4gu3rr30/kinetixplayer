import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, Clock, Copy, ExternalLink, Globe, GripVertical, ImagePlus, Link2, ListMusic, Loader2, Lock, Music2, Pencil, Play, Plus, RefreshCw, Search, Shuffle, Sparkles, Trash2, X } from 'lucide-react'
import { request } from './api'
import { Presence } from './presence'
import type { User } from './account'
import type { ExternalPlaylist, ExternalPlaylistSummary, Playlist, PlaylistSummary, Track } from './types'

const stamp = (seconds: number) => { const value = Math.max(0, Math.round(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }
const totalDuration = (tracks: Track[]) => tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
const durationLabel = (tracks: Track[]) => { const value = totalDuration(tracks); return value > 0 ? `${Math.floor(value / 60)} мин` : 'без времени' }
const plural = (count: number, one: string, few: string, many: string) => count % 10 === 1 && count % 100 !== 11 ? one : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? few : many
const hueFrom = (value: string) => [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360
const sourceLabel: Record<string, string> = { youtube: 'YouTube', soundcloud: 'SoundCloud', yandex: 'Яндекс Музыка', vk: 'ВКонтакте', archive: 'Archive', audius: 'Audius', local: 'Оффлайн' }
const dayLabel = () => new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
const daySeed = () => { const now = new Date(); return now.getFullYear() * 372 + (now.getMonth() + 1) * 31 + now.getDate() }
function shrinkCover(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Подойдёт JPG, PNG или WebP')); return }
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, 640 / Math.max(image.width, image.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d')
      if (!context) { reject(new Error('Не удалось обработать изображение')); return }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      let data = canvas.toDataURL('image/jpeg', .84)
      if (data.length > 380_000) data = canvas.toDataURL('image/jpeg', .62)
      resolve(data)
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')) }
    image.src = url
  })
}

function seededRandom(seed: number) { let value = seed % 2147483647; if (value <= 0) value += 2147483646; return () => (value = value * 16807 % 2147483647) / 2147483647 }
function shuffled<T>(items: T[], seed: number) { const random = seededRandom(seed); const copy = [...items]; for (let index = copy.length - 1; index > 0; index--) { const swap = Math.floor(random() * (index + 1)); [copy[index], copy[swap]] = [copy[swap], copy[index]] } return copy }
function artistDiverse(tracks: Track[], limit: number, seed: number) {
  const pool = [...new Map(tracks.filter(track => track.id && track.title).map(track => [track.id, track])).values()]
  const order = shuffled(pool, seed)
  const picked: Track[] = []
  const artists = new Map<string, number>()
  for (const track of order) {
    const artist = track.artist.toLowerCase().trim()
    if ((artists.get(artist) || 0) >= 2) continue
    picked.push(track)
    artists.set(artist, (artists.get(artist) || 0) + 1)
    if (picked.length >= limit) break
  }
  if (picked.length < Math.min(limit, pool.length)) {
    for (const track of order) {
      if (picked.includes(track)) continue
      picked.push(track)
      if (picked.length >= limit) break
    }
  }
  return picked
}

export function PlaylistCover({ tracks, cover, name, size = 'card' }: { tracks: Track[]; cover?: string; name: string; size?: 'card' | 'hero' | 'mini' }) {
  const hue = hueFrom(name || 'kinetix')
  const artworks = tracks.map(track => track.artwork).filter((value): value is string => Boolean(value)).slice(0, 4)
  const style = { '--pl-hue': hue, backgroundImage: cover ? `url("${cover.replace(/"/g, '')}")` : undefined } as CSSProperties
  return <div className={`pl-cover pl-cover-${size} ${cover ? 'has-cover' : ''}`} style={style}>
    {!cover && (artworks.length ? <span className="pl-cover-mosaic">{artworks.map((artwork, index) => <i key={`${artwork}-${index}`} style={{ backgroundImage: `url("${artwork.replace(/"/g, '')}")` }}/>)}</span> : <span className="pl-cover-empty"><Music2 size={size === 'hero' ? 48 : size === 'mini' ? 15 : 26}/><em>{name.slice(0, 2).toUpperCase()}</em></span>)}
    <span className="pl-cover-shine"/>
    <span className="pl-cover-orbit"/>
    {size !== 'mini' && <span className="pl-cover-note">♫</span>}
  </div>
}

function PlaylistEditor({ playlist, current, onClose, onSave }: { playlist?: Playlist | null; current: Track | null; onClose: () => void; onSave: (draft: { name: string; description: string; isPublic: boolean; includeCurrent: boolean; cover: string }) => Promise<void> }) {
  const [name, setName] = useState(playlist?.name || '')
  const [description, setDescription] = useState(playlist?.description || '')
  const [isPublic, setIsPublic] = useState(playlist?.isPublic ?? true)
  const [includeCurrent, setIncludeCurrent] = useState(Boolean(current && !playlist))
  const [cover, setCover] = useState(playlist?.cover || '')
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverError, setCoverError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const preview = playlist ? playlist.tracks : includeCurrent && current ? [current] : []
  const artworks = useMemo(() => [...new Set(preview.map(track => track.artwork).filter((value): value is string => Boolean(value)))].slice(0, 8), [playlist, current, includeCurrent])
  async function pickCover(file?: File) {
    if (!file) return
    setCoverBusy(true); setCoverError('')
    try { setCover(await shrinkCover(file)) }
    catch (cause) { setCoverError(cause instanceof Error ? cause.message : 'Не удалось загрузить обложку') }
    finally { setCoverBusy(false) }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Придумай название плейлиста'); return }
    setBusy(true); setError('')
    try { await onSave({ name: trimmed, description: description.trim(), isPublic, includeCurrent, cover }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить плейлист'); setBusy(false) }
  }
  return <div className="modal-backdrop pl-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <form className="pl-editor" role="dialog" aria-modal="true" aria-label={playlist ? 'Настроить плейлист' : 'Создать плейлист'} onSubmit={submit}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть"><X size={20}/></button>
      <div className="pl-editor-visual">
        <span className="pl-editor-orbit"/><span className="pl-editor-orbit second"/>
        <PlaylistCover tracks={preview} cover={cover} name={name || 'Новый плейлист'} size="hero"/>
        <span className="pl-editor-sticker"><Sparkles size={14}/> {playlist ? 'Настройка звука' : 'Новый плейлист'}</span>
        <span className="pl-editor-count">{preview.length ? `${preview.length} ${plural(preview.length, 'трек', 'трека', 'треков')}` : 'Пока пусто'}</span>
      </div>
      <div className="pl-editor-body">
        <span className="pl-eyebrow">KINETIX / ЛИЧНАЯ КОЛЛЕКЦИЯ</span>
        <h2>{playlist ? <>Настрой свой<br/><em>плейлист.</em></> : <>Собери звук<br/><em>под себя.</em></>}</h2>
        <p className="pl-editor-intro">{playlist ? 'Название, описание и видимость можно менять в любой момент.' : 'Дай плейлисту имя — и добавляй треки из поиска, каталогов и плеера.'}</p>
        <label>Название<input value={name} onChange={event => setName(event.target.value)} maxLength={60} autoFocus placeholder="Например: Ночная дорога"/></label>
        <label>Описание<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={200} rows={3} placeholder="Пара слов о настроении этой подборки"/></label>
        <div className="pl-cover-pick">
          <span className="pl-cover-pick-label">Обложка</span>
          <div className="pl-cover-pick-row">
            <button type="button" className="pl-cover-upload" onClick={() => fileRef.current?.click()} disabled={coverBusy}>{coverBusy ? <Loader2 className="spin" size={15}/> : <ImagePlus size={15}/>} {cover ? 'Сменить фото' : 'Загрузить фото'}</button>
            {cover && <button type="button" className="pl-cover-clear" onClick={() => setCover('')}><X size={14}/> Убрать</button>}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; pickCover(file) }}/>
          </div>
          {artworks.length > 0 && <div className="pl-cover-sources"><small>Или из треков</small><div className="pl-cover-source-row">{artworks.map(artwork => <button key={artwork} type="button" className={`pl-cover-source ${cover === artwork ? 'is-active' : ''}`} onClick={() => setCover(artwork)} style={{ backgroundImage: `url("${artwork.replace(/"/g, '')}")` }} aria-label="Использовать обложку трека"/>)}</div></div>}
          {coverError && <small className="pl-cover-error">{coverError}</small>}
        </div>
        <button type="button" className={`pl-visibility ${isPublic ? 'is-public' : ''}`} onClick={() => setIsPublic(value => !value)}>
          <span className="pl-visibility-icon">{isPublic ? <Globe size={17}/> : <Lock size={17}/>}</span>
          <span><strong>{isPublic ? 'Публичный плейлист' : 'Только для меня'}</strong><small>{isPublic ? 'Другие слушатели увидят его в сообществе' : 'Плейлист останется личным'}</small></span>
          <span className="pl-switch"><i/></span>
        </button>
        {current && !playlist && <button type="button" className={`pl-include ${includeCurrent ? 'selected' : ''}`} onClick={() => setIncludeCurrent(value => !value)}><span className="pl-include-check">{includeCurrent ? <Check size={13}/> : <Plus size={13}/>}</span><span><strong>Добавить текущий трек</strong><small>{current.title} · {current.artist}</small></span></button>}
        {error && <div className="form-error">{error}</div>}
        <div className="pl-editor-actions"><button type="button" className="pl-cancel" onClick={onClose}>Отмена</button><button className="primary-btn" disabled={busy}>{busy ? <Loader2 className="spin" size={16}/> : playlist ? <Check size={16}/> : <Sparkles size={16}/>} {playlist ? 'Сохранить' : 'Создать плейлист'} <ArrowRight size={15}/></button></div>
      </div>
    </form>
  </div>
}

export function PlaylistPicker({ track, user, onClose, onUserUpdate, onNotice, onLogin }: { track: Track | null; user: User | null; onClose: () => void; onUserUpdate: (user: User) => void; onNotice: (message: string) => void; onLogin: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const playlists = user?.playlists || []
  if (!track) return null
  async function add(playlist: Playlist) {
    if (!user) { onLogin(); return }
    setBusy(playlist.id); setError('')
    try {
      const result = await request<{ user: User; playlist: Playlist; added: boolean }>(`/api/playlists/${playlist.id}/tracks`, 'POST', { track })
      onUserUpdate(result.user)
      onNotice(result.added ? `Добавлено в «${playlist.name}»` : 'Этот трек уже есть в плейлисте')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось добавить трек') }
    finally { setBusy(null) }
  }
  async function toggle(playlist: Playlist, exists: boolean) {
    if (!user) { onLogin(); return }
    setBusy(playlist.id); setError('')
    try {
      if (!exists) { await add(playlist); return }
      const result = await request<{ user: User; playlist: Playlist }>(`/api/playlists/${playlist.id}/tracks?trackId=${encodeURIComponent(track!.id)}`, 'DELETE')
      onUserUpdate(result.user)
      onNotice(`Трек убран из «${playlist.name}»`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось убрать трек') }
    finally { setBusy(null) }
  }
  async function create(event: FormEvent) {
    event.preventDefault()
    if (!user) { onLogin(); return }
    if (!name.trim()) { setError('Введите название'); return }
    setBusy('new'); setError('')
    try {
      const result = await request<{ user: User; playlist: Playlist }>('/api/playlists', 'POST', { name: name.trim(), isPublic: false, track })
      onUserUpdate(result.user)
      setName('')
      onNotice(`Трек добавлен в «${result.playlist.name}»`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось создать плейлист') }
    finally { setBusy(null) }
  }
  return <div className="modal-backdrop pk-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="pk-modal" role="dialog" aria-modal="true" aria-label="Добавить трек в плейлист">
      <button className="modal-close" onClick={onClose} aria-label="Закрыть"><X size={20}/></button>
      <div className="pk-hero">
        <span className="pk-hero-aurora" aria-hidden="true"/>
        <span className="pk-hero-grid" aria-hidden="true"/>
        <div className="pk-hero-track">
          <span className="pk-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>
            {!track.artwork && <Music2 size={26}/>}
            <span className="pk-art-ring" aria-hidden="true"/>
            <span className="pk-art-pulse" aria-hidden="true"/>
          </span>
          <span className="pk-hero-copy">
            <span className="pk-eyebrow">KINETIX / СОХРАНИТЬ ТРЕК</span>
            <h2>Добавить в <em>плейлист.</em></h2>
            <span className="pk-track-title">{track.title}</span>
            <span className="pk-track-meta"><span>{track.artist}</span><i>{sourceLabel[track.source] || track.source}</i></span>
          </span>
        </div>
        <span className="pk-hero-eq" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties}/>)}</span>
      </div>
      {!user ? <div className="pk-guest">
        <span className="pk-guest-icon"><Lock size={24}/></span>
        <strong>Нужен аккаунт</strong>
        <p>Войди, чтобы собирать плейлисты и добавлять в них треки.</p>
        <button className="primary-btn" onClick={onLogin}>Войти <ArrowRight size={15}/></button>
      </div> : <div className="pk-body">
        <div className="pk-list-head"><span>ТВОИ ПЛЕЙЛИСТЫ</span><em>{playlists.length}</em></div>
        <div className="pk-list">
          {playlists.map(playlist => { const exists = playlist.tracks.some(item => item.id === track.id); return <button key={playlist.id} className={`pk-row ${exists ? 'is-exists' : ''}`} disabled={busy === playlist.id} onClick={() => toggle(playlist, exists)}>
            <PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name} size="mini"/>
            <span className="pk-row-copy"><strong>{playlist.name}</strong><small>{playlist.tracks.length} {plural(playlist.tracks.length, 'трек', 'трека', 'треков')}{playlist.isPublic ? ' · публичный' : ''}</small></span>
            <span className="pk-row-action">{busy === playlist.id ? <Loader2 className="spin" size={16}/> : exists ? <><Check size={15}/> В плейлисте <em>убрать</em></> : <><Plus size={15}/> Добавить</>}</span>
          </button> })}
          {!playlists.length && <div className="pk-empty"><span className="pk-empty-icon"><ListMusic size={22}/></span><p>Плейлистов пока нет.</p><small>Создай первый — трек сразу попадёт в него.</small></div>}
        </div>
        <form className="pk-create" onSubmit={create}>
          <span className="pk-create-icon"><Plus size={16}/></span>
          <input value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="Название нового плейлиста" aria-label="Название нового плейлиста"/>
          <button className="primary-btn" disabled={busy === 'new'}>{busy === 'new' ? <Loader2 className="spin" size={16}/> : <Sparkles size={15}/>} Создать</button>
        </form>
        <p className="pk-create-hint">Новый плейлист будет личным, а трек добавится в него сразу.</p>
        {error && <div className="form-error">{error}</div>}
      </div>}
    </div>
  </div>
}

function PlaylistCard({ playlist, index, onOpen, onPlay }: { playlist: Playlist; index: number; onOpen: () => void; onPlay: () => void }) {
  return <article className={`pl-card ${playlist.isPublic ? 'is-public' : ''}`} style={{ '--i': Math.min(index, 12) } as CSSProperties}>
    <div className="pl-card-cover" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter') onOpen() }}>
      <PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name} size="card"/>
      <span className="pl-card-badge">{playlist.isPublic ? <><Globe size={11}/> ПУБЛИЧНЫЙ</> : <><Lock size={11}/> ЛИЧНЫЙ</>}</span>
      <button className="pl-card-play" onClick={event => { event.stopPropagation(); onPlay() }} aria-label={`Слушать ${playlist.name}`}><Play size={17} fill="currentColor"/></button>
      <span className="pl-card-equalizer" aria-hidden="true"><i/><i/><i/><i/></span>
    </div>
    <div className="pl-card-copy"><strong>{playlist.name}</strong><small>{playlist.tracks.length} {plural(playlist.tracks.length, 'трек', 'трека', 'треков')} · {durationLabel(playlist.tracks)}</small></div>
  </article>
}

function CommunityCard({ playlist, index, onOpen }: { playlist: PlaylistSummary; index: number; onOpen: () => void }) {
  return <article className="pl-card pl-community-card" style={{ '--i': Math.min(index, 12) } as CSSProperties}>
    <div className="pl-card-cover" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter') onOpen() }}>
      <PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name} size="card"/>
      <span className="pl-card-badge"><Globe size={11}/> СООБЩЕСТВО</span>
      <span className="pl-card-play"><ArrowRight size={16}/></span>
    </div>
    <div className="pl-card-copy"><strong>{playlist.name}</strong><small>{playlist.owner.name} · {playlist.trackCount} {plural(playlist.trackCount, 'трек', 'трека', 'треков')}</small></div>
  </article>
}

function suggestionSeeds(tracks: Track[]) {
  const picked: Track[] = []
  const artists = new Set<string>()
  for (const track of tracks) {
    if (!track.title || !track.artist) continue
    const artist = track.artist.toLowerCase().trim()
    if (artists.has(artist)) continue
    artists.add(artist)
    picked.push(track)
    if (picked.length === 3) break
  }
  for (const track of tracks) {
    if (picked.length === 3) break
    if (picked.includes(track) || !track.title || !track.artist) continue
    picked.push(track)
  }
  return picked
}

function PlaylistSuggestions({ playlist, onPlay, onAdd }: { playlist: Playlist; onPlay: (tracks: Track[], index: number) => void; onAdd: (track: Track) => Promise<boolean> }) {
  const [items, setItems] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedIds, setSavedIds] = useState<string[]>([])
  const knownIds = useRef(new Set<string>())
  useEffect(() => {
    const seeds = suggestionSeeds(playlist.tracks)
    knownIds.current = new Set(playlist.tracks.map(track => track.id))
    if (!seeds.length) { setItems([]); setLoading(false); setError(''); return }
    const controller = new AbortController()
    setLoading(true); setError('')
    fetch('/api/recommendations/collection', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tracks: seeds.map(track => ({ id: track.id, title: track.title, artist: track.artist })),
        limit: 14,
        source: 'all',
        refresh: nonce > 0,
        avoid: playlist.tracks.slice(0, 60).map(track => ({ id: track.id, title: track.title, artist: track.artist })),
      }),
      signal: controller.signal,
    })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось подобрать похожие треки'); return data })
      .then(data => {
        if (controller.signal.aborted) return
        const fresh = (Array.isArray(data.tracks) ? data.tracks as Track[] : []).filter(track => track?.id && track.title && track.artist)
        setItems([...new Map(fresh.map(track => [track.id, track])).values()])
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось подобрать похожие треки') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [playlist.id, nonce])
  const visible = items.filter(track => !knownIds.current.has(track.id))
  const queue = [...playlist.tracks, ...visible]
  async function add(track: Track) {
    if (busyId) return
    setBusyId(track.id)
    const ok = await onAdd(track)
    setBusyId(null)
    if (ok) setSavedIds(list => list.includes(track.id) ? list : [...list, track.id])
  }
  return <section className="pl-suggest">
    <div className="pl-suggest-head">
      <div>
        <span className="pl-eyebrow">ПОХОЖЕ НА ЭТОТ ПЛЕЙЛИСТ</span>
        <h2>Рекомендации<i>.</i></h2>
        <p>Похоже на треки из этого плейлиста — добавляй одним нажатием.</p>
      </div>
      <button className="pl-suggest-refresh" onClick={() => setNonce(value => value + 1)} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={14}/> Обновить</button>
    </div>
    {loading ? <div className="pl-suggest-list is-loading">
      {[0, 1, 2, 3].map(index => <div className="pl-suggest-row is-skeleton" key={index}>
        <span className="pl-suggest-art"/>
        <span className="pl-suggest-lines"><i/><i/></span>
        <span className="pl-suggest-pill"/>
      </div>)}
    </div> : error ? <div className="pl-suggest-error">
      <span><Sparkles size={16}/></span>
      <div><strong>Рекомендации не загрузились</strong><small>{error}</small></div>
      <button onClick={() => setNonce(value => value + 1)}>Повторить</button>
    </div> : visible.length ? <div className="pl-suggest-list">
      {visible.map((track, index) => {
        const saved = savedIds.includes(track.id)
        const busy = busyId === track.id
        return <div className={`pl-suggest-row ${saved ? 'is-saved' : ''}`} key={track.id}>
          <span className="pl-suggest-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && <Music2 size={15}/>}</span>
          <button className="pl-suggest-main" onClick={() => onPlay(queue, playlist.tracks.length + index)} aria-label={`Слушать ${track.title}`}>
            <strong>{track.title}</strong>
            <small>{track.artist}</small>
          </button>
          <span className="pl-suggest-meta">{sourceLabel[track.source] || track.source}</span>
          <button className={`pl-suggest-add ${saved ? 'is-added' : ''}`} onClick={() => void add(track)} disabled={saved || busy}>
            {busy ? <Loader2 className="spin" size={13}/> : saved ? <Check size={13}/> : <Plus size={13}/>}
            <span>{saved ? 'Добавлено' : busy ? 'Добавляем' : 'Добавить'}</span>
          </button>
        </div>
      })}
    </div> : <p className="pl-suggest-empty">Пока не удалось подобрать похожее. Добавь ещё пару треков — и попробуем снова.</p>}
  </section>
}

function PlaylistDetail({ playlist, current, playing, onBack, onPlay, onShuffle, onEdit, onDelete, onRemove, onReorder, onAddCurrent, onAddTrack, onSearchMusic }: {
  playlist: Playlist
  current: Track | null
  playing: boolean
  onBack: () => void
  onPlay: (tracks: Track[], index: number) => void
  onShuffle: (tracks: Track[]) => void
  onEdit: () => void
  onDelete: () => void
  onRemove: (trackId: string) => Promise<void>
  onReorder: (order: string[]) => Promise<void>
  onAddCurrent: () => Promise<void>
  onAddTrack: (track: Track) => Promise<boolean>
  onSearchMusic: () => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const hasCurrent = Boolean(current && playlist.tracks.some(track => track.id === current.id))
  function drop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return }
    const order = playlist.tracks.map(track => track.id)
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    if (from < 0 || to < 0) return
    order.splice(to, 0, order.splice(from, 1)[0])
    setDragId(null); setOverId(null)
    onReorder(order)
  }
  async function remove(trackId: string) { setRemoving(trackId); try { await onRemove(trackId) } finally { setRemoving(null) } }
  async function addCurrent() { setAdding(true); try { await onAddCurrent() } finally { setAdding(false) } }
  return <section className="pl-detail page-section">
    <button className="catalog-back" onClick={onBack}><ArrowLeft size={16}/> Все плейлисты</button>
    <div className="pl-hero">
      <span className="pl-hero-glow"/><span className="pl-hero-rings"/>
      <PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name} size="hero"/>
      <div className="pl-hero-copy">
        <span className="pl-eyebrow">ПЛЕЙЛИСТ / {playlist.isPublic ? 'ПУБЛИЧНЫЙ' : 'ЛИЧНЫЙ'}</span>
        <h1>{playlist.name}<i>.</i></h1>
        <p>{playlist.description || 'Твой личный поток — добавляй треки и возвращайся в нужное настроение.'}</p>
        <div className="pl-hero-meta">
          <span><ListMusic size={14}/>{playlist.tracks.length} {plural(playlist.tracks.length, 'трек', 'трека', 'треков')}</span>
          <span><Clock size={14}/>{durationLabel(playlist.tracks)}</span>
          <span>{playlist.isPublic ? <Globe size={14}/> : <Lock size={14}/>}{playlist.isPublic ? 'Виден в сообществе' : 'Только для тебя'}</span>
        </div>
      </div>
      <div className="pl-hero-actions">
        <button className="primary-btn" onClick={() => onPlay(playlist.tracks, 0)} disabled={!playlist.tracks.length}><Play size={17} fill="currentColor"/> Слушать всё</button>
        <button className="pl-ghost" onClick={() => onShuffle(playlist.tracks)} disabled={!playlist.tracks.length}><Shuffle size={16}/> Умный шафл</button>
        <button className="pl-icon-btn" onClick={onEdit} aria-label="Изменить плейлист" title="Изменить"><Pencil size={16}/></button>
        <button className={`pl-icon-btn ${confirmDelete ? 'is-danger' : ''}`} onClick={() => { if (confirmDelete) onDelete(); else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3200) } }} aria-label="Удалить плейлист" title={confirmDelete ? 'Нажмите ещё раз' : 'Удалить'}>{confirmDelete ? 'Удалить?' : <Trash2 size={16}/>}</button>
      </div>
    </div>
    {current && !hasCurrent && <button className="pl-add-current" onClick={addCurrent} disabled={adding}>{adding ? <Loader2 className="spin" size={15}/> : <Plus size={15}/>} Добавить «{current.title}» в этот плейлист</button>}
    {playlist.tracks.length ? <div className="pl-tracklist">
      <div className="pl-tracklist-head"><span>ТРЕК</span><span>ВРЕМЯ</span><span/></div>
      {playlist.tracks.map((track, index) => { const active = current?.id === track.id; return <div key={track.id} className={`pl-track ${active ? 'is-playing' : ''} ${overId === track.id ? 'is-over' : ''} ${dragId === track.id ? 'is-dragging' : ''}`} draggable onDragStart={() => setDragId(track.id)} onDragOver={event => { event.preventDefault(); setOverId(track.id) }} onDragLeave={() => setOverId(null)} onDrop={event => { event.preventDefault(); drop(track.id) }} onDragEnd={() => { setDragId(null); setOverId(null) }}>
        <span className="pl-track-handle"><GripVertical size={15}/></span>
        <button className="pl-track-main" onClick={() => onPlay(playlist.tracks, index)}>
          <span className="pl-track-index">{active && playing ? <span className="equalizer"><i/><i/><i/></span> : String(index + 1).padStart(2, '0')}</span>
          <span className="pl-track-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && <Music2 size={15}/>}</span>
          <span className="pl-track-copy"><strong>{track.title}</strong><small>{track.artist} · {sourceLabel[track.source] || track.source}</small></span>
        </button>
        <span className="pl-track-time">{track.duration ? stamp(track.duration) : '—:—'}</span>
        <button className="pl-track-remove" onClick={() => remove(track.id)} disabled={removing === track.id} aria-label={`Убрать ${track.title}`} title="Убрать из плейлиста">{removing === track.id ? <Loader2 className="spin" size={15}/> : <X size={15}/>}</button>
      </div> })}
    </div> : <div className="pl-empty"><div className="pl-empty-disc"><Music2 size={28}/></div><h3>Плейлист пока пуст.</h3><p>Добавь треки из поиска или прямо из плеера — и он оживёт.</p><button className="primary-btn" onClick={onSearchMusic}>Найти треки <ArrowRight size={15}/></button></div>}
    {playlist.tracks.length > 0 && <PlaylistSuggestions playlist={playlist} onPlay={onPlay} onAdd={onAddTrack}/>}
  </section>
}

function ExternalDetail({ playlist, current, playing, saving, canSave, onBack, onPlay, onShuffle, onSave, onLogin }: { playlist: ExternalPlaylist; current: Track | null; playing: boolean; saving: boolean; canSave: boolean; onBack: () => void; onPlay: (tracks: Track[], index: number) => void; onShuffle: (tracks: Track[]) => void; onSave: () => void; onLogin: () => void }) {
  return <section className="pl-detail page-section">
    <button className="catalog-back" onClick={onBack}><ArrowLeft size={16}/> Назад к поиску</button>
    <div className="pl-hero pl-hero-external">
      <span className="pl-hero-glow"/>
      {playlist.artwork ? <div className="pl-ext-hero-cover" style={{ backgroundImage: `url("${playlist.artwork.replace(/"/g, '')}")` }}/> : <PlaylistCover tracks={playlist.tracks} name={playlist.title} size="hero"/>}
      <div className="pl-hero-copy">
        <span className="pl-eyebrow">ЧУЖОЙ ПЛЕЙЛИСТ / {playlist.source === 'kinetix' ? 'KINETIX' : playlist.source === 'soundcloud' ? 'SOUNDCLOUD' : 'YOUTUBE'}</span>
        <h1>{playlist.title}<i>.</i></h1>
        <p>{playlist.description || `Подборка от ${playlist.owner}. Слушай или сохрани к себе одним движением.`}</p>
        <div className="pl-hero-meta">
          <span><ListMusic size={14}/>{playlist.tracks.length} {plural(playlist.tracks.length, 'трек', 'трека', 'треков')}</span>
          <span><Clock size={14}/>{durationLabel(playlist.tracks)}</span>
          <span><Globe size={14}/>{playlist.owner}</span>
        </div>
      </div>
      <div className="pl-hero-actions">
        <button className="primary-btn" onClick={() => onPlay(playlist.tracks, 0)} disabled={!playlist.tracks.length}><Play size={17} fill="currentColor"/> Слушать</button>
        <button className="pl-ghost" onClick={() => onShuffle(playlist.tracks)} disabled={!playlist.tracks.length}><Shuffle size={16}/> Перемешать</button>
        <button className="pl-save-external" onClick={canSave ? onSave : onLogin} disabled={saving}>{saving ? <Loader2 className="spin" size={16}/> : <Copy size={16}/>} {canSave ? 'Сохранить себе' : 'Войти и сохранить'}</button>
        {playlist.url && <a className="pl-icon-btn" href={playlist.url} target="_blank" rel="noreferrer" aria-label="Открыть источник" title="Открыть источник"><ExternalLink size={16}/></a>}
      </div>
    </div>
    {playlist.tracks.length ? <div className="pl-tracklist">
      <div className="pl-tracklist-head"><span>ТРЕК</span><span>ВРЕМЯ</span><span/></div>
      {playlist.tracks.map((track, index) => { const active = current?.id === track.id; return <div key={track.id} className={`pl-track pl-track-external ${active ? 'is-playing' : ''}`}>
        <span className="pl-track-handle"><span className="source-dot"/></span>
        <button className="pl-track-main" onClick={() => onPlay(playlist.tracks, index)}><span className="pl-track-index">{active && playing ? <span className="equalizer"><i/><i/><i/></span> : String(index + 1).padStart(2, '0')}</span><span className="pl-track-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && <Music2 size={15}/>}</span><span className="pl-track-copy"><strong>{track.title}</strong><small>{track.artist} · {sourceLabel[track.source] || track.source}</small></span></button>
        <span className="pl-track-time">{track.duration ? stamp(track.duration) : '—:—'}</span>
        <span/>
      </div> })}
    </div> : <div className="pl-empty"><div className="pl-empty-disc"><Music2 size={28}/></div><h3>Здесь нет воспроизводимых треков.</h3><p>Попробуй другой плейлист или вставь другую ссылку.</p><button className="primary-btn" onClick={onBack}>Вернуться к поиску</button></div>}
  </section>
}

export function PlaylistsView({ user, current, playing, seedTracks, focus, onUserUpdate, onPlayTracks, onNotice, onLogin, onSearchMusic }: {
  user: User | null
  current: Track | null
  playing: boolean
  seedTracks: Track[]
  focus?: { id: string; nonce: number } | null
  onUserUpdate: (user: User) => void
  onPlayTracks: (tracks: Track[], index?: number) => void
  onNotice: (message: string) => void
  onLogin: () => void
  onSearchMusic: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [external, setExternal] = useState<ExternalPlaylist | null>(null)
  const [editor, setEditor] = useState<Playlist | 'new' | null>(null)
  const [extQuery, setExtQuery] = useState('')
  const [extResults, setExtResults] = useState<ExternalPlaylistSummary[]>([])
  const [extLoading, setExtLoading] = useState(false)
  const [extError, setExtError] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [savingExternal, setSavingExternal] = useState(false)
  const [community, setCommunity] = useState<PlaylistSummary[]>([])
  const [mixSeed, setMixSeed] = useState(0)
  const discoverRef = useRef<HTMLDivElement>(null)
  const playlists = user?.playlists || []
  const selected = selectedId ? playlists.find(playlist => playlist.id === selectedId) || null : null
  const mix = useMemo(() => artistDiverse(seedTracks, 18, daySeed() + mixSeed * 104729), [seedTracks, mixSeed])
  useEffect(() => { if (focus?.id) { setSelectedId(focus.id); setExternal(null) } }, [focus?.nonce])
  useEffect(() => { if (!selectedId) return; if (!playlists.some(playlist => playlist.id === selectedId)) setSelectedId(null) }, [playlists.length, selectedId])
  useEffect(() => {
    if (!user) { setCommunity([]); return }
    let active = true
    fetch('/api/playlists/discover').then(response => response.json()).then(data => { if (active) setCommunity((data.playlists || []).filter((item: PlaylistSummary) => !playlists.some(own => own.id === item.id))) }).catch(() => {})
    return () => { active = false }
  }, [user?.id, playlists.length])
  function smartShuffle(tracks: Track[]) { onPlayTracks(artistDiverse(tracks, tracks.length, Date.now()), 0) }
  async function createOrUpdate(draft: { name: string; description: string; isPublic: boolean; includeCurrent: boolean; cover: string }) {
    if (!user) { onLogin(); return }
    if (editor && editor !== 'new') {
      const result = await request<{ user: User; playlist: Playlist }>(`/api/playlists/${editor.id}`, 'PATCH', { name: draft.name, description: draft.description, isPublic: draft.isPublic, cover: draft.cover })
      onUserUpdate(result.user); setEditor(null); onNotice('Плейлист обновлён')
      return
    }
    const result = await request<{ user: User; playlist: Playlist }>('/api/playlists', 'POST', { name: draft.name, description: draft.description, isPublic: draft.isPublic, cover: draft.cover, track: draft.includeCurrent && current ? current : undefined })
    onUserUpdate(result.user); setEditor(null); setSelectedId(result.playlist.id); setExternal(null); onNotice('Плейлист создан')
  }
  async function deleteSelected() {
    if (!selected) return
    try { const result = await request<{ user: User }>(`/api/playlists/${selected.id}`, 'DELETE'); onUserUpdate(result.user); setSelectedId(null); onNotice('Плейлист удалён') }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Не удалось удалить плейлист') }
  }
  async function removeTrack(trackId: string) {
    if (!selected) return
    try { const result = await request<{ user: User; playlist: Playlist }>(`/api/playlists/${selected.id}/tracks?trackId=${encodeURIComponent(trackId)}`, 'DELETE'); onUserUpdate(result.user); onNotice('Трек убран из плейлиста') }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Не удалось убрать трек') }
  }
  async function reorder(order: string[]) {
    if (!selected) return
    try { const result = await request<{ user: User; playlist: Playlist }>(`/api/playlists/${selected.id}`, 'PATCH', { order }); onUserUpdate(result.user) }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Не удалось изменить порядок') }
  }
  async function addCurrent() {
    if (!selected || !current) return
    try { const result = await request<{ user: User; playlist: Playlist; added: boolean }>(`/api/playlists/${selected.id}/tracks`, 'POST', { track: current }); onUserUpdate(result.user); onNotice(result.added ? 'Трек добавлен в плейлист' : 'Трек уже в плейлисте') }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Не удалось добавить трек') }
  }
  async function addTrack(track: Track) {
    if (!selected) return false
    try {
      const result = await request<{ user: User; playlist: Playlist; added: boolean }>(`/api/playlists/${selected.id}/tracks`, 'POST', { track })
      onUserUpdate(result.user)
      onNotice(result.added ? `«${track.title}» добавлен в плейлист` : `«${track.title}» уже в плейлисте`)
      return true
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : 'Не удалось добавить трек')
      return false
    }
  }
  async function saveMix() {
    if (!user) { onLogin(); return }
    if (!mix.length) return
    try { const result = await request<{ user: User; playlist: Playlist }>('/api/playlists', 'POST', { name: `Микс дня · ${dayLabel()}`.slice(0, 60), description: 'Автоматический микс из твоих треков, любимых исполнителей и последних находок.', isPublic: false, tracks: mix }); onUserUpdate(result.user); setSelectedId(result.playlist.id); setExternal(null); onNotice('Микс дня сохранён в плейлисты') }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Не удалось сохранить микс') }
  }
  async function runExternalSearch(value = extQuery) {
    const query = value.trim()
    if (!query) return
    setExtLoading(true); setExtError('')
    try {
      const response = await fetch(`/api/playlist-search?q=${encodeURIComponent(query)}&limit=9`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось найти плейлисты')
      setExtResults(data.playlists || [])
    } catch (cause) { setExtError(cause instanceof Error ? cause.message : 'Не удалось найти плейлисты') }
    finally { setExtLoading(false) }
  }
  async function importExternal(value = importUrl) {
    const target = value.trim()
    if (!target) return
    setImporting(true); setExtError('')
    try {
      const response = await fetch(`/api/playlist-import?url=${encodeURIComponent(target)}&limit=80`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось открыть плейлист')
      setExternal(data.playlist); setImportUrl('')
    } catch (cause) { setExtError(cause instanceof Error ? cause.message : 'Не удалось открыть плейлист') }
    finally { setImporting(false) }
  }
  async function openExternal(item: ExternalPlaylistSummary) {
    setOpeningId(item.id); setExtError('')
    try { await importExternal(item.url) }
    finally { setOpeningId(null) }
  }
  async function openCommunity(item: PlaylistSummary) {
    setOpeningId(item.id); setExtError('')
    try {
      const response = await fetch(`/api/playlists/public/${item.id}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Плейлист не найден')
      setExternal({ id: data.playlist.id, source: 'kinetix', title: data.playlist.name, owner: data.owner?.name || item.owner.name, artwork: data.playlist.cover, url: '', trackCount: data.playlist.tracks.length, description: data.playlist.description, isPublic: true, tracks: data.playlist.tracks })
    } catch (cause) { setExtError(cause instanceof Error ? cause.message : 'Не удалось открыть плейлист') }
    finally { setOpeningId(null) }
  }
  async function saveExternalPlaylist() {
    if (!user) { onLogin(); return }
    if (!external) return
    setSavingExternal(true)
    try {
      let result: { user: User; playlist: Playlist }
      if (external.source === 'kinetix' && external.id) result = await request<{ user: User; playlist: Playlist }>(`/api/playlists/${external.id}/copy`, 'POST')
      else result = await request<{ user: User; playlist: Playlist }>('/api/playlists', 'POST', { name: external.title.slice(0, 60), description: `Импортировано · ${external.owner}`.slice(0, 200), isPublic: false, tracks: external.tracks })
      onUserUpdate(result.user); setExternal(null); setSelectedId(result.playlist.id); onNotice('Чужой плейлист сохранён к тебе')
    } catch (cause) { onNotice(cause instanceof Error ? cause.message : 'Не удалось сохранить плейлист') }
    finally { setSavingExternal(false) }
  }
  function scrollToDiscover() { discoverRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  function openCreate() { if (!user) { onLogin(); return } setEditor('new') }

  if (selected) return <>
    <PlaylistDetail key={selected.id} playlist={selected} current={current} playing={playing} onBack={() => setSelectedId(null)} onPlay={(tracks, index) => onPlayTracks(tracks, index)} onShuffle={smartShuffle} onEdit={() => setEditor(selected)} onDelete={deleteSelected} onRemove={removeTrack} onReorder={reorder} onAddCurrent={addCurrent} onAddTrack={addTrack} onSearchMusic={onSearchMusic}/>
    <Presence open={Boolean(editor)}>{editor && <PlaylistEditor playlist={editor === 'new' ? null : editor} current={current} onClose={() => setEditor(null)} onSave={createOrUpdate}/>}</Presence>
  </>
  if (external) return <>
    <ExternalDetail playlist={external} current={current} playing={playing} saving={savingExternal} canSave={Boolean(user)} onBack={() => setExternal(null)} onPlay={(tracks, index) => onPlayTracks(tracks, index)} onShuffle={smartShuffle} onSave={saveExternalPlaylist} onLogin={onLogin}/>
  </>

  return <section className="pl-page page-section">
    <div className="pl-topline"><div><div className="page-kicker">KINETIX / ПЛЕЙЛИСТЫ</div><span className="pl-topline-note">СВОИ И ЧУЖИЕ · В ОДНОМ МЕСТЕ</span></div><button className="pl-create-btn" onClick={openCreate}><Plus size={17}/> Создать плейлист</button></div>
    <div className="pl-landing-hero">
      <span className="pl-landing-glow"/>
      <div className="pl-landing-copy">
        <span className="pl-eyebrow">СОБЕРИ СВОЙ ЗВУК</span>
        <h1>Плейлисты,<br/><em>которые живут с тобой.</em></h1>
        <p>Создавай свои подборки, находи чужие на YouTube и сохраняй их одной кнопкой. Всё, что цепляет — в одном потоке.</p>
        <div className="pl-landing-actions"><button className="primary-btn" onClick={openCreate}><Plus size={17}/> Новый плейлист</button><button className="pl-ghost" onClick={scrollToDiscover}>Найти чужие <ArrowRight size={15}/></button></div>
        <div className="pl-landing-stats"><span><strong>{playlists.length}</strong>своих</span><span><strong>{community.length}</strong>в сообществе</span><span><strong>∞</strong>идей</span></div>
      </div>
      <div className="pl-landing-art" aria-hidden="true">
        <span className="pl-landing-orbit orbit-a"/><span className="pl-landing-orbit orbit-b"/>
        <span className="pl-landing-disc disc-a"/><span className="pl-landing-disc disc-b"/><span className="pl-landing-disc disc-c"/>
        <span className="pl-landing-note note-a">♫</span><span className="pl-landing-note note-b">♪</span><span className="pl-landing-note note-c">✦</span>
        <div className={`pl-stack ${playlists.length ? '' : 'is-empty'}`}>{playlists.slice(0, 3).map((playlist, index) => <span className={`pl-stack-card stack-${index}`} key={playlist.id}><PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name} size="card"/></span>)}{!playlists.length && <span className="pl-stack-card stack-0"><PlaylistCover tracks={mix} name="Kinetix Mix" size="card"/></span>}</div>
      </div>
    </div>
    <section className="pl-mix">
      <span className="pl-mix-aurora"/><span className="pl-mix-rings"/>
      <div className="pl-mix-cover"><PlaylistCover tracks={mix} name={`Микс дня ${dayLabel()}`} size="hero"/><span className="pl-mix-vinyl"/><span className="pl-mix-badge"><Sparkles size={12}/> ЖИВОЙ МИКС</span></div>
      <div className="pl-mix-copy">
        <span className="pl-eyebrow">КАЖДЫЙ ДЕНЬ НОВЫЙ / {dayLabel().toUpperCase()}</span>
        <h2>Микс дня<i>.</i></h2>
        <p>{mix.length ? 'Собран из твоих любимых треков, медиатеки и последних находок. Порядок меняется каждый день.' : 'Добавь любимые треки или найди что-то новое — и здесь появится персональный микс.'}</p>
        <div className="pl-mix-chips">{mix.slice(0, 4).map(track => <span key={track.id}>{track.title}</span>)}{!mix.length && <span>Пока тихо</span>}</div>
        <div className="pl-mix-actions"><button className="primary-btn" onClick={() => onPlayTracks(mix, 0)} disabled={!mix.length}><Play size={16} fill="currentColor"/> Слушать микс</button><button className="pl-ghost" onClick={() => setMixSeed(value => value + 1)}><Shuffle size={15}/> Перемешать</button>{mix.length > 0 && <button className="pl-ghost" onClick={saveMix}><Sparkles size={15}/> Сохранить</button>}</div>
      </div>
    </section>
    <section className="pl-mine">
      <div className="section-heading pl-heading"><div><span className="section-kicker">ТВОЯ КОЛЛЕКЦИЯ</span><h2>Мои плейлисты <span className="heading-star">✳</span></h2></div>{playlists.length > 0 && <span className="pl-count">{playlists.length} {plural(playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}</span>}</div>
      {!user ? <div className="pl-guest"><span className="pl-guest-icon"><Lock size={22}/></span><div><h3>Свои плейлисты начинаются здесь.</h3><p>Войди в аккаунт, чтобы собирать треки в подборки и находить чужие.</p></div><button className="primary-btn" onClick={onLogin}>Войти <ArrowRight size={15}/></button></div> : playlists.length ? <div className="pl-grid">{playlists.map((playlist, index) => <PlaylistCard key={playlist.id} playlist={playlist} index={index} onOpen={() => setSelectedId(playlist.id)} onPlay={() => onPlayTracks(playlist.tracks, 0)}/>)}<button className="pl-card pl-card-new" onClick={openCreate}><span className="pl-card-new-inner"><span className="pl-card-new-icon"><Plus size={26}/></span><strong>Создать ещё</strong><small>Новый плейлист</small></span></button></div> : <div className="pl-empty pl-empty-wide"><div className="pl-empty-orbit"><ListMusic size={30}/></div><h3>Первый плейлист — самый важный.</h3><p>Собери треки под настроение, дорогу или вечер. Начни с одного — дальше всё пойдёт само.</p><button className="primary-btn" onClick={openCreate}>Создать плейлист <ArrowRight size={15}/></button></div>}
    </section>
    {community.length > 0 && <section className="pl-community"><div className="section-heading pl-heading"><div><span className="section-kicker">ОТКРЫТО ДЛЯ ВСЕХ</span><h2>Плейлисты сообщества <span className="heading-star">✳</span></h2></div><span className="pl-count">{community.length} {plural(community.length, 'подборка', 'подборки', 'подборок')}</span></div><div className="pl-grid">{community.map((playlist, index) => <CommunityCard key={playlist.id} playlist={playlist} index={index} onOpen={() => openCommunity(playlist)}/>)}</div></section>}
    <section className="pl-discover" ref={discoverRef}>
      <div className="pl-discover-head"><span className="pl-eyebrow">ЧУЖИЕ ПЛЕЙЛИСТЫ</span><h2>Найди чужой вайб<i>.</i></h2><p>Ищи готовые подборки на YouTube или вставь ссылку на плейлист. Понравился — сохрани к себе со всеми треками.</p></div>
      <form className="pl-search" onSubmit={event => { event.preventDefault(); runExternalSearch() }}><Search size={19}/><input value={extQuery} onChange={event => setExtQuery(event.target.value)} placeholder="phonk, russian doomer, lo-fi, night drive…" aria-label="Поиск чужих плейлистов"/><button className="primary-btn" disabled={extLoading}>{extLoading ? <Loader2 className="spin" size={16}/> : <Search size={16}/>} Искать</button></form>
      <div className="pl-suggestions"><span>ПОПРОБУЙ</span>{['phonk', 'russian doomer', 'lo-fi', 'night drive', 'кишлак', 'indie'].map(value => <button key={value} onClick={() => { setExtQuery(value); runExternalSearch(value) }}>{value}</button>)}</div>
      {extLoading && <div className="pl-ext-loading"><span className="pl-loading-orbit"><Loader2 className="spin" size={20}/></span><div><strong>Собираем чужие плейлисты…</strong><small>YouTube иногда отвечает не сразу</small></div></div>}
      {extError && <div className="pl-ext-error"><span><X size={16}/></span><div><strong>Не получилось</strong><small>{extError}</small></div><button onClick={() => setExtError('')} aria-label="Закрыть"><X size={15}/></button></div>}
      {extResults.length > 0 && <div className="pl-ext-grid">{extResults.map((item, index) => <article className="pl-ext-card" key={item.id} style={{ '--i': Math.min(index, 12) } as CSSProperties}>
        <button className="pl-ext-cover" onClick={() => openExternal(item)} aria-label={`Открыть ${item.title}`}>
          {item.artwork ? <img src={item.artwork} alt="" loading="lazy" referrerPolicy="no-referrer"/> : <span className="pl-ext-placeholder"><Globe size={30}/></span>}
          <span className="pl-ext-source">YouTube</span>
          <span className="pl-ext-open">{openingId === item.id ? <Loader2 className="spin" size={17}/> : <Play size={17} fill="currentColor"/>}</span>
        </button>
        <div className="pl-ext-copy"><strong>{item.title}</strong><small>{item.owner}</small><span>{item.trackCount ? `${item.trackCount} треков` : 'плейлист YouTube'} <ArrowRight size={12}/></span></div>
      </article>)}</div>}
      <div className="pl-import">
        <div className="pl-import-copy"><span className="pl-import-icon"><Link2 size={20}/></span><div><strong>Есть ссылка?</strong><small>YouTube playlist или SoundCloud set — вставь и открой.</small></div></div>
        <form onSubmit={event => { event.preventDefault(); importExternal() }}><input value={importUrl} onChange={event => setImportUrl(event.target.value)} placeholder="https://www.youtube.com/playlist?list=…" aria-label="Ссылка на чужой плейлист"/><button className="primary-btn" disabled={importing}>{importing ? <Loader2 className="spin" size={16}/> : <Link2 size={16}/>} Импортировать</button></form>
      </div>
    </section>
    {(extLoading || importing || openingId) && <div className="pl-loading-veil"><span className="pl-loading-orbit"><Loader2 className="spin" size={22}/></span><strong>{openingId ? 'Открываем плейлист…' : 'Собираем треки…'}</strong><small>Обычно это занимает несколько секунд</small></div>}
    <Presence open={Boolean(editor)}>{editor && <PlaylistEditor playlist={editor === 'new' ? null : editor} current={current} onClose={() => setEditor(null)} onSave={createOrUpdate}/>}</Presence>
  </section>
}
