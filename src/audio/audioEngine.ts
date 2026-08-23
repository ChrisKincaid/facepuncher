import { applyLatencyOffset } from '../utils/audioHelpers'

interface CapturedChunk {
  data: Float32Array
  startFrame: number
}

interface MediaRecordingSession {
  recorder: MediaRecorder
  blobs: Blob[]
  startMs: number
}

export class AudioEngine {
  private ctx?: AudioContext
  private beatBuffer?: AudioBuffer
  private beatGain?: GainNode
  private beatSource?: AudioBufferSourceNode
  private takeSource?: AudioBufferSourceNode
  private takeGain?: GainNode
  private monitorGain?: GainNode
  private micStream?: MediaStream
  private micSource?: MediaStreamAudioSourceNode
  private micAnalyser?: AnalyserNode
  private recorderNode?: AudioWorkletNode
  private recordingChunks: CapturedChunk[] = []
  private mediaRecording?: MediaRecordingSession
  private recordingActive = false
  private playingOffset = 0
  private playStartedAt = 0
  private isPlaying = false
  private masterGainValue = 1
  private loopRegion?: { start: number; end: number }

  get contextState() {
    return this.ctx?.state ?? 'not-created'
  }

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
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
    return this.recordingChunks.length ? this.recordingChunks[this.recordingChunks.length - 1].startFrame + this.recordingChunks[this.recordingChunks.length - 1].data.length : 0
  }

  get microphoneLevel() {
    if (!this.micAnalyser) return 0
    const data = new Uint8Array(this.micAnalyser.fftSize)
    this.micAnalyser.getByteTimeDomainData(data)
    let sum = 0
    for (const value of data) {
      const centered = (value - 128) / 128
      sum += centered * centered
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 4)
  }

  async calibrateMicrophone(manualClap = false, onProgress?: (hits: number) => void) {
    const ctx = await this.ensureContext()
    await this.prepareMicrophone()
    const recorderNode = await this.prepareRecorder()
    this.micSource?.connect(recorderNode)
    recorderNode.connect(ctx.destination)
    const captureStart = this.recordingFrameCount
    const captureChunkStart = this.recordingChunks.length
    const startAt = ctx.currentTime + 0.5
    const interval = 1
    const countIn = 4
    const measuredClicks = manualClap ? 20 : 6
    const requiredHits = manualClap ? 6 : measuredClicks
    const clickCount = countIn + measuredClicks
    for (let index = 0; index < clickCount; index++) {
      const when = startAt + index * interval
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.frequency.value = index === 0 ? 1200 : 900
      gain.gain.setValueAtTime(0, when)
      gain.gain.linearRampToValueAtTime(0.35, when + 0.003)
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.06)
      oscillator.connect(gain).connect(ctx.destination)
      oscillator.start(when)
      oscillator.stop(when + 0.08)
    }
    const deadline = performance.now() + (manualClap ? 35000 : 15000)
    let matched: { actual: number; expected: number }[] = []
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250))
      const detected = this.detectCalibrationHits(captureStart, captureChunkStart, ctx.sampleRate)
      const expectedStart = 0.5 + (manualClap ? countIn : 0) * interval
      const expectedHits = Array.from({ length: manualClap ? measuredClicks : clickCount }, (_, index) => expectedStart + index * interval)
      if (manualClap) {
        const sequence: { actual: number; expected: number }[] = []
        for (const expected of expectedHits) {
          const actual = detected.find((time) => Math.abs(time - expected) <= 0.35)
          if (actual === undefined) sequence.length = 0
          else sequence.push({ actual, expected })
          if (sequence.length >= requiredHits) break
        }
        matched = sequence
      } else {
        matched = expectedHits
          .map((expected) => ({ actual: detected.find((time) => Math.abs(time - expected) <= 0.35), expected }))
          .filter((pair): pair is { actual: number; expected: number } => pair.actual !== undefined)
      }
      onProgress?.(Math.min(matched.length, requiredHits))
      if (matched.length >= requiredHits) break
    }
    if (matched.length < requiredHits) {
      this.micSource?.disconnect(recorderNode)
      recorderNode.disconnect()
      throw new Error(manualClap ? 'Not enough claps detected' : 'Calibration clicks were not detected')
    }
    const offsets = matched.map((pair) => (pair.actual - pair.expected) * 1000)
    offsets.sort((a, b) => a - b)
    const middle = Math.floor(offsets.length / 2)
    const median = offsets.length % 2 ? offsets[middle] : (offsets[middle - 1] + offsets[middle]) / 2
    // A positive measured arrival means the microphone signal is late. The
    // extraction correction therefore needs the opposite sign.
    const correctionMs = Math.round(Math.max(-1000, Math.min(500, -median)))
    this.micSource?.disconnect(recorderNode)
    recorderNode.disconnect()
    console.log('[Punchin] calibration complete', { manualClap, hits: matched.length, measuredDelayMs: Math.round(median), correctionMs })
    return correctionMs
  }

  private detectCalibrationHits(startFrame: number, chunkStart: number, sampleRate: number) {
    const endFrame = this.recordingFrameCount
    const length = Math.max(0, endFrame - startFrame)
    const samples = new Float32Array(length)
    let written = 0
    for (const chunk of this.recordingChunks.slice(chunkStart)) {
      const chunkEnd = chunk.startFrame + chunk.data.length
      if (chunkEnd <= startFrame) continue
      const from = Math.max(0, startFrame - chunk.startFrame)
      const count = Math.min(chunk.data.length - from, length - written)
      samples.set(chunk.data.subarray(from, from + count), written)
      written += count
      if (written >= length) break
    }
    const windowSize = Math.max(1, Math.floor(sampleRate * 0.012))
    const step = Math.max(1, Math.floor(windowSize / 2))
    const energy: number[] = []
    for (let frame = 0; frame + windowSize < samples.length; frame += step) {
      let sum = 0
      for (let offset = 0; offset < windowSize; offset++) {
        const value = samples[frame + offset] ?? 0
        sum += value * value
      }
      energy.push(Math.sqrt(sum / windowSize))
    }
    const peak = Math.max(...energy, 0)
    const hits: number[] = []
    for (let index = 1; index < energy.length - 1; index++) {
      if (energy[index] < peak * 0.35 || energy[index] < energy[index - 1] || energy[index] < energy[index + 1]) continue
      const time = (index * step + windowSize / 2) / sampleRate
      if (!hits.length || time - hits[hits.length - 1] > 0.18) hits.push(time)
    }
    return hits
  }

  setLoop(start: number | undefined, end: number | undefined) {
    if (start === undefined || end === undefined) {
      this.loopRegion = undefined
      // If currently playing, disable loop on the live source
      if (this.beatSource) {
        this.beatSource.loop = false
      }
    } else {
      this.loopRegion = { start, end }
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
      if (raw > end && loopLen > 0) {
        return start + ((raw - start) % loopLen)
      }
    }
    return raw
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
    source.connect(gain).connect(this.ctx.destination)
    this.takeSource = source
    this.takeGain = gain
    source.start(startAt, Math.max(0, Math.min(offsetSec, Math.max(0, buffer.duration - 0.001))))
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
    source.connect(gain).connect(this.ctx.destination)
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
    source.connect(gain).connect(this.ctx.destination)
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
    source.connect(gain).connect(this.ctx.destination)
    this.takeSource = source
    this.takeGain = gain
    console.log('[Punchin] playTakeFromStart', { ctxTime: this.ctx.currentTime.toFixed(3), durationSec: buffer.duration.toFixed(3), gainValue })
    source.start(0, 0)
  }

  stopTake(fadeOutSec = 0) {
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
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }
    if (!this.micSource) {
      this.micSource = ctx.createMediaStreamSource(this.micStream)
    }
    if (!this.micAnalyser) {
      this.micAnalyser = ctx.createAnalyser()
      this.micAnalyser.fftSize = 256
      this.micSource.connect(this.micAnalyser)
    }
    if (!this.monitorGain) {
      this.monitorGain = ctx.createGain()
      this.monitorGain.gain.value = gainValue
      this.monitorGain.connect(ctx.destination)
    }
    this.micSource.connect(this.monitorGain)
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
        const message = event.data as { frame?: ArrayBuffer | Float32Array; startFrame?: number }
        if (!message.frame || message.startFrame === undefined) return
        const data = message.frame instanceof ArrayBuffer ? new Float32Array(message.frame) : message.frame
        this.recordingChunks.push({ data, startFrame: message.startFrame })
        if (this.recordingActive && (this.recordingChunks.length === 1 || this.recordingChunks.length % 50 === 0)) {
          console.log('[Punchin] microphone frames received', {
            chunks: this.recordingChunks.length,
            frames: this.recordingFrameCount,
          })
        }
      }
    }
    return this.recorderNode
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

  async startRecording(latencyOffsetMs = 0, sourceTimeSec?: number) {
    const ctx = await this.ensureContext()
    await this.prepareMicrophone()
    if (!this.micStream) return ctx.currentTime
    if (this.mediaRecording) throw new Error('A microphone recording is already active or finalizing')
    const preferred = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']
    const mimeType = preferred.find((type) => MediaRecorder.isTypeSupported(type))
    const recorder = mimeType ? new MediaRecorder(this.micStream, { mimeType }) : new MediaRecorder(this.micStream)
    const session: MediaRecordingSession = { recorder, blobs: [], startMs: performance.now() }
    this.mediaRecording = session
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        session.blobs.push(event.data)
        console.log('%c[REC] dataavailable', 'color:#08c', { atMs: Math.round(performance.now() - session.startMs), size: event.data.size, blobs: session.blobs.length })
      }
    }
    recorder.start()
    this.recordingActive = true
    const micTracks = this.micStream.getAudioTracks().map((t) => ({ label: t.label, enabled: t.enabled, muted: t.muted, state: t.readyState }))
    console.log('%c[REC] START', 'color:#fff;background:#08c;padding:2px 6px', {
      ctxTime: ctx.currentTime.toFixed(3),
      sampleRate: ctx.sampleRate,
      mimeType: recorder.mimeType,
      recorderState: recorder.state,
      latencyOffsetMs,
      sourceTimeSec,
      micTracks,
    })
    const startAt = applyLatencyOffset(ctx.currentTime, latencyOffsetMs)
    return startAt
  }

  async stopRecording(latencyOffsetMs = 0, maxDurationSec?: number): Promise<AudioBuffer | undefined> {
    if (!this.ctx || !this.mediaRecording) {
      console.warn('%c[REC] STOP called with no active recorder', 'color:#c00')
      return undefined
    }
    const session = this.mediaRecording
    const { recorder } = session
    const elapsedMs = Math.round(performance.now() - session.startMs)
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    this.recordingActive = false
    if (this.mediaRecording === session) this.mediaRecording = undefined
    const blobs = session.blobs
    const totalBytes = blobs.reduce((sum, b) => sum + b.size, 0)
    console.log('%c[REC] STOP', 'color:#fff;background:#084;padding:2px 6px', {
      elapsedMsSinceStart: elapsedMs,
      latencyOffsetMs,
      requestedMaxDurationSec: maxDurationSec,
      numBlobs: blobs.length,
      totalBytes,
    })
    if (!blobs.length) {
      console.warn('%c[REC] no blobs captured — mic produced nothing', 'color:#c00')
      return undefined
    }
    const blob = new Blob(blobs, { type: blobs[0].type })
    let decoded: AudioBuffer
    try {
      decoded = await this.ctx.decodeAudioData(await blob.arrayBuffer())
    } catch (err) {
      console.error('%c[REC] decode failed', 'color:#c00', err)
      return undefined
    }
    // Analyse the RAW captured audio (before any trimming) so we can see where
    // the actual voice sits in the recording window.
    this.logBufferProfile('RAW CAPTURE (pre-trim)', decoded)
    const maxFrames = maxDurationSec === undefined
      ? decoded.length
      : Math.min(decoded.length, Math.ceil(maxDurationSec * decoded.sampleRate))
    if (maxFrames === 0) return undefined
    const out = this.ctx.createBuffer(1, maxFrames, decoded.sampleRate)
    out.getChannelData(0).set(decoded.getChannelData(0).subarray(0, maxFrames))
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
