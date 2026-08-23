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
  armedTakeByBar: Record<number, number[]>
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
  armTake: (barIndex: number, requestedSlot: number) => void
  disarmTake: (barIndex: number, slot?: number) => void
  consumeArmedTake: (barIndex: number) => void
  setLatencyOffset: (ms: number) => void
  addTake: (barIndex: number, fileId: string, gain: number) => { ok: boolean; reason?: string; take?: Take }
  saveTake: (barIndex: number, slot: number, fileId: string, gain: number) => { ok: boolean; reason?: string; take?: Take }
  selectTake: (barIndex: number, takeId: string) => void
  clearTakeSelection: (barIndex: number) => void
  deleteTake: (takeId: string) => void
  toggleTakeLock: (takeId: string) => void
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
  armedTakeByBar: {},

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

  armTake(barIndex, requestedSlot) {
    const takes = get().project.takes.filter((take) => take.barIndex === barIndex)
    const armed = get().armedTakeByBar[barIndex] ?? []
    if (takes.length + armed.length >= 5) return
    const slot = Math.min(Math.max(0, requestedSlot), takes.length + armed.length)
    if (armed.includes(slot)) return
      console.log('[Punchin] take armed', { barIndex, slot, requestedSlot })
    set((state) => ({ armedTakeByBar: { ...state.armedTakeByBar, [barIndex]: [...armed, slot].sort((a, b) => a - b) } }))
  },

  disarmTake(barIndex, slot) {
    set((state) => {
      const armed = { ...state.armedTakeByBar }
      if (slot === undefined) delete armed[barIndex]
      else {
        const remaining = (armed[barIndex] ?? []).filter((item) => item !== slot)
        if (remaining.length) armed[barIndex] = remaining
        else delete armed[barIndex]
      }
      return { armedTakeByBar: armed }
    })
  },

  consumeArmedTake(barIndex) {
    set((state) => {
      const armed = { ...state.armedTakeByBar }
      const slots = armed[barIndex] ?? []
      if (slots.length <= 1) delete armed[barIndex]
      else armed[barIndex] = slots.slice(1)
      return { armedTakeByBar: armed }
    })
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

  saveTake(barIndex, slot, fileId, gain) {
    const state = get()
    const current = state.project.takes.filter((take) => take.barIndex === barIndex)
    if (slot < 0 || slot > 4 || slot > current.length) return { ok: false, reason: 'invalid-slot' }
    const existing = current[slot]
    if (existing?.locked) return { ok: false, reason: 'locked' }
    const take: Take = {
      takeId: existing?.takeId ?? crypto.randomUUID(),
      barIndex,
      fileId,
      gain,
      selected: true,
      locked: existing?.locked,
      createdAt: new Date().toISOString(),
    }
    const barTakes = current.map((item, index) => index === slot ? take : item)
    if (slot === current.length) barTakes.push(take)
    const takes = state.project.takes
      .filter((item) => item.barIndex !== barIndex)
      .concat(barTakes.map((item) => ({ ...item, selected: item.takeId === take.takeId })))
    set((state) => ({ project: { ...state.project, takes } }))
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

  clearTakeSelection(barIndex) {
    set((state) => ({
      project: {
        ...state.project,
        takes: state.project.takes.map((take) => take.barIndex === barIndex ? { ...take, selected: false } : take),
      },
    }))
  },

  deleteTake(takeId) {
    set((state) => {
      const target = state.project.takes.find((take) => take.takeId === takeId)
      if (!target || target.locked) return state
      const remaining = state.project.takes.filter((take) => take.takeId !== takeId)
      const barTakes = remaining.filter((take) => take.barIndex === target.barIndex)
      if (!barTakes.some((take) => take.selected) && barTakes[0]) barTakes[0].selected = true
      return { project: { ...state.project, takes: remaining } }
    })
  },

  toggleTakeLock(takeId) {
    set((state) => ({
      project: {
        ...state.project,
        takes: state.project.takes.map((take) => take.takeId === takeId ? { ...take, locked: !take.locked } : take),
      },
    }))
  },

  updateMix(mix) {
    set((state) => ({ project: { ...state.project, mix: { ...state.project.mix, ...mix } } }))
  },
}))
