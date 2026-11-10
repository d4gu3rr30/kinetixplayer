import React, { useEffect, useRef, useState } from 'react'

export type SwipeAction = { key: string; label: string; icon: React.ReactNode; tone: 'queue' | 'save' | 'favorite' | 'danger'; onAction: () => void }
type Side = 'left' | 'right'
export const SWIPE_ACTION_WIDTH = 64
// Pulling this far past the button rail arms the edge action: it stretches to
// follow the finger and fires on release, like a full swipe in Apple Music.
const ARM_DISTANCE = 46
const MAX_OVERSHOOT = 96

export function SwipeRow({ id, left = [], right = [], className = '', children }: { id: string; left?: SwipeAction[]; right?: SwipeAction[]; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState<Side | null>(null)
  const [dragging, setDragging] = useState(false)
  const [armed, setArmed] = useState<Side | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const openRef = useRef<Side | null>(null)
  const armedRef = useRef<Side | null>(null)
  const widths = useRef({ left: 0, right: 0 })
  widths.current = { left: left.length * SWIPE_ACTION_WIDTH, right: right.length * SWIPE_ACTION_WIDTH }
  const drag = useRef<{ startX: number; startY: number; base: number; dx: number; axis: 'x' | 'y' | null } | null>(null)
  const suppress = useRef(false)

  function setArmedSide(side: Side | null) {
    if (armedRef.current === side) return
    armedRef.current = side
    setArmed(side)
  }
  function stretch(side: Side, value: number) {
    const target = side === 'right' ? rightRef.current : leftRef.current
    const other = side === 'right' ? leftRef.current : rightRef.current
    other?.style.setProperty('--swipe-stretch', '0px')
    target?.style.setProperty('--swipe-stretch', `${Math.max(0, Math.min(value, MAX_OVERSHOOT))}px`)
  }
  function clearTransient() {
    leftRef.current?.style.setProperty('--swipe-stretch', '0px')
    rightRef.current?.style.setProperty('--swipe-stretch', '0px')
    setArmedSide(null)
  }
  function settle() {
    const content = contentRef.current
    if (!content) return
    const side = openRef.current
    content.style.transform = side === 'left' ? `translateX(${widths.current.left}px)` : side === 'right' ? `translateX(-${widths.current.right}px)` : ''
  }
  function close() {
    const content = contentRef.current
    if (content) { content.style.transition = ''; content.style.transform = '' }
    openRef.current = null
    setOpen(null)
    setDragging(false)
    clearTransient()
  }
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null
      if (!target || !wrapperRef.current?.contains(target)) close()
    }
    const onOtherOpen = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) close() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('kinetix:swipe', onOtherOpen)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('kinetix:swipe', onOtherOpen) }
  }, [open, id])
  useEffect(() => {
    if (!openRef.current) return
    if ((openRef.current === 'left' && !widths.current.left) || (openRef.current === 'right' && !widths.current.right)) { close(); return }
    settle()
  }, [left.length, right.length])

  function begin(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || window.innerWidth > 680) return
    if ((event.target as HTMLElement).closest('.queue-drag')) return
    const content = contentRef.current
    if (!content || (!left.length && !right.length)) return
    suppress.current = false
    clearTransient()
    const base = openRef.current === 'left' ? widths.current.left : openRef.current === 'right' ? -widths.current.right : 0
    drag.current = { startX: event.clientX, startY: event.clientY, base, dx: 0, axis: null }
    content.style.transition = 'none'
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is a progressive enhancement. */ }
  }
  function move(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current
    const content = contentRef.current
    if (!state || !content) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.axis) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return
      state.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      if (state.axis === 'y') { drag.current = null; content.style.transition = ''; clearTransient(); settle(); return }
      setDragging(true)
    }
    if (state.axis !== 'x') return
    state.dx = dx
    const raw = state.base + dx
    const side: Side = raw < 0 ? 'right' : 'left'
    if (!(side === 'right' ? right.length : left.length)) {
      content.style.transform = `translateX(${Math.max(-18, Math.min(18, raw))}px)`
      clearTransient()
      if (Math.abs(dx) > 8) suppress.current = true
      return
    }
    const strip = side === 'right' ? widths.current.right : widths.current.left
    const overshoot = Math.max(0, Math.abs(raw) - strip)
    const travel = Math.min(Math.abs(raw), strip + MAX_OVERSHOOT)
    content.style.transform = `translateX(${(side === 'right' ? -1 : 1) * travel}px)`
    stretch(side, overshoot)
    setArmedSide(overshoot > ARM_DISTANCE ? side : null)
    if (Math.abs(dx) > 8) suppress.current = true
  }
  function end() {
    const state = drag.current
    drag.current = null
    const content = contentRef.current
    if (!content) return
    content.style.transition = ''
    setDragging(false)
    if (!state || state.axis !== 'x') { clearTransient(); settle(); return }
    const position = state.base + state.dx
    const side: Side = position < 0 ? 'right' : 'left'
    const actions = side === 'right' ? right : left
    const strip = side === 'right' ? widths.current.right : widths.current.left
    if (actions.length && strip && Math.abs(position) - strip > ARM_DISTANCE) {
      const action = side === 'right' ? actions[actions.length - 1] : actions[0]
      document.dispatchEvent(new CustomEvent('kinetix:swipe', { detail: id }))
      clearTransient()
      close()
      action.onAction()
      return
    }
    clearTransient()
    const next: Side | null = widths.current.left && position > widths.current.left * .42 ? 'left' : widths.current.right && position < -widths.current.right * .42 ? 'right' : null
    if (next) {
      openRef.current = next
      content.style.transform = next === 'left' ? `translateX(${widths.current.left}px)` : `translateX(-${widths.current.right}px)`
      setOpen(next)
      document.dispatchEvent(new CustomEvent('kinetix:swipe', { detail: id }))
    } else {
      openRef.current = null
      setOpen(null)
      content.style.transform = ''
    }
  }
  function cancel() {
    drag.current = null
    const content = contentRef.current
    if (content) content.style.transition = ''
    setDragging(false)
    clearTransient()
    settle()
  }
  function captureClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppress.current) { suppress.current = false; event.preventDefault(); event.stopPropagation(); return }
    if ((event.target as HTMLElement).closest('.swipe-actions')) return
    if (openRef.current) { event.preventDefault(); event.stopPropagation(); close() }
  }

  const renderActions = (side: Side, actions: SwipeAction[]) => {
    if (!actions.length) return null
    const primaryKey = side === 'right' ? actions[actions.length - 1].key : actions[0].key
    return <div ref={side === 'right' ? rightRef : leftRef} className={`swipe-actions swipe-actions-${side} ${open === side ? 'is-open' : ''} ${open === side || dragging ? 'is-visible' : ''} ${armed === side ? 'is-armed' : ''}`} aria-hidden={open !== side}>
      {actions.map(action => <button key={action.key} className={`swipe-action ${action.tone} ${action.key === primaryKey ? 'is-primary' : ''} ${armed === side && action.key === primaryKey ? 'is-armed' : ''}`} tabIndex={open === side ? undefined : -1} onClick={() => { close(); action.onAction() }}>
        <span className="swipe-icon">{action.icon}</span><span className="swipe-label">{action.label}</span>
      </button>)}
    </div>
  }

  return <div ref={wrapperRef} className={`swipe-row ${className} ${dragging ? 'is-dragging' : ''} ${armed ? 'is-armed' : ''}`} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onClickCapture={captureClick}>
    {renderActions('left', left)}
    {renderActions('right', right)}
    <div className="swipe-content" ref={contentRef}>{children}</div>
  </div>
}
