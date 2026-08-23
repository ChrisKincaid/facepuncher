import type { MixSettings } from '../data/models'

interface Props {
  mix: MixSettings
  currentBarIndex: number
  onMasterGain: (value: number) => void
  onGlobalVocalGain: (value: number) => void
  onBarGain: (barIndex: number, value: number) => void
}

export function Mixer({ mix, currentBarIndex, onMasterGain, onGlobalVocalGain, onBarGain }: Props) {
  const barGain = mix.barGains?.[currentBarIndex] ?? 1
  return (
    <div className="panel">
      <div className="section-title">
        <h3>Mixer</h3>
        <span className="tag">Gains</span>
      </div>
      <div className="controls">
        <label className="flex-gap">
          Master Beat
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mix.masterBeatGain}
            onChange={(e) => onMasterGain(Number(e.target.value))}
          />
          <span className="text-muted">{mix.masterBeatGain.toFixed(2)}</span>
        </label>
        <label className="flex-gap">
          Global Vocal
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={mix.globalVocalGain}
            onChange={(e) => onGlobalVocalGain(Number(e.target.value))}
          />
          <span className="text-muted">{mix.globalVocalGain.toFixed(2)}</span>
        </label>
        <label className="flex-gap">
          Bar Gain
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={barGain}
            onChange={(e) => onBarGain(currentBarIndex, Number(e.target.value))}
          />
          <span className="text-muted">Bar {currentBarIndex + 1}</span>
        </label>
      </div>
    </div>
  )
}
