import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, AudioLines, Car, Disc3, Dumbbell, Flame, Guitar, Headphones, Mic2, Moon, Orbit, Play, Radio, Search, Shuffle, Sparkles, Waves, X, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { catalogGroups, catalogMixes, type CatalogEntry, type CatalogGroup } from './catalogData'
import { artistByName } from './catalog'
import { ArtistFace } from './artistFace'
import { SourcePicker, sourceLabel, usableSources, type SearchSource } from './views'

const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const groupIcons: Record<string, LucideIcon> = {
  'new-wave': Zap,
  underground: Radio,
  'russian-rap': Mic2,
  pop: Sparkles,
  indie: Guitar,
  electronic: Disc3,
  world: Orbit,
  rock: Waves,
  'hiphop-us': Headphones,
}
const groupIcon = (group: CatalogGroup) => groupIcons[group.id] ?? Disc3
const groupOf = (entry: CatalogEntry) => entry.kind === 'artist'
  ? catalogGroups.find(group => group.entries.some(item => item.id === entry.id))
  : undefined

const mixVisuals: Array<{ icon: LucideIcon; kicker: string }> = [
  { icon: Flame, kicker: 'ГОРЯЧЕЕ' },
  { icon: Zap, kicker: 'БАС' },
  { icon: Sparkles, kicker: 'ХИТЫ' },
  { icon: Guitar, kicker: 'ГИТАРЫ' },
  { icon: Moon, kicker: 'ФОКУС' },
  { icon: Disc3, kicker: 'КЛУБ' },
  { icon: Car, kicker: 'НОЧЬ' },
  { icon: Dumbbell, kicker: 'ЭНЕРГИЯ' },
]
const mixVisual = (entry: CatalogEntry) => mixVisuals[Math.max(0, catalogMixes.findIndex(item => item.id === entry.id)) % mixVisuals.length]

const allEntries = catalogGroups.flatMap(group => group.entries)
const totalArtists = allEntries.length
const shuffleList = <T,>(list: T[]) => [...list].sort(() => Math.random() - .5)

function pickHeroPicks(): CatalogEntry[] {
  const picks: CatalogEntry[] = []
  for (const group of shuffleList(catalogGroups).slice(0, 3)) {
    const entry = group.entries[Math.floor(Math.random() * group.entries.length)]
    if (entry && !picks.some(item => item.id === entry.id)) picks.push(entry)
  }
  for (const entry of shuffleList(allEntries)) {
    if (picks.length >= 4) break
    if (!picks.some(item => item.id === entry.id)) picks.push(entry)
  }
  return picks
}

const tagAliases: Record<string, string> = {
  'инди': 'indie', 'рок': 'rock', 'поп': 'pop', 'электроника': 'electronic', 'хип-хоп': 'hiphop',
  'рэп': 'hiphop', 'трэп': 'hiphop', 'хаус': 'house', 'техно': 'techno', 'эмбиент': 'ambient',
  'лоу-фай': 'lofi', 'lo-fi': 'lofi', 'фонк': 'phonk', 'танцы': 'dance', 'хиты': 'hits',
  'альтернатива': 'alternative', 'постпанк': 'post-punk', 'мелодичный': 'melodic', 'melodic': 'melodic',
}
const tagKey = (value: string) => { const clean = value.trim().toLowerCase(); return tagAliases[clean] || clean }

type TasteProfile = { known: Set<string>; weights: Map<string, number> }

function buildTaste(names: string[]): TasteProfile {
  const known = new Set<string>()
  const weights = new Map<string, number>()
  for (const raw of names) {
    const full = normalize(raw)
    if (full) known.add(full)
    for (const part of raw.split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b)\s*/i).map(normalize)) if (part) known.add(part)
  }
  for (const entry of allEntries) {
    if (!known.has(normalize(entry.name))) continue
    for (const tag of entry.tags) weights.set(tagKey(tag), (weights.get(tagKey(tag)) || 0) + 2)
  }
  for (const name of names) {
    const artist = artistByName(name)
    if (artist) for (const tag of artist.tags) weights.set(tagKey(tag), (weights.get(tagKey(tag)) || 0) + 1)
  }
  return { known, weights }
}

function suggestFocus(taste: TasteProfile, hero: CatalogEntry[], count = 8) {
  const ranked = allEntries
    .filter(entry => !hero.some(item => item.id === entry.id) && !taste.known.has(normalize(entry.name)))
    .map(entry => ({ entry, score: entry.tags.reduce((sum, tag) => sum + (taste.weights.get(tagKey(tag)) || 0), 0) + Math.random() * .6 }))
    .filter(item => item.score > .6)
    .sort((a, b) => b.score - a.score)
  const picks = ranked.slice(0, count).map(item => item.entry)
  for (const entry of shuffleList(allEntries)) {
    if (picks.length >= count) break
    if (hero.some(item => item.id === entry.id) || picks.some(item => item.id === entry.id)) continue
    picks.push(entry)
  }
  return picks
}

function moodCounts(entries: CatalogEntry[]) {
  const counts = new Map<string, number>()
  for (const entry of entries) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

function MixCard({ entry, onOpen, decorative = false }: { entry: CatalogEntry; onOpen: () => void; decorative?: boolean }) {
  const visual = mixVisual(entry)
  return <button className="cat-mix" style={{ '--tint': entry.tint } as CSSProperties} onClick={onOpen} tabIndex={decorative ? -1 : undefined} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `Открыть подборку: ${entry.name}`}>
    <span className="cat-mix-glow"/>
    <span className="cat-mix-top">
      <span className="cat-mix-icon"><visual.icon size={19}/></span>
      <span className="cat-mix-bars" aria-hidden="true"><i/><i/><i/><i/></span>
    </span>
    <span className="cat-mix-copy"><small>{visual.kicker} · ПОДБОРКА</small><strong>{entry.name}</strong><em>{entry.tags.join(' · ')}</em></span>
    <span className="cat-mix-go"><ArrowUpRight size={16}/></span>
  </button>
}

function CyclicMixes({ entries, onOpen, motion }: { entries: CatalogEntry[]; onOpen: (entry: CatalogEntry) => void; motion: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)
  pausedRef.current = paused
  const hoverable = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches, [])
  useEffect(() => {
    const track = trackRef.current
    if (!track || entries.length < 2 || !motion) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    let last = 0
    let half = 0
    let position = 0
    let interacting = false
    let resumeAt = 0
    const measure = () => {
      const next = track.scrollWidth / 2
      if (!Number.isFinite(next) || next <= 0) return
      half = next
      if (position <= 0 || position > half) position = Math.min(half, Math.max(1, position || 1))
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
        position -= delta * 0.026
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
  }, [entries.length, motion])
  return <div ref={trackRef} className={`cat-rail cat-rail-mixes cat-rail-cycle ${paused ? 'is-paused' : ''}`} {...(hoverable ? { onMouseEnter: () => setPaused(true), onMouseLeave: () => setPaused(false) } : {})} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
    {[...entries, ...entries].map((entry, index) => <MixCard key={`${entry.id}-${index >= entries.length ? 'copy' : 'main'}`} entry={entry} decorative={index >= entries.length} onOpen={() => onOpen(entry)}/>)}
  </div>
}

function ArtistTile({ entry, onOpen }: { entry: CatalogEntry; onOpen: () => void }) {
  return <button className="cat-tile" style={{ '--tint': entry.tint } as CSSProperties} onClick={onOpen} aria-label={`Открыть каталог: ${entry.name}`}>
    <span className="cat-tile-glow"/>
    <span className="cat-tile-face"><ArtistFace name={entry.name}/></span>
    <span className="cat-tile-copy"><strong>{entry.name}</strong><small>{entry.tags.join(' · ')}</small></span>
    <span className="cat-tile-go"><ArrowUpRight size={15}/></span>
  </button>
}

function CollectionCard({ group, onOpen }: { group: CatalogGroup; onOpen: () => void }) {
  const Icon = groupIcon(group)
  return <button className="cat-collection-card" style={{ '--tint': group.tint } as CSSProperties} onClick={onOpen} aria-label={`Открыть коллекцию: ${group.label}`}>
    <span className="cat-collection-card-glow"/>
    <span className="cat-collection-card-top">
      <span className="cat-collection-card-icon"><Icon size={18}/></span>
      <span className="cat-collage">{group.entries.slice(0, 3).map(entry => <span key={entry.id}><ArtistFace name={entry.name}/></span>)}</span>
    </span>
    <span className="cat-collection-card-copy">
      <small>{group.subtitle}</small>
      <strong>{group.label}</strong>
      <em>{group.description}</em>
    </span>
    <span className="cat-collection-card-foot">
      <span>{group.entries.length} исполнителей</span>
      <span className="cat-collection-card-go"><ArrowUpRight size={15}/></span>
    </span>
  </button>
}

export function CatalogView({ selected, loading, error, tracksCount, youtubeDl, yandexFull, vkEnabled, vkIssue, source, onSource, trackList, onSelect, onClear, onPlayAll, onShuffle, tasteNames = [], motion = true }: {
  selected: CatalogEntry | null
  loading: boolean
  error: string
  tracksCount: number
  youtubeDl: boolean
  yandexFull: boolean
  vkEnabled: boolean
  vkIssue: string
  source: SearchSource
  onSource: (source: SearchSource) => void
  trackList: ReactNode
  onSelect: (entry: CatalogEntry) => void
  onClear: () => void
  onPlayAll: () => void
  onShuffle?: () => void
  tasteNames?: string[]
  motion?: boolean
}) {
  const [query, setQuery] = useState('')
  const [mood, setMood] = useState('')
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [heroPicks] = useState(pickHeroPicks)
  const collectionsRef = useRef<HTMLDivElement>(null)
  const needle = normalize(query)
  const active = Boolean(needle || mood)
  const tasteKey = tasteNames.join('|')
  const tasteProfile = useMemo(() => buildTaste(tasteNames), [tasteKey])
  const personalized = tasteProfile.weights.size > 0
  const focusPicks = useMemo(() => suggestFocus(tasteProfile, heroPicks), [tasteProfile, heroPicks])

  const moods = useMemo(() => moodCounts(allEntries).filter(([, count]) => count >= 3).slice(0, 10), [])
  const searchGroups = useMemo(() => catalogGroups
    .map(group => ({
      ...group,
      entries: group.entries.filter(entry => (!mood || entry.tags.includes(mood)) && (!needle || normalize(`${entry.name} ${entry.tags.join(' ')}`).includes(needle))),
    }))
    .filter(group => group.entries.length), [needle, mood])
  const searchMixes = useMemo(() => catalogMixes.filter(entry => (!mood || entry.tags.includes(mood)) && (!needle || normalize(`${entry.name} ${entry.tags.join(' ')}`).includes(needle))), [needle, mood])

  const collection = catalogGroups.find(item => item.id === openGroup) || null
  const collectionMoods = collection ? moodCounts(collection.entries).filter(([, count]) => count >= 2).slice(0, 8) : []
  const collectionEntries = collection ? collection.entries.filter(entry => !mood || entry.tags.includes(mood)) : []
  const found = searchGroups.reduce((sum, group) => sum + group.entries.length, 0) + searchMixes.length

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [openGroup, selected?.id])

  function openCollection(id: string) { setOpenGroup(id); setMood(''); setQuery('') }
  function openEntry(entry: CatalogEntry, from: string | null = null) { setOpenGroup(from); onSelect(entry) }
  function surprise(pool: CatalogEntry[], from: string | null = null) {
    if (!pool.length) return
    openEntry(pool[Math.floor(Math.random() * pool.length)], from)
  }
  function reset() { setQuery(''); setMood('') }

  if (selected) {
    const parent = groupOf(selected)
    const related = selected.kind === 'artist'
      ? (parent?.entries.filter(entry => entry.id !== selected.id).slice(0, 4) || [])
      : catalogMixes.filter(entry => entry.id !== selected.id).slice(0, 4)
    const backLabel = collection?.label || 'Все каталоги'
    return <section className="page-section cat-page">
      <div className="page-kicker">KINETIX / КАТАЛОГИ / {selected.kind === 'mix' ? 'ПОДБОРКА' : (parent?.label || 'ИСПОЛНИТЕЛЬ')}</div>
      <button className="catalog-back" onClick={onClear}><ArrowLeft size={16}/> {backLabel}</button>
      <div className={`catalog-hero ${selected.kind === 'mix' ? 'catalog-hero-is-mix' : ''}`} style={{ '--tint': selected.tint } as CSSProperties}>
        <span className="catalog-hero-glow"/>
        <span className="catalog-hero-noise"/>
        {selected.kind === 'mix'
          ? <span className="catalog-hero-avatar catalog-hero-mix"><span className="catalog-hero-mix-bars" aria-hidden="true"><i/><i/><i/><i/><i/></span><Zap size={46}/></span>
          : <span className="catalog-hero-avatar"><ArtistFace name={selected.name}/></span>}
        <div className="catalog-hero-copy">
          <small>{selected.kind === 'mix' ? 'ПОДБОРКА' : `ИСПОЛНИТЕЛЬ${parent ? ` · ${parent.label.toUpperCase()}` : ''}`}</small>
          <h1>{selected.name}<i>.</i></h1>
          <p>{selected.tags.join(' · ')}</p>
          <div className="catalog-hero-meta">
            <span><Disc3 size={13}/>{loading ? 'Собираем треки…' : tracksCount ? `${tracksCount} треков` : 'Каталог готов'}</span>
            <span>{sourceLabel(source)}</span>
          </div>
          <div className="catalog-hero-picker"><SourcePicker value={source} onChange={onSource} available={usableSources({ vkEnabled, vkIssue, youtubeDl, yandexEnabled: yandexFull })} yandexFull={yandexFull} youtubeDl={youtubeDl} vkIssue={vkIssue} compact inline/></div>
        </div>
        <div className="catalog-hero-actions">
          <button className="primary-btn catalog-play" onClick={onPlayAll} disabled={!tracksCount}><Play size={17} fill="currentColor"/> Слушать всё</button>
          {onShuffle && <button className="catalog-hero-secondary" onClick={onShuffle} disabled={!tracksCount}><Shuffle size={14}/> Перемешать</button>}
        </div>
      </div>
      {loading && <div className="loading-row"><Disc3 className="spin" size={20}/> Собираем каталог…</div>}
      {error && <div className="api-hint"><Flame size={20}/><div><strong>Не удалось открыть каталог</strong><span>{error}</span></div></div>}
      {!loading && !error && !tracksCount && <div className="empty-small"><Flame size={20}/> Здесь пока нет треков. Попробуйте другого исполнителя или подборку.</div>}
      {tracksCount > 0 && <><div className="track-list-header"><span>ТРЕК</span><span>ИСТОЧНИК</span><span>ВРЕМЯ</span></div>{trackList}</>}
      {related.length > 0 && <div className="catalog-related">
        <div className="section-heading"><div><span className="section-kicker">{selected.kind === 'artist' ? 'РЯДОМ ПО ЗВУЧАНИЮ' : 'ПРОДОЛЖИТЬ НАСТРОЕНИЕ'}</span><h3>{selected.kind === 'artist' ? `Ещё из «${parent?.label || 'каталога'}»` : 'Другие подборки'}</h3></div></div>
        <div className="catalog-strip">{related.map(entry => {
          const visual = entry.kind === 'mix' ? mixVisual(entry) : null
          return <button key={entry.id} onClick={() => openEntry(entry, entry.kind === 'artist' ? openGroup : null)}>
            {visual ? <span className="catalog-strip-avatar catalog-strip-mix"><visual.icon size={20}/></span> : <span className="catalog-strip-avatar"><ArtistFace name={entry.name}/></span>}
            <span className="catalog-strip-copy"><strong>{entry.name}</strong><small>{visual ? 'подборка' : entry.tags[0]}</small></span>
            <ArrowRight size={16}/>
          </button>
        })}</div>
      </div>}
    </section>
  }

  if (collection) {
    const Icon = groupIcon(collection)
    return <section className="page-section cat-page">
      <div className="page-kicker">KINETIX / КАТАЛОГИ / {collection.subtitle}</div>
      <button className="catalog-back" onClick={() => { setOpenGroup(null); setMood('') }}><ArrowLeft size={16}/> Все коллекции</button>
      <div className="cat-collection" style={{ '--tint': collection.tint } as CSSProperties}>
        <span className="cat-collection-glow"/>
        <span className="cat-collection-icon"><Icon size={30}/></span>
        <div className="cat-collection-copy">
          <small>{collection.subtitle}</small>
          <h1>{collection.label}<i>.</i></h1>
          <p>{collection.description}</p>
          <div className="cat-collection-meta">
            <span><AudioLines size={13}/>{collection.entries.length} исполнителей</span>
            <span><Sparkles size={13}/>{collectionMoods.length} настроений</span>
          </div>
        </div>
        <div className="cat-collection-actions">
          <button className="cat-ghost" onClick={() => surprise(collection.entries, collection.id)}><Shuffle size={15}/> Случайный</button>
        </div>
      </div>
      {collectionMoods.length > 0 && <div className="cat-moods cat-moods-scoped">
        <span>Внутри</span>
        {collectionMoods.map(([tag, count]) => <button key={tag} className={mood === tag ? 'active' : ''} onClick={() => setMood(mood === tag ? '' : tag)}>{tag}<em>{count}</em></button>)}
        {mood && <button className="cat-moods-reset" onClick={() => setMood('')}><X size={12}/> Сбросить</button>}
      </div>}
      <div className="cat-artists">{collectionEntries.map(entry => <ArtistTile key={entry.id} entry={entry} onOpen={() => openEntry(entry, collection.id)}/>)}</div>
      {!collectionEntries.length && <div className="empty-small"><Flame size={20}/> В этой коллекции пока нет такого настроения.</div>}
      <div className="cat-section">
        <div className="section-heading"><div><span className="section-kicker">ДАЛЬШЕ ПО ВОЛНЕ</span><h2>Другие коллекции</h2></div><span className="genre-count">{catalogGroups.length} коллекций</span></div>
        <div className="cat-rail cat-rail-collections">{catalogGroups.filter(item => item.id !== collection.id).map(item => <CollectionCard key={item.id} group={item} onOpen={() => openCollection(item.id)}/>)}</div>
      </div>
    </section>
  }

  const pool = active ? [...searchGroups.flatMap(group => group.entries), ...searchMixes] : [...allEntries, ...catalogMixes]

  return <section className="page-section cat-page">
    <div className="page-kicker">KINETIX / КАТАЛОГИ</div>
    <div className="cat-hero">
      <span className="cat-hero-glow"/>
      <span className="cat-hero-lines" aria-hidden="true"/>
      <div className="cat-hero-main">
        <span className="cat-hero-tag"><Sparkles size={13}/> БИБЛИОТЕКА KINETIX</span>
        <h1>Огромные<br/><em>каталоги.</em></h1>
        <p>Популярные исполнители, редакционные подборки и настроения. Треки подгружаются из YouTube, Яндекс Музыки и ВКонтакте.</p>
        <div className="cat-hero-actions">
          <button className="primary-btn" onClick={() => surprise(pool)}><Shuffle size={16}/> Удиви меня</button>
          <button className="cat-ghost" onClick={() => collectionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Все коллекции <ArrowRight size={15}/></button>
        </div>
        <div className="cat-stats">
          <span><strong>{totalArtists}</strong><small>исполнителей</small></span>
          <span><strong>{catalogGroups.length}</strong><small>коллекций</small></span>
          <span><strong>{catalogMixes.length}</strong><small>подборок</small></span>
        </div>
      </div>
      <div className="cat-hero-stage">{heroPicks.map(entry => <button key={entry.id} className="cat-hero-pick" style={{ '--tint': entry.tint } as CSSProperties} onClick={() => openEntry(entry)}>
        <span className="cat-hero-pick-face"><ArtistFace name={entry.name}/></span>
        <span className="cat-hero-pick-copy"><strong>{entry.name}</strong><small>{entry.tags[0]}</small></span>
      </button>)}</div>
    </div>
    {!youtubeDl && <div className="api-hint"><Flame size={20}/><div><strong>yt-dlp не найден</strong><span>Установите yt-dlp или укажите путь в YTDLP_PATH и перезапустите сервер, чтобы каталоги загружали треки.</span></div></div>}
    <div className="cat-toolbar">
      <Search size={18}/>
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Исполнитель, подборка или настроение" aria-label="Поиск по каталогам"/>
      {query && <button className="cat-clear" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={14}/></button>}
      <button className="cat-surprise" onClick={() => surprise(pool)}><Shuffle size={15}/><span>Удиви меня</span></button>
    </div>
    <div className="cat-moods"><span>Настроение</span>{moods.map(([tag, count]) => <button key={tag} className={mood === tag ? 'active' : ''} onClick={() => setMood(mood === tag ? '' : tag)}>{tag}<em>{count}</em></button>)}</div>

    {active ? <div className="cat-results">
      <div className="cat-results-head">
        <div><span className="section-kicker">ПОИСК ПО КАТАЛОГАМ</span><h2>{needle ? `«${query.trim()}»` : `Настроение «${mood}»`}</h2></div>
        <div className="cat-results-side"><span className="genre-count">{found} найдено</span><button className="cat-reset" onClick={reset}><X size={12}/> Сбросить</button></div>
      </div>
      {searchGroups.map(group => {
        const Icon = groupIcon(group)
        return <div className="cat-group-block" key={group.id}>
          <div className="cat-group-head">
            <span className="cat-group-head-icon" style={{ '--tint': group.tint } as CSSProperties}><Icon size={15}/></span>
            <h3>{group.label}</h3>
            <em>{group.entries.length}</em>
            <button className="cat-group-open" onClick={() => openCollection(group.id)}>Коллекция <ArrowRight size={13}/></button>
          </div>
          <div className="cat-artists">{group.entries.map(entry => <ArtistTile key={entry.id} entry={entry} onOpen={() => openEntry(entry)}/>)}</div>
        </div>
      })}
      {searchMixes.length > 0 && <div className="cat-group-block">
        <div className="cat-group-head"><span className="cat-group-head-icon"><AudioLines size={15}/></span><h3>Подборки</h3><em>{searchMixes.length}</em></div>
        <div className="cat-rail">{searchMixes.map(entry => <MixCard key={entry.id} entry={entry} onOpen={() => openEntry(entry)}/>)}</div>
      </div>}
      {!found && <div className="empty-state"><div className="empty-art"><Search size={34}/></div><h3>Ничего не нашли</h3><p>Попробуй другое имя или настроение — в каталогах точно есть что-то по твоей волне.</p><button className="primary-btn" onClick={reset}>Сбросить фильтры</button></div>}
    </div> : <>
      <div className="cat-section" ref={collectionsRef}>
        <div className="section-heading"><div><span className="section-kicker">НАВИГАЦИЯ</span><h2>Коллекции</h2></div><span className="genre-count">{catalogGroups.length} коллекций</span></div>
        <div className="cat-collections">{catalogGroups.map(group => <CollectionCard key={group.id} group={group} onOpen={() => openCollection(group.id)}/>)}</div>
      </div>
      <div className="cat-section">
        <div className="section-heading"><div><span className="section-kicker">ГОТОВЫЕ НАСТРОЕНИЯ</span><h2>Подборки</h2></div><span className="catalog-mixes-count">{catalogMixes.length} миксов · лента крутится</span></div>
        <CyclicMixes entries={catalogMixes} onOpen={entry => openEntry(entry)} motion={motion}/>
      </div>
      <div className="cat-section">
        <div className="section-heading"><div><span className="section-kicker">{personalized ? 'ПОДОБРАНО ПОД ТВОЙ ВКУС' : 'ОТКРЫТИЯ КАТАЛОГА'}</span><h2>{personalized ? 'Новые имена рядом' : 'Стоит послушать'}</h2></div><span className="genre-count">{personalized ? 'по медиатеке и подпискам' : 'свежая выборка'}</span></div>
        <div className="cat-rail cat-rail-focus">{focusPicks.map(entry => <button key={entry.id} className="cat-focus" style={{ '--tint': entry.tint } as CSSProperties} onClick={() => openEntry(entry)}>
          <span className="cat-focus-face"><ArtistFace name={entry.name}/></span>
          <span className="cat-focus-copy"><strong>{entry.name}</strong><small>{entry.tags.join(' · ')}</small></span>
          <span className="cat-focus-go"><ArrowUpRight size={15}/></span>
        </button>)}</div>
      </div>
    </>}
  </section>
}
