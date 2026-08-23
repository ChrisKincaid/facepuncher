export interface BpmDetectResult {
  bpm: number        // detected beats per minute
  offsetSec: number  // seconds from file start to first beat
  confidence: number // 0–1 quality estimate
}

/**
 * BPM detection + beat-phase estimation.
 * Search range matches the editor's supported BPM range. Automatic detection
 * is only an estimate; the user can correct BPM and Bar 1 offset manually.
 */
export async function estimateBpmFromBuffer(buffer: AudioBuffer): Promise<BpmDetectResult | undefined> {
  return new Promise((resolve) => {
    setTimeout(() => {
      try { resolve(_detect(buffer)) }
      catch { resolve(undefined) }
    }, 0)
  })
}

function _detect(buffer: AudioBuffer): BpmDetectResult | undefined {
  const SR     = buffer.sampleRate
  const FRAME  = 1024
  const HOP    = 256
  const BPM_LO = 40
  const BPM_HI = 240

  // Mix to mono
  let ch = buffer.getChannelData(0)
  if (buffer.numberOfChannels > 1) {
    const r = buffer.getChannelData(1)
    const m = new Float32Array(ch.length)
    for (let i = 0; i < ch.length; i++) m[i] = (ch[i] + r[i]) * 0.5
    ch = m
  }

  const nFrames = Math.floor((ch.length - FRAME) / HOP) + 1
  if (nFrames < 40) return undefined

  // Per-frame RMS energy
  const energy = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    const s = i * HOP
    let e = 0
    for (let j = 0; j < FRAME; j++) { const v = ch[s + j] ?? 0; e += v * v }
    energy[i] = Math.sqrt(e / FRAME)
  }

  // Onset strength = half-wave rectified first difference of energy
  const onset = new Float32Array(nFrames)
  for (let i = 1; i < nFrames; i++) {
    onset[i] = Math.max(0, energy[i] - energy[i - 1])
  }

  // Normalize onset
  let maxO = 0
  for (let i = 0; i < nFrames; i++) if (onset[i] > maxO) maxO = onset[i]
  if (maxO > 0) for (let i = 0; i < nFrames; i++) onset[i] /= maxO

  // ── Find where the music actually starts ──────────────────────────────────
  // Skip a quiet intro (no drums yet) so the bar grid starts at the beat,
  // not at silence. Look for the first run of 8+ frames above 8% of peak energy.
  let maxE = 0
  for (let i = 0; i < nFrames; i++) if (energy[i] > maxE) maxE = energy[i]
  const eThresh = maxE * 0.08
  let musicStartFrame = 0
  let run = 0
  for (let i = 0; i < nFrames; i++) {
    if (energy[i] >= eThresh) {
      run++
      if (run >= 8) { musicStartFrame = Math.max(0, i - 7); break }
    } else {
      run = 0
    }
  }

  // ── Autocorrelation (from music start only) ───────────────────────────────
  const hopSec = HOP / SR
  const lagMin = Math.ceil(60 / BPM_HI / hopSec)
  const lagMax = Math.floor(60 / BPM_LO / hopSec)
  if (lagMin >= lagMax) return undefined

  const acf = new Float32Array(lagMax + 1)
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let sum = 0, n = 0
    for (let i = musicStartFrame; i + lag < nFrames; i++) {
      sum += onset[i] * onset[i + lag]
      n++
    }
    acf[lag] = n > 0 ? sum / n : 0
  }

  // Find ACF peak within hip-hop range
  let bestLag = lagMin, bestAcf = 0
  for (let lag = lagMin; lag <= lagMax; lag++) {
    if (acf[lag] > bestAcf) { bestAcf = acf[lag]; bestLag = lag }
  }

  // The ACF can peak at a subdivision (e.g. 8th notes) rather than the beat.
  // Prefer a slower competing period only when it is nearly as strong; this
  // avoids turning a clear 140 BPM track into an implausible half-time grid.
  for (const mult of [2, 3]) {
    const longerLag = Math.round(bestLag * mult)
    if (longerLag <= lagMax && acf[longerLag] >= bestAcf * 0.85) {
      bestLag  = longerLag
      bestAcf  = acf[longerLag]
      break
    }
  }

  const bpm = 60 / (bestLag * hopSec)
  if (bpm < BPM_LO - 2 || bpm > BPM_HI + 2) return undefined

  // ── Beat phase: find first beat after music starts ────────────────────────
  let bestPhase = 0, bestPhaseScore = -1
  for (let phase = 0; phase < bestLag; phase++) {
    let sum = 0, cnt = 0
    for (let i = musicStartFrame + phase; i < nFrames; i += bestLag) {
      sum += onset[i]; cnt++
    }
    const avg = cnt > 0 ? sum / cnt : 0
    if (avg > bestPhaseScore) { bestPhaseScore = avg; bestPhase = phase }
  }

  // offsetSec = time of first beat (≥ music start)
  const offsetSec = Math.round((musicStartFrame + bestPhase) * hopSec * 1000) / 1000

  // Confidence: ACF peak prominence vs mean
  let acfSum = 0
  for (let lag = lagMin; lag <= lagMax; lag++) acfSum += acf[lag]
  const acfMean = acfSum / (lagMax - lagMin + 1)
  const confidence = acfMean > 0 ? Math.max(0, Math.min(1, (bestAcf / acfMean - 1) / 3)) : 0

  return {
    bpm:       Math.round(bpm * 2) / 2,
    offsetSec,
    confidence,
  }
}
