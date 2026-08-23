import { applyLatencyOffset, msToFrames } from '../utils/audioHelpers'

export class AudioEngine {
  private ctx?: AudioContext
  private beatBuffer?: AudioBuffer
  private beatGain?: GainNode
  private beatSource?: AudioBufferSourceNode
  private monitorGain?: GainNode
  private micStream?: MediaStream
  private micSource?: MediaStreamAudioSourceNode
  private recorderNode?: AudioWorkletNode
  private recordingChunks: Float32Array[] = []
  private playingOffset = 0
  private playStartedAt = 0
  private isPlaying = false
  private masterGainValue = 1
  private loopRegion?: { start: number; end: number }

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new AudioContext()
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
    void this.ctx.resume()
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
        const data = event.data as ArrayBuffer | Float32Array
        if (data instanceof ArrayBuffer) {
          this.recordingChunks.push(new Float32Array(data))
        } else {
          this.recordingChunks.push(data)
        }
      }
    }
    return this.recorderNode
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

  async startRecording(latencyOffsetMs = 0) {
    const ctx = await this.ensureContext()
    const node = await this.prepareRecorder()
    if (!this.micStream) {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    }
    if (!this.micSource) {
      this.micSource = ctx.createMediaStreamSource(this.micStream)
    }
    this.recordingChunks = []
    this.micSource.connect(node)
    node.connect(ctx.destination)
    const startAt = applyLatencyOffset(ctx.currentTime, latencyOffsetMs)
    return startAt
  }

  async stopRecording(latencyOffsetMs = 0) {
    if (!this.ctx || !this.recorderNode) return undefined
    try {
      this.recorderNode.disconnect()
    } catch (err) {
      console.error('recorder disconnect', err)
    }
    const totalFrames = this.recordingChunks.reduce((acc, arr) => acc + arr.length, 0)
    if (totalFrames === 0) return undefined
    const buffer = this.ctx.createBuffer(1, totalFrames, this.ctx.sampleRate)
    const channel = buffer.getChannelData(0)
    let offset = 0
    for (const chunk of this.recordingChunks) {
      channel.set(chunk, offset)
      offset += chunk.length
    }
    // Apply latency offset by trimming or padding frames
    const shiftFrames = msToFrames(latencyOffsetMs, this.ctx.sampleRate)
    if (shiftFrames > 0 && shiftFrames < buffer.length) {
      const trimmed = this.ctx.createBuffer(1, buffer.length - shiftFrames, this.ctx.sampleRate)
      trimmed.copyToChannel(channel.subarray(shiftFrames), 0)
      return trimmed
    }
    return buffer
  }
}

export const audioEngine = new AudioEngine()
