import type { WorkspaceDocument } from '../../shared/models'

export const STORAGE_KEY = 'focusdesk.document.v1'
const DATABASE_NAME = 'focusdesk-db'
const STORE_NAME = 'workspace'

export interface StorageService {
  read(key?: string): Promise<string | null>
  write(value: string, key?: string): Promise<void>
}

export class BrowserStorageService implements StorageService {
  async read(key: string = STORAGE_KEY): Promise<string | null> {
    try {
      const database = await openDatabase()
      const value = await readFromDatabase(database, key)
      database.close()
      return typeof value === 'string' ? value : window.localStorage.getItem(key)
    } catch {
      return window.localStorage.getItem(key)
    }
  }

  async write(value: string, key: string = STORAGE_KEY): Promise<void> {
    try {
      const database = await openDatabase()
      await writeToDatabase(database, value, key)
      database.close()
    } catch {
      window.localStorage.setItem(key, value)
    }
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function readFromDatabase(database: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
  })
}

function writeToDatabase(database: IDBDatabase, value: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
  })
}

export function isWorkspaceDocument(value: unknown): value is WorkspaceDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<WorkspaceDocument>
  return candidate.version === 1 && Array.isArray(candidate.plans) && typeof candidate.activePlanId === 'string'
}
