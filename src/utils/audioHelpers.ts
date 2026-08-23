export function msToFrames(ms: number, sampleRate: number) {
  return Math.floor((ms / 1000) * sampleRate)
}

export function framesToMs(frames: number, sampleRate: number) {
  return (frames / sampleRate) * 1000
}

export function applyLatencyOffset(timeSec: number, offsetMs: number) {
  return timeSec + offsetMs / 1000
}

export function createSilence(durationSec: number, sampleRate: number) {
  const frames = Math.max(Math.floor(durationSec * sampleRate), 1)
  return new Float32Array(frames)
}
