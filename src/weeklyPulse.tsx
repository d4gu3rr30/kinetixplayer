import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic2, Minus, Play, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { formatListenTime, type ListenStats, type TrackListenEntry } from './listening'
import { buildWeekPulse, type PulseDay } from './pulse'

function useCountUp(value: number) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (from.current === value) { setShown(value); return }
    const start = from.current
    const began = performance.now()
    const timer = setInterval(() => {
      const progress = Math.min(1, (performance.now() - began) / 640)
      const eased = 1 - Math.pow(1 - progress, 3)
      setShown(start + (value - start) * eased)
      if (progress >= 1) {
        clearInterval(timer)
        from.current = value
        setShown(value)
      }
    }, 32)
    return () => clearInterval(timer)
  }, [value])
  return shown
}

const dayTitle = (day: PulseDay) => `${day.label}, ${day.date} — ${day.seconds >= 60 ? formatListenTime(day.seconds) : 'меньше минуты'}`

export function WeeklyPulse({ stats, onPlay }: { stats: ListenStats | null; onPlay: (track: TrackListenEntry) => void }) {
  const pulse = useMemo(() => buildWeekPulse(stats), [stats])
  const total = pulse?.total || 0
  const shown = useCountUp(total)
  if (!pulse || total < 60) return null
  const max = Math.max(...pulse.days.map(day => day.seconds), 1)
  const track = pulse.topTrack
  const artwork = track?.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '')}")` } : undefined
  const change = pulse.change
  return <section className="home-pulse" aria-label="Пульс недели">
    <span className="pulse-sheen" aria-hidden="true"/>
    <div className="pulse-intro">
      <span className="pulse-kicker"><i className="pulse-dot"/>ПУЛЬС НЕДЕЛИ</span>
      <div className="pulse-total">
        <strong>{formatListenTime(shown)}</strong>
        {change === null ? <span className="pulse-note"><Sparkles size={11}/>{pulse.previous >= 60 ? 'Ровный ритм' : 'Первая неделя в ритме'}</span> : change === 0 ? <span className="pulse-note"><Minus size={11}/>Как на прошлой неделе</span> : <span className={`pulse-note ${change < 0 ? 'is-down' : ''}`}>{change > 0 ? <TrendingUp size={11}/> : <TrendingDown size={11}/>}{change > 0 ? '+' : ''}{change}% к прошлой неделе</span>}
      </div>
    </div>
    <div className="pulse-chart" role="img" aria-label={`Время за последние 7 дней: ${pulse.days.map(day => `${day.label} — ${formatListenTime(day.seconds)}`).join(', ')}`}>
      {pulse.days.map((day, index) => <span key={day.key} className={`pulse-day ${day.isToday ? 'is-today' : ''}`} title={dayTitle(day)}>
        <span className="pulse-bar"><i style={{ height: `${Math.max(day.seconds ? 8 : 3, Math.round(day.seconds / max * 100))}%`, animationDelay: `${index * 45}ms` }}/></span>
        <small>{day.label}</small>
      </span>)}
    </div>
    {track ? <button className="pulse-top" onClick={() => onPlay(track)} aria-label={`Включить ${track.title} — ${track.artist}`} title={`Включить ${track.title}`}>
      <span className="pulse-top-art" style={artwork}>{!track.artwork && <Mic2 size={16}/>}</span>
      <span className="pulse-top-copy"><small>ГЛАВНЫЙ ТРЕК НЕДЕЛИ</small><strong>{track.title}</strong><em>{track.artist}</em></span>
      <span className="pulse-top-play"><Play size={14} fill="currentColor"/></span>
    </button> : <div className="pulse-top pulse-top-quiet">
      <span className="pulse-top-art"><Mic2 size={16}/></span>
      <span className="pulse-top-copy"><small>{pulse.topArtist ? 'ГЛАВНЫЙ ИСПОЛНИТЕЛЬ' : 'ТВОЙ РИТМ'}</small><strong>{pulse.topArtist || 'Звук уже в пути'}</strong><em>{pulse.topArtist ? 'Больше всего времени на неделе' : 'Включи трек — и здесь появится статистика'}</em></span>
    </div>}
  </section>
}
