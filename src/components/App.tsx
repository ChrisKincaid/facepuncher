import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, SetStateAction } from 'react'
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
import type { BleedCancelPreset } from '../audio/audioEngine'
import { renderOffline } from '../audio/offlineRender'
import { encodeWavFromAudioBuffer } from '../audio/wav'
import { deleteBlob, getBlob, listProjects, putBlob, saveProject } from '../data/storage'
import { exportProjectToFist, importProjectFromFist } from '../utils/fistProjectService'
import { downloadFistPreset, fetchFistPresets } from '../utils/presetService'
import type { FistPreset } from '../utils/presetService'
import type { Take } from '../data/models'

const FALLBACK_LOOP_BARS = 16
// Android and iOS route an audio accept list to capture apps and the gallery; omitting it sends
// the picker straight to the file browser. Desktop keeps the filter.
const IS_MOBILE = /android|iphone|ipad|ipod/i.test(navigator.userAgent)
const AUDIO_ACCEPT = IS_MOBILE ? undefined : 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac'
const PROJECT_ACCEPT = IS_MOBILE ? undefined : '.fist,.zip,application/zip,application/octet-stream'
const UNDO_WINDOW_SEC = 6
const DETECT_BPM_MIN = 60
const DETECT_BPM_MAX = 180

type HelpTopic = 'volume' | 'project' | 'setup' | 'bars'

const HELP_CONTENT: Record<HelpTopic, { title: string; entries: { term: string; text: string }[] }> = {
  volume: {
    title: 'Volume',
    entries: [
      { term: 'Beat Vol', text: 'Level of the backing track in the mix. Lower it if the beat is burying your vocals.' },
      { term: 'Vocal Vol', text: 'Level of every recorded take together. Per-take volume lives on each bar row.' },
      { term: 'Mute', text: 'Silences that channel without changing its slider, so you can A/B quickly.' },
      { term: 'Mic Vol', text: 'Live monitoring — hear yourself while recording. Use headphones; on open speakers this will feed back.' },
    ],
  },
  project: {
    title: 'Import / Export',
    entries: [
      { term: 'Start with a Preset', text: 'Loads a ready-made session from the shared library, beat and bar grid included.' },
      { term: 'Use Your Own Beat', text: 'Choose an audio file (WAV, MP3, M4A) under 10 minutes to start a custom session.' },
      { term: 'Export Entire Project', text: 'Packs the beat, bar grid, and every take into one .fist file — your full backup.' },
      { term: 'Import Entire Project', text: 'Restores a .fist file exactly as it was saved, replacing the current session.' },
      { term: 'Export Vocals Only', text: 'Renders just your takes as a stem, for mixing elsewhere.' },
      { term: 'Export Vocals + Music Mix', text: 'Renders the finished song: beat and vocals together.' },
    ],
  },
  setup: {
    title: 'Beat Setup',
    entries: [
      { term: 'BPM', text: 'Type a tempo and press Enter, or use the ×2 / ÷2 and nudge buttons. Tap sets it by feel.' },
      { term: 'Auto BPM', text: 'Detects the tempo from the audio. It never moves your Bar 1 anchor.' },
      { term: 'Set Bar 1', text: 'Anchors the grid so Bar 1 starts at the current play position. Everything else follows from here.' },
      { term: 'Offset', text: 'The same anchor as a typed number, in seconds from the start of the file.' },
      { term: 'Metronome', text: 'Click track locked to your BPM and Bar 1. Accented on beat 1 of each bar.' },
      { term: 'Bleed Cancel', text: 'For recording on speakers: subtracts the backing track out of the mic signal. Light / Standard / Heavy set how aggressively.' },
      { term: 'Calibrate Mic Timing', text: 'Plays a test click and listens for it to measure your round-trip delay, then sets the offset automatically. Needs speakers, not headphones.' },
      { term: 'Shift Vocals', text: 'Manual latency offset. Nudge earlier or later if takes sit slightly off the beat.' },
    ],
  },
  bars: {
    title: 'Bars & Takes',
    entries: [
      { term: 'Takes', text: 'Each bar holds up to 5 recorded take slots. Tap an empty slot to arm it for recording.' },
      { term: 'Playback & Swap', text: 'Tap a take to make it the active one, so you can audition different vocal passes during loop playback.' },
      { term: 'Actions', text: 'The ⇄ button on a bar opens Copy, Cut, and Delete. Copying or cutting a take activates cyan PASTE buttons across every valid destination bar.' },
      { term: 'Drag & Drop', text: 'Drag a take onto another bar to move it. Bars already holding 5 takes will refuse the drop.' },
      { term: 'Favorite / Lock', text: 'Star your best takes to lock them in place, protecting them while you record new passes.' },
    ],
  },
}

// Collapsing reflows the page under the cursor, so pointerup can land on a different element
// and the click event never fires. Commit the toggle on pointerdown instead.
function sectionToggleHandlers(setOpen: Dispatch<SetStateAction<boolean>>) {
  return sectionActionHandlers(() => setOpen((open) => !open))
}

// Same pointerdown semantics for toggles that need custom logic rather than a setter.
function sectionActionHandlers(toggle: () => void) {
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      toggle()
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      toggle()
    },
  }
}

export default function App() {
  const {
    project,
    currentBarIndex,
    isRecording,
    isVocalMuted,
    armedTakeByBar,
    loopRange,
    audioUrl,
    beatFile,
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
    relocateTake,
    placeTake,
    clipboardTake,
    setClipboardTake,
    deleteAllTakes,
    toggleTakeLock,
    setTakeGain,
    updateMix,
    setProject,
    setProjectName,
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
  const [metronomeEnabled, setMetronomeEnabled] = useState(false)
  const [metronomeVolume, setMetronomeVolume] = useState(0.5)
  const [bleedCancelEnabled, setBleedCancelEnabled] = useState(false)
  const [bleedCancelPreset, setBleedCancelPreset] = useState<BleedCancelPreset>('standard')
  // stopRecordingFlow runs from a setTimeout captured in an earlier render, so reading
  // the state directly there would use whatever the toggle was when recording started.
  const bleedCancelEnabledRef = useRef(bleedCancelEnabled)
  useEffect(() => { bleedCancelEnabledRef.current = bleedCancelEnabled }, [bleedCancelEnabled])
  const bleedCancelPresetRef = useRef(bleedCancelPreset)
  useEffect(() => { bleedCancelPresetRef.current = bleedCancelPreset }, [bleedCancelPreset])
  const [isCalibratingMic, setIsCalibratingMic] = useState(false)
  const [showCalibrationModal, setShowCalibrationModal] = useState(false)
  const [calibrationCountdown, setCalibrationCountdown] = useState(0)
  const [detectBusy, setDetectBusy] = useState(false)
  const [bpmInput, setBpmInput] = useState(() => project.beat.bpm ? String(project.beat.bpm) : '')
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null)
  const [showSetup, setShowSetup] = useState(true)
  const [showProject, setShowProject] = useState(true)
  const [showVolume, setShowVolume] = useState(true)
  const [showBars, setShowBars] = useState(true)
  const [isMobileLayout, setIsMobileLayout] = useState(() => window.matchMedia('(max-width: 768px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 768px)')
    const sync = (event: MediaQueryListEvent) => setIsMobileLayout(event.matches)
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  // Below 768px these three behave as an accordion so only one eats vertical space at a
  // time. Volume stays out of it — it's meant to remain reachable at the top.
  const toggleAccordionPanel = (panel: 'setup' | 'project' | 'bars') => {
    const isOpen = panel === 'setup' ? showSetup : panel === 'project' ? showProject : showBars
    if (!isMobileLayout) {
      if (panel === 'setup') setShowSetup(!isOpen)
      else if (panel === 'project') setShowProject(!isOpen)
      else setShowBars(!isOpen)
      return
    }
    setShowSetup(!isOpen && panel === 'setup')
    setShowProject(!isOpen && panel === 'project')
    setShowBars(!isOpen && panel === 'bars')
  }

  const upperSectionsOpen = showVolume || showSetup || showProject
  const stickyHeaderRef = useRef<HTMLDivElement | null>(null)

  // The sticky header overlaps the top of the page, so the snap offset has to account
  // for its live height.
  useEffect(() => {
    const header = stickyHeaderRef.current
    if (!header) return
    const apply = () => {
      document.documentElement.style.setProperty('--sticky-header-height', `${Math.round(header.getBoundingClientRect().height)}px`)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  const scrollBarsToTop = () => {
    document.querySelector<HTMLElement>('.bar-list')?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const [showWaveform, setShowWaveform] = useState(true)
  // Firefox's AudioWorklet delivers empty input on some render quanta during sustained loud
  // input, silently corrupting recordings — confirmed unfixable from JS; recommend Chromium.
  const [showBrowserWarning, setShowBrowserWarning] = useState(() => /firefox/i.test(navigator.userAgent))
  const [loopEnabled, setLoopEnabled] = useState(false)
  const [waveformResetKey, setWaveformResetKey] = useState(0)
  const [auditioningTakeId, setAuditioningTakeId] = useState<string | undefined>(undefined)
  const auditionTimer = useRef<number | null>(null)
  const [undoToast, setUndoToast] = useState<{ take: Take; index: number } | null>(null)
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0)
  const undoTimer = useRef<number | null>(null)
  const pendingUndoRef = useRef<{ take: Take; index: number } | null>(null)
  const [isExportingProject, setIsExportingProject] = useState(false)
  const [pendingOverwrite, setPendingOverwrite] = useState<{ run: () => void } | null>(null)
  const [projectToast, setProjectToast] = useState<string | null>(null)
  const [projectToastEmphasis, setProjectToastEmphasis] = useState(false)
  const [fistPresets, setFistPresets] = useState<FistPreset[]>([])
  const [presetsError, setPresetsError] = useState<string | null>(null)
  const [selectedPresetId, setSelectedPresetId] = useState('')
  const [isLoadingPreset, setIsLoadingPreset] = useState(false)
  const projectToastTimer = useRef<number | null>(null)
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
    if (!helpTopic) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setHelpTopic(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [helpTopic])

  useEffect(() => {
    saveProject(project).catch((err) => console.error('autosave failed', err))
  }, [project])

  // Browsers block an AudioContext created before a user gesture, so nothing audio-related
  // is started at mount. The first tap/key both resumes the context and does the one-time
  // microphone setup; the resume stays attached because a context can suspend again later.
  useEffect(() => {
    console.log('[Punchin] recording diagnostics loaded')
    let micPrepared = false
    const onGesture = () => {
      void audioEngine.resumeIfSuspended()
      if (micPrepared) return
      micPrepared = true
      void audioEngine.prepareMicrophone()
        .then(() => setStatus('Microphone ready. Load audio to begin.'))
        .catch((err) => {
          console.error('microphone access failed', err)
          setStatus('Microphone unavailable. Check browser permissions before recording.')
        })
    }
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
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
    // Keep the UI on the engine's re-based position so turning loop off doesn't
    // read as a jump on the playhead/waveform.
    if (isPlayingRef.current) {
      const position = audioEngine.currentTime
      previousAudioTimeRef.current = position
      setCursor(position)
    }
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
          // Without this the engine has no decoded beat after a refresh, so the project
          // looks restored but Play and the waveforms have nothing to work with.
          await audioEngine.loadBeat(new File([beatBlob], 'main_beat', { type: beatBlob.type || 'audio/wav' }))
          setWaveformResetKey((key) => key + 1)
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
    // Mobile pickers often hand back a content-provider file with no extension, so trust the
    // MIME type too and let decodeAudioData reject anything that isn't really audio.
    const looksLikeAudio = /\.(wav|wave|mp3|m4a|aac|ogg|flac)$/i.test(file.name) || file.type.startsWith('audio/')
    if (!looksLikeAudio) { setStatus('Please choose an audio file.'); return }
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
      if (!project.name.trim() || project.name === 'My PunchRap Beat') {
        setProjectName(file.name.replace(/\.[^.]+$/, ''))
      }
      manualOffsetRef.current = false
      manualBpmRef.current = false
      bar1AnchorRef.current = undefined
      setBeatMeta({ fileId, durationSec: meta.durationSec, bpm: project.beat.bpm, timeSig: project.beat.timeSig, offsetSec: 0, bar1AnchorTime: undefined })
      setBars([])
      // Loading audio does not create a grid or move the transport.
      setPlayhead(0)
      setCursor(0)
      audioEngine.seek(0)
      setStatus(`Loaded \u201c${file.name}\u201d (${meta.durationSec.toFixed(1)}s). Set Bar 1 or click Create Bars.`)
    } catch (err) {
      setDetectBusy(false)
      console.error(err)
      setStatus('Failed to decode file. Is it a valid WAV/MP3?')
    }
  }

  // Tempo only: the Bar 1 anchor and offset are passed straight back through so
  // detection can never shift where the grid starts.
  const handleAutoBpm = async () => {
    const buf = audioEngine.beatAudioBuffer
    if (!buf || !project.beat.durationSec) return
    const anchor = bar1AnchorRef.current ?? project.beat.bar1AnchorTime
    setDetectBusy(true)
    const detected = await estimateBpmFromBuffer(buf, anchor ?? 0)
    setDetectBusy(false)
    if (!detected) { setStatus('BPM detection failed. Try adjusting manually.'); return }
    const bpm = normalizeDetectedBpm(detected.bpm)
    manualBpmRef.current = false
    setBpmInput(String(bpm))
    setBeatMeta({ ...project.beat, bpm, bar1AnchorTime: anchor })
    if (anchor !== undefined) {
      setBars(generateBars(project.beat.durationSec, bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, project.beat.offsetSec ?? anchor, anchor))
    }
    setStatus(`Auto BPM detected ${bpm} (${Math.round(detected.confidence * 100)}% confidence).`)
  }

  // Detection can latch onto half/double time, so fold the estimate into a musically sane
  // window before it becomes the grid. Manual entry deliberately has no such limits.
  const normalizeDetectedBpm = (bpm: number) => {
    let candidate = Math.round(bpm * 10) / 10
    while (candidate < DETECT_BPM_MIN && candidate > 0) candidate *= 2
    while (candidate > DETECT_BPM_MAX) candidate /= 2
    return Math.round(Math.max(DETECT_BPM_MIN, Math.min(DETECT_BPM_MAX, candidate)) * 10) / 10
  }

  const applyBpm = (bpm: number) => {
    const clamped = Math.max(1, Math.min(999, Math.round(bpm * 10) / 10))
    const anchor = bar1AnchorRef.current ?? project.bars[0]?.startSec ?? project.beat.bar1AnchorTime
    bar1AnchorRef.current = anchor
    setBeatMeta({ ...project.beat, bpm: clamped, bar1AnchorTime: anchor })
    // Builds the grid even when none exists yet, so a typed tempo stands on its own
    // instead of needing Auto BPM to have produced bars first.
    if (project.beat.durationSec) {
      setBars(generateBars(project.beat.durationSec, clamped, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, project.beat.offsetSec ?? 0, anchor))
    }
  }

  // Typing only moves the text; committing on blur/Enter is what retimes the grid, so a
  // partially typed "8" on the way to "84" never rebuilds bars at 8 BPM.
  const handleBpmInput = (value: string) => {
    setBpmInput(value)
  }

  const commitBpmInput = () => {
    const bpm = Number(bpmInput)
    if (!Number.isFinite(bpm) || bpm <= 0) {
      setBpmInput(project.beat.bpm ? String(project.beat.bpm) : '')
      return
    }
    manualBpmRef.current = true
    applyBpm(bpm)
    setBpmInput(String(Math.max(1, Math.min(999, Math.round(bpm * 10) / 10))))
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
    if (bpm <= 0 || !Number.isFinite(bpm)) return
    manualBpmRef.current = true
    setBpmInput(String(Math.round(bpm * 10) / 10))
    applyBpm(bpm)
  }

  useEffect(() => {
    if (!project.bars.length) return
    if (!loopRange) {
      setLoopRange({ start: 0, end: Math.min(1, project.bars.length - 1) })
      return
    }
    const start = Math.min(loopRange.start, project.bars.length - 1)
    const end = Math.min(Math.max(loopRange.end, start), project.bars.length - 1)
    if (start !== loopRange.start || end !== loopRange.end) setLoopRange({ start, end })
  }, [loopRange, project.bars.length, setLoopRange])

  const handleSeek = useCallback(    (time: number) => {
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
    // Builds the grid on the first press too, so this no longer depends on BPM
    // detection having run to produce bars.
    if (project.beat.durationSec && project.beat.bpm > 0) {
      setBars(generateBars(project.beat.durationSec, project.beat.bpm, project.beat.timeSig.beatsPerBar, project.beat.timeSig.beatUnit, anchor, anchor))
    }
  }, [project.beat, setBar1AnchorTime, setBars, totalDuration])

  useEffect(() => {
    if (!undoToast) return
    const tick = window.setInterval(() => setUndoSecondsLeft((left) => Math.max(0, left - 1)), 1000)
    return () => window.clearInterval(tick)
  }, [undoToast])

  const handlePlay = useCallback(() => {
    if (!audioLoaded) return
    void audioEngine.resumeIfSuspended()
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

  // Keeps the metronome phase-locked to the real beat grid: (re)starts it whenever
  // playback begins or the beat grid changes, stops it the instant playback ends.
  useEffect(() => {
    if (!audioLoaded || !metronomeEnabled || !isPlaying) {
      audioEngine.stopMetronome()
      return
    }
    const anchor = project.beat.bar1AnchorTime ?? project.bars[0]?.startSec ?? project.beat.offsetSec ?? 0
    audioEngine.startMetronome(project.beat.bpm || 120, project.beat.timeSig.beatsPerBar, anchor, audioEngine.currentTime)
    return () => audioEngine.stopMetronome()
  }, [audioLoaded, metronomeEnabled, isPlaying, project.beat.bpm, project.beat.bar1AnchorTime, project.beat.offsetSec, project.beat.timeSig.beatsPerBar, project.bars])

  useEffect(() => {
    audioEngine.setMetronomeVolume(metronomeVolume)
  }, [metronomeVolume])

  const handleCalibrateMicTiming = async () => {
    if (isCalibratingMic) return
    const wasPlaying = isPlayingRef.current
    if (wasPlaying) handlePause()
    audioEngine.stopMetronome()
    setIsCalibratingMic(true)
    setShowCalibrationModal(true)
    try {
      for (let count = 3; count > 0; count--) {
        setCalibrationCountdown(count)
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      setCalibrationCountdown(0)
      const result = await audioEngine.runLatencyCalibration()
      if (result.status === 'no-signal') {
        showProjectToast('No speaker feedback detected. If you are using headphones, please use the \u201cShift Vocals\u201d slider or nudge buttons to set your timing manually.', 9000, true)
        setStatus('Mic latency calibration cancelled \u2014 no speaker feedback detected.')
      } else {
        updateGlobalSync(result.delayMs)
        showProjectToast('Mic Latency Calibrated!')
        setStatus(`Mic latency calibrated \u2014 applied ${result.delayMs} ms offset.`)
      }
    } catch (err) {
      console.error('mic latency calibration failed', err)
      setStatus('Mic latency calibration failed \u2014 see console for details.')
      showProjectToast('Mic latency calibration failed — see console for details.')
    } finally {
      setIsCalibratingMic(false)
      setShowCalibrationModal(false)
      setCalibrationCountdown(0)
      if (wasPlaying) handlePlay()
    }
  }

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
  }, [audioLoaded])

  const handleLoopChange = (start: number, end: number) => {
    const barCount = project.bars.length || FALLBACK_LOOP_BARS
    const clampedStart = Math.max(0, Math.min(start, barCount - 1))
    const clampedEnd = Math.max(clampedStart, Math.min(end, barCount - 1))
    chainedThroughBarRef.current = -1
    setLoopRange({ start: clampedStart, end: clampedEnd })
    // Both boundaries are now defined, so arm the transport loop rather than making
    // the user reach for the top toggle as a separate step.
    setLoopEnabled(true)
  }

  const handleLoopStartChange = (start: number) => {
    // A fresh start point implies a one-bar loop unless the user widens it themselves.
    const end = loopRange && loopRange.end > start ? loopRange.end : start + 1
    handleLoopChange(start, end)
  }

  const handleLoopEndChange = (end: number) => {
    handleLoopChange(Math.min(loopRange?.start ?? end, end), end)
  }

  // Quick loop spans N bars from Bar 1; 0 turns looping off.
  const applyQuickLoop = (bars: number) => {
    if (!bars) {
      setLoopEnabled(false)
      return
    }
    if (!project.bars.length) return
    handleLoopChange(0, Math.min(bars - 1, project.bars.length - 1))
  }

  const isQuickLoopActive = (bars: number) => {
    if (!bars) return !loopEnabled
    if (!loopEnabled || !loopRange || loopRange.start !== 0) return false
    return loopRange.end === Math.min(bars - 1, Math.max(project.bars.length - 1, 0))
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
    if (!target) return
    if (target.locked) {
      showProjectToast('This one\u2019s a keeper \u2014 tap the \u2605 to unfavorite it first.')
      return
    }
    deleteTake(takeId)
    if (undoTimer.current) {
      window.clearTimeout(undoTimer.current)
      if (pendingUndoRef.current) purgeTake(pendingUndoRef.current.take)
    }
    pendingUndoRef.current = { take: target, index }
    setUndoToast({ take: target, index })
    setUndoSecondsLeft(UNDO_WINDOW_SEC)
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null
      pendingUndoRef.current = null
      purgeTake(target)
      setUndoToast(null)
    }, UNDO_WINDOW_SEC * 1000)
    // A remaining take may have been auto-selected in its place, so resolve what should
    // now be audible for this bar instead of assuming silence.
    const replacement = project.takes.find((item) => item.barIndex === target.barIndex && item.takeId !== takeId)
    if (target.selected) applyLiveTakeChange(target.barIndex, replacement?.takeId)
    else audioEngine.cancelChainedForBar(target.barIndex)
  }

  const BAR_FULL_MESSAGE = 'Bar Full \u2014 Max 5 Takes'

  const barTakeCount = (barIndex: number) => project.takes.filter((take) => take.barIndex === barIndex).length

  const handleTakeCopy = (takeId: string) => {
    const take = project.takes.find((item) => item.takeId === takeId)
    if (!take) return
    setClipboardTake({ sourceTakeId: takeId, sourceBarIndex: take.barIndex, fileId: take.fileId, gain: take.gain, bleedCancelled: take.bleedCancelled, action: 'copy' })
    showProjectToast(`Copied Take from Bar ${take.barIndex + 1} \u2014 tap PASTE on any bar.`)
  }

  const handleTakeCut = (takeId: string) => {
    const take = project.takes.find((item) => item.takeId === takeId)
    if (!take) return
    if (take.locked) {
      showProjectToast('This one\u2019s a keeper \u2014 tap the \u2605 to unfavorite it first.')
      return
    }
    setClipboardTake({ sourceTakeId: takeId, sourceBarIndex: take.barIndex, fileId: take.fileId, gain: take.gain, bleedCancelled: take.bleedCancelled, action: 'cut' })
    showProjectToast(`Cut Take from Bar ${take.barIndex + 1} \u2014 tap PASTE on any bar.`)
  }

  const handleClearClipboard = () => setClipboardTake(null)

  const handleTakePaste = async (barIndex: number) => {
    const clipboard = clipboardTake
    if (!clipboard) return
    if (barTakeCount(barIndex) >= 5) {
      showProjectToast(BAR_FULL_MESSAGE)
      return
    }
    // A bar armed for recording would otherwise capture over what was just pasted.
    disarmTake(barIndex)
    if (clipboard.action === 'cut') {
      const moved = relocateTake(clipboard.sourceTakeId, barIndex)
      if (!moved.ok) {
        showProjectToast(moved.reason === 'bar-full' ? BAR_FULL_MESSAGE : 'Could not move that take.')
        return
      }
      setClipboardTake(null)
      applyLiveTakeChange(barIndex, clipboard.sourceTakeId)
      showProjectToast(`Moved Take to Bar ${barIndex + 1}.`)
      return
    }
    // Copy duplicates the audio under a fresh id: deleting a take purges its blob, so
    // sharing one fileId between two takes would let either delete destroy both.
    const blob = blobCache.current.get(clipboard.fileId) ?? await getBlob(clipboard.fileId)
    if (!blob) {
      showProjectToast('Could not read that take\u2019s audio.')
      return
    }
    const fileId = `take-${crypto.randomUUID()}`
    blobCache.current.set(fileId, blob)
    void putBlob(fileId, blob)
    const takeId = crypto.randomUUID()
    const placed = placeTake(barIndex, {
      takeId,
      barIndex,
      fileId,
      gain: clipboard.gain,
      selected: true,
      bleedCancelled: clipboard.bleedCancelled,
      createdAt: new Date().toISOString(),
    })
    if (!placed.ok) {
      showProjectToast(placed.reason === 'bar-full' ? BAR_FULL_MESSAGE : 'Could not paste that take.')
      return
    }
    applyLiveTakeChange(barIndex, takeId)
    showProjectToast(`Pasted Take to Bar ${barIndex + 1}.`)
  }

  const handleTakeDropOnBar = (takeId: string, barIndex: number) => {
    const take = project.takes.find((item) => item.takeId === takeId)
    if (!take || take.barIndex === barIndex) return
    const moved = relocateTake(takeId, barIndex)
    if (!moved.ok) {
      showProjectToast(moved.reason === 'bar-full' ? BAR_FULL_MESSAGE : 'Could not move that take.')
      return
    }
    applyLiveTakeChange(barIndex, takeId)
    showProjectToast(`Moved Take to Bar ${barIndex + 1}.`)
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
    let takeBuffer = buffer
    let bleedCancelled = false
    const bleedCancelActive = bleedCancelEnabledRef.current
    console.log('%c[BLEED] stopRecordingFlow gate', 'color:#fff;background:#527;padding:2px 6px', {
      toggleEnabled: bleedCancelActive,
      preset: bleedCancelPresetRef.current,
      hasTargetBar: !!targetBar,
      hasBeatBuffer: !!audioEngine.beatAudioBuffer,
      latencyOffsetMs: vocalSyncMsRef.current,
    })
    if (bleedCancelActive && targetBar) {
      const cleaned = audioEngine.cancelSpeakerBleed(buffer, targetBar.startSec, vocalSyncMsRef.current, bleedCancelPresetRef.current)
      if (cleaned) { takeBuffer = cleaned; bleedCancelled = true }
      else console.warn('[BLEED] cancellation skipped — no backing track loaded or sample rate mismatch')
    }
    const blob = encodeWavFromAudioBuffer(takeBuffer, true)
    const fileId = `take-${crypto.randomUUID()}`
      console.log('[Punchin] recording take encoded', { fileId, frames: takeBuffer.length, bleedCancelled })
    blobCache.current.set(fileId, blob)
    void putBlob(fileId, blob)
    const targetSlot = recordingTarget?.slot
    if (!recordingTarget || targetSlot === undefined) {
      recordingPendingRef.current = false
      recordingTargetRef.current = null
      setStatus('Arm a red take slot before recording.')
      return
    }
    const saved = saveTake(recordingTarget.barIndex, targetSlot, fileId, 1, bleedCancelled)
    if (!saved.ok) {
      recordingPendingRef.current = false
      recordingTargetRef.current = null
      setStatus(saved.reason === 'locked' ? 'That take is locked. Choose another slot.' : 'Could not save this take.')
      return
    }
    console.log('[Punchin] take saved', { barIndex: recordingTarget.barIndex, slot: targetSlot, fileId, frames: takeBuffer.length, durationSec: takeBuffer.duration })
    consumeArmedTake(recordingTarget.barIndex)
    // Must be the processed buffer: playback reads this cache before ever touching the
    // stored blob, so seeding it with the raw take would silently bypass bleed removal.
    if (saved.take) decodedTakeCache.current.set(saved.take.takeId, takeBuffer)
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

  // Auto-dismissing toast; the packaging message instead stays up until export resolves.
  const showProjectToast = (message: string, durationMs = 4000, emphasis = false) => {
    if (projectToastTimer.current) window.clearTimeout(projectToastTimer.current)
    setProjectToast(message)
    setProjectToastEmphasis(emphasis)
    projectToastTimer.current = window.setTimeout(() => {
      projectToastTimer.current = null
      setProjectToast(null)
    }, durationMs)
  }

  const handleExportProject = async () => {
    if (isExportingProject) return
    if (isPlayingRef.current) handlePause()
    setIsExportingProject(true)
    setProjectToast('Compacting audio and packaging project\u2026 Please wait.')
    try {
      await exportProjectToFist(project, {
        loopEnabled,
        loopRange,
        isVocalMuted,
        monitorGain,
      })
      setStatus(`Exported \u201c${project.name}.fist\u201d.`)
      showProjectToast('Download complete!')
    } catch (err) {
      console.error('project export failed', err)
      setStatus('Could not export this project.')
      showProjectToast('Export failed — see console for details.')
    } finally {
      setIsExportingProject(false)
    }
  }

  // Recorded takes are the only thing a fresh session cannot rebuild, so they are what
  // "unsaved work" means here — the beat and grid come back from the .fist or the file.
  const hasUnsavedWork = project.takes.length > 0

  useEffect(() => {
    if (!hasUnsavedWork) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedWork])

  // Routes any action that would replace the current session through the confirm modal.
  const guardOverwrite = (run: () => void) => {
    if (!hasUnsavedWork) { run(); return }
    setPendingOverwrite({ run })
  }

  const handleOverwriteExportFirst = async () => {
    const pending = pendingOverwrite
    setPendingOverwrite(null)
    await handleExportProject()
    pending?.run()
  }

  const handleImportProject = async (file: File) => {
    try {
      setStatus(`Opening ${file.name}\u2026`)
      handleStop()
      const { project: imported, session, beatBlob, takeBlobs } = await importProjectFromFist(file)
      blobCache.current.clear()
      decodedTakeCache.current.clear()
      for (const [fileId, blob] of takeBlobs) blobCache.current.set(fileId, blob)
      if (beatBlob) {
        blobCache.current.set(imported.beat.fileId, beatBlob)
        await audioEngine.loadBeat(new File([beatBlob], 'main_beat', { type: beatBlob.type || 'audio/wav' }))
        setAudioUrl(URL.createObjectURL(beatBlob))
      } else {
        setAudioUrl(undefined)
      }
      manualOffsetRef.current = true
      manualBpmRef.current = true
      bar1AnchorRef.current = imported.beat.bar1AnchorTime
      setProject(imported)
      setBpmInput(imported.beat.bpm ? String(imported.beat.bpm) : '')
      audioEngine.setMasterBeatGain(imported.mix.masterBeatGain)
      audioEngine.setMasterVocalGain(imported.mix.globalVocalGain)
      audioEngine.setMasterVocalMuted(session.isVocalMuted)
      setVocalMuted(session.isVocalMuted)
      setMonitorGain(session.monitorGain)
      audioEngine.setMonitorGain(monitorEnabled ? session.monitorGain : 0)
      setLoopRange(session.loopRange)
      setLoopEnabled(session.loopEnabled)
      setWaveformResetKey((key) => key + 1)
      setStatus(`Imported \u201c${imported.name}\u201d (${imported.takes.length} take(s)).`)
      showProjectToast(`Imported \u201c${imported.name}\u201d.`)
    } catch (err) {
      console.error('project import failed', err)
      setStatus('Could not read that .fist project file.')
      showProjectToast('Could not read that .fist project file.')
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchFistPresets()
      .then((presets) => { if (!cancelled) setFistPresets(presets) })
      .catch((err) => {
        console.error('preset list fetch failed', err)
        if (!cancelled) setPresetsError('Could not load preset projects.')
      })
    return () => { cancelled = true }
  }, [])

  const handleLoadPreset = async (presetId: string) => {
    const preset = fistPresets.find((p) => p.id === presetId)
    if (!preset) return
    setIsLoadingPreset(true)
    setStatus(`Downloading \u201c${preset.title}\u201d\u2026`)
    try {
      const file = await downloadFistPreset(preset)
      await handleImportProject(file)
    } catch (err) {
      console.error('preset download failed', err)
      setStatus('Could not download that preset project.')
      showProjectToast('Could not download that preset project.')
    } finally {
      setIsLoadingPreset(false)
      setSelectedPresetId('')
    }
  }

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
      <div className="app-main">
        <div className="shell">
          <div className="app-title-block">
            <h2 className="app-title">PUNCH RAP</h2>
            <div className="app-title-credit">
              brought to you by{' '}
              <a href="https://boxbap.com" target="_blank" rel="noopener noreferrer">BOXBAP</a>
            </div>
          </div>

          <div className="sticky-transport-header" ref={stickyHeaderRef}>
        <div className={`section-collapsible ${showWaveform ? '' : 'is-collapsed'}`}>
        <div className="section-body">
        {showWaveform ? (
        <div className="top-nav">
        <div className="nav-scrub">
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
        ) : (
          <div className="section-collapsed-bar">Waveform hidden</div>
        )}
        </div>
        <button
          type="button"
          className={`section-tab ${showWaveform ? 'section-tab-open' : 'section-tab-collapsed'}`}
          aria-expanded={showWaveform}
          title={showWaveform ? 'Hide the waveform' : 'Show the waveform'}
          {...sectionToggleHandlers(setShowWaveform)}
        >
          {showWaveform ? 'Hide' : 'Show'}
        </button>
        </div>

        <div className="playback-controls-panel">
        <div className="playback-play-group">
          <button className="playback-back-button" onClick={() => handleSeek(0)} disabled={!audioLoaded || isRecording} title="Back to start (00:00)">⏮</button>
          <button className="playback-wide-button" onClick={isPlaying ? handlePause : handlePlay} disabled={!audioLoaded} title={isPlaying ? 'Pause — keeps position [Space]' : 'Play from current position [Space]'}>
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
        </div>
        <div className="playback-loop-group">
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
            className={loopEnabled ? 'playback-loop-eye loop-toggle-on' : 'secondary playback-loop-eye'}
            disabled={!loopRange}
            title="Scroll to the loop start bar"
            aria-label="Scroll to the loop start bar"
            onClick={() => document.getElementById(`bar-row-${loopRange?.start ?? 0}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            {'\u{1F441}'}
          </button>
        </div>
        </div>

        <section className={`panel volume-panel section-collapsible ${showVolume ? '' : 'is-collapsed'}`}>
        <div className="section-body">
        <div className="collapsible-header">
          <span className="collapsible-title">Volume</span>
          <button
            className="section-help-button"
            type="button"
            aria-label="What do the Volume controls do?"
            title="What do the Volume controls do?"
            onClick={(event) => { event.stopPropagation(); setHelpTopic('volume') }}
          >
            ?
          </button>
        </div>
        {showVolume && (
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
        )}
        </div>
        <button
          type="button"
          className={`section-tab ${showVolume ? 'section-tab-open' : 'section-tab-collapsed'}`}
          aria-expanded={showVolume}
          title={showVolume ? 'Hide Volume' : 'Show Volume'}
          {...sectionToggleHandlers(setShowVolume)}
        >
          {showVolume ? 'Hide' : 'Show'}
        </button>
        </section>
          </div>

          <section className={`panel project-export-panel section-collapsible ${showProject ? '' : 'is-collapsed'}`}>
            <div className="section-body">
            <div className="collapsible-header">
              <span className="collapsible-title">Import / Export</span>
              <button
                className="section-help-button"
                type="button"
                aria-label="What do the Import / Export controls do?"
                title="What do the Import / Export controls do?"
                onClick={(event) => { event.stopPropagation(); setHelpTopic('project') }}
              >
                ?
              </button>
            </div>
            {showProject && (
              <div className="project-export-grid">
                <div className="project-quadrant">
                  <div className="project-quadrant-header">
                    <span className="project-quadrant-title">Start with a Preset Session</span>
                    <p className="project-quadrant-desc">Load a pre-configured project template and jump straight into recording.</p>
                  </div>
                  <div className="project-quadrant-controls">
                    <div className="project-preset-row">
                      <select
                        id="fist-preset-select"
                        className="project-preset-select"
                        value={selectedPresetId}
                        disabled={isLoadingPreset || !fistPresets.length}
                        title="Load a preset project from the shared PunchRap library"
                        onChange={(event) => {
                          const presetId = event.target.value
                          setSelectedPresetId(presetId)
                          if (presetId) guardOverwrite(() => { void handleLoadPreset(presetId) })
                        }}
                      >
                        <option value="">
                          {presetsError ? presetsError : fistPresets.length ? 'Choose a preset\u2026' : 'No presets available'}
                        </option>
                        {fistPresets.map((preset) => (
                          <option key={preset.id} value={preset.id} title={preset.title}>
                            {preset.title.length > 40 ? `${preset.title.slice(0, 40)}...` : preset.title}
                          </option>
                        ))}
                      </select>
                      {isLoadingPreset && <span className="button-spinner" aria-hidden="true" />}
                    </div>
                  </div>
                </div>

                <div className="project-quadrant">
                  <div className="project-quadrant-header">
                    <span className="project-quadrant-title">Use Your Own Beat</span>
                    <p className="project-quadrant-desc">Upload a local audio file (WAV, MP3) from your computer to start a custom session.</p>
                  </div>
                  <div className="project-quadrant-controls">
                    <label className="io-button" title="Choose an audio file from your computer">
                      Choose File
                      <input type="file" accept={AUDIO_ACCEPT} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) guardOverwrite(() => { void handleFile(file) }) }} />
                    </label>
                    <input
                      type="text"
                      className="project-file-path"
                      readOnly
                      value={beatFile?.name ?? ''}
                      placeholder="No file selected"
                      aria-label="Selected beat file"
                    />
                  </div>
                </div>

                <div className="project-quadrant">
                  <div className="project-quadrant-header">
                    <span className="project-quadrant-title">Project Backup &amp; Recovery</span>
                    <p className="project-quadrant-desc">Save or restore complete PunchRap (.fist) workspace files.</p>
                  </div>
                  <div className="project-quadrant-controls">
                    <div className="project-name-row">
                      <span className="project-subsection-title">Project Name:</span>
                      <input
                        type="text"
                        className="project-name-input"
                        value={project.name}
                        maxLength={80}
                        placeholder="My PunchRap Beat"
                        aria-label="Project name"
                        title="Used as the .fist export file name"
                        onChange={(event) => setProjectName(event.target.value)}
                      />
                    </div>
                    <div className="project-button-stack">
                      <button
                        type="button"
                        className="io-button"
                        disabled={!project.beat.fileId || isExportingProject}
                        title="Save the beat, bar grid, and every take into one .fist file"
                        onClick={handleExportProject}
                      >
                        {isExportingProject && <span className="button-spinner" aria-hidden="true" />}
                        {isExportingProject ? 'Packing .fist\u2026' : 'Export Entire Project (.fist)'}
                      </button>
                      <label className="io-button" title="Load a previously exported .fist project">
                        Import Entire Project
                        <input
                          type="file"
                          accept={PROJECT_ACCEPT}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            event.target.value = ''
                            if (file) guardOverwrite(() => { void handleImportProject(file) })
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                <div className="project-quadrant">
                  <div className="project-quadrant-header">
                    <span className="project-quadrant-title">Export Vocal Recordings</span>
                    <p className="project-quadrant-desc">Export your recorded takes as clean audio stems.</p>
                  </div>
                  <div className="project-quadrant-controls">
                    <ExportDialog
                      onExportMix={() => handleExport(false)}
                      onExportVocals={() => handleExport(true)}
                      progress={exportProgress}
                      isRendering={exporting}
                      disabled={!project.beat.durationSec}
                    />
                  </div>
                </div>
              </div>
            )}
            </div>
            <button
              type="button"
              className={`section-tab ${showProject ? 'section-tab-open' : 'section-tab-collapsed'}`}
              aria-expanded={showProject}
              title={showProject ? 'Hide Import / Export' : 'Show Import / Export'}
              {...sectionActionHandlers(() => toggleAccordionPanel('project'))}
            >
              {showProject ? 'Hide' : 'Show'}
            </button>
          </section>

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

          <section className={`setup-stack section-collapsible ${showSetup ? '' : 'setup-stack-collapsed is-collapsed'}`}>
          <div className="section-body">
          {/* Outside the showSetup branch so the title and its help stay reachable while collapsed. */}
          <div className="collapsible-header">
            <span className="collapsible-title">Beat Setup</span>
            <button
              className="section-help-button"
              type="button"
              aria-label="What do the Beat Setup controls do?"
              title="What do the Beat Setup controls do?"
              onClick={(event) => { event.stopPropagation(); setHelpTopic('setup') }}
            >
              ?
            </button>
          </div>
          {showSetup && <>
          <section className="panel beat-setup-panel">
            <div className="controls">
              <div className="beat-setup-actions">
                <button
                  className="beat-setup-set-bar1"
                  title="Set Bar 1 to the current audio position and rebuild the grid"
                  disabled={!audioLoaded || detectBusy}
                  onClick={() => {
                    const position = isPlaying ? cursor : playhead
                    setBar1Anchor(position)
                    setStatus(`Bar 1 set to ${position.toFixed(3)}s.`)
                  }}
                >
                  Set Bar 1
                </button>
                <button
                  className="beat-setup-auto-bpm"
                  title="Detect the tempo without moving the Bar 1 anchor"
                  disabled={!audioLoaded || detectBusy}
                  onClick={() => { void handleAutoBpm() }}
                >
                  {detectBusy ? 'Detecting\u2026' : 'Auto BPM'}
                </button>
              </div>

              <div className="beat-setup-group beat-setup-tempo-group">
                <span className="beat-setup-group-label">Tempo</span>
                <div className="transport-bpm" onClick={(event) => event.stopPropagation()}>
                <span>BPM</span>
                <input
                  type="number"
                  value={bpmInput}
                  onChange={(event) => handleBpmInput(event.target.value)}
                  onBlur={commitBpmInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitBpmInput() }
                    if (event.key === 'Escape') setBpmInput(project.beat.bpm ? String(project.beat.bpm) : '')
                  }}
                  min={1}
                  max={999}
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
              <div className="beat-setup-metronome-group" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className={metronomeEnabled ? 'loop-toggle-on' : 'secondary'}
                  onClick={() => setMetronomeEnabled((enabled) => !enabled)}
                  disabled={!audioLoaded}
                  title={metronomeEnabled ? 'Metronome is on — click to turn off' : 'Metronome is off — click to turn on'}
                >
                  {'\u{1F3B5} Metronome'}
                </button>
                <input
                  type="range"
                  className="beat-setup-metronome-volume"
                  min={0}
                  max={1}
                  step={0.01}
                  value={metronomeVolume}
                  onChange={(e) => setMetronomeVolume(Number(e.target.value))}
                  aria-label="Metronome volume"
                  title="Metronome volume"
                />
                </div>
              </div>

              <div className="beat-setup-group beat-setup-dsp-group">
                <button
                  type="button"
                  className={`beat-setup-bleed-cancel ${bleedCancelEnabled ? 'loop-toggle-on' : 'secondary'}`}
                  aria-pressed={bleedCancelEnabled}
                  onClick={() => setBleedCancelEnabled((enabled) => !enabled)}
                  title={bleedCancelEnabled
                    ? 'Bleed Cancellation on — new takes subtract speaker leakage'
                    : 'Bleed Cancellation off — record the raw mic signal'}
                >
                  Bleed Cancel
                </button>
                <div className="bleed-preset-group" role="group" aria-label="Bleed cancellation strength">
                {([
                  { id: 'light', label: 'Light', hint: 'Gentlest — preserves vocal tails, least pumping' },
                  { id: 'standard', label: 'Standard', hint: 'Balanced drum and bass bleed reduction' },
                  { id: 'heavy', label: 'Heavy', hint: 'Maximum isolation for sparse, drum-heavy beats' },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`bleed-preset-button ${bleedCancelPreset === option.id ? 'bleed-preset-active' : 'secondary'}`}
                    aria-pressed={bleedCancelPreset === option.id}
                    title={option.hint}
                    onClick={() => setBleedCancelPreset(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
                </div>
              </div>
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
                quickLoopControl={(
                  <div className="quick-loop-group" onClick={(event) => event.stopPropagation()}>
                    <span className="bwe-ctrl-label">Loop</span>
                    {([0, 1, 2, 4] as const).map((bars) => (
                      <button
                        key={bars}
                        type="button"
                        className={`secondary quick-loop-button ${isQuickLoopActive(bars) ? 'quick-loop-active' : ''}`}
                        disabled={bars > 0 && !project.bars.length}
                        onClick={() => applyQuickLoop(bars)}
                      >
                        {bars === 0 ? 'Off' : `${bars} Bar${bars > 1 ? 's' : ''}`}
                      </button>
                    ))}
                  </div>
                )}
                onEdgeChange={(startSec) => setBar1Anchor(startSec)}
              />
            )}
            {!audioEngine.beatAudioBuffer && (
              <span className="text-muted">Load a beat to align Bar 1.</span>
            )}
          </div>
          <div className="beat-setup-sync">
              <div className="controls playback-sync-controls">
                <button
                  className="calibrate-mic-button"
                  onClick={handleCalibrateMicTiming}
                  disabled={isCalibratingMic || !audioLoaded}
                  title="Plays a short test pulse through speakers and listens for it on the mic to auto-set vocal sync"
                >
                  {isCalibratingMic ? 'Calibrating\u2026' : 'Calibrate Mic Timing'}
                </button>
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
                  <span className="playback-sync-divider" aria-hidden="true">|</span>
                  <button className="secondary playback-sync-reset" onClick={() => updateGlobalSync(0)}>Reset</button>
                </div>
              </div>
          </div>
          </section>
          </>}
          </div>
          <button
            type="button"
            className={`section-tab ${showSetup ? 'section-tab-open' : 'section-tab-collapsed'}`}
            aria-expanded={showSetup}
            title={showSetup ? 'Hide Beat Setup' : 'Show Beat Setup'}
            {...sectionActionHandlers(() => toggleAccordionPanel('setup'))}
          >
            {showSetup ? 'Hide' : 'Show'}
          </button>
          </section>

          {/* The tab is mobile-only via CSS; on desktop this wrapper is inert. */}
          <div className={`bars-accordion ${showBars ? '' : 'bars-accordion-collapsed'}`}>
          <button
            type="button"
            className="bars-accordion-tab"
            aria-expanded={showBars}
            title={showBars ? 'Hide Bars' : 'Show Bars'}
            {...sectionActionHandlers(() => toggleAccordionPanel('bars'))}
          >
            Bars {showBars ? '\u2303' : '\u2304'}
          </button>
          <BarList
            bars={project.bars}
            audioBuffer={audioEngine.beatAudioBuffer}
            playhead={displayPos}
            loopRange={loopRange}
            currentBarIndex={currentBarIndex}
            isRecording={isRecording}
            takes={project.takes}
            armedTakeByBar={armedTakeByBar}
            auditioningTakeId={auditioningTakeId}
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
            onSetLoopIn={handleLoopStartChange}
            onSetLoopOut={handleLoopEndChange}
            onDeleteAllTakes={handleDeleteAllTakes}
            clipboardTake={clipboardTake}
            onCopyTake={handleTakeCopy}
            onCutTake={handleTakeCut}
            onPasteTake={(barIndex) => { void handleTakePaste(barIndex) }}
            onClearClipboard={handleClearClipboard}
            onMoveTakeToBar={handleTakeDropOnBar}
            focusMode={!upperSectionsOpen}
            onShowHelp={() => setHelpTopic('bars')}
            onToggleFocus={() => {
              const next = !upperSectionsOpen
              setShowVolume(next)
              setShowSetup(next)
              setShowProject(next)
              scrollBarsToTop()
            }}
            onFocusBar={setCurrentBar}
            onTakeGain={setTakeGain}
          />
          </div>
        </div>
      </div>

      {projectToast && (
        <div className={`undo-toast project-toast ${projectToastEmphasis ? 'project-toast-alert' : ''}`} role="status">
          {isExportingProject && <span className="button-spinner" aria-hidden="true" />}
          <span>{projectToast}</span>
        </div>
      )}

      {undoToast && (
        <div className="undo-toast" role="status">
          <span className="undo-toast-progress" aria-hidden="true" />
          <span>Take deleted</span>
          <button type="button" className="undo-toast-action" onClick={handleUndoDelete}>
            Undo ({undoSecondsLeft}s)
          </button>
        </div>
      )}

      {showCalibrationModal && (
        <div className="calibration-modal-overlay" role="presentation">
          <div className="calibration-modal" role="alertdialog" aria-live="assertive">
            {calibrationCountdown > 0
              ? <span className="calibration-countdown" aria-hidden="true">{calibrationCountdown}</span>
              : <span className="button-spinner" aria-hidden="true" />}
            <p>Calibrating Mic Latency... Stand by for test clicks. Please keep your room quiet.</p>
          </div>
        </div>
      )}

      {pendingOverwrite && (
        <div className="calibration-modal-overlay" role="presentation">
          <div className="overwrite-modal" role="alertdialog" aria-modal="true">
            <p className="overwrite-modal-message">
              Hey, do you want to export your current work so you don&rsquo;t lose it, or are we good to proceed?
            </p>
            <div className="overwrite-modal-actions">
              <button
                type="button"
                className="overwrite-modal-export"
                disabled={isExportingProject}
                onClick={() => { void handleOverwriteExportFirst() }}
              >
                {isExportingProject && <span className="button-spinner" aria-hidden="true" />}
                Export First
              </button>
              <button
                type="button"
                className="overwrite-modal-proceed"
                onClick={() => { const pending = pendingOverwrite; setPendingOverwrite(null); pending?.run() }}
              >
                Proceed Anyway
              </button>
              <button
                type="button"
                className="overwrite-modal-cancel"
                onClick={() => setPendingOverwrite(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {helpTopic && (
        <div
          className="help-modal-overlay"
          role="presentation"
          onClick={() => setHelpTopic(null)}
        >
          <div
            className="help-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${HELP_CONTENT[helpTopic].title} help`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="help-modal-header">
              <span className="help-modal-title">{HELP_CONTENT[helpTopic].title}</span>
              <button
                type="button"
                className="help-modal-close"
                aria-label="Close help"
                onClick={() => setHelpTopic(null)}
              >
                ✕
              </button>
            </div>
            <dl className="help-modal-body">
              {HELP_CONTENT[helpTopic].entries.map((entry) => (
                <div key={entry.term} className="help-modal-entry">
                  <dt>{entry.term}</dt>
                  <dd>{entry.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
