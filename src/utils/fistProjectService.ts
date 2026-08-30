import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import type { Project, Take } from '../data/models'
import { getBlob, putBlob, saveProject } from '../data/storage'

const MANIFEST_ENTRY = 'project.json'
const TAKES_DIR = 'takes'
const FIST_VERSION = 1

/** Live settings that sit outside the persisted Project but still define the session. */
export interface FistSession {
  loopEnabled: boolean
  loopRange?: { start: number; end: number }
  isVocalMuted: boolean
  monitorGain: number
}

interface FistManifest {
  version: number
  exportedAt: string
  project: Project
  session: FistSession
  beatEntry?: string
  takeEntries: Record<string, string>
}

export interface FistImportResult {
  project: Project
  session: FistSession
  beatBlob?: Blob
  /** Recorded take audio keyed by the take's fileId. */
  takeBlobs: Map<string, Blob>
}

function audioExtension(blob: Blob) {
  if (blob.type.includes('mpeg') || blob.type.includes('mp3')) return 'mp3'
  if (blob.type.includes('ogg')) return 'ogg'
  return 'wav'
}

// Reduces a user-typed project title to something every common file system accepts.
function safeFileName(name: string) {
  const cleaned = name
    .trim()
    .replace(/[\s]+/g, '_')
    .replace(/[/\\?%*:|"<>.]+/g, '')
    .replace(/[^a-z0-9_-]+/gi, '')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
  return cleaned || 'punchin-project'
}

/**
 * Bundles the project state plus every referenced audio blob into a single .fist archive
 * and hands it to the browser as a download.
 */
export async function exportProjectToFist(project: Project, session: FistSession): Promise<void> {
  const zip = new JSZip()
  const manifest: FistManifest = {
    version: FIST_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    session,
    takeEntries: {},
  }

  if (project.beat.fileId) {
    const beatBlob = await getBlob(project.beat.fileId)
    if (beatBlob) {
      manifest.beatEntry = `main_beat.${audioExtension(beatBlob)}`
      zip.file(manifest.beatEntry, beatBlob)
    }
  }

  const takesFolder = zip.folder(TAKES_DIR)
  for (const take of project.takes) {
    const takeBlob = await getBlob(take.fileId)
    if (!takeBlob || !takesFolder) continue
    const entry = `${take.fileId}.${audioExtension(takeBlob)}`
    manifest.takeEntries[take.fileId] = `${TAKES_DIR}/${entry}`
    takesFolder.file(entry, takeBlob)
  }

  zip.file(MANIFEST_ENTRY, JSON.stringify(manifest, null, 2))
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  saveAs(archive, `${safeFileName(project.name)}.fist`)
}

// The archive is user-supplied, so treat every field as untrusted and rebuild a known-shaped
// Project rather than spreading whatever JSON happens to be inside.
function coerceProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('project.json is missing project data')
  const source = raw as Partial<Project>
  if (!source.beat || typeof source.beat !== 'object') throw new Error('project.json has no beat settings')
  const timeSig = source.beat.timeSig
  const takes = Array.isArray(source.takes) ? source.takes : []
  const bars = Array.isArray(source.bars) ? source.bars : []
  return {
    id: typeof source.id === 'string' ? source.id : crypto.randomUUID(),
    name: typeof source.name === 'string' ? source.name : 'Imported Punch',
    sampleRate: Number(source.sampleRate) || 44100,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : new Date().toISOString(),
    latencyOffsetMs: Number(source.latencyOffsetMs) || 0,
    beat: {
      fileId: typeof source.beat.fileId === 'string' ? source.beat.fileId : '',
      durationSec: Number(source.beat.durationSec) || 0,
      bpm: Number(source.beat.bpm) || 0,
      offsetSec: Number(source.beat.offsetSec) || 0,
      bar1AnchorTime: typeof source.beat.bar1AnchorTime === 'number' ? source.beat.bar1AnchorTime : undefined,
      timeSig: {
        beatsPerBar: Number(timeSig?.beatsPerBar) || 4,
        beatUnit: Number(timeSig?.beatUnit) || 4,
      },
    },
    bars: bars.map((bar, index) => ({
      index: Number(bar?.index ?? index),
      startSec: Number(bar?.startSec) || 0,
      endSec: Number(bar?.endSec) || 0,
      locked: Boolean(bar?.locked),
      section: typeof bar?.section === 'string' ? bar.section : undefined,
    })),
    takes: takes
      .filter((take): take is Take => Boolean(take && typeof take.takeId === 'string' && typeof take.fileId === 'string'))
      .map((take) => ({
        takeId: take.takeId,
        barIndex: Number(take.barIndex) || 0,
        fileId: take.fileId,
        gain: typeof take.gain === 'number' ? take.gain : 1,
        selected: Boolean(take.selected),
        locked: Boolean(take.locked),
        bleedCancelled: Boolean(take.bleedCancelled),
        createdAt: typeof take.createdAt === 'string' ? take.createdAt : new Date().toISOString(),
      })),
    mix: {
      masterBeatGain: Number(source.mix?.masterBeatGain ?? 0.9),
      globalVocalGain: Number(source.mix?.globalVocalGain ?? 1),
    },
  }
}

function coerceSession(raw: unknown, barCount: number): FistSession {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<FistSession>
  const range = source.loopRange
  let loopRange: { start: number; end: number } | undefined
  if (range && typeof range === 'object' && barCount > 0) {
    const start = Math.max(0, Math.min(Number(range.start) || 0, barCount - 1))
    const end = Math.max(start, Math.min(Number(range.end) || 0, barCount - 1))
    loopRange = { start, end }
  }
  return {
    loopEnabled: Boolean(source.loopEnabled),
    loopRange,
    isVocalMuted: Boolean(source.isVocalMuted),
    monitorGain: Math.max(0, Math.min(Number(source.monitorGain ?? 0.8), 2)),
  }
}

/**
 * Reads a .fist archive, restores its audio into local storage under the original file ids,
 * and returns the rehydrated project for the caller to push into the store.
 */
export async function importProjectFromFist(file: File): Promise<FistImportResult> {
  const zip = await JSZip.loadAsync(file)
  const manifestEntry = zip.file(MANIFEST_ENTRY)
  if (!manifestEntry) throw new Error('Not a valid .fist project (project.json is missing).')

  const manifest = JSON.parse(await manifestEntry.async('string')) as Partial<FistManifest>
  const project = coerceProject(manifest.project)
  const session = coerceSession(manifest.session, project.bars.length)
  const takeEntries = (manifest.takeEntries ?? {}) as Record<string, string>

  let beatBlob: Blob | undefined
  const beatEntry = typeof manifest.beatEntry === 'string' ? zip.file(manifest.beatEntry) : null
  if (beatEntry && project.beat.fileId) {
    beatBlob = await beatEntry.async('blob')
    await putBlob(project.beat.fileId, beatBlob)
  }

  const takeBlobs = new Map<string, Blob>()
  for (const take of project.takes) {
    const entryName = takeEntries[take.fileId]
    const entry = typeof entryName === 'string' ? zip.file(entryName) : null
    if (!entry) continue
    const blob = await entry.async('blob')
    takeBlobs.set(take.fileId, blob)
    await putBlob(take.fileId, blob)
  }

  await saveProject(project)
  return { project, session, beatBlob, takeBlobs }
}
