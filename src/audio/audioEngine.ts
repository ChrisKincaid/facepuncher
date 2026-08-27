export class AudioEngine {
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
