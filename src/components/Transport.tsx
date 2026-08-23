import { formatTime } from '../utils/time'

interface Props {
  isPlaying: boolean
  currentTime: number
  durationSec: number
  bpm: number
  onBpmChange: (bpm: number) => void
  onPlay: () => void
  onPause: () => void
  onStop: () => void
  countInBars: number
  preRollMs: number
  setCountIn: (bars: number) => void
  setPreRoll: (ms: number) => void
  disabled?: boolean
  showPlaybackControls?: boolean
}

export function Transport({
  isPlaying,
  currentTime,
  durationSec,
  bpm,
  onBpmChange,
  onPlay,
  onPause,
  onStop,
  countInBars,
  preRollMs,
  setCountIn,
  setPreRoll,
  disabled = false,
  showPlaybackControls = true,
}: Props) {
  return (
    <div className="panel">
      <div className="section-title">
        <h3>{showPlaybackControls ? 'Transport' : 'Recording Settings'}</h3>
        <span className="tag">{showPlaybackControls ? 'Grid + Count-in' : 'Timing'}</span>
      </div>
      <div className="controls">
        {showPlaybackControls && (
          <>
            <button onClick={isPlaying ? onPause : onPlay} disabled={disabled}>{isPlaying ? 'Pause' : 'Play'}</button>
            <button className="secondary" onClick={onStop} disabled={disabled}>Stop</button>
            <span className="text-muted">{formatTime(currentTime)} / {formatTime(durationSec || 0)}</span>
          </>
        )}
        <label className="flex-gap">
          BPM
          <input
            type="number"
            min={40}
            max={240}
            value={bpm || ''}
            onChange={(e) => onBpmChange(Number(e.target.value) || 0)}
            style={{ width: 90 }}
          />
        </label>
        <label className="flex-gap">
          Count-in bars
          <input
            type="number"
            min={0}
            max={4}
            value={countInBars}
            onChange={(e) => setCountIn(Number(e.target.value) || 0)}
            style={{ width: 70 }}
          />
        </label>
        <label className="flex-gap">
          Pre-roll (ms)
          <input
            type="number"
            min={0}
            max={2000}
            value={preRollMs}
            onChange={(e) => setPreRoll(Number(e.target.value) || 0)}
            style={{ width: 90 }}
          />
        </label>
      </div>
    </div>
  )
}
