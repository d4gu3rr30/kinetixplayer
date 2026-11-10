import { Bookmark, Check, LocateFixed, Plus, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { User } from './account'

export type MomentLine = { at: number; text: string }
export type MomentTrack = { title: string; artist: string; artwork?: string }

const stamp = (seconds: number) => { const value = Math.max(0, Math.round(seconds)); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` }
const plural = (value: number) => value % 10 === 1 && value % 100 !== 11 ? 'строка' : [2, 3, 4].includes(value % 10) && ![12, 13, 14].includes(value % 100) ? 'строки' : 'строк'

function highlightMatch(text: string, needle: string): ReactNode {
  if (!needle) return text
  const lower = text.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let hit = lower.indexOf(needle)
  while (hit >= 0) {
    if (hit > cursor) parts.push(text.slice(cursor, hit))
    parts.push(<mark key={cursor}>{text.slice(hit, hit + needle.length)}</mark>)
    cursor = hit + needle.length
    hit = lower.indexOf(needle, cursor)
  }
  if (!parts.length) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

export function MomentDialog({ track, lines, selected, onToggle, onSave, onClose, user, synced, currentLine = -1 }: {
  track: MomentTrack
  lines: MomentLine[]
  selected: number[]
  onToggle: (index: number) => void
  onSave: () => void
  onClose: () => void
  user: User | null
  synced: boolean
  currentLine?: number
}) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const needle = query.trim().toLocaleLowerCase()
  const shown = lines.map((line, index) => ({ line, index })).filter(({ line }) => !needle || line.text.toLocaleLowerCase().includes(needle))
  const current = synced && currentLine >= 0 && currentLine < lines.length ? lines[currentLine] : null
  const progress = Math.round(selected.length / 8 * 100)
  const full = selected.length >= 8

  function jumpToCurrent(smooth = true) {
    const list = listRef.current
    if (!list || currentLine < 0) return
    const node = list.querySelector<HTMLElement>(`[data-line-index="${currentLine}"]`)
    if (!node) return
    const gap = node.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - list.clientHeight / 2 + node.offsetHeight / 2
    list.scrollTo({ top: Math.max(0, gap), behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    if (currentLine < 0 || focused.current) return
    focused.current = true
    const timer = setTimeout(() => jumpToCurrent(false), 70)
    return () => clearTimeout(timer)
  }, [currentLine])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return <div className="modal-backdrop moment-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="moment-modal moment-dialog" role="dialog" aria-modal="true" aria-label="Сохранить Момент">
      <span className="moment-dialog-glow" aria-hidden="true"/>
      <button className="modal-close" onClick={onClose} aria-label="Закрыть"><X size={20}/></button>
      <header className="moment-dialog-head">
        <div className="moment-dialog-eyebrow"><Bookmark size={13}/> ТВОЯ ИСТОРИЯ / НОВЫЙ МОМЕНТ</div>
        <h2>Оставь строки,<br/><em>к которым вернёшься.</em></h2>
        <p>Отметь до восьми строк — порядок нажатий сохранится. Синхронизированный текст вернёт тебя на точное время.</p>
        <div className="moment-dialog-track">
          <span className="moment-dialog-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && '♫'}</span>
          <span className="moment-dialog-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
          <span className="moment-dialog-chip">{lines.length} {plural(lines.length)}</span>
        </div>
        {current ? <div className="moment-now">
          <div className="moment-now-top">
            <span className="moment-now-label"><span className="moment-now-dot"/> Сейчас звучит <em>{stamp(current.at)}</em></span>
            <button type="button" className={`moment-now-add ${selected.includes(currentLine) ? 'is-added' : ''}`} onClick={() => onToggle(currentLine)}>
              {selected.includes(currentLine) ? <><Check size={13}/> В Моменте</> : <><Plus size={13}/> Добавить строку</>}
            </button>
          </div>
          <p>{current.text}</p>
        </div> : !synced ? <div className="moment-dialog-note"><span>Без таймкодов</span> Момент запомнит выбранные строки, а кнопка откроет трек с самого начала.</div> : null}
      </header>
      <div className="moment-dialog-meter">
        <div><span>Выбрано</span><b>{selected.length} / 8</b></div>
        <span className="moment-dialog-bar" aria-hidden="true"><i style={{ width: `${progress}%` }}/></span>
      </div>
      <div className="moment-dialog-search">
        <Search size={16} aria-hidden="true"/>
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти строку в тексте…" aria-label="Поиск по строкам" enterKeyHint="search"/>
        {needle && <span className="moment-dialog-search-count" aria-live="polite">{shown.length}</span>}
        {current && !needle && <button type="button" className="moment-dialog-jump" onClick={() => jumpToCurrent()} title="К строке, которая играет" aria-label="К текущей строке"><LocateFixed size={14}/><span>Сейчас</span></button>}
        {query && <button type="button" className="moment-dialog-search-clear" onClick={() => setQuery('')} aria-label="Очистить поиск"><X size={14}/></button>}
      </div>
      <div className={`moment-select-list ${needle ? 'is-filtered' : ''}`} ref={listRef}>
        {shown.map(({ line, index }, position) => {
          const order = selected.indexOf(index)
          const isSelected = order >= 0
          const isCurrent = synced && index === currentLine
          return <button type="button" key={`${line.at}-${index}`} data-line-index={index} className={`moment-choice ${isSelected ? 'selected' : ''} ${isCurrent ? 'is-current' : ''}`} style={{ '--i': Math.min(position, 14) } as CSSProperties} onClick={() => onToggle(index)} aria-pressed={isSelected}>
            <span className="moment-choice-index">{isSelected ? <><Check size={13}/><em>{order + 1}</em></> : String(index + 1).padStart(2, '0')}</span>
            <span className="moment-choice-body"><span>{highlightMatch(line.text, needle)}</span><span className="moment-choice-meta">{isCurrent && <em className="moment-choice-live"><i/> сейчас</em>}{synced && <small>{stamp(line.at)}</small>}</span></span>
          </button>
        })}
        {needle && !shown.length && <div className="moment-dialog-empty"><Search size={22}/><strong>Ничего не найдено</strong><span>Попробуй другое слово или его часть.</span></div>}
      </div>
      <footer className="moment-dialog-footer">
        <span className="moment-dialog-hint">{needle ? `Найдено: ${shown.length} ${plural(shown.length)}` : full ? 'Лимит восемь строк — убери одну, чтобы добавить другую' : selected.length ? (synced ? 'Порядок строк сохранён' : 'Момент включит трек с начала') : current ? 'Можно начать с текущей строки' : 'Нажми на строку, чтобы выбрать'}</span>
        <div className="moment-dialog-actions">
          <button type="button" className="moment-dialog-cancel" onClick={onClose}>Отмена</button>
          <button type="button" className="primary-btn" disabled={!selected.length} onClick={onSave}><Bookmark size={16}/>{user ? 'Сохранить Момент' : 'Войти и сохранить'}</button>
        </div>
      </footer>
    </div>
  </div>
}
