import { useEffect, useRef, useState } from 'react'

interface Props {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  title?: string
  onChange: (value: number) => void
}

// Dragging this many pixels sweeps the full min..max range, regardless of
// how narrow the visible track is. Movement is relative, not tied to the
// track's own width, so there is no tiny-target precision problem. Kept
// large so big hand/mouse movements only produce small value changes.
const DRAG_PX_FOR_FULL_RANGE = 2000

/**
 * Compact slider that expands into a large floating control while the user
 * is actively dragging it (mouse held down or finger touching). The system
 * cursor is hidden for the duration of the drag via CSS, and value changes
 * follow relative pointer movement instead of absolute position — so the
 * user can drag comfortably without needing pixel-perfect aim.
 */
export function DragVolumeSlider({ label, value, min = 0, max = 2, step = 0.01, disabled, title, onChange }: Props) {
  const [dragging, setDragging] = useState(false)
  const [overlayPos, setOverlayPos] = useState({ x: 0, y: 0 })
  const startXRef = useRef(0)
  const startValueRef = useRef(value)

  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('drag-slider-active')
    return () => document.body.classList.remove('drag-slider-active')
  }, [dragging])

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    startXRef.current = e.clientX
    startValueRef.current = value
    // Anchor the popup once at the drag start point. It must stay put —
    // if it followed the (now-hidden) cursor every frame it would feel
    // like the box itself is "the cursor" flying around the screen.
    setOverlayPos({ x: e.clientX, y: e.clientY })
    setDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const deltaX = e.clientX - startXRef.current
    const deltaValue = (deltaX / DRAG_PX_FOR_FULL_RANGE) * (max - min)
    onChange(clamp(startValueRef.current + deltaValue))
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  const pct = ((value - min) / (max - min)) * 100
  const overlayLeft = Math.min(Math.max(overlayPos.x, 90), window.innerWidth - 90)
  const overlayTop = Math.max(overlayPos.y - 86, 8)

  return (
    <>
      <div className="drag-slider-group">
        <button
          type="button"
          className="drag-slider-nudge"
          disabled={disabled}
          title={`Decrease ${label}`}
          aria-label={`Decrease ${label}`}
          onClick={(e) => { e.stopPropagation(); onChange(clamp(value - step)) }}
        >
          −
        </button>
        <div
          className={`drag-slider-track ${disabled ? 'drag-slider-disabled' : ''} ${dragging ? 'drag-slider-dragging' : ''}`}
          role="slider"
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-disabled={disabled}
          title={title}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(e) => {
            if (disabled) return
            if (e.key === 'ArrowRight') onChange(clamp(value + step))
            if (e.key === 'ArrowLeft') onChange(clamp(value - step))
          }}
        >
          <div className="drag-slider-fill" style={{ width: `${pct}%` }} />
        </div>
        <button
          type="button"
          className="drag-slider-nudge"
          disabled={disabled}
          title={`Increase ${label}`}
          aria-label={`Increase ${label}`}
          onClick={(e) => { e.stopPropagation(); onChange(clamp(value + step)) }}
        >
          +
        </button>
      </div>

      {dragging && (
        <div className="drag-slider-overlay" style={{ left: overlayLeft, top: overlayTop }}>
          <div className="drag-slider-overlay-label">{label}</div>
          <div className="drag-slider-overlay-track">
            <div className="drag-slider-overlay-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="drag-slider-overlay-value">{value.toFixed(2)}</div>
        </div>
      )}
    </>
  )
}
