import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type { Project } from './models'

interface PunchSchema extends DBSchema {
  projects: {
    key: string
    value: Project
  }
  blobs: {
    key: string
    value: Blob
  }
}

const DB_NAME = 'punch-recorder'
const DB_VERSION = 1

async function getDb(): Promise<IDBPDatabase<PunchSchema>> {
  return openDB<PunchSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs')
      }
    },
  })
}

export async function putBlob(key: string, blob: Blob) {
  const db = await getDb()
  await db.put('blobs', blob, key)
}

export async function getBlob(key: string) {
  const db = await getDb()
  return db.get('blobs', key)
}

export async function saveProject(project: Project) {
  const db = await getDb()
  await db.put('projects', project)
}

export async function loadProject(id: string) {
  const db = await getDb()
  return db.get('projects', id)
}

export async function listProjects() {
  const db = await getDb()
  return db.getAll('projects')
}
