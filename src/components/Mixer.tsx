import { useRef, useState } from 'react'
import type { MixSettings } from '../data/models'

interface Props {
  mix: MixSettings
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
  return (
    <div className="mixer-strip">
      <span className="mixer-strip-label">{label}</span>
      <input
        className={`mixer-fader-track ${accent ? 'mixer-fader-track-accent' : ''}`}
        type="range"
        aria-label={label}
        min={0}
        max={max}
        step={0.01}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="mixer-strip-value">{value.toFixed(2)}</span>
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
    <div className="mixer-rack">
      <div className="mixer-header">
        <span className="collapsible-title">MIXER</span>
      </div>
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
    </div>
  )
}

