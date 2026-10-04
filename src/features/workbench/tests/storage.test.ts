import { describe, expect, it } from 'vitest'
import { LocalWorkspaceRepository } from '../workspaceRepository'
import { migrateDocument, type StorageService } from '../storageService'
import { createInitialDocument } from '../../../shared/models'

function memoryStorage(initial: string | null = null): StorageService {
  let value = initial
  return { read: async () => value, write: async (next) => { value = next } }
}

describe('local workspace repository', () => {
  it('round trips a document', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage())
    const document = createInitialDocument()
    await repository.save(document)
    await expect(repository.load()).resolves.toEqual(document)
  })

  it('falls back when stored JSON is damaged', async () => {
    const repository = new LocalWorkspaceRepository(memoryStorage('{broken'))
    await expect(repository.load()).resolves.toBeNull()
  })
})

describe('document migration', () => {
  it('upgrades a v1 document by adding an empty snapshot list', () => {
    const v1 = { version: 1, plans: createInitialDocument().plans, activePlanId: 'plan-1' }
    const migrated = migrateDocument(v1)
    expect(migrated).not.toBeNull()
    expect(migrated?.version).toBe(2)
    expect(migrated?.snapshots).toEqual([])
    expect(migrated?.plans).toBe(v1.plans)
  })

  it('drops corrupted snapshots but keeps valid ones', () => {
    const document = createInitialDocument()
    const valid = {
      id: 'snap-1', planId: document.plans[0].id, reason: 'manual', label: null,
      createdAt: new Date().toISOString(), deviceCount: 2, deskWidthMm: 1600, deskHeightMm: 800,
      issueCount: 0, plan: document.plans[0],
    }
    const migrated = migrateDocument({ ...document, snapshots: [valid, { id: 'broken' }] })
    expect(migrated?.snapshots).toHaveLength(1)
    expect(migrated?.snapshots[0].id).toBe('snap-1')
  })

  it('rejects values that are not workspace documents', () => {
    expect(migrateDocument(null)).toBeNull()
    expect(migrateDocument({ version: 3, plans: [] })).toBeNull()
  })
})
