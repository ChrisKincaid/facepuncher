import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Pre-decoded buffer from audioEngine — avoids re-fetching the whole file */
  audioBuffer: AudioBuffer
  barStartSec: number
  barEndSec: number
  prevBarEnd: number
  nextBarStart: number
  playhead: number
  onEdgeChange: (start: number, end: number) => void
}

const HIT = 16   // px hit-test tolerance for drag handles
const PAD = 0.35 // seconds of context shown beyond bar edges
type NudgeMode = number | 'zero-crossing'

export function BarWaveformEditor(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef  = useRef<Float32Array | null>(null)
  const dragging  = useRef<'start' | 'end' | null>(null)
  const drawRef = useRef<() => void>(() => {})

  // All mutable state lives in refs so draw() and window listeners always see fresh values
  const stateRef = useRef({
    view:    { start: 0, end: 1 },
    handles: { start: props.barStartSec, end: props.barEndSec },
  })

  // Keep a "latest props" ref — window-level handlers can't use React closure props
  const propsRef = useRef(props)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [nudgeMode, setNudgeMode]   = useState<NudgeMode>('zero-crossing')
  const [zoomLevel, setZoomLevel]   = useState(1)
  const [viewCenter, setViewCenter] = useState<number | null>(null)
  const [zoomTarget, setZoomTarget] = useState<'start' | 'end'>('start')
  const zoomTargetRef = useRef<'start' | 'end'>('start')
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null)

  useEffect(() => {
    propsRef.current = props
    zoomTargetRef.current = zoomTarget
  }, [props, zoomTarget])

  // ── view window (affected by zoom) ─────────────────────────────────────
  function computeViewWindow(zoom: number): { start: number; end: number } {
    const { barStartSec, barEndSec } = propsRef.current
    const center   = viewCenter ?? (barStartSec + barEndSec) / 2
    const baseHalf = (barEndSec - barStartSec) / 2 + PAD
    const half     = baseHalf / zoom
    return { start: Math.max(0, center - half), end: center + half }
  }

  function findZeroCrossing(timeSec: number, direction: -1 | 1): number {
    const buf = propsRef.current.audioBuffer
    const channel = buf.getChannelData(0)
    const start = Math.max(0, Math.min(channel.length - 1, Math.round(timeSec * buf.sampleRate)))
    const step = direction > 0 ? 1 : -1
    for (let frame = start; frame >= 0 && frame < channel.length - 1; frame += step) {
      const next = frame + (direction > 0 ? 1 : -1)
      if ((channel[frame] >= 0) !== (channel[next] >= 0)) return frame / buf.sampleRate
    }
    return timeSec
  }

  // ── nudge a handle by ±deltaMs ───────────────────────────────────────────
  function nudgeHandle(handle: 'start' | 'end', direction: -1 | 1) {
    const { prevBarEnd } = propsRef.current
    const current = stateRef.current.handles[handle]
    let t: number
    if (nudgeMode === 'zero-crossing') {
      t = findZeroCrossing(current + direction / propsRef.current.audioBuffer.sampleRate, direction)
    } else {
      t = current + direction * nudgeMode / 1000
    }
    if (handle === 'start') {
      t = Math.max(prevBarEnd, Math.min(t, stateRef.current.handles.end - 0.02))
    } else {
      t = Math.max(stateRef.current.handles.start + 0.02, Math.min(t, stateRef.current.view.end))
    }
    stateRef.current.handles[handle] = t
    drawRef.current()
    propsRef.current.onEdgeChange(stateRef.current.handles.start, stateRef.current.handles.end)
  }

  // Sync view + handles from props whenever NOT dragging (runs every render)
  useEffect(() => {
    if (dragging.current) return
    stateRef.current.handles = { start: props.barStartSec, end: props.barEndSec }
    stateRef.current.view    = computeViewWindow(zoomLevel)
    drawRef.current()
  })

  // ── coordinate helpers ───────────────────────────────────────────────────
  function timeToX(t: number, w: number): number {
    const { start, end } = stateRef.current.view
    return ((t - start) / (end - start)) * w
  }
  function xToTime(x: number, w: number): number {
    const { start, end } = stateRef.current.view
    return start + (x / w) * (end - start)
  }
  function clientToCanvasX(clientX: number): number {
    const canvas = canvasRef.current
    if (!canvas) return 0
    const rect = canvas.getBoundingClientRect()
    return (clientX - rect.left) * (canvas.width / rect.width)
  }
  function getHit(x: number, w: number): 'start' | 'end' | null {
    const { start, end } = stateRef.current.handles
    const ds = Math.abs(x - timeToX(start, w))
    const de = Math.abs(x - timeToX(end, w))
    if (ds <= HIT && ds <= de) return 'start'
    if (de <= HIT) return 'end'
    return null
  }

  // ── draw ─────────────────────────────────────────────────────────────────
  function drawNow() {
    const canvas = canvasRef.current
    if (!canvas) return
    const w   = canvas.width
    const h   = canvas.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { start: vs, end: ve } = stateRef.current.view
    const { start: hs, end: he } = stateRef.current.handles
    const ph = propsRef.current.playhead

    ctx.fillStyle = '#0b0c14'
    ctx.fillRect(0, 0, w, h)

    const peaks = peaksRef.current
    if (peaks) {
      const n    = peaks.length
      const segW = w / n
      for (let i = 0; i < n; i++) {
        const t     = vs + (i / n) * (ve - vs)
        const x     = (i / n) * w
        const peakH = peaks[i] * h * 0.82
        const y     = (h - peakH) / 2
        ctx.fillStyle = (t >= hs && t <= he)
          ? `rgba(77,208,225,${0.35 + peaks[i] * 0.65})`
          : 'rgba(77,208,225,0.1)'
        ctx.fillRect(x, y, Math.max(1, segW * 0.78), Math.max(1, peakH))
      }
    }

    const shx = timeToX(hs, w)
    const ehx = timeToX(he, w)

    ctx.fillStyle = 'rgba(77,208,225,0.06)'
    ctx.fillRect(shx, 0, ehx - shx, h)

    // Start handle (cyan)
    ctx.save()
    ctx.strokeStyle = '#4dd0e1'
    ctx.lineWidth = 2
    ctx.shadowColor = '#4dd0e1'
    ctx.shadowBlur = 8
    ctx.beginPath(); ctx.moveTo(shx, 0); ctx.lineTo(shx, h); ctx.stroke()
    ctx.fillStyle = '#4dd0e1'
    ctx.beginPath(); ctx.moveTo(shx, 0); ctx.lineTo(shx + 11, 0); ctx.lineTo(shx, 14); ctx.closePath(); ctx.fill()
    ctx.restore()

    // End handle (amber)
    ctx.save()
    ctx.strokeStyle = '#f6c177'
    ctx.lineWidth = 2
    ctx.shadowColor = '#f6c177'
    ctx.shadowBlur = 8
    ctx.beginPath(); ctx.moveTo(ehx, 0); ctx.lineTo(ehx, h); ctx.stroke()
    ctx.fillStyle = '#f6c177'
    ctx.beginPath(); ctx.moveTo(ehx, 0); ctx.lineTo(ehx - 11, 0); ctx.lineTo(ehx, 14); ctx.closePath(); ctx.fill()
    ctx.restore()

    // Playhead
    const phx = timeToX(ph, w)
    if (phx >= 0 && phx <= w) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 3])
      ctx.shadowColor = 'rgba(255,255,255,0.4)'
      ctx.shadowBlur = 4
      ctx.beginPath(); ctx.moveTo(phx, 0); ctx.lineTo(phx, h); ctx.stroke()
      ctx.restore()
    }

    // Time labels
    ctx.font = '10px "Courier New", monospace'
    const sLabel = fmtMs(hs)
    const eLabel = fmtMs(he)
    ctx.fillStyle = '#4dd0e1'
    ctx.fillText(sLabel, Math.max(2, shx + 3), h - 4)
    ctx.fillStyle = '#f6c177'
    const ew = ctx.measureText(eLabel).width
    ctx.fillText(eLabel, Math.min(w - ew - 2, ehx - ew - 3), h - 4)
  }

  useEffect(() => {
    drawRef.current = drawNow
  })

  // ── canvas sizing ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const fit = () => {
      const p = canvas.parentElement
      if (!p) return
      canvas.width  = p.clientWidth || 400
      canvas.height = 96
      drawNow()
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (canvas.parentElement) ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── peaks from pre-decoded buffer — synchronous, no fetch, no AudioContext ─
  useEffect(() => {
    const { audioBuffer } = props
    if (!audioBuffer) return
    const { start: vs, end: ve } = stateRef.current.view
    const sr    = audioBuffer.sampleRate
    const ch    = audioBuffer.getChannelData(0)
    const sS    = Math.max(0, Math.floor(vs * sr))
    const sE    = Math.min(ch.length, Math.ceil(ve * sr))
    const N     = 400
    const slice = ch.slice(sS, sE)
    const bs    = Math.max(1, Math.floor(slice.length / N))
    const p     = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      let max = 0
      const off = i * bs
      for (let j = 0; j < bs; j++) {
        const v = Math.abs(slice[off + j] ?? 0)
        if (v > max) max = v
      }
      p[i] = max
    }
    peaksRef.current = p
    drawNow()
  }, [props.audioBuffer, props.barStartSec, props.barEndSec, zoomLevel]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── window-level drag listeners ───────────────────────────────────────────
  // Attached ONCE. mousemove/mouseup on window means drag works even if cursor
  // leaves the canvas — this is the key fix for the "drag freezes" bug.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const canvas = canvasRef.current
      if (!canvas) return
      const x = clientToCanvasX(e.clientX)
      const t = xToTime(x, canvas.width)
      const { prevBarEnd } = propsRef.current
      if (dragging.current === 'start') {
        stateRef.current.handles.start = Math.max(
          prevBarEnd,
          Math.min(t, stateRef.current.handles.end - 0.02),
        )
      } else {
        // End handle: clamp only to view window, not nextBarStart.
        // updateBarPosition handles neighbor continuity on commit.
        const viewEnd = stateRef.current.view.end
        stateRef.current.handles.end = Math.min(
          viewEnd,
          Math.max(t, stateRef.current.handles.start + 0.02),
        )
      }
      drawNow()
    }

    const onUp = () => {
      if (!dragging.current) return
      propsRef.current.onEdgeChange(
        stateRef.current.handles.start,
        stateRef.current.handles.end,
      )
      dragging.current = null
      if (canvasRef.current) canvasRef.current.style.cursor = 'default'
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── canvas handlers ───────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const canvas = canvasRef.current!
    const x   = clientToCanvasX(e.clientX)
    const hit = getHit(x, canvas.width)
    if (hit) {
      setZoomTarget(hit)
      zoomTargetRef.current = hit
      dragging.current = hit
      canvas.style.cursor = 'ew-resize'
    }
  }

  const onMouseMoveCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragging.current) return
    const canvas = canvasRef.current!
    const x = clientToCanvasX(e.clientX)
    canvas.style.cursor = getHit(x, canvas.width) ? 'ew-resize' : 'default'
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const x = clientToCanvasX(e.clientX)
    const hit = getHit(x, canvas.width)
    if (hit) {
      setZoomTarget(hit)
      zoomTargetRef.current = hit
      return
    }
    e.preventDefault()
    canvas.setPointerCapture(e.pointerId)
    zoomDragRef.current = { startY: e.clientY, startZoom: zoomLevel }
    canvas.style.cursor = 'ns-resize'
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const drag = zoomDragRef.current
    if (!drag) return
    const target = zoomTargetRef.current === 'start' ? propsRef.current.barStartSec : propsRef.current.barEndSec
    const distance = drag.startY - e.clientY
    const nextZoom = Math.max(0.25, Math.min(16, drag.startZoom * Math.pow(1.01, distance)))
    setZoomLevel(nextZoom)
    setViewCenter(target)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    zoomDragRef.current = null
    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    if (canvas) canvas.style.cursor = 'default'
  }

  return (
    <div className="bar-waveform-editor">
      <div className="bar-waveform-legend">
        <span style={{ color: '#4dd0e1' }}>▶ Start</span>
        <span className="text-muted" style={{ fontSize: 11 }}>drag handles · cyan = start · amber = end</span>
        <span style={{ color: '#f6c177' }}>End ◀</span>
      </div>

      <div className="bwe-controls">
        {/* ── nudge row ── */}
        <div className="bwe-ctrl-row">
          <span className="bwe-ctrl-label" style={{ color: '#4dd0e1' }}>Start</span>
          <button className="secondary bwe-nudge" title="Move start earlier" onClick={(e) => { e.stopPropagation(); nudgeHandle('start', -1) }}>◄</button>
          <button className="secondary bwe-nudge" title="Move start later" onClick={(e) => { e.stopPropagation(); nudgeHandle('start', 1) }}>►</button>
          <span className="bwe-ctrl-sep" />
          <span className="bwe-ctrl-label" style={{ color: '#f6c177' }}>End</span>
          <button className="secondary bwe-nudge" title="Move end earlier" onClick={(e) => { e.stopPropagation(); nudgeHandle('end', -1) }}>◄</button>
          <button className="secondary bwe-nudge" title="Move end later" onClick={(e) => { e.stopPropagation(); nudgeHandle('end', 1) }}>►</button>
          <span className="bwe-ctrl-sep" />
          <label className="bwe-ctrl-label flex-gap" onClick={(e) => e.stopPropagation()}>
            Nudge by
            <select
              value={nudgeMode}
              onChange={(e) => {
                e.stopPropagation()
                const value = e.target.value
                setNudgeMode(value === 'zero-crossing' ? value : Number(value))
              }}
              style={{ fontSize: 11, padding: '2px 5px' }}
            >
              <option value="5">5 ms</option>
              <option value="10">10 ms</option>
              <option value="25">25 ms</option>
              <option value="50">50 ms</option>
              <option value="100">100 ms</option>
              <option value="zero-crossing">Zero crossing</option>
            </select>
          </label>
        </div>

        {/* ── zoom row ── */}
        <div className="bwe-ctrl-row">
          <span className="bwe-ctrl-label">Zoom</span>
          <label className="bwe-ctrl-label flex-gap" onClick={(e) => e.stopPropagation()}>
            Center
            <select
              value={zoomTarget}
              onChange={(e) => {
                e.stopPropagation()
                const nextTarget = e.target.value as 'start' | 'end'
                setZoomTarget(nextTarget)
                zoomTargetRef.current = nextTarget
                setViewCenter(nextTarget === 'start' ? props.barStartSec : props.barEndSec)
              }}
              style={{ fontSize: 11, padding: '2px 5px' }}
            >
              <option value="start">Start</option>
              <option value="end">End</option>
            </select>
          </label>
          <button className="secondary bwe-nudge" title="Zoom out" onClick={(e) => { e.stopPropagation(); setZoomLevel((z) => Math.max(0.25, z / 2)); setViewCenter(zoomTargetRef.current === 'start' ? props.barStartSec : props.barEndSec) }}>−</button>
          <span className="bwe-ctrl-label" style={{ minWidth: 38, textAlign: 'center' }}>
            {zoomLevel < 1 ? `1/${Math.round(1 / zoomLevel)}×` : `${zoomLevel}×`}
          </span>
          <button className="secondary bwe-nudge" title="Zoom in" onClick={(e) => { e.stopPropagation(); setZoomLevel((z) => Math.min(16, z * 2)); setViewCenter(zoomTargetRef.current === 'start' ? props.barStartSec : props.barEndSec) }}>+</button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: 96, touchAction: 'none' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMoveCanvas}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}

function fmtMs(s: number): string {
  const ms  = Math.round(s * 1000)
  const min = Math.floor(ms / 60000)
  const sec = Math.floor((ms % 60000) / 1000)
  const ms3 = ms % 1000
  return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(ms3).padStart(3,'0')}`
}
