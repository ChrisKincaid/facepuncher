import { useState } from 'react'
import type { Bar, Take } from '../data/models'
import { BarWaveformBackdrop } from './BarWaveformBackdrop'
import { TakeSlots } from './TakeSlots'
import { DragVolumeSlider } from './DragVolumeSlider'

type BarScale = 1 | 2 | 4

interface Props {
  bars: Bar[]
  audioBuffer?: AudioBuffer
  playhead: number
  loopRange?: { start: number; end: number }
  currentBarIndex: number
  isRecording: boolean
  takes: Take[]
  armedTakeByBar: Record<number, number[]>
  auditioningTakeId?: string
  onArmTake: (barIndex: number, slot: number) => void
  onDisarmTake: (barIndex: number, slot?: number) => void
  onSelectTake: (barIndex: number, takeId: string) => void
  onAuditionTake: (takeId: string) => void
  onSelectNoTake: (barIndex: number) => void
  onDeleteTake: (takeId: string) => void
  onToggleTakeLock: (takeId: string) => void
  onSetLoopIn: (barIndex: number) => void
  onSetLoopOut: (barIndex: number) => void
  onDeleteAllTakes: () => void
  focusMode: boolean
  onToggleFocus: () => void
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
  auditioningTakeId,
  onArmTake,
  onDisarmTake,
  onSelectTake,
  onAuditionTake,
  onSelectNoTake,
  onDeleteTake,
  onToggleTakeLock,
  onSetLoopIn,
  onSetLoopOut,
  onDeleteAllTakes,
  focusMode,
  onToggleFocus,
  onFocusBar,
  onTakeGain,
}: Props) {
  const [barScale, setBarScale] = useState<BarScale>(2)
  return (
    <div className="panel bar-list-panel">
      <div className="collapsible-header" style={{ marginBottom: 6 }}>
        <div className="bar-scale-controls" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`secondary bar-focus-button ${focusMode ? 'bar-focus-on' : ''}`}
            aria-pressed={focusMode}
            title={focusMode ? 'Reopen the sections above' : 'Collapse the sections above to focus on bars'}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onToggleFocus()
            }}
          >
            {focusMode ? 'Show All' : 'BARS ONLY'}
          </button>
          <button
            type="button"
            className="secondary bar-delete-all"
            disabled={!takes.length}
            title="Delete all takes across every bar"
            onClick={onDeleteAllTakes}
          >
            Delete All Takes
          </button>
          <span className="bar-header-divider" aria-hidden="true" />
          <span className="bar-scale-label">Bar Height</span>
          <button
            type="button"
            className={`secondary bar-scale-button ${barScale === 1 ? 'bar-scale-disabled' : ''}`}
            aria-label="Shorter bar rows"
            title="Shorter bar rows"
            onClick={() => setBarScale((scale) => (scale === 4 ? 2 : 1))}
          >
            −
          </button>
          <button
            type="button"
            className={`secondary bar-scale-button ${barScale === 4 ? 'bar-scale-disabled' : ''}`}
            aria-label="Taller bar rows"
            title="Taller bar rows"
            onClick={() => setBarScale((scale) => (scale === 1 ? 2 : 4))}
          >
            +
          </button>
        </div>
        <span className="collapsible-title">Bars</span>
      </div>

      <div className={`bar-list bar-scale-${barScale}x`}>
        {bars.map((bar) => {
          const active = playhead >= bar.startSec && playhead < bar.endSec
          const inLoop = loopRange && bar.index >= loopRange.start && bar.index <= loopRange.end
          const barTakes = takes.filter((t) => t.barIndex === bar.index)
          const selectedTake = barTakes.find((t) => t.selected)
          const isLoopIn = loopRange?.start === bar.index
          const isLoopOut = loopRange?.end === bar.index
          return (
            <div
              key={bar.index}
              id={`bar-row-${bar.index}`}
              className={`bar-row ${active ? 'bar-active' : ''} ${inLoop ? 'bar-loop' : ''}`}
              onClick={() => onFocusBar(bar.index)}
            >
              <div className="bar-main-row">
              <div className="bar-controls-left">
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
                />
              </div>
              <div className="bar-take-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`secondary bar-fav-button ${selectedTake?.locked ? 'bar-fav-on' : ''}`}
                  disabled={!selectedTake}
                  aria-pressed={selectedTake?.locked ?? false}
                  title={!selectedTake
                    ? 'Select a take to favorite it'
                    : selectedTake.locked
                      ? 'Unfavorite \u2014 allows this take to be deleted'
                      : 'Favorite \u2014 protects this take from deletion'}
                  onClick={() => selectedTake && onToggleTakeLock(selectedTake.takeId)}
                >
                  {selectedTake?.locked ? '\u2605' : '\u2606'}
                </button>
                <button
                  type="button"
                  className="secondary bar-delete-button"
                  disabled={!selectedTake}
                  title={selectedTake?.locked ? 'Favorited take \u2014 unfavorite it to delete' : 'Delete active take'}
                  onClick={() => selectedTake && onDeleteTake(selectedTake.takeId)}
                >
                  X
                </button>
              </div>
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
              <div className="bar-loop-segment" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={`secondary bar-loop-in ${isLoopIn ? 'active-loop-in' : ''}`}
                  aria-pressed={isLoopIn}
                  title={`Set loop start to Bar ${bar.index + 1}`}
                  onClick={() => onSetLoopIn(bar.index)}
                >
                  IN
                </button>
                <button
                  type="button"
                  className={`secondary bar-loop-out ${isLoopOut ? 'active-loop-out' : ''}`}
                  aria-pressed={isLoopOut}
                  title={`Set loop end to Bar ${bar.index + 1}`}
                  onClick={() => onSetLoopOut(bar.index)}
                >
                  OUT
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
