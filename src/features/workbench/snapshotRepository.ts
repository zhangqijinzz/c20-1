import { isPlanSnapshot, type PlanSnapshot, type SnapshotStore } from '../../shared/snapshotModels'
import type { StorageService } from './storageService'
import { BrowserStorageService } from './storageService'

export const SNAPSHOT_STORAGE_KEY = 'focusdesk.snapshots.v1'

export interface SnapshotRepository {
  load(): Promise<PlanSnapshot[]>
  save(snapshots: PlanSnapshot[]): Promise<void>
}

export class LocalSnapshotRepository implements SnapshotRepository {
  constructor(
    private readonly storage: StorageService = new BrowserStorageService(),
    private readonly key: string = SNAPSHOT_STORAGE_KEY,
  ) {}

  async load(): Promise<PlanSnapshot[]> {
    try {
      const raw = await this.storage.read(this.key)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!isSnapshotStore(parsed)) return []
      // 逐条过滤损坏记录，单条坏数据不影响整份历史可读
      return parsed.snapshots.filter(isPlanSnapshot)
    } catch {
      return []
    }
  }

  async save(snapshots: PlanSnapshot[]): Promise<void> {
    const store: SnapshotStore = { version: 1, snapshots }
    await this.storage.write(JSON.stringify(store), this.key)
  }
}

function isSnapshotStore(value: unknown): value is SnapshotStore {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SnapshotStore>
  return candidate.version === 1 && Array.isArray(candidate.snapshots)
}
