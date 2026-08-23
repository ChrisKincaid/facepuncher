import type { PunchMode } from '../data/models'

interface Props {
  mode: PunchMode
  currentBarIndex: number
  barCount: number
  autoAdvance: boolean
  loopCurrentBar: boolean
  isRecording: boolean
  onModeChange: (mode: PunchMode) => void
  onPrev: () => void
  onNext: () => void
  onToggleAutoAdvance: (enabled: boolean) => void
  onToggleLoop: (enabled: boolean) => void
  onRecord: () => void
}

export function PunchPanel({
  mode,
  currentBarIndex,
  barCount,
  autoAdvance,
  loopCurrentBar,
  isRecording,
  onModeChange,
  onPrev,
  onNext,
  onToggleAutoAdvance,
  onToggleLoop,
  onRecord,
}: Props) {
  return (
    <div className="panel">
      <div className="section-title">
        <h3>Punch Flow</h3>
        <span className="tag">Mode</span>
      </div>
      <div className="controls">
        <button className={mode === 'punch' ? '' : 'secondary'} onClick={() => onModeChange('punch')}>
          Punch-by-bar
        </button>
        <button className={mode === 'full-verse' ? '' : 'secondary'} onClick={() => onModeChange('full-verse')}>
          Full verse
        </button>
        <span className="text-muted">Bar {barCount ? currentBarIndex + 1 : 0} / {barCount || 0}</span>
        <button className="secondary" onClick={onPrev} disabled={currentBarIndex <= 0}>
          Prev (P)
        </button>
        <button className="secondary" onClick={onNext} disabled={currentBarIndex >= barCount - 1}>
          Next (N)
        </button>
        <label className="flex-gap">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => onToggleAutoAdvance(e.target.checked)}
          />
          Auto-advance
        </label>
        <label className="flex-gap">
          <input type="checkbox" checked={loopCurrentBar} onChange={(e) => onToggleLoop(e.target.checked)} />
          Loop current bar
        </label>
        <button onClick={onRecord}>{isRecording ? 'Stop' : 'Record (R)'}</button>
      </div>
    </div>
  )
}
