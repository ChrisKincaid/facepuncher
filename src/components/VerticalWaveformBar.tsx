import { useCallback, useEffect, useRef } from 'react'
import type { Bar } from '../data/models'

interface Props {
  audioUrl?: string
  playhead: number
  totalDuration: number
  bars: Bar[]
  currentBarIndex: number
  onSeek: (time: number) => void
  offsetSec?: number  // Bar 1 start marker
  onOffsetChange?: (newOffset: number) => void  // drag the B1 marker
}

export function VerticalWaveformBar({ audioUrl, playhead, totalDuration, bars, currentBarIndex, onSeek, offsetSec, onOffsetChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef<Float32Array | null>(null)

  // Mirror all draw inputs into refs so draw() itself has no deps (never changes)
  const barsRef = useRef(bars)
  const currentBarIndexRef = useRef(currentBarIndex)
  const playheadRef = useRef(playhead)
  const totalDurationRef = useRef(totalDuration)
  const offsetSecRef = useRef(offsetSec)
  const onOffsetChangeRef = useRef(onOffsetChange)
  const draggingB1Ref = useRef(false)
  useEffect(() => {
    barsRef.current = bars
    currentBarIndexRef.current = currentBarIndex
    playheadRef.current = playhead
    totalDurationRef.current = totalDuration
    offsetSecRef.current = offsetSec
    onOffsetChangeRef.current = onOffsetChange
  }, [bars, currentBarIndex, offsetSec, onOffsetChange, playhead, totalDuration])

  // Stable draw — reads everything from refs, never changes reference
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width
    const h = canvas.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const _bars = barsRef.current
    const _currentBarIndex = currentBarIndexRef.current
    const _playhead = playheadRef.current
    const _totalDuration = totalDurationRef.current
    const vs = 0
    const ve = _totalDuration
    const span = Math.max(ve - vs, 0.001)

    ctx.fillStyle = '#0d0e16'
    ctx.fillRect(0, 0, w, h)

    const peaks = peaksRef.current
    if (!peaks || !_totalDuration) return

    // Bar highlight bands
    for (const bar of _bars) {
      if (bar.endSec < vs || bar.startSec > ve) continue
      const y1 = ((bar.startSec - vs) / span) * h
      const y2 = ((bar.endSec   - vs) / span) * h
      ctx.fillStyle = bar.index === _currentBarIndex
        ? 'rgba(77,208,225,0.18)'
        : 'rgba(255,255,255,0.03)'
      ctx.fillRect(0, y1, w, y2 - y1)
    }

    // Waveform peaks (map global peak index → visible window)
    const n = peaks.length
    for (let i = 0; i < n; i++) {
      const tPeak = (i / n) * _totalDuration
      if (tPeak < vs || tPeak > ve) continue
      const y    = ((tPeak - vs) / span) * h
      const segH = ((_totalDuration / n) / span) * h
      const pw   = Math.max(2, peaks[i] * w * 0.92)
      const x    = (w - pw) / 2
      ctx.fillStyle = `rgba(77,208,225,${0.5 + peaks[i] * 0.5})`
      ctx.fillRect(x, y, pw, Math.max(1, segH * 0.85))
    }

    // Bar division lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    for (const bar of _bars) {
      if (bar.startSec < vs || bar.startSec > ve) continue
      const y = Math.round(((bar.startSec - vs) / span) * h) + 0.5
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }

    // Bar 1 / offsetSec gold marker
    const _offsetSec = offsetSecRef.current
    if (_offsetSec !== undefined && _totalDuration > 0) {
      const oy = ((_offsetSec - vs) / span) * h
      if (oy >= -10 && oy <= h + 10) {
        ctx.save()
        // Dashed gold line across full width
        ctx.strokeStyle = '#f6c177'
        ctx.lineWidth = 1.5
        ctx.setLineDash([6, 4])
        ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(w, oy); ctx.stroke()
        ctx.setLineDash([])
        // Large gold triangle on left edge (drag handle)
        ctx.fillStyle = '#f6c177'
        ctx.beginPath()
        ctx.moveTo(0, oy - 8)
        ctx.lineTo(14, oy)
        ctx.lineTo(0, oy + 8)
        ctx.closePath()
        ctx.fill()
        // "B1" label
        ctx.font = 'bold 9px monospace'
        ctx.fillStyle = '#f6c177'
        ctx.fillText('B1', 16, oy + 3)
        ctx.restore()
      }
    }

    // Playhead — when z>1 this is always at h/2 (waveform scrolls under it)
    if (_totalDuration > 0) {
      const py = ((_playhead - vs) / span) * h
      if (py >= 0 && py <= h) {
        ctx.save()
        ctx.shadowColor = 'rgba(255,255,255,0.7)'
        ctx.shadowBlur = 4
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke()
        ctx.restore()
      }
    }

  }, []) // stable — no deps, reads from refs

  // Fit canvas to container
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fit = () => {
      const parent = canvas.parentElement
      if (!parent) return
      canvas.width = parent.clientWidth || 80
      canvas.height = parent.clientHeight || window.innerHeight
      draw()
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [draw])

  // Decode audio
  useEffect(() => {
    if (!audioUrl) {
      peaksRef.current = null
      draw()
      return
    }
    let cancelled = false
    const ac = new AudioContext()
    fetch(audioUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => ac.decodeAudioData(buf))
      .then((decoded) => {
        if (cancelled) return
        const ch = decoded.getChannelData(0)
        const N = 800
        const bs = Math.floor(ch.length / N)
        const p = new Float32Array(N)
        for (let i = 0; i < N; i++) {
          let max = 0
          const off = i * bs
          for (let j = 0; j < bs; j++) {
            const v = Math.abs(ch[off + j] ?? 0)
            if (v > max) max = v
          }
          p[i] = max
        }
        peaksRef.current = p
        draw()
      })
      .catch((err) => console.error('waveform decode', err))
    return () => {
      cancelled = true
      ac.close().catch(() => {})
    }
  }, [audioUrl, draw])

  // Redraw when visual inputs change
  useEffect(() => {
    draw()
  }, [playhead, currentBarIndex, bars, totalDuration, offsetSec, draw])

  /** Convert a canvas Y coordinate to a time value */
  const yToTime = (clientY: number): number => {
    const canvas = canvasRef.current
    if (!canvas || !totalDuration) return 0
    const rect = canvas.getBoundingClientRect()
    const ratio = (clientY - rect.top) / rect.height
    return Math.max(0, Math.min(ratio * totalDuration, totalDuration))
  }

  /** Is a clientY within ±12px of the B1 marker? */
  const isNearB1 = (clientY: number): boolean => {
    const canvas = canvasRef.current
    if (!canvas || offsetSec === undefined || !totalDuration) return false
    const rect = canvas.getBoundingClientRect()
    const b1Y = (offsetSec / Math.max(totalDuration, 0.001)) * rect.height + rect.top
    return Math.abs(clientY - b1Y) < 14
  }

  // Mouse down: start B1 drag if near the marker, else normal click-to-seek
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isNearB1(e.clientY) && onOffsetChange) {
      e.preventDefault()
      draggingB1Ref.current = true
      const onMove = (me: MouseEvent) => {
        const t = yToTime(me.clientY)
        onOffsetChangeRef.current?.(t)
      }
      const onUp = () => {
        draggingB1Ref.current = false
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // If we just finished a B1 drag, don't also seek
    if (draggingB1Ref.current) return
    const t = yToTime(e.clientY)
    onSeek(t)
  }

  // Update cursor when hovering near B1 marker
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.cursor = (onOffsetChange && isNearB1(e.clientY)) ? 'grab' : 'pointer'
  }

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      title="Click to seek · drag gold ▶ to move Bar 1"
      style={{ display: 'block', width: '100%', height: '100%', cursor: 'pointer' }}
    />
  )
}

