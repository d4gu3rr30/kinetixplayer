import { useEffect, useRef } from 'react'

const count = 48
const MIN_HZ = 45
const MAX_HZ = 14000
type Graph = { context: AudioContext; source: MediaElementAudioSourceNode; analyser: AnalyserNode; bands: Array<[number, number]> }
const graphs = new WeakMap<HTMLAudioElement, Graph>()

function buildBands(binCount: number, sampleRate: number): Array<[number, number]> {
  const nyquist = sampleRate / 2
  const bands: Array<[number, number]> = []
  for (let index = 0; index < count; index++) {
    const low = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, index / count)
    const high = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (index + 1) / count)
    const start = Math.max(1, Math.min(binCount - 1, Math.floor(low / nyquist * binCount)))
    const end = Math.max(start + 1, Math.min(binCount, Math.ceil(high / nyquist * binCount)))
    bands.push([start, end])
  }
  return bands
}

export function Visualizer({ audioRef, playing }: { audioRef: React.RefObject<HTMLAudioElement | null>; playing: boolean }) {
  const bars = useRef<HTMLSpanElement[]>([])
  const context = useRef<AudioContext | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let frame = 0
    let graph: Graph | undefined
    let created: AudioContext | null = null
    try {
      graph = graphs.get(audio)
      if (!graph) {
        const next = new AudioContext()
        created = next
        const source = next.createMediaElementSource(audio)
        const analyser = next.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = .4
        analyser.minDecibels = -88
        analyser.maxDecibels = -12
        source.connect(analyser)
        analyser.connect(next.destination)
        graph = { context: next, source, analyser, bands: buildBands(analyser.frequencyBinCount, next.sampleRate) }
        graphs.set(audio, graph)
        created = null
      }
      context.current = graph.context
      const data = new Uint8Array(graph.analyser.frequencyBinCount)
      const levels = new Float32Array(count)
      const smoothed = new Float32Array(count)
      let gain = 1
      let last = 0
      const draw = (now: number) => {
        if (now - last > 24) {
          graph!.analyser.getByteFrequencyData(data)
          let total = 0
          for (let index = 0; index < count; index++) {
            const [start, end] = graph!.bands[index]
            let sum = 0
            for (let bin = start; bin < end; bin++) sum += data[bin]
            const magnitude = sum / Math.max(1, end - start) / 255
            levels[index] = Math.pow(Math.min(1, magnitude), .82)
            total += levels[index]
          }
          const average = total / count
          const wanted = Math.min(2.8, Math.max(.68, .6 / Math.max(average, .01)))
          gain += (wanted - gain) * (wanted < gain ? .34 : .07)
          const silent = audio.paused || audio.ended
          for (let index = 0; index < count; index++) {
            const raw = silent ? 0 : levels[index] * gain
            const shaped = silent ? 0 : Math.pow(raw / (1 + raw), .62)
            smoothed[index] = shaped > smoothed[index] ? smoothed[index] + (shaped - smoothed[index]) * .72 : smoothed[index] + (shaped - smoothed[index]) * (silent ? .22 : .13)
            const bar = bars.current[index]
            if (!bar) continue
            const value = Math.min(1, Math.max(0, smoothed[index]))
            bar.style.transform = `scaleY(${.06 + value * .94})`
            bar.style.opacity = String(.28 + value * .72)
          }
          last = now
        }
        frame = requestAnimationFrame(draw)
      }
      frame = requestAnimationFrame(draw)
      if (!audio.paused) graph.context.resume().catch(() => {})
    } catch { created?.close().catch(() => {}) }
    const resume = () => graph?.context.resume().catch(() => {})
    audio.addEventListener('play', resume)
    return () => {
      cancelAnimationFrame(frame)
      audio.removeEventListener('play', resume)
      context.current = null
      // The audio graph stays wired to this <audio> element for the whole session.
      // A MediaElementAudioSourceNode can be created only once, so closing it when the
      // bars unmount (visualizer or low-end mode off) would permanently mute playback.
    }
  }, [audioRef])

  useEffect(() => { if (playing) context.current?.resume().catch(() => {}) }, [playing])

  return <div className="player-visualizer" aria-hidden="true">{Array.from({ length: count }, (_, index) => <span key={index} ref={element => { if (element) bars.current[index] = element }}/>)}</div>
}
