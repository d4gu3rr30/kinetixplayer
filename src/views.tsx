import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { ArrowRight, AudioLines, Check, ChevronDown, Clock, Disc3, Folder, FolderPlus, Guitar, Headphones, Heart, History, Layers, Library, ListMusic, Loader2, MessageCircle, Mic2, Moon, Music2, Orbit, Play, Plus, Radio, RefreshCw, Search, Shuffle, Sparkles, Trash2, TrendingUp, Upload, Video, Waves, X, Zap } from 'lucide-react'
import { ArtistFace } from './artistFace'
import { artistById, genres, type Genre } from './catalog'
import { featuredCatalogEntries, type CatalogEntry } from './catalogData'
import { aggregateArtists, formatListenTime, totalListen, type ListenStats, type TrackListenEntry } from './listening'
import { PlaylistCover } from './playlists'
import { RecapBanner } from './recapView'
import { WeeklyPulse } from './weeklyPulse'
import type { User } from './account'
import type { Track } from './types'
import { isAndroid } from './platform'

export type SearchSource = 'all' | 'youtube' | 'yandex' | 'vk'
export const ALL_SOURCES: SearchSource[] = ['all', 'youtube', 'yandex', 'vk']

const sourceIcons = { all: Layers, youtube: Video, yandex: Music2, vk: MessageCircle }
const sourceLabels: Record<SearchSource, string> = { all: 'Все источники', youtube: 'YouTube', yandex: 'Яндекс Музыка', vk: 'ВКонтакте' }
export const sourceLabel = (id: SearchSource) => sourceLabels[id]
export function sourceHint(id: SearchSource, yandexFull: boolean, youtubeDl: boolean, available: SearchSource[] = ALL_SOURCES) {
  if (id === 'youtube') return youtubeDl ? 'Полные треки из YouTube — без рекламы и видео' : 'Нужен yt-dlp: без него YouTube не отдаст звук'
  if (id === 'yandex') return yandexFull ? 'Полные треки с твоим токеном Яндекс Музыки' : 'Без токена Яндекс отдаёт 30-секундные превью'
  if (id === 'vk') return 'Поиск через твой токен ВКонтакте'
  const names = available.filter(source => source !== 'all').map(source => sourceLabels[source])
  if (!names.length) return 'Выбери доступный источник'
  if (names.length === 1) return `${names[0]} — единственный доступный источник`
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]} сразу`
}
export function usableSources({ vkEnabled, vkIssue = '', youtubeDl = true }: { vkEnabled: boolean; vkIssue?: string; youtubeDl?: boolean }): SearchSource[] {
  return ALL_SOURCES.filter(id => id === 'all' || (id === 'youtube' ? youtubeDl : id === 'vk' ? vkEnabled && !vkIssue.trim() : !isAndroid))
}

export function SourcePicker({ value, onChange, available, yandexFull, youtubeDl, vkIssue = '', label = 'ИСТОЧНИК', compact = false, inline = false }: {
  value: SearchSource
  onChange: (value: SearchSource) => void
  available: SearchSource[]
  yandexFull: boolean
  youtubeDl: boolean
  vkIssue?: string
  label?: string
  compact?: boolean
  inline?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [placed, setPlaced] = useState({ shift: 0, up: false })
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  useLayoutEffect(() => {
    if (!open || inline) { setPlaced({ shift: 0, up: false }); return }
    const place = () => {
      const menu = menuRef.current
      const trigger = wrapRef.current?.querySelector<HTMLElement>('.src-trigger')
      const picker = wrapRef.current
      if (!menu || !trigger || !picker) return
      const pad = 12
      const width = menu.offsetWidth
      const space = picker.getBoundingClientRect()
      const triggerRect = trigger.getBoundingClientRect()
      const base = compact ? space.right - width : space.left
      const shift = base < pad ? pad - base : base + width > window.innerWidth - pad ? window.innerWidth - pad - width - base : 0
      const height = menu.offsetHeight
      const fitsBelow = triggerRect.bottom + 8 + height <= window.innerHeight - pad
      const fitsAbove = triggerRect.top - 8 - height >= pad
      setPlaced(current => current.shift === shift && current.up === (!fitsBelow && fitsAbove) ? current : { shift, up: !fitsBelow && fitsAbove })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, inline, compact])
  const ActiveIcon = sourceIcons[value]
  return <div className={`src-picker ${compact ? 'is-compact' : ''} ${inline ? 'is-inline' : ''}`} ref={wrapRef}>
    <span className="src-picker-label">{label}</span>
    <button type="button" className={`src-trigger is-${value} ${open ? 'is-open' : ''}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(state => !state)}>
      <span className="src-icon"><ActiveIcon size={15}/></span>
      <span className="src-trigger-label">{sourceLabels[value]}</span>
      <ChevronDown size={14} className="src-chevron"/>
    </button>
    {open && <div className={`src-menu ${placed.up ? 'is-up' : ''}`} role="listbox" aria-label="Источник поиска" ref={menuRef} style={placed.shift ? ({ '--src-shift': `${placed.shift}px` } as CSSProperties) : undefined}>
      <div className="src-menu-head">ОТКУДА БЕРЁМ ТРЕКИ</div>
      {available.map(id => {
        const Icon = sourceIcons[id]
        const active = id === value
        const issue = id === 'vk' ? vkIssue : ''
        const warn = (id === 'youtube' && !youtubeDl) || (id === 'yandex' && !yandexFull) || Boolean(issue)
        return <button key={id} type="button" role="option" aria-selected={active} className={`src-option ${active ? 'is-active' : ''} ${warn ? 'is-warn' : ''}`} onClick={() => { onChange(id); setOpen(false) }}>
          <span className="src-option-icon"><Icon size={16}/></span>
          <span className="src-option-copy"><strong>{sourceLabels[id]}</strong><small>{issue || sourceHint(id, yandexFull, youtubeDl, available)}</small></span>
          <span className="src-option-check">{active ? <Check size={14}/> : warn ? <i/> : null}</span>
        </button>
      })}
    </div>}
  </div>
}

// Carousel timers keep running (and re-rendering) even when scrolled far away.
// Watching visibility lets them rest until the block is actually on screen.
function useInView<T extends HTMLElement>(ref: RefObject<T | null>, onChange: (value: boolean) => void) {
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => { for (const entry of entries) onChange(entry.isIntersecting) }, { rootMargin: '140px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, onChange])
}

export function GenreShowcase({ onGenre }: { onGenre: (genre: Genre) => void }) {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [still, setStill] = useState(false)
  const [inView, setInView] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off') }, [])
  useInView(rootRef, setInView)
  useEffect(() => {
    if (still || paused || !inView) return
    const timer = setInterval(() => setActive(value => (value + 1) % genres.length), 4200)
    return () => clearInterval(timer)
  }, [still, paused, inView])
  const genre = genres[active]
  const total = String(genres.length).padStart(2, '0')
  return <div className="gs" ref={rootRef} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
    <button className="gs-stage" style={{ '--gs-tint': genre.tint } as CSSProperties} onClick={() => onGenre(genre)} aria-label={`Открыть жанр «${genre.label}»`}>
      <span className="gs-aurora" aria-hidden="true"/>
      <span className="gs-mesh" aria-hidden="true"/>
      <span className="gs-count">{String(active + 1).padStart(2, '0')} / {total}</span>
      <span className="gs-disc" aria-hidden="true"><GenreIcon id={genre.id} size={54}/></span>
      <span className="gs-copy">
        <span className="gs-kicker">ЖАНР / {genre.label.toUpperCase()}</span>
        <strong className="gs-title">{genre.label}<i>.</i></strong>
        <span className="gs-sub">{genre.subtitle}</span>
        <span className="gs-tags">{genre.tags.map(tag => <i key={tag}>{tag}</i>)}</span>
        <span className="gs-cta">Открыть жанр <ArrowRight size={15}/></span>
      </span>
      <span className={`gs-progress ${paused || still ? 'is-paused' : ''}`} aria-hidden="true"><i key={genre.id}/></span>
    </button>
    <div className="gs-index" aria-label="Все жанры">
      {genres.map((item, index) => <button key={item.id} type="button" className={`gs-item ${index === active ? 'is-active' : ''}`} style={{ '--gs-tint': item.tint } as CSSProperties} onClick={() => onGenre(item)} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)}>
        <span className="gs-item-num">{String(index + 1).padStart(2, '0')}</span>
        <span className="gs-item-copy"><strong>{item.label}</strong><small>{item.tags[0]}</small></span>
        <span className="gs-item-mark" aria-hidden="true">{index === active ? <span className="gs-eq-mini">{eqBars(3, `gsm-${index}`)}</span> : <ArrowRight size={12}/>}</span>
      </button>)}
    </div>
  </div>
}

const genreIcons = { electronic: AudioLines, hiphop: Mic2, indie: Sparkles, pop: Heart, rock: Guitar, ambient: Waves, house: Disc3, jazz: Music2, rnb: Heart, techno: Zap, classical: Orbit, lofi: Moon }
function GenreIcon({ id, size = 58 }: { id: string; size?: number }) { const Icon = genreIcons[id as keyof typeof genreIcons] || Music2; return <Icon size={size} strokeWidth={1.45} aria-hidden="true"/> }
const eqBars = (count: number, prefix = 'g') => Array.from({ length: count }, (_, index) => <i key={`${prefix}-${index}`} style={{ '--n': index } as CSSProperties}/>)
export function GenreGrid({ onGenre, activeId, compact = false }: { onGenre: (genre: Genre) => void; activeId?: string; compact?: boolean }) {
  return <div className={`genre-grid ${compact ? 'genre-grid-compact' : ''}`}>{genres.map((genre, index) => <button key={genre.id} className={`genre-tile ${activeId === genre.id ? 'is-active' : ''}`} style={{ '--genre-color': genre.tint, '--genre-index': index } as CSSProperties} onClick={() => onGenre(genre)}>
    <span className="genre-tile-aurora" aria-hidden="true"/>
    <span className="genre-tile-scan" aria-hidden="true"/>
    <span className="genre-tile-top"><span className="genre-number">{String(index + 1).padStart(2, '0')}</span>{!compact && <span className="genre-eq" aria-hidden="true">{eqBars(5)}</span>}</span>
    <span className="genre-icon"><GenreIcon id={genre.id} size={compact ? 28 : 52}/></span>
    <span className="genre-tile-copy"><strong>{genre.label}</strong>{!compact && <small>{genre.subtitle}</small>}</span>
    {!compact && <span className="genre-tile-tags">{genre.tags.slice(0, 2).map(tag => <i key={tag}>{tag}</i>)}</span>}
    <span className="genre-arrow"><ArrowRight size={compact ? 12 : 15}/></span>
  </button>)}</div>
}

export function RecommendationLaunch({ onLaunch, onPlayNow, launching = false, artworks }: { onLaunch: () => void; onPlayNow?: () => void; launching?: boolean; artworks: string[] }) {
  const [active, setActive] = useState(0)
  const [inView, setInView] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  useInView(rootRef, setInView)
  useEffect(() => {
    if (artworks.length < 2 || !inView) return
    const timer = setInterval(() => setActive(value => (value + 1) % artworks.length), 3400)
    return () => clearInterval(timer)
  }, [artworks.length, inView])
  return <div className={`rec-launch ${launching ? 'is-launching' : ''}`} ref={rootRef}>
    <button type="button" className="rec-launch-open" onClick={onLaunch} aria-label="Открыть страницу рекомендаций"/>
    <span className="rec-launch-aurora"/>
    <span className="rec-launch-scan"/>
    <span className="rec-launch-orbit"><i/><i/><i/></span>
    <span className="rec-launch-copy">
      <span className="rec-launch-kicker"><span className="rec-launch-dot"/> KINETIX / ЖИВОЙ ПОТОК <em>LIVE</em></span>
      <strong>Рекомендации<i>.</i></strong>
      <span className="rec-launch-sub">Микс из твоей медиатеки, любимых и подписок — плюс новые имена рядом с твоим вкусом.</span>
      <span className="rec-launch-actions">
        <button type="button" className="rec-launch-play" onClick={() => onPlayNow?.()} disabled={launching || !onPlayNow}>
          {launching ? <Loader2 className="spin" size={16}/> : <Play size={16} fill="currentColor"/>}
          {launching ? 'Собираем поток…' : 'Слушать сейчас'}
        </button>
        <span className="rec-launch-cta">Открыть поток <ArrowRight size={16}/></span>
      </span>
      <span className="rec-launch-tags"><i>рядом</i><i>похоже</i><i>для тебя</i><i>новое</i><i>без остановки</i></span>
    </span>
    <span className="rec-launch-visual">
      <span className="rec-launch-vinyl"/>
      <span className="rec-launch-covers">{artworks.map((artwork, index) => <i key={`${artwork}-${index}`} className={index === active ? 'is-live' : ''} style={{ backgroundImage: `url("${artwork.replace(/"/g, '')}")` }}/>)}{!artworks.length && <i className="is-live is-empty"><Music2 size={26}/></i>}</span>
      <span className="rec-launch-bars">{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties}/>)}</span>
    </span>
  </div>
}

type HomeViewProps = {
  onSearch: () => void
  onImport: () => void
  onGenre: (genre: Genre) => void
  onArtist: (artist: { id?: string; name: string; image?: string }) => void
  onCatalog: () => void
  onCatalogArtist: (entry: CatalogEntry) => void
  onRecommendations: () => void
  onRecommendationsNow: () => void
  recommendationsLaunching: boolean
  onRecommendCollection: () => void
  onContinue: () => void
  onPlayHistory: (track: Track) => void
  onOpenView: (view: 'library' | 'favorites' | 'playlists') => void
  onOpenPlaylist: (id: string) => void
  collectionCount: number
  collectionArt: string[]
  recommendationArt: string[]
  recommendSource: SearchSource
  onRecommendSource: (value: SearchSource) => void
  vkEnabled: boolean
  vkIssue?: string
  yandexFull: boolean
  youtubeDl: boolean
  user: User | null
  recent: ReactNode
  apiReady: boolean
  followedCount: number
  followedTracks: ReactNode
  current: Track | null
  history: Track[]
  favoritesCount: number
  libraryCount: number
  listenStats: ListenStats | null
  recapYear?: number | null
  onOpenRecap?: () => void
  onPlayPulseTrack: (track: TrackListenEntry) => void
}

const plural = (count: number, one: string, few: string, many: string) => count % 10 === 1 && count % 100 !== 11 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many
const clockLabel = (seconds?: number) => seconds && Number.isFinite(seconds) && seconds > 0 ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : ''

export function HomeView({ onSearch, onImport, onGenre, onArtist, onCatalog, onCatalogArtist, onRecommendations, onRecommendationsNow, recommendationsLaunching, onRecommendCollection, onContinue, onPlayHistory, onOpenView, onOpenPlaylist, collectionCount, collectionArt, recommendationArt, recommendSource, onRecommendSource, vkEnabled, vkIssue, yandexFull, youtubeDl, user, recent, apiReady, followedCount, followedTracks, current, history, favoritesCount, libraryCount, listenStats, recapYear, onOpenRecap, onPlayPulseTrack }: HomeViewProps) {
  const continueTrack = current || history[0] || null
  const recentHistory = useMemo(() => {
    const seen = new Set<string>()
    return history.filter(track => {
      const key = `${track.artist.toLocaleLowerCase('ru-RU')}|${track.title.toLocaleLowerCase('ru-RU').replace(/\s*[([].*?[)\]]/g, '').trim()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [history])
  const month = useMemo(() => listenStats ? aggregateArtists(listenStats, 'month') : [], [listenStats])
  const monthSeconds = totalListen(month)
  const monthTop = month[0] || null
  const hour = new Date().getHours()
  const name = user?.name?.trim().split(/\s+/)[0] || ''
  const greeting = hour < 5 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'
  const playlists = user?.playlists || []
  const hasCollection = favoritesCount > 0 || libraryCount > 0
  const cover = continueTrack?.artwork
  const nowLabel = current ? 'СЕЙЧАС В ПЛЕЕРЕ' : continueTrack ? 'ПОСЛЕДНИЙ ТРЕК' : 'KINETIX / SOUND SYSTEM'
  return <>
    <section className="home-hero">
      <span className="home-hero-aurora"/>
      <div className="home-hero-copy">
        <span className="home-hero-kicker"><span className="home-hero-dot"/>{user ? 'KINETIX / ТВОЁ ПРОСТРАНСТВО' : 'KINETIX / МУЗЫКАЛЬНОЕ ПРОСТРАНСТВО'}</span>
        <h1>{name ? <>{greeting},<br/><em>{name}.</em></> : <>Почувствуй<br/><em>каждый момент.</em></>}</h1>
        <p className="home-hero-sub">{continueTrack ? <>Последний трек — <strong>«{continueTrack.title}»</strong> от {continueTrack.artist}.</> : <>Музыка, которая движется вместе с тобой.</>}</p>
        <div className="home-hero-actions">
          <button className="primary-btn home-hero-primary" onClick={onContinue}><Play size={17} fill="currentColor"/>{continueTrack ? 'Продолжить' : 'Включить музыку'}</button>
          <button className="home-hero-ghost" onClick={onSearch}><Search size={15}/>Поиск</button>
        </div>
        {favoritesCount || libraryCount || playlists.length || monthSeconds >= 60 ? <div className="home-hero-meta">
          {favoritesCount ? <span className="home-hero-chip"><Heart size={12} fill="currentColor"/><strong>{favoritesCount}</strong> любимых</span> : null}
          {libraryCount ? <span className="home-hero-chip"><Library size={12}/><strong>{libraryCount}</strong> в медиатеке</span> : null}
          {playlists.length ? <span className="home-hero-chip"><ListMusic size={12}/><strong>{playlists.length}</strong> {plural(playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}</span> : null}
          {monthSeconds >= 60 ? <button className="home-hero-chip is-link" onClick={() => monthTop && onArtist({ name: monthTop.name })}><Sparkles size={12}/><strong>{formatListenTime(monthSeconds)}</strong> за месяц{monthTop ? ` · ${monthTop.name}` : ''}</button> : null}
        </div> : null}
      </div>
      <div className="home-hero-art" aria-hidden="true">
        <span className="home-hero-aura"/>
        <span className="home-hero-disc"/>
        <span className={`home-hero-cover ${cover ? '' : 'is-empty'}`} style={cover ? { backgroundImage: `url("${cover.replace(/"/g, '')}")` } : undefined}>
          {!cover && <span className="home-hero-cover-fallback"><Music2 size={42}/><small>KINETIX</small></span>}
          <span className="home-hero-cover-shine"/>
        </span>
        <span className="home-hero-now"><span className="home-hero-now-dot"/><span><small>{nowLabel}</small><strong>{continueTrack?.title || 'Твой саундтрек'}</strong><em>{continueTrack?.artist || 'Kinetix Sound System'}</em></span></span>
        <span className="home-hero-eq">{Array.from({ length: 16 }, (_, index) => <i key={index} style={{ '--n': index, '--h': 4 + (index * 5) % 12 } as CSSProperties}/>)}</span>
        <span className="home-hero-note">♫</span>
      </div>
    </section>
    {recapYear && listenStats && onOpenRecap ? <RecapBanner year={recapYear} stats={listenStats} onOpen={onOpenRecap}/> : null}
    <WeeklyPulse stats={listenStats} onPlay={onPlayPulseTrack}/>
    <section className="home-section home-for-you" style={{ '--i': 1 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">СОБРАНО ПОД ТЕБЯ</span><h2>Для тебя <span className="heading-star">✳</span></h2></div><span className="home-section-note">живой поток · без остановки</span></div>
      <RecommendationLaunch onLaunch={onRecommendations} onPlayNow={onRecommendationsNow} launching={recommendationsLaunching} artworks={recommendationArt}/>
      <div className="home-for-you-tools"><span><Sparkles size={12}/> Откуда берём треки для микса</span><SourcePicker value={recommendSource} onChange={onRecommendSource} available={usableSources({ vkEnabled, vkIssue, youtubeDl })} yandexFull={yandexFull} youtubeDl={youtubeDl} compact inline/></div>
      <div className="collection-rec-section"><button className="collection-rec-launch" onClick={onRecommendCollection}><span className="collection-rec-glyph"><ListMusic size={22}/></span><span className="collection-rec-text"><small>РЕКОМЕНДАЦИИ ВЫБОРКОЙ</small><strong>Моя подборка</strong><em>{collectionCount ? `${collectionCount} ${plural(collectionCount, 'трек', 'трека', 'треков')} в основе — собери отдельный поток` : 'Добавь треки через меню «⋯» и собери свой поток'}</em></span>{collectionArt.length ? <span className="collection-rec-covers">{collectionArt.map((artwork, index) => <i key={`${artwork}-${index}`} style={{ backgroundImage: `url("${artwork.replace(/"/g, '')}")` }}/>)}</span> : null}<span className="collection-rec-go">{collectionCount ? 'Собрать поток' : 'Открыть'} <ArrowRight size={15}/></span></button></div>
    </section>
    <section className="home-section home-quick" style={{ '--i': 2 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">СВОЙ ЗВУК</span><h2>Добавь музыку</h2></div></div>
      <div className="home-quick-grid">
        <button className="home-quick-card" onClick={onSearch}><span className="home-quick-icon"><Radio size={20}/></span><span className="home-quick-copy"><strong>Открытый каталог</strong><small>Найди трек и включи сразу</small></span><span className="home-quick-go"><ArrowRight size={15}/></span></button>
        <button className="home-quick-card" onClick={onImport}><span className="home-quick-icon"><Headphones size={20}/></span><span className="home-quick-copy"><strong>Оффлайн-файлы</strong><small>Своя коллекция без сети</small></span><span className="home-quick-go"><ArrowRight size={15}/></span></button>
      </div>
    </section>
    {recentHistory.length ? <section className="home-section" style={{ '--i': 3 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">НЕДАВНО В ПЛЕЕРЕ</span><h2>Продолжить слушать</h2></div><span className="home-section-note">{recentHistory.length} {plural(recentHistory.length, 'трек', 'трека', 'треков')} в истории</span></div>
      <div className="home-rail home-rail-history">{recentHistory.slice(0, 5).map((track, index) => <button key={`${track.id}-${index}`} className="home-track-card" onClick={() => onPlayHistory(track)}><span className="home-track-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && <Music2 size={26}/>}<span className="home-track-play"><Play size={14} fill="currentColor"/></span>{clockLabel(track.duration || track.fullDuration) ? <span className="home-track-duration">{clockLabel(track.duration || track.fullDuration)}</span> : null}</span><strong>{track.title}</strong><small>{track.artist}</small></button>)}</div>
    </section> : null}
    {hasCollection || playlists.length ? <section className="home-section" style={{ '--i': 4 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">ВСЁ ПОД РУКОЙ</span><h2>Твоя коллекция</h2></div><button className="home-section-link" onClick={() => onOpenView('library')}>Медиатека <ArrowRight size={13}/></button></div>
      <div className="home-collection-stats">
        <button className="home-stat" onClick={() => onOpenView('favorites')}><span className="home-stat-icon"><Heart size={17} fill="currentColor"/></span><span><strong>{favoritesCount}</strong><small>{plural(favoritesCount, 'любимый трек', 'любимых трека', 'любимых треков')}</small></span><ArrowRight size={14}/></button>
        <button className="home-stat" onClick={() => onOpenView('library')}><span className="home-stat-icon"><Library size={17}/></span><span><strong>{libraryCount}</strong><small>{plural(libraryCount, 'трек в медиатеке', 'трека в медиатеке', 'треков в медиатеке')}</small></span><ArrowRight size={14}/></button>
        {user ? <button className="home-stat" onClick={() => onOpenView('playlists')}><span className="home-stat-icon"><ListMusic size={17}/></span><span><strong>{playlists.length}</strong><small>{plural(playlists.length, 'плейлист', 'плейлиста', 'плейлистов')}</small></span><ArrowRight size={14}/></button> : null}
        {monthSeconds >= 60 ? <div className="home-stat home-stat-listen"><span className="home-stat-icon"><Clock size={17}/></span><span><strong>{formatListenTime(monthSeconds)}</strong><small>за месяц{monthTop ? ` · ${monthTop.name}` : ''}</small></span></div> : null}
      </div>
      {hasCollection ? <div className="home-recent">{recent}</div> : null}
    </section> : null}
    {user ? <section className="home-section" style={{ '--i': 5 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">ТВОИ ПОДБОРКИ</span><h2>Плейлисты</h2></div>{playlists.length ? <button className="home-section-link" onClick={() => onOpenView('playlists')}>Все <ArrowRight size={13}/></button> : null}</div>
      <div className="home-rail home-rail-playlists">
        {playlists.slice(0, 6).map(playlist => <button key={playlist.id} className="home-playlist-card" onClick={() => onOpenPlaylist(playlist.id)}><span className="home-playlist-cover"><PlaylistCover tracks={playlist.tracks} cover={playlist.cover} name={playlist.name}/><span className="home-playlist-play"><Play size={14} fill="currentColor"/></span></span><strong>{playlist.name}</strong><small>{playlist.tracks.length ? `${playlist.tracks.length} ${plural(playlist.tracks.length, 'трек', 'трека', 'треков')}` : 'Пока без треков'}</small></button>)}
        <button className="home-playlist-card" onClick={() => onOpenView('playlists')}><span className="home-playlist-cover home-playlist-empty"><Plus size={26}/></span><strong>{playlists.length ? 'Новый плейлист' : 'Собери первый'}</strong><small>Из своих треков</small></button>
      </div>
    </section> : null}
    <section className="home-section" style={{ '--i': 6 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">БОЛЬШИЕ КАТАЛОГИ</span><h2>Популярное сейчас <span className="heading-star">✳</span></h2></div><button className="home-section-link" onClick={onCatalog}>Все каталоги <ArrowRight size={13}/></button></div>
      <div className="catalog-strip">{featuredCatalogEntries.map(entry => <button key={entry.id} style={{ '--tint': entry.tint } as CSSProperties} onClick={() => onCatalogArtist(entry)}><span className="catalog-strip-initial" style={{ background: entry.tint }}><ArtistFace name={entry.name}/></span><span className="catalog-strip-copy"><strong>{entry.name}</strong><small>{entry.tags[0]}</small></span><ArrowRight size={14}/></button>)}</div>
    </section>
    <section className="home-section genre-section" style={{ '--i': 7 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">ВЫБЕРИ НАСТРОЕНИЕ</span><h2>Исследуй жанры <span className="heading-star">✳</span></h2></div><span className="genre-count">12 НАПРАВЛЕНИЙ</span></div>
      <GenreShowcase onGenre={onGenre}/>
    </section>
    {user?.artists.length ? <section className="home-section" style={{ '--i': 8 } as CSSProperties}>
      <div className="home-section-head"><div><span className="home-kicker">ТВОЙ ВЫБОР</span><h2>Исполнители рядом</h2></div></div>
      <div className="home-artists">{user.artists.slice(0, 8).map(id => { const artist = artistById(id); return artist ? <button key={id} onClick={() => onArtist({ id, name: artist.name })}><span className="home-artist-face" style={{ background: artist.tint }}><ArtistFace name={artist.name}/></span><strong>{artist.name}</strong><ArrowRight size={14}/></button> : null })}</div>
      <div className="home-followed"><div className="home-followed-head"><span className="home-kicker">НОВОЕ ОТ НИХ</span><strong>{followedCount ? `${followedCount} ${plural(followedCount, 'трек', 'трека', 'треков')}` : 'Пока тихо'}</strong></div>{followedCount ? <div className="home-recent">{followedTracks}</div> : <div className="empty-small"><Music2 size={20}/>{apiReady ? 'Пока нет доступных треков выбранных артистов.' : 'Новые треки появятся, когда они будут доступны в подключённых каталогах.'}</div>}</div>
    </section> : null}
  </>
}

function FolderFilter({ folders, activeFolder, setActiveFolder, onDeleteFolder }: { folders: string[]; activeFolder: string; setActiveFolder: (value: string) => void; onDeleteFolder?: (folder: string) => void }) {
  const [armed, setArmed] = useState('')
  useEffect(() => { setArmed('') }, [activeFolder])
  const selected = activeFolder !== 'all' ? activeFolder : ''
  return <div className="folder-filter">
    <span>ПАПКИ</span>
    <button className={activeFolder === 'all' ? 'active' : ''} onClick={() => setActiveFolder('all')}>Все треки</button>
    {folders.map(folder => <button key={folder} className={activeFolder === folder ? 'active' : ''} onClick={() => setActiveFolder(folder)} title={folder}><Folder size={13}/>{folder.split('/').pop()}</button>)}
    {selected && onDeleteFolder && (armed === selected
      ? <span className="folder-delete-confirm">
          <button className="folder-delete is-armed" onClick={() => { onDeleteFolder(selected); setArmed('') }}><Trash2 size={13}/> Удалить «{selected.split('/').pop()}»</button>
          <button className="folder-delete-cancel" onClick={() => setArmed('')}>Отмена</button>
        </span>
      : <button className="folder-delete" onClick={() => setArmed(selected)}><Trash2 size={13}/> Удалить папку</button>)}
  </div>
}

const RECENT_SEARCH_KEY = 'kinetix:search-recent:v1'
const readRecentSearches = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 8) : []
  } catch { return [] }
}

function SearchView({ query, setQuery, searchSource, setSearchSource, vkEnabled, vkIssue = '', yandexFull, youtubeDl, onImportUrl, loading, shownCount, tracks, trackList, onArtist, onGenre, onPlayAll, onShuffle, onSubmitSearch, suggestions }: {
  query: string
  setQuery: (value: string) => void
  searchSource: SearchSource
  setSearchSource: (value: SearchSource) => void
  vkEnabled: boolean
  vkIssue?: string
  yandexFull: boolean
  youtubeDl: boolean
  onImportUrl: (value: string) => void
  loading: boolean
  shownCount: number
  tracks: Track[]
  trackList: ReactNode
  onArtist: (artist: { id?: string; name: string; image?: string }) => void
  onGenre: (genre: Genre) => void
  onPlayAll: () => void
  onShuffle: () => void
  onSubmitSearch: (value: string) => void
  suggestions: string[]
}) {
  const [recent, setRecent] = useState<string[]>(readRecentSearches)
  const inputRef = useRef<HTMLInputElement>(null)
  const needle = query.trim()
  const isLink = /soundcloud\.com\//i.test(needle)
  const available = usableSources({ vkEnabled, vkIssue, youtubeDl })
  const artistIndex = new Map<string, { name: string; artwork?: string; count: number }>()
  const counts: Record<'youtube' | 'yandex' | 'vk', number> = { youtube: 0, yandex: 0, vk: 0 }
  for (const track of tracks) {
    if (track.source === 'youtube' || track.source === 'yandex' || track.source === 'vk') counts[track.source] += 1
    const name = track.artist?.trim()
    if (!name || name === 'Мои файлы') continue
    const key = name.toLocaleLowerCase()
    const item = artistIndex.get(key)
    if (item) { item.count += 1; if (!item.artwork && track.artwork) item.artwork = track.artwork }
    else artistIndex.set(key, { name, artwork: track.artwork, count: 1 })
  }
  const foundArtists = [...artistIndex.values()].sort((a, b) => b.count - a.count).slice(0, 12)
  const popular = [...new Set([...suggestions, ...featuredCatalogEntries.map(entry => entry.name), ...genres.slice(0, 6).map(genre => genre.label)])].filter(Boolean).slice(0, 10)
  const storeRecent = (clean: string) => {
    setRecent(prev => {
      if (prev[0]?.toLocaleLowerCase() === clean.toLocaleLowerCase()) return prev
      const next = [clean, ...prev.filter(item => item.toLocaleLowerCase() !== clean.toLocaleLowerCase())].slice(0, 8)
      try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next)) } catch { /* приватный режим */ }
      return next
    })
  }
  const run = (value?: string) => {
    const text = (value ?? query).trim()
    if (value !== undefined) setQuery(value)
    if (!text) { inputRef.current?.focus(); return }
    if (/soundcloud\.com\//i.test(text)) { onImportUrl(text); return }
    storeRecent(text.slice(0, 80))
    onSubmitSearch(text)
  }
  useEffect(() => {
    if (!needle || shownCount === 0 || /soundcloud\.com\//i.test(needle)) return
    const timer = setTimeout(() => storeRecent(needle.slice(0, 80)), 2200)
    return () => clearTimeout(timer)
  }, [needle, shownCount])
  const sourcePills = [
    { id: 'all' as const, label: 'Все', count: shownCount },
    { id: 'youtube' as const, label: 'YouTube', count: counts.youtube },
    { id: 'yandex' as const, label: 'Яндекс', count: counts.yandex },
    { id: 'vk' as const, label: 'ВКонтакте', count: counts.vk },
  ].filter(pill => pill.id === 'all' || pill.count > 0)
  const resultsMeta = [
    foundArtists.length ? `${foundArtists.length} ${plural(foundArtists.length, 'исполнитель', 'исполнителя', 'исполнителей')} в выдаче` : '',
    ...sourcePills.filter(pill => pill.id !== 'all').map(pill => `${pill.count} ${pill.label}`),
  ].filter(Boolean).join(' · ')
  return <section className="page-section search-page">
    <div className="search-hero">
      <span className="search-hero-aurora" aria-hidden="true"/>
      <span className="search-hero-mesh" aria-hidden="true"/>
      <span className="search-hero-orbits" aria-hidden="true"><i/><i/><i/></span>
      <span className="search-hero-note" aria-hidden="true">♫</span>
      <div className="search-hero-copy">
        <span className="page-kicker">KINETIX / ОТКРЫТИЯ</span>
        <h1>Найди <em>свой звук.</em></h1>
        <p>Один запрос — {available.filter(id => id !== 'all').map(id => sourceLabels[id]).join(', ')}. Ищем одновременно, без переключений.</p>
      </div>
      <form className="search-console" onSubmit={event => { event.preventDefault(); run() }}>
        <Search size={19} className="search-console-icon"/>
        <input ref={inputRef} type="search" name="kinetix-search" autoComplete="off" spellCheck={false} value={query} onChange={event => setQuery(event.target.value)} placeholder="Трек, исполнитель или настроение" autoFocus enterKeyHint="search" aria-label="Поиск музыки"/>
        <span className={`search-console-live ${loading ? 'is-on' : ''}`} aria-hidden="true"><i/>{loading ? 'ИЩЕМ' : needle ? 'LIVE' : 'ГОТОВ'}</span>
        {query && <button type="button" className="search-console-clear" onClick={() => { setQuery(''); inputRef.current?.focus() }} aria-label="Очистить поиск"><X size={15}/></button>}
        <button type="submit" className="search-console-go"><Search size={15}/><span>Найти</span></button>
      </form>
      {isLink && <span className="search-console-note"><ListMusic size={13}/> Похоже на ссылку — «Найти» импортирует плейлист SoundCloud.</span>}
      <div className="search-hero-foot">
        <SourcePicker value={searchSource} onChange={setSearchSource} available={available} yandexFull={yandexFull} youtubeDl={youtubeDl} vkIssue={vkIssue} compact inline/>
        <span className={`search-source-note ${(searchSource === 'youtube' && !youtubeDl) || (searchSource === 'yandex' && !yandexFull) ? 'is-warn' : ''}`}>{sourceHint(searchSource, yandexFull, youtubeDl, available)}</span>
        <div className="search-hero-chips"><span><TrendingUp size={12}/> ЧАСТО ИЩУТ</span>{popular.map(item => <button key={item} onClick={() => run(item)}>{item}</button>)}</div>
      </div>
      <span className="search-hero-eq" aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties}/>)}</span>
    </div>
    {needle ? <>
      <div className="search-results-head">
        <div className="search-results-title">
          <span className="search-kicker">РЕЗУЛЬТАТЫ / {sourceLabel(searchSource).toUpperCase()}</span>
          <h2>{isLink ? <>Готовы импортировать <em>плейлист</em></> : loading && !shownCount ? 'Собираем треки…' : shownCount ? <>Нашли <em>{shownCount}</em> {plural(shownCount, 'трек', 'трека', 'треков')}</> : <>По запросу <em>«{needle}»</em> пусто</>}</h2>
          <span className="search-results-meta">{isLink ? 'Вставь ссылку и нажми «Найти»' : loading && !shownCount ? 'Ищем по всем источникам — это может занять несколько секунд' : shownCount ? resultsMeta : 'Попробуй другой запрос или источник'}</span>
        </div>
        {shownCount > 0 && <div className="search-results-actions">
          <button className="primary-btn" onClick={onPlayAll}><Play size={15} fill="currentColor"/> Слушать всё</button>
          <button className="search-shuffle" onClick={onShuffle}><Shuffle size={15}/> Перемешать</button>
        </div>}
      </div>
      {shownCount > 0 && <div className="search-source-pills"><span>ИСТОЧНИК</span>{sourcePills.map(pill => <button key={pill.id} className={searchSource === pill.id ? 'active' : ''} onClick={() => pill.id !== searchSource && setSearchSource(pill.id)} aria-pressed={searchSource === pill.id}>{pill.label}<em>{pill.count}</em></button>)}</div>}
      {loading && !shownCount && <div className="search-skeleton">{Array.from({ length: 7 }, (_, index) => <span key={index} style={{ '--n': index } as CSSProperties}><i/><i/><i/><i/></span>)}</div>}
      {shownCount > 0 && foundArtists.length > 1 && <div className="search-found-artists">
        <div className="search-found-head"><span>ИСПОЛНИТЕЛИ В ВЫДАЧЕ</span><small>{foundArtists.length}</small></div>
        <div className="search-found-rail">{foundArtists.map(artist => <button key={artist.name} onClick={() => onArtist({ name: artist.name, image: artist.artwork })}>
          <span className="search-found-face" style={artist.artwork ? { backgroundImage: `url("${artist.artwork.replace(/"/g, '')}")` } : undefined}>{!artist.artwork && <Mic2 size={18}/>}</span>
          <strong>{artist.name}</strong>
          <small>{artist.count} {plural(artist.count, 'трек', 'трека', 'треков')}</small>
        </button>)}</div>
      </div>}
      {shownCount > 0 && <><div className="track-list-header"><span>ТРЕК</span><span>ИСТОЧНИК</span><span>ВРЕМЯ</span></div>{trackList}</>}
      {!loading && !shownCount && !isLink && <div className="search-empty">
        <span className="search-empty-orb"><Waves size={28}/></span>
        <h3>По запросу «{needle}» ничего нет</h3>
        <p>Попробуй короче, смени источник или выбери один из популярных запросов.</p>
        <div className="search-empty-actions">
          {searchSource !== 'all' && <button className="primary-btn" onClick={() => setSearchSource('all')}>Искать везде</button>}
          {popular.slice(0, 3).map(item => <button key={item} className="search-empty-chip" onClick={() => run(item)}>{item}</button>)}
        </div>
      </div>}
    </> : <div className="search-landing">
      {recent.length > 0 && <section className="search-block">
        <div className="search-block-head"><div><span className="search-kicker">НЕДАВНО ИСКАЛ</span><h2>Продолжить поиск</h2></div><button className="search-block-link" onClick={() => { setRecent([]); try { localStorage.removeItem(RECENT_SEARCH_KEY) } catch { /* приватный режим */ } }}>Очистить</button></div>
        <div className="search-recent">{recent.map(item => <span className="search-recent-chip" key={item}>
          <button onClick={() => run(item)}><History size={13}/>{item}</button>
          <button className="search-recent-remove" onClick={() => setRecent(prev => { const next = prev.filter(entry => entry !== item); try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next)) } catch { /* приватный режим */ } return next })} aria-label={`Убрать ${item}`}><X size={11}/></button>
        </span>)}</div>
      </section>}
      <section className="search-block">
        <div className="search-block-head"><div><span className="search-kicker">ВЫБЕРИ НАСТРОЕНИЕ</span><h2>С чего начать</h2></div><span className="search-block-note">{genres.length} направлений</span></div>
        <GenreGrid onGenre={onGenre} compact/>
      </section>
      <div className="search-tip"><span className="search-tip-icon"><Sparkles size={18}/></span><div><strong>Ищи как на YouTube</strong><span>Название, исполнитель или строка из песни. Источник можно сменить в любой момент — поиск останется тем же.</span></div></div>
    </div>}
  </section>
}

export function CollectionView({ view, query, setQuery, searchSource, setSearchSource, vkEnabled, vkIssue, yandexFull, youtubeDl, onImportUrl, onImportFile, onImportFolder, folders, activeFolder, setActiveFolder, onDeleteFolder, loading, shownCount, tracks = [], trackList, onSearch, onArtist, onGenre, onPlayAll, onShuffle, onSubmitSearch, suggestions = [] }: {
  view: 'search' | 'library' | 'favorites' | 'offline'
  query: string
  setQuery: (value: string) => void
  searchSource: SearchSource
  setSearchSource: (value: SearchSource) => void
  vkEnabled: boolean
  vkIssue?: string
  yandexFull: boolean
  youtubeDl: boolean
  onImportUrl: (value: string) => void
  onImportFile: () => void
  onImportFolder: () => void
  folders: string[]
  activeFolder: string
  setActiveFolder: (value: string) => void
  onDeleteFolder?: (folder: string) => void
  apiReady: boolean
  loading: boolean
  shownCount: number
  tracks?: Track[]
  trackList: ReactNode
  onSearch: () => void
  onArtist?: (artist: { id?: string; name: string; image?: string }) => void
  onGenre?: (genre: Genre) => void
  onPlayAll?: () => void
  onShuffle?: () => void
  onSubmitSearch?: (value: string) => void
  suggestions?: string[]
}) {
  if (view === 'search') return <SearchView query={query} setQuery={setQuery} searchSource={searchSource} setSearchSource={setSearchSource} vkEnabled={vkEnabled} vkIssue={vkIssue} yandexFull={yandexFull} youtubeDl={youtubeDl} onImportUrl={onImportUrl} loading={loading} shownCount={shownCount} tracks={tracks} trackList={trackList} onArtist={onArtist || (() => {})} onGenre={onGenre || (() => {})} onPlayAll={onPlayAll || (() => {})} onShuffle={onShuffle || (() => {})} onSubmitSearch={onSubmitSearch || setQuery} suggestions={suggestions}/>
  const isOffline = view === 'offline'
  const isFavorites = view === 'favorites'
  const isCollection = view === 'library' || isFavorites
  return <section className="page-section"><div className="page-kicker">KINETIX / {isFavorites ? 'ИЗБРАННОЕ' : view === 'library' ? 'МЕДИАТЕКА' : 'БЕЗ СЕТИ'}</div><div className="page-title-row"><div><h1>{isFavorites ? 'Любимые треки.' : view === 'library' ? 'Медиатека.' : 'Всегда с тобой.'}</h1><p>{isFavorites ? 'Всё, что ты отметил сердечком.' : view === 'library' ? 'Треки, добавленные кнопкой «+».' : 'Твои аудиофайлы доступны даже без интернета.'}</p></div>{isOffline && <div className="page-title-actions"><button className="outline-btn" onClick={onImportFile}><Upload size={16}/> Файлы</button><button className="outline-btn" onClick={onImportFolder}><FolderPlus size={16}/> Папки</button></div>}</div>{isCollection && <div className="library-showcase"><div className="library-showcase-copy"><span>ТВОЯ МУЗЫКА / ТВОИ ПРАВИЛА</span><h2>{isFavorites ? <>Треки, к которым<br/><em>хочется вернуться.</em></> : <>Собрано вручную.<br/><em>Всегда под рукой.</em></>}</h2><p>{isFavorites ? 'Сохраняй то, что цепляет. Здесь каждый трек — часть твоего звука.' : 'Добавляй треки кнопкой «+» — они будут ждать тебя в медиатеке.'}</p><button onClick={onSearch}>Найти ещё музыку <ArrowRight size={16}/></button></div><div className="library-showcase-art"><span className="library-disc library-disc-back"/><span className="library-disc library-disc-front">{isFavorites ? <Heart size={43} fill="currentColor"/> : <Library size={43}/>}</span><span className="library-orbit"/></div><div className="library-showcase-count"><strong>{shownCount}</strong><span>{isFavorites ? (shownCount === 1 ? 'любимый трек' : 'любимых треков') : (shownCount === 1 ? 'трек в медиатеке' : 'треков в медиатеке')}</span></div></div>}{isOffline && folders.length > 0 && <FolderFilter folders={folders} activeFolder={activeFolder} setActiveFolder={setActiveFolder} onDeleteFolder={onDeleteFolder}/>}{loading && <div className="loading-row"><Disc3 className="spin" size={20}/> Загружаем музыку…</div>}{shownCount ? <><div className="track-list-header"><span>ТРЕК</span><span>ИСТОЧНИК</span><span>ВРЕМЯ</span></div>{trackList}</> : !loading && <div className="empty-state"><div className="empty-art"><Music2 size={38}/></div><h3>{isOffline ? 'Твоя музыка всегда рядом' : isFavorites ? 'Здесь пока нет любимых треков' : 'Медиатека пуста'}</h3><p>{isOffline ? 'Добавь свои аудиофайлы — они сохранятся на этом устройстве.' : isFavorites ? 'Отмечай треки сердечком — они появятся здесь.' : 'Добавляй треки кнопкой «+» — они появятся здесь.'}</p><button className="primary-btn" onClick={isOffline ? onImportFile : onSearch}>{isOffline ? 'Добавить файлы' : 'Найти музыку'} <span>↗</span></button></div>}</section>
}

export type GenreSources = { youtube: number; yandex: number; vk: number }

export function GenreView({ genre, tracksCount, shownCount, sources, loading, error, mood, query, yandexFull, youtubeDl, vkEnabled, vkIssue, source, onSource, setQuery, onMood, onRefresh, onPlayAll, trackList, onGenre }: {
  genre: Genre
  tracksCount: number
  shownCount: number
  sources: GenreSources | null
  loading: boolean
  error: string
  mood: string
  query: string
  yandexFull: boolean
  youtubeDl: boolean
  vkEnabled: boolean
  vkIssue?: string
  source: SearchSource
  onSource: (value: SearchSource) => void
  setQuery: (value: string) => void
  onMood: (value: string) => void
  onRefresh: () => void
  onPlayAll: () => void
  trackList: ReactNode
  onGenre: (genre: Genre) => void
}) {
  const index = genres.findIndex(item => item.id === genre.id) + 1
  const pills = sources ? [
    { id: 'youtube', label: 'YouTube', count: sources.youtube },
    { id: 'yandex', label: 'Яндекс', count: sources.yandex },
    { id: 'vk', label: 'ВКонтакте', count: sources.vk },
  ].filter(pill => pill.count > 0) : []
  return <section className="page-section genre-page">
    <div className="genre-crumbs"><div className="page-kicker">KINETIX / ЖАНРЫ / {genre.label.toUpperCase()}</div><span className="genre-crumbs-index">НАПРАВЛЕНИЕ {String(index).padStart(2, '0')} / 12</span></div>
    <div className="genre-stage" style={{ '--tint': genre.tint } as CSSProperties}>
      <span className="genre-stage-aurora" aria-hidden="true"/>
      <span className="genre-stage-mesh" aria-hidden="true"/>
      <div className="genre-stage-copy">
        <span className="genre-stage-kicker">{mood ? `НАСТРОЕНИЕ / ${mood.toUpperCase()}` : 'ВЫБЕРИ НАСТРОЕНИЕ'}</span>
        <h1>{genre.label}<i>.</i></h1>
        <p>{genre.subtitle}</p>
        <div className="genre-stage-meta">
          <span className="genre-stage-count">{loading ? 'Собираем треки…' : shownCount ? `${shownCount} ${plural(shownCount, 'трек', 'трека', 'треков')}` : 'Пока пусто'}</span>
          {pills.map(pill => <span key={pill.id} className={`genre-pill is-${pill.id}`}><b>{pill.label}</b>{pill.count}</span>)}
          {!pills.length && !loading && <span className="genre-pill is-muted">YouTube · Яндекс · ВКонтакте</span>}
        </div>
        <div className="genre-stage-actions">
          <button className="primary-btn genre-play" disabled={!shownCount} onClick={onPlayAll}><Play size={16} fill="currentColor"/> Слушать всё</button>
          <button className="genre-refresh" onClick={onRefresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''}/> Обновить</button>
        </div>
      </div>
      <div className="genre-stage-art" aria-hidden="true">
        <span className="genre-stage-disc"><GenreIcon id={genre.id} size={104}/></span>
        <span className="genre-stage-eq">{eqBars(18, 'stage')}</span>
      </div>
    </div>
    <div className="genre-toolbar">
      <div className="genre-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Поиск внутри «${genre.label}»`} aria-label="Поиск по трекам жанра"/>{query && <button onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={13}/></button>}</div>
      <SourcePicker value={source} onChange={onSource} available={usableSources({ vkEnabled, vkIssue, youtubeDl })} yandexFull={yandexFull} youtubeDl={youtubeDl} compact/>
      <span className="genre-toolbar-count">{shownCount} / {tracksCount}</span>
    </div>
    <div className="genre-moods"><span>НАСТРОЕНИЕ</span>{genre.tags.map(tag => <button key={tag} className={mood === tag ? 'active' : ''} onClick={() => onMood(tag)} aria-pressed={mood === tag}>{tag}</button>)}</div>
    {!yandexFull && sources && sources.yandex > 0 && <div className="genre-note">Яндекс Музыка без токена отдаёт 30-секундные превью — добавьте YANDEX_MUSIC_TOKEN в .env для полного звука.</div>}
    <div className="section-heading genre-list-heading"><div><span className="section-kicker">{mood ? `ЖАНР / ${mood.toUpperCase()}` : source === 'all' ? 'СОБРАНО ИЗ ТРЁХ ИСТОЧНИКОВ' : `ИСТОЧНИК / ${sourceLabels[source].toUpperCase()}`}</span><h2>{mood ? `Настроение «${mood}»` : 'Треки жанра'}</h2></div>{loading && <Disc3 className="spin" size={19}/>}</div>
    {loading && !tracksCount && <div className="loading-row"><Disc3 className="spin" size={20}/> Загружаем треки…</div>}
    {error && <div className="api-hint"><Radio size={20}/><div><strong>{error}</strong><span>Попробуй другое настроение или обнови подборку.</span></div>{mood && <button className="genre-hint-reset" onClick={() => onMood(mood)}>Сбросить</button>}</div>}
    {!error && shownCount > 0 && <><div className="track-list-header"><span>ТРЕК</span><span>ИСТОЧНИК</span><span>ВРЕМЯ</span></div>{trackList}</>}
    {!loading && !error && tracksCount > 0 && !shownCount && <div className="genre-empty"><Music2 size={22}/><span>{query ? `По запросу «${query}» ничего нет.` : 'В выбранном источнике пока нет треков.'}</span><button onClick={() => { setQuery(''); onSource('all') }}>Сбросить фильтры</button></div>}
    {!loading && !error && !tracksCount && <div className="empty-small">В этом жанре пока нет доступных треков. Выбери другое направление или обнови.</div>}
    <div className="section-heading genre-more-heading"><div><span className="section-kicker">ПРОДОЛЖАЙ ИССЛЕДОВАТЬ</span><h2>Другие жанры</h2></div><span className="genre-count">12 НАПРАВЛЕНИЙ</span></div>
    <GenreGrid onGenre={onGenre} activeId={genre.id} compact/>
  </section>
}
