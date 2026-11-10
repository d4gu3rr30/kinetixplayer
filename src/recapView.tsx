import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Crown, Disc3, Flame, Headphones, Moon, Music2, Play, Sparkles, Star, Sun, Sunrise, Sunset, X } from 'lucide-react'
import { ArtistFace } from './artistFace'
import { artistByName } from './catalog'
import type { ListenStats } from './listening'
import { formatListenTime } from './listening'
import { MONTHS_FULL, MONTHS_SHORT, buildRecap, hasRecap, recapDayLabel, recapHoursLabel, type RecapData, type RecapPart, type RecapTrack } from './recap'

type SlideKey = 'intro' | 'time' | 'artists' | 'tracks' | 'rhythm' | 'final'

const plural = (count: number, one: string, few: string, many: string) => count % 10 === 1 && count % 100 !== 11 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many
const artistsWord = (count: number) => plural(count, 'исполнитель', 'исполнителя', 'исполнителей')
const dayWord = (count: number) => plural(count, 'день', 'дня', 'дней')
const momentWord = (count: number) => plural(count, 'момент', 'момента', 'моментов')
const tintOf = (name: string) => artistByName(name)?.tint || `hsl(${[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360} 42% 32%)`
const stagger = (index: number, base = 240, step = 90) => ({ '--i': index, '--d': `${base + index * step}ms` } as CSSProperties)
const partIcon = (part?: Pick<RecapPart, 'key'> | null) => part?.key === 'night' ? Moon : part?.key === 'morning' ? Sunrise : part?.key === 'day' ? Sun : Sunset
const partLabel = (hour: number | null) => hour === null ? '' : hour < 6 ? 'ночью' : hour < 12 ? 'утром' : hour < 18 ? 'днём' : 'вечером'

function useCountUp(target: number, duration = 950) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setValue(target); return }
    const start = Date.now()
    setValue(0)
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - start) / duration)
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))))
      if (progress >= 1) window.clearInterval(timer)
    }, 32)
    return () => window.clearInterval(timer)
  }, [target, duration])
  return value
}

function BigTime({ seconds }: { seconds: number }) {
  const minutes = Math.round(seconds / 60)
  const shown = useCountUp(minutes)
  if (minutes < 60) return <div className="recap-bignum"><strong>{shown}</strong><span>мин</span><em>в этом году</em></div>
  const hours = Math.floor(shown / 60)
  const rest = shown % 60
  return <div className="recap-bignum"><strong>{hours}</strong><span>ч</span><em>{String(rest).padStart(2, '0')} мин в этом году</em></div>
}

function Collage({ recap }: { recap: RecapData }) {
  if (recap.coverArt.length) return <div className="recap-collage">{recap.coverArt.map((art, index) => <i key={`${art}-${index}`} style={{ '--n': index, backgroundImage: `url("${art.replace(/"/g, '')}")` } as CSSProperties}/>)}</div>
  const faces = recap.artists.slice(0, 3)
  if (!faces.length) return <div className="recap-collage is-empty"><Disc3 size={54}/></div>
  return <div className="recap-collage is-faces">{faces.map((artist, index) => <i key={artist.name} style={{ '--n': index, background: tintOf(artist.name) } as CSSProperties}><ArtistFace name={artist.name}/></i>)}</div>
}

function Stat({ icon, value, label, tone, index }: { icon: ReactNode; value: string; label: string; tone?: string; index: number }) {
  return <div className="recap-stat" style={{ ...(tone ? { '--tone': tone } : {}), '--i': index, '--d': `${360 + index * 85}ms`, '--di': `${460 + index * 85}ms`, '--ds': `${520 + index * 90}ms` } as CSSProperties}><span className="recap-stat-icon">{icon}</span><strong>{value}</strong><small>{label}</small></div>
}

function MonthBars({ months }: { months: number[] }) {
  const max = Math.max(1, ...months)
  return <div className="recap-months" aria-hidden="true">{months.map((value, index) => <span key={index} className={value === max && value > 0 ? 'is-top' : ''} style={stagger(index, 420, 24)}><i style={{ '--h': `${Math.max(value > 0 ? 8 : 2, value / max * 100)}%` } as CSSProperties}/><em>{MONTHS_SHORT[index]}</em></span>)}</div>
}

function HourBars({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours)
  return <div className="recap-hours" aria-hidden="true">{hours.map((value, hour) => <span key={hour} className={value === max ? 'is-top' : ''} style={stagger(hour, 320, 14)}><i style={{ '--h': `${Math.max(value > 0 ? 6 : 2, value / max * 100)}%` } as CSSProperties}/>{hour % 6 === 0 && <em>{hour}:00</em>}</span>)}</div>
}

function ArtistPodium({ recap, onArtist }: { recap: RecapData; onArtist?: (name: string) => void }) {
  const top = recap.artists.slice(0, 3)
  const order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0]
  return <div className={`recap-podium count-${top.length}`}>{order.map((index, position) => {
    const artist = top[index]
    const rank = index + 1
    return <button key={artist.name} className={`recap-podium-spot rank-${rank}`} style={{ '--i': position, '--d': `${160 + position * 110}ms`, '--fd': `${position * -1.7}s`, background: tintOf(artist.name) } as CSSProperties} onClick={() => onArtist?.(artist.name)}>
      <span className="recap-podium-rank">{rank === 1 ? <><Crown size={11}/> ТОП 01</> : `0${rank}`}</span>
      <span className="recap-podium-avatar">
        <i className="recap-podium-halo"/>
        <span className="recap-podium-face"><ArtistFace name={artist.name}/></span>
      </span>
      <strong>{artist.name}</strong>
      <small>{formatListenTime(artist.seconds)} · {Math.round(artist.share * 100)}%</small>
      <span className="recap-podium-bar"><i style={{ width: `${Math.max(10, artist.seconds / top[0].seconds * 100)}%` }}/></span>
    </button>
  })}</div>
}

export function RecapBanner({ year, stats, onOpen }: { year: number; stats: ListenStats; onOpen: () => void }) {
  const recap = useMemo(() => buildRecap(stats, year), [stats, year])
  if (!hasRecap(stats, year)) return null
  const time = recapHoursLabel(recap.totalSeconds)
  const top = recap.artists[0]
  return <section className="recap-banner" aria-label={`Итоги ${year} года`}>
    <span className="recap-banner-aurora"/>
    <button className="recap-banner-hit" onClick={onOpen}>
      <span className="recap-banner-copy">
        <span className="recap-banner-kicker"><Sparkles size={12}/> KINETIX · ИТОГИ ГОДА</span>
        <strong className="recap-banner-title">Твой {year} <em>в музыке.</em></strong>
        <span className="recap-banner-sub">{time.value} {time.unit} · {recap.artistCount} {artistsWord(recap.artistCount)} · {recap.activeDays} {dayWord(recap.activeDays)}{top ? <> · главный голос — <em>{top.name}</em></> : null}</span>
        <span className="recap-banner-cta">Смотреть итоги <ArrowRight size={16}/></span>
      </span>
      <span className="recap-banner-art" aria-hidden="true">
        <Collage recap={recap}/>
        <span className="recap-banner-year">{year}</span>
        <span className="recap-banner-spark"><Star size={13}/></span>
      </span>
    </button>
  </section>
}

export function RecapOverlay({ year, stats, moments, onClose, onPlayTrack, onArtist }: { year: number; stats: ListenStats; moments?: Array<{ createdAt: string }>; onClose: () => void; onPlayTrack?: (track: RecapTrack) => void; onArtist?: (name: string) => void }) {
  const recap = useMemo(() => buildRecap(stats, year, moments), [stats, year, moments])
  const slides = useMemo<SlideKey[]>(() => ['intro', 'time', ...(recap.artists.length ? ['artists' as SlideKey] : []), ...(recap.tracks.length ? ['tracks' as SlideKey] : []), 'rhythm', 'final'], [recap.artists.length, recap.tracks.length])
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const closeRef = useRef<HTMLButtonElement>(null)
  const touch = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false })
  const total = slides.length

  function go(next: number) {
    const target = Math.max(0, Math.min(total - 1, next))
    if (target === index) return
    setDirection(target > index ? 1 : -1)
    setIndex(target)
  }

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => { document.body.style.overflow = previous }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); setDirection(1); setIndex(value => Math.min(total - 1, value + 1)) }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); setDirection(-1); setIndex(value => Math.max(0, value - 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, total])

  const favoritePart = recap.favoriteHour === null ? null : recap.parts.find(part => {
    if (part.key === 'night') return recap.favoriteHour! < 6
    if (part.key === 'morning') return recap.favoriteHour! < 12
    if (part.key === 'day') return recap.favoriteHour! < 18
    return true
  })
  const FavoriteIcon = partIcon(favoritePart)
  const topTrack = recap.tracks[0]
  const time = recapHoursLabel(recap.totalSeconds)
  const slide = slides[index]

  function slideContent(key: SlideKey) {
    if (key === 'intro') return <div className="recap-slide recap-intro">
      <span className="recap-intro-aurora"/>
      <div className="recap-intro-art"><Collage recap={recap}/><span className="recap-intro-disc"/></div>
      <div className="recap-intro-copy">
        <span className="recap-kicker">ТВОЙ ГОД В ЗВУКЕ</span>
        <h2 className="recap-year" aria-label={String(year)}>{String(year).split('').map((digit, digitIndex) => <span key={digitIndex} style={stagger(digitIndex)}>{digit}</span>)}</h2>
        <p>Год, который звучал <em>твоим</em> голосом.</p>
        <div className="recap-intro-stats">
          <span><strong>{time.value}</strong> {time.unit}</span>
          <span><strong>{recap.artistCount}</strong> {artistsWord(recap.artistCount)}</span>
          <span><strong>{recap.activeDays}</strong> {dayWord(recap.activeDays)}</span>
        </div>
      </div>
    </div>

    if (key === 'time') return <div className="recap-slide recap-time">
      <div className="recap-slide-head"><span className="recap-kicker">ВРЕМЯ В МУЗЫКЕ</span><h3>Сколько тебя было<br/><em>в этом году</em></h3></div>
      <BigTime seconds={recap.totalSeconds}/>
      <div className="recap-time-grid">
        <Stat icon={<CalendarDays size={17}/>} value={String(recap.activeDays)} label={dayWord(recap.activeDays)+' с музыкой'} index={0}/>
        <Stat icon={<Headphones size={17}/>} value={formatListenTime(recap.averageSeconds)} label="в средний день" index={1}/>
        <Stat icon={<Flame size={17}/>} value={String(recap.longestStreak)} label={dayWord(recap.longestStreak)+' подряд'} tone="#ffb35c" index={2}/>
        <Stat icon={<Star size={17}/>} value={recap.topMonth >= 0 ? MONTHS_FULL[recap.topMonth] : '—'} label="самый громкий месяц" tone="#d7ff57" index={3}/>
      </div>
      <MonthBars months={recap.months}/>
    </div>

    if (key === 'artists') return <div className="recap-slide recap-artists">
      <div className="recap-slide-head"><span className="recap-kicker">ТВОИ ГЛАВНЫЕ ГОЛОСА</span><h3>Кто звучал<br/><em>чаще всех</em></h3></div>
      <ArtistPodium recap={recap} onArtist={onArtist}/>
      {recap.artists.length > 3 && <div className="recap-artist-rest">{recap.artists.slice(3, 8).map((artist, position) => <button key={artist.name} style={stagger(position, 440, 60)} onClick={() => onArtist?.(artist.name)}>
        <span className="recap-artist-rank">{String(position + 4).padStart(2, '0')}</span>
        <span className="recap-artist-face" style={{ background: tintOf(artist.name) }}><ArtistFace name={artist.name}/></span>
        <span className="recap-artist-copy"><strong>{artist.name}</strong><i><b style={{ width: `${Math.max(6, artist.seconds / recap.artists[0].seconds * 100)}%`, '--db': `${520 + position * 60}ms` } as CSSProperties}/></i></span>
        <span className="recap-artist-time">{formatListenTime(artist.seconds)}</span>
      </button>)}</div>}
    </div>

    if (key === 'tracks') return <div className="recap-slide recap-tracks">
      <div className="recap-slide-head"><span className="recap-kicker">ТВОИ ТРЕКИ</span><h3>Звук, который<br/><em>запомнился</em></h3></div>
      <div className={`recap-track-grid count-${Math.min(recap.tracks.length, 3)}`}>{recap.tracks.slice(0, 3).map((track, position) => <button key={track.key} className={`recap-track rank-${position + 1}`} style={{ '--i': position, '--d': `${240 + position * 95}ms`, '--da': `${280 + position * 95}ms`, '--dr': `${position * .35}s` } as CSSProperties} onClick={() => onPlayTrack?.(track)} title={`Включить «${track.title}»`}>
        <span className="recap-track-art" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined}>{!track.artwork && <Music2 size={30}/>}<span className="recap-track-play"><Play size={15} fill="currentColor"/></span><span className="recap-track-rank">{String(position + 1).padStart(2, '0')}</span></span>
        <strong>{track.title}</strong>
        <small>{track.artist}</small>
        <em>{formatListenTime(track.seconds)}</em>
      </button>)}</div>
      {recap.tracks.length > 3 && <div className="recap-track-rest">{recap.tracks.slice(3).map((track, position) => <button key={track.key} style={stagger(position, 430, 45)} onClick={() => onPlayTrack?.(track)}><span>{String(position + 4).padStart(2, '0')}</span><strong>{track.title}</strong><small>{track.artist}</small><em>{formatListenTime(track.seconds)}</em></button>)}</div>}
    </div>

    if (key === 'rhythm') return <div className="recap-slide recap-rhythm">
      <div className="recap-slide-head"><span className="recap-kicker">ТВОЙ РИТМ</span><h3>{recap.favoriteHour !== null ? <>Громче всего —<br/><em>{partLabel(recap.favoriteHour)}</em></> : <>Твой год<br/><em>по месяцам</em></>}</h3></div>
      {recap.favoriteHour !== null ? <div className="recap-favorite-hour">
        <span className="recap-favorite-icon"><FavoriteIcon size={30}/></span>
        <strong>{String(recap.favoriteHour).padStart(2, '0')}:00</strong>
        <small>твой любимый час</small>
      </div> : null}
      {recap.hours.length ? <HourBars hours={recap.hours}/> : <MonthBars months={recap.months}/>}
      {recap.parts.length ? <div className="recap-parts">{recap.parts.map((part, index) => {
        const Icon = partIcon(part)
        return <div key={part.key} className={`recap-part is-${part.key}`} style={{ '--i': index, '--d': `${380 + index * 70}ms`, '--dp': `${470 + index * 70}ms` } as CSSProperties}><span><Icon size={15}/>{part.label}</span><strong>{Math.round(part.share * 100)}%</strong><i><b style={{ width: `${Math.max(3, part.share * 100)}%` }}/></i></div>
      })}</div> : null}
      <div className="recap-rhythm-foot">
        {recap.topDay && <span><Flame size={14}/> Самый громкий день — <strong>{recapDayLabel(recap.topDay.date)}</strong>, {formatListenTime(recap.topDay.seconds)}</span>}
        {recap.newArtists.length ? <span><Sparkles size={14}/> Открыл для себя <strong>{recap.newArtists.length}</strong> {artistsWord(recap.newArtists.length)}</span> : null}
      </div>
    </div>

    return <div className="recap-slide recap-final">
      <span className="recap-final-aurora"/>
      <div className="recap-final-copy">
        <span className="recap-kicker">ДО ВСТРЕЧИ В {year + 1}-М</span>
        <h3>Твой год<br/><em>звучал.</em></h3>
        <p>{time.value} {time.unit} музыки, {recap.artistCount} {artistsWord(recap.artistCount)} и {recap.moments} {momentWord(recap.moments)}, которые остались в строках.</p>
        <div className="recap-final-stats">
          <span><Clock size={14}/>{recap.longestStreak} {dayWord(recap.longestStreak)} подряд</span>
          {recap.newArtists.length ? <span><Sparkles size={14}/>{recap.newArtists.length} новых {artistsWord(recap.newArtists.length)}</span> : null}
          {topTrack ? <span><Star size={14}/>«{topTrack.title}»</span> : null}
        </div>
        <div className="recap-final-actions">
          {topTrack && <button className="recap-final-play" onClick={() => onPlayTrack?.(topTrack)}><Play size={15} fill="currentColor"/> Включить главный трек</button>}
          <button className="recap-final-close" onClick={onClose}>Готово <Check size={15}/></button>
        </div>
      </div>
      <div className="recap-final-art">
        {recap.artists[0] ? <span className="recap-final-avatar"><span className="recap-final-halo"/><span className="recap-final-face" style={{ background: tintOf(recap.artists[0].name) }}><ArtistFace name={recap.artists[0].name}/><i/></span></span> : <span className="recap-final-disc"><Disc3 size={54}/></span>}
        <span className="recap-final-sparks" aria-hidden="true">{[0, 1, 2, 3, 4].map(index => <i key={index} style={{ '--x': `${16 + index * 17}%`, '--d': `${index * .7}s` } as CSSProperties}/>)}</span>
      </div>
      <span className="recap-watermark">kinetix</span>
    </div>
  }

  return createPortal(<div className="recap-layer" role="dialog" aria-modal="true" aria-label={`Итоги ${year} года`}>
    <span className="recap-layer-glow"/>
    <header className="recap-head">
      <span className="recap-brand"><i/> KINETIX <em>WRAPPED</em></span>
      <div className="recap-progress" role="tablist" aria-label="Слайды итогов">{slides.map((key, position) => <button key={key} role="tab" aria-selected={position === index} aria-label={`Слайд ${position + 1}`} className={position < index ? 'is-done' : position === index ? 'is-active' : ''} onClick={() => go(position)}><i/></button>)}</div>
      <button ref={closeRef} className="recap-close" onClick={onClose} aria-label="Закрыть итоги года"><X size={20}/></button>
    </header>
    <div className={`recap-stage enter-${direction > 0 ? 'next' : 'prev'}`} key={`${index}-${slide}`}
      onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; touch.current = { x: event.clientX, y: event.clientY, active: true } }}
      onPointerUp={event => { if (!touch.current.active) return; const dx = event.clientX - touch.current.x; const dy = event.clientY - touch.current.y; touch.current.active = false; if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.4) go(index + (dx < 0 ? 1 : -1)) }}
      onPointerCancel={() => { touch.current.active = false }}>
      {slideContent(slide)}
    </div>
    <footer className="recap-footer">
      <button className="recap-nav" onClick={() => go(index - 1)} disabled={index === 0}><ChevronLeft size={16}/> Назад</button>
      <span className="recap-count">{index + 1} / {total}</span>
      {index < total - 1 ? <button className="recap-next" onClick={() => go(index + 1)}>Дальше <ChevronRight size={16}/></button> : <button className="recap-next" onClick={onClose}>Готово <Check size={16}/></button>}
    </footer>
  </div>, document.body)
}
