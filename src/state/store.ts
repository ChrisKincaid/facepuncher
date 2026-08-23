import { create } from 'zustand'
import type { Bar, MixSettings, Project, PunchMode, Take } from '../data/models'

interface UIState {
  currentBarIndex: number
  mode: PunchMode
  autoAdvance: boolean
  loopCurrentBar: boolean
  countInBars: number
  preRollMs: number
  isRecording: boolean
  audioUrl?: string
  beatFile?: File
}

interface StoreState extends UIState {
  project: Project
  setProject: (project: Project) => void
  setBeatMeta: (meta: { fileId: string; durationSec: number; bpm: number; offsetSec?: number; timeSig: { beatsPerBar: number; beatUnit: number } }) => void
  setBars: (bars: Bar[]) => void
  setAudioUrl: (url?: string) => void
  setBeatFile: (file?: File) => void
  setMode: (mode: PunchMode) => void
  setCurrentBar: (index: number) => void
  setLoop: (enabled: boolean) => void
  setAutoAdvance: (enabled: boolean) => void
  setCountIn: (bars: number) => void
  setPreRoll: (ms: number) => void
  setRecording: (flag: boolean) => void
  setLatencyOffset: (ms: number) => void
  addTake: (barIndex: number, fileId: string, gain: number) => { ok: boolean; reason?: string; take?: Take }
  selectTake: (barIndex: number, takeId: string) => void
  deleteTake: (takeId: string) => void
  updateMix: (mix: Partial<MixSettings>) => void
}

const defaultProject: Project = {
  id: crypto.randomUUID(),
  name: 'Untitled Punch',
  sampleRate: 44100,
  createdAt: new Date().toISOString(),
  latencyOffsetMs: 0,
  beat: {
    fileId: '',
    durationSec: 0,
    bpm: 0,
    offsetSec: 0,
    timeSig: { beatsPerBar: 4, beatUnit: 4 },
  },
  bars: [],
  takes: [],
  mix: {
    masterBeatGain: 0.9,
    globalVocalGain: 1,
    barGains: {},
  },
}

export const useStore = create<StoreState>((set, get) => ({
  project: defaultProject,
  currentBarIndex: 0,
  mode: 'punch',
  autoAdvance: true,
  loopCurrentBar: false,
  countInBars: 1,
  preRollMs: 250,
  isRecording: false,

  setProject(project) {
    set({ project })
  },

  setBeatMeta(meta) {
    set((state) => ({ project: { ...state.project, beat: meta } }))
  },

  setBars(bars) {
    set((state) => ({ project: { ...state.project, bars } }))
  },

  setAudioUrl(url) {
    set({ audioUrl: url })
  },

  setBeatFile(file) {
    set({ beatFile: file })
  },

  setMode(mode) {
    set({ mode })
  },

  setCurrentBar(index) {
    const nextIndex = Math.max(0, Math.min(index, get().project.bars.length - 1))
    set({ currentBarIndex: Number.isNaN(nextIndex) ? 0 : nextIndex })
  },

  setLoop(enabled) {
    set({ loopCurrentBar: enabled })
  },

  setAutoAdvance(enabled) {
    set({ autoAdvance: enabled })
  },

  setCountIn(bars) {
    set({ countInBars: Math.max(0, Math.min(4, bars)) })
  },

  setPreRoll(ms) {
    set({ preRollMs: Math.max(0, Math.min(2000, ms)) })
  },

  setRecording(flag) {
    set({ isRecording: flag })
  },

  setLatencyOffset(ms) {
    set((state) => ({ project: { ...state.project, latencyOffsetMs: ms } }))
  },

  addTake(barIndex, fileId, gain) {
    const state = get()
    const current = state.project.takes.filter((t) => t.barIndex === barIndex)
    if (current.length >= 5) {
      return { ok: false, reason: 'max-takes' }
    }
    const take: Take = {
      takeId: crypto.randomUUID(),
      barIndex,
      fileId,
      gain,
      selected: true,
      createdAt: new Date().toISOString(),
    }
    const takes = state.project.takes.map((t) =>
      t.barIndex === barIndex ? { ...t, selected: false } : t,
    )
    takes.push(take)
    set({ project: { ...state.project, takes } })
    return { ok: true, take }
  },

  selectTake(barIndex, takeId) {
    set((state) => {
      const takes = state.project.takes.map((t) =>
        t.barIndex === barIndex ? { ...t, selected: t.takeId === takeId } : t,
      )
      return { project: { ...state.project, takes } }
    })
  },

  deleteTake(takeId) {
    set((state) => {
      const takes = state.project.takes.filter((t) => t.takeId !== takeId)
      return { project: { ...state.project, takes } }
    })
  },

  updateMix(mix) {
    set((state) => ({ project: { ...state.project, mix: { ...state.project.mix, ...mix } } }))
  },
}))
