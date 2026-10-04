import { describe, expect, it } from 'vitest'
import { createPlan, createItem } from '../../shared/models'
import {
  SNAPSHOT_LIMITS,
  appendSnapshot,
  applySnapshotToPlan,
  cloneSnapshotToPlan,
  createSnapshot,
  formatSnapshotTime,
  isPlanSnapshot,
  pruneSnapshotsForPlans,
  snapshotFingerprint,
  snapshotTitle,
  snapshotTrend,
  type PlanSnapshot,
} from '../snapshotModels'

function makePlan(overrides: Partial<ReturnType<typeof createPlan>> = {}) {
  return { ...createPlan('测试方案', false), ...overrides }
}

function makeSnapshot(overrides: Partial<PlanSnapshot> = {}): PlanSnapshot {
  const plan = overrides.items || overrides.deskWidthMm || overrides.deskHeightMm
    ? makePlan({
      items: (overrides.items ?? []) as PlanSnapshot['items'],
      deskWidthMm: overrides.deskWidthMm ?? 1600,
      deskHeightMm: overrides.deskHeightMm ?? 800,
    })
    : makePlan()
  return {
    ...createSnapshot(plan, 'auto', 0),
    planId: 'plan-test',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('createSnapshot', () => {
  it('captures layout content and issue count', () => {
    const plan = makePlan({ items: [createItem('monitor', 0)], deskWidthMm: 1200, deskHeightMm: 700 })
    const snapshot = createSnapshot(plan, 'manual', 3, '定稿')
    expect(snapshot.planId).toBe(plan.id)
    expect(snapshot.kind).toBe('manual')
    expect(snapshot.name).toBe('定稿')
    expect(snapshot.itemCount).toBe(1)
    expect(snapshot.issueCount).toBe(3)
    expect(snapshot.deskWidthMm).toBe(1200)
    expect(snapshot.deskHeightMm).toBe(700)
    // 深拷贝：之后移动原方案的设备不影响快照
    expect(snapshot.items).not.toBe(plan.items)
    expect(snapshot.items[0]).not.toBe(plan.items[0])
  })

  it('trims and truncates manual names, and clears names for non-manual snapshots', () => {
    const plan = makePlan()
    expect(createSnapshot(plan, 'manual', 0, '  双屏  ').name).toBe('双屏')
    const longName = '很'.repeat(60)
    expect(createSnapshot(plan, 'manual', 0, longName).name).toHaveLength(SNAPSHOT_LIMITS.nameMaxLength)
    expect(createSnapshot(plan, 'auto', 0, 'ignored').name).toBeNull()
  })
})

describe('snapshotFingerprint', () => {
  it('stays identical when only metadata changes', () => {
    const plan = makePlan({ items: [createItem('monitor', 0)] })
    const fingerprint = snapshotFingerprint(plan)
    const renamed = { ...plan, name: '另一个名字', updatedAt: new Date(0).toISOString() }
    expect(snapshotFingerprint(renamed)).toBe(fingerprint)
  })

  it('changes when position, size, rotation, desk size or item set changes', () => {
    const plan = makePlan({ items: [createItem('monitor', 0)] })
    const base = snapshotFingerprint(plan)
    const item = plan.items[0]
    expect(snapshotFingerprint({ ...plan, items: [{ ...item, x: item.x + 10 }] })).not.toBe(base)
    expect(snapshotFingerprint({ ...plan, items: [{ ...item, rotation: 90 }] })).not.toBe(base)
    expect(snapshotFingerprint({ ...plan, deskWidthMm: 1500 })).not.toBe(base)
    expect(snapshotFingerprint({ ...plan, items: [...plan.items, createItem('lamp', 1)] })).not.toBe(base)
  })
})

describe('appendSnapshot limits', () => {
  it('keeps newest first and caps automatic snapshots per plan', () => {
    let snapshots: PlanSnapshot[] = []
    for (let index = 0; index < SNAPSHOT_LIMITS.autoPerPlan + 5; index += 1) {
      const snapshot = makeSnapshot({ createdAt: new Date(2026, 0, 1, 0, index).toISOString() })
      snapshots = appendSnapshot(snapshots, snapshot)
    }
    expect(snapshots).toHaveLength(SNAPSHOT_LIMITS.autoPerPlan)
    // 最新一条保留，最旧的被淘汰
    expect(snapshots[0].createdAt).toBe(new Date(2026, 0, 1, 0, SNAPSHOT_LIMITS.autoPerPlan + 4).toISOString())
  })

  it('counts restore snapshots into the automatic bucket but gives manual ones their own bucket', () => {
    let snapshots: PlanSnapshot[] = []
    for (let index = 0; index < SNAPSHOT_LIMITS.autoPerPlan + 2; index += 1) {
      snapshots = appendSnapshot(snapshots, makeSnapshot({ createdAt: new Date(2026, 0, 2, index).toISOString() }))
    }
    for (let index = 0; index < SNAPSHOT_LIMITS.manualPerPlan + 3; index += 1) {
      snapshots = appendSnapshot(snapshots, makeSnapshot({
        kind: 'manual',
        name: `版本 ${index}`,
        createdAt: new Date(2026, 0, 3, index).toISOString(),
      }))
    }
    const autos = snapshots.filter((snapshot) => snapshot.kind !== 'manual')
    const manuals = snapshots.filter((snapshot) => snapshot.kind === 'manual')
    expect(autos).toHaveLength(SNAPSHOT_LIMITS.autoPerPlan)
    expect(manuals).toHaveLength(SNAPSHOT_LIMITS.manualPerPlan)
  })

  it('enforces limits independently per plan', () => {
    let snapshots: PlanSnapshot[] = []
    for (const planId of ['plan-a', 'plan-b']) {
      for (let index = 0; index < SNAPSHOT_LIMITS.autoPerPlan + 4; index += 1) {
        snapshots = appendSnapshot(snapshots, makeSnapshot({ planId, createdAt: new Date(2026, 0, 4, index).toISOString() }))
      }
    }
    expect(snapshots.filter((s) => s.planId === 'plan-a')).toHaveLength(SNAPSHOT_LIMITS.autoPerPlan)
    expect(snapshots.filter((s) => s.planId === 'plan-b')).toHaveLength(SNAPSHOT_LIMITS.autoPerPlan)
  })

  it('never exceeds the total cap', () => {
    const tightLimits = { ...SNAPSHOT_LIMITS, autoPerPlan: 999, manualPerPlan: 999, total: 10 }
    let snapshots: PlanSnapshot[] = []
    for (let index = 0; index < 40; index += 1) {
      snapshots = appendSnapshot(snapshots, makeSnapshot({ createdAt: new Date(2026, 0, 5, index).toISOString() }), tightLimits)
    }
    expect(snapshots).toHaveLength(10)
  })
})

describe('pruneSnapshotsForPlans', () => {
  it('removes snapshots belonging to deleted plans', () => {
    const snapshots = [
      makeSnapshot({ id: 's1', planId: 'plan-a' }),
      makeSnapshot({ id: 's2', planId: 'plan-b' }),
      makeSnapshot({ id: 's3', planId: 'plan-c' }),
    ]
    const pruned = pruneSnapshotsForPlans(snapshots, ['plan-a', 'plan-c'])
    expect(pruned.map((snapshot) => snapshot.id)).toEqual(['s1', 's3'])
  })
})

describe('restore and fork', () => {
  it('applySnapshotToPlan replaces layout wholesale but keeps plan identity and name', () => {
    const plan = makePlan({ name: '当前方案', items: [createItem('lamp', 0)], deskWidthMm: 1000 })
    const snapshot = makeSnapshot({ items: [createItem('monitor', 0), createItem('keyboard', 1)], deskWidthMm: 1800, deskHeightMm: 900 })
    const restored = applySnapshotToPlan(plan, snapshot)
    expect(restored.id).toBe(plan.id)
    expect(restored.name).toBe('当前方案')
    expect(restored.deskWidthMm).toBe(1800)
    expect(restored.deskHeightMm).toBe(900)
    expect(restored.items).toHaveLength(2)
    expect(restored.items).toEqual(snapshot.items)
    expect(restored.items).not.toBe(snapshot.items)
  })

  it('cloneSnapshotToPlan creates a fresh plan with fresh item ids', () => {
    const snapshot = makeSnapshot({ planName: '旧方案', items: [createItem('monitor', 0)] })
    const forked = cloneSnapshotToPlan(snapshot, '找回的版本')
    expect(forked.id).not.toBe(snapshot.planId)
    expect(forked.name).toBe('找回的版本')
    expect(forked.items).toHaveLength(1)
    expect(forked.items[0].id).not.toBe(snapshot.items[0].id)
    expect(forked.items[0].type).toBe(snapshot.items[0].type)
  })

  it('falls back to a generated name when fork name is blank', () => {
    const snapshot = makeSnapshot({ planName: '旧方案' })
    expect(cloneSnapshotToPlan(snapshot, '   ').name).toContain('历史版本')
  })
})

describe('isPlanSnapshot', () => {
  const valid = makeSnapshot()

  it('accepts a well-formed snapshot', () => {
    expect(isPlanSnapshot(valid)).toBe(true)
  })

  it.each([
    ['missing id', { id: '' }],
    ['bad kind', { kind: 'whatever' }],
    ['number name', { name: 5 }],
    ['invalid date', { createdAt: 'not-a-date' }],
    ['zero desk width', { deskWidthMm: 0 }],
    ['string item count', { itemCount: '2' }],
    ['items not array', { items: undefined }],
    ['unknown device type', { items: [{ id: 'x', type: 'tv', widthMm: 10, heightMm: 10, x: 0, y: 0, rotation: 0 }] }],
    ['NaN rotation', { items: [{ id: 'x', type: 'lamp', widthMm: 10, heightMm: 10, x: 0, y: 0, rotation: Number.NaN }] }],
  ])('rejects %s', (_label, patch) => {
    expect(isPlanSnapshot({ ...valid, ...patch })).toBe(false)
  })
})

describe('snapshotTrend', () => {
  it('returns null for the first version', () => {
    expect(snapshotTrend(makeSnapshot({ itemCount: 1 }), null)).toBeNull()
  })

  it('reports deltas against the previous version', () => {
    const older = makeSnapshot({ itemCount: 2, issueCount: 1, deskWidthMm: 1600, deskHeightMm: 800 })
    const newer = makeSnapshot({ itemCount: 4, issueCount: 0, deskWidthMm: 1800, deskHeightMm: 800 })
    expect(snapshotTrend(newer, older)).toEqual({ itemDelta: 2, deskChanged: true, issueDelta: -1 })
  })
})

describe('formatting', () => {
  const now = new Date(2026, 9, 4, 12, 0).getTime()

  it('formats relative time', () => {
    expect(formatSnapshotTime(new Date(2026, 9, 4, 11, 59, 30).toISOString(), now)).toBe('刚刚')
    expect(formatSnapshotTime(new Date(2026, 9, 4, 11, 30).toISOString(), now)).toBe('30 分钟前')
    expect(formatSnapshotTime(new Date(2026, 9, 4, 9, 0).toISOString(), now)).toBe('3 小时前')
    expect(formatSnapshotTime(new Date(2026, 9, 1).toISOString(), now)).toBe('3 天前')
    expect(formatSnapshotTime('garbage', now)).toBe('时间未知')
  })

  it('titles snapshots by kind', () => {
    expect(snapshotTitle(makeSnapshot({ kind: 'auto' }))).toBe('编辑中自动留存')
    expect(snapshotTitle(makeSnapshot({ kind: 'restore' }))).toBe('恢复前自动留存')
    expect(snapshotTitle(makeSnapshot({ kind: 'manual', name: '我的定稿' }))).toBe('我的定稿')
  })
})
