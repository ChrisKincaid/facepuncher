import type { Bar, Take } from '../data/models'
import { BarWaveformBackdrop } from './BarWaveformBackdrop'
import { TakeSlots } from './TakeSlots'
import { DragVolumeSlider } from './DragVolumeSlider'

interface Props {
  bars: Bar[]
  audioBuffer?: AudioBuffer
  playhead: number
  loopRange?: { start: number; end: number }
  currentBarIndex: number
  isRecording: boolean
  takes: Take[]
  armedTakeByBar: Record<number, number[]>
  activeBarPlayback?: { barIndex: number; mode: 'play' | 'loop' }
  auditioningTakeId?: string
  onPlayFromBar: (barIndex: number) => void
  onLoopBar: (barIndex: number) => void
  onStopBar: () => void
  onArmTake: (barIndex: number, slot: number) => void
  onDisarmTake: (barIndex: number, slot?: number) => void
  onSelectTake: (barIndex: number, takeId: string) => void
  onAuditionTake: (takeId: string) => void
  onSelectNoTake: (barIndex: number) => void
  onDeleteTake: (takeId: string) => void
  onToggleTakeLock: (takeId: string) => void
  onFocusBar: (barIndex: number) => void
  onTakeGain: (takeId: string, value: number) => void
}

export function BarList({
  bars,
  audioBuffer,
  playhead,
  loopRange,
  currentBarIndex,
  isRecording,
  takes,
  armedTakeByBar,
  activeBarPlayback,
  auditioningTakeId,
  onPlayFromBar,
  onLoopBar,
  onStopBar,
  onArmTake,
  onDisarmTake,
  onSelectTake,
  onAuditionTake,
  onSelectNoTake,
  onDeleteTake,
  onToggleTakeLock,  onFocusBar,
  onTakeGain,
}: Props) {
  return (
    <div className="panel">
      <div className="collapsible-header" style={{ marginBottom: 6 }}>
        <span className="collapsible-title">Bars</span>
      </div>

      <div className="bar-list">
        {bars.map((bar) => {
          const active = playhead >= bar.startSec && playhead < bar.endSec
          const inLoop = loopRange && bar.index >= loopRange.start && bar.index <= loopRange.end
          const barTakes = takes.filter((t) => t.barIndex === bar.index)
          const activePlayback = activeBarPlayback?.barIndex === bar.index ? activeBarPlayback.mode : null
          const selectedTake = barTakes.find((t) => t.selected)
          return (
            <div
              key={bar.index}
              id={`bar-row-${bar.index}`}
              className={`bar-row ${active ? 'bar-active' : ''} ${inLoop ? 'bar-loop' : ''}`}
              onClick={() => onFocusBar(bar.index)}
            >
              <div className="bar-main-row">
              <div className="bar-meta">
                <div className="bar-num">Bar {bar.index + 1}</div>
                <div
                  className={`bar-status-strip ${active ? 'bar-status-playing' : ''} ${isRecording && active && bar.index === currentBarIndex ? 'bar-status-recording' : ''}`}
                  aria-label={isRecording && active && bar.index === currentBarIndex ? 'Recording' : active ? 'Playing' : 'Bar inactive'}
                />
              </div>
              <div className="bar-wave-thumb">
                <TakeSlots
                  takes={barTakes}
                  armedSlots={armedTakeByBar[bar.index] ?? []}
                  noTakeActive={!armedTakeByBar[bar.index]?.length && !selectedTake}
                  auditioningTakeId={auditioningTakeId}
                  onArm={(slot) => onArmTake(bar.index, slot)}
                  onDisarm={(slot) => onDisarmTake(bar.index, slot)}
                  onSelect={(takeId) => onSelectTake(bar.index, takeId)}
                  onAudition={onAuditionTake}
                  onSelectNone={() => onSelectNoTake(bar.index)}
                  onDelete={onDeleteTake}
                  onToggleLock={onToggleTakeLock}
                />
              </div>
              <div className="bar-gains" onClick={(e) => e.stopPropagation()}>
                <div className="bar-gain-row">
                  <div className="bar-slider-waveform">
                    <BarWaveformBackdrop audioBuffer={audioBuffer} startSec={bar.startSec} endSec={bar.endSec} playhead={playhead} />
                    <DragVolumeSlider
                      label="Take Vol"
                      value={selectedTake?.gain ?? 1}
                      disabled={!selectedTake}
                      onChange={(v) => selectedTake && onTakeGain(selectedTake.takeId, v)}
                      title={selectedTake ? `Take Vol \u2014 Take ${barTakes.indexOf(selectedTake) + 1}` : 'Take Vol \u2014 select a take to adjust its volume'}
                    />
                  </div>
                  <span className="text-muted bar-gain-value">{(selectedTake?.gain ?? 1).toFixed(2)}</span>
                </div>
              </div>
              <div className="bar-row-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="secondary"
                  onClick={() => {
                    if (activePlayback === 'play') onStopBar()
                    else onPlayFromBar(bar.index)
                  }}
                >
                  {activePlayback === 'play' ? 'Stop' : 'Play From'}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    if (activePlayback === 'loop') onStopBar()
                    else onLoopBar(bar.index)
                  }}
                >
                  {activePlayback === 'loop' ? 'Stop' : 'Loop'}
                </button>
                <button
                  type="button"
                  className="secondary bar-delete-button"
                  disabled={!selectedTake || Boolean(selectedTake.locked)}
                  title={selectedTake?.locked ? 'Unlock this take before deleting it' : 'Delete active take'}
                  onClick={() => selectedTake && onDeleteTake(selectedTake.takeId)}
                >
                  X
                </button>
              </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
