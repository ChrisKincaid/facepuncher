import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HorizontalWaveformDetail } from './HorizontalWaveformDetail'
import { Mixer } from './Mixer'
import { ExportDialog } from './ExportDialog'
import { BarList } from './BarList'
import { BarWaveformEditor } from './BarWaveformEditor'
import { useStore } from '../state/store'
import { generateBars } from '../analysis/bpmGrid'
import { estimateBpmFromBuffer } from '../analysis/onsetEstimate'
import { formatTime } from '../utils/time'
import { audioEngine } from '../audio/audioEngine'
import { renderOffline } from '../audio/offlineRender'
import { encodeWavFromAudioBuffer } from '../audio/wav'
import { deleteBlob, getBlob, listProjects, putBlob, saveProject } from '../data/storage'
import type { Take } from '../data/models'

export default function App() {
  const {
    project,
    currentBarIndex,
    isRecording,
    isVocalMuted,
    armedTakeByBar,
    loopRange,
    audioUrl,
    setBeatMeta,
    setBar1AnchorTime,
    setBars,
    setAudioUrl,
    setBeatFile,
    setCurrentBar,
    setRecording,
    setVocalMuted,
    setLoopRange,
    setLatencyOffset,
    armTake,
    disarmTake,
    consumeArmedTake,
    saveTake,
    selectTake,
    clearTakeSelection,
    deleteTake,
    restoreTake,
    deleteAllTakes,
    toggleTakeLock,
    setTakeGain,
    updateMix,
    setProject,
  } = useStore()

  const [, setStatus] = useState('Drop a beat to start (WAV/MP3, ≤10 min).')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [cursor, setCursor] = useState(0)   // live playback position (moves during play)
  const recordTimer = useRef<number | null>(null)
  const startTimer = useRef<number | null>(null)
  const blobCache = useRef<Map<string, Blob>>(new Map())
  const decodedTakeCache = useRef<Map<string, AudioBuffer>>(new Map())
  const [isPlaying, setIsPlaying] = useState(false)
  const isPlayingRef = useRef(false)
  const recordingActiveRef = useRef(false)
  const recordingPendingRef = useRef(false)
  const recordingTargetRef = useRef<{ barIndex: number; slot: number } | null>(null)
  const lastPlayingBarRef = useRef<number | null>(null)
  const previousAudioTimeRef = useRef<number | null>(null)
  const waitLoggedForBarRef = useRef<number | null>(null)
  // Highest bar index already sample-accurately pre-scheduled by scheduleChainForward for
  // the current playback pass; bars up to this index must not be reactively re-triggered.
  const chainedThroughBarRef = useRef<number>(-1)
  const takePlaybackRequestRef = useRef(0)
  const lastTakeBarRef = useRef<number | null>(null)
  const directTakeScheduledBarRef = useRef<number | null>(null)
  const activeLoopingTakeBarRef = useRef<number | null>(null)
  const syncGenerationRef = useRef(0)
  const vocalSyncMsRef = useRef(project.latencyOffsetMs)
  const playheadRef = useRef(0)
  const cursorRef = useRef(0)
  const [monitorEnabled, setMonitorEnabled] = useState(false)
  const [monitorGain, setMonitorGain] = useState(0.8)
  const [detectBusy, setDetectBusy] = useState(false)
  const [bpmInput, setBpmInput] = useState(() => project.beat.bpm ? String(project.beat.bpm) : '')
  const [showImportHelp, setShowImportHelp] = useState(false)
  const [showSetup, setShowSetup] = useState(true)
  // Firefox's AudioWorklet delivers empty input on some render quanta during sustained loud
  // input, silently corrupting recordings — confirmed unfixable from JS; recommend Chromium.
  const [showBrowserWarning, setShowBrowserWarning] = useState(() => /firefox/i.test(navigator.userAgent))
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [waveformResetKey, setWaveformResetKey] = useState(0)
  const [activeBarPlayback, setActiveBarPlayback] = useState<{ barIndex: number; mode: 'play' | 'loop' } | undefined>(undefined)
  const [auditioningTakeId, setAuditioningTakeId] = useState<string | undefined>(undefined)
  const auditionTimer = useRef<number | null>(null)
  const [undoToast, setUndoToast] = useState<{ take: Take; index: number } | null>(null)
  const undoTimer = useRef<number | null>(null)
  const pendingUndoRef = useRef<{ take: Take; index: number } | null>(null)
  const manualOffsetRef = useRef(false)
  const manualBpmRef = useRef(false)
  const tapTimesRef = useRef<number[]>([])
  const bar1AnchorRef = useRef<number | undefined>(project.beat.bar1AnchorTime)

  const totalDuration = useMemo(
    () => project.beat.durationSec || project.bars[project.bars.length - 1]?.endSec || 0,
    [project.beat.durationSec, project.bars],
  )
  const audioLoaded = useMemo(() => Boolean(audioUrl && totalDuration > 0), [audioUrl, totalDuration])

  useEffect(() => {
    vocalSyncMsRef.current = project.latencyOffsetMs
  }, [project.latencyOffsetMs])

  useEffect(() => {
    setBpmInput(project.beat.bpm ? String(project.beat.bpm) : '')
  }, [project.beat.bpm])

  useEffect(() => {
    bar1AnchorRef.current = project.beat.bar1AnchorTime
  }, [project.beat.bar1AnchorTime])

  useEffect(() => {
    saveProject(project).catch((err) => console.error('autosave failed', err))
  }, [project])

  useEffect(() => {
    console.log('[Punchin] recording diagnostics loaded')
    void audioEngine.prepareMicrophone()
      .then(() => setStatus('Microphone ready. Load audio to begin.'))
      .catch((err) => {
        console.error('microphone access on load failed', err)
        setStatus('Microphone unavailable. Check browser permissions before recording.')
      })
  }, [])

  // Drive the visible cursor from the same AudioContext clock used by the
  // playing source. A frame loop avoids the visual position lagging behind the
  // audible position between coarse React timer updates.
  useEffect(() => {
    let frame = 0
    const updateCursor = () => {
      if (!isPlayingRef.current) return
      const raw = audioEngine.currentTime
      const currentBarIndex = project.bars.findIndex((bar) => raw >= bar.startSec && raw < bar.endSec)
      const wrapped = previousAudioTimeRef.current !== null && raw < previousAudioTimeRef.current - 0.05
      const enteredBar = currentBarIndex >= 0 && (currentBarIndex !== lastPlayingBarRef.current || wrapped)
      previousAudioTimeRef.current = raw
      // A loop wrap starts a fresh pass — any earlier chain burst no longer applies.
      if (wrapped) chainedThroughBarRef.current = -1
      if (enteredBar) {
        const armed = armedTakeByBar[currentBarIndex]?.length ?? 0
        const busy = recordingActiveRef.current || recordingPendingRef.current
        // Only mark this bar as "handled" once its action actually dispatches. If a previous
        // take is still finalizing (busy), leave lastPlayingBarRef unset so the very next
        // animation frame retries instead of silently skipping this bar for a whole lap.
        if (armed && !busy) {
          waitLoggedForBarRef.current = null
          lastPlayingBarRef.current = currentBarIndex
          console.log('%c[ENTER BAR]', 'color:#fff;background:#333;padding:2px 6px', {
            ctxTime: raw.toFixed(3), barIndex: currentBarIndex, wrapped, armedSlots: armed, action: 'BEGIN-RECORD',
          })
          recordingPendingRef.current = true
          void beginAutomaticRecording(currentBarIndex)
        } else if (!armed && !busy) {
          waitLoggedForBarRef.current = null
          lastPlayingBarRef.current = currentBarIndex
          if (currentBarIndex <= chainedThroughBarRef.current) {
            // Already sample-accurately scheduled ahead of time by a previous chain burst —
            // starting it again here would double-trigger and click.
            console.log('%c[ENTER BAR]', 'color:#fff;background:#333;padding:2px 6px', {
              ctxTime: raw.toFixed(3), barIndex: currentBarIndex, wrapped, armedSlots: armed, action: 'ALREADY-CHAINED',
            })
          } else {
            console.log('%c[ENTER BAR]', 'color:#fff;background:#333;padding:2px 6px', {
              ctxTime: raw.toFixed(3), barIndex: currentBarIndex, wrapped, armedSlots: armed, action: 'PLAY-TAKE',
            })
            // Non-armed bar: restart its selected take from the very beginning on every
            // entry, including loop wraps. One source, constant gain, no offset — so each
            // loop pass plays the whole take from "1" instead of only the tail.
            void (async () => {
              const startAt = await playSelectedTakeFromStart(currentBarIndex)
              if (startAt !== undefined) void scheduleChainForward(currentBarIndex, startAt)
            })()
          }
        } else if (waitLoggedForBarRef.current !== currentBarIndex) {
          // busy: log once per wait streak instead of spamming every animation frame
          waitLoggedForBarRef.current = currentBarIndex
          console.log('%c[ENTER BAR]', 'color:#fff;background:#333;padding:2px 6px', {
            ctxTime: raw.toFixed(3), barIndex: currentBarIndex, wrapped, armedSlots: armed, action: 'WAIT-RECORDING',
            recordingActive: recordingActiveRef.current, recordingPending: recordingPendingRef.current,
          })
        }
      }
      if (loopEnabled && loopRange && project.bars[loopRange.start] && project.bars[loopRange.end]) {
        const loopStart = project.bars[loopRange.start].startSec
        const loopEnd = project.bars[loopRange.end].endSec
        const span = Math.max(loopEnd - loopStart, 0.0001)
        // The source can start before the selected loop. Keep the cursor at
        // the true file position until playback reaches the loop start; only
        // wrap after the audio has passed the loop end.
        setCursor(raw < loopStart ? raw : loopStart + ((raw - loopStart) % span + span) % span)
      } else {
        setCursor(raw)
      }
      frame = window.requestAnimationFrame(updateCursor)
    }
    frame = window.requestAnimationFrame(updateCursor)
    return () => window.cancelAnimationFrame(frame)
  }, [armedTakeByBar, isPlaying, loopEnabled, loopRange, project.bars, project.latencyOffsetMs, project.takes])

  useEffect(() => {
    if (!loopEnabled || !loopRange || loopRange.start !== loopRange.end || activeLoopingTakeBarRef.current !== loopRange.start) {
      activeLoopingTakeBarRef.current = null
    }
    if (loopEnabled && loopRange && project.bars[loopRange.start] && project.bars[loopRange.end]) {
      audioEngine.setLoop(project.bars[loopRange.start].startSec, project.bars[loopRange.end].endSec)
      if (isPlayingRef.current) {
        const position = audioEngine.currentTime
        previousAudioTimeRef.current = position
        setCursor(position)
      }
      return
    }
    audioEngine.setLoop(undefined, undefined)
  }, [loopEnabled, loopRange, project.bars])

  useEffect(() => {
    audioEngine.setMasterBeatGain(project.mix.masterBeatGain)
  }, [project.mix.masterBeatGain])

  useEffect(() => {
    audioEngine.setMasterVocalGain(project.mix.globalVocalGain)
  }, [project.mix.globalVocalGain])

  useEffect(() => {
    audioEngine.setMasterVocalMuted(isVocalMuted)
  }, [isVocalMuted])

  useEffect(() => {
    void (async () => {
      try {
        const projects = await listProjects()
        if (!projects.length) return
        const latest = [...projects]
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .pop()
        if (!latest) return
        setProject(latest.bars.length ? latest : { ...latest, beat: { ...latest.beat, bpm: 0 } })
        const beatBlob = latest.beat.fileId ? await getBlob(latest.beat.fileId) : undefined
        if (beatBlob) {
          blobCache.current.set(latest.beat.fileId, beatBlob)
          setAudioUrl(URL.createObjectURL(beatBlob))
        }
        await Promise.all(
          latest.takes.map(async (take) => {
            const blob = await getBlob(take.fileId)
            if (blob) blobCache.current.set(take.fileId, blob)
          }),
        )
        setStatus(`Restored project "${latest.name}"`)
      } catch (err) {
        console.error('restore failed', err)
        setStatus('Could not restore previous project.')
      }
    })()
  }, [setAudioUrl, setProject])

  const handleFile = async (file?: File) => {
    if (!file) return
    const extOk = /(wav|wave|mp3)$/i.test(file.name)
    if (!extOk) { setStatus('Only WAV or MP3 are accepted.'); return }
    try {
      setStatus(`Decoding ${file.name}\u2026`)
      const meta = await audioEngine.loadBeat(file)
      if (meta.durationSec > 600) { setStatus('File is longer than 10 minutes.'); return }
      const url = URL.createObjectURL(file)
      setAudioUrl(url)
      setBeatFile(file)
      const fileId = `beat-${crypto.randomUUID()}`
      blobCache.current.set(fileId, file)
      void putBlob(fileId, file)
      manualOffsetRef.current = false
      manualBpmRef.current = false
      bar1AnchorRef.current = undefined
      setBeatMeta({ fileId, durationSec: meta.durationSec, bpm: project.beat.bpm, timeSig: project.beat.timeSig, offsetSec: 0, bar1AnchorTime: undefined })
      setBars([])
      // Loading audio does not create a grid or move the transport.
      setPlayhead(0)
      setCursor(0)
      audioEngine.seek(0)
      setStatus(`Loaded \u201c${file.name}\u201d (${meta.durationSec.toFixed(1)}s). Set Bar 1 or run Auto-detect bars.`)
    } catch (err) {
      setDetectBusy(false)
      console.error(err)
      setStatus('Failed to decode file. Is it a valid WAV/MP3?')
    }
  }

  const handleAutoDetectBars = async () => {
    const buf = audioEngine.beatAudioBuffer
    if (!buf || !project.beat.durationSec) return
    const existingAnchor = bar1AnchorRef.current ?? project.beat.bar1AnchorTime
    setDetectBusy(true)
    const detected = await estimateBpmFromBuffer(buf, existingAnchor ?? 0)
    setDetectBusy(false)
    if (!detected) { setStatus('BPM detection failed. Try adjusting manually.'); return }
    const bpm = normalizeBpm(detected.bpm)
    manualBpmRef.current = false
    const anchor = existingAnchor ?? detected.offsetSec
    const offsetSec = anchor
    bar1AnchorRef.current = anchor
    setBeatMeta({ ...project.beat, bpm, offsetSec, bar1AnchorTime: anchor })
    setBars(generateBars(project.beat.durationSec, bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, offsetSec, anchor))
    setStatus(`Auto-detected bars at ${bpm} BPM, offset ${offsetSec.toFixed(3)}s (${Math.round(detected.confidence * 100)}% confidence).`)
  }

  const normalizeBpm = (bpm: number) => {
    const rounded = Math.round(bpm * 10) / 10
    return Math.max(50, Math.min(300, rounded < 50 ? rounded * 2 : rounded))
  }

  const applyBpm = (bpm: number) => {
    const clamped = normalizeBpm(bpm)
    const anchor = bar1AnchorRef.current ?? project.bars[0]?.startSec ?? project.beat.bar1AnchorTime
    bar1AnchorRef.current = anchor
    setBeatMeta({ ...project.beat, bpm: clamped, bar1AnchorTime: anchor })
    if (project.beat.durationSec && project.bars.length) {
      setBars(generateBars(project.beat.durationSec, clamped, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, project.beat.offsetSec ?? 0, anchor))
    }
  }

  const handleBpmInput = (value: string) => {
    setBpmInput(value)
    const bpm = Number(value)
    if (!value || !Number.isFinite(bpm) || bpm > 300) return
    manualBpmRef.current = true
    applyBpm(bpm)
  }

  const commitBpmInput = () => {
    const bpm = Number(bpmInput)
    if (!Number.isFinite(bpm)) {
      setBpmInput(project.beat.bpm ? String(project.beat.bpm) : '')
      return
    }
    manualBpmRef.current = true
    applyBpm(bpm)
  }

  const handleTapTempo = () => {
    const now = performance.now()
    const taps = tapTimesRef.current
    const previousTap = taps[taps.length - 1]
    const nextTaps = previousTap && now - previousTap > 2000 ? [now] : [...taps, now].slice(-6)
    tapTimesRef.current = nextTaps
    if (nextTaps.length < 2) return
    const intervals = nextTaps.slice(1).map((time, index) => time - nextTaps[index])
    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
    const bpm = 60000 / averageInterval
    if (bpm > 300) return
    manualBpmRef.current = true
    setBpmInput(String(Math.round(bpm * 10) / 10))
    applyBpm(bpm)
  }

  useEffect(() => {
    if (!project.bars.length) {
      setLoopRange(undefined)
      return
    }
    if (!loopRange) {
      setLoopRange({ start: 0, end: project.bars.length - 1 })
      return
    }
    const start = Math.min(loopRange.start, project.bars.length - 1)
    const end = Math.min(Math.max(loopRange.end, start), project.bars.length - 1)
    if (start !== loopRange.start || end !== loopRange.end) setLoopRange({ start, end })
  }, [loopRange, project.bars.length, setLoopRange])

  const handleSeek = useCallback(
    (time: number) => {
      chainedThroughBarRef.current = -1
      setPlayhead(time)
      setCursor(time)
      audioEngine.seek(time)
    },
    [setPlayhead],
  )

  /** Set the Bar 1 offset — reused by drag, button, and number input */
  const applyOffset = useCallback((offsetSec: number) => {
    const clamped = Math.max(0, Math.min(offsetSec, totalDuration))
    manualOffsetRef.current = true
    const anchor = bar1AnchorRef.current ?? project.bars[0]?.startSec ?? project.beat.bar1AnchorTime
    bar1AnchorRef.current = anchor
    setBeatMeta({ ...project.beat, offsetSec: clamped, bar1AnchorTime: anchor })
    if (project.beat.durationSec && project.bars.length) {
      setBars(generateBars(project.beat.durationSec, project.beat.bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, clamped, anchor))
    }
  }, [project.beat, project.bars, setBeatMeta, setBars, totalDuration])

  const setBar1Anchor = useCallback((timeSec: number) => {
    const anchor = Math.max(0, Math.min(timeSec, totalDuration))
    manualOffsetRef.current = true
    bar1AnchorRef.current = anchor
    setBar1AnchorTime(anchor)
    if (project.beat.durationSec && project.bars.length) {
      setBars(generateBars(project.beat.durationSec, project.beat.bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, anchor, anchor))
    }
  }, [project.beat, setBar1AnchorTime, setBars, totalDuration])

  const handlePlay = useCallback(() => {
    if (!audioLoaded) return
    console.log('[Punchin] top-level Play clicked', { contextState: audioEngine.contextState, position: playhead, isPlaying: isPlayingRef.current })
    chainedThroughBarRef.current = -1
    const selectedLoop = loopEnabled && loopRange
      ? { start: project.bars[loopRange.start], end: project.bars[loopRange.end] }
      : undefined
    const startAt = selectedLoop?.start ? selectedLoop.start.startSec : playhead
    audioEngine.play(startAt)
    setPlayhead(startAt)
    setCursor(startAt)
    setIsPlaying(true)
    isPlayingRef.current = true
  }, [audioLoaded, loopEnabled, loopRange, playhead, project.bars])

  const handlePause = useCallback(() => {
    if (!audioLoaded) return
    const pausedAt = audioEngine.currentTime
    audioEngine.stop()
    // Move the play position to where we paused, so Play resumes from here
    setPlayhead(pausedAt)
    setCursor(pausedAt)
    audioEngine.seek(pausedAt)
    setIsPlaying(false)
    isPlayingRef.current = false
  }, [audioLoaded])

  const clearTimers = () => {
    if (startTimer.current) { window.clearTimeout(startTimer.current); startTimer.current = null }
    if (recordTimer.current) { window.clearTimeout(recordTimer.current); recordTimer.current = null }
  }

  const handleStop = useCallback(() => {
    if (!audioLoaded) return
    clearTimers()
    directTakeScheduledBarRef.current = null
    activeLoopingTakeBarRef.current = null
    isPlayingRef.current = false
    audioEngine.stop()
    audioEngine.seek(0)
    if (recordingActiveRef.current) void stopRecordingFlow()
    else setRecording(false)
    setIsPlaying(false)
    setPlayhead(0)
    setCursor(0)
    recordingPendingRef.current = false
    lastPlayingBarRef.current = null
    previousAudioTimeRef.current = null
    chainedThroughBarRef.current = -1
    setWaveformResetKey((key) => key + 1)
    setActiveBarPlayback(undefined)
  }, [audioLoaded])

  const handleLoopChange = (start: number, end: number) => {
    if (!project.bars.length) return
    const clampedStart = Math.max(0, Math.min(start, project.bars.length - 1))
    const clampedEnd = Math.max(clampedStart, Math.min(end, project.bars.length - 1))
    chainedThroughBarRef.current = -1
    setLoopRange({ start: clampedStart, end: clampedEnd })
  }

  const handleLoopStartChange = (start: number) => {
    handleLoopChange(start, Math.max(start, loopRange?.end ?? start))
  }

  const handleLoopEndChange = (end: number) => {
    handleLoopChange(Math.min(loopRange?.start ?? end, end), end)
  }

  const handleScrub = (value: number) => {
    if (!audioLoaded || !totalDuration) return
    const clamped = Math.min(Math.max(value, 0), totalDuration)
    if (loopRange && (clamped < project.bars[loopRange.start]?.startSec || clamped > project.bars[loopRange.end]?.endSec)) {
      setLoopRange({ start: 0, end: project.bars.length - 1 })
    }
    handleSeek(clamped)
  }

  const handlePlayFromBar = (barIndex: number) => {
    if (!audioLoaded) return
    const bar = project.bars[barIndex]
    if (!bar) return
      console.log('[Punchin] bar Play clicked', { barIndex, armedSlots: armedTakeByBar[barIndex] ?? [] })
      setStatus(armedTakeByBar[barIndex]?.length ? `Preparing recording for Bar ${barIndex + 1}...` : `Playing Bar ${barIndex + 1}.`)
    chainedThroughBarRef.current = -1
    setCurrentBar(barIndex)
    setActiveBarPlayback({ barIndex, mode: 'play' })
    setLoopEnabled(false)
    audioEngine.setLoop(undefined, undefined)
    setPlayhead(bar.startSec)
    setCursor(bar.startSec)
    void startBarPlayback(barIndex, false)
    setIsPlaying(true)
    isPlayingRef.current = true
  }

  const handleLoopBar = (barIndex: number) => {
      console.log('[Punchin] bar Loop clicked', { barIndex, armedSlots: armedTakeByBar[barIndex] ?? [] })
      setStatus(armedTakeByBar[barIndex]?.length ? `Preparing loop recording for Bar ${barIndex + 1}...` : `Looping Bar ${barIndex + 1}.`)
    if (!audioLoaded) return
    const bar = project.bars[barIndex]
    if (!bar) return
    chainedThroughBarRef.current = -1
    setCurrentBar(barIndex)
    setActiveBarPlayback({ barIndex, mode: 'loop' })
    setLoopRange({ start: barIndex, end: barIndex })
    setLoopEnabled(true)
    audioEngine.setLoop(bar.startSec, bar.endSec)
    setPlayhead(bar.startSec)
    setCursor(bar.startSec)
    void startBarPlayback(barIndex, true)
    setIsPlaying(true)
    isPlayingRef.current = true
  }

  const startBarPlayback = async (barIndex: number, loop: boolean) => {
    const bar = project.bars[barIndex]
    if (!bar || !audioLoaded) return
    const armedSlot = armedTakeByBar[barIndex]?.[0]
    try {
      if (armedSlot !== undefined) recordingPendingRef.current = true
      if (armedSlot !== undefined) await audioEngine.prepareMicrophone()
      if (armedSlot === undefined) {
        audioEngine.play(bar.startSec)
        void playSelectedTake(barIndex)
        return
      }
      await beginAutomaticRecording(barIndex)
      audioEngine.play(bar.startSec)
      if (loop) setStatus(`Recording Take ${armedSlot + 1} for Bar ${barIndex + 1}. Loop once to create another take.`)
    } catch (err) {
      console.error('bar playback recording failed', err)
      audioEngine.stop()
      recordingTargetRef.current = null
      recordingPendingRef.current = false
      recordingActiveRef.current = false
      setIsPlaying(false)
      isPlayingRef.current = false
      setStatus('Could not start bar recording. Check microphone permissions and input device.')
    }
  }

  async function beginAutomaticRecording(barIndex: number) {
    const bar = project.bars[barIndex]
    const armedSlot = armedTakeByBar[barIndex]?.[0]
    if (!bar || armedSlot === undefined || recordingActiveRef.current) {
      recordingPendingRef.current = false
      return
    }
    try {
      recordingTargetRef.current = { barIndex, slot: armedSlot }
      // Recover the bar's true start instant even though we may be noticing this a few ms
      // late — the continuous capture buffer already has that audio, so recording from the
      // exact boundary (not "now") needs no manual sync compensation on playback.
      const trueStartAt = audioEngine.ctxTimeForPosition(bar.startSec)
      const remainingSec = Math.max(0.01, bar.endSec - audioEngine.currentTime)
      console.log('%c[FLOW] beginAutomaticRecording', 'color:#fff;background:#a60;padding:2px 6px', {
        barIndex, armedSlot, barStartSec: bar.startSec.toFixed(3), barEndSec: bar.endSec.toFixed(3),
        remainingSec: remainingSec.toFixed(3), playbackPos: audioEngine.currentTime.toFixed(3),
      })
      await audioEngine.startRecording(trueStartAt)
      recordingActiveRef.current = true
      recordingPendingRef.current = false
      setRecording(true)
      setStatus(`Recording Take ${armedSlot + 1} for Bar ${barIndex + 1}.`)
      recordTimer.current = window.setTimeout(() => {
        console.log('%c[FLOW] recordTimer fired → stopRecordingFlow', 'color:#a60', { barIndex, afterMs: Math.round(remainingSec * 1000) })
        void stopRecordingFlow()
      }, remainingSec * 1000)
    } catch (err) {
      console.error('automatic recording failed', err)
      recordingPendingRef.current = false
      recordingTargetRef.current = null
      audioEngine.stop()
      setIsPlaying(false)
      isPlayingRef.current = false
      setStatus('Automatic recording could not start. Check microphone permissions and input device.')
    }
  }

  async function playSelectedTakeFromStart(barIndex: number): Promise<number | undefined> {
    const take = project.takes.find((item) => item.barIndex === barIndex && item.selected)
    if (!take) {
      console.log('%c[PLAY] no selected take', 'color:#888', { barIndex })
      audioEngine.stopTake()
      return undefined
    }
    const gainValue = take.gain
    // Reactive bar-entry detection can notice the boundary a few ms late — measure that lag
    // directly (position now vs. the bar's true start) and skip into the take by that amount
    // so it lines up on its own. The manual sync slider still layers on top for any residual
    // hardware input latency the user wants to dial in. Measured fresh right before playTake
    // is actually called, since a cold-cache decode below can take long enough to go stale.
    const bar = project.bars[barIndex]
    const computeOffsetAndDelay = () => {
      const lagSec = bar ? Math.max(0, audioEngine.currentTime - bar.startSec) : 0
      const syncSec = vocalSyncMsRef.current / 1000
      const effectiveSec = lagSec - syncSec
      return { offsetSec: Math.max(0, effectiveSec), delaySec: Math.max(0, -effectiveSec) }
    }
    const cached = decodedTakeCache.current.get(take.takeId)
    if (cached) {
      logBufferRegions('PLAY from-cache', barIndex, take.takeId, cached)
      const { offsetSec, delaySec } = computeOffsetAndDelay()
      const startAt = audioEngine.playTake(cached, offsetSec, gainValue, delaySec)
      // Chain math needs the take's "virtual" position-0 instant, not the literal start time —
      // a negative sync skips into the buffer instead of delaying, so the buffer's own position
      // 0 effectively happened offsetSec before startAt. Without subtracting it back out here,
      // only bar 1 would follow the sync slider and every chained bar after it would drift.
      return startAt === undefined ? undefined : startAt - offsetSec
    }
    const blob = blobCache.current.get(take.fileId)
    if (!blob) return undefined
    try {
      const ctx = await audioEngine.ensureContext()
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      decodedTakeCache.current.set(take.takeId, buffer)
      if (!isPlayingRef.current || recordingActiveRef.current) return undefined
      logBufferRegions('PLAY from-decode', barIndex, take.takeId, buffer)
      const { offsetSec, delaySec } = computeOffsetAndDelay()
      const startAt = audioEngine.playTake(buffer, offsetSec, gainValue, delaySec)
      return startAt === undefined ? undefined : startAt - offsetSec
    } catch (err) {
      console.error('take playback failed', err)
      return undefined
    }
  }

  // How many contiguous bars to sample-accurately pre-schedule in one burst. Bounded so a
  // cold cache (nothing decoded yet) can't stall Play with a long up-front decode queue —
  // entering a bar beyond this horizon just falls back to the reactive path and re-triggers
  // another burst from there, so a full song still ends up fully chained after enough passes.
  const MAX_CHAIN_BARS = 32

  // Schedule bar-after-bar takes at exact, back-to-back AudioContext times with no fade at
  // the seam, so a note held across two recorded takes plays as one continuous sound. Stops
  // at the first bar that isn't eligible (armed for recording, no take, or past the loop end).
  const scheduleChainForward = useCallback(async (fromBarIndex: number, fromStartAt: number) => {
    let barIndex = fromBarIndex
    let startAt = fromStartAt
    for (let hop = 0; hop < MAX_CHAIN_BARS; hop++) {
      const bar = project.bars[barIndex]
      const nextIndex = barIndex + 1
      const nextBar = project.bars[nextIndex]
      if (!bar || !nextBar) return
      if (loopEnabled && loopRange && nextIndex > loopRange.end) return
      if (armedTakeByBar[nextIndex]?.length) return
      const take = project.takes.find((item) => item.barIndex === nextIndex && item.selected)
      if (!take) return
      let buffer = decodedTakeCache.current.get(take.takeId)
      if (!buffer) {
        const blob = blobCache.current.get(take.fileId)
        if (!blob) return
        try {
          const ctx = await audioEngine.ensureContext()
          buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
          decodedTakeCache.current.set(take.takeId, buffer)
        } catch (err) {
          console.error('chain take decode failed', err)
          return
        }
      }
      // The transport may have stopped/moved on while we were decoding — bail rather
      // than schedule audio for a session that's no longer current.
      if (!isPlayingRef.current || recordingActiveRef.current) return
      const nextStartAt = startAt + (nextBar.startSec - bar.startSec)
      const gainValue = take.gain
      audioEngine.scheduleTakeAt(buffer, nextIndex, nextStartAt, gainValue)
      chainedThroughBarRef.current = Math.max(chainedThroughBarRef.current, nextIndex)
      barIndex = nextIndex
      startAt = nextStartAt
    }
  }, [armedTakeByBar, loopEnabled, loopRange, project.bars, project.takes])


  function logBufferRegions(tag: string, barIndex: number, takeId: string, buffer: AudioBuffer) {
    const data = buffer.getChannelData(0)
    const segs = 8
    const rms: string[] = []
    let peak = 0
    for (let s = 0; s < segs; s++) {
      const from = Math.floor((data.length * s) / segs)
      const to = Math.floor((data.length * (s + 1)) / segs)
      let sum = 0
      for (let i = from; i < to; i++) { const v = data[i]; sum += v * v; const a = Math.abs(v); if (a > peak) peak = a }
      rms.push(Math.sqrt(sum / Math.max(1, to - from)).toFixed(3))
    }
    console.log('%c[PLAY] ' + tag, 'color:#fff;background:#036;padding:2px 6px', {
      barIndex,
      takeId,
      durationSec: buffer.duration.toFixed(3),
      peak: peak.toFixed(3),
      rms8: rms.join(' | '),
    })
  }

  async function playSelectedTake(barIndex: number, offsetSec = 0, syncSec = project.latencyOffsetMs / 1000, currentPositionSec?: number, takeOverride?: Take) {
    const take = takeOverride ?? project.takes.find((item) => item.barIndex === barIndex && item.selected)
    if (!take) {
      console.log('[Punchin] no selected take for bar playback', { barIndex })
      audioEngine.stopTake()
      return
    }
    const blob = blobCache.current.get(take.fileId)
    if (!blob) {
      console.warn('[Punchin] selected take blob is missing', { barIndex, takeId: take.takeId, fileId: take.fileId })
      return
    }
    const request = ++takePlaybackRequestRef.current
    const syncGeneration = syncGenerationRef.current
    try {
      const ctx = await audioEngine.ensureContext()
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      decodedTakeCache.current.set(take.takeId, buffer)
      if (request !== takePlaybackRequestRef.current || syncGeneration !== syncGenerationRef.current || !isPlayingRef.current || recordingActiveRef.current) return
      const bar = project.bars[barIndex]
      const position = currentPositionSec ?? (bar?.startSec ?? 0)
      const targetStart = (bar?.startSec ?? 0) + syncSec
      const adjustedOffset = Math.max(0, position - targetStart + offsetSec)
      const playbackDelay = Math.max(0, targetStart - position)
      if (adjustedOffset >= buffer.duration) return
      console.log('[Punchin] scheduling selected take playback', {
        barIndex,
        takeId: take.takeId,
        syncSec,
        position,
        adjustedOffset,
        playbackDelay,
      })
      audioEngine.playTake(buffer, adjustedOffset, take.gain, playbackDelay)
    } catch (err) {
      console.error('selected take playback failed', err)
    }
  }

  // Changing a bar's take mid-playback must change what is heard on the current pass rather
  // than at the next loop wrap, so retarget the live vocal source right away.
  const applyLiveTakeChange = (barIndex: number, takeId?: string) => {
    audioEngine.cancelChainedForBar(barIndex)
    chainedThroughBarRef.current = -1
    if (!isPlayingRef.current || recordingActiveRef.current) return
    const bar = project.bars[barIndex]
    const position = audioEngine.currentTime
    if (!bar || position < bar.startSec || position >= bar.endSec) return
    if (!takeId) {
      audioEngine.stopTake(0.008)
      return
    }
    const take = project.takes.find((item) => item.takeId === takeId)
    if (take) void playSelectedTake(barIndex, 0, vocalSyncMsRef.current / 1000, position, take)
  }

  const handleSelectTake = (barIndex: number, takeId: string) => {
    selectTake(barIndex, takeId)
    applyLiveTakeChange(barIndex, takeId)
  }

  // Second click on an already-selected slot: solo the take on its own so it can be judged
  // in isolation, without touching the beat transport or the bar's grid selection.
  const handleAuditionTake = async (takeId: string) => {
    const take = project.takes.find((item) => item.takeId === takeId)
    if (!take) return
    let buffer = decodedTakeCache.current.get(takeId)
    if (!buffer) {
      const blob = blobCache.current.get(take.fileId)
      if (!blob) return
      try {
        const ctx = await audioEngine.ensureContext()
        buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
        decodedTakeCache.current.set(takeId, buffer)
      } catch (err) {
        console.error('take audition decode failed', err)
        return
      }
    }
    if (auditionTimer.current) window.clearTimeout(auditionTimer.current)
    audioEngine.playTakeFromStart(buffer, take.gain)
    setAuditioningTakeId(takeId)
    auditionTimer.current = window.setTimeout(() => {
      auditionTimer.current = null
      setAuditioningTakeId(undefined)
    }, buffer.duration * 1000)
  }

  const handleSelectNoTake = (barIndex: number) => {
    clearTakeSelection(barIndex)
    applyLiveTakeChange(barIndex, undefined)
  }

  // Purges a deleted take's audio for good. Deferred until the undo window closes so an
  // undo can restore the take from the still-warm caches instead of re-reading storage.
  const purgeTake = (take: Take) => {
    decodedTakeCache.current.delete(take.takeId)
    blobCache.current.delete(take.fileId)
    void deleteBlob(take.fileId)
  }

  const handleDeleteTake = (takeId: string) => {
    const index = project.takes.findIndex((item) => item.takeId === takeId)
    const target = project.takes[index]
    if (!target || target.locked) return
    deleteTake(takeId)
    if (undoTimer.current) {
      window.clearTimeout(undoTimer.current)
      if (pendingUndoRef.current) purgeTake(pendingUndoRef.current.take)
    }
    pendingUndoRef.current = { take: target, index }
    setUndoToast({ take: target, index })
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null
      pendingUndoRef.current = null
      purgeTake(target)
      setUndoToast(null)
    }, 5000)
    // A remaining take may have been auto-selected in its place, so resolve what should
    // now be audible for this bar instead of assuming silence.
    const replacement = project.takes.find((item) => item.barIndex === target.barIndex && item.takeId !== takeId)
    if (target.selected) applyLiveTakeChange(target.barIndex, replacement?.takeId)
    else audioEngine.cancelChainedForBar(target.barIndex)
  }

  const handleUndoDelete = () => {
    const pending = pendingUndoRef.current
    if (!pending) return
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = null
    pendingUndoRef.current = null
    restoreTake(pending.take, pending.index)
    setUndoToast(null)
    if (pending.take.selected) applyLiveTakeChange(pending.take.barIndex, pending.take.takeId)
  }

  const handleDeleteAllTakes = () => {
    if (!project.takes.length) return
    const lockedCount = project.takes.filter((take) => take.locked).length
    const message = lockedCount > 0
      ? `Delete all unlocked takes across every bar? ${lockedCount} locked take(s) will be kept.`
      : 'Delete ALL takes across every bar? This cannot be undone.'
    if (!window.confirm(message)) return
    const { deletedFileIds } = deleteAllTakes()
    audioEngine.stopTake()
    for (const fileId of deletedFileIds) {
      blobCache.current.delete(fileId)
      void deleteBlob(fileId)
    }
    decodedTakeCache.current.clear()
    setStatus('Deleted all takes.')
  }

  const updateGlobalSync = (value: number) => {
    const syncMs = Math.max(-10000, Math.min(10000, Math.round(value)))
    vocalSyncMsRef.current = syncMs
    setLatencyOffset(syncMs)
    // Re-evaluate the current bar immediately and use the new value on the
    // next bar entry without restarting the beat transport.
    syncGenerationRef.current += 1
    lastTakeBarRef.current = null
    // Any bars already pre-scheduled used the old sync value — invalidate them so the
    // next bar entry falls back to the reactive path and re-chains with the new one.
    chainedThroughBarRef.current = -1
    if (isPlayingRef.current && !recordingActiveRef.current) {
      const raw = audioEngine.currentTime
      const barIndex = project.bars.findIndex((bar) => raw >= bar.startSec && raw < bar.endSec)
      if (barIndex >= 0) {
        console.log('[Punchin] live vocal sync changed', { syncMs, barIndex, position: raw })
        void playSelectedTake(barIndex, 0, syncMs / 1000, raw)
      }
    }
  }

  const stopRecordingFlow = async () => {
    const wasRecording = recordingActiveRef.current
    clearTimers()
    recordingPendingRef.current = true
    recordingActiveRef.current = false
    setRecording(false)
    if (!wasRecording) {
      recordingPendingRef.current = false
      return
    }
    const recordingTarget = recordingTargetRef.current
    const targetBar = recordingTarget ? project.bars[recordingTarget.barIndex] : undefined
    // Recompute the bar's true end instant fresh, right now — correct whether this is the
    // scheduled on-time stop (already there) or an early manual stop (still in the future,
    // in which case stopRecording caps it at "now" itself).
    const trueEndAt = targetBar ? audioEngine.ctxTimeForPosition(targetBar.endSec) : undefined
    console.log('%c[FLOW] stopRecordingFlow', 'color:#fff;background:#084;padding:2px 6px', {
      target: recordingTarget,
      trueEndAt,
    })
    const buffer = await audioEngine.stopRecording(trueEndAt)
    if (!buffer) {
      recordingPendingRef.current = false
      recordingTargetRef.current = null
      console.warn('[Punchin] recording stopped without microphone samples', { target: recordingTarget })
      setStatus('No microphone audio was captured. Check the selected input and try again.')
      return
    }
    const blob = encodeWavFromAudioBuffer(buffer, true)
    const fileId = `take-${crypto.randomUUID()}`
      console.log('[Punchin] recording take encoded', { fileId, frames: buffer.length })
    blobCache.current.set(fileId, blob)
    void putBlob(fileId, blob)
    const targetSlot = recordingTarget?.slot
    if (!recordingTarget || targetSlot === undefined) {
      recordingPendingRef.current = false
      recordingTargetRef.current = null
      setStatus('Arm a red take slot before recording.')
      return
    }
    const saved = saveTake(recordingTarget.barIndex, targetSlot, fileId, 1)
    if (!saved.ok) {
      recordingPendingRef.current = false
      recordingTargetRef.current = null
      setStatus(saved.reason === 'locked' ? 'That take is locked. Choose another slot.' : 'Could not save this take.')
      return
    }
    console.log('[Punchin] take saved', { barIndex: recordingTarget.barIndex, slot: targetSlot, fileId, frames: buffer.length, durationSec: buffer.duration })
    consumeArmedTake(recordingTarget.barIndex)
    // Cache the decoded take so the unified bar-entry playback path can start it instantly.
    if (saved.take) decodedTakeCache.current.set(saved.take.takeId, buffer)
    recordingTargetRef.current = null
    recordingPendingRef.current = false
    setStatus(`Recorded Take ${targetSlot + 1} for Bar ${recordingTarget.barIndex + 1}.`)
  }

  const [timeEditValue, setTimeEditValue] = useState<string | null>(null)

  // Keep refs in sync every render
  playheadRef.current = playhead
  cursorRef.current = cursor

  // Plain function — no useCallback, no refs for position.
  // Reads playhead / cursor directly from React state each render.
  // The keyboard effect re-registers when these change — that's fine.
  function nudgePlayhead(deltaSec: number) {
    const current = isPlaying ? cursor : playhead
    console.log('[NUDGE]', { deltaSec, current, playhead, cursor, isPlaying })
    const next = Math.max(0, Math.min(totalDuration, current + deltaSec))
    handleSeek(next)
  }

  const commitTimeEdit = (raw: string) => {
    setTimeEditValue(null)
    const colonMatch = raw.match(/^(\d+):([0-5]?\d)(?:\.(\d{1,3}))?$/)
    let sec: number
    if (colonMatch) {
      sec = Number(colonMatch[1]) * 60 + Number(colonMatch[2]) + (colonMatch[3] ? Number(colonMatch[3].padEnd(3, '0')) / 1000 : 0)
    } else {
      sec = parseFloat(raw)
    }
    if (!isNaN(sec)) handleSeek(Math.max(0, Math.min(totalDuration, sec)))
  }

  // Visual position: cursor while playing, playhead when stopped
  const displayPos = isPlaying ? cursor : playhead

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      const key = e.key.toLowerCase()
      if (key === ' ') {
        e.preventDefault()
        if (isPlaying) handlePause()
        else handlePlay()
      }
      else if (key === 'n') setCurrentBar(currentBarIndex + 1)
      else if (key === 'p') setCurrentBar(currentBarIndex - 1)
      else if (key === 'arrowleft')  { e.preventDefault(); nudgePlayhead(e.shiftKey ? -0.01 : e.ctrlKey ? -5 : -1) }
      else if (key === 'arrowright') { e.preventDefault(); nudgePlayhead(e.shiftKey ?  0.01 : e.ctrlKey ?  5 :  1) }
      else if (/^[1-5]$/.test(key)) {
        const idx = Number(key) - 1
        const takes = project.takes.filter((t) => t.barIndex === currentBarIndex)
        const take = takes[idx]
        if (take) selectTake(currentBarIndex, take.takeId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentBarIndex, handlePause, handlePlay, isPlaying, playhead, cursor, totalDuration, handleSeek, project.takes, selectTake, setCurrentBar])

  const handleExport = async (vocalsOnly: boolean) => {
    if (!project.beat.durationSec) return
    setExporting(true)
    setExportProgress(0.05)
    try {
      const selectedTakes = project.takes.filter((t) => t.selected)
      const ctx = await audioEngine.ensureContext()
      const renderedTakes = await Promise.all(
        selectedTakes.map(async (take) => {
          const blob = blobCache.current.get(take.fileId)
          if (!blob) return null
          const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
          const bar = project.bars[take.barIndex]
          return bar ? { buffer: buf, startSec: bar.startSec, gain: take.gain, barIndex: take.barIndex } : null
        }),
      )
      const filtered = renderedTakes.filter(Boolean) as { buffer: AudioBuffer; startSec: number; gain: number; barIndex: number }[]
      const beatBlob = project.beat.fileId ? blobCache.current.get(project.beat.fileId) : undefined
      let beatBuffer: AudioBuffer | undefined
      if (beatBlob && !vocalsOnly) beatBuffer = await ctx.decodeAudioData(await beatBlob.arrayBuffer())
      setExportProgress(0.35)
      const wav = await renderOffline({ beatBuffer, takes: filtered, durationSec: project.beat.durationSec, mix: project.mix, vocalsOnly, vocalSyncMs: project.latencyOffsetMs })
      setExportProgress(1)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(wav)
      a.download = vocalsOnly ? 'punch-vocals.wav' : 'punch-mix.wav'
      a.click()
    } catch (err) {
      console.error(err)
      setStatus('Export failed. Check console for details.')
    } finally {
      setExporting(false)
      setExportProgress(0)
    }
  }

  return (
    <div className="app-layout">
      <div className="header-stack">
        <div className="top-nav">
        <div className="nav-scrub">
          <input
            type="range"
            min={0}
            max={Math.max(totalDuration, 0.01)}
            step={0.001}
            value={Math.min(displayPos, totalDuration)}
            onChange={(e) => handleScrub(Number(e.target.value))}
            disabled={!audioLoaded}
            title="Coarse scrub"
          />
          <div className="nav-waveform-stage">
            <HorizontalWaveformDetail
              key={waveformResetKey}
              audioBuffer={audioEngine.beatAudioBuffer ?? null}
              playhead={playhead}
              cursor={cursor}
              isPlaying={isPlaying}
              totalDuration={totalDuration}
              bars={project.bars}
              currentBarIndex={currentBarIndex}
              loopEnabled={loopEnabled}
              loopRange={loopRange}
              onLoopRangeChange={handleLoopChange}
              onSeek={handleSeek}
            />
            <div className="waveform-time-overlay">
              {timeEditValue !== null ? (
                <input
                  autoFocus
                  className="nav-time-edit"
                  value={timeEditValue}
                  onChange={(e) => setTimeEditValue(e.target.value)}
                  onBlur={(e) => commitTimeEdit(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTimeEdit((e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setTimeEditValue(null)
                  }}
                />
              ) : (
                <span
                  className="nav-time-display"
                  title="Click to type a time"
                  onClick={() => audioLoaded && setTimeEditValue(formatTime(displayPos))}
                  style={{ cursor: audioLoaded ? 'text' : 'default' }}
                >
                  {formatTime(displayPos)} / {formatTime(totalDuration)}
                </span>
              )}
            </div>
          </div>
        </div>
        </div>

        <div className="playback-controls-panel">
        <div className="playback-play-group">
          <button className="playback-back-button" onClick={() => handleSeek(0)} disabled={!audioLoaded || isRecording} title="Back to start (00:00)">⏮</button>
          <button className="playback-wide-button" onClick={isPlaying ? handlePause : handlePlay} disabled={!audioLoaded} title={isPlaying ? 'Pause — keeps position [Space]' : 'Play from current position [Space]'}>
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
        </div>
        <button
          className={loopEnabled ? 'playback-wide-button loop-toggle-on' : 'secondary playback-wide-button'}
          onClick={() => setLoopEnabled(!loopEnabled)}
          disabled={!audioLoaded}
          title={loopEnabled ? 'Loop is on — click to turn off' : 'Loop is off — click to turn on'}
        >
          {`\u21bb ${loopEnabled ? 'Loop Off' : 'Loop On'}`}{loopRange ? ` \u00b7 Bar ${loopRange.start + 1}-${loopRange.end + 1}` : ''}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!loopRange}
          onClick={() => document.getElementById(`bar-row-${loopRange?.start ?? 0}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >
          Show Loop
        </button>
        <label className="loop-range-select">
          <span>Loop Start</span>
          <select
            value={loopRange?.start ?? ''}
            disabled={!project.bars.length}
            onChange={(event) => handleLoopStartChange(Number(event.target.value))}
          >
            {project.bars.map((bar) => <option key={bar.index} value={bar.index}>Bar {bar.index + 1}</option>)}
          </select>
        </label>
        <label className="loop-range-select">
          <span>Loop End</span>
          <select
            value={loopRange?.end ?? ''}
            disabled={!project.bars.length}
            onChange={(event) => handleLoopEndChange(Number(event.target.value))}
          >
            {project.bars.map((bar) => <option key={bar.index} value={bar.index}>Bar {bar.index + 1}</option>)}
          </select>
        </label>
        </div>

        <Mixer
          mix={project.mix}
          onMasterGain={(v) => updateMix({ masterBeatGain: v })}
          onGlobalVocalGain={(v) => {
            audioEngine.setMasterVocalGain(v)
            updateMix({ globalVocalGain: v })
          }}
          isVocalMuted={isVocalMuted}
          onToggleVocalMute={() => {
            const nextMuted = !isVocalMuted
            audioEngine.setMasterVocalMuted(nextMuted)
            setVocalMuted(nextMuted)
          }}
          monitorEnabled={monitorEnabled}
          monitorGain={monitorGain}
          takesCount={project.takes.length}
          onDeleteAllTakes={handleDeleteAllTakes}
          onToggleMonitor={() => {
            if (monitorEnabled) {
              audioEngine.setMonitorGain(0)
              setMonitorEnabled(false)
              return
            }
            audioEngine
              .startMicMonitor(monitorGain)
              .then(() => {
                audioEngine.setMonitorGain(monitorGain)
                setMonitorEnabled(true)
              })
              .catch((err) => setStatus(`Mic permission failed: ${String(err)}`))
          }}
          onMonitorGain={(v) => {
            setMonitorGain(v)
            audioEngine.setMonitorGain(v)
          }}
        />
      </div>

      <div className="app-main">
        <div className="shell">
          <div className="app-title-block">
            <h2 className="app-title">PUNCHLINE</h2>
            <div className="app-title-credit">
              brought to you by{' '}
              <a href="https://boxbap.com" target="_blank" rel="noopener noreferrer">BOXBAP</a>
            </div>
          </div>

          {showBrowserWarning && (
            <div className="browser-warning">
              <span>
                Recording is unreliable in Firefox (a confirmed Firefox audio-input issue can silently
                drop parts of a take). Please use Chrome, Edge, or another Chromium-based browser.
              </span>
              <button type="button" className="secondary" onClick={() => setShowBrowserWarning(false)}>
                Dismiss
              </button>
            </div>
          )}

          <section className={`setup-stack ${showSetup ? '' : 'setup-stack-collapsed'}`}>
          <div className="setup-stack-header">
            <span className="collapsible-title">SETUP</span>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowSetup((visible) => !visible)}
            >
              {showSetup ? 'Hide Setup' : 'Show Setup'}
            </button>
          </div>
          {showSetup && <>
          <section className="panel beat-setup-panel">
            <div className="beat-setup-header">
              <span className="collapsible-title">BEAT SETUP</span>
              <button
                className="bwe-help collapsible-corner"
                type="button"
                aria-label="Explain Import Beat controls"
                title="Explain Import Beat controls"
                onClick={() => setShowImportHelp((visible) => !visible)}
              >
                ?
              </button>
            </div>
            {showImportHelp && (
              <div className="bwe-help-text">
                <strong>File:</strong> upload a WAV or MP3 under 10 minutes long.<br />
                <strong>BPM:</strong> is available in the top transport bar. Auto-detect bars estimates it automatically, or you can set an exact value there.<br />
                <strong>Offset:</strong> sets where Bar 1 begins, in seconds from the start of the file.<br />
                <strong>Set Bar 1 here:</strong> sets the offset to the current play position instead of typing a number.
              </div>
            )}
            <div className="controls">
              <input type="file" accept="audio/wav,audio/mp3,audio/mpeg" onChange={(e) => handleFile(e.target.files?.[0])} />
              {detectBusy && <span className="text-muted">Detecting BPM\u2026</span>}
              <button
                className="detect-bars-button"
                onClick={handleAutoDetectBars}
                disabled={detectBusy || !audioEngine.beatAudioBuffer}
              >
                {detectBusy ? 'Detecting\u2026' : 'Auto-detect bars'}
              </button>
              <div className="transport-bpm" onClick={(event) => event.stopPropagation()}>
                <span>BPM</span>
                <input
                  type="number"
                  value={bpmInput}
                  onChange={(event) => handleBpmInput(event.target.value)}
                  onBlur={commitBpmInput}
                  min={30}
                  max={300}
                  step={0.1}
                  aria-label="Global BPM"
                />
                <button type="button" className="secondary" title="Halve BPM" onClick={() => applyBpm(project.beat.bpm / 2)}>/2</button>
                <button type="button" className="secondary" title="Double BPM" onClick={() => applyBpm(project.beat.bpm * 2)}>x2</button>
                <button type="button" className="secondary" title="Decrease BPM by 1" onClick={() => applyBpm(project.beat.bpm - 1)}>−1</button>
                <button type="button" className="secondary" title="Decrease BPM by 0.1" onClick={() => applyBpm(project.beat.bpm - 0.1)}>−0.1</button>
                <button type="button" className="secondary" title="Increase BPM by 0.1" onClick={() => applyBpm(project.beat.bpm + 0.1)}>+0.1</button>
                <button type="button" className="secondary" title="Increase BPM by 1" onClick={() => applyBpm(project.beat.bpm + 1)}>+1</button>
                <button type="button" className="secondary" title="Tap repeatedly to set BPM" onClick={handleTapTempo}>Tap</button>
              </div>
              <label className="flex-gap">
                Offset
                <input
                  type="number"
                  value={(project.beat.offsetSec ?? 0).toFixed(3)}
                  step={0.001}
                  min={0}
                  max={10}
                  style={{ width: 90 }}
                  onChange={(e) => applyOffset(Number(e.target.value) || 0)}
                />
              </label>
              <button
                title="Set Bar 1 to the current audio position"
                disabled={!audioLoaded}
                onClick={() => {
                  const position = isPlaying ? cursor : playhead
                  setBar1Anchor(position)
                  setStatus(`Bar 1 set to ${position.toFixed(3)}s. Click Auto-detect bars when ready.`)
                }}
              >
                Set Bar 1
              </button>
            </div>
          <div className="beat-setup-anchor">
            {audioEngine.beatAudioBuffer && (
              <BarWaveformEditor
                audioBuffer={audioEngine.beatAudioBuffer}
                barStartSec={project.beat.bar1AnchorTime ?? project.bars[0]?.startSec ?? project.beat.offsetSec ?? 0}
                barEndSec={project.bars[0]?.endSec ?? Math.min(project.beat.durationSec, (project.beat.bar1AnchorTime ?? project.beat.offsetSec ?? 0) + 4)}
                prevBarEnd={0}
                nextBarStart={project.beat.durationSec}
                playhead={displayPos}
                isPlaying={isPlaying}
                getPlaybackTime={() => audioEngine.currentTime}
                anchorOnly
                onEdgeChange={(startSec) => setBar1Anchor(startSec)}
              />
            )}
            {!audioEngine.beatAudioBuffer && (
              <span className="text-muted">Load a beat to align Bar 1.</span>
            )}
          </div>
          <div className="beat-setup-sync">
              <div className="controls playback-sync-controls">
                <label className="flex-gap">
                  Shift vocals
                  <input
                    type="range"
                    min={-10000}
                    max={10000}
                    step={10}
                    value={project.latencyOffsetMs}
                    onChange={(e) => updateGlobalSync(Number(e.target.value))}
                  />
                  <span className="text-muted">{project.latencyOffsetMs > 0 ? '+' : ''}{project.latencyOffsetMs} ms</span>
                </label>
                <label className="flex-gap">
                  Exact ms
                  <input
                    type="number"
                    min={-10000}
                    max={10000}
                    step={1}
                    value={project.latencyOffsetMs}
                    onChange={(e) => updateGlobalSync(Number(e.target.value) || 0)}
                    style={{ width: 86 }}
                  />
                </label>
                <div className="playback-sync-buttons">
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 1)} title="Shift vocals 1 millisecond earlier"><span className="sync-arrow sync-arrow-left sync-arrow-1" aria-hidden="true"><i /></span><span>1 MS</span></button>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 10)} title="Shift vocals 10 milliseconds earlier"><span className="sync-arrow sync-arrow-left sync-arrow-2" aria-hidden="true"><i /><i /></span><span>10 MS</span></button>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 100)} title="Shift vocals 100 milliseconds earlier"><span className="sync-arrow sync-arrow-left sync-arrow-3" aria-hidden="true"><i /><i /><i /></span><span>100 MS</span></button>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 1000)} title="Shift vocals 1 second earlier"><span className="sync-arrow sync-arrow-left sync-arrow-4" aria-hidden="true"><i /><i /><i /><i /></span><span>1 SEC</span></button>
                  <span className="playback-sync-divider" aria-hidden="true">|</span>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 1000)} title="Shift vocals 1 second later"><span>1 SEC</span><span className="sync-arrow sync-arrow-right sync-arrow-4" aria-hidden="true"><i /><i /><i /><i /></span></button>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 100)} title="Shift vocals 100 milliseconds later"><span>100 MS</span><span className="sync-arrow sync-arrow-right sync-arrow-3" aria-hidden="true"><i /><i /><i /></span></button>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 10)} title="Shift vocals 10 milliseconds later"><span>10 MS</span><span className="sync-arrow sync-arrow-right sync-arrow-2" aria-hidden="true"><i /><i /></span></button>
                  <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 1)} title="Shift vocals 1 millisecond later"><span>1 MS</span><span className="sync-arrow sync-arrow-right sync-arrow-1" aria-hidden="true"><i /></span></button>
                </div>
                <button className="secondary playback-sync-reset" onClick={() => updateGlobalSync(0)}>Reset</button>
              </div>
          </div>
          </section>
          </>}
          </section>

          <BarList
            bars={project.bars}
            audioBuffer={audioEngine.beatAudioBuffer}
            playhead={displayPos}
            loopRange={loopRange}
            currentBarIndex={currentBarIndex}
            isRecording={isRecording}
            takes={project.takes}
            armedTakeByBar={armedTakeByBar}
            activeBarPlayback={activeBarPlayback}
            auditioningTakeId={auditioningTakeId}
            onPlayFromBar={handlePlayFromBar}
            onLoopBar={handleLoopBar}
            onStopBar={handleStop}
            onArmTake={(barIndex, slot) => {
              setCurrentBar(barIndex)
              armTake(barIndex, slot)
              // Load and connect the mic capture worklet now instead of lazily on first
              // recording — that first-time connection isn't instant, and starting it here
              // gives it the lead time to be ready before the transport reaches this bar,
              // instead of truncating the very first take while it's still connecting.
              void audioEngine.ensureMicCapture()
              if (isPlayingRef.current) {
                // That bar will now record instead of play back — cancel any already
                // pre-scheduled take for it so the stale audio doesn't sound underneath
                // the recording. Other bars in the chain are untouched.
                audioEngine.cancelChainedForBar(barIndex)
                if (chainedThroughBarRef.current >= barIndex) chainedThroughBarRef.current = barIndex - 1
                const position = audioEngine.currentTime
                const bar = project.bars[barIndex]
                if (bar && position >= bar.startSec && position < bar.endSec) {
                  // Wait for the next loop entry instead of starting mid-bar.
                  lastPlayingBarRef.current = barIndex
                  previousAudioTimeRef.current = position
                  console.log('[Punchin] take armed during active bar; waiting for next entry', { barIndex, position })
                }
              }
              setStatus(`Take ${slot + 1} armed for Bar ${barIndex + 1}. Press Play or Loop on that bar to record.`)
            }}
            onDisarmTake={disarmTake}
            onSelectTake={handleSelectTake}
            onAuditionTake={handleAuditionTake}
            onSelectNoTake={handleSelectNoTake}
            onDeleteTake={handleDeleteTake}
            onToggleTakeLock={toggleTakeLock}
            onFocusBar={setCurrentBar}
            onTakeGain={setTakeGain}
          />

          <ExportDialog
            onExportMix={() => handleExport(false)}
            onExportVocals={() => handleExport(true)}
            progress={exportProgress}
            isRendering={exporting}
            disabled={!project.beat.durationSec}
          />
        </div>
      </div>

      {undoToast && (
        <div className="undo-toast" role="status">
          <span>Take deleted</span>
          <button type="button" className="undo-toast-action" onClick={handleUndoDelete}>Undo</button>
        </div>
      )}
    </div>
  )
}
