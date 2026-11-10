import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, CalendarDays, Check, Disc3, Heart, Loader2, Music2, Play, Plus, Radio, RefreshCw, Shuffle, Sparkles, Wand2, X } from 'lucide-react'
import type { User } from './account'
import type { Track } from './types'
import { SourcePicker, usableSources, type SearchSource } from './views'

export type ArtistRef = { name: string; id?: string; image?: string; tint?: string; tags?: string[] }
type ArtistInfo = { id: string; aliasId?: string; deezerId: number; name: string; image: string; fans: number; albums: number; link: string }
type Release = { id: string; deezerId: number; title: string; cover: string; year?: number; date?: string; type: string; trackCount: number; link: string }
type Related = { id: string; name: string; image: string; fans: number; link: string }
type PageData = { artist: ArtistInfo; releases: Release[]; related: Related[] }
type ReleaseData = { release: Release; tracks: Track[]; previews: boolean; previewCount?: number }

const typeLabels: Record<string, string> = { album: 'Альбом', single: 'Сингл', ep: 'EP', compile: 'Сборник', compilation: 'Сборник' }
function typeLabel(type: string) { return typeLabels[type] || 'Релиз' }
function compactNumber(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} млн`
  if (value >= 1_000) return `${Math.round(value / 1_000)} тыс.`
  return String(value)
}
function plural(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return few
  return many
}
function durationLabel(tracks: Track[]) {
  const total = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
  if (!total) return ''
  const minutes = Math.round(total / 60)
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин`
}
function tintStyle(tint?: string): CSSProperties {
  const hue = [...String(tint || '#d7ff57')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360
  return { '--ar-hue': hue } as CSSProperties
}

function TrackSkeleton({ rows = 7 }: { rows?: number }) {
  return <div className="ar-skeleton-list" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <span className="ar-skeleton-row" key={index}><i/><b/><em/></span>)}</div>
}
function HeroSkeleton() {
  return <div className="ar-hero is-loading"><span className="ar-hero-backdrop"/><span className="ar-hero-skeleton-art"/><div className="ar-hero-copy"><span className="ar-skeleton-line is-short"/><span className="ar-skeleton-line is-title"/><span className="ar-skeleton-line"/><span className="ar-skeleton-line is-short"/></div></div>
}

export function ArtistView({
  artist,
  fallbackId,
  user,
  followedIds,
  tint,
  tags = [],
  source,
  onSource,
  vkEnabled,
  vkIssue,
  yandexFull,
  youtubeDl,
  onBack,
  onToggleFollow,
  onArtist,
  onPlayTracks,
  onRecommendations,
  onLogin,
  renderTracks,
  onNotice,
  onTracksLoaded,
}: {
  artist: ArtistRef
  fallbackId?: string
  user: User | null
  followedIds: string[]
  tint?: string
  tags?: string[]
  source: SearchSource
  onSource: (source: SearchSource) => void
  vkEnabled: boolean
  vkIssue: string
  yandexFull: boolean
  youtubeDl: boolean
  onBack: () => void
  onToggleFollow: (artist: { id: string; name: string; image?: string }) => void
  onArtist: (artist: ArtistRef) => void
  onPlayTracks: (tracks: Track[], index?: number) => void
  onRecommendations: (seed: Track | null, scope: 'artist') => void
  onLogin: () => void
  renderTracks: (tracks: Track[]) => ReactNode
  onNotice: (message: string) => void
  onTracksLoaded?: (tracks: Track[]) => void
}) {
  const [page, setPage] = useState<PageData | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [pageError, setPageError] = useState('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [tracksLoading, setTracksLoading] = useState(true)
  const [tracksError, setTracksError] = useState('')
  const [showAllTracks, setShowAllTracks] = useState(false)
  const [releaseFilter, setReleaseFilter] = useState<'all' | 'album' | 'single' | 'ep'>('all')
  const [selectedRelease, setSelectedRelease] = useState<Release | null>(null)
  const [releaseData, setReleaseData] = useState<ReleaseData | null>(null)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [releaseError, setReleaseError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ name: artist.name })
    if (artist.id?.startsWith('deezer-')) params.set('id', artist.id)
    setPage(null); setPageLoading(true); setPageError('')
    setTracks([]); setTracksLoading(true); setTracksError(''); setShowAllTracks(false)
    setSelectedRelease(null); setReleaseData(null); setReleaseError('')
    fetch(`/api/artist-page?${params}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось открыть исполнителя'); return data as PageData })
      .then(data => { if (!controller.signal.aborted) setPage(data) })
      .catch(cause => { if (!controller.signal.aborted) setPageError(cause instanceof Error ? cause.message : 'Не удалось открыть исполнителя') })
      .finally(() => { if (!controller.signal.aborted) setPageLoading(false) })
    fetch(`/api/artist-tracks?${params}&source=${source}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось собрать треки'); return data as { tracks: Track[]; previews: boolean } })
      .then(data => { if (!controller.signal.aborted) { const list = data.tracks || []; setTracks(list); onTracksLoaded?.(list) } })
      .catch(cause => { if (!controller.signal.aborted) setTracksError(cause instanceof Error ? cause.message : 'Не удалось собрать треки') })
      .finally(() => { if (!controller.signal.aborted) setTracksLoading(false) })
    return () => controller.abort()
  }, [artist.name, artist.id, nonce, source])

  useEffect(() => {
    if (!selectedRelease) { setReleaseData(null); return }
    const controller = new AbortController()
    const params = new URLSearchParams({ id: String(selectedRelease.deezerId), artist: artist.name })
    setReleaseLoading(true); setReleaseError(''); setReleaseData(null)
    fetch(`/api/artist-release?${params}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Не удалось открыть релиз'); return data as ReleaseData })
      .then(data => { if (!controller.signal.aborted) setReleaseData(data) })
      .catch(cause => { if (!controller.signal.aborted) setReleaseError(cause instanceof Error ? cause.message : 'Не удалось открыть релиз') })
      .finally(() => { if (!controller.signal.aborted) setReleaseLoading(false) })
    return () => controller.abort()
  }, [selectedRelease?.deezerId, artist.name])

  const info = page?.artist
  const aliasIds = [info?.aliasId, info?.id, fallbackId].filter((value): value is string => Boolean(value))
  const followed = aliasIds.some(id => followedIds.includes(id))
  const releases = page?.releases || []
  const filteredReleases = useMemo(() => releaseFilter === 'all' ? releases : releases.filter(release => release.type === releaseFilter), [releases, releaseFilter])
  const counts = useMemo(() => releases.reduce((result, release) => { result[release.type] = (result[release.type] || 0) + 1; return result }, {} as Record<string, number>), [releases])
  const totalDuration = useMemo(() => durationLabel(tracks), [tracks])
  const visibleTracks = showAllTracks ? tracks : tracks.slice(0, 10)
  const heroImage = info?.image || artist.image || ''
  const knownTags = tags.filter(tag => tag && tag !== 'all').slice(0, 4)
  const releaseTypes = (['all', 'album', 'single', 'ep'] as const).filter(type => type === 'all' || counts[type])

  function toggleFollow() {
    if (!user) { onNotice('Войдите в аккаунт, чтобы отслеживать исполнителей'); onLogin(); return }
    const target = info ? { id: info.aliasId || fallbackId || info.id, name: info.name, image: info.image } : fallbackId ? { id: fallbackId, name: artist.name, image: artist.image } : null
    if (!target) { onNotice('Профиль исполнителя ещё загружается'); return }
    onToggleFollow(target)
  }
  function playAll(list: Track[], index = 0) {
    if (!list.length) { onNotice('Для этого исполнителя пока нет доступных треков'); return }
    onPlayTracks(list, index)
  }
  function shuffleTracks(list: Track[]) {
    playAll([...list].sort(() => Math.random() - .5), 0)
  }
  function retryTracks() {
    setNonce(value => value + 1)
  }

  return <section className="ar-page page-section" style={tintStyle(tint)}>
    <button className="ar-back" onClick={onBack}><ArrowLeft size={16}/> Назад</button>
    {pageLoading && !page ? <HeroSkeleton/> : page ? <div className="ar-hero" style={heroImage ? { '--ar-photo': `url("${heroImage.replace(/"/g, '')}")` } as CSSProperties : undefined}>
      <span className="ar-hero-backdrop"/>
      <span className="ar-hero-grain"/>
      <span className="ar-hero-aura"/>
      <div className="ar-hero-art">
        {heroImage ? <img src={heroImage} alt={info?.name || artist.name}/> : <span className="ar-hero-mono">{(info?.name || artist.name).slice(0, 2).toUpperCase()}</span>}
        <span className="ar-hero-ring"><i/><i/></span>
        <span className="ar-hero-badge"><Radio size={12}/> ARTIST</span>
      </div>
      <div className="ar-hero-copy">
        <span className="ar-kicker">KINETIX / ИСПОЛНИТЕЛЬ</span>
        <h1>{info?.name || artist.name}<i>.</i></h1>
        <div className="ar-meta">
          {info?.fans ? <span><Heart size={13}/> {compactNumber(info.fans)} слушателей</span> : null}
          {info?.albums ? <span><Disc3 size={13}/> {info.albums} {plural(info.albums, 'релиз', 'релиза', 'релизов')}</span> : null}
          {tracks.length ? <span><Music2 size={13}/> {tracks.length} {plural(tracks.length, 'трек', 'трека', 'треков')}{totalDuration ? ` · ${totalDuration}` : ''}</span> : null}
        </div>
        {knownTags.length ? <div className="ar-tags">{knownTags.map(tag => <span key={tag}>{tag}</span>)}</div> : null}
        <div className="ar-actions">
          <button className="ar-play" onClick={() => playAll(tracks)} disabled={tracksLoading || !tracks.length}>{tracksLoading ? <Loader2 className="spin" size={17}/> : <Play size={17} fill="currentColor"/>} Слушать всё</button>
          <button className="ar-ghost" onClick={() => shuffleTracks(tracks)} disabled={tracksLoading || !tracks.length}><Shuffle size={16}/> Перемешать</button>
          <button className={`ar-follow ${followed ? 'is-followed' : ''}`} onClick={toggleFollow}>{followed ? <Check size={16}/> : <Plus size={16}/>} {followed ? 'Отслеживается' : 'Отслеживать'}</button>
          <button className="ar-icon" onClick={() => onRecommendations(tracks[0] || null, 'artist')} title="Похожие исполнители и треки" aria-label="Похожие исполнители и треки"><Wand2 size={17}/></button>
          {info?.link ? <a className="ar-icon" href={info.link} target="_blank" rel="noreferrer" title="Открыть источник" aria-label="Открыть источник"><ArrowUpRight size={17}/></a> : null}
        </div>
      </div>
      <span className="ar-hero-digits">{String(tracks.length || releases.length || 0).padStart(2, '0')}</span>
    </div> : <div className="ar-error"><span className="ar-error-orb"><Radio size={28}/></span><h2>Не удалось открыть исполнителя.</h2><p>{pageError || 'Попробуйте ещё раз — источник мог временно не ответить.'}</p><div><button className="ar-play" onClick={() => setNonce(value => value + 1)}><RefreshCw size={16}/> Повторить</button><button className="ar-ghost" onClick={onBack}>Вернуться назад</button></div></div>}

    <section className="ar-section">
      <div className="ar-section-head"><div><span className="ar-kicker">САМОЕ ГРОМКОЕ</span><h2>Популярные треки <i>✳</i></h2></div><div className="ar-section-tools"><SourcePicker value={source} onChange={onSource} available={usableSources({ vkEnabled, vkIssue, youtubeDl })} yandexFull={yandexFull} youtubeDl={youtubeDl} vkIssue={vkIssue} compact/>{tracks.length > 10 ? <button className="ar-link" onClick={() => setShowAllTracks(value => !value)}>{showAllTracks ? 'Свернуть' : `Показать все ${tracks.length}`}</button> : null}</div></div>
      {tracksLoading ? <TrackSkeleton rows={7}/> : tracksError ? <div className="ar-note is-error"><Radio size={15}/><span>{tracksError}</span><button onClick={retryTracks}><RefreshCw size={14}/> Повторить</button></div> : tracks.length ? renderTracks(visibleTracks) : <div className="ar-empty"><Music2 size={20}/> Для этого исполнителя пока не нашлось доступных треков.</div>}
    </section>

    <section className="ar-section">
      <div className="ar-section-head"><div><span className="ar-kicker">АЛЬБОМЫ · СИНГЛЫ · EP</span><h2>Дропы <i>✳</i></h2></div><span className="ar-count">{releases.length} {plural(releases.length, 'релиз', 'релиза', 'релизов')}</span></div>
      {releases.length ? <>
        <div className="ar-chips">{releaseTypes.map(type => <button key={type} className={releaseFilter === type ? 'active' : ''} onClick={() => setReleaseFilter(type)}>{type === 'all' ? 'Все' : typeLabel(type)} <small>{type === 'all' ? releases.length : counts[type]}</small></button>)}</div>
        <div className="ar-shelf">{filteredReleases.map((release, index) => <button key={`${release.id}-${index}`} className={`ar-drop ${selectedRelease?.id === release.id ? 'is-active' : ''}`} onClick={() => setSelectedRelease(selectedRelease?.id === release.id ? null : release)}>
          <span className="ar-drop-art" style={release.cover ? { backgroundImage: `url("${release.cover.replace(/"/g, '')}")` } : undefined}>{!release.cover && <Disc3 size={28}/>}<span className="ar-drop-year">{release.year || '—'}</span><span className="ar-drop-play"><Play size={16} fill="currentColor"/></span></span>
          <span className="ar-drop-copy"><strong>{release.title}</strong><small>{typeLabel(release.type)}{release.trackCount ? ` · ${release.trackCount} трек${release.trackCount === 1 ? '' : 'ов'}` : ''}</small></span>
        </button>)}</div>
      </> : pageLoading ? <div className="ar-shelf ar-shelf-skeleton">{Array.from({ length: 6 }, (_, index) => <span className="ar-drop-skeleton" key={index}/>)}</div> : <div className="ar-empty"><CalendarDays size={20}/> Релизы этого исполнителя пока недоступны.</div>}
      {selectedRelease ? <div className="ar-release">
        <div className="ar-release-head">
          <span className="ar-release-art" style={selectedRelease.cover ? { backgroundImage: `url("${selectedRelease.cover.replace(/"/g, '')}")` } : undefined}/>
          <span className="ar-release-copy"><small>{typeLabel(selectedRelease.type)}{selectedRelease.year ? ` · ${selectedRelease.year}` : ''}</small><strong>{selectedRelease.title}</strong><span>{releaseData ? `${releaseData.tracks.length} ${plural(releaseData.tracks.length, 'трек', 'трека', 'треков')}${releaseData.previewCount ? ` · ${releaseData.previewCount} превью` : ''}` : 'Загружаем треки…'}</span></span>
          <span className="ar-release-actions">
            <button className="ar-play" onClick={() => releaseData && playAll(releaseData.tracks)} disabled={!releaseData?.tracks.length}><Play size={16} fill="currentColor"/> Слушать</button>
            <button className="ar-icon" onClick={() => releaseData && shuffleTracks(releaseData.tracks)} disabled={!releaseData?.tracks.length} aria-label="Перемешать релиз"><Shuffle size={16}/></button>
            <button className="ar-icon" onClick={() => setSelectedRelease(null)} aria-label="Закрыть релиз"><X size={16}/></button>
          </span>
        </div>
        {releaseData?.previewCount ? <div className="ar-note"><Sparkles size={15}/> {releaseData.previewCount} из {releaseData.tracks.length} треков доступны как 30-секундные превью.</div> : null}
        {releaseLoading ? <TrackSkeleton rows={5}/> : releaseError ? <div className="ar-note is-error"><Radio size={15}/><span>{releaseError}</span><button onClick={() => setSelectedRelease(selectedRelease)}><RefreshCw size={14}/> Повторить</button></div> : releaseData ? renderTracks(releaseData.tracks) : null}
      </div> : null}
    </section>

    {page?.related?.length ? <section className="ar-section">
      <div className="ar-section-head"><div><span className="ar-kicker">РЯДОМ ПО ЗВУКУ</span><h2>Похожие исполнители</h2></div></div>
      <div className="ar-related">{page.related.map(item => <button key={item.id} onClick={() => onArtist({ name: item.name, id: item.id, image: item.image })}>
        <span className="ar-related-art" style={item.image ? { backgroundImage: `url("${item.image.replace(/"/g, '')}")` } : undefined}>{!item.image && item.name.slice(0, 2).toUpperCase()}</span>
        <span className="ar-related-copy"><strong>{item.name}</strong><small>{compactNumber(item.fans)} слушателей</small></span>
        <ArrowUpRight size={14}/>
      </button>)}</div>
    </section> : null}
    {page && <div className="ar-foot"><span>Треки: YouTube · Яндекс Музыка · ВКонтакте</span><button onClick={() => onNotice('Страница исполнителя собрана из открытых каталогов')}>KINETIX ARTIST INDEX</button></div>}
  </section>
}
