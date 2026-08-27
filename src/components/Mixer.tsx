import { useRef, useState } from 'react'
import type { MixSettings } from '../data/models'

interface Props {
  mix: MixSettings
  collapsed: boolean
  onToggleCollapsed: () => void
  onMasterGain: (value: number) => void
  onGlobalVocalGain: (value: number) => void
  isVocalMuted: boolean
  onToggleVocalMute: () => void
  monitorEnabled: boolean
  monitorGain: number
  onToggleMonitor: () => void
  onMonitorGain: (value: number) => void
  takesCount: number
  onDeleteAllTakes: () => void
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

// Shared mute toggle used for Beat Vol, Vocal Vol, and Mic Monitor so all three channels have
// one consistent control instead of a bespoke on/off switch just for the monitor.
function MuteButton({ muted, onToggle, label }: { muted: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`mixer-mute-button ${muted ? 'mixer-mute-active' : ''}`}
      onClick={onToggle}
      aria-pressed={muted}
      title={muted ? `Unmute ${label}` : `Mute ${label}`}
    >
      {muted ? 'Unmute' : 'Mute'}
    </button>
  )
}

export function Mixer({
  mix,
  collapsed,
  onToggleCollapsed,
  onMasterGain,
  onGlobalVocalGain,
  isVocalMuted,
  onToggleVocalMute,
  monitorEnabled,
  monitorGain,
  onToggleMonitor,
  onMonitorGain,
  takesCount,
  onDeleteAllTakes,
}: Props) {
  // Beat muting is a transient UI convenience — remember the pre-mute value locally and
  // restore it on unmute rather than adding persisted mute state to the project.
  const [beatMuted, setBeatMuted] = useState(false)
  const beatPreMute = useRef(mix.masterBeatGain)

  const toggleBeatMute = () => {
    if (beatMuted) {
      onMasterGain(beatPreMute.current)
      setBeatMuted(false)
    } else {
      beatPreMute.current = mix.masterBeatGain
      onMasterGain(0)
      setBeatMuted(true)
    }
  }

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
          <div className="mixer-strip-column">
            <ChannelStrip label="Beat Vol" value={mix.masterBeatGain} max={1} onChange={onMasterGain} />
            <MuteButton muted={beatMuted} onToggle={toggleBeatMute} label="Beat" />
          </div>
          <div className="mixer-strip-column">
            <ChannelStrip label="Vocal Vol" value={mix.globalVocalGain} max={2} onChange={onGlobalVocalGain} accent />
            <MuteButton muted={isVocalMuted} onToggle={onToggleVocalMute} label="Vocal" />
          </div>
          <div className="mixer-strip-column">
            <ChannelStrip label="Mic Vol" value={monitorGain} max={2} onChange={onMonitorGain} />
            <MuteButton muted={!monitorEnabled} onToggle={onToggleMonitor} label="Mic Monitor" />
          </div>
          <button
            type="button"
            className="mixer-delete-all"
            disabled={!takesCount}
            onClick={onDeleteAllTakes}
            title="Delete all takes across every bar"
          >
            Delete All Takes
          </button>
        </div>
      )}
    </div>
  )
}

