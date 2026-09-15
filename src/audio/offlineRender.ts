import type { GlobalOverlayMode, MixSettings } from '../data/models'
import { encodeWavFromAudioBuffer } from './wav'

export interface RenderItem {
  buffer: AudioBuffer
  startSec: number
  gain: number
  barIndex?: number
  overlayMode: GlobalOverlayMode
  nextBarStartSec?: number
}

export interface RenderRequest {
  beatBuffer?: AudioBuffer
  takes: RenderItem[]
  durationSec: number
  mix: MixSettings
  vocalsOnly?: boolean
  sampleRate?: number
  vocalSyncMs?: number
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
    const gainValue = take.gain * (req.mix.globalVocalGain ?? 1)
    const startAt = Math.max(0, take.startSec + (req.vocalSyncMs ?? 0) / 1000)
    const nextBarStartAt = take.nextBarStartSec === undefined
      ? undefined
      : Math.max(0, take.nextBarStartSec)
    if (take.overlayMode === 'hard_cut' && nextBarStartAt !== undefined && nextBarStartAt > startAt && nextBarStartAt < startAt + take.buffer.duration) {
      takeGain.gain.setValueAtTime(gainValue, startAt)
      takeGain.gain.setValueAtTime(gainValue, Math.max(startAt, nextBarStartAt - 0.003))
      takeGain.gain.linearRampToValueAtTime(0, nextBarStartAt)
      src.stop(nextBarStartAt)
    } else {
      takeGain.gain.setValueAtTime(gainValue, startAt)
      takeGain.gain.setValueAtTime(gainValue, Math.max(startAt, startAt + take.buffer.duration - 0.008))
      takeGain.gain.linearRampToValueAtTime(0, startAt + take.buffer.duration)
    }
    src.connect(takeGain).connect(ctx.destination)
    src.start(startAt)
  })

  const rendered = await ctx.startRendering()
  return encodeWavFromAudioBuffer(rendered, false)
}
