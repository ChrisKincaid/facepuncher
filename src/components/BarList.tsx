import { useEffect, useRef, useState } from 'react'
import type { Bar, Take } from '../data/models'
import { BarWaveformBackdrop } from './BarWaveformBackdrop'
import { TakeSlots } from './TakeSlots'
import { DragVolumeSlider } from './DragVolumeSlider'

type BarScale = 1 | 2 | 4

interface Props {
  expanded: boolean
  onToggleSection: () => void
  bars: Bar[]
  emptyMessage: string
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
  clipboardTake: { sourceTakeId: string; sourceBarIndex: number; action: 'copy' | 'cut' } | null
  onCopyTake: (takeId: string) => void
  onCutTake: (takeId: string) => void
  onPasteTake: (barIndex: number) => void
  onClearClipboard: () => void
  onMoveTakeToBar: (takeId: string, barIndex: number) => void
  focusMode: boolean
  onToggleFocus: () => void
  onShowHelp: () => void
  onFocusBar: (barIndex: number) => void
  onTakeGain: (takeId: string, value: number) => void
}

export function BarList({
  expanded,
  onToggleSection,
  bars,
  emptyMessage,
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
  clipboardTake,
  onCopyTake,
  onCutTake,
  onPasteTake,
  onClearClipboard,
  onMoveTakeToBar,
  focusMode,
  onToggleFocus,
  onShowHelp,
  onFocusBar,
  onTakeGain,
}: Props) {
  const [barScale, setBarScale] = useState<BarScale>(2)
  const [openActionBar, setOpenActionBar] = useState<number | null>(null)
  const [draggingTakeId, setDraggingTakeId] = useState<string | null>(null)
  const [dropTargetBar, setDropTargetBar] = useState<number | null>(null)
  const [justPasted, setJustPasted] = useState(false)
  const pastedTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (pastedTimer.current) window.clearTimeout(pastedTimer.current)
  }, [])

  // A copy stays on the clipboard for repeat pastes, so the banner is the only place
  // that can confirm the paste landed.
  const handlePasteOnBar = (barIndex: number) => {
    onPasteTake(barIndex)
    setJustPasted(true)
    if (pastedTimer.current) window.clearTimeout(pastedTimer.current)
    pastedTimer.current = window.setTimeout(() => {
      pastedTimer.current = null
      setJustPasted(false)
    }, 1600)
  }

  return (
    <div className={`panel bar-list-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="collapsible-header section-header-toggle" role="button" tabIndex={0} aria-expanded={expanded} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onToggleSection() }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggleSection() } }} style={{ marginBottom: expanded ? 6 : 0 }}>
        <div className="bars-header-title">
          <span className="collapsible-title">Bars</span>
          <button
            className="section-help-button"
            type="button"
            aria-label="How do bars and takes work?"
            title="How do bars and takes work?"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onShowHelp() }}
          >
            ?
          </button>
        </div>
        {expanded && bars.length > 0 && (
        <div className="bar-scale-controls" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
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
            {focusMode ? 'Show Settings' : 'Bars Only'}
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
        )}
      </div>

      {expanded && (!bars.length ? (
        <div className="workspace-empty-state" role="status">
          {emptyMessage}
        </div>
      ) : <>

      {clipboardTake && (
        <div className={`clipboard-banner ${justPasted ? 'clipboard-banner-done' : ''}`} role="status">
          <span>
            {justPasted
              ? 'Pasted!'
              : `${clipboardTake.action === 'cut' ? 'Cut' : 'Copied'} take from Bar ${clipboardTake.sourceBarIndex + 1} — tap PASTE on a bar`}
          </span>
          <button type="button" className="clipboard-banner-cancel" onClick={onClearClipboard}>
            Done
          </button>
        </div>
      )}

      <div className={`bar-list bar-scale-${barScale}x`} tabIndex={0}>
        {bars.map((bar) => {
          const active = playhead >= bar.startSec && playhead < bar.endSec
          const inLoop = loopRange && bar.index >= loopRange.start && bar.index <= loopRange.end
          const barTakes = takes.filter((t) => t.barIndex === bar.index)
          const selectedTake = barTakes.find((t) => t.selected)
          const isLoopIn = loopRange?.start === bar.index
          const isLoopOut = loopRange?.end === bar.index
          const barFull = barTakes.length >= 5
          // Copy/Cut act on the active take, but fall back to the bar's first take —
          // clicking the "no take" pad clears the selection, and that must not make a
          // bar holding audio uncopyable (which left the clipboard empty and Paste grey).
          const transferTake = selectedTake ?? barTakes[0]
          const armedHere = (armedTakeByBar[bar.index] ?? []).length > 0
          const canPasteHere = Boolean(clipboardTake) && !barFull
          const isDropTarget = dropTargetBar === bar.index
          const recordingHere = isRecording && active && bar.index === currentBarIndex
          // Highest-urgency state wins; the label's colour is the only state indicator.
          const headerState = recordingHere
            ? 'bar-num-recording'
            : active
              ? 'bar-num-playing'
              : armedHere
                ? 'bar-num-armed'
                : isDropTarget
                  ? 'bar-num-drop-target'
                  : canPasteHere
                    ? 'bar-num-paste-ready'
                    : barTakes.length
                      ? 'bar-num-has-takes'
                      : 'bar-num-empty'
          const headerTitle = recordingHere
            ? 'Recording'
            : active
              ? 'Playing'
              : armedHere
                ? 'Armed to record'
                : barTakes.length
                  ? `${barTakes.length} take${barTakes.length > 1 ? 's' : ''}`
                  : 'No takes'
          return (
            <div
              key={bar.index}
              id={`bar-row-${bar.index}`}
              className={`bar-row ${active ? 'bar-active' : ''} ${inLoop ? 'bar-loop' : ''} ${isDropTarget ? 'bar-drop-target' : ''} ${draggingTakeId && barFull ? 'bar-drop-blocked' : ''} ${openActionBar === bar.index ? 'bar-menu-open' : ''}`}
              onClick={() => onFocusBar(bar.index)}
              onDragOver={(event) => {
                if (!draggingTakeId) return
                // Only a droppable bar may preventDefault — leaving the default in place
                // is what makes a full bar reject the drop instead of silently accepting.
                if (barFull) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                if (dropTargetBar !== bar.index) setDropTargetBar(bar.index)
              }}
              onDragLeave={() => { if (dropTargetBar === bar.index) setDropTargetBar(null) }}
              onDrop={(event) => {
                event.preventDefault()
                setDropTargetBar(null)
                const takeId = event.dataTransfer.getData('text/plain') || draggingTakeId
                if (takeId) onMoveTakeToBar(takeId, bar.index)
              }}
            >
              <div className="bar-main-row">
              <div className="bar-controls-left">
              <div className="bar-meta">
                <div className={`bar-num ${headerState}`} title={headerTitle} aria-label={`Bar ${bar.index + 1} — ${headerTitle}`}>Bar {bar.index + 1}</div>
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
                  onDragTakeStart={setDraggingTakeId}
                  onDragTakeEnd={() => { setDraggingTakeId(null); setDropTargetBar(null) }}
                />
              </div>
              <div className="bar-take-actions" onClick={(e) => e.stopPropagation()}>
                <div className="bar-transfer-wrap">
                  <button
                    type="button"
                    className={`secondary bar-transfer-button ${openActionBar === bar.index ? 'bar-transfer-open' : ''} ${canPasteHere ? 'bar-transfer-loaded' : ''}`}
                    aria-haspopup="menu"
                    aria-expanded={openActionBar === bar.index}
                    title={canPasteHere
                      ? `Clipboard ready \u2014 paste into Bar ${bar.index + 1}`
                      : 'Copy, cut or paste a take'}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      event.preventDefault()
                      setOpenActionBar((open) => (open === bar.index ? null : bar.index))
                    }}
                  >
                    {'\u21c4'}
                  </button>
                  {openActionBar === bar.index && (
                    <div
                      className="bar-transfer-menu"
                      role="menu"
                      onClick={(event) => { event.stopPropagation(); event.preventDefault() }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="bar-transfer-action"
                        disabled={!transferTake}
                        title={transferTake ? `Copy Take from Bar ${bar.index + 1}` : 'This bar has no takes to copy'}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          if (transferTake) onCopyTake(transferTake.takeId)
                          setOpenActionBar(null)
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="bar-transfer-action"
                        disabled={!transferTake}
                        title={transferTake ? `Cut Take from Bar ${bar.index + 1}` : 'This bar has no takes to cut'}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          if (transferTake) onCutTake(transferTake.takeId)
                          setOpenActionBar(null)
                        }}
                      >
                        Cut
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="bar-transfer-action bar-transfer-delete"
                        disabled={!transferTake}
                        title={transferTake ? `Delete Take from Bar ${bar.index + 1}` : 'This bar has no takes to delete'}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation()
                          event.preventDefault()
                          if (transferTake) onDeleteTake(transferTake.takeId)
                          setOpenActionBar(null)
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
                {clipboardTake && (
                  <button
                    type="button"
                    className={`bar-paste-button ${barFull ? 'bar-paste-blocked' : ''}`}
                    disabled={barFull}
                    title={barFull ? 'Bar Full \u2014 Max 5 Takes' : `Paste the ${clipboardTake.action === 'cut' ? 'cut' : 'copied'} take into Bar ${bar.index + 1}`}
                    onClick={() => handlePasteOnBar(bar.index)}
                  >
                    PASTE
                  </button>
                )}
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
      </>)}
    </div>
  )
}
