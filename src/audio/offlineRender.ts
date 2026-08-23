import type { MixSettings } from '../data/models'
import { encodeWavFromAudioBuffer } from './wav'

export interface RenderItem {
  buffer: AudioBuffer
  startSec: number
  gain: number
  barIndex?: number
}

export interface RenderRequest {
  beatBuffer?: AudioBuffer
  takes: RenderItem[]
  durationSec: number
  mix: MixSettings
  vocalsOnly?: boolean
  sampleRate?: number
}

export async function renderOffline(req: RenderRequest) {
  const sampleRate = req.sampleRate || req.beatBuffer?.sampleRate || 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(sampleRate * req.durationSec), sampleRate)

  // Beat path
  if (req.beatBuffer && !req.vocalsOnly) {
    const beatSource = ctx.createBufferSource()
    beatSource.buffer = req.beatBuffer
    const beatGain = ctx.createGain()
    beatGain.gain.value = req.mix.masterBeatGain ?? 1
    beatSource.connect(beatGain).connect(ctx.destination)
    beatSource.start(0)
  }

  // Takes path
  req.takes.forEach((take) => {
    const src = ctx.createBufferSource()
    src.buffer = take.buffer
    const takeGain = ctx.createGain()
    const perBar = take.barIndex !== undefined ? req.mix.barGains?.[take.barIndex] ?? 1 : 1
    takeGain.gain.value = take.gain * (req.mix.globalVocalGain ?? 1) * perBar
    src.connect(takeGain).connect(ctx.destination)
    src.start(take.startSec)
  })

  const rendered = await ctx.startRendering()
  return encodeWavFromAudioBuffer(rendered, false)
}
