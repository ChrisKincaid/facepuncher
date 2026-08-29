import { getBytes, getDownloadURL, getMetadata, listAll, ref } from 'firebase/storage'
import { storage } from './firebase'

// Files can live directly under this folder, or in the top-level bucket root.
const PRESETS_FOLDERS = ['punchrap_fist_presets', '']

export interface FistPreset {
  id: string
  /** Full Storage path (e.g. punchrap_fist_presets/foo.fist), used to re-derive a storage ref for downloads. */
  path: string
  title: string
  fileUrl: string
  uploadDate?: string
}

function stripExtension(name: string) {
  return name.replace(/\.fist$/i, '')
}

/** Lists the preset .fist files available in Firebase Storage. */
export async function fetchFistPresets(): Promise<FistPreset[]> {
  for (const folder of PRESETS_FOLDERS) {
    let listing
    try {
      listing = await listAll(ref(storage, folder))
    } catch (err) {
      console.error(`Preset list fetch failed for folder "${folder}":`, err)
      continue
    }
    const fistItems = listing.items.filter((item) => /\.fist$/i.test(item.name))
    if (!fistItems.length) continue

    console.log(`Raw Preset Files (${folder || 'root'}):`, fistItems.map((item) => item.fullPath))
    const presets = await Promise.all(
      fistItems.map(async (item): Promise<FistPreset | null> => {
        try {
          const [fileUrl, metadata] = await Promise.all([getDownloadURL(item), getMetadata(item)])
          return {
            id: item.fullPath,
            path: item.fullPath,
            title: stripExtension(item.name),
            fileUrl,
            uploadDate: metadata.timeCreated,
          }
        } catch (err) {
          console.error(`Could not read preset "${item.fullPath}":`, err)
          return null
        }
      }),
    )
    const usable = presets.filter((p): p is FistPreset => p !== null)
    usable.sort((a, b) => (b.uploadDate ?? '').localeCompare(a.uploadDate ?? ''))
    return usable
  }
  return []
}

/** Downloads a preset's .fist file straight through the Storage SDK (avoids browser CORS on the public download URL). */
export async function downloadFistPreset(preset: FistPreset): Promise<File> {
  let arrayBuffer: ArrayBuffer
  try {
    const storageRef = ref(storage, preset.path)
    arrayBuffer = await getBytes(storageRef)
  } catch (err) {
    console.error(`Preset download failed for "${preset.title}":`, err)
    throw err
  }
  const safeName = `${preset.title.replace(/[/\\?%*:|"<>]+/g, '')}.fist`
  return new File([arrayBuffer], safeName || 'preset.fist', { type: 'application/zip' })
}
