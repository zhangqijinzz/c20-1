import {
  createId,
  isPlanSnapshot,
  type PlanSnapshot,
  type SnapshotReason,
  type WorkspaceDocument,
  type WorkspacePlan,
} from '../../shared/models'

export const AUTO_SNAPSHOT_INTERVAL_MS = 2 * 60 * 1000
export const MAX_SNAPSHOTS_PER_PLAN = 20
export const MAX_AUTO_SNAPSHOTS_PER_PLAN = 12

export type SnapshotOutcome =
  | { ok: true; document: WorkspaceDocument }
  | { ok: false; error: string }

function contentSignature(plan: WorkspacePlan): string {
  return JSON.stringify({
    desk: [plan.deskWidthMm, plan.deskHeightMm],
    items: plan.items.map((item) => [item.type, item.widthMm, item.heightMm, item.x, item.y, item.rotation]),
  })
}

export function snapshotMatchesPlan(snapshot: PlanSnapshot, plan: WorkspacePlan): boolean {
  return contentSignature(snapshot.plan) === contentSignature(plan)
}

export function createSnapshot(
  plan: WorkspacePlan,
  issueCount: number,
  reason: SnapshotReason,
  label: string | null,
  now: Date,
): PlanSnapshot {
  return {
    id: createId('snap'),
    planId: plan.id,
    reason,
    label,
    createdAt: now.toISOString(),
    deviceCount: plan.items.length,
    deskWidthMm: plan.deskWidthMm,
    deskHeightMm: plan.deskHeightMm,
    issueCount,
    plan: { ...plan, items: plan.items.map((item) => ({ ...item })) },
  }
}

export function listSnapshotsForPlan(snapshots: PlanSnapshot[], planId: string): PlanSnapshot[] {
  return snapshots
    .map((snapshot, index) => ({ snapshot, index }))
    .filter(({ snapshot }) => snapshot.planId === planId)
    .sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt) || a.index - b.index)
    .map(({ snapshot }) => snapshot)
}

export function shouldAutoSnapshot(snapshots: PlanSnapshot[], plan: WorkspacePlan, now: Date): boolean {
  if (plan.items.length === 0) return false
  const latest = listSnapshotsForPlan(snapshots, plan.id)[0]
  if (!latest) return true
  if (snapshotMatchesPlan(latest, plan)) return false
  return now.getTime() - Date.parse(latest.createdAt) >= AUTO_SNAPSHOT_INTERVAL_MS
}

export function pruneSnapshots(snapshots: PlanSnapshot[], planId: string): PlanSnapshot[] {
  const ordered = listSnapshotsForPlan(snapshots, planId)
  const kept = new Set<string>()
  let autoKept = 0
  for (const snapshot of ordered) {
    if (kept.size >= MAX_SNAPSHOTS_PER_PLAN) break
    if (snapshot.reason === 'auto') {
      if (autoKept >= MAX_AUTO_SNAPSHOTS_PER_PLAN) continue
      autoKept += 1
    }
    kept.add(snapshot.id)
  }
  return snapshots.filter((snapshot) => snapshot.planId !== planId || kept.has(snapshot.id))
}

export function appendSnapshot(snapshots: PlanSnapshot[], snapshot: PlanSnapshot): PlanSnapshot[] {
  return pruneSnapshots([snapshot, ...snapshots], snapshot.planId)
}

export function restoreSnapshot(
  document: WorkspaceDocument,
  snapshotId: string,
  currentIssueCount: number,
  now: Date,
): SnapshotOutcome {
  const snapshot = document.snapshots.find((entry) => entry.id === snapshotId)
  if (!snapshot || !isPlanSnapshot(snapshot)) return { ok: false, error: '该快照数据已损坏，无法恢复' }
  const target = document.plans.find((plan) => plan.id === snapshot.planId)
  if (!target) return { ok: false, error: '该快照对应的方案已删除，可另存为新方案' }
  const safety = createSnapshot(target, currentIssueCount, 'auto', '恢复前自动留存', now)
  const restored: WorkspacePlan = {
    ...snapshot.plan,
    items: snapshot.plan.items.map((item) => ({ ...item })),
    id: target.id,
    updatedAt: now.toISOString(),
  }
  return {
    ok: true,
    document: {
      ...document,
      snapshots: appendSnapshot(document.snapshots, safety),
      plans: document.plans.map((plan) => (plan.id === target.id ? restored : plan)),
    },
  }
}

export function branchSnapshotAsPlan(document: WorkspaceDocument, snapshotId: string, now: Date): SnapshotOutcome {
  const snapshot = document.snapshots.find((entry) => entry.id === snapshotId)
  if (!snapshot || !isPlanSnapshot(snapshot)) return { ok: false, error: '该快照数据已损坏，无法另存' }
  const plan: WorkspacePlan = {
    ...snapshot.plan,
    id: createId('plan'),
    name: `${snapshot.plan.name} · 历史版本`,
    items: snapshot.plan.items.map((item) => ({ ...item, id: createId('item') })),
    updatedAt: now.toISOString(),
  }
  return { ok: true, document: { ...document, plans: [...document.plans, plan], activePlanId: plan.id } }
}
