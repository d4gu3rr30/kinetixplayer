import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Play, Pause, Trash2, ListEnd, ListStart, History, Sparkles, Music2, ListOrdered, GripVertical, MoreHorizontal, Plus, Check, Heart, ListMusic, UserRound, ThumbsDown } from 'lucide-react'
import { SwipeRow } from './swipe'
import type { Track } from './types'

type Section = 'history' | 'upcoming'
type Preview = { history: Track[]; upcoming: Track[] }
type DragMeta = { key: string; track: Track; from: Section }
type DragState = DragMeta & { pointerId: number; startX: number; startY: number; grabX: number; grabY: number; width: number; active: boolean; tilt: number; copy: Track | null }
type MenuState = { track: Track; section: Section | 'current'; x: number; y: number; up: boolean }

const covers = ['linear-gradient(145deg,#e3a27a,#775877 65%,#322b48)', 'linear-gradient(145deg,#4d827e,#263c5b 65%,#181d38)', 'linear-gradient(145deg,#8c789d,#483e70 65%,#25243b)']
const artwork = (track: Track, index = 0): React.CSSProperties => track.artwork
  ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` }
  : { background: covers[index % covers.length] }
const formatTime = (time?: number) => Number.isFinite(time) && time! > 0 ? `${Math.floor(time! / 60)}:${String(Math.floor(time! % 60)).padStart(2, '0')}` : '—:—'
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off'

function QueueRow({ track, index, active, playing, dragging, draggable, rowKey, section, inLibrary, liked, onPlay, onLibrary, onFavorite, onMore }: {
  track: Track
  index: number
  active?: boolean
  playing?: boolean
  dragging?: boolean
  draggable?: boolean
  rowKey: string
  section: Section
  inLibrary: boolean
  liked: boolean
  onPlay: () => void
  onLibrary: () => void
  onFavorite: () => void
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return <div className={`queue-row ${active ? 'is-current' : ''} ${dragging ? 'is-dragging' : ''}`} data-id={track.id} data-row-key={rowKey} data-section={section} style={{ '--i': index } as React.CSSProperties}>
    <button className="queue-row-main" onClick={onPlay}>
      <span className="queue-row-index">{active && playing ? <span className="equalizer"><i/><i/><i/></span> : <><span className="queue-row-number">{String(index + 1).padStart(2, '0')}</span><Play className="queue-row-play" size={13} fill="currentColor"/></>}</span>
      <span className="queue-row-art" style={artwork(track, index)}/>
      <span className="queue-row-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
      <span className="queue-row-duration">{formatTime(track.duration)}</span>
    </button>
    <div className="queue-row-actions">
      <button type="button" className={`queue-act ${inLibrary ? 'is-on' : ''}`} onClick={event => { event.stopPropagation(); onLibrary() }} aria-label={inLibrary ? `Убрать «${track.title}» из медиатеки` : `Добавить «${track.title}» в медиатеку`} title={inLibrary ? 'Убрать из медиатеки' : 'В медиатеку'}>{inLibrary ? <Check size={15}/> : <Plus size={16}/>}</button>
      <button type="button" className={`queue-act ${liked ? 'is-liked' : ''}`} onClick={event => { event.stopPropagation(); onFavorite() }} aria-label={liked ? `Убрать «${track.title}» из любимых` : `Добавить «${track.title}» в любимые`} title={liked ? 'Убрать из любимых' : 'В любимые'}><Heart size={15} fill={liked ? 'currentColor' : 'none'}/></button>
      <button type="button" className="queue-act" onClick={event => { event.stopPropagation(); onMore(event) }} aria-label="Ещё действия" aria-haspopup="menu" title="Ещё действия"><MoreHorizontal size={17}/></button>
    </div>
    {draggable && <button className="queue-drag" aria-label={`Перетащить «${track.title}»`} title="Зажать и потянуть, чтобы изменить порядок"><GripVertical size={14}/></button>}
  </div>
}

export function QueuePanel({ current, queue, history, library, favorites, playing, onSelect, onRemove, onPlayNext, onRemoveHistory, onCommit, onClearUpcoming, onClearHistory, onLibrary, onFavorite, onPlaylist, onArtist, onDislike, onClose }: {
  current: Track | null
  queue: Track[]
  history: Track[]
  library: Track[]
  favorites: Track[]
  playing: boolean
  onSelect: (track: Track, list: Track[]) => void
  onRemove: (track: Track) => void
  onPlayNext: (track: Track) => void
  onRemoveHistory: (track: Track) => void
  onCommit: (history: Track[], upcoming: Track[]) => void
  onClearUpcoming: () => void
  onClearHistory: () => void
  onLibrary: (track: Track) => void
  onFavorite: (track: Track) => void
  onPlaylist: (track: Track) => void
  onArtist: (track: Track) => void
  onDislike: (track: Track) => void
  onClose: () => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [dragMeta, setDragMeta] = useState<DragMeta | null>(null)
  const [dropReady, setDropReady] = useState(false)
  const dropReadyRef = useRef(false)
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const previewRef = useRef<Preview | null>(null)
  const clickSuppress = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const historyListRef = useRef<HTMLDivElement>(null)
  const upcomingListRef = useRef<HTMLDivElement>(null)
  const upcomingSectionRef = useRef<HTMLElement>(null)
  const currentSectionRef = useRef<HTMLElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const ghostBox = useRef({ x: 0, y: 0, width: 0 })
  const pendingMove = useRef<{ x: number; y: number } | null>(null)
  const moveFrame = useRef<number | null>(null)
  const placementKey = useRef('')
  const positions = useRef<Map<string, number>>(new Map())
  const keyMap = useRef(new WeakMap<Track, string>())
  const keySeq = useRef(0)

  function keyFor(track: Track) {
    let key = keyMap.current.get(track)
    if (!key) { key = `qrow-${++keySeq.current}`; keyMap.current.set(track, key) }
    return key
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menu) { setMenu(null); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, menu])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [menu])
  useEffect(() => {
    previewRef.current = null
    setPreview(null)
    setDragMeta(null)
    setMenu(null)
    dragRef.current = null
    placementKey.current = ''
    pendingMove.current = null
    dropReadyRef.current = false
    setDropReady(false)
  }, [queue, history, current?.id])
  useEffect(() => () => { if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current) }, [])

  // The stored history is newest-first. The panel reads bottom-up, like a
  // timeline: old tracks above, the last one played right above the current.
  const historyAsc = useMemo(() => [...history].reverse(), [history])

  useLayoutEffect(() => {
    const body = bodyRef.current
    const node = currentSectionRef.current
    if (!body || !node || !current) return
    const offset = node.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
    body.scrollTop = Math.max(0, Math.min(offset - body.clientHeight * .32, body.scrollHeight - body.clientHeight))
  }, [])

  const nowIndex = queue.findIndex(track => track.id === current?.id)
  const upcoming = nowIndex >= 0 ? queue.slice(nowIndex + 1) : queue.filter(track => track.id !== current?.id)
  const historyList = preview?.history ?? historyAsc
  const upcomingList = preview?.upcoming ?? upcoming
  const historyStart = showAllHistory ? 0 : Math.max(0, historyList.length - 6)
  const visibleHistory = historyList.slice(historyStart)
  const total = historyList.length + upcomingList.length + (current ? 1 : 0)
  const inLibrary = (track: Track) => library.some(item => item.id === track.id)
  const liked = (track: Track) => favorites.some(item => item.id === track.id)

  // FLIP transforms live on .queue-row, so measure its untransformed wrapper instead.
  const anchorTop = (row: HTMLElement) => (row.parentElement ?? row).getBoundingClientRect().top
  function snapshotRows() {
    const map = new Map<string, number>()
    bodyRef.current?.querySelectorAll<HTMLElement>('.queue-row[data-row-key]').forEach(row => {
      const key = row.dataset.rowKey
      if (key) map.set(key, anchorTop(row))
    })
    positions.current = map
  }

  function beginDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('.queue-act')) return
    const row = target.closest<HTMLElement>('.queue-row[data-row-key]')
    if (!row) return
    if (event.pointerType === 'touch' && !target.closest('.queue-drag')) return
    const key = row.dataset.rowKey || ''
    const section: Section = row.dataset.section === 'history' ? 'history' : 'upcoming'
    const track = (section === 'history' ? historyList : upcomingList).find(item => keyFor(item) === key)
    if (!track) return
    const rect = row.getBoundingClientRect()
    clickSuppress.current = false
    placementKey.current = ''
    pendingMove.current = null
    dragRef.current = { key, track, from: section, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, grabX: event.clientX - rect.left, grabY: event.clientY - rect.top, width: rect.width, active: false, tilt: 0, copy: null }
  }
  function paintGhost() {
    const ghost = ghostRef.current
    const drag = dragRef.current
    if (!ghost || !drag) return
    ghost.style.transform = `translate3d(${ghostBox.current.x}px, ${ghostBox.current.y}px, 0) rotate(${drag.tilt.toFixed(2)}deg)`
  }
  function markDropReady(value: boolean) {
    if (dropReadyRef.current === value) return
    dropReadyRef.current = value
    setDropReady(value)
  }
  function restorePreview() {
    if (placementKey.current === 'cancel') return
    placementKey.current = 'cancel'
    const currentPreview = previewRef.current
    if (!currentPreview) return
    const same = currentPreview.history.length === historyAsc.length && currentPreview.upcoming.length === upcoming.length
      && currentPreview.history.every((track, index) => track === historyAsc[index])
      && currentPreview.upcoming.every((track, index) => track === upcoming[index])
    if (same) return
    snapshotRows()
    const base: Preview = { history: historyAsc, upcoming }
    previewRef.current = base
    setPreview(base)
  }
  function applyMove() {
    const drag = dragRef.current
    const pending = pendingMove.current
    if (!drag || !drag.active || !pending) return
    pendingMove.current = null
    ghostBox.current.x = pending.x - drag.grabX
    ghostBox.current.y = pending.y - drag.grabY
    drag.tilt += (Math.max(-4, Math.min(4, (pending.x - drag.startX) * .07)) - drag.tilt) * .4
    paintGhost()
    const body = bodyRef.current
    if (body) {
      const rect = body.getBoundingClientRect()
      const edge = 56
      if (pending.y < rect.top + edge) body.scrollTop -= Math.ceil(Math.min(1, (rect.top + edge - pending.y) / edge) * 14)
      else if (pending.y > rect.bottom - edge) body.scrollTop += Math.ceil(Math.min(1, (pending.y - rect.bottom + edge) / edge) * 14)
    }
    const boundary = upcomingSectionRef.current?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY
    // Only «Далее» accepts drops. History is a playback log, so dropping anywhere
    // else simply cancels the move instead of quietly rewriting it.
    if (pending.y < boundary) {
      markDropReady(false)
      restorePreview()
      return
    }
    const currentPreview = previewRef.current
    const listEl = upcomingListRef.current
    if (!currentPreview || !listEl) return
    const rows = listEl.querySelectorAll<HTMLElement>('.queue-row[data-row-key]')
    let target = 0
    if (rows.length) {
      const top = anchorTop(rows[0])
      const step = rows.length > 1 ? anchorTop(rows[1]) - top : rows[0].getBoundingClientRect().height + 3
      if (step > 0) target = Math.max(0, Math.min(rows.length, Math.floor((pending.y - top) / step + .5)))
    }
    if (drag.from === 'history') {
      if (upcoming.some(track => track.id === drag.track.id)) { markDropReady(false); restorePreview(); return }
      markDropReady(true)
      const copy = drag.copy || (drag.copy = { ...drag.track })
      const existing = currentPreview.upcoming.indexOf(copy)
      let insert = target
      if (existing >= 0 && insert > existing) insert -= 1
      const others = currentPreview.upcoming.filter(track => track !== copy)
      insert = Math.max(0, Math.min(insert, others.length))
      const placement = `history:${insert}`
      if (placement === placementKey.current) return
      placementKey.current = placement
      snapshotRows()
      const next: Preview = { history: currentPreview.history, upcoming: [...others.slice(0, insert), copy, ...others.slice(insert)] }
      previewRef.current = next
      setPreview(next)
      return
    }
    markDropReady(true)
    const from = currentPreview.upcoming.findIndex(track => keyFor(track) === drag.key)
    if (from < 0) return
    let insert = target
    if (insert > from) insert -= 1
    insert = Math.max(0, Math.min(insert, currentPreview.upcoming.length - 1))
    if (insert === from) return
    const placement = `upcoming:${insert}`
    if (placement === placementKey.current) return
    placementKey.current = placement
    snapshotRows()
    const nextUpcoming = [...currentPreview.upcoming]
    nextUpcoming.splice(from, 1)
    nextUpcoming.splice(insert, 0, drag.track)
    const next: Preview = { history: currentPreview.history, upcoming: nextUpcoming }
    previewRef.current = next
    setPreview(next)
  }
  function scheduleMove() {
    if (moveFrame.current !== null) return
    if (document.hidden) { applyMove(); return }
    moveFrame.current = requestAnimationFrame(() => { moveFrame.current = null; applyMove() })
  }
  function flushMove() {
    if (moveFrame.current === null) return
    cancelAnimationFrame(moveFrame.current)
    moveFrame.current = null
    applyMove()
  }
  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return
      drag.active = true
      clickSuppress.current = true
      ghostBox.current = { x: event.clientX - drag.grabX, y: event.clientY - drag.grabY, width: drag.width }
      if (!previewRef.current) {
        setMenu(null)
        previewRef.current = { history: historyAsc, upcoming }
        setPreview(previewRef.current)
      }
      setDragMeta({ key: drag.key, track: drag.track, from: drag.from })
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is a progressive enhancement. */ }
    }
    pendingMove.current = { x: event.clientX, y: event.clientY }
    scheduleMove()
  }
  function endDrag() {
    const drag = dragRef.current
    if (!drag) return
    flushMove()
    dragRef.current = null
    pendingMove.current = null
    placementKey.current = ''
    markDropReady(false)
    if (!drag.active) { setDragMeta(null); return }
    requestAnimationFrame(() => { clickSuppress.current = false })
    const finalPreview = previewRef.current
    previewRef.current = null
    setDragMeta(null)
    setPreview(null)
    if (!finalPreview) return
    const historyChanged = finalPreview.history.length !== historyAsc.length || finalPreview.history.some((track, index) => track !== historyAsc[index])
    const upcomingChanged = finalPreview.upcoming.length !== upcoming.length || finalPreview.upcoming.some((track, index) => track !== upcoming[index])
    if (historyChanged || upcomingChanged) onCommit([...finalPreview.history].reverse(), finalPreview.upcoming)
  }
  function captureClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!clickSuppress.current) return
    clickSuppress.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function openMenu(event: React.MouseEvent<HTMLButtonElement>, track: Track, section: Section | 'current') {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const width = 254
    const height = 340
    const up = rect.bottom + height + 12 > window.innerHeight
    setMenu({
      track,
      section,
      x: Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12)),
      y: up ? Math.max(12, Math.min(rect.top - height - 8, window.innerHeight - height - 12)) : rect.bottom + 8,
      up,
    })
  }
  function run(action: () => void) { setMenu(null); action() }

  useLayoutEffect(() => {
    const previous = positions.current
    positions.current = new Map()
    if (!preview || !previous.size || reduceMotion()) return
    bodyRef.current?.querySelectorAll<HTMLElement>('.queue-row[data-row-key]').forEach(row => {
      const key = row.dataset.rowKey
      if (!key || key === dragRef.current?.key) return
      const before = previous.get(key)
      if (before === undefined) return
      const delta = before - anchorTop(row)
      if (Math.abs(delta) < 1) return
      row.style.transition = 'none'
      row.style.transform = `translateY(${delta}px)`
      requestAnimationFrame(() => {
        row.style.transition = 'transform .26s cubic-bezier(.2,.8,.2,1)'
        row.style.transform = ''
      })
    })
  }, [preview])

  useLayoutEffect(() => { if (dragMeta) paintGhost() }, [dragMeta])

  const menuLayer = menu && <div className="track-menu-layer">
    <div className="track-menu-backdrop" onPointerDown={() => setMenu(null)}/>
    <div className={`track-menu ${menu.up ? 'is-up' : ''}`} role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={event => event.stopPropagation()}>
      <div className="track-menu-head">
        <span className="track-menu-art" style={artwork(menu.track)}/>
        <span className="track-menu-copy"><strong>{menu.track.title}</strong><small>{menu.track.artist}</small></span>
      </div>
      <div className="track-menu-group">
        {menu.section !== 'current' && <button role="menuitem" onClick={() => run(() => onSelect(menu.track, queue.length ? queue : [menu.track]))}><Play size={16}/><span>Играть сейчас</span></button>}
        {menu.section !== 'current' && <button role="menuitem" onClick={() => run(() => onPlayNext(menu.track))}><ListStart size={16}/><span>Играть следующим</span></button>}
        <button role="menuitem" onClick={() => run(() => onPlaylist(menu.track))}><ListMusic size={16}/><span>Добавить в плейлист</span></button>
        <button role="menuitem" onClick={() => run(() => onArtist(menu.track))}><UserRound size={16}/><span>Перейти к исполнителю</span></button>
        <button role="menuitem" className="danger" onClick={() => run(() => onDislike(menu.track))}><ThumbsDown size={16}/><span>Неинтересно</span></button>
      </div>
      {menu.section !== 'current' && <><div className="track-menu-sep"/><div className="track-menu-group">
        <button role="menuitem" className="danger" onClick={() => run(() => menu.section === 'history' ? onRemoveHistory(menu.track) : onRemove(menu.track))}><Trash2 size={16}/><span>{menu.section === 'history' ? 'Убрать из истории' : 'Убрать из очереди'}</span></button>
      </div></>}
    </div>
  </div>

  return createPortal(<div className="queue-layer">
    <div className="queue-backdrop" onClick={onClose}/>
    <aside className={`queue-drawer ${dragMeta ? 'is-drag-active' : ''} ${dropReady ? 'is-drop-ready' : ''}`} role="dialog" aria-label="Очередь воспроизведения">
      <div className="queue-glow"/>
      <header className="queue-head">
        <div className="queue-head-title"><span className="queue-head-icon"><ListOrdered size={18}/></span><div><strong>Очередь</strong><small>{total ? `${total} ${total === 1 ? 'трек' : total < 5 ? 'трека' : 'треков'} в сессии` : 'Пока пусто'}</small></div></div>
        <button className="queue-close" onClick={onClose} aria-label="Закрыть очередь"><X size={18}/></button>
      </header>
      <div className="queue-body" ref={bodyRef} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onClickCapture={captureClick}>
        <section className="queue-section history">
          <div className="queue-section-head"><span><History size={14}/> История <b>{historyList.length}</b></span><div className="queue-section-actions">{historyList.length > 6 && <button onClick={() => setShowAllHistory(value => !value)}>{showAllHistory ? 'Свернуть' : `Все ${historyList.length}`}</button>}{historyList.length > 0 && <button onClick={onClearHistory}>Очистить</button>}</div></div>
          {historyList.length ? <div className="queue-list" ref={historyListRef}>{visibleHistory.map((track, index) => {
            const key = keyFor(track)
            return <SwipeRow key={key} id={key} className="queue-swipe"
              left={[{ key: 'next', label: 'Следующим', icon: <ListStart size={16}/>, tone: 'queue', onAction: () => onPlayNext(track) }]}
              right={[{ key: 'remove', label: 'Убрать', icon: <Trash2 size={16}/>, tone: 'danger', onAction: () => onRemoveHistory(track) }]}>
              <QueueRow track={track} index={historyStart + index} rowKey={key} section="history" draggable inLibrary={inLibrary(track)} liked={liked(track)} playing={playing} active={current?.id === track.id} dragging={dragMeta?.key === key}
                onPlay={() => onSelect(track, queue.length ? queue : [track])}
                onLibrary={() => onLibrary(track)}
                onFavorite={() => onFavorite(track)}
                onMore={event => openMenu(event, track, 'history')}/>
            </SwipeRow>
          })}</div> : <div className="queue-list" ref={historyListRef}/>}
          {!historyList.length && <p className="queue-hint">Сюда попадут треки, которые уже отзвучали.</p>}
        </section>

        <section className="queue-section queue-current" ref={currentSectionRef}>
          {current ? <div className="queue-now">
            <span className="queue-now-art" style={artwork(current)}/>
            <div className="queue-now-copy">
              <span className="queue-now-label"><Sparkles size={11}/> СЕЙЧАС ИГРАЕТ</span>
              <strong>{current.title}</strong>
              <small>{current.artist}</small>
            </div>
            <div className="queue-now-actions">
              <button type="button" className={`queue-act ${inLibrary(current) ? 'is-on' : ''}`} onClick={() => onLibrary(current)} aria-label={inLibrary(current) ? 'Убрать из медиатеки' : 'Добавить в медиатеку'} title={inLibrary(current) ? 'Убрать из медиатеки' : 'В медиатеку'}>{inLibrary(current) ? <Check size={16}/> : <Plus size={17}/>}</button>
              <button type="button" className={`queue-act ${liked(current) ? 'is-liked' : ''}`} onClick={() => onFavorite(current)} aria-label={liked(current) ? 'Убрать из любимых' : 'Добавить в любимые'} title={liked(current) ? 'Убрать из любимых' : 'В любимые'}><Heart size={16} fill={liked(current) ? 'currentColor' : 'none'}/></button>
              <button type="button" className="queue-act" onClick={event => openMenu(event, current, 'current')} aria-label="Ещё действия" title="Ещё действия"><MoreHorizontal size={18}/></button>
            </div>
            {playing ? <span className="queue-eq"><i/><i/><i/><i/></span> : <Pause className="queue-paused" size={16}/>}
          </div> : <div className="queue-empty"><div><Music2 size={26}/></div><strong>Тишина</strong><p>Включи трек — очередь соберётся сама.</p></div>}
        </section>

        <section className="queue-section" ref={upcomingSectionRef}>
          <div className="queue-section-head"><span><ListEnd size={14}/> Далее <b>{upcomingList.length}</b></span>{upcomingList.length > 0 && <button onClick={onClearUpcoming}>Очистить</button>}</div>
          {upcomingList.length ? <>
            <p className="queue-reorder-hint"><GripVertical size={11}/> Зажми и потяни, чтобы поменять порядок. Трек из истории можно вернуть сюда — история при этом не изменится</p>
            <div className="queue-list" ref={upcomingListRef}>{upcomingList.map((track, index) => {
              const key = keyFor(track)
              return <SwipeRow key={key} id={key} className="queue-swipe"
                left={[{ key: 'next', label: 'Следующим', icon: <ListStart size={16}/>, tone: 'queue', onAction: () => onPlayNext(track) }]}
                right={[{ key: 'remove', label: 'Убрать', icon: <Trash2 size={16}/>, tone: 'danger', onAction: () => onRemove(track) }]}>
                <QueueRow track={track} index={index} rowKey={key} section="upcoming" draggable inLibrary={inLibrary(track)} liked={liked(track)} playing={playing} active={current?.id === track.id} dragging={dragMeta?.key === key}
                  onPlay={() => onSelect(track, queue)}
                  onLibrary={() => onLibrary(track)}
                  onFavorite={() => onFavorite(track)}
                  onMore={event => openMenu(event, track, 'upcoming')}/>
              </SwipeRow>
            })}</div>
          </> : <div className="queue-list" ref={upcomingListRef}><p className="queue-hint">В очереди больше ничего нет. Добавь треки через меню «⋯».</p></div>}
        </section>
      </div>
      {upcoming.length > 0 && <footer className="queue-foot"><button onClick={() => onSelect(upcoming[0], queue)}><Play size={14} fill="currentColor"/> Играть следующую</button><button className="ghost" onClick={onClearUpcoming}><Trash2 size={14}/> Очистить очередь</button></footer>}
    </aside>
    {dragMeta && <div className="queue-ghost" ref={ghostRef} style={{ width: ghostBox.current.width || undefined }} aria-hidden="true">
      <span className="queue-ghost-art" style={artwork(dragMeta.track)}/>
      <span className="queue-ghost-copy"><strong>{dragMeta.track.title}</strong><small>{dragMeta.track.artist}</small></span>
      <span className="queue-ghost-duration">{formatTime(dragMeta.track.duration)}</span>
    </div>}
    {menuLayer}
  </div>, document.body)
}
