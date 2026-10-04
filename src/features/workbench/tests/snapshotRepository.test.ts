import { describe, expect, it } from 'vitest'
import { LocalSnapshotRepository, SNAPSHOT_STORAGE_KEY } from '../snapshotRepository'
import type { StorageService } from '../storageService'
import { createPlan } from '../../../shared/models'
import { createSnapshot, type PlanSnapshot } from '../../../shared/snapshotModels'

function memoryStorage(initial: string | null = null): StorageService & { readLastKey: () => string | null } {
  let value = initial
  let lastKey: string | null = null
  return {
    read: async (key?: string) => { lastKey = key ?? null; return value },
    write: async (next: string, key?: string) => { lastKey = key ?? null; value = next },
    readLastKey: () => lastKey,
  }
}

function snapshot(): PlanSnapshot {
  return createSnapshot(createPlan('方案', false), 'manual', 0, '定稿')
}

describe('local snapshot repository', () => {
  it('round trips a snapshot store', async () => {
    const storage = memoryStorage()
    const repository = new LocalSnapshotRepository(storage)
    const snapshots = [snapshot(), snapshot()]
    await repository.save(snapshots)
    expect(storage.readLastKey()).toBe(SNAPSHOT_STORAGE_KEY)
    const loaded = await repository.load()
    expect(loaded).toHaveLength(2)
    expect(loaded[0]).toEqual(snapshots[0])
  })

  it('returns an empty list when nothing is stored', async () => {
    const repository = new LocalSnapshotRepository(memoryStorage())
    await expect(repository.load()).resolves.toEqual([])
  })

  it('falls back when stored JSON is damaged', async () => {
    const repository = new LocalSnapshotRepository(memoryStorage('{broken'))
    await expect(repository.load()).resolves.toEqual([])
  })

  it('drops a single corrupt snapshot while keeping readable ones', async () => {
    const good = snapshot()
    const raw = JSON.stringify({
      version: 1,
      snapshots: [good, { id: 'broken', kind: 'nope' }],
    })
    const repository = new LocalSnapshotRepository(memoryStorage(raw))
    const loaded = await repository.load()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(good.id)
  })

  it('rejects an unversioned payload', async () => {
    const raw = JSON.stringify({ snapshots: [snapshot()] })
    const repository = new LocalSnapshotRepository(memoryStorage(raw))
    await expect(repository.load()).resolves.toEqual([])
  })
})
