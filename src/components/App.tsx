import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HorizontalWaveformDetail } from './HorizontalWaveformDetail'
import { Mixer } from './Mixer'
import { ExportDialog } from './ExportDialog'
import { BarList } from './BarList'
import { CalibrationDialog } from './CalibrationDialog'
import { useStore } from '../state/store'
import { generateBars, updateBarPosition } from '../analysis/bpmGrid'
import { estimateBpmFromBuffer } from '../analysis/onsetEstimate'
import { formatTime } from '../utils/time'
import { audioEngine } from '../audio/audioEngine'
import { renderOffline } from '../audio/offlineRender'
import { encodeWavFromAudioBuffer } from '../audio/wav'
import { getBlob, listProjects, putBlob, saveProject } from '../data/storage'
import type { Take } from '../data/models'

const DEFAULT_LOOP_END_INDEX = 15
const CALIBRATION_STORAGE_KEY = 'punchin-audio-calibration-v2'

export default function App() {
  const {
    project,
    currentBarIndex,
    isRecording,
    armedTakeByBar,
    audioUrl,
    setBeatMeta,
    setBars,
    setAudioUrl,
    setBeatFile,
    setCurrentBar,
    setRecording,
    setLatencyOffset,
    armTake,
    disarmTake,
    consumeArmedTake,
    saveTake,
    selectTake,
    clearTakeSelection,
    deleteTake,
    toggleTakeLock,
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
  const [showImportHelp, setShowImportHelp] = useState(false)
  const [loopRange, setLoopRange] = useState<{ start: number; end: number } | undefined>(undefined)
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [waveformResetKey, setWaveformResetKey] = useState(0)
  const [activeBarPlayback, setActiveBarPlayback] = useState<{ barIndex: number; mode: 'play' | 'loop' } | undefined>(undefined)
    const [calibrationOpen, setCalibrationOpen] = useState(false)
    const [calibrationBusy, setCalibrationBusy] = useState(false)
    const [calibrationError, setCalibrationError] = useState<string | undefined>()
    const [calibrationManual, setCalibrationManual] = useState(false)
    const [calibrationHits, setCalibrationHits] = useState(0)
    const [calibrationLevel, setCalibrationLevel] = useState(0)
  const manualOffsetRef = useRef(false)

  const totalDuration = useMemo(
    () => project.beat.durationSec || project.bars[project.bars.length - 1]?.endSec || 0,
    [project.beat.durationSec, project.bars],
  )
  const audioLoaded = useMemo(() => Boolean(audioUrl && totalDuration > 0), [audioUrl, totalDuration])

  useEffect(() => {
    vocalSyncMsRef.current = project.latencyOffsetMs
  }, [project.latencyOffsetMs])

  const runCalibration = async (manualClap: boolean) => {
    setCalibrationBusy(true)
    setCalibrationError(undefined)
    setCalibrationManual(manualClap)
    setCalibrationHits(0)
    const meter = window.setInterval(() => setCalibrationLevel(audioEngine.microphoneLevel), 80)
    try {
      const correction = await audioEngine.calibrateMicrophone(manualClap, setCalibrationHits)
      setLatencyOffset(correction)
      localStorage.setItem(CALIBRATION_STORAGE_KEY, 'true')
      setCalibrationOpen(false)
      setStatus(`Audio setup complete. Timing correction applied.`)
    } catch (err) {
      console.error('calibration failed', err)
      setCalibrationError('Calibration could not detect enough clear hits. Try again in a quiet room.')
    } finally {
      window.clearInterval(meter)
      setCalibrationLevel(0)
      setCalibrationBusy(false)
    }
  }

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
      if (enteredBar) {
        lastPlayingBarRef.current = currentBarIndex
        const armed = armedTakeByBar[currentBarIndex]?.length ?? 0
        console.log('%c[ENTER BAR]', 'color:#fff;background:#333;padding:2px 6px', {
          ctxTime: raw.toFixed(3),
          barIndex: currentBarIndex,
          wrapped,
          armedSlots: armed,
          recordingActive: recordingActiveRef.current,
          recordingPending: recordingPendingRef.current,
          action: armed && !recordingActiveRef.current && !recordingPendingRef.current ? 'BEGIN-RECORD'
            : armed && (recordingActiveRef.current || recordingPendingRef.current) ? 'WAIT-RECORDING'
            : !recordingActiveRef.current && !recordingPendingRef.current ? 'PLAY-TAKE'
            : 'none',
        })
        if (armedTakeByBar[currentBarIndex]?.length && !recordingActiveRef.current && !recordingPendingRef.current) {
          recordingPendingRef.current = true
          void beginAutomaticRecording(currentBarIndex)
        } else if (!recordingActiveRef.current && !recordingPendingRef.current) {
          // Non-armed bar: restart its selected take from the very beginning on every
          // entry, including loop wraps. One source, constant gain, no offset — so each
          // loop pass plays the whole take from "1" instead of only the tail.
          void playSelectedTakeFromStart(currentBarIndex)
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
      return
    }
    audioEngine.setLoop(undefined, undefined)
  }, [loopEnabled, loopRange, project.bars])

  useEffect(() => {
    audioEngine.setMasterBeatGain(project.mix.masterBeatGain)
  }, [project.mix.masterBeatGain])

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
      setBeatMeta({ fileId, durationSec: meta.durationSec, bpm: project.beat.bpm, timeSig: project.beat.timeSig, offsetSec: 0 })
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
    setDetectBusy(true)
    const detected = await estimateBpmFromBuffer(buf)
    setDetectBusy(false)
    if (!detected) { setStatus('BPM detection failed. Try adjusting manually.'); return }
    const bpm = Math.round(detected.bpm)
    const offsetSec = manualOffsetRef.current ? (project.beat.offsetSec ?? 0) : detected.offsetSec
    setBeatMeta({ ...project.beat, bpm, offsetSec })
    setBars(generateBars(project.beat.durationSec, bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, offsetSec))
    setStatus(`Auto-detected bars at ${bpm} BPM, offset ${offsetSec.toFixed(3)}s (${Math.round(detected.confidence * 100)}% confidence).`)
  }

  const applyBpm = (bpm: number) => {
    const clamped = Math.max(40, Math.min(240, Math.round(bpm * 2) / 2))
    setBeatMeta({ ...project.beat, bpm: clamped })
    if (project.beat.durationSec && project.bars.length) {
      setBars(generateBars(project.beat.durationSec, clamped, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, project.beat.offsetSec ?? 0))
    }
  }

  const handleBarUpdate = useCallback(
    (index: number, start: number, end: number, allowGaps: boolean) => {
      setBars(updateBarPosition(project.bars, index, start, end, allowGaps))
    },
    [project.bars, setBars],
  )

  useEffect(() => {
    if (!project.bars.length) { setLoopRange(undefined); return }
    setLoopRange((prev) => {
      if (!prev) return { start: 0, end: Math.min(DEFAULT_LOOP_END_INDEX, project.bars.length - 1) }
      const start = Math.min(prev.start, project.bars.length - 1)
      const end = Math.min(Math.max(prev.end, start), project.bars.length - 1)
      return { start, end }
    })
  }, [project.bars.length])

  const handleSeek = useCallback(
    (time: number) => {
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
    setBeatMeta({ ...project.beat, offsetSec: clamped })
    if (project.beat.durationSec && project.bars.length) {
      setBars(generateBars(project.beat.durationSec, project.beat.bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, clamped))
    }
  }, [project.beat, setBeatMeta, setBars, totalDuration])

  const handlePlay = useCallback(() => {
    if (!audioLoaded) return
    console.log('[Punchin] top-level Play clicked', { contextState: audioEngine.contextState, position: playhead, isPlaying: isPlayingRef.current })
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
    setWaveformResetKey((key) => key + 1)
    setActiveBarPlayback(undefined)
  }, [audioLoaded])

  const handleLoopChange = (start: number, end: number) => {
    if (!project.bars.length) return
    const clampedStart = Math.max(0, Math.min(start, project.bars.length - 1))
    const clampedEnd = Math.max(clampedStart, Math.min(end, project.bars.length - 1))
    setLoopRange({ start: clampedStart, end: clampedEnd })
  }

  const handleScrub = (value: number) => {
    if (!audioLoaded || !totalDuration) return
    const clamped = Math.min(Math.max(value, 0), totalDuration)
    if (loopRange && (clamped < project.bars[loopRange.start]?.startSec || clamped > project.bars[loopRange.end]?.endSec)) {
      setLoopRange({ start: 0, end: Math.min(DEFAULT_LOOP_END_INDEX, project.bars.length - 1) })
    }
    handleSeek(clamped)
  }

  const handlePlayFromBar = (barIndex: number) => {
    if (!audioLoaded) return
    const bar = project.bars[barIndex]
    if (!bar) return
      console.log('[Punchin] bar Play clicked', { barIndex, armedSlots: armedTakeByBar[barIndex] ?? [] })
      setStatus(armedTakeByBar[barIndex]?.length ? `Preparing recording for Bar ${barIndex + 1}...` : `Playing Bar ${barIndex + 1}.`)
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
      const duration = Math.max(0.01, bar.endSec - bar.startSec)
      console.log('%c[FLOW] beginAutomaticRecording', 'color:#fff;background:#a60;padding:2px 6px', {
        barIndex, armedSlot, barStartSec: bar.startSec.toFixed(3), barEndSec: bar.endSec.toFixed(3),
        durationSec: duration.toFixed(3), playbackPos: audioEngine.currentTime.toFixed(3),
      })
      await audioEngine.startRecording(project.latencyOffsetMs, bar.startSec)
      recordingActiveRef.current = true
      recordingPendingRef.current = false
      setRecording(true)
      setStatus(`Recording Take ${armedSlot + 1} for Bar ${barIndex + 1}.`)
      recordTimer.current = window.setTimeout(() => {
        console.log('%c[FLOW] recordTimer fired → stopRecordingFlow', 'color:#a60', { barIndex, afterMs: Math.round(duration * 1000) })
        void stopRecordingFlow()
      }, duration * 1000)
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

  async function playSelectedTakeFromStart(barIndex: number) {
    const take = project.takes.find((item) => item.barIndex === barIndex && item.selected)
    if (!take) {
      console.log('%c[PLAY] no selected take', 'color:#888', { barIndex })
      audioEngine.stopTake()
      return
    }
    const perBar = project.mix.barGains?.[barIndex] ?? 1
    const gainValue = take.gain * project.mix.globalVocalGain * perBar
    const syncSec = vocalSyncMsRef.current / 1000
    const offsetSec = Math.max(0, -syncSec)
    const delaySec = Math.max(0, syncSec)
    const cached = decodedTakeCache.current.get(take.takeId)
    if (cached) {
      logBufferRegions('PLAY from-cache', barIndex, take.takeId, cached)
      audioEngine.playTake(cached, offsetSec, gainValue, delaySec)
      return
    }
    const blob = blobCache.current.get(take.fileId)
    if (!blob) return
    try {
      const ctx = await audioEngine.ensureContext()
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer())
      decodedTakeCache.current.set(take.takeId, buffer)
      if (!isPlayingRef.current || recordingActiveRef.current) return
      logBufferRegions('PLAY from-decode', barIndex, take.takeId, buffer)
      audioEngine.playTake(buffer, offsetSec, gainValue, delaySec)
    } catch (err) {
      console.error('take playback failed', err)
    }
  }

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
      const perBar = project.mix.barGains?.[barIndex] ?? 1
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
      audioEngine.playTake(buffer, adjustedOffset, take.gain * project.mix.globalVocalGain * perBar, playbackDelay)
    } catch (err) {
      console.error('selected take playback failed', err)
    }
  }

  async function listenToTake(barIndex: number, takeId: string) {
    const take = project.takes.find((item) => item.barIndex === barIndex && item.takeId === takeId)
    if (!take) return
    const blob = blobCache.current.get(take.fileId)
    if (!blob) {
      setStatus('This take audio is unavailable.')
      return
    }
    try {
      const ctx = await audioEngine.ensureContext()
      const buffer = decodedTakeCache.current.get(take.takeId) ?? await ctx.decodeAudioData(await blob.arrayBuffer())
      decodedTakeCache.current.set(take.takeId, buffer)
      logBufferRegions('LISTEN button', barIndex, take.takeId, buffer)
      audioEngine.playTake(buffer, 0, take.gain * project.mix.globalVocalGain * (project.mix.barGains?.[barIndex] ?? 1))
      setStatus(`Listening to Take ${project.takes.filter((item) => item.barIndex === barIndex).findIndex((item) => item.takeId === takeId) + 1} for Bar ${barIndex + 1}.`)
    } catch (err) {
      console.error('direct take listen failed', err)
      setStatus('This take could not be decoded for playback.')
    }
  }

  const updateGlobalSync = (value: number) => {
    const syncMs = Math.max(-10000, Math.min(10000, Math.round(value)))
    vocalSyncMsRef.current = syncMs
    setLatencyOffset(syncMs)
    // Re-evaluate the current bar immediately and use the new value on the
    // next bar entry without restarting the beat transport.
    syncGenerationRef.current += 1
    lastTakeBarRef.current = null
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
    console.log('%c[FLOW] stopRecordingFlow', 'color:#fff;background:#084;padding:2px 6px', {
      target: recordingTarget,
      trimToSec: targetBar ? (targetBar.endSec - targetBar.startSec).toFixed(3) : undefined,
    })
    const buffer = await audioEngine.stopRecording(
      project.latencyOffsetMs,
      targetBar ? targetBar.endSec - targetBar.startSec : undefined,
    )
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

      <div className="app-main">
        <div className="shell">
          <div className="section-title">
            <h2 style={{ margin: 0 }}>Bar-by-Bar Punch Recorder</h2>
          </div>

          <div className="panel">
            <div className="section-title">
              <h3>Import Beat</h3>
              <button
                className="bwe-help"
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
                <strong>BPM:</strong> becomes available after the audio loads. Auto-detect bars estimates it automatically, or you can type an exact value, then use ÷2 / ×2 to correct octave errors.<br />
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
              <label className="flex-gap">
                BPM
                <input
                  type="number"
                  value={project.beat.bpm}
                  onChange={(e) => applyBpm(Number(e.target.value) || 0)}
                  min={40}
                  max={240}
                  style={{ width: 72 }}
                />
                <button className="secondary" style={{ padding: '4px 8px', fontSize: 13 }} title="Halve BPM" onClick={() => applyBpm(project.beat.bpm / 2)}>÷2</button>
                <button className="secondary" style={{ padding: '4px 8px', fontSize: 13 }} title="Double BPM" onClick={() => applyBpm(project.beat.bpm * 2)}>×2</button>
              </label>
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
                  applyOffset(position)
                  setStatus(`Bar 1 set to ${position.toFixed(3)}s. Click Auto-detect bars when ready.`)
                }}
              >
                Set Bar 1
              </button>
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
              {loopRange ? `\u21bb Bar ${loopRange.start + 1}-${loopRange.end + 1}` : '\u21bb Loop'}
            </button>
          </div>

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
            onPlayFromBar={handlePlayFromBar}
            onLoopBar={handleLoopBar}
            onStopBar={handleStop}
            onArmTake={(barIndex, slot) => {
              setCurrentBar(barIndex)
              armTake(barIndex, slot)
              if (isPlayingRef.current) {
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
            onSelectTake={selectTake}
            onListenTake={listenToTake}
            onSelectNoTake={clearTakeSelection}
            onDeleteTake={deleteTake}
            onToggleTakeLock={toggleTakeLock}
            onFocusBar={setCurrentBar}
            onEdgeChange={handleBarUpdate}
            onLoopChange={handleLoopChange}
          />

          <div className="row">
            <div className="panel">
              <div className="section-title">
                <h3>Recording sync</h3>
                <span className="tag">global</span>
              </div>
              <div className="controls">
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
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 1000)} title="Shift vocals 1 second earlier">-1 sec</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 1000)} title="Shift vocals 1 second later">+1 sec</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 100)} title="Shift vocals 100 milliseconds earlier">-100 ms</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 100)} title="Shift vocals 100 milliseconds later">+100 ms</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 10)} title="Shift vocals 10 milliseconds earlier">-10 ms</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 10)} title="Shift vocals 10 milliseconds later">+10 ms</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs - 1)} title="Shift vocals 1 millisecond earlier">-1 ms</button>
                <button className="secondary" onClick={() => updateGlobalSync(project.latencyOffsetMs + 1)} title="Shift vocals 1 millisecond later">+1 ms</button>
                <button className="secondary" onClick={() => updateGlobalSync(0)}>Reset</button>
                <button
                  className={monitorEnabled ? 'secondary' : ''}
                  onClick={() => {
                    audioEngine
                      .startMicMonitor(monitorGain)
                      .then(() => setMonitorEnabled(true))
                      .catch((err) => setStatus(`Mic permission failed: ${String(err)}`))
                  }}
                >
                  {monitorEnabled ? 'Monitoring On' : 'Enable Monitor'}
                </button>
                <label className="flex-gap">
                  Monitor gain
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.01}
                    value={monitorGain}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setMonitorGain(v)
                      audioEngine.setMonitorGain(v)
                    }}
                  />
                  <span className="text-muted">{monitorGain.toFixed(2)}</span>
                </label>
                <button className="secondary" onClick={() => { setCalibrationError(undefined); setCalibrationOpen(true) }}>
                  Calibrate audio
                </button>
              </div>
            </div>
            <Mixer
              mix={project.mix}
              currentBarIndex={currentBarIndex}
              onMasterGain={(v) => updateMix({ masterBeatGain: v })}
              onGlobalVocalGain={(v) => updateMix({ globalVocalGain: v })}
              onBarGain={(barIdx, v) =>
                updateMix({ barGains: { ...project.mix.barGains, [barIdx]: v } })
              }
            />
          </div>

          <ExportDialog
            onExportMix={() => handleExport(false)}
            onExportVocals={() => handleExport(true)}
            progress={exportProgress}
            isRendering={exporting}
            disabled={!project.beat.durationSec}
          />
        </div>
      </div>
      <CalibrationDialog
        open={calibrationOpen}
        busy={calibrationBusy}
        error={calibrationError}
        manualClap={calibrationManual}
        detectedHits={calibrationHits}
        micLevel={calibrationLevel}
        onCalibrate={runCalibration}
        onClose={() => setCalibrationOpen(false)}
      />
    </div>
  )
}
