import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import type { Region } from 'wavesurfer.js/plugins/regions'
import type { Bar } from '../data/models'

interface Props {
  audioUrl?: string
  bars: Bar[]
  currentBarIndex: number
  onBarUpdate: (barIndex: number, start: number, end: number) => void
  onSeek: (time: number) => void
}

export function Waveform({ audioUrl, bars, currentBarIndex, onBarUpdate, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)

  useEffect(() => {
    if (!containerRef.current || !audioUrl) return

    const targetHeight = containerRef.current.clientHeight || 640
    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: targetHeight,
      waveColor: '#4dd0e1',
      progressColor: '#f6c177',
      cursorColor: '#fff',
      normalize: true,
    })
    const regions = ws.registerPlugin(RegionsPlugin.create()) as ReturnType<typeof RegionsPlugin.create>
    regionsRef.current = regions

    wavesurferRef.current = ws
    ws.load(audioUrl)

    ws.on('interaction', () => {
      const t = ws.getCurrentTime()
      onSeek(t)
    })

    return () => {
      ws.destroy()
      wavesurferRef.current = null
      regionsRef.current = null
    }
  }, [audioUrl, onSeek])

  // Sync regions when bars change
  useEffect(() => {
    const ws = wavesurferRef.current
    const regions = regionsRef.current
    if (!ws || !regions) return
    regions.clearRegions()
    bars.forEach((bar) => {
      regions.addRegion({
        id: `bar-${bar.index}`,
        start: bar.startSec,
        end: bar.endSec,
        drag: false,
        resize: false,
        color: bar.index === currentBarIndex ? 'rgba(77, 208, 225, 0.18)' : 'rgba(255,255,255,0.08)',
      })
    })

    regions.on('region-updated', (region: Region) => {
      const idx = parseInt(region.id.replace('bar-', ''), 10)
      onBarUpdate(idx, region.start, region.end)
    })

    regions.on('region-clicked', (region: Region, e: MouseEvent) => {
      e.stopPropagation()
      ws.seekTo(region.start / ws.getDuration())
      onSeek(region.start)
    })
  }, [bars, currentBarIndex, onBarUpdate, onSeek])

  return (
    <div className="wave-outer">
      <div className="wave-shell wave-vertical" ref={containerRef} />
    </div>
  )
}
