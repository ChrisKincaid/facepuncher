import { useState } from 'react'
import { formatTime } from '../utils/time'
import type { Bar, Take } from '../data/models'
import { BarWaveformEditor } from './BarWaveformEditor'
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
  onPlayFromBar: (barIndex: number) => void
  onLoopBar: (barIndex: number) => void
  onStopBar: () => void
  onArmTake: (barIndex: number, slot: number) => void
  onDisarmTake: (barIndex: number, slot?: number) => void
  onSelectTake: (barIndex: number, takeId: string) => void
  onListenTake: (barIndex: number, takeId: string) => void
  onSelectNoTake: (barIndex: number) => void
  onDeleteTake: (takeId: string) => void
  onToggleTakeLock: (takeId: string) => void
  onFocusBar: (barIndex: number) => void
  onEdgeChange: (barIndex: number, startSec: number, endSec: number, allowGaps: boolean) => void
  onLoopChange: (start: number, end: number) => void
  barGains: Record<number, number>
  onBarGain: (barIndex: number, value: number) => void
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
  onPlayFromBar,
  onLoopBar,
  onStopBar,
  onArmTake,
  onDisarmTake,
  onSelectTake,
  onListenTake,
  onSelectNoTake,
  onDeleteTake,
  onToggleTakeLock,
  onFocusBar,
  onEdgeChange,
  onLoopChange,
  barGains,
  onBarGain,
  onTakeGain,
}: Props) {
  const [editingBar, setEditingBar] = useState<number | null>(null)
  const startSel = loopRange?.start ?? 0
  const endSel = loopRange?.end ?? Math.max(0, bars.length - 1)

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
          const isLoopStart = loopRange?.start === bar.index
          const isLoopEnd = loopRange?.end === bar.index
          const selectedTake = barTakes.find((t) => t.selected)
          const barGainValue = barGains?.[bar.index] ?? 1
          return (
            <div
              key={bar.index}
              className={`bar-row ${active ? 'bar-active' : ''} ${inLoop ? 'bar-loop' : ''} ${editingBar === bar.index ? 'bar-editing' : ''}`}
              onClick={() => onFocusBar(bar.index)}
            >
              <div className="bar-meta">
                <div className="bar-num">Bar {bar.index + 1}</div>
                <div className="bar-times">{formatTime(bar.startSec)} – {formatTime(bar.endSec)}</div>
                <div
                  className={`bar-status-strip ${active ? 'bar-status-playing' : ''} ${isRecording && active && bar.index === currentBarIndex ? 'bar-status-recording' : ''}`}
                  aria-label={isRecording && active && bar.index === currentBarIndex ? 'Recording' : active ? 'Playing' : 'Bar inactive'}
                />
              </div>
              <div className="bar-wave-thumb">
                <TakeSlots
                  takes={barTakes}
                  armedSlots={armedTakeByBar[bar.index] ?? []}
                  onArm={(slot) => onArmTake(bar.index, slot)}
                  onDisarm={(slot) => onDisarmTake(bar.index, slot)}
                  onSelect={(takeId) => onSelectTake(bar.index, takeId)}
                  onListen={(takeId) => onListenTake(bar.index, takeId)}
                  onSelectNone={() => onSelectNoTake(bar.index)}
                  onDelete={onDeleteTake}
                  onToggleLock={onToggleTakeLock}
                />
              </div>
              <div className="bar-gains" onClick={(e) => e.stopPropagation()}>
                <div className="bar-gain-row">
                  <span className="bar-gain-label">Bar Vol</span>
                  <DragVolumeSlider
                    label="Bar Vol"
                    value={barGainValue}
                    onChange={(v) => onBarGain(bar.index, v)}
                    title="Volume for this bar — affects every take played on it"
                  />
                  <span className="text-muted bar-gain-value">{barGainValue.toFixed(2)}</span>
                </div>
                <div className="bar-gain-row">
                  <span className="bar-gain-label">
                    Take Vol {selectedTake ? `(Take ${barTakes.indexOf(selectedTake) + 1})` : '(none)'}
                  </span>
                  <DragVolumeSlider
                    label="Take Vol"
                    value={selectedTake?.gain ?? 1}
                    disabled={!selectedTake}
                    onChange={(v) => selectedTake && onTakeGain(selectedTake.takeId, v)}
                    title={selectedTake ? 'Volume for the currently selected take on this bar' : 'Select a take to adjust its volume'}
                  />
                  <span className="text-muted bar-gain-value">{(selectedTake?.gain ?? 1).toFixed(2)}</span>
                </div>
              </div>
              <div className="bar-edges">
                {editingBar === bar.index ? (
                  <>
                    {audioBuffer ? (
                      <BarWaveformEditor
                        audioBuffer={audioBuffer}
                        barStartSec={bar.startSec}
                        barEndSec={bar.endSec}
                        prevBarEnd={bars[bar.index - 1]?.endSec ?? 0}
                        nextBarStart={bars[bar.index + 1]?.startSec ?? bar.endSec + 4}
                        playhead={playhead}
                        onEdgeChange={(s: number, e: number, gaps: boolean) => onEdgeChange(bar.index, s, e, gaps)}
                      />
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>Load a beat first to edit edges.</span>
                    )}
                    <button className="secondary" style={{ marginTop: 6 }} onClick={(e) => { e.stopPropagation(); setEditingBar(null) }}>Done</button>
                  </>
                ) : (
                  <button className="secondary" onClick={(e) => { e.stopPropagation(); setEditingBar(bar.index) }}>
                    Edit
                  </button>
                )}
              </div>
              <div className="bar-actions">
                <button className="secondary" onClick={(e) => {
                  e.stopPropagation()
                  if (activePlayback === 'play') onStopBar()
                  else onPlayFromBar(bar.index)
                }}>
                  {activePlayback === 'play' ? 'Stop' : 'Play'}
                </button>
                <button className="secondary" onClick={(e) => {
                  e.stopPropagation()
                  if (activePlayback === 'loop') onStopBar()
                  else onLoopBar(bar.index)
                }}>
                  {activePlayback === 'loop' ? 'Stop' : 'Loop'}
                </button>
                <div className="bar-loop-actions">
                  <button className={`secondary bar-loop-button ${isLoopStart ? 'bar-loop-marker' : ''}`} onClick={(e) => {
                    e.stopPropagation()
                    onLoopChange(bar.index, endSel)
                  }}>
                    {isLoopStart ? 'Start set' : 'Set start'}
                  </button>
                  <button className={`secondary bar-loop-button ${isLoopEnd ? 'bar-loop-marker' : ''}`} onClick={(e) => {
                    e.stopPropagation()
                    onLoopChange(startSel, bar.index)
                  }}>
                    {isLoopEnd ? 'End set' : 'Set end'}
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
