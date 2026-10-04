import { describe, expect, it } from 'vitest'
import { createInitialDocument, createItem, createPlan, type WorkspaceDocument, type WorkspacePlan } from '../../../shared/models'
import {
  appendSnapshot,
  AUTO_SNAPSHOT_INTERVAL_MS,
  branchSnapshotAsPlan,
  createSnapshot,
  listSnapshotsForPlan,
  MAX_AUTO_SNAPSHOTS_PER_PLAN,
  MAX_SNAPSHOTS_PER_PLAN,
  restoreSnapshot,
  shouldAutoSnapshot,
} from '../historyViewModel'

const NOW = new Date('2026-10-04T12:00:00.000Z')

function planWithItems(itemCount: number): WorkspacePlan {
  const plan = createPlan('测试工作台', false)
  return { ...plan, items: Array.from({ length: itemCount }, (_, index) => createItem('monitor', index)) }
}

function documentWith(plan: WorkspacePlan): WorkspaceDocument {
  return { ...createInitialDocument(), plans: [plan], activePlanId: plan.id, snapshots: [] }
}

describe('auto snapshot gating', () => {
  it('takes the first snapshot once a plan has items', () => {
    const plan = planWithItems(2)
    expect(shouldAutoSnapshot([], plan, NOW)).toBe(true)
  })

  it('skips empty plans to avoid noise', () => {
    const plan = planWithItems(0)
    expect(shouldAutoSnapshot([], plan, NOW)).toBe(false)
  })

  it('skips when content is unchanged since the latest snapshot', () => {
    const plan = planWithItems(2)
    const snapshot = createSnapshot(plan, 0, 'auto', null, new Date(NOW.getTime() - AUTO_SNAPSHOT_INTERVAL_MS * 2))
    expect(shouldAutoSnapshot([snapshot], plan, NOW)).toBe(false)
  })

  it('waits for the interval after a recent snapshot', () => {
    const plan = planWithItems(2)
    const snapshot = createSnapshot(plan, 0, 'auto', null, new Date(NOW.getTime() - AUTO_SNAPSHOT_INTERVAL_MS / 2))
    const moved = { ...plan, items: plan.items.map((item) => ({ ...item, x: item.x + 50 })) }
    expect(shouldAutoSnapshot([snapshot], moved, NOW)).toBe(false)
  })

  it('snapshots again once the interval elapsed and content changed', () => {
    const plan = planWithItems(2)
    const snapshot = createSnapshot(plan, 0, 'auto', null, new Date(NOW.getTime() - AUTO_SNAPSHOT_INTERVAL_MS - 1000))
    const moved = { ...plan, items: plan.items.map((item) => ({ ...item, x: item.x + 50 })) }
    expect(shouldAutoSnapshot([snapshot], moved, NOW)).toBe(true)
  })
})

describe('snapshot retention', () => {
  it('caps auto snapshots per plan and drops the oldest first', () => {
    const plan = planWithItems(1)
    let snapshots = [] as WorkspaceDocument['snapshots']
    for (let index = 0; index < MAX_AUTO_SNAPSHOTS_PER_PLAN + 5; index += 1) {
      const created = new Date(NOW.getTime() + index * 1000)
      const changed = { ...plan, items: plan.items.map((item) => ({ ...item, x: item.x + index })) }
      snapshots = appendSnapshot(snapshots, createSnapshot(changed, 0, 'auto', null, created))
    }
    const kept = listSnapshotsForPlan(snapshots, plan.id)
    expect(kept).toHaveLength(MAX_AUTO_SNAPSHOTS_PER_PLAN)
    expect(kept.every((snapshot) => snapshot.reason === 'auto')).toBe(true)
    expect(kept[0].createdAt > kept[kept.length - 1].createdAt).toBe(true)
  })

  it('keeps manual snapshots while pruning auto ones, and caps the total', () => {
    const plan = planWithItems(1)
    let snapshots = [] as WorkspaceDocument['snapshots']
    for (let index = 0; index < MAX_SNAPSHOTS_PER_PLAN + 4; index += 1) {
      const created = new Date(NOW.getTime() + index * 1000)
      const reason = index % 2 === 0 ? 'manual' : 'auto'
      snapshots = appendSnapshot(snapshots, createSnapshot(plan, 0, reason, reason === 'manual' ? `版本 ${index}` : null, created))
    }
    const kept = listSnapshotsForPlan(snapshots, plan.id)
    expect(kept.length).toBeLessThanOrEqual(MAX_SNAPSHOTS_PER_PLAN)
    expect(kept.filter((snapshot) => snapshot.reason === 'auto').length).toBeLessThanOrEqual(MAX_AUTO_SNAPSHOTS_PER_PLAN)
    expect(kept.filter((snapshot) => snapshot.reason === 'manual').length).toBeGreaterThan(0)
  })

  it('does not prune snapshots belonging to other plans', () => {
    const first = planWithItems(1)
    const second = planWithItems(1)
    let snapshots = [] as WorkspaceDocument['snapshots']
    for (let index = 0; index < MAX_SNAPSHOTS_PER_PLAN + 3; index += 1) {
      snapshots = appendSnapshot(snapshots, createSnapshot(first, 0, 'auto', null, new Date(NOW.getTime() + index * 1000)))
    }
    snapshots = appendSnapshot(snapshots, createSnapshot(second, 0, 'manual', '另一条线', NOW))
    expect(listSnapshotsForPlan(snapshots, second.id)).toHaveLength(1)
  })
})

describe('restoreSnapshot', () => {
  it('restores the plan content wholesale while keeping the plan id', () => {
    const original = planWithItems(2)
    const snapshot = createSnapshot(original, 0, 'manual', '满意的一版', new Date(NOW.getTime() - 60_000))
    const current: WorkspacePlan = { ...original, deskWidthMm: 2000, items: [...original.items, createItem('lamp', 3)] }
    const document = { ...documentWith(current), snapshots: [snapshot] }

    const outcome = restoreSnapshot(document, snapshot.id, 1, NOW)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const restored = outcome.document.plans.find((plan) => plan.id === original.id)
    expect(restored?.items).toHaveLength(2)
    expect(restored?.deskWidthMm).toBe(original.deskWidthMm)
    expect(restored?.updatedAt).toBe(NOW.toISOString())
  })

  it('leaves a safety snapshot of the pre-restore state', () => {
    const original = planWithItems(2)
    const snapshot = createSnapshot(original, 0, 'auto', null, new Date(NOW.getTime() - 60_000))
    const current: WorkspacePlan = { ...original, items: [...original.items, createItem('lamp', 3)] }
    const document = { ...documentWith(current), snapshots: [snapshot] }

    const outcome = restoreSnapshot(document, snapshot.id, 0, NOW)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const safety = listSnapshotsForPlan(outcome.document.snapshots, original.id)[0]
    expect(safety.label).toBe('恢复前自动留存')
    expect(safety.deviceCount).toBe(3)
  })

  it('does not mutate the document it was given', () => {
    const original = planWithItems(2)
    const snapshot = createSnapshot(original, 0, 'auto', null, new Date(NOW.getTime() - 60_000))
    const document = { ...documentWith(original), snapshots: [snapshot] }
    const plansBefore = document.plans
    restoreSnapshot(document, snapshot.id, 0, NOW)
    expect(document.plans).toBe(plansBefore)
    expect(document.plans[0].items).toHaveLength(2)
  })

  it('refuses unknown or corrupted snapshots without touching the plan', () => {
    const plan = planWithItems(2)
    const document = documentWith(plan)
    expect(restoreSnapshot(document, 'snap-missing', 0, NOW).ok).toBe(false)
    const broken = { ...createSnapshot(plan, 0, 'auto', null, NOW), plan: { name: '坏掉的' } }
    const withBroken = { ...document, snapshots: [broken] as WorkspaceDocument['snapshots'] }
    const outcome = restoreSnapshot(withBroken, broken.id, 0, NOW)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('损坏')
  })

  it('refuses to restore when the owning plan was deleted', () => {
    const plan = planWithItems(2)
    const snapshot = createSnapshot(plan, 0, 'manual', null, NOW)
    const document = { ...documentWith(planWithItems(1)), snapshots: [snapshot] }
    const outcome = restoreSnapshot(document, snapshot.id, 0, NOW)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain('另存为新方案')
  })
})

describe('branchSnapshotAsPlan', () => {
  it('creates a new active plan with fresh ids and keeps the snapshot list intact', () => {
    const original = planWithItems(2)
    const snapshot = createSnapshot(original, 0, 'manual', '分支点', new Date(NOW.getTime() - 60_000))
    const document = { ...documentWith(original), snapshots: [snapshot] }

    const outcome = branchSnapshotAsPlan(document, snapshot.id, NOW)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.plans).toHaveLength(2)
    const branched = outcome.document.plans[1]
    expect(outcome.document.activePlanId).toBe(branched.id)
    expect(branched.id).not.toBe(original.id)
    expect(branched.name).toContain('历史版本')
    expect(branched.items.map((item) => item.id)).not.toContain(original.items[0].id)
    expect(outcome.document.snapshots).toHaveLength(1)
    expect(outcome.document.plans[0]).toBe(original)
  })

  it('still branches when the owning plan was deleted', () => {
    const gone = planWithItems(2)
    const snapshot = createSnapshot(gone, 0, 'manual', null, NOW)
    const document = { ...documentWith(planWithItems(1)), snapshots: [snapshot] }
    const outcome = branchSnapshotAsPlan(document, snapshot.id, NOW)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.document.plans).toHaveLength(2)
  })
})
