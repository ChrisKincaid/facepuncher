import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Bar } from '../data/models'

interface Props {
  audioBuffer: AudioBuffer | null
  playhead: number          // user's fixed play-from position
  cursor: number            // live playback position
  isPlaying: boolean
  totalDuration: number
  bars: Bar[]
  currentBarIndex: number
  loopEnabled: boolean
  loopRange?: { start: number; end: number }
  onLoopRangeChange: (start: number, end: number) => void
  onSeek: (time: number) => void
}

/**
 * Horizontal zoomable waveform detail view.
 * - Scroll wheel zooms smoothly (centered on mouse)
 * - Drag to pan when zoomed
 * - Click to set play position
 * - Shows both play position marker (gold) and playback cursor (white)
 * - Bar grid lines with labels
 * - Pixel-perfect peaks at any zoom level
 */
export function HorizontalWaveformDetail({
  audioBuffer,
  playhead,
  cursor,
  isPlaying,
  totalDuration,
  bars,
  currentBarIndex,
  loopEnabled,
  loopRange,
  onLoopRangeChange,
  onSeek,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const channelDataRef = useRef<Float32Array | null>(null)
  const precomputedPeaksRef = useRef<Float32Array | null>(null)
  const PRECOMPUTED_COUNT = 4000 // pre-downsampled peak count

  // View window state
  const [zoom, setZoom] = useState(1)       // 1 = full song, higher = zoomed in
  const [viewCenter, setViewCenter] = useState(0) // center time of view window

  // Refs for stable draw function
  const zoomRef = useRef(zoom)
  const viewCenterRef = useRef(viewCenter)
  const playheadRef = useRef(playhead)
  const cursorRef = useRef(cursor)
  const isPlayingRef = useRef(isPlaying)
  const barsRef = useRef(bars)
  const currentBarIndexRef = useRef(currentBarIndex)
  const loopEnabledRef = useRef(loopEnabled)
  const loopRangeRef = useRef(loopRange)
  const totalDurationRef = useRef(totalDuration)
  useLayoutEffect(() => {
    zoomRef.current = zoom
    viewCenterRef.current = viewCenter
    playheadRef.current = playhead
    cursorRef.current = cursor
    isPlayingRef.current = isPlaying
    barsRef.current = bars
    currentBarIndexRef.current = currentBarIndex
    loopEnabledRef.current = loopEnabled
    loopRangeRef.current = loopRange
    totalDurationRef.current = totalDuration
  }, [bars, currentBarIndex, cursor, isPlaying, loopEnabled, loopRange, playhead, totalDuration, viewCenter, zoom])

  // DPR ref for draw function
  const dprRef = useRef(1)

  const pointerDragRef = useRef<{
    pointerId: number
    startX: number
    startTime: number
    mode: 'select' | 'start-handle' | 'end-handle' | 'playhead'
    moved: boolean
  } | null>(null)
  const hoverXRef = useRef<number | null>(null)  // mouse X for hover line

  /** Get visible time window */
  function getView(): { vs: number; ve: number } {
    const dur = totalDurationRef.current
    const z = zoomRef.current
    const center = viewCenterRef.current
    if (!dur || z <= 1) return { vs: 0, ve: dur || 1 }
    const halfSpan = dur / z / 2
    // Clamp so we don't go past edges
    const cCenter = Math.max(halfSpan, Math.min(dur - halfSpan, center))
    return { vs: cCenter - halfSpan, ve: cCenter + halfSpan }
  }

  /** Compute peaks for the visible window.
   *  Uses pre-downsampled data for speed — no raw sample iteration each frame. */
  function computeVisiblePeaks(w: number): Float32Array | null {
    const pp = precomputedPeaksRef.current
    if (!pp || !totalDurationRef.current) return null
    const { vs, ve } = getView()
    const span = ve - vs
    const dur = totalDurationRef.current
    const n = pp.length
    const peaks = new Float32Array(w)
    for (let px = 0; px < w; px++) {
      const t0 = vs + (px / w) * span
      const t1 = vs + ((px + 1) / w) * span
      const i0 = Math.max(0, Math.floor((t0 / dur) * n))
      const i1 = Math.min(n, Math.ceil((t1 / dur) * n))
      let max = 0
      for (let i = i0; i < i1; i++) {
        if (pp[i] > max) max = pp[i]
      }
      peaks[px] = max
    }
    return peaks
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width
    const h = canvas.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.resetTransform()

    const _bars = barsRef.current
    const _currentBarIndex = currentBarIndexRef.current
    const _loopEnabled = loopEnabledRef.current
    const _loopRange = loopRangeRef.current
    const _playhead = playheadRef.current
    const _cursor = cursorRef.current
    const _isPlaying = isPlayingRef.current
    const _dur = totalDurationRef.current
    const { vs, ve } = getView()
    const span = Math.max(ve - vs, 0.001)

    // Background
    ctx.fillStyle = '#0d0e16'
    ctx.fillRect(0, 0, w, h)
    if (!_dur) return

    // Bar highlight bands
    for (const bar of _bars) {
      if (bar.endSec < vs || bar.startSec > ve) continue
      const x1 = ((bar.startSec - vs) / span) * w
      const x2 = ((bar.endSec - vs) / span) * w
      ctx.fillStyle = bar.index === _currentBarIndex
        ? 'rgba(77,208,225,0.12)'
        : 'rgba(255,255,255,0.02)'
      ctx.fillRect(x1, 0, x2 - x1, h)
    }

    // Bar grid lines + labels
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 1
    const fontSize = Math.round(10 * dprRef.current)
    ctx.font = `${fontSize}px monospace`
    ctx.fillStyle = 'rgba(160,163,177,0.6)'
    for (const bar of _bars) {
      if (bar.startSec < vs - span * 0.1 || bar.startSec > ve + span * 0.1) continue
      const x = Math.round(((bar.startSec - vs) / span) * w) + 0.5
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      const labelX = x + 3
      if (labelX > 0 && labelX < w - 20) {
        ctx.fillText(`${bar.index + 1}`, labelX, fontSize + 2)
      }
    }

    // Waveform drawing — two modes depending on zoom level
    const ch = channelDataRef.current
    const dur = _dur
    if (ch && dur) {
      const midY = h / 2
      const ampH = h * 0.44
      const samplesPerPx = (span / dur) * ch.length / w

      if (samplesPerPx < 500) {
        // ZOOMED IN: Draw smooth waveform from raw samples
        // For each pixel, find min and max sample value, draw a vertical line between them
        // At very high zoom (< ~4 samples/px), connect as a polyline
        const sampleRate = ch.length / dur

        if (samplesPerPx <= 4) {
          // Ultra-zoom: draw actual waveform as connected line
          ctx.strokeStyle = 'rgba(77,208,225,0.9)'
          ctx.lineWidth = 1.5
          ctx.beginPath()
          const s0 = Math.max(0, Math.floor(vs * sampleRate))
          const s1 = Math.min(ch.length, Math.ceil(ve * sampleRate))
          let started = false
          for (let s = s0; s < s1; s++) {
            const t = s / sampleRate
            const x = ((t - vs) / span) * w
            const y = midY - ch[s] * ampH
            if (!started) { ctx.moveTo(x, y); started = true }
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        } else {
          // Medium zoom: min/max envelope per pixel (smooth filled shape)
          ctx.beginPath()
          // Top edge (max values, left to right)
          for (let px = 0; px < w; px++) {
            const t0 = vs + (px / w) * span
            const t1 = vs + ((px + 1) / w) * span
            const si = Math.max(0, Math.floor(t0 * sampleRate))
            const se = Math.min(ch.length, Math.ceil(t1 * sampleRate))
            let max = -1
            for (let s = si; s < se; s++) {
              if (ch[s] > max) max = ch[s]
            }
            const y = midY - max * ampH
            if (px === 0) ctx.moveTo(px, y)
            else ctx.lineTo(px, y)
          }
          // Bottom edge (min values, right to left) to close the shape
          for (let px = w - 1; px >= 0; px--) {
            const t0 = vs + (px / w) * span
            const t1 = vs + ((px + 1) / w) * span
            const si = Math.max(0, Math.floor(t0 * sampleRate))
            const se = Math.min(ch.length, Math.ceil(t1 * sampleRate))
            let min = 1
            for (let s = si; s < se; s++) {
              if (ch[s] < min) min = ch[s]
            }
            const y = midY - min * ampH
            ctx.lineTo(px, y)
          }
          ctx.closePath()
          ctx.fillStyle = 'rgba(77,208,225,0.65)'
          ctx.fill()
          // Lighter stroke on the edges for definition
          ctx.strokeStyle = 'rgba(77,208,225,0.35)'
          ctx.lineWidth = 0.5
          ctx.stroke()
        }
      } else {
        // ZOOMED OUT: Use pre-computed peaks (fast bar mode)
        const peakCount = Math.floor(w)
        const peaks = computeVisiblePeaks(peakCount)
        if (peaks) {
          ctx.fillStyle = 'rgba(77,208,225,0.75)'
          for (let px = 0; px < peakCount; px++) {
            const peakH = peaks[px] * ampH
            if (peakH < 0.5) continue
            ctx.fillRect(px, midY - peakH, 1, peakH * 2)
          }
          ctx.fillStyle = 'rgba(77,208,225,0.25)'
          for (let px = 0; px < peakCount; px++) {
            const peakH = peaks[px] * ampH
            if (peakH < 1) continue
            ctx.fillRect(px, midY - peakH, 1, peakH * 0.4)
          }
        }
      }
    }

    if (_loopEnabled) {
      const loopStart = _loopRange ? _bars[_loopRange.start]?.startSec ?? 0 : 0
      const loopEnd = _loopRange ? _bars[_loopRange.end]?.endSec ?? _dur : _dur
      const x1 = Math.max(0, ((loopStart - vs) / span) * w)
      const x2 = Math.min(w, ((loopEnd - vs) / span) * w)
      if (x2 > x1) {
        ctx.fillStyle = 'rgba(77,208,225,0.2)'
        ctx.fillRect(x1, 0, x2 - x1, h)

        ctx.fillStyle = '#4dd0e1'
        ctx.fillRect(Math.round(x1) - 1, 0, 3, h)
        ctx.fillRect(Math.round(x2) - 1, 0, 3, h)
      }
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, Math.round(h / 2) + 0.5); ctx.lineTo(w, Math.round(h / 2) + 0.5); ctx.stroke()

    // Render one position marker. During playback it is driven only by the
    // live audio cursor; while stopped it shows the stored seek position.
    const position = _isPlaying ? _cursor : _playhead
    const px = ((position - vs) / span) * w
    if (px >= -2 && px <= w + 2) {
      ctx.save()
      ctx.shadowColor = _isPlaying ? 'rgba(255,255,255,0.6)' : 'transparent'
      ctx.shadowBlur = _isPlaying ? 3 * dprRef.current : 0
      ctx.strokeStyle = _isPlaying ? '#ffffff' : '#f6c177'
      ctx.lineWidth = _isPlaying ? 1.5 : 2
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke()
      ctx.fillStyle = _isPlaying ? '#ffffff' : '#f6c177'
      const triSize = Math.round(6 * dprRef.current)
      ctx.beginPath()
      ctx.moveTo(px - triSize, 0)
      ctx.lineTo(px + triSize, 0)
      ctx.lineTo(px, triSize * 1.6)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }

    // Hover cursor line (preview where click would place playhead)
    const _hoverX = hoverXRef.current
    if (_hoverX !== null && !_isPlaying) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath(); ctx.moveTo(_hoverX, 0); ctx.lineTo(_hoverX, h); ctx.stroke()
      ctx.setLineDash([])
    }

    // Zoom level indicator
    if (zoomRef.current > 1.05) {
      const label = `${zoomRef.current.toFixed(1)}×`
      const pillFont = Math.round(10 * dprRef.current)
      ctx.font = `bold ${pillFont}px monospace`
      const tw = ctx.measureText(label).width
      const pillX = w - tw - 16
      const pillH = pillFont + 4
      ctx.fillStyle = 'rgba(246,193,119,0.85)'
      ctx.beginPath()
      ctx.roundRect(pillX, h - pillH - 4, tw + 8, pillH, 4)
      ctx.fill()
      ctx.fillStyle = '#041014'
      ctx.fillText(label, pillX + 4, h - 7)
    }
  }, [])

  // Fit canvas with DPR scaling for sharp rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fit = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      const rect = parent.getBoundingClientRect()
      const bw = Math.round(rect.width * dpr)
      const bh = Math.round(rect.height * dpr)
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      draw()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas.parentElement!)
    return () => ro.disconnect()
  }, [draw])

  // Extract and COPY channel data when audioBuffer changes.
  // We copy so that data survives if the browser detaches the buffer during playback.
  useEffect(() => {
    if (!audioBuffer) {
      channelDataRef.current = null
      precomputedPeaksRef.current = null
      draw()
      return
    }
    // Copy channel data so it doesn't get detached
    const raw = audioBuffer.getChannelData(0)
    const copy = new Float32Array(raw.length)
    copy.set(raw)
    channelDataRef.current = copy

    // Pre-downsample to PRECOMPUTED_COUNT peaks
    const N = PRECOMPUTED_COUNT
    const bs = Math.floor(copy.length / N)
    const pp = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      let max = 0
      const off = i * bs
      for (let j = 0; j < bs; j++) {
        const v = Math.abs(copy[off + j] ?? 0)
        if (v > max) max = v
      }
      pp[i] = max
    }
    precomputedPeaksRef.current = pp
    draw()
  }, [audioBuffer, draw])

  // Center view on playhead when playhead changes (user action)
  // Only re-center if playhead is outside the visible range — this prevents
  // nudge buttons from jarring the view when the marker is already on-screen.
  useEffect(() => {
    if (zoom <= 1) return
    const { vs, ve } = getView()
    const margin = (ve - vs) * 0.05 // 5% margin
    if (playhead < vs + margin || playhead > ve - margin) {
      const frame = window.requestAnimationFrame(() => setViewCenter(playhead))
      return () => window.cancelAnimationFrame(frame)
    }
  }, [playhead, zoom])

  // Center view on cursor during playback (only when zoomed in)
  useEffect(() => {
    if (!isPlaying || zoom <= 1) return
    const frame = window.requestAnimationFrame(() => setViewCenter(cursor))
    return () => window.cancelAnimationFrame(frame)
  }, [cursor, isPlaying, zoom])

  // Redraw before the browser paints so stop/seek never shows the prior marker.
  useLayoutEffect(() => {
    draw()
  }, [playhead, cursor, isPlaying, bars, currentBarIndex, loopEnabled, loopRange, totalDuration, zoom, viewCenter, draw])

  /** Convert canvas X to time */
  const xToTime = useCallback((clientX: number): number => {
    const canvas = canvasRef.current
    if (!canvas || !totalDuration) return 0
    const rect = canvas.getBoundingClientRect()
    const ratio = (clientX - rect.left) / rect.width
    const dur = totalDuration
    const z = zoomRef.current
    const center = viewCenterRef.current
    let vs: number, ve: number
    if (z <= 1) { vs = 0; ve = dur }
    else {
      const halfSpan = dur / z / 2
      const c = Math.max(halfSpan, Math.min(dur - halfSpan, center))
      vs = c - halfSpan; ve = c + halfSpan
    }
    return Math.max(0, Math.min(dur, vs + ratio * (ve - vs)))
  }, [totalDuration])

  /** Is clientX near the playhead marker? */
  const isNearPlayhead = useCallback((clientX: number): boolean => {
    const canvas = canvasRef.current
    if (!canvas || !totalDuration) return false
    const rect = canvas.getBoundingClientRect()
    const { vs, ve } = getView()
    const span = Math.max(ve - vs, 0.001)
    const phX = ((playheadRef.current - vs) / span) * rect.width + rect.left
    return Math.abs(clientX - phX) < 8
  }, [totalDuration])

  const nearestBoundary = useCallback((time: number): number => {
    if (!bars.length) return 0
    let closest = 0
    let smallestDistance = Math.abs(time - bars[0].startSec)
    for (let index = 1; index < bars.length; index++) {
      const distance = Math.abs(time - bars[index].startSec)
      if (distance < smallestDistance) {
        closest = index
        smallestDistance = distance
      }
    }
    const finalBoundary = bars.length
    const finalDistance = Math.abs(time - bars[bars.length - 1].endSec)
    return finalDistance < smallestDistance ? finalBoundary : closest
  }, [bars])

  const loopBounds = useCallback(() => {
    if (!bars.length) return undefined
    const start = loopRange?.start ?? 0
    const end = loopRange?.end ?? bars.length - 1
    return { start: Math.max(0, Math.min(start, bars.length - 1)), end: Math.max(0, Math.min(end, bars.length - 1)) }
  }, [bars.length, loopRange])

  const getLoopHandleAt = useCallback((clientX: number): 'start' | 'end' | undefined => {
    const canvas = canvasRef.current
    const bounds = loopBounds()
    if (!canvas || !bounds) return undefined
    const rect = canvas.getBoundingClientRect()
    const { vs, ve } = getView()
    const span = Math.max(ve - vs, 0.001)
    const startX = ((bars[bounds.start].startSec - vs) / span) * rect.width + rect.left
    const endX = ((bars[bounds.end].endSec - vs) / span) * rect.width + rect.left
    if (Math.abs(clientX - startX) <= 10) return 'start'
    if (Math.abs(clientX - endX) <= 10) return 'end'
    return undefined
  }, [bars, loopBounds])

  const setLoopFromBoundaries = useCallback((first: number, second: number) => {
    if (!bars.length) return
    const low = Math.min(first, second)
    const high = Math.max(first, second)
    const start = Math.min(low, bars.length - 1)
    const end = Math.max(start, Math.min(high - 1, bars.length - 1))
    onLoopRangeChange(start, end)
  }, [bars.length, onLoopRangeChange])

  // Scroll wheel zoom — smooth, centered on mouse position
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const mouseTime = xToTime(e.clientX)
    setZoom(prev => {
      // Smooth zoom: ~15% per wheel tick
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      const next = Math.max(1, Math.min(200, prev * factor))
      return next
    })
    // Keep the mouse-pointed time at the same screen position
    if (zoomRef.current > 1) {
      setViewCenter(mouseTime)
    }
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const handle = getLoopHandleAt(e.clientX)
    pointerDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startTime: xToTime(e.clientX),
      mode: handle === 'start' ? 'start-handle' : handle === 'end' ? 'end-handle' : isNearPlayhead(e.clientX) ? 'playhead' : 'select',
      moved: false,
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const drag = pointerDragRef.current
    if (drag?.pointerId === e.pointerId) {
      if (Math.abs(e.clientX - drag.startX) > 4) drag.moved = true
      if (drag.moved) {
        const boundary = nearestBoundary(xToTime(e.clientX))
        if (drag.mode === 'playhead') onSeek(xToTime(e.clientX))
        else if (drag.mode === 'select') setLoopFromBoundaries(nearestBoundary(drag.startTime), boundary)
        else {
          const bounds = loopBounds()
          if (bounds) {
            if (drag.mode === 'start-handle') onLoopRangeChange(Math.min(boundary, bounds.end), bounds.end)
            else onLoopRangeChange(bounds.start, Math.max(bounds.start, boundary - 1))
          }
        }
      }
    }
    // Update hover line position (in buffer px)
    const rect = canvas.getBoundingClientRect()
    hoverXRef.current = ((e.clientX - rect.left) / rect.width) * canvas.width
    draw()

    if (getLoopHandleAt(e.clientX) || isNearPlayhead(e.clientX)) {
      canvas.style.cursor = 'ew-resize'
    } else {
      canvas.style.cursor = 'crosshair'
    }
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    pointerDragRef.current = null
    if (!drag.moved) onSeek(xToTime(e.clientX))
  }

  const handleMouseLeave = () => {
    hoverXRef.current = null
    draw()
  }

  return (
    <div className="hz-waveform-wrap">
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { pointerDragRef.current = null }}
        onMouseLeave={handleMouseLeave}
        title="Click to set play position · drag to set loop range · drag cyan handles to adjust loop bounds"
        style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }}
      />
    </div>
  )
}
