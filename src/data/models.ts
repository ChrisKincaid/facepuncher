export interface Project {
  id: string
  name: string
  sampleRate: number
  createdAt: string
  latencyOffsetMs: number
  beat: {
    fileId: string
    durationSec: number
    bpm: number
    offsetSec?: number
    bar1AnchorTime?: number
    timeSig: { beatsPerBar: number; beatUnit: number }
  }
  bars: Bar[]
  takes: Take[]
  mix: MixSettings
}

export interface Bar {
  index: number
  startSec: number
  endSec: number
  locked?: boolean
  section?: string
}

export interface Take {
  takeId: string
  barIndex: number
  fileId: string
  gain: number
  selected: boolean
  locked?: boolean
  createdAt: string
}

export interface MixSettings {
  masterBeatGain: number
  globalVocalGain: number
}

export interface PlaybackState {
  isPlaying: boolean
  currentTime: number
}
