import { createId, type DeskItem, type DeviceType, type WorkspacePlan } from './models'

export type SnapshotKind = 'auto' | 'manual' | 'restore'

export interface PlanSnapshot {
  id: string
  planId: string
  kind: SnapshotKind
  /** 命名版本的名字；自动 / 恢复快照为 null，标题按 kind 生成 */
  name: string | null
  createdAt: string
  planName: string
  items: DeskItem[]
  deskWidthMm: number
  deskHeightMm: number
  itemCount: number
  issueCount: number
}

export interface SnapshotStore {
  version: 1
  snapshots: PlanSnapshot[]
}

export interface SnapshotTrend {
  itemDelta: number
  deskChanged: boolean
  issueDelta: number
}

/** 每个方案的留存上限：自动节点（含恢复前留存）15 个，命名版本 20 个，总量 400 */
export const SNAPSHOT_LIMITS = {
  autoPerPlan: 15,
  manualPerPlan: 20,
  total: 400,
  nameMaxLength: 30,
  planNameMaxLength: 40,
}

const DEVICE_TYPES: DeviceType[] = ['monitor', 'keyboard', 'lamp', 'speaker', 'stand']

function cloneItems(items: DeskItem[]): DeskItem[] {
  return items.map((item) => ({ ...item }))
}

function clampSnapshotName(name: string): string {
  return name.trim().slice(0, SNAPSHOT_LIMITS.nameMaxLength)
}

/** 布局内容指纹：桌面尺寸 + 全部设备的关键属性，内容不变则指纹相同 */
export function snapshotFingerprint(plan: Pick<WorkspacePlan, 'deskWidthMm' | 'deskHeightMm' | 'items'>): string {
  const items = plan.items
    .map((item) => ({ id: item.id, type: item.type, w: item.widthMm, h: item.heightMm, x: item.x, y: item.y, r: item.rotation }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return JSON.stringify({ w: plan.deskWidthMm, h: plan.deskHeightMm, items })
}

export function createSnapshot(plan: WorkspacePlan, kind: SnapshotKind, issueCount: number, name?: string): PlanSnapshot {
  return {
    id: createId('snap'),
    planId: plan.id,
    kind,
    name: kind === 'manual' ? clampSnapshotName(name ?? '') : null,
    createdAt: new Date().toISOString(),
    planName: plan.name,
    items: cloneItems(plan.items),
    deskWidthMm: plan.deskWidthMm,
    deskHeightMm: plan.deskHeightMm,
    itemCount: plan.items.length,
    issueCount: Number.isFinite(issueCount) ? Math.max(0, Math.round(issueCount)) : 0,
  }
}

/** 追加快照并按容量节制裁剪；返回结果始终按时间倒序（新的在前） */
export function appendSnapshot(snapshots: PlanSnapshot[], snapshot: PlanSnapshot, limits = SNAPSHOT_LIMITS): PlanSnapshot[] {
  return enforceLimits([snapshot, ...snapshots], limits)
}

function enforceLimits(all: PlanSnapshot[], limits: typeof SNAPSHOT_LIMITS): PlanSnapshot[] {
  // 时间倒序；时间戳相同（同一批写入）时保持插入顺序，新追加的已在数组前面
  const ordered = [...all].sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0
    return a.createdAt < b.createdAt ? 1 : -1
  })
  const automaticSeen = new Map<string, number>()
  const manualSeen = new Map<string, number>()
  const kept: PlanSnapshot[] = []
  for (const snapshot of ordered) {
    if (kept.length >= limits.total) break
    const seenMap = snapshot.kind === 'manual' ? manualSeen : automaticSeen
    const perPlanLimit = snapshot.kind === 'manual' ? limits.manualPerPlan : limits.autoPerPlan
    const seen = seenMap.get(snapshot.planId) ?? 0
    if (seen >= perPlanLimit) continue
    seenMap.set(snapshot.planId, seen + 1)
    kept.push(snapshot)
  }
  return kept
}

/** 删除方案时级联清掉它的快照，避免无主记录堆积 */
export function pruneSnapshotsForPlans(snapshots: PlanSnapshot[], planIds: ReadonlySet<string> | readonly string[]): PlanSnapshot[] {
  const alive = new Set(planIds)
  return snapshots.filter((snapshot) => alive.has(snapshot.planId))
}

/** 整体恢复：保留当前方案的 id 与名字，桌面尺寸和设备摆法整体替换为快照内容 */
export function applySnapshotToPlan(plan: WorkspacePlan, snapshot: PlanSnapshot): WorkspacePlan {
  return {
    ...plan,
    deskWidthMm: snapshot.deskWidthMm,
    deskHeightMm: snapshot.deskHeightMm,
    items: cloneItems(snapshot.items),
    updatedAt: new Date().toISOString(),
  }
}

/** 另存为新方案：生成新的方案 id 与设备 id，摆法来自快照，可以放手继续改 */
export function cloneSnapshotToPlan(snapshot: PlanSnapshot, name: string): WorkspacePlan {
  const safeName = name.trim().slice(0, SNAPSHOT_LIMITS.planNameMaxLength) || `${snapshot.planName} · 历史版本`
  return {
    id: createId('plan'),
    name: safeName,
    deskWidthMm: snapshot.deskWidthMm,
    deskHeightMm: snapshot.deskHeightMm,
    items: snapshot.items.map((item) => ({ ...item, id: createId('item') })),
    updatedAt: new Date().toISOString(),
  }
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 恢复前的运行时校验：数据不完整就拒绝恢复，防止当前方案被坏数据覆盖 */
export function isPlanSnapshot(value: unknown): value is PlanSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false
  if (typeof candidate.planId !== 'string' || candidate.planId.length === 0) return false
  if (candidate.kind !== 'auto' && candidate.kind !== 'manual' && candidate.kind !== 'restore') return false
  if (candidate.name !== null && typeof candidate.name !== 'string') return false
  if (typeof candidate.createdAt !== 'string' || Number.isNaN(Date.parse(candidate.createdAt))) return false
  if (typeof candidate.planName !== 'string') return false
  if (!isFinitePositive(candidate.deskWidthMm) || !isFinitePositive(candidate.deskHeightMm)) return false
  if (!isFiniteNumber(candidate.itemCount) || !isFiniteNumber(candidate.issueCount)) return false
  if (!Array.isArray(candidate.items)) return false
  return candidate.items.every((raw) => {
    if (!raw || typeof raw !== 'object') return false
    const item = raw as Record<string, unknown>
    return typeof item.id === 'string' && item.id.length > 0
      && typeof item.type === 'string' && (DEVICE_TYPES as string[]).includes(item.type)
      && isFinitePositive(item.widthMm) && isFinitePositive(item.heightMm)
      && isFiniteNumber(item.x) && isFiniteNumber(item.y) && isFiniteNumber(item.rotation)
  })
}

export function snapshotTitle(snapshot: PlanSnapshot): string {
  if (snapshot.kind === 'manual') return snapshot.name ?? '命名版本'
  if (snapshot.kind === 'restore') return '恢复前自动留存'
  return '编辑中自动留存'
}

export function snapshotKindLabel(kind: SnapshotKind): string {
  if (kind === 'manual') return '命名'
  if (kind === 'restore') return '恢复前'
  return '自动'
}

/** 相对更早一版（列表中相邻的下一条）的走向；首版没有参照时返回 null */
export function snapshotTrend(snapshot: PlanSnapshot, previous: PlanSnapshot | null): SnapshotTrend | null {
  if (!previous) return null
  return {
    itemDelta: snapshot.itemCount - previous.itemCount,
    deskChanged: snapshot.deskWidthMm !== previous.deskWidthMm || snapshot.deskHeightMm !== previous.deskHeightMm,
    issueDelta: snapshot.issueCount - previous.issueCount,
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatSnapshotTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return '时间未知'
  const diff = Math.max(0, now - time)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const date = new Date(time)
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${date.getFullYear()}-${monthDay}`
}

export function formatFullSnapshotTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
