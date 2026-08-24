import { useRef } from 'react'
import type { MixSettings } from '../data/models'

interface Props {
  mix: MixSettings
  collapsed: boolean
  onToggleCollapsed: () => void
  onMasterGain: (value: number) => void
  onGlobalVocalGain: (value: number) => void
  monitorEnabled: boolean
  monitorGain: number
  onToggleMonitor: () => void
  onMonitorGain: (value: number) => void
}

// Fine step used by the nudge arrows for small precise adjustments.
const NUDGE_STEP = 0.01

function ChannelStrip({
  label,
  value,
  max,
  onChange,
  accent,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
  accent?: boolean
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = Math.round((value / max) * 100)
  const nudge = (delta: number) => onChange(Math.max(0, Math.min(max, Math.round((value + delta) * 100) / 100)))

  // Faders are driven directly from pointer position within the track —
  // this avoids the unreliable hit-testing of a CSS-rotated native
  // <input type="range">, which does not track drag position correctly.
  const setFromClientY = (clientY: number) => {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    const ratio = 1 - (clientY - rect.top) / rect.height
    const clamped = Math.max(0, Math.min(1, ratio))
    onChange(Math.round(clamped * max * 100) / 100)
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setFromClientY(e.clientY)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return
    setFromClientY(e.clientY)
  }

  return (
    <div className="mixer-strip">
      <div className="mixer-strip-value">{value.toFixed(2)}</div>
      <button
        type="button"
        className="mixer-fader-nudge"
        title={`Increase ${label}`}
        aria-label={`Increase ${label}`}
        onClick={() => nudge(NUDGE_STEP)}
      >
        ▲
      </button>
      <div
        ref={trackRef}
        className="mixer-fader-track"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') nudge(NUDGE_STEP)
          if (e.key === 'ArrowDown') nudge(-NUDGE_STEP)
        }}
      >
        <div className={`mixer-fader-fill ${accent ? 'mixer-fader-fill-accent' : ''}`} style={{ height: `${pct}%` }} />
      </div>
      <button
        type="button"
        className="mixer-fader-nudge"
        title={`Decrease ${label}`}
        aria-label={`Decrease ${label}`}
        onClick={() => nudge(-NUDGE_STEP)}
      >
        ▼
      </button>
      <div className="mixer-strip-label">{label}</div>
    </div>
  )
}

export function Mixer({ mix, collapsed, onToggleCollapsed, onMasterGain, onGlobalVocalGain, monitorEnabled, monitorGain, onToggleMonitor, onMonitorGain }: Props) {
  return (
    <div className={`mixer-rack ${collapsed ? 'section-collapsed' : ''}`}>
      <div className="collapsible-header">
        <span className="collapsible-title">MIXER</span>
        <button
          className="secondary collapsible-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Show mixer' : 'Hide mixer'}
        >
          {collapsed ? '▸ Show' : '▾ Hide'}
        </button>
      </div>
      {!collapsed && (
        <div className="mixer-strips">
          <ChannelStrip label="Beat Vol" value={mix.masterBeatGain} max={1} onChange={onMasterGain} />
          <ChannelStrip label="Vocal Vol" value={mix.globalVocalGain} max={2} onChange={onGlobalVocalGain} accent />
          <ChannelStrip label="Mic Vol" value={monitorGain} max={2} onChange={onMonitorGain} />
          <div className="mixer-strip mixer-monitor-strip">
            <button
              type="button"
              className={`mixer-monitor-switch ${monitorEnabled ? 'mixer-monitor-on' : ''}`}
              onClick={onToggleMonitor}
              aria-pressed={monitorEnabled}
              title={monitorEnabled ? 'Mic monitoring on — click to turn off' : 'Mic monitoring off — click to turn on'}
            >
              <span className="mixer-monitor-knob" />
            </button>
            <div className="mixer-strip-label">Mic Monitor</div>
          </div>
        </div>
      )}
    </div>
  )
}

