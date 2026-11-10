import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeft, Clock3, Disc3, ListMusic, Loader2, Music2, Play, Plus, Radio, RefreshCw, Shuffle, Trash2, Wand2, X } from 'lucide-react'
import type { Track } from './types'
import { SourcePicker, sourceLabel, usableSources, type SearchSource } from './views'

const totalDuration = (tracks: Track[]) => tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
const durationLabel = (tracks: Track[]) => { const value = totalDuration(tracks); if (!value) return '—'; const minutes = Math.round(value / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)} ч ${minutes % 60} мин` : `${minutes} мин` }
const hueFrom = (value: string) => [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360

export function RecommendationsView({ seed, scope, mode, collection, tracks, loading, error, current, playing, source, onSource, vkEnabled, vkIssue, yandexFull, youtubeDl, mixArt, mixReady, onBack, onPlayAll, onShuffle, onRefresh, onSearch, onFindSeeds, onModeChange, onRemoveSeed, onClearCollection, trackList }: {
  seed: Track | null
  scope: 'track' | 'artist'
  mode: 'mix' | 'seed' | 'collection'
  collection: Track[]
  tracks: Track[]
  loading: boolean
  error: string
  current: Track | null
  playing: boolean
  source: SearchSource
  onSource: (source: SearchSource) => void
  vkEnabled: boolean
  vkIssue: string
  yandexFull: boolean
  youtubeDl: boolean
  mixArt: string[]
  mixReady: boolean
  onBack: () => void
  onPlayAll: () => void
  onShuffle: () => void
  onRefresh: () => void
  onSearch: () => void
  onFindSeeds: () => void
  onModeChange: (mode: 'mix' | 'seed' | 'collection') => void
  onRemoveSeed: (id: string) => void
  onClearCollection: () => void
  trackList: ReactNode
}) {
  const available = usableSources({ vkEnabled, vkIssue, youtubeDl })
  const artworks = (mode === 'collection' ? [...collection.map(track => track.artwork), ...tracks.map(track => track.artwork)] : mode === 'mix' ? [...mixArt, ...tracks.map(track => track.artwork)] : [seed?.artwork, ...tracks.map(track => track.artwork)]).filter((value): value is string => Boolean(value)).slice(0, 3)
  const artists = [...new Map(tracks.filter(track => track.artist).map(track => [track.artist.toLowerCase(), track.artist])).values()].slice(0, 7)
  const hue = hueFrom(mode === 'collection' ? collection.map(track => `${track.artist} ${track.title}`).join(' ') || 'kinetix collection' : mode === 'mix' ? 'kinetix mix' : seed ? `${seed.artist} ${seed.title}` : 'kinetix recommendations')
  const hasSeeds = mode === 'mix' ? mixReady : mode === 'collection' && collection.length > 0 || mode === 'seed' && Boolean(seed)
  const title = mode === 'mix' ? <>Твой <em>микс.</em></> : mode === 'collection' ? <>Твой <em>поток.</em></> : <>Рекомендации<i>.</i></>
  const kicker = mode === 'mix' ? 'KINETIX / ЛИЧНЫЙ МИКС' : mode === 'collection' ? 'KINETIX / РЕКОМЕНДАЦИИ ВЫБОРКОЙ' : 'KINETIX / ПЕРСОНАЛЬНЫЙ ПОТОК'
  const intro = mode === 'mix'
    ? 'Собрано из твоей медиатеки, любимых треков и подписок — плюс новые исполнители рядом с тем, что ты слушаешь.'
    : null
  return <section className="rec-page page-section">
    <button className="catalog-back" onClick={onBack}><ArrowLeft size={16}/> На главную</button>
    <div className="rec-topbar">
      <div className="rec-modes"><button className={mode === 'mix' ? 'active' : ''} onClick={() => onModeChange('mix')}>Для тебя</button><button className={mode === 'seed' ? 'active' : ''} onClick={() => onModeChange('seed')}>По треку</button><button className={mode === 'collection' ? 'active' : ''} onClick={() => onModeChange('collection')}>Моя подборка {collection.length > 0 && <em>{collection.length}</em>}</button></div>
      <SourcePicker value={source} onChange={onSource} available={available} yandexFull={yandexFull} youtubeDl={youtubeDl} vkIssue={vkIssue} compact/>
    </div>
    <div className="rec-hero" style={{ '--rec-hue': hue } as CSSProperties}>
      <span className="rec-hero-aurora"/>
      <span className="rec-hero-grid"/>
      <span className="rec-hero-rings"><i/><i/><i/></span>
      <div className="rec-hero-art">
        <span className="rec-hero-vinyl"/>
        <span className="rec-hero-stack">
          {artworks.map((artwork, index) => <i key={`${artwork}-${index}`} className={`rec-hero-cover is-${index}`} style={{ backgroundImage: `url("${artwork.replace(/"/g, '')}")` }}/>)}
          {!artworks.length && <i className="rec-hero-cover is-0 rec-hero-cover-empty"><Music2 size={38}/></i>}
        </span>
        <span className="rec-hero-equalizer">{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ '--n': index } as CSSProperties}/>)}</span>
        <span className="rec-hero-live"><span/> LIVE MIX</span>
      </div>
      <div className="rec-hero-copy">
        <span className="page-kicker">{kicker}</span>
        <h1>{title}</h1>
        <p>{mode === 'collection'
          ? collection.length
            ? <>Собрано по твоей подборке из <strong>{collection.length}</strong> {collection.length === 1 ? 'трека' : 'треков'} — и вокруг каждого нашлось похожее.</>
            : 'Добавь треки в подборку — и мы соберём отдельный поток, не похожий на обычные рекомендации. Менять список можно в любой момент.'
          : mode === 'mix'
            ? intro
            : seed ? scope === 'artist'
              ? <>Похожее на <strong>{seed.artist}</strong> — и рядом то, что может стать твоим следующим любимым.</>
              : <>На основе <strong>«{seed.title}»</strong> · {seed.artist}. Собрано из живого потока и похожих исполнителей.</>
              : 'Включи любой трек — и мы соберём вокруг него живой поток похожего.'}</p>
        <div className="rec-hero-meta">
          <span><Disc3 size={14}/>{tracks.length ? `${tracks.length} треков` : 'собираем поток'}</span>
          <span><Clock3 size={14}/>{durationLabel(tracks)}</span>
          <span><Radio size={14}/>{artists.length ? `${artists.length} артистов` : sourceLabel(source)}</span>
        </div>
        <div className="rec-hero-actions">
          <button className="primary-btn" onClick={onPlayAll} disabled={!tracks.length || loading}><Play size={16} fill="currentColor"/> Слушать всё</button>
          <button className="rec-ghost" onClick={onShuffle} disabled={!tracks.length || loading}><Shuffle size={15}/> Умный шафл</button>
          <button className="rec-icon-btn" onClick={onRefresh} disabled={loading || !hasSeeds} aria-label="Обновить рекомендации" title="Обновить рекомендации"><RefreshCw className={loading ? 'spin' : ''} size={16}/></button>
        </div>
      </div>
    </div>
    {mode === 'collection' && <div className="rec-collection">
      <div className="rec-collection-head">
        <div><span>ПОДБОРКА ДЛЯ ПОТОКА</span><strong>{collection.length ? `${collection.length} ${collection.length === 1 ? 'трек' : collection.length < 5 ? 'трека' : 'треков'} · меняй когда угодно` : 'Пока пусто'}</strong></div>
        <button className="rec-collection-clear" onClick={onClearCollection} disabled={!collection.length} aria-label="Очистить подборку" title="Очистить подборку"><Trash2 size={14}/></button>
      </div>
      {collection.length ? <div className="rec-collection-chips">
        {collection.map(track => <span className="rec-seed" key={track.id}>
          <span className="rec-seed-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && <Music2 size={13}/>}</span>
          <span className="rec-seed-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
          <button onClick={() => onRemoveSeed(track.id)} aria-label={`Убрать ${track.title}`} title="Убрать из подборки"><X size={12}/></button>
        </span>)}
        <button className="rec-seed-add" onClick={onFindSeeds}><Plus size={14}/> Добавить треки</button>
      </div> : <div className="rec-collection-empty"><ListMusic size={22}/><p>Добавляй треки через меню «⋯» → «В подборку рекомендаций». Поток будет отдельным от обычных рекомендаций.</p><button className="rec-ghost" onClick={onFindSeeds}>Найти треки</button></div>}
    </div>}
    {loading ? <div className="rec-loading">
      <div className="rec-loading-head"><span className="rec-loading-orbit"><Disc3 size={21}/></span><div><strong>{mode === 'mix' ? 'Собираем твой микс' : 'Собираем похожее'}</strong><small>{sourceLabel(source)} · {mode === 'mix' ? 'медиатека, подписки и похожие имена' : 'подбираем треки под твой звук'}</small></div><Loader2 className="spin" size={19}/></div>
      {Array.from({ length: 6 }, (_, index) => <span className="rec-skeleton" key={index} style={{ '--n': index } as CSSProperties}><i/><i/><i/></span>)}
    </div> : error ? <div className="api-hint rec-error"><Radio size={20}/><div><strong>{error}</strong><span>Попробуй обновить поток или смени источник.</span></div><button className="rec-error-retry" onClick={onRefresh}>Повторить</button></div>
    : tracks.length ? <>
      <div className="rec-toolbar">
        <div className="rec-chips"><span>В ПОТОКЕ</span>{artists.map(artist => <em key={artist}>{artist}</em>)}</div>
        <span className="rec-note">{mode === 'mix' ? 'Микс из медиатеки и подписок' : mode === 'collection' ? 'Поток по твоей подборке' : scope === 'artist' ? 'Похожие исполнители' : sourceLabel(source)} · {playing && current ? `сейчас: ${current.artist}` : 'готов к запуску'}</span>
      </div>
      <div className="track-list-header"><span>ТРЕК</span><span>ИСТОЧНИК</span><span>ВРЕМЯ</span></div>
      {trackList}
    </> : <div className="rec-empty">
      <span className="rec-empty-orb"><Wand2 size={30}/></span>
      <h3>{mode === 'mix' ? mixReady ? 'Микс не собрался' : 'Нужна музыка для микса' : mode === 'collection' ? collection.length ? 'Поток не собрался' : 'Собери подборку' : seed ? 'Поток не собрался' : 'Нужен первый трек'}</h3>
      <p>{mode === 'mix'
        ? mixReady ? 'Источник не отдал похожие треки. Попробуй обновить микс или смени источник.' : 'Добавь треки в медиатеку, отметь любимые или подпишись на исполнителей — и мы соберём микс под твой вкус.'
        : mode === 'collection'
          ? collection.length ? 'Источник не отдал похожие треки. Попробуй обновить поток, сменить источник или добавить другие треки в подборку.' : 'Добавь 2–3 трека, по которым нужен отдельный поток подборки.'
          : seed ? 'Источник не отдал похожие треки. Попробуй обновить поток, сменить источник или выбрать другой трек.' : 'Включи музыку — и рекомендации появятся здесь как живой поток.'}</p>
      <div className="rec-empty-actions"><button className="primary-btn" onClick={mode === 'mix' ? onSearch : mode === 'collection' ? onFindSeeds : onSearch}>{mode === 'mix' ? 'Найти музыку' : mode === 'collection' ? 'Найти треки' : 'Найти трек'}</button>{(mode === 'mix' ? mixReady : seed || collection.length > 0) && <button className="rec-ghost" onClick={onRefresh}>Обновить</button>}</div>
    </div>}
  </section>
}
