import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowUpRight, Check, Loader2, Move, Plus, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react'
import { artistById, artists, registerArtists, type Artist } from './catalog'

type WallArtist = Artist & { image?: string; imageSource?: string; description?: string; popularity?: number; fans?: number; albums?: number; language?: string; relatedTo?: string; relatedToName?: string }
type WallCard = { artist: WallArtist; x: number; y: number; width: number; height: number; index: number; wide: boolean }
type WallLayout = { cards: WallCard[]; width: number; height: number }
type DragState = { id: number; startX: number; startY: number; ox: number; oy: number; lastX: number; lastY: number; lastAt: number; vx: number; vy: number; moved: boolean }

const genreIds = ['hiphop', 'phonk', 'electronic', 'indie', 'rock', 'pop', 'rnb', 'house', 'techno', 'ambient', 'jazz', 'classical', 'lofi']
const genreOptions = [
  { id: 'all', label: 'Все' },
  { id: 'hiphop', label: 'Рэп' },
  { id: 'phonk', label: 'Фонк' },
  { id: 'electronic', label: 'Электроника' },
  { id: 'indie', label: 'Инди' },
  { id: 'rock', label: 'Рок' },
  { id: 'pop', label: 'Поп' },
  { id: 'rnb', label: 'R&B' },
  { id: 'house', label: 'Хаус' },
  { id: 'techno', label: 'Техно' },
  { id: 'ambient', label: 'Эмбиент' },
  { id: 'jazz', label: 'Джаз' },
  { id: 'classical', label: 'Классика' },
  { id: 'lofi', label: 'Lo-fi' },
]
const genreLabels = Object.fromEntries(genreOptions.map(option => [option.id, option.label]))
const tagAliases: Record<string, string> = {
  'рэп': 'hiphop', 'хип-хоп': 'hiphop', 'трэп': 'hiphop', 'баттл': 'hiphop', 'андеграунд': 'hiphop', 'новая школа': 'hiphop', 'мелодичный': 'hiphop', 'melodic': 'hiphop', 'продюсер': 'hiphop', 'лирика': 'hiphop',
  'поп': 'pop', 'танцы': 'pop', 'хиты': 'pop',
  'рок': 'rock', 'метал': 'rock', 'панк': 'rock', 'постпанк': 'rock', 'гранж': 'rock', 'ню-метал': 'rock', 'металкор': 'rock', 'альтернатива': 'rock', 'индастриал': 'rock',
  'инди': 'indie', 'электроника': 'electronic', 'бас': 'electronic', 'idm': 'electronic', 'экспериментальный': 'electronic', 'трип-хоп': 'electronic', 'фонк': 'phonk', 'фон': 'ambient', 'ночь': 'phonk',
  'r&b': 'rnb', 'джаз': 'jazz', 'эмбиент': 'ambient', 'классика': 'classical', 'хаус': 'house', 'техно': 'techno', 'клуб': 'house', 'энергия': 'electronic',
}
const languages = [{ value: 'all', label: 'Все языки' }, { value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]
const wallSeed: WallArtist[] = artists.map((item, index) => ({ ...item, tags: canonicalTags(item.tags), popularity: 900 - index * 10 }))

function canonicalTags(tags: string[]) {
  const result = new Set<string>()
  for (const tag of Array.isArray(tags) ? tags : []) {
    const key = String(tag || '').toLocaleLowerCase().trim()
    const mapped = tagAliases[key] || key
    if (genreIds.includes(mapped)) result.add(mapped)
  }
  return result.size ? [...result] : ['all']
}
function normalizeName(value?: string) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
function initials(name: string) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  return (words.slice(0, 2).map(word => [...word][0] || '').join('') || '?').toLocaleUpperCase()
}
function compactFans(value?: number) {
  if (!value || value <= 0) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace('.', ',')} млн`
  if (value >= 1_000) return `${Math.round(value / 1_000)} тыс.`
  return String(value)
}
function normalizeArtist(input: WallArtist): WallArtist {
  return { ...input, tags: canonicalTags(input.tags || []) }
}
function normalizeList(input: WallArtist[] | undefined | null) {
  return (Array.isArray(input) ? input : []).filter(item => item?.id && item?.name).map(normalizeArtist)
}
function mergeCatalog(base: WallArtist[], incoming: WallArtist[]) {
  const result = [...base]
  const byName = new Map(result.map((item, index) => [normalizeName(item.name), index]))
  for (const item of incoming) {
    const key = normalizeName(item.name)
    const index = byName.get(key)
    if (index === undefined) { byName.set(key, result.length); result.push(item); continue }
    const current = result[index]
    const keepCurated = current.id.startsWith('artist-') || !item.id.startsWith('artist-')
    result[index] = {
      ...current,
      ...item,
      id: keepCurated ? current.id : item.id,
      tags: canonicalTags([...current.tags, ...item.tags]),
      image: current.image || item.image,
      imageSource: current.imageSource || item.imageSource,
      fans: current.fans || item.fans,
      albums: current.albums || item.albums,
      popularity: Math.max(current.popularity || 0, item.popularity || 0),
    }
  }
  return result
}
function photoFor(item: WallArtist) {
  if (item.image) return item.image
  return item.id.startsWith('artist-') ? `/api/artist-photo?name=${encodeURIComponent(item.name)}&v=2` : ''
}
function buildLayout(list: WallArtist[], width: number, compact: boolean): WallLayout {
  const gap = compact ? 10 : 14
  const target = compact ? 154 : 218
  const visible = Math.max(2, Math.round((width || 320) / target))
  const columns = visible + 1
  const columnWidth = Math.max(compact ? 128 : 154, Math.floor(((width || 320) - gap * (visible + 1)) / visible))
  const heights = Array.from({ length: columns }, () => 0)
  const cards: WallCard[] = []
  list.forEach((artist, index) => {
    const wide = columns > 2 && index % 13 === 7
    const span = wide ? 2 : 1
    let best = 0
    let bestY = Infinity
    for (let column = 0; column <= columns - span; column++) {
      const top = Math.max(heights[column], span === 2 ? heights[column + 1] : 0)
      if (top < bestY - .5) { bestY = top; best = column }
    }
    const cardWidth = span * columnWidth + (span - 1) * gap
    const ratio = wide ? .62 : index % 7 === 0 ? 1.22 : index % 3 === 0 ? 1.06 : .94
    const cardHeight = Math.round(cardWidth * ratio)
    cards.push({ artist, x: gap + best * (columnWidth + gap), y: bestY + gap, width: cardWidth, height: cardHeight, index, wide })
    for (let column = best; column < best + span; column++) heights[column] = bestY + cardHeight + gap
  })
  return { cards, width: columns * columnWidth + (columns + 1) * gap, height: Math.max(...heights, 0) + gap }
}
function clampAxis(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function rubberAxis(value: number, min: number, max: number) {
  if (value < min) return min - Math.min(150, (min - value) * .34)
  if (value > max) return max + Math.min(150, (value - max) * .34)
  return value
}

export function ArtistPicker({ selected, onChange, onOpenArtist }: { selected: string[]; onChange: (ids: string[]) => void; onOpenArtist?: (artist: { id?: string; name: string; image?: string }) => void }) {
  const [items, setItems] = useState<WallArtist[]>(wallSeed)
  const [searchResults, setSearchResults] = useState<WallArtist[] | null>(null)
  const [genre, setGenre] = useState('all')
  const [language, setLanguage] = useState('all')
  const [sortMode, setSortMode] = useState<'popular' | 'name' | 'fresh' | 'followed'>('popular')
  const [displayMode, setDisplayMode] = useState<'wall' | 'list'>('wall')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [viewportSize, setViewportSize] = useState({ width: 1100, height: 520 })
  const [related, setRelated] = useState<Record<string, { label: string; items: WallArtist[] }>>({})
  const relatedFetched = useRef(new Set<string>())
  const relatedPending = useRef(new Set<string>())
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const offsetRef = useRef({ x: 0, y: 0 })
  const limitsRef = useRef({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
  const layoutRef = useRef<WallLayout>({ cards: [], width: 0, height: 0 })
  const animationRef = useRef(0)
  const paintFrame = useRef(0)
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cursorRef = useRef<string | null>(null)
  const fetchingRef = useRef(false)
  const requestRef = useRef(0)
  const resetView = useRef(true)
  const suppressClick = useRef(false)
  const compact = viewportSize.width > 0 && viewportSize.width < 620

  const followedNames = useMemo(() => new Set(selected.map(id => artistById(id)?.name).filter((name): name is string => Boolean(name)).map(normalizeName)), [selected])
  const isFollowed = (item: WallArtist) => selected.includes(item.id) || followedNames.has(normalizeName(item.name))

  const relatedItems = useMemo(() => {
    const seen = new Set(items.map(item => normalizeName(item.name)))
    const result: WallArtist[] = []
    for (const [sourceId, group] of Object.entries(related)) {
      const source = artistById(sourceId) || items.find(item => item.id === sourceId)
      if (!selected.includes(sourceId) && !(source && followedNames.has(normalizeName(source.name)))) continue
      for (const entry of group.items) {
        const key = normalizeName(entry.name)
        if (seen.has(key)) continue
        seen.add(key)
        result.push({ ...entry, relatedTo: sourceId, relatedToName: group.label })
      }
    }
    return result
  }, [related, items, selected, followedNames])

  const filtered = useMemo(() => {
    const text = normalizeName(debouncedQuery)
    const pool = relatedItems.length ? [...items, ...relatedItems] : items
    const base = text ? mergeCatalog(pool.filter(item => normalizeName(item.name).includes(text)), searchResults || []) : pool
    return base.filter(item => {
      if (genre !== 'all' && !item.tags.includes(genre) && !item.tags.includes('all')) return false
      if (language !== 'all' && item.language && item.language !== 'all' && item.language !== language) return false
      if (text && !normalizeName(item.name).includes(text)) return false
      return true
    })
  }, [items, relatedItems, searchResults, debouncedQuery, genre, language])

  const ordered = useMemo(() => {
    const list = [...filtered]
    const order = new Map(items.map((item, index) => [item.id, index]))
    const queryKey = normalizeName(debouncedQuery)
    const relevance = (item: WallArtist) => {
      if (!queryKey) return 0
      const name = normalizeName(item.name)
      if (name === queryKey) return 4
      if (name.startsWith(queryKey)) return 3
      if (name.includes(queryKey)) return 2
      return 1
    }
    const followedFirst = (a: WallArtist, b: WallArtist) => Number(isFollowed(b)) - Number(isFollowed(a))
    const byMode = (a: WallArtist, b: WallArtist) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name, 'ru')
      if (sortMode === 'fresh') return (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0)
      if (sortMode === 'followed') return followedFirst(a, b) || (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name, 'ru')
      return (b.popularity || 0) - (a.popularity || 0) || a.name.localeCompare(b.name, 'ru')
    }
    list.sort((a, b) => relevance(b) - relevance(a) || byMode(a, b))
    if (sortMode === 'name') return list
    const children = new Map<string, WallArtist[]>()
    for (const item of list) {
      if (!item.relatedTo) continue
      const group = children.get(item.relatedTo) || []
      group.push(item)
      children.set(item.relatedTo, group)
    }
    if (!children.size) return list
    const placed = new Set<string>()
    const anchored: WallArtist[] = []
    for (const item of list) {
      if (item.relatedTo) continue
      anchored.push(item)
      placed.add(item.id)
      for (const child of children.get(item.id) || []) { anchored.push(child); placed.add(child.id) }
    }
    for (const item of list) if (!placed.has(item.id)) anchored.push(item)
    return anchored
  }, [filtered, sortMode, items, selected, followedNames, debouncedQuery])

  const layout = useMemo(() => buildLayout(ordered, viewportSize.width, compact), [ordered, viewportSize.width, compact])

  useEffect(() => {
    const element = viewportRef.current
    if (!element || displayMode !== 'wall') return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setViewportSize({ width: rect.width, height: rect.height })
    })
    observer.observe(element)
    setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    return () => observer.disconnect()
  }, [displayMode])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 340)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => { resetView.current = true }, [sortMode])

  useEffect(() => {
    const controller = new AbortController()
    const id = ++requestRef.current
    const text = debouncedQuery
    resetView.current = true
    setBusy(true)
    setError('')
    setSearchResults(null)
    const params = new URLSearchParams({ genre, language })
    if (text) params.set('q', text)
    fetchingRef.current = true
    fetch(`/api/artists?${params}`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить исполнителей')
        return data as { artists?: WallArtist[]; cursor?: string | null }
      })
      .then(data => {
        if (id !== requestRef.current) return
        const incoming = normalizeList(data.artists)
        registerArtists(incoming)
        cursorRef.current = data.cursor || null
        if (text) { setSearchResults(incoming); setItems(current => mergeCatalog(current, incoming)) }
        else setItems(incoming)
      })
      .catch(cause => { if (id === requestRef.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Каталог исполнителей временно недоступен') })
      .finally(() => { if (id === requestRef.current) { fetchingRef.current = false; setBusy(false) } })
    return () => controller.abort()
  }, [genre, language, debouncedQuery])

  useLayoutEffect(() => {
    layoutRef.current = layout
    const width = viewportSize.width || 1
    const height = viewportSize.height || 1
    const limits = { minX: Math.min(0, width - layout.width), maxX: Math.max(0, width - layout.width), minY: Math.min(0, height - layout.height), maxY: Math.max(0, height - layout.height) }
    limitsRef.current = limits
    if (resetView.current) {
      offsetRef.current = { x: (width - layout.width) / 2, y: 0 }
      resetView.current = false
    } else {
      offsetRef.current = { x: clampAxis(offsetRef.current.x, limits.minX, limits.maxX), y: clampAxis(offsetRef.current.y, limits.minY, limits.maxY) }
    }
    paint()
  }, [layout, viewportSize])

  useEffect(() => () => {
    if (wheelTimer.current) clearTimeout(wheelTimer.current)
    stopAnimation()
    if (paintFrame.current) { cancelAnimationFrame(paintFrame.current); paintFrame.current = 0 }
  }, [])

  async function loadRelated(item: WallArtist) {
    const key = normalizeName(item.name)
    if (!key || relatedFetched.current.has(key) || relatedPending.current.has(key)) return
    relatedPending.current.add(key)
    try {
      const params = new URLSearchParams({ name: item.name, limit: '8' })
      if (item.id.startsWith('deezer-')) params.set('id', item.id.slice(7))
      const response = await fetch(`/api/artists/related?${params}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось найти похожих')
      const incoming = normalizeList(data.artists).filter(entry => normalizeName(entry.name) !== key)
      if (!incoming.length) return
      registerArtists(incoming)
      relatedFetched.current.add(key)
      setRelated(current => ({ ...current, [item.id]: { label: item.name, items: incoming } }))
    } catch { /* Related artists are an enhancement: the wall still works without them. */ }
    finally { relatedPending.current.delete(key) }
  }

  useEffect(() => {
    if (!selected.length) return
    const timer = setTimeout(() => {
      for (const id of selected.slice(0, 10)) {
        const item = artistById(id) || items.find(entry => entry.id === id)
        if (item) loadRelated(item)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [selected.join(','), items.length])

  function paint() {
    if (paintFrame.current) return
    paintFrame.current = requestAnimationFrame(() => {
      paintFrame.current = 0
      const element = canvasRef.current
      if (element) element.style.transform = `translate3d(${offsetRef.current.x}px, ${offsetRef.current.y}px, 0)`
    })
  }
  function stopAnimation() { if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = 0 } }
  function applyOffset(x: number, y: number, rubber = false) {
    const limits = limitsRef.current
    offsetRef.current = rubber ? { x: rubberAxis(x, limits.minX, limits.maxX), y: rubberAxis(y, limits.minY, limits.maxY) } : { x: clampAxis(x, limits.minX, limits.maxX), y: clampAxis(y, limits.minY, limits.maxY) }
    paint()
  }
  function settle() {
    stopAnimation()
    const start = offsetRef.current
    const target = { x: clampAxis(start.x, limitsRef.current.minX, limitsRef.current.maxX), y: clampAxis(start.y, limitsRef.current.minY, limitsRef.current.maxY) }
    if (Math.abs(target.x - start.x) < .6 && Math.abs(target.y - start.y) < .6) { offsetRef.current = target; paint(); return }
    const began = performance.now()
    const run = (now: number) => {
      const progress = Math.min(1, (now - began) / 340)
      const eased = 1 - Math.pow(1 - progress, 3)
      offsetRef.current = { x: start.x + (target.x - start.x) * eased, y: start.y + (target.y - start.y) * eased }
      paint()
      if (progress < 1) animationRef.current = requestAnimationFrame(run)
      else animationRef.current = 0
    }
    animationRef.current = requestAnimationFrame(run)
  }
  function inertia(vx: number, vy: number) {
    stopAnimation()
    let x = offsetRef.current.x
    let y = offsetRef.current.y
    const run = () => {
      vx *= .94
      vy *= .94
      x += vx
      y += vy
      const limits = limitsRef.current
      if (x < limits.minX || x > limits.maxX) vx *= .7
      if (y < limits.minY || y > limits.maxY) vy *= .7
      offsetRef.current = { x: rubberAxis(x, limits.minX, limits.maxX), y: rubberAxis(y, limits.minY, limits.maxY) }
      paint()
      if (Math.hypot(vx, vy) > .12) animationRef.current = requestAnimationFrame(run)
      else { animationRef.current = 0; settle() }
    }
    animationRef.current = requestAnimationFrame(run)
  }
  function maybeLoadMore() {
    const limits = limitsRef.current
    if (offsetRef.current.y < limits.minY + 460) loadMore()
  }
  async function loadMore() {
    if (fetchingRef.current || !cursorRef.current) return
    fetchingRef.current = true
    setBusy(true)
    const id = requestRef.current
    try {
      const params = new URLSearchParams({ genre, language, cursor: cursorRef.current })
      if (debouncedQuery) params.set('q', debouncedQuery)
      const response = await fetch(`/api/artists?${params}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Не удалось загрузить ещё исполнителей')
      if (id !== requestRef.current) return
      const incoming = normalizeList(data.artists)
      registerArtists(incoming)
      setItems(current => mergeCatalog(current, incoming))
      cursorRef.current = data.cursor || null
    } catch (cause) { if (id === requestRef.current) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить ещё исполнителей') }
    finally { fetchingRef.current = false; setBusy(false) }
  }
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    stopAnimation()
    suppressClick.current = false
    dragRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y, lastX: event.clientX, lastY: event.clientY, lastAt: performance.now(), vx: 0, vy: 0, moved: false }
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true
      viewportRef.current?.classList.add('is-panning')
      try { viewportRef.current?.setPointerCapture(drag.id) } catch { /* Synthetic pointer cancellation still ends the drag. */ }
    }
    if (!drag.moved) return
    const now = performance.now()
    const elapsed = Math.max(8, now - drag.lastAt)
    drag.vx = (event.clientX - drag.lastX) / elapsed * 16
    drag.vy = (event.clientY - drag.lastY) / elapsed * 16
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    drag.lastAt = now
    applyOffset(drag.ox + dx, drag.oy + dy, true)
    maybeLoadMore()
  }
  function onPointerUp() {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    const element = viewportRef.current
    if (element?.hasPointerCapture(drag.id)) element.releasePointerCapture(drag.id)
    element?.classList.remove('is-panning')
    if (!drag.moved) return
    suppressClick.current = true
    setTimeout(() => { suppressClick.current = false }, 0)
    if (Math.hypot(drag.vx, drag.vy) > 1.1) inertia(drag.vx, drag.vy)
    else settle()
  }
  useEffect(() => {
    const element = viewportRef.current
    if (!element || displayMode !== 'wall') return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      stopAnimation()
      const step = event.deltaMode === 1 ? 18 : 1
      applyOffset(offsetRef.current.x - event.deltaX * step, offsetRef.current.y - event.deltaY * step, true)
      if (wheelTimer.current) clearTimeout(wheelTimer.current)
      wheelTimer.current = setTimeout(() => { settle(); maybeLoadMore() }, 140)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [displayMode])

  function toggleFollow(item: WallArtist) {
    if (isFollowed(item)) {
      const key = normalizeName(item.name)
      const remove = new Set(selected.filter(id => id === item.id || (artistById(id) && normalizeName(artistById(id)!.name) === key)))
      onChange(selected.filter(id => !remove.has(id)))
      relatedFetched.current.delete(key)
      setRelated(current => {
        if (!(item.id in current)) return current
        const next = { ...current }
        delete next[item.id]
        return next
      })
    } else {
      onChange([...selected, item.id])
      loadRelated(item)
    }
  }
  function openArtist(item: WallArtist) {
    if (suppressClick.current) return
    if (onOpenArtist) onOpenArtist({ id: item.id, name: item.name, image: photoFor(item) })
    else toggleFollow(item)
  }
  function resetFilters() {
    setGenre('all'); setLanguage('all'); setQuery(''); setDebouncedQuery(''); setSortMode('popular')
  }

  const subtitle = (item: WallArtist) => {
    const tags = item.tags.filter(tag => tag !== 'all').slice(0, 2).map(tag => genreLabels[tag] || tag).join(' · ')
    const fans = compactFans(item.fans)
    return [tags || 'Артист', fans ? `${fans} слушателей` : ''].filter(Boolean).join(' · ')
  }

  return <div className="artist-wall">
    <div className="aw-toolbar">
      <label className="aw-search">
        <Search size={18}/>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти исполнителя — от Кишлака до Aphex Twin" aria-label="Найти исполнителя"/>
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={15}/></button>}
      </label>
      <select className="aw-select" value={language} onChange={event => setLanguage(event.target.value)} aria-label="Язык">{languages.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <div className="aw-switch"><button className={displayMode === 'wall' ? 'active' : ''} onClick={() => setDisplayMode('wall')}>Полотно</button><button className={displayMode === 'list' ? 'active' : ''} onClick={() => setDisplayMode('list')}>Список</button></div>
    </div>
    <div className="aw-chips" role="group" aria-label="Жанры">
      {genreOptions.map(option => <button key={option.id} className={genre === option.id ? 'active' : ''} onClick={() => setGenre(option.id)}>{option.label}</button>)}
      <span className="aw-count">{busy ? 'ищем…' : `${ordered.length} артистов`}</span>
    </div>
    <div className="aw-subbar">
      <label className="aw-sort"><SlidersHorizontal size={15}/><select value={sortMode} onChange={event => setSortMode(event.target.value as typeof sortMode)} aria-label="Сортировка"><option value="popular">По популярности</option><option value="followed">Сначала отслеживаемые</option><option value="name">По имени</option><option value="fresh">Сначала новые</option></select></label>
      <span className="aw-hint"><Move size={14}/> Тяни полотно, колесо прокручивает стену</span>
      {(genre !== 'all' || language !== 'all' || query || sortMode !== 'popular') && <button className="aw-reset" onClick={resetFilters}><RotateCcw size={14}/> Сбросить</button>}
    </div>

    {displayMode === 'wall' ? <div className={`aw-viewport ${compact ? 'is-compact' : ''}`} ref={viewportRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onLostPointerCapture={() => { if (dragRef.current) { dragRef.current = null; settle() } }}>
      <div className="aw-canvas" ref={canvasRef}>
        {layout.cards.map(card => {
          const item = card.artist
          const followed = isFollowed(item)
          const photo = photoFor(item)
          return <article key={`${item.id}-${card.index}`} className={`aw-card ${followed ? 'is-followed' : ''} ${item.relatedTo ? 'is-related' : ''} ${card.wide ? 'is-wide' : ''}`} style={{ left: card.x, top: card.y, width: card.width, height: card.height, '--tint': item.tint } as CSSProperties}>
            <button className="aw-card-open" onClick={() => openArtist(item)} aria-label={onOpenArtist ? `Открыть ${item.name}` : followed ? `Перестать отслеживать ${item.name}` : `Отслеживать ${item.name}`}>
              <span className="aw-photo">
                <span className="aw-mono">{initials(item.name)}</span>
                {photo ? <img src={photo} alt="" loading="lazy" decoding="async" draggable={false} onError={event => { event.currentTarget.style.display = 'none' }}/> : null}
              </span>
              <span className="aw-shade"/>
              <span className="aw-copy"><strong>{item.name}</strong><small>{subtitle(item)}</small></span>
              <span className="aw-number">{String(card.index + 1).padStart(2, '0')}</span>
            </button>
            {item.relatedTo ? <span className="aw-related-tag">Похож на {item.relatedToName}</span> : null}
            <button className={`aw-follow ${followed ? 'is-on' : ''}`} onClick={event => { event.stopPropagation(); toggleFollow(item) }} aria-pressed={followed} aria-label={followed ? `Перестать отслеживать ${item.name}` : `Отслеживать ${item.name}`} title={followed ? 'Отслеживается' : 'Отслеживать'}>{followed ? <Check size={16}/> : <Plus size={16}/>}</button>
          </article>
        })}
      </div>
      {!ordered.length && <div className="aw-empty">{busy ? <><Loader2 className="spin" size={20}/> Собираем исполнителей…</> : <><Search size={22}/> Никого не нашли. Попробуй другое имя, жанр или язык.</>}</div>}
      {error && <div className="aw-error">{error}<button onClick={() => setDebouncedQuery(value => `${value} `)}>Повторить</button></div>}
    </div> : <div className="aw-list">
      {ordered.map(item => {
        const followed = isFollowed(item)
        const photo = photoFor(item)
        return <div className={`aw-row ${followed ? 'is-followed' : ''} ${item.relatedTo ? 'is-related' : ''}`} key={item.id}>
          <button className="aw-row-open" onClick={() => openArtist(item)}>
            <span className="aw-row-art" style={{ background: item.tint }}><span>{initials(item.name)}</span>{photo ? <img src={photo} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.style.display = 'none' }}/> : null}</span>
            <span className="aw-row-copy"><strong>{item.name}</strong><small>{item.relatedTo ? `Похож на ${item.relatedToName} · ${subtitle(item)}` : subtitle(item)}</small></span>
          </button>
          <button className={`aw-row-follow ${followed ? 'is-on' : ''}`} onClick={() => toggleFollow(item)}>{followed ? <><Check size={15}/> Отслеживается</> : <><Plus size={15}/> Отслеживать</>}</button>
          {onOpenArtist && <span className="aw-row-arrow"><ArrowUpRight size={15}/></span>}
        </div>
      })}
      {!ordered.length && <div className="aw-empty">{busy ? <><Loader2 className="spin" size={20}/> Собираем исполнителей…</> : <><Search size={22}/> Никого не нашли.</>}</div>}
    </div>}

    <div className="aw-footer">
      <span>{genre === 'all' ? 'Все жанры' : genreLabels[genre]} · {languages.find(item => item.value === language)?.label}{debouncedQuery ? ` · «${debouncedQuery}»` : ''}</span>
      <span className="aw-footer-count">Выбрано {selected.length}</span>
      <button onClick={loadMore} disabled={busy || !cursorRef.current}>{cursorRef.current ? (busy ? 'Загружаем…' : 'Ещё артисты') : 'Это все'} <Plus size={14}/></button>
    </div>
  </div>
}
