import type { Bar } from '../data/models'
import { barDurationSec, clamp } from '../utils/time'

export function generateBars(durationSec: number, bpm: number, beatsPerBar = 4, beatUnit = 4, offsetSec = 0): Bar[] {
  if (!durationSec || !bpm) return []
  const barLen = barDurationSec(bpm, beatsPerBar, beatUnit)
  const start = clamp(offsetSec, 0, durationSec)
  const barCount = Math.max(1, Math.ceil((durationSec - start) / barLen))
  const bars: Bar[] = []
  for (let i = 0; i < barCount; i++) {
    // Every generated bar uses the same grid interval. Only the final bar may
    // be shorter because the source audio ends before the next boundary.
    const startSec = start + barLen * i
    const endSec = clamp(start + barLen * (i + 1), 0, durationSec)
    if (startSec >= durationSec) break
    bars.push({ index: i, startSec, endSec })
  }
  return bars
}

export function updateBarPosition(bars: Bar[], index: number, newStart: number, newEnd: number, allowGaps = false) {
  const next = [...bars]
  const target = next[index]
  if (!target) return bars
  const duration = target.endSec - target.startSec
  const previousEnd = index > 0 ? next[index - 1].endSec : 0
  const nextStart = index < next.length - 1 ? next[index + 1].startSec : Infinity
  const startSec = allowGaps
    ? Math.max(previousEnd, Math.min(newStart, nextStart - 0.01))
    : Math.max(0, Math.min(newStart, newEnd))
  const endSec = allowGaps
    ? Math.min(nextStart, Math.max(startSec + 0.01, newEnd))
    : Math.max(startSec + 0.01, newEnd)
  target.startSec = startSec
  target.endSec = endSec
  if (!allowGaps) {
    if (index > 0) next[index - 1].endSec = startSec
    if (index < next.length - 1) next[index + 1].startSec = endSec
    else target.endSec = Math.max(target.startSec + duration, endSec)
  }
  return next.map((bar, idx) => ({ ...bar, index: idx }))
}
