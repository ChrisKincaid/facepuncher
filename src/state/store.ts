import { create } from 'zustand'
import type { Bar, MixSettings, Project, Take } from '../data/models'

interface UIState {
  currentBarIndex: number
  isRecording: boolean
  isVocalMuted: boolean
  loopRange?: { start: number; end: number }
  armedTakeByBar: Record<number, number[]>
  audioUrl?: string
  beatFile?: File
}

interface StoreState extends UIState {
  project: Project
  setProject: (project: Project) => void
  setBeatMeta: (meta: { fileId: string; durationSec: number; bpm: number; offsetSec?: number; bar1AnchorTime?: number; timeSig: { beatsPerBar: number; beatUnit: number } }) => void
  setBar1AnchorTime: (timeSec: number) => void
  setBars: (bars: Bar[]) => void
  setAudioUrl: (url?: string) => void
  setBeatFile: (file?: File) => void
  setCurrentBar: (index: number) => void
  setRecording: (flag: boolean) => void
  setVocalMuted: (flag: boolean) => void
  setLoopRange: (range?: { start: number; end: number }) => void
  armTake: (barIndex: number, requestedSlot: number) => void
  disarmTake: (barIndex: number, slot?: number) => void
  consumeArmedTake: (barIndex: number) => void
  setLatencyOffset: (ms: number) => void
  addTake: (barIndex: number, fileId: string, gain: number) => { ok: boolean; reason?: string; take?: Take }
  saveTake: (barIndex: number, slot: number, fileId: string, gain: number) => { ok: boolean; reason?: string; take?: Take }
  selectTake: (barIndex: number, takeId: string) => void
  clearTakeSelection: (barIndex: number) => void
  deleteTake: (takeId: string) => void
  restoreTake: (take: Take, index: number) => void
  deleteAllTakes: () => { deletedFileIds: string[] }
  toggleTakeLock: (takeId: string) => void
  setTakeGain: (takeId: string, gain: number) => void
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
    bar1AnchorTime: undefined,
    timeSig: { beatsPerBar: 4, beatUnit: 4 },
  },
  bars: [],
  takes: [],
  mix: {
    masterBeatGain: 0.9,
    globalVocalGain: 1,
  },
}

export const useStore = create<StoreState>((set, get) => ({
  project: defaultProject,
  currentBarIndex: 0,
  isRecording: false,
  isVocalMuted: false,
  loopRange: undefined,
  armedTakeByBar: {},

  setProject(project) {
    set({ project })
  },

  setBeatMeta(meta) {
    set((state) => ({ project: { ...state.project, beat: meta } }))
  },

  setBar1AnchorTime(timeSec) {
    set((state) => ({ project: { ...state.project, beat: { ...state.project.beat, offsetSec: timeSec, bar1AnchorTime: timeSec } } }))
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

  setCurrentBar(index) {
    const nextIndex = Math.max(0, Math.min(index, get().project.bars.length - 1))
    set({ currentBarIndex: Number.isNaN(nextIndex) ? 0 : nextIndex })
  },

  setRecording(flag) {
    set({ isRecording: flag })
  },

  setVocalMuted(flag) {
    set({ isVocalMuted: flag })
  },

  setLoopRange(range) {
    set({ loopRange: range })
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

  // Clears every unlocked take across all bars in one action; locked takes are kept, matching
  // the protection the per-take delete already gives them.
  deleteAllTakes() {
    const state = get()
    const deletedFileIds = state.project.takes.filter((take) => !take.locked).map((take) => take.fileId)
    const keptByBar = new Map<number, Take[]>()
    for (const take of state.project.takes) {
      if (!take.locked) continue
      const arr = keptByBar.get(take.barIndex) ?? []
      arr.push(take)
      keptByBar.set(take.barIndex, arr)
    }
    const takes: Take[] = []
    for (const barTakes of keptByBar.values()) {
      if (!barTakes.some((take) => take.selected) && barTakes[0]) barTakes[0].selected = true
      takes.push(...barTakes)
    }
    set({ project: { ...state.project, takes }, armedTakeByBar: {} })
    return { deletedFileIds }
  },

  // Re-inserts a deleted take at its original position so an undo restores the exact
  // slot ordering the user saw, not just "somewhere in this bar".
  restoreTake(take, index) {
    set((state) => {
      if (state.project.takes.some((item) => item.takeId === take.takeId)) return state
      const takes = [...state.project.takes]
      takes.splice(Math.max(0, Math.min(index, takes.length)), 0, take)
      return {
        project: {
          ...state.project,
          takes: take.selected
            ? takes.map((item) => item.barIndex === take.barIndex ? { ...item, selected: item.takeId === take.takeId } : item)
            : takes,
        },
      }
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

  setTakeGain(takeId, gain) {
    const clamped = Math.max(0, Math.min(2, gain))
    set((state) => ({
      project: {
        ...state.project,
        takes: state.project.takes.map((take) => take.takeId === takeId ? { ...take, gain: clamped } : take),
      },
    }))
  },

  updateMix(mix) {
    set((state) => ({ project: { ...state.project, mix: { ...state.project.mix, ...mix } } }))
  },
}))
