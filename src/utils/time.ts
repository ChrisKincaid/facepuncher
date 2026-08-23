import type { Bar } from '../data/models'

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function barDurationSec(bpm: number, beatsPerBar = 4, beatUnit = 4) {
  const beatDur = 60 / bpm
  const beatsPerMeasure = beatsPerBar * (4 / beatUnit)
  return beatDur * beatsPerMeasure
}

export function secondsToBars(durationSec: number, bpm: number, beatsPerBar = 4, beatUnit = 4) {
  const barSec = barDurationSec(bpm, beatsPerBar, beatUnit)
  return durationSec / barSec
}

export function barsToSeconds(bars: number, bpm: number, beatsPerBar = 4, beatUnit = 4) {
  return barDurationSec(bpm, beatsPerBar, beatUnit) * bars
}

export function formatTime(seconds: number) {
  const safe = Math.max(seconds, 0)
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  const ms = Math.floor((safe % 1) * 1000)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms
    .toString()
    .padStart(3, '0')}`
}

export function nearestBarIndex(time: number, bars: Bar[]) {
  if (!bars.length) return 0
  let closest = 0
  let min = Number.MAX_VALUE
  bars.forEach((bar, idx) => {
    const mid = (bar.startSec + bar.endSec) / 2
    const diff = Math.abs(time - mid)
    if (diff < min) {
      min = diff
      closest = idx
    }
  })
  return closest
}
