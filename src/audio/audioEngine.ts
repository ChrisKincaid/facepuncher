export type LatencyCalibrationResult =
  | { status: 'ok'; delayMs: number; peak: number }
  | { status: 'no-signal'; peak: number }

export type BleedCancelPreset = 'light' | 'standard' | 'heavy'

export class AudioEngine {
  // Bleed removal tuning. Over-subtraction compensates for the room spreading the
  // bleed's energy beyond the bins the reference occupies; the spectral floor is the
  // fraction of the original magnitude a bin may never fall below. Pushing the floor
  // down deepens removal but lets bins snap toward zero, which is what produces the
  // warbling "musical noise" — hence the floor rises as subtraction gets gentler.
  private static readonly BLEED_PRESETS: Record<BleedCancelPreset, { overSubtraction: number; spectralFloor: number }> = {
    light: { overSubtraction: 1.2, spectralFloor: 0.06 },
    standard: { overSubtraction: 1.9, spectralFloor: 0.02 },
    heavy: { overSubtraction: 2.9, spectralFloor: 0.005 },
  }

  private ctx?: AudioContext
  private beatBuffer?: AudioBuffer
  private beatGain?: GainNode
  private beatSource?: AudioBufferSourceNode
  private takeSource?: AudioBufferSourceNode
  private takeGain?: GainNode
  private masterVocalGain?: GainNode
  // Takes scheduled ahead of time to continue directly from a previous bar's take.
  private chainedSources: { source: AudioBufferSourceNode; gain: GainNode; barIndex: number }[] = []
  private monitorGain?: GainNode
  private monitorStream?: MediaStream
  private monitorSource?: MediaStreamAudioSourceNode
  private micStream?: MediaStream
  private micSource?: MediaStreamAudioSourceNode
  private recorderNode?: AudioWorkletNode
  private recorderSink?: GainNode
  private micCaptureReady = false
  // Continuous PCM capture: one growing buffer for the whole session instead of
  // per-take encoder sessions, so back-to-back takes share an unbroken sample
  // stream with no stop/start gap and no lossy re-encode at the seam.
  private captureBuffer = new Float32Array(0)
  private captureLength = 0
  private captureBaseFrame?: number
  private expectedNextFrame?: number
  private emptyInputStreak = 0
  private activeRecording?: { startFrame: number }
  private recordingActive = false
  private playingOffset = 0
  private playStartedAt = 0
  private loopPhaseStartedAt = 0
  private loopPhaseOffset = 0
  private isPlaying = false
  private masterGainValue = 1
  private masterVocalGainValue = 1
  private vocalMuted = false
  private loopRegion?: { start: number; end: number }
  private metronomeGain?: GainNode
  private metronomeVolume = 0.5
  private metronomeOn = false
  private metronomeIntervalId?: number
  private metronomeNextTickTime = 0
  private metronomeBeatIndex = 0
  private metronomeBpm = 120
  private metronomeBeatsPerBar = 4
  private metronomeAnchorSec = 0
  private metronomeScheduledNodes: { osc: OscillatorNode; gain: GainNode; time: number }[] = []
  private metronomeScheduledTimes: number[] = []
  private metronomeLastTickTime = -Infinity

  get contextState() {
    return this.ctx?.state ?? 'not-created'
  }

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.masterVocalGain = this.ctx.createGain()
      this.masterVocalGain.gain.value = this.vocalMuted ? 0 : this.masterVocalGainValue
      this.masterVocalGain.connect(this.ctx.destination)
      console.log('[Punchin] AudioContext created', { state: this.ctx.state, sampleRate: this.ctx.sampleRate })
    }
    return this.ctx
  }

  async loadBeat(file: File) {
    const ctx = await this.ensureContext()
    const arrayBuf = await file.arrayBuffer()
    this.beatBuffer = await ctx.decodeAudioData(arrayBuf)
    return {
      durationSec: this.beatBuffer.duration,
      sampleRate: this.beatBuffer.sampleRate,
    }
  }

  /** The decoded beat buffer — available after loadBeat(), use for waveform rendering */
  get beatAudioBuffer(): AudioBuffer | undefined {
    return this.beatBuffer
  }

  get recordingFrameCount() {
    return this.captureLength
  }

  setLoop(start: number | undefined, end: number | undefined) {
    const position = this.currentTime
    if (start === undefined || end === undefined) {
      this.loopRegion = undefined
      // If currently playing, disable loop on the live source
      if (this.beatSource) {
        this.beatSource.loop = false
      }
      // While looping, currentTime reports the wrapped phase but the underlying
      // playingOffset + elapsed clock keeps growing past loopEnd. Clearing the region
      // would expose that raw value and snap the playhead forward, so re-base the
      // clock onto the position that is actually audible right now.
      if (this.isPlaying && this.ctx) {
        this.playingOffset = position
        this.playStartedAt = this.ctx.currentTime
      }
    } else {
      this.loopRegion = { start, end }
      const loopLength = end - start
      this.loopPhaseOffset = loopLength > 0
        ? position < start || position > end ? start : position
        : start
      this.loopPhaseStartedAt = this.ctx?.currentTime ?? 0
      // If currently playing, update the live source immediately — no restart needed
      if (this.beatSource) {
        this.beatSource.loop = true
        this.beatSource.loopStart = start
        this.beatSource.loopEnd = end
      }
    }
    // The wrap point just moved, so any tick queued past the old boundary is stale.
    this.resyncMetronome(this.currentTime)
  }

  setMasterBeatGain(value: number) {
    this.masterGainValue = value
    if (this.beatGain) {
      this.beatGain.gain.value = value
    }
  }

  setMasterVocalGain(value: number) {
    this.masterVocalGainValue = Math.max(0, Math.min(2, value))
    if (this.masterVocalGain && !this.vocalMuted) {
      this.masterVocalGain.gain.value = this.masterVocalGainValue
    }
  }

  setMasterVocalMuted(muted: boolean) {
    this.vocalMuted = muted
    if (this.masterVocalGain) {
      this.masterVocalGain.gain.value = muted ? 0 : this.masterVocalGainValue
    }
  }

  get currentTime() {
    if (!this.ctx) return 0
    if (!this.isPlaying) return this.playingOffset
    const now     = this.ctx.currentTime
    const elapsed = now - this.playStartedAt
    const raw     = this.playingOffset + elapsed
    // When looping the raw wall-clock time keeps growing past loopEnd.
    // Wrap it back into the loop range so bar highlight / playhead are correct.
    if (this.loopRegion) {
      const { start, end } = this.loopRegion
      const loopLen = end - start
      if (loopLen > 0) {
        const phase = this.loopPhaseOffset + (now - this.loopPhaseStartedAt)
        return phase < start ? phase : start + ((phase - start) % loopLen)
      }
    }
    return raw
  }

  // The AudioContext instant at which a given transport position (bar.startSec/endSec)
  // is actually audible right now — i.e. the inverse of currentTime. Reactive bar-entry
  // detection can notice a boundary a few ms late; this recovers the *true* instant from
  // wherever we happen to be measuring, so recording/playback can be scheduled exactly on
  // the bar boundary instead of on "whenever JS got around to checking."
  ctxTimeForPosition(posSec: number): number {
    if (!this.ctx) return 0
    const raw = this.currentTime
    const now = this.ctx.currentTime
    return now - (raw - posSec)
  }

  play(offsetSec = 0) {
    if (!this.ctx || !this.beatBuffer) return
    console.log('[Punchin] beat play requested', { offsetSec, contextState: this.ctx.state, loop: this.loopRegion })
    void this.ctx.resume()
    this.stopTake()
    // Stop any existing source immediately
    if (this.beatSource) {
      try { this.beatSource.stop() } catch { /* source may already be stopped */ }
      this.beatSource.disconnect()
      this.beatSource = undefined
    }
    // Disconnect old gain to avoid stale connections
    if (this.beatGain) {
      this.beatGain.disconnect()
    }

    const source = this.ctx.createBufferSource()
    source.buffer = this.beatBuffer
    this.beatSource = source

    const gain = this.ctx.createGain()
    gain.gain.value = this.masterGainValue
    this.beatGain = gain
    gain.connect(this.ctx.destination)
    source.connect(gain)

    this.playingOffset = offsetSec
    this.playStartedAt = this.ctx.currentTime
    this.loopPhaseOffset = offsetSec
    this.loopPhaseStartedAt = this.ctx.currentTime
    this.isPlaying = true

    if (this.loopRegion) {
      source.loop = true
      source.loopStart = this.loopRegion.start
      source.loopEnd = this.loopRegion.end
    }

    source.start(0, offsetSec)
    this.resyncMetronome(offsetSec)
    console.log('[Punchin] beat source started', { contextState: this.ctx.state, offsetSec })
  }

  playTake(buffer: AudioBuffer, offsetSec = 0, gainValue = 1, delaySec = 0) {
    if (!this.ctx) return
    this.stopTake(0.008)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    const now = this.ctx.currentTime
    const startAt = now + Math.max(0, delaySec)
    const remaining = Math.max(0.001, buffer.duration - offsetSec)
    gain.gain.setValueAtTime(0, now)
    gain.gain.setValueAtTime(0, startAt)
    gain.gain.linearRampToValueAtTime(gainValue, startAt + 0.004)
    gain.gain.setValueAtTime(gainValue, startAt + Math.max(0.004, remaining - 0.008))
    gain.gain.linearRampToValueAtTime(0, startAt + remaining)
    source.connect(gain).connect(this.masterVocalGain!)
    this.takeSource = source
    this.takeGain = gain
    source.start(startAt, Math.max(0, Math.min(offsetSec, Math.max(0, buffer.duration - 0.001))))
    return startAt
  }

  // Schedule a take to start at an exact future AudioContext time with no fade in/out.
  // Used to chain a bar's take directly onto the previous bar's, sample-accurately, so a
  // sustained note recorded across two consecutive takes plays back with no seam.
  scheduleTakeAt(buffer: AudioBuffer, barIndex: number, startAtCtxTime: number, gainValue = 1) {
    if (!this.ctx) return
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    gain.gain.value = gainValue
    source.connect(gain).connect(this.masterVocalGain!)
    const when = Math.max(this.ctx.currentTime, startAtCtxTime)
    source.start(when, 0)
    this.chainedSources.push({ source, gain, barIndex })
    source.onended = () => {
      this.chainedSources = this.chainedSources.filter((entry) => entry.source !== source)
    }
  }

  // Cancel a specific bar's pending chained take (e.g. it was just re-armed for
  // recording) without disturbing any other bar already scheduled in the chain.
  cancelChainedForBar(barIndex: number) {
    this.chainedSources = this.chainedSources.filter((entry) => {
      if (entry.barIndex !== barIndex) return true
      try { entry.source.stop() } catch { /* already stopped/ended */ }
      entry.source.disconnect()
      entry.gain.disconnect()
      return false
    })
  }

  private clearChainedSources() {
    for (const entry of this.chainedSources) {
      try { entry.source.stop() } catch { /* already stopped/ended */ }
      entry.source.disconnect()
      entry.gain.disconnect()
    }
    this.chainedSources = []
  }

  playDecodedTakeAt(buffer: AudioBuffer, startAt: number, gainValue = 1, loop = false) {
    if (!this.ctx) return
    this.stopTake(0.008)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    const now = this.ctx.currentTime
    const delay = Math.max(0, startAt - now)
    const duration = Math.max(0.001, buffer.duration)
    if (loop) {
      gain.gain.value = gainValue
      source.loop = true
      source.loopStart = 0
      source.loopEnd = duration
    } else {
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(gainValue, now + delay + 0.004)
      gain.gain.setValueAtTime(gainValue, now + delay + Math.max(0.004, duration - 0.008))
      gain.gain.linearRampToValueAtTime(0, now + delay + duration)
    }
    source.connect(gain).connect(this.masterVocalGain!)
    this.takeSource = source
    this.takeGain = gain
    source.start(Math.max(0, delay), 0)
  }

  playLoopingTakeAt(buffer: AudioBuffer, startAt: number, gainValue = 1) {
    if (!this.ctx || buffer.duration <= 0) return
    this.stopTake()
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.loopStart = 0
    source.loopEnd = buffer.duration
    const gain = this.ctx.createGain()
    gain.gain.value = gainValue
    source.connect(gain).connect(this.masterVocalGain!)
    this.takeSource = source
    this.takeGain = gain
    const delay = Math.max(0, startAt - this.ctx.currentTime)
    console.log('[Punchin] looping take source started', { contextState: this.ctx.state, startAt, delay, durationSec: buffer.duration, gainValue })
    source.start(delay, 0)
  }

  // Play a take once from its start at constant gain. Re-triggered on each bar entry.
  playTakeFromStart(buffer: AudioBuffer, gainValue = 1) {
    if (!this.ctx || buffer.duration <= 0) return
    this.stopTake()
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    gain.gain.value = gainValue
    source.connect(gain).connect(this.masterVocalGain!)
    this.takeSource = source
    this.takeGain = gain
    console.log('[Punchin] playTakeFromStart', { ctxTime: this.ctx.currentTime.toFixed(3), durationSec: buffer.duration.toFixed(3), gainValue })
    source.start(0, 0)
  }

  stopTake(fadeOutSec = 0) {
    this.clearChainedSources()
    if (this.takeSource) {
      if (fadeOutSec > 0 && this.ctx && this.takeGain) {
        const outgoingSource = this.takeSource
        const outgoingGain = this.takeGain
        const now = this.ctx.currentTime
        const stopAt = now + fadeOutSec
        outgoingGain.gain.cancelScheduledValues(now)
        outgoingGain.gain.setValueAtTime(outgoingGain.gain.value, now)
        outgoingGain.gain.linearRampToValueAtTime(0, stopAt)
        outgoingSource.onended = () => {
          outgoingSource.disconnect()
          outgoingGain.disconnect()
        }
        try { outgoingSource.stop(stopAt) } catch { /* source may already be stopped */ }
      } else {
        try { this.takeSource.stop() } catch { /* source may already be stopped */ }
      }
      if (fadeOutSec === 0) this.takeSource.disconnect()
      this.takeSource = undefined
    }
    this.takeGain?.disconnect()
    this.takeGain = undefined
  }

  stop() {
    if (this.beatSource) {
      this.beatSource.stop()
      this.beatSource.disconnect()
      this.beatSource = undefined
    }
    if (this.ctx) {
      const elapsed = this.ctx.currentTime - this.playStartedAt
      if (this.isPlaying) {
        this.playingOffset = this.playingOffset + elapsed
      }
    }
    this.playStartedAt = 0
    this.isPlaying = false
    this.stopTake()
  }

  seek(time: number) {
    if (!this.ctx) return
    this.playingOffset = Math.max(0, time)
    if (this.beatSource) {
      this.play(this.playingOffset)
    } else {
      this.resyncMetronome(this.playingOffset)
    }
  }

  async startMicMonitor(gainValue = 0.8) {
    const ctx = await this.ensureContext()
    // A suspended context can silently queue audio and dump it later as a
    // burst, which looks exactly like a growing delay. Force it running.
    await ctx.resume()
    // Dedicated low-latency monitor stream: echo cancellation ON keeps the mic
    // on the browser's real-time communications audio path (low latency),
    // while noise suppression / auto gain stay OFF so held notes are not gated
    // or pumped. Recording keeps its own untouched all-processing-off stream.
    if (!this.monitorStream) {
      this.monitorStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0,
        } as MediaTrackConstraints,
      })
    }
    if (!this.monitorSource) {
      this.monitorSource = ctx.createMediaStreamSource(this.monitorStream)
    }
    if (!this.monitorGain) {
      this.monitorGain = ctx.createGain()
      this.monitorGain.gain.value = gainValue
      this.monitorGain.connect(ctx.destination)
    }
    this.monitorSource.connect(this.monitorGain)
    const track = this.monitorStream.getAudioTracks()[0]
    console.log('%c[MONITOR LATENCY]', 'color:#fff;background:#c0392b;padding:2px 6px', {
      contextState: ctx.state,
      baseLatencySec: ctx.baseLatency,
      outputLatencySec: (ctx as AudioContext & { outputLatency?: number }).outputLatency,
      contextSampleRate: ctx.sampleRate,
      trackSettings: track?.getSettings(),
      trackLabel: track?.label,
    })
  }

  setMonitorGain(value: number) {
    if (this.monitorGain) {
      this.monitorGain.gain.value = value
    }
  }

  async prepareRecorder() {
    const ctx = await this.ensureContext()
    if (!this.recorderNode) {
      await ctx.audioWorklet.addModule(new URL('./recorderWorklet.ts', import.meta.url))
      this.recorderNode = new AudioWorkletNode(ctx, 'recorder-worklet')
      this.recorderNode.port.onmessage = (event) => {
        const message = event.data as { frame?: ArrayBuffer | Float32Array; startFrame?: number; wasEmptyInput?: boolean }
        if (!message.frame || message.startFrame === undefined) return
        const data = message.frame instanceof ArrayBuffer ? new Float32Array(message.frame) : message.frame
        // The worklet substitutes a zero-filled frame whenever the browser hands it an empty
        // input (Firefox does this on some render quanta). That's silently faked silence in
        // the recording, not real signal — track streaks of it to see if it's actually eating
        // real audio (e.g. during a sustained note) rather than genuine quiet.
        if (message.wasEmptyInput) {
          this.emptyInputStreak += 1
        } else if (this.emptyInputStreak > 0) {
          console.warn('%c[REC] worklet substituted silence for empty input frames', 'color:#fff;background:#c60;padding:2px 6px', {
            consecutiveFrames: this.emptyInputStreak,
            approxDurationMs: Math.round((this.emptyInputStreak * data.length / (this.ctx?.sampleRate ?? 44100)) * 1000),
            endedAtCaptureFrame: message.startFrame,
            duringActiveRecording: !!this.activeRecording,
          })
          this.emptyInputStreak = 0
        }
        this.appendCapturedFrame(data, message.startFrame)
        if (this.recordingActive && (this.captureLength / data.length) % 50 < 1) {
          console.log('[Punchin] microphone frames received', {
            frames: this.captureLength,
          })
        }
      }
      // The worklet only runs while pulled into the render graph. It has no audible
      // output of its own, so route it through a zero-gain sink instead of monitoring
      // the mic live (monitoring was removed separately due to output latency).
      this.recorderSink = ctx.createGain()
      this.recorderSink.gain.value = 0
      this.recorderNode.connect(this.recorderSink)
      this.recorderSink.connect(ctx.destination)
    }
    return this.recorderNode
  }

  private appendCapturedFrame(data: Float32Array, startFrame: number) {
    if (this.captureBaseFrame === undefined) this.captureBaseFrame = startFrame
    // Detect the audio thread skipping a render quantum (e.g. under system load) — this
    // would leave a real hole of exact silence in the capture buffer, distinct from any
    // bug in our own frame bookkeeping. Surfacing it here proves/disproves that directly.
    if (this.expectedNextFrame !== undefined && startFrame !== this.expectedNextFrame) {
      console.warn('%c[REC] capture frame discontinuity — audio thread likely skipped render quanta', 'color:#fff;background:#c00;padding:2px 6px', {
        expectedFrame: this.expectedNextFrame,
        actualFrame: startFrame,
        gapFrames: startFrame - this.expectedNextFrame,
        duringActiveRecording: !!this.activeRecording,
      })
    }
    this.expectedNextFrame = startFrame + data.length
    const offset = startFrame - this.captureBaseFrame
    if (offset < 0) {
      // The main-thread clock used to start a recording/trim (ctx.currentTime) can briefly
      // disagree with the audio-thread frame counter (e.g. right after the AudioContext
      // resumes from autoplay-suspended). Never let that push captureBaseFrame ahead of
      // frames we haven't actually received yet — drop just this one late frame instead of
      // corrupting the buffer or crashing the message port.
      console.warn('[Punchin] dropped out-of-order capture frame', { startFrame, captureBaseFrame: this.captureBaseFrame })
      return
    }
    const requiredLength = offset + data.length
    if (this.captureBuffer.length < requiredLength) {
      const grown = new Float32Array(Math.max(requiredLength, this.captureBuffer.length * 2, this.ctx ? this.ctx.sampleRate * 8 : requiredLength))
      grown.set(this.captureBuffer)
      this.captureBuffer = grown
    }
    this.captureBuffer.set(data, offset)
    this.captureLength = Math.max(this.captureLength, requiredLength)
    // Bound memory: capture runs for the whole session, but we only ever need
    // frames from the start of an in-progress take onward. While idle, keep just
    // a trailing cushion instead of retaining audio for the entire session. This needs to be
    // generous: the real-world gap between one bar's recording ending and the next one's
    // starting (WAV encode, IndexedDB save, React updates) was observed exceeding a 250ms
    // cushion, which truncated the front of the next take. A few seconds costs negligible
    // memory (a few hundred KB) and gives that turnaround huge headroom.
    const idleCushionFrames = this.ctx ? Math.round(this.ctx.sampleRate * 5) : 0
    const desiredKeepFromFrame = this.activeRecording ? this.activeRecording.startFrame : startFrame + data.length - idleCushionFrames
    // Never trim ahead of the frame we just actually received — activeRecording.startFrame
    // comes from the main-thread clock and can otherwise outrun the real message stream.
    const keepFromFrame = Math.min(desiredKeepFromFrame, startFrame)
    this.trimCaptureBuffer(keepFromFrame)
  }

  private trimCaptureBuffer(keepFromFrame: number) {
    if (this.captureBaseFrame === undefined) return
    const dropFrames = keepFromFrame - this.captureBaseFrame
    if (dropFrames <= 0) return
    if (dropFrames >= this.captureLength) {
      this.captureBuffer = new Float32Array(0)
      this.captureLength = 0
      this.captureBaseFrame = keepFromFrame
      return
    }
    this.captureBuffer = this.captureBuffer.slice(dropFrames, this.captureLength)
    this.captureLength -= dropFrames
    this.captureBaseFrame = keepFromFrame
  }

  private getCapturedRange(startFrame: number, endFrame: number): Float32Array {
    if (this.captureBaseFrame === undefined) return new Float32Array(0)
    const from = Math.max(0, startFrame - this.captureBaseFrame)
    const to = Math.min(this.captureLength, endFrame - this.captureBaseFrame)
    if (to <= from) return new Float32Array(0)
    return this.captureBuffer.slice(from, to)
  }

  // Give the worklet's message port a brief window to deliver the last render
  // quanta before we slice — usually near-instant, bounded so an early manual
  // stop can never hang waiting on frames that will never arrive.
  private async waitForCapturedFrames(endFrame: number, timeoutMs = 150) {
    const start = performance.now()
    while ((this.captureBaseFrame === undefined || this.captureBaseFrame + this.captureLength < endFrame) && performance.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 4))
    }
  }

  async prepareMicrophone() {
    const ctx = await this.ensureContext()
    await ctx.resume()
    if (!this.micStream) {
      console.log('[Punchin] requesting microphone permission')
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      console.log('[Punchin] microphone permission granted')
    }
    if (!this.micSource) {
      this.micSource = ctx.createMediaStreamSource(this.micStream)
    }
  }

  // Wire the mic into the worklet once so capture runs continuously for the whole
  // session — consecutive takes then come from one unbroken sample stream instead
  // of separate encoder sessions, eliminating the stop/start gap between them.
  async ensureMicCapture() {
    await this.prepareMicrophone()
    await this.prepareRecorder()
    if (!this.micCaptureReady && this.micSource && this.recorderNode) {
      this.micSource.connect(this.recorderNode)
      this.micCaptureReady = true
    }
  }

  // Starts a phase-locked click track: beat 1 of every bar gets the higher accent
  // tone, beats 2-4 get the lower woodblock/hi-hat tone. positionSec/anchorSec are
  // both in beat-file time so the very next tick lands exactly on the real beat grid
  // instead of wherever the metronome happened to be started.
  startMetronome(bpm: number, beatsPerBar: number, anchorSec: number, positionSec: number) {
    if (!this.ctx) return
    this.stopMetronome()
    this.metronomeBpm = Math.max(1, bpm)
    this.metronomeBeatsPerBar = Math.max(1, Math.round(beatsPerBar))
    this.metronomeAnchorSec = anchorSec
    this.metronomeGain = this.ctx.createGain()
    this.metronomeGain.gain.value = this.metronomeVolume
    this.metronomeGain.connect(this.ctx.destination)

    this.alignMetronomePhase(positionSec, this.ctx.currentTime)
    this.metronomeOn = true
    this.scheduleMetronomeTicks()
    this.metronomeIntervalId = window.setInterval(() => this.scheduleMetronomeTicks(), 25)
  }

  /**
   * Re-locks the click to the transport after a discontinuity (seek/scrub, or a loop
   * wrap). Drops every already-queued tick — they were scheduled against the old
   * position and would fire against the new one — then recomputes the beat index and
   * sub-beat offset from positionSec so the next click lands on the real grid.
   */
  resyncMetronome(positionSec: number) {
    if (!this.ctx || !this.metronomeOn) return
    this.cancelScheduledMetronomeTicks()
    this.alignMetronomePhase(positionSec, this.ctx.currentTime)
    // A beat that just sounded can land back on the schedule as "the next beat" when
    // the realign happens right on a boundary. Push past it so the click never doubles.
    const beatDuration = 60 / this.metronomeBpm
    if (this.metronomeNextTickTime - this.metronomeLastTickTime < beatDuration * 0.5) {
      this.metronomeNextTickTime += beatDuration
      this.metronomeBeatIndex = (this.metronomeBeatIndex + 1) % this.metronomeBeatsPerBar
    }
    this.scheduleMetronomeTicks()
  }

  // Places the next tick on the first beat at/after positionSec, given that
  // positionSec is heard at ctxTimeAtPosition.
  private alignMetronomePhase(positionSec: number, ctxTimeAtPosition: number) {
    const beatDuration = 60 / this.metronomeBpm
    const elapsedBeats = (positionSec - this.metronomeAnchorSec) / beatDuration
    const nextBeatNumber = Math.ceil(elapsedBeats - 1e-6)
    const nextBeatPositionSec = this.metronomeAnchorSec + nextBeatNumber * beatDuration
    const deltaToNextBeat = Math.max(0, nextBeatPositionSec - positionSec)
    this.metronomeBeatIndex = ((nextBeatNumber % this.metronomeBeatsPerBar) + this.metronomeBeatsPerBar) % this.metronomeBeatsPerBar
    this.metronomeNextTickTime = ctxTimeAtPosition + deltaToNextBeat
  }

  // Drops pending ticks. Ticks that already started are left to ring out (killing them
  // mid-click would be audible as a cut), but their time is recorded so a realign can
  // tell which beat was the last one actually heard.
  private cancelScheduledMetronomeTicks(includeSounding = false) {
    const now = this.ctx?.currentTime ?? 0
    const surviving: typeof this.metronomeScheduledNodes = []
    for (const node of this.metronomeScheduledNodes) {
      if (!includeSounding && node.time <= now) {
        surviving.push(node)
        continue
      }
      try { node.osc.stop() } catch { /* already stopped/ended */ }
      node.osc.disconnect()
      node.gain.disconnect()
    }
    this.metronomeScheduledNodes = surviving
    // Discard the times of ticks we just cancelled, then take the newest remaining one
    // as the last beat actually heard. Keeping a short history matters because a node
    // that finished ringing is already gone from metronomeScheduledNodes.
    this.metronomeScheduledTimes = includeSounding
      ? []
      : this.metronomeScheduledTimes.filter((time) => time <= now && time > now - 5)
    this.metronomeLastTickTime = this.metronomeScheduledTimes.length
      ? Math.max(...this.metronomeScheduledTimes)
      : -Infinity
  }

  stopMetronome() {
    this.metronomeOn = false
    if (this.metronomeIntervalId !== undefined) {
      window.clearInterval(this.metronomeIntervalId)
      this.metronomeIntervalId = undefined
    }
    this.cancelScheduledMetronomeTicks(true)
    this.metronomeLastTickTime = -Infinity
    this.metronomeGain?.disconnect()
    this.metronomeGain = undefined
  }

  setMetronomeVolume(value: number) {
    this.metronomeVolume = Math.max(0, Math.min(1, value))
    if (this.metronomeGain) this.metronomeGain.gain.value = this.metronomeVolume
  }

  // Lookahead scheduler: queues every tick that falls within the next 150ms so
  // playback stays sample-accurate even though this is driven by a 25ms timer.
  private scheduleMetronomeTicks() {
    if (!this.ctx || !this.metronomeOn || !this.metronomeGain) return
    const lookaheadSec = 0.15
    const beatDuration = 60 / this.metronomeBpm
    const horizon = this.ctx.currentTime + lookaheadSec
    // Guard against pathological loops (loop shorter than one beat) spinning forever.
    let guard = 0
    while (this.metronomeNextTickTime < horizon && guard++ < 512) {
      // If the transport wraps before this tick would fire, re-anchor the counter to
      // the loop start instead — otherwise the click keeps counting straight through
      // the jump and drifts out of phase for the rest of the loop.
      if (this.applyMetronomeLoopWrap()) continue
      const accent = this.metronomeBeatIndex === 0
      this.playMetronomeTick(this.metronomeNextTickTime, accent)
      this.metronomeScheduledTimes.push(this.metronomeNextTickTime)
      this.metronomeNextTickTime += beatDuration
      this.metronomeBeatIndex = (this.metronomeBeatIndex + 1) % this.metronomeBeatsPerBar
    }
  }

  // Returns true if the pending tick fell past the loop boundary and the phase was
  // re-anchored to the loop start (so the caller should re-evaluate it).
  private applyMetronomeLoopWrap(): boolean {
    if (!this.ctx || !this.loopRegion || !this.isPlaying) return false
    const { start, end } = this.loopRegion
    if (end - start <= 0) return false
    const loopEndCtxTime = this.ctxTimeForPosition(end)
    if (loopEndCtxTime <= this.ctx.currentTime) return false
    if (this.metronomeNextTickTime < loopEndCtxTime - 1e-6) return false
    this.alignMetronomePhase(start, loopEndCtxTime)
    return true
  }

  private playMetronomeTick(time: number, accent: boolean) {
    if (!this.ctx || !this.metronomeGain) return
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.frequency.value = accent ? 1600 : 950
    gain.gain.setValueAtTime(0.0001, time)
    gain.gain.linearRampToValueAtTime(accent ? 1 : 0.6, time + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
    osc.connect(gain).connect(this.metronomeGain)
    osc.start(time)
    osc.stop(time + 0.06)
    const entry = { osc, gain, time }
    this.metronomeScheduledNodes.push(entry)
    osc.onended = () => {
      this.metronomeScheduledNodes = this.metronomeScheduledNodes.filter((node) => node !== entry)
      gain.disconnect()
    }
  }

  playCountIn(bpm: number, bars: number, beatsPerBar = 4) {
    if (!this.ctx) return
    const totalBeats = Math.max(0, bars) * Math.max(1, beatsPerBar)
    if (totalBeats === 0) return
    const interval = 60 / Math.max(1, bpm)
    for (let i = 0; i < totalBeats; i++) {
      const osc = this.ctx.createOscillator()
      const gain = this.ctx.createGain()
      osc.frequency.value = i % beatsPerBar === 0 ? 1400 : 1000
      gain.gain.setValueAtTime(0, this.ctx.currentTime + i * interval)
      gain.gain.linearRampToValueAtTime(0.18, this.ctx.currentTime + i * interval + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + i * interval + 0.08)
      osc.connect(gain).connect(this.ctx.destination)
      osc.start(this.ctx.currentTime + i * interval)
      osc.stop(this.ctx.currentTime + i * interval + 0.1)
    }
  }

  // startAtCtxTime should be the bar's *true* boundary instant (via ctxTimeForPosition),
  // not "now" — that's what lets a reactively-late detection still capture from the
  // exact bar start instead of baking the detection lag into the recording.
  async startRecording(startAtCtxTime?: number) {
    const ctx = await this.ensureContext()
    await this.ensureMicCapture()
    if (!this.micStream) return ctx.currentTime
    if (this.activeRecording) throw new Error('A microphone recording is already active or finalizing')
    const resolvedStartAt = startAtCtxTime ?? ctx.currentTime
    const startFrame = Math.round(resolvedStartAt * ctx.sampleRate)
    this.activeRecording = { startFrame }
    this.recordingActive = true
    const micTracks = this.micStream.getAudioTracks().map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted, state: t.readyState }))
    console.log('%c[REC] START', 'color:#fff;background:#08c;padding:2px 6px', {
      ctxTime: ctx.currentTime.toFixed(3),
      sampleRate: ctx.sampleRate,
      startFrame,
      requestedStartAt: startAtCtxTime,
      micTracks,
    })
    return resolvedStartAt
  }

  // endAtCtxTime should be the bar's true end instant. If it's still in the future when
  // called (an early manual stop), we cap at "now" instead of waiting for it to arrive.
  async stopRecording(endAtCtxTime?: number): Promise<AudioBuffer | undefined> {
    if (!this.ctx || !this.activeRecording) {
      console.warn('%c[REC] STOP called with no active recorder', 'color:#c00')
      return undefined
    }
    const { startFrame } = this.activeRecording
    this.recordingActive = false
    const sampleRate = this.ctx.sampleRate
    const nowFrame = Math.round(this.ctx.currentTime * sampleRate)
    const targetEndFrame = endAtCtxTime === undefined ? nowFrame : Math.round(endAtCtxTime * sampleRate)
    // Cap at "now" (not the requested end blindly) so an early manual stop
    // never waits on frames from the future — it just yields a shorter take.
    const endFrame = Math.min(targetEndFrame, nowFrame)
    // Keep activeRecording set while we await/extract so the idle-trim path in
    // appendCapturedFrame can't discard startFrame out from under us in the meantime.
    await this.waitForCapturedFrames(endFrame)
    const data = this.getCapturedRange(startFrame, endFrame)
    this.activeRecording = undefined
    const expectedFrames = endFrame - startFrame
    if (this.captureBaseFrame !== undefined && startFrame < this.captureBaseFrame) {
      // The requested start predates when capture actually began (e.g. the mic worklet was
      // still connecting) — the take was truncated at the front, which shows up as an early,
      // premature end relative to the bar's true length rather than a genuine short take.
      console.warn('%c[REC] take truncated — requested start predates capture start', 'color:#fff;background:#c00;padding:2px 6px', {
        startFrame, captureBaseFrame: this.captureBaseFrame, missingFrames: this.captureBaseFrame - startFrame,
      })
    }
    console.log('%c[REC] STOP', 'color:#fff;background:#084;padding:2px 6px', {
      requestedEndAt: endAtCtxTime,
      startFrame,
      endFrame,
      expectedFrames,
      frames: data.length,
    })
    if (!data.length) {
      console.warn('%c[REC] no frames captured — mic produced nothing', 'color:#c00')
      return undefined
    }
    const out = this.ctx.createBuffer(1, data.length, sampleRate)
    out.getChannelData(0).set(data)
    this.logBufferProfile('TRIMMED TAKE (returned)', out)
    return out
  }

  // Plays a single sharp 2ms click through the speakers while recording the mic,
  // then measures the round-trip (output -> speaker -> air -> mic -> input) delay by
  // locating the click's first transient in the recorded buffer. Returns a structured
  // result: 'no-signal' means nothing came back (headphones/muted mic), in which case
  // the caller must NOT change the offset. delayMs is negative because recorded vocals
  // lag the beat by the round-trip delay, so playback must shift earlier to compensate.
  async runLatencyCalibration(): Promise<LatencyCalibrationResult> {
    const ctx = await this.ensureContext()
    await ctx.resume()
    if (this.activeRecording) throw new Error('Cannot calibrate while a recording is already active')
    await this.ensureMicCapture()
    if (!this.micStream) throw new Error('Microphone is not available for calibration')

    // Three trials, median-selected: a single stray room noise can corrupt one
    // measurement, but it can't move the median of three. This is what keeps repeat
    // triggers inside a few ms of each other rather than occasionally wild.
    const TRIALS = 3
    const measurements: { delayMs: number; peak: number }[] = []
    let bestPeak = 0
    for (let trial = 0; trial < TRIALS; trial++) {
      const result = await this.measureImpulseDelay()
      bestPeak = Math.max(bestPeak, result.peak)
      if (result.delayMs !== null) measurements.push({ delayMs: result.delayMs, peak: result.peak })
    }

    if (!measurements.length) {
      console.warn('[Punchin] latency calibration found no speaker feedback', { bestPeak: bestPeak.toFixed(4) })
      return { status: 'no-signal', peak: bestPeak }
    }

    const sorted = measurements.map((m) => m.delayMs).sort((a, b) => a - b)
    const medianDelayMs = sorted[Math.floor(sorted.length / 2)]
    const spreadMs = sorted[sorted.length - 1] - sorted[0]
    console.log('[Punchin] latency calibration result', {
      trials: sorted, medianDelayMs, spreadMs, peak: bestPeak.toFixed(3),
    })
    if (spreadMs > 5) {
      console.warn('[Punchin] calibration spread exceeded 5ms — room noise may be affecting accuracy', { spreadMs })
    }
    return { status: 'ok', delayMs: -medianDelayMs, peak: bestPeak }
  }

  // One impulse + capture cycle. delayMs is null when no transient rose above the
  // detection threshold (headphones, muted mic, or output silenced).
  private async measureImpulseDelay(): Promise<{ delayMs: number | null; peak: number }> {
    const ctx = this.ctx!
    const recordDurationSec = 0.5
    const scheduleDelaySec = 0.15
    const triggerAt = ctx.currentTime + scheduleDelaySec

    // 2ms full-scale square click. Written straight into a buffer with no envelope so
    // sample 0 is already at full amplitude — an instantaneous attack, which is what
    // gives the recorded copy an unambiguous leading edge to lock onto.
    const clickDurationSec = 0.002
    const clickFrames = Math.max(1, Math.round(clickDurationSec * ctx.sampleRate))
    const clickBuffer = ctx.createBuffer(1, clickFrames, ctx.sampleRate)
    const clickData = clickBuffer.getChannelData(0)
    const halfPeriod = Math.max(1, Math.round(ctx.sampleRate / 2000))
    for (let i = 0; i < clickFrames; i++) {
      clickData[i] = Math.floor(i / halfPeriod) % 2 === 0 ? 1 : -1
    }
    const clickSource = ctx.createBufferSource()
    clickSource.buffer = clickBuffer
    const clickGain = ctx.createGain()
    clickGain.gain.value = 1
    clickSource.connect(clickGain).connect(ctx.destination)

    await this.startRecording(triggerAt)
    clickSource.start(triggerAt)

    const waitMs = (scheduleDelaySec + recordDurationSec) * 1000 + 50
    await new Promise((resolve) => setTimeout(resolve, waitMs))

    const recordedBuffer = await this.stopRecording(triggerAt + recordDurationSec)
    clickSource.disconnect()
    clickGain.disconnect()
    if (!recordedBuffer) throw new Error('Calibration recording captured no audio — check microphone permissions')

    return this.detectFirstTransient(recordedBuffer)
  }

  // Finds the leading edge of the first transient. Deliberately takes the FIRST
  // threshold crossing rather than the loudest sample: the loudest point is often a
  // wall reflection or the tail of room reverb arriving milliseconds later, which
  // would inflate the measured latency.
  private detectFirstTransient(buffer: AudioBuffer): { delayMs: number | null; peak: number } {
    const samples = buffer.getChannelData(0)
    const sampleRate = buffer.sampleRate
    // Skip the first 2ms (electrical bleed-through) and stop after 400ms — anything
    // later than that is not a plausible round-trip latency, so searching further
    // only invites picking up unrelated room noise.
    const searchFrom = Math.round(0.002 * sampleRate)
    const searchTo = Math.min(samples.length, Math.round(0.4 * sampleRate))

    // Noise floor measured from the pre-arrival gap so the threshold adapts to the
    // room instead of being a fixed constant that fails on quiet or hot mics.
    let noiseSum = 0
    let noiseCount = 0
    for (let i = 0; i < searchFrom; i++) { noiseSum += samples[i] * samples[i]; noiseCount++ }
    const noiseFloor = noiseCount ? Math.sqrt(noiseSum / noiseCount) : 0

    let peakValue = 0
    for (let i = searchFrom; i < searchTo; i++) {
      const abs = Math.abs(samples[i])
      if (abs > peakValue) peakValue = abs
    }

    const MIN_DETECTABLE_PEAK = 0.02
    if (peakValue < MIN_DETECTABLE_PEAK) return { delayMs: null, peak: peakValue }

    // Must clear both the room's own noise and a solid fraction of the click itself,
    // so a soft background sound before the click can't be mistaken for the arrival.
    const threshold = Math.max(peakValue * 0.35, noiseFloor * 8, MIN_DETECTABLE_PEAK)
    let onsetIndex = -1
    for (let i = searchFrom; i < searchTo; i++) {
      if (Math.abs(samples[i]) >= threshold) { onsetIndex = i; break }
    }
    if (onsetIndex < 0) return { delayMs: null, peak: peakValue }

    // Back off to where the edge actually left the noise floor — the crossing above
    // sits partway up the rise, and on a 2ms click that is worth a sample or two.
    const footThreshold = Math.max(peakValue * 0.08, noiseFloor * 3)
    while (onsetIndex > searchFrom && Math.abs(samples[onsetIndex - 1]) > footThreshold) onsetIndex--

    return { delayMs: Math.round((onsetIndex / sampleRate) * 1000), peak: peakValue }
  }

  /**
   * Removes speaker bleed from an open-air vocal take by spectral subtraction: the
   * backing track's magnitude spectrum is scaled and subtracted from the mic's, bin by
   * bin, while the mic's own phase is kept. Unlike sample-level phase inversion this
   * tolerates the sub-sample misalignment and room colouring that make a live room's
   * bleed impossible to cancel by direct subtraction.
   *
   * barStartSec is the take's transport position and latencyOffsetMs is the calibrated
   * round-trip figure (negative, as produced by runLatencyCalibration), which together
   * give the coarse alignment; correlation then refines it. The subtraction is scaled to
   * the level the bleed actually arrived at, since that depends on speaker volume.
   *
   * Returns null only when subtraction is structurally impossible (no backing track, or
   * a sample rate that cannot be aligned). Weak correlation is not a failure — it falls
   * back to the calibrated offset with an amplitude-matched scale.
   */
  cancelSpeakerBleed(vocalBuffer: AudioBuffer, barStartSec: number, latencyOffsetMs: number, preset: BleedCancelPreset = 'standard'): AudioBuffer | null {
    if (!this.ctx) return null
    if (!this.beatBuffer) {
      console.warn('%c[BLEED] no backing track loaded — nothing to subtract', 'color:#fff;background:#c00;padding:2px 6px')
      return null
    }
    const sampleRate = vocalBuffer.sampleRate
    if (this.beatBuffer.sampleRate !== sampleRate) {
      console.warn('%c[BLEED] sample rate mismatch — cannot align reference', 'color:#fff;background:#c00;padding:2px 6px', {
        beatRate: this.beatBuffer.sampleRate, vocalRate: sampleRate,
      })
      return null
    }

    const vocal = vocalBuffer.getChannelData(0)
    const beat = this.mixBeatToMono(this.beatBuffer)
    const roundTripSec = Math.max(0, -latencyOffsetMs / 1000)
    // Bleed heard at take-time t was emitted by the speaker one round trip earlier.
    const baseBeatOffset = Math.round((barStartSec - roundTripSec) * sampleRate)

    const searchRadius = Math.round(0.02 * sampleRate)
    const best = this.findBleedAlignment(vocal, beat, baseBeatOffset, searchRadius)
    // A poor correlation only means the search could not improve on the calibration, so
    // fall back to the calibrated offset verbatim instead of giving up on the take.
    const lag = best?.lag ?? 0
    const offset = baseBeatOffset + lag

    // Gain, in order of preference: fitted on bleed-dominated windows, then the
    // whole-take least-squares fit, then a plain amplitude match on the quietest
    // windows — the last needs no correlation at all, so it survives a live room.
    const MIN_USABLE_GAIN = 0.002
    const silenceGain = this.estimateBleedGainFromSilence(vocal, beat, offset, sampleRate)
    let alpha: number
    let gainSource: string
    if (silenceGain !== null && silenceGain >= MIN_USABLE_GAIN) {
      alpha = silenceGain
      gainSource = 'silence-correlated'
    } else if (best && best.alpha >= MIN_USABLE_GAIN) {
      alpha = best.alpha
      gainSource = 'whole-take-fit'
    } else {
      const rmsGain = this.estimateBleedGainByRms(vocal, beat, offset, sampleRate)
      alpha = rmsGain ?? 0
      gainSource = rmsGain !== null ? 'rms-amplitude-match' : 'none'
    }

    const tuning = AudioEngine.BLEED_PRESETS[preset] ?? AudioEngine.BLEED_PRESETS.standard
    const output = this.ctx.createBuffer(1, vocalBuffer.length, sampleRate)
    const cleaned = output.getChannelData(0)
    cleaned.set(this.spectralSubtract(vocal, beat, offset, alpha, sampleRate, tuning))

    const rawStats = this.measureLevel(vocal)
    const referenceStats = this.measureLevel(vocal, (i) => {
      const beatIndex = offset + i
      const scale = alpha * tuning.overSubtraction
      return scale * (beatIndex >= 0 && beatIndex < beat.length ? beat[beatIndex] : 0)
    })
    const cleanedStats = this.measureLevel(cleaned)
    console.log('%c[BLEED] spectral subtraction applied', 'color:#fff;background:#063;padding:2px 6px', {
      barStartSec,
      latencyOffsetMs,
      preset,
      alignmentOffsetSamples: offset,
      lagFromCalibrationSamples: lag,
      lagFromCalibrationMs: +((lag / sampleRate) * 1000).toFixed(2),
      alignmentSource: best ? 'correlation-refined' : 'calibrated-offset-only',
      gainSource,
      alpha: +alpha.toFixed(4),
      overSubtractionFactor: tuning.overSubtraction,
      effectiveSubtractionGain: +(alpha * tuning.overSubtraction).toFixed(4),
      spectralFloor: tuning.spectralFloor,
      silenceGain: silenceGain === null ? null : +silenceGain.toFixed(4),
      wholeTakeFitGain: best ? +best.alpha.toFixed(4) : null,
      rawPeak: +rawStats.peak.toFixed(4),
      rawRms: +rawStats.rms.toFixed(4),
      scaledReferencePeak: +referenceStats.peak.toFixed(4),
      scaledReferenceRms: +referenceStats.rms.toFixed(4),
      cleanedPeak: +cleanedStats.peak.toFixed(4),
      cleanedRms: +cleanedStats.rms.toFixed(4),
      rmsReductionDb: +(20 * Math.log10((cleanedStats.rms || 1e-9) / (rawStats.rms || 1e-9))).toFixed(2),
    })
    return output
  }

  private measureLevel(source: Float32Array, transform?: (index: number) => number) {
    let peak = 0
    let sum = 0
    for (let i = 0; i < source.length; i++) {
      const value = transform ? transform(i) : source[i]
      const abs = Math.abs(value)
      if (abs > peak) peak = abs
      sum += value * value
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, source.length)) }
  }

  /**
   * STFT -> per-bin magnitude subtraction -> ISTFT.
   *
   * Each frame's mic spectrum is scaled down toward the residual magnitude rather than
   * having a complex value subtracted from it, so the mic's original phase survives
   * untouched. The measured bleed gain is multiplied by an over-subtraction factor
   * because the room smears energy across neighbouring bins — removing only the
   * measured magnitude reliably leaves audible residue.
   *
   * The take is processed inside a padded workspace: the first and last STFT frames get
   * fewer overlapping windows than the rest, and that uneven reconstruction is what
   * clicks at a bar edge. Padding pushes those frames outside the region we keep, so the
   * slice returned is exactly the original length — no trimming, no crossfade.
   */
  private spectralSubtract(vocal: Float32Array, beat: Float32Array, offset: number, alpha: number, sampleRate: number, tuning: { overSubtraction: number; spectralFloor: number }): Float32Array {
    const N = 2048
    const hop = N / 4
    const pad = 1024
    const subtractionGain = alpha * tuning.overSubtraction
    const window = new Float32Array(N)
    for (let i = 0; i < N; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)

    const length = vocal.length
    const paddedLength = length + pad * 2
    const paddedVocal = new Float32Array(paddedLength)
    paddedVocal.set(vocal, pad)
    // The reference stays continuous through the padding — the backing track is fully
    // available either side of the bar, so those frames subtract against real audio.
    const paddedBeatOffset = offset - pad

    const out = new Float32Array(paddedLength)
    const normalisation = new Float32Array(paddedLength)
    const vocalRe = new Float32Array(N)
    const vocalIm = new Float32Array(N)
    const beatRe = new Float32Array(N)
    const beatIm = new Float32Array(N)

    for (let start = 0; start < paddedLength; start += hop) {
      for (let i = 0; i < N; i++) {
        const vocalIndex = start + i
        vocalRe[i] = vocalIndex < paddedLength ? paddedVocal[vocalIndex] * window[i] : 0
        vocalIm[i] = 0
        const beatIndex = paddedBeatOffset + start + i
        beatRe[i] = beatIndex >= 0 && beatIndex < beat.length ? beat[beatIndex] * window[i] : 0
        beatIm[i] = 0
      }
      this.fft(vocalRe, vocalIm, false)
      this.fft(beatRe, beatIm, false)

      for (let k = 0; k < N; k++) {
        const magnitude = Math.hypot(vocalRe[k], vocalIm[k])
        if (magnitude < 1e-12) continue
        const bleedMagnitude = Math.hypot(beatRe[k], beatIm[k])
        const residual = Math.max(magnitude - subtractionGain * bleedMagnitude, magnitude * tuning.spectralFloor)
        // Scaling the complex pair preserves its argument, i.e. the mic's phase.
        const scale = residual / magnitude
        vocalRe[k] *= scale
        vocalIm[k] *= scale
      }

      this.fft(vocalRe, vocalIm, true)
      for (let i = 0; i < N; i++) {
        const outIndex = start + i
        if (outIndex >= paddedLength) break
        out[outIndex] += vocalRe[i] * window[i]
        normalisation[outIndex] += window[i] * window[i]
      }
    }

    // Dividing by the accumulated squared window makes overlap-add exact for any
    // hop size, rather than relying on a hand-tuned constant.
    for (let i = 0; i < paddedLength; i++) {
      if (normalisation[i] > 1e-8) out[i] /= normalisation[i]
    }
    // Filtered before slicing so the filter's own settling transient stays in the pad.
    this.removeDcOffset(out, sampleRate)
    return out.slice(pad, pad + length)
  }

  // One-pole high pass. Spectral subtraction can leave a small standing offset in the
  // lowest bins, which reads as a step at a buffer edge rather than as audible tone.
  private removeDcOffset(samples: Float32Array, sampleRate: number, cutoffHz = 20) {
    const dt = 1 / sampleRate
    const rc = 1 / (2 * Math.PI * cutoffHz)
    const coefficient = rc / (rc + dt)
    let previousInput = samples.length ? samples[0] : 0
    let previousOutput = 0
    for (let i = 0; i < samples.length; i++) {
      const input = samples[i]
      const output = coefficient * (previousOutput + input - previousInput)
      samples[i] = output
      previousInput = input
      previousOutput = output
    }
  }

  // In-place iterative radix-2 Cooley-Tukey. Length must be a power of two.
  private fft(re: Float32Array, im: Float32Array, inverse: boolean) {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1
      for (; j & bit; bit >>= 1) j ^= bit
      j ^= bit
      if (i < j) {
        const tempRe = re[i]; re[i] = re[j]; re[j] = tempRe
        const tempIm = im[i]; im[i] = im[j]; im[j] = tempIm
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = ((inverse ? 2 : -2) * Math.PI) / len
      const stepRe = Math.cos(angle)
      const stepIm = Math.sin(angle)
      const half = len >> 1
      for (let i = 0; i < n; i += len) {
        let twiddleRe = 1
        let twiddleIm = 0
        for (let k = 0; k < half; k++) {
          const evenRe = re[i + k]
          const evenIm = im[i + k]
          const oddRe = re[i + k + half] * twiddleRe - im[i + k + half] * twiddleIm
          const oddIm = re[i + k + half] * twiddleIm + im[i + k + half] * twiddleRe
          re[i + k] = evenRe + oddRe
          im[i + k] = evenIm + oddIm
          re[i + k + half] = evenRe - oddRe
          im[i + k + half] = evenIm - oddIm
          const nextRe = twiddleRe * stepRe - twiddleIm * stepIm
          twiddleIm = twiddleRe * stepIm + twiddleIm * stepRe
          twiddleRe = nextRe
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
    }
  }

  /**
   * Scales the reference to the bleed's actual amplitude by fitting only on stretches
   * where the beat dominates the take — i.e. where the singer is not on the mic.
   *
   * Those windows are identified by correlation coefficient rather than by raw quietness:
   * a bleed-only window can still be loud, so a plain "find the quiet part" test would
   * miss it. Median of the qualifying windows keeps one odd window from skewing the gain.
   */
  private estimateBleedGainFromSilence(vocal: Float32Array, beat: Float32Array, offset: number, sampleRate: number): number | null {
    const windowSize = Math.round(0.05 * sampleRate)
    if (windowSize <= 0) return null
    const gains: number[] = []
    for (let start = 0; start + windowSize <= vocal.length; start += windowSize) {
      let dot = 0
      let beatEnergy = 0
      let vocalEnergy = 0
      for (let i = start; i < start + windowSize; i++) {
        const beatIndex = offset + i
        if (beatIndex < 0 || beatIndex >= beat.length) continue
        const b = beat[beatIndex]
        const v = vocal[i]
        dot += v * b
        beatEnergy += b * b
        vocalEnergy += v * v
      }
      if (beatEnergy <= 1e-9 || vocalEnergy <= 1e-9) continue
      const correlation = dot / Math.sqrt(beatEnergy * vocalEnergy)
      // Deliberately permissive: a real room smears the bleed with reflections, so
      // correlation on a genuinely bleed-only window is routinely well under 0.5.
      if (correlation < 0.2) continue
      gains.push(dot / beatEnergy)
    }
    if (!gains.length) return null
    gains.sort((a, b) => a - b)
    const median = gains[Math.floor(gains.length / 2)]
    return Math.max(0, Math.min(1.5, median))
  }

  /**
   * Last-resort gain estimate that ignores phase entirely and just matches amplitude.
   *
   * Takes the quietest quarter of the vocal's windows — the stretches most likely to be
   * bleed with no singing over them — and compares their level to the reference's level
   * at the same spot. Works in rooms where reflections destroy correlation, at the cost
   * of being an amplitude match rather than a true phase fit.
   */
  private estimateBleedGainByRms(vocal: Float32Array, beat: Float32Array, offset: number, sampleRate: number): number | null {
    const windowSize = Math.round(0.05 * sampleRate)
    if (windowSize <= 0) return null
    const windows: { vocalRms: number; beatRms: number }[] = []
    for (let start = 0; start + windowSize <= vocal.length; start += windowSize) {
      let vocalEnergy = 0
      let beatEnergy = 0
      for (let i = start; i < start + windowSize; i++) {
        const beatIndex = offset + i
        vocalEnergy += vocal[i] * vocal[i]
        if (beatIndex >= 0 && beatIndex < beat.length) beatEnergy += beat[beatIndex] * beat[beatIndex]
      }
      const beatRms = Math.sqrt(beatEnergy / windowSize)
      if (beatRms <= 1e-6) continue
      windows.push({ vocalRms: Math.sqrt(vocalEnergy / windowSize), beatRms })
    }
    if (!windows.length) return null
    windows.sort((a, b) => a.vocalRms - b.vocalRms)
    const quietCount = Math.max(1, Math.floor(windows.length / 4))
    const ratios = windows.slice(0, quietCount).map((w) => w.vocalRms / w.beatRms).sort((a, b) => a - b)
    return Math.max(0, Math.min(1.5, ratios[Math.floor(ratios.length / 2)]))
  }

  private mixBeatToMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0)
    const mono = new Float32Array(buffer.length)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < mono.length; i++) mono[i] += data[i]
    }
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels
    return mono
  }

  // Two-pass lag search (coarse decimated sweep, then sample-accurate refinement) so a
  // ±20ms window doesn't cost a full correlation at every offset. Returns the lag plus
  // the least-squares scale factor for the bleed at that lag.
  private findBleedAlignment(vocal: Float32Array, beat: Float32Array, baseOffset: number, searchRadius: number) {
    const score = (lag: number, step: number) => {
      let dot = 0
      let beatEnergy = 0
      for (let i = 0; i < vocal.length; i += step) {
        const beatIndex = baseOffset + lag + i
        if (beatIndex < 0 || beatIndex >= beat.length) continue
        const b = beat[beatIndex]
        dot += vocal[i] * b
        beatEnergy += b * b
      }
      return { dot, beatEnergy }
    }

    let bestLag = 0
    let bestCorrelation = -Infinity
    for (let lag = -searchRadius; lag <= searchRadius; lag += 8) {
      const { dot, beatEnergy } = score(lag, 4)
      if (beatEnergy <= 0) continue
      const correlation = (dot * dot) / beatEnergy
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag }
    }
    for (let lag = bestLag - 8; lag <= bestLag + 8; lag++) {
      const { dot, beatEnergy } = score(lag, 4)
      if (beatEnergy <= 0) continue
      const correlation = (dot * dot) / beatEnergy
      if (correlation > bestCorrelation) { bestCorrelation = correlation; bestLag = lag }
    }

    const { dot, beatEnergy } = score(bestLag, 1)
    if (beatEnergy <= 0) return null
    // Clamped: a fit above ~1.5 means the correlation latched onto something that is not
    // bleed, and applying it would gouge the vocal.
    const alpha = Math.max(0, Math.min(1.5, dot / beatEnergy))
    return { lag: bestLag, alpha }
  }

  // Print peak + 8-segment RMS so the audible content position is unambiguous.
  private logBufferProfile(label: string, buffer: AudioBuffer) {
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
    console.log(`%c[REC] ${label}`, 'color:#fff;background:#606;padding:2px 6px', {
      durationSec: buffer.duration.toFixed(3),
      sampleRate: buffer.sampleRate,
      peak: peak.toFixed(3),
      rms8: rms.join(' | '),
    })
  }
}

export const audioEngine = new AudioEngine()
