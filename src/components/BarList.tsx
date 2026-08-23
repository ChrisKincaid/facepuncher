import { useState } from 'react'
import { formatTime } from '../utils/time'
import type { Bar, Take } from '../data/models'
import { BarWaveformEditor } from './BarWaveformEditor'

const sectionOptions = ['Intro', 'Verse 1', 'Verse 2', 'Chorus 1', 'Chorus 2', 'Bridge', 'Outro', 'Hook', 'Break', 'Custom']

interface Props {
  bars: Bar[]
  audioBuffer?: AudioBuffer
  playhead: number
  loopRange?: { start: number; end: number }
  loopEnabled: boolean
  currentBarIndex: number
  takes: Take[]
  activeBarPlayback?: { barIndex: number; mode: 'play' | 'loop' }
  onPlayFromBar: (barIndex: number) => void
  onLoopBar: (barIndex: number) => void
  onStopBar: () => void
  onRecordBar: (barIndex: number) => void
  onFocusBar: (barIndex: number) => void
  onSectionChange: (barIndex: number, section: string) => void
  onEdgeChange: (barIndex: number, startSec: number, endSec: number) => void
  onLoopChange: (start: number, end: number) => void
  onLoopEnabledChange: (enabled: boolean) => void
}

export function BarList({
  bars,
  audioBuffer,
  playhead,
  loopRange,
  loopEnabled,
  currentBarIndex,
  takes,
  activeBarPlayback,
  onPlayFromBar,
  onLoopBar,
  onStopBar,
  onRecordBar,
  onFocusBar,
  onSectionChange,
  onEdgeChange,
  onLoopChange,
  onLoopEnabledChange,
}: Props) {
  const [editingBar, setEditingBar] = useState<number | null>(null)
  const startSel = loopRange?.start ?? 0
  const endSel = loopRange?.end ?? Math.max(0, bars.length - 1)

  return (
    <div className="panel">
      <div className="section-title" style={{ marginBottom: 6 }}>
        <h3>Bars</h3>
        <div className="flex-gap">
          <label className="flex-gap loop-toggle">
            <input
              type="checkbox"
              checked={loopEnabled}
              onChange={(e) => onLoopEnabledChange(e.target.checked)}
            />
            Play selected loop
          </label>
          <span className="loop-range-summary">
            Loop: Bar {bars.length ? startSel + 1 : 0} - Bar {bars.length ? endSel + 1 : 0}
          </span>
        </div>
      </div>

      <div className="bar-list">
        {bars.map((bar) => {
          const active = playhead >= bar.startSec && playhead < bar.endSec
          const focused = bar.index === currentBarIndex
          const inLoop = loopRange && bar.index >= loopRange.start && bar.index <= loopRange.end
          const barTakes = takes.filter((t) => t.barIndex === bar.index)
          const selectedTake = barTakes.find((t) => t.selected)
          const activePlayback = activeBarPlayback?.barIndex === bar.index ? activeBarPlayback.mode : null
          const isLoopStart = loopRange?.start === bar.index
          const isLoopEnd = loopRange?.end === bar.index
          return (
            <div
              key={bar.index}
              className={`bar-row ${active ? 'bar-active' : ''} ${inLoop ? 'bar-loop' : ''} ${editingBar === bar.index ? 'bar-editing' : ''}`}
              onClick={() => onFocusBar(bar.index)}
            >
              <div className="bar-meta">
                <div className="bar-num">Bar {bar.index + 1}</div>
                <div className="bar-times">{formatTime(bar.startSec)} – {formatTime(bar.endSec)}</div>
                {focused && <span className="tag">Focused</span>}
                {active && <span className="tag" style={{ background: 'rgba(77,208,225,0.16)', borderColor: 'rgba(77,208,225,0.4)', color: '#4dd0e1' }}>Playing</span>}
              </div>
              <div className="bar-wave-thumb">
                <div className="bar-wave-fill" />
              </div>
              <div className="bar-section">
                <select
                  value={bar.section || ''}
                  onChange={(e) => onSectionChange(bar.index, e.target.value)}
                >
                  <option value="">Label…</option>
                  {sectionOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
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
                        onEdgeChange={(s: number, e: number) => onEdgeChange(bar.index, s, e)}
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
                <button onClick={(e) => { e.stopPropagation(); onRecordBar(bar.index) }}>
                  Rec
                </button>
                <div className="bar-takes">
                  <span className="text-muted">Takes: {barTakes.length}</span>
                  {selectedTake && <span className="tag">Active</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
