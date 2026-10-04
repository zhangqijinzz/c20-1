import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createId,
  createInitialDocument,
  createPlan,
  type DeskItem,
  type DeviceType,
  type LayoutAnalysis,
  type WorkspaceDocument,
  type WorkspacePlan,
  type WorkspaceStatus,
} from '../../shared/models'
import { clampDeskSize, clampItemDimension } from '../../shared/layoutRules'
import { moveCanvasItem, rotateCanvasItem } from '../canvas/canvasViewModel'
import { createMaterialDraft } from '../materials/materialsViewModel'
import { inspectPlan } from '../inspection/inspectionViewModel'
import { LocalWorkspaceRepository, type WorkspaceRepository } from './workspaceRepository'
import { LocalSnapshotRepository, type SnapshotRepository } from './snapshotRepository'
import {
  appendSnapshot,
  applySnapshotToPlan,
  cloneSnapshotToPlan,
  createSnapshot,
  isPlanSnapshot,
  pruneSnapshotsForPlans,
  snapshotFingerprint,
  type PlanSnapshot,
} from '../../shared/snapshotModels'

export interface WorkspaceViewModel {
  status: WorkspaceStatus
  document: WorkspaceDocument | null
  activePlan: WorkspacePlan | null
  activeSnapshots: PlanSnapshot[]
  selectedItem: DeskItem | null
  analysis: LayoutAnalysis
  issueIds: string[]
  issueCount: number
  feedback: string
  isPreviewOpen: boolean
  isHistoryOpen: boolean
  selectItem: (id: string | null) => void
  addItem: (type: DeviceType) => void
  removeItem: (id: string) => void
  moveItem: (id: string, x: number, y: number) => void
  rotateItem: (id: string, delta: number) => void
  updateItem: (id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => void
  updateDesk: (field: 'deskWidthMm' | 'deskHeightMm', value: number) => void
  createNewPlan: () => void
  duplicatePlan: () => void
  selectPlan: (id: string) => void
  deleteCurrentPlan: () => void
  openPreview: () => void
  closePreview: () => void
  openHistory: () => void
  closeHistory: () => void
  saveNamedSnapshot: (name: string) => boolean
  deleteSnapshot: (id: string) => void
  restoreSnapshot: (id: string) => Promise<boolean>
  forkSnapshot: (id: string, name: string) => Promise<boolean>
}

interface RepositoryOptions {
  repository?: WorkspaceRepository
  snapshotRepository?: SnapshotRepository
}

const emptyInspection = { analysis: { overlapIds: [], outOfBoundsIds: [], coveragePercent: 0, status: 'clear' as const }, issueIds: [], issueCount: 0 }
const AUTO_SNAPSHOT_DELAY_MS = 1200

export function useWorkspaceViewModel(options: RepositoryOptions = {}): WorkspaceViewModel {
  const workspaceRepositoryRef = useRef(options.repository ?? new LocalWorkspaceRepository())
  const snapshotRepositoryRef = useRef(options.snapshotRepository ?? new LocalSnapshotRepository())
  const [status, setStatus] = useState<WorkspaceStatus>('loading')
  const [document, setDocument] = useState<WorkspaceDocument | null>(null)
  const [snapshots, setSnapshots] = useState<PlanSnapshot[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [feedback, setFeedback] = useState('正在准备你的工作台…')

  // 每次渲染同步最新状态到 ref，供防抖回调 / 原子提交流程读取
  const documentRef = useRef<WorkspaceDocument | null>(null)
  const snapshotsRef = useRef<PlanSnapshot[]>([])
  documentRef.current = document
  snapshotsRef.current = snapshots

  useEffect(() => {
    let active = true
    Promise.all([workspaceRepositoryRef.current.load(), snapshotRepositoryRef.current.load()])
      .then(([loaded, loadedSnapshots]) => {
        if (!active) return
        const nextDocument = loaded ?? createInitialDocument()
        setDocument(nextDocument)
        // 清理已删除方案留下的无主快照
        const alivePlanIds = new Set(nextDocument.plans.map((plan) => plan.id))
        let nextSnapshots = pruneSnapshotsForPlans(loadedSnapshots, alivePlanIds)
        // 首次打开（老数据 / 新文档）：给还没有任何快照的方案补一个基线节点
        const missingBaseline = nextDocument.plans.filter(
          (plan) => !nextSnapshots.some((snapshot) => snapshot.planId === plan.id),
        )
        if (missingBaseline.length > 0) {
          const baselines = missingBaseline.map((plan) =>
            createSnapshot(plan, 'auto', inspectPlan(plan).issueCount),
          )
          nextSnapshots = enforceOnLoad(nextSnapshots, baselines)
          void snapshotRepositoryRef.current.save(nextSnapshots).catch(() => undefined)
        }
        setSnapshots(nextSnapshots)
        setStatus('ready')
        setFeedback(loaded ? '已恢复上次编辑状态' : '已创建示例工作台，可以直接拖动设备')
      })
      .catch(() => {
        if (!active) return
        setDocument(createInitialDocument())
        setStatus('error')
        setFeedback('本地数据读取失败，当前使用临时工作台')
      })
    return () => { active = false }
  }, [])

  const activePlan = useMemo(
    () => document?.plans.find((plan) => plan.id === document.activePlanId) ?? null,
    [document],
  )
  const activeSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot.planId === activePlan?.id),
    [snapshots, activePlan?.id],
  )
  const selectedItem = activePlan?.items.find((item) => item.id === selectedItemId) ?? null
  const inspection = useMemo(() => activePlan ? inspectPlan(activePlan) : emptyInspection, [activePlan])
  const { analysis, issueIds, issueCount } = inspection

  // 内容编辑后防抖自动留档；拖拽期间只不断延后定时器，停下才落一条
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
  }, [])

  const commit = useCallback((nextDocument: WorkspaceDocument | null, nextSnapshots: PlanSnapshot[]) => {
    setDocument(nextDocument)
    setSnapshots(nextSnapshots)
    documentRef.current = nextDocument
    snapshotsRef.current = nextSnapshots
  }, [])

  const scheduleAutoSnapshotForPlan = useCallback((plan: WorkspacePlan) => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current)
    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null
      const currentDocument = documentRef.current
      const currentPlan = currentDocument?.plans.find((item) => item.id === plan.id)
      if (!currentDocument || !currentPlan) return
      const fingerprint = snapshotFingerprint(currentPlan)
      const latestForPlan = snapshotsRef.current.find((snapshot) => snapshot.planId === currentPlan.id)
      if (latestForPlan && snapshotFingerprint(latestForPlan) === fingerprint) return
      const snapshot = createSnapshot(currentPlan, 'auto', inspectPlan(currentPlan).issueCount)
      const nextSnapshots = appendSnapshot(snapshotsRef.current, snapshot)
      setSnapshots(nextSnapshots)
      snapshotsRef.current = nextSnapshots
      // 自动留档失败不打断编辑，只静默重试下一次
      void snapshotRepositoryRef.current.save(nextSnapshots).catch(() => undefined)
    }, AUTO_SNAPSHOT_DELAY_MS)
  }, [])

  const persistDocument = useCallback(async (
    nextDocument: WorkspaceDocument,
    nextSnapshots: PlanSnapshot[],
    message: string,
    options: { captureAuto?: boolean } = {},
  ): Promise<void> => {
    // 先提交内存让界面即时响应，再写主文档；主文档写失败时回滚，绝不留下半新半旧
    const previousDocument = documentRef.current
    const previousSnapshots = snapshotsRef.current
    commit(nextDocument, nextSnapshots)
    setStatus('saving')
    setFeedback(message)
    try {
      await workspaceRepositoryRef.current.save(nextDocument)
      setStatus('ready')
    } catch {
      commit(previousDocument, previousSnapshots)
      setStatus('error')
      setFeedback('自动保存失败，请检查浏览器本地存储权限；当前编辑已回滚')
      throw new Error('document save failed')
    }
    if (options.captureAuto) {
      const plan = nextDocument.plans.find((item) => item.id === nextDocument.activePlanId)
      if (plan) scheduleAutoSnapshotForPlan(plan)
    }
  }, [commit, scheduleAutoSnapshotForPlan])

  const persistSnapshots = useCallback(async (nextSnapshots: PlanSnapshot[], message: string): Promise<boolean> => {
    const previousSnapshots = snapshotsRef.current
    setSnapshots(nextSnapshots)
    snapshotsRef.current = nextSnapshots
    setStatus('saving')
    setFeedback(message)
    try {
      await snapshotRepositoryRef.current.save(nextSnapshots)
      setStatus('ready')
      return true
    } catch {
      setSnapshots(previousSnapshots)
      snapshotsRef.current = previousSnapshots
      setStatus('error')
      setFeedback('历史快照保存失败，请检查浏览器本地存储权限')
      return false
    }
  }, [])

  const updateActivePlan = useCallback((updater: (plan: WorkspacePlan) => WorkspacePlan, message: string) => {
    if (!document || !activePlan) return
    const nextPlan = { ...updater(activePlan), updatedAt: new Date().toISOString() }
    const nextDocument = { ...document, plans: document.plans.map((plan) => plan.id === nextPlan.id ? nextPlan : plan) }
    void persistDocument(nextDocument, snapshotsRef.current, message, { captureAuto: true })
  }, [activePlan, document, persistDocument])

  const selectItem = useCallback((id: string | null) => setSelectedItemId(id), [])

  const addItem = useCallback((type: DeviceType) => {
    if (!activePlan) return
    const draft = createMaterialDraft(type, activePlan.items.length)
    updateActivePlan((plan) => ({ ...plan, items: [...plan.items, draft.item] }), draft.feedback)
    setSelectedItemId(draft.item.id)
  }, [activePlan, updateActivePlan])

  const removeItem = useCallback((id: string) => {
    updateActivePlan((plan) => ({ ...plan, items: plan.items.filter((item) => item.id !== id) }), '设备已移除')
    setSelectedItemId((current) => current === id ? null : current)
  }, [updateActivePlan])

  const moveItem = useCallback((id: string, x: number, y: number) => {
    updateActivePlan((plan) => ({ ...plan, items: moveCanvasItem(plan.items, id, x, y) }), '位置已更新')
  }, [updateActivePlan])

  const rotateItem = useCallback((id: string, delta: number) => {
    updateActivePlan((plan) => ({ ...plan, items: rotateCanvasItem(plan.items, id, delta) }), '角度已更新')
  }, [updateActivePlan])

  const updateItem = useCallback((id: string, patch: Partial<Pick<DeskItem, 'widthMm' | 'heightMm' | 'x' | 'y'>>) => {
    updateActivePlan((plan) => ({
      ...plan,
      items: plan.items.map((item) => item.id === id ? {
        ...item,
        ...patch,
        widthMm: patch.widthMm === undefined ? item.widthMm : clampItemDimension(patch.widthMm, item.widthMm),
        heightMm: patch.heightMm === undefined ? item.heightMm : clampItemDimension(patch.heightMm, item.heightMm),
      } : item),
    }), '尺寸参数已更新')
  }, [updateActivePlan])

  const updateDesk = useCallback((field: 'deskWidthMm' | 'deskHeightMm', value: number) => {
    if (!activePlan) return
    updateActivePlan((plan) => ({ ...plan, [field]: clampDeskSize(value, plan[field]) }), '桌面尺寸已更新')
  }, [activePlan, updateActivePlan])

  const createNewPlan = useCallback(() => {
    if (!document) return
    const plan = createPlan(`工作台 ${document.plans.length + 1}`, false)
    const nextDocument = { ...document, plans: [...document.plans, plan], activePlanId: plan.id }
    const nextSnapshots = appendSnapshot(snapshotsRef.current, createSnapshot(plan, 'auto', 0))
    void persistDocument(nextDocument, nextSnapshots, '已创建空白方案')
    setSelectedItemId(null)
  }, [document, persistDocument])

  const duplicatePlan = useCallback(() => {
    if (!document || !activePlan) return
    const copy: WorkspacePlan = {
      ...activePlan,
      id: createId('plan'),
      name: `${activePlan.name} · 副本`,
      items: activePlan.items.map((item) => ({ ...item, id: createId('item') })),
      updatedAt: new Date().toISOString(),
    }
    const nextDocument = { ...document, plans: [...document.plans, copy], activePlanId: copy.id }
    const nextSnapshots = appendSnapshot(snapshotsRef.current, createSnapshot(copy, 'auto', issueCount))
    void persistDocument(nextDocument, nextSnapshots, '方案已复制')
    setSelectedItemId(null)
  }, [activePlan, document, issueCount, persistDocument])

  const selectPlan = useCallback((id: string) => {
    if (!document || !document.plans.some((plan) => plan.id === id)) return
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
    void persistDocument({ ...document, activePlanId: id }, snapshotsRef.current, '已切换方案')
    setSelectedItemId(null)
  }, [document, persistDocument])

  const deleteCurrentPlan = useCallback(() => {
    if (!document || !activePlan || document.plans.length <= 1) {
      setFeedback('至少保留一个工作台方案')
      return
    }
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
    const remaining = document.plans.filter((plan) => plan.id !== activePlan.id)
    const nextDocument = { ...document, plans: remaining, activePlanId: remaining[0].id }
    // 方案删除：它的历史一并清掉
    const nextSnapshots = pruneSnapshotsForPlans(snapshotsRef.current, new Set(remaining.map((plan) => plan.id)))
    void persistDocument(nextDocument, nextSnapshots, '方案已删除，其历史快照一并清理')
    setSelectedItemId(null)
  }, [activePlan, document, persistDocument])

  const openPreview = useCallback(() => setIsPreviewOpen(true), [])
  const closePreview = useCallback(() => setIsPreviewOpen(false), [])
  const openHistory = useCallback(() => setIsHistoryOpen(true), [])
  const closeHistory = useCallback(() => setIsHistoryOpen(false), [])

  const saveNamedSnapshot = useCallback((rawName: string): boolean => {
    if (!activePlan) return false
    const name = rawName.trim()
    if (name.length === 0) {
      setFeedback('请先给这个版本起个名字')
      return false
    }
    const fingerprint = snapshotFingerprint(activePlan)
    const duplicate = snapshotsRef.current.find(
      (snapshot) => snapshot.planId === activePlan.id && snapshot.kind === 'manual' && snapshotFingerprint(snapshot) === fingerprint,
    )
    if (duplicate) {
      setFeedback('当前摆法已保存为同名内容版本，无需重复留存')
      return false
    }
    const snapshot = createSnapshot(activePlan, 'manual', issueCount, name)
    void persistSnapshots(appendSnapshot(snapshotsRef.current, snapshot), `已留存命名版本「${name}」`)
    return true
  }, [activePlan, issueCount, persistSnapshots])

  const deleteSnapshot = useCallback((id: string) => {
    const target = snapshotsRef.current.find((snapshot) => snapshot.id === id)
    if (!target || target.kind !== 'manual') return
    void persistSnapshots(snapshotsRef.current.filter((snapshot) => snapshot.id !== id), '命名版本已删除')
  }, [persistSnapshots])

  const restoreSnapshot = useCallback(async (snapshotId: string): Promise<boolean> => {
    const currentDocument = documentRef.current
    if (!currentDocument) return false
    const snapshot = snapshotsRef.current.find((item) => item.id === snapshotId)
    if (!snapshot || !isPlanSnapshot(snapshot)) {
      setFeedback('该版本数据不完整，无法恢复')
      return false
    }
    const targetPlan = currentDocument.plans.find((plan) => plan.id === snapshot.planId)
    if (!targetPlan) {
      setFeedback('该版本所属的方案已不存在，可用「另存为新方案」找回')
      return false
    }
    // 先在内存里把“恢复前留存 + 目标方案”整体构造好，再按 快照 → 主文档 的顺序落盘
    const beforeMarker = createSnapshot(targetPlan, 'restore', inspectPlan(targetPlan).issueCount)
    const nextSnapshots = appendSnapshot(snapshotsRef.current, beforeMarker)
    const restoredPlan = applySnapshotToPlan(targetPlan, snapshot)
    const nextDocument = {
      ...currentDocument,
      activePlanId: restoredPlan.id,
      plans: currentDocument.plans.map((plan) => plan.id === restoredPlan.id ? restoredPlan : plan),
    }
    try {
      await snapshotRepositoryRef.current.save(nextSnapshots)
    } catch {
      setStatus('error')
      setFeedback('历史版本写入失败，恢复已取消，当前方案未改动')
      return false
    }
    try {
      await workspaceRepositoryRef.current.save(nextDocument)
    } catch {
      // 主文档没写成：回滚刚落盘的快照，恢复前的现场原样保留
      await snapshotRepositoryRef.current.save(snapshotsRef.current).catch(() => undefined)
      setStatus('error')
      setFeedback('恢复写入失败，已保持当前方案不变')
      return false
    }
    commit(nextDocument, nextSnapshots)
    setSelectedItemId(null)
    setStatus('ready')
    setFeedback(`已恢复到「${snapshot.kind === 'manual' ? snapshot.name : '历史版本'}」，恢复前的摆法也已自动留存`)
    return true
  }, [commit])

  const forkSnapshot = useCallback(async (snapshotId: string, rawName: string): Promise<boolean> => {
    const currentDocument = documentRef.current
    if (!currentDocument) return false
    const snapshot = snapshotsRef.current.find((item) => item.id === snapshotId)
    if (!snapshot || !isPlanSnapshot(snapshot)) {
      setFeedback('该版本数据不完整，无法另存')
      return false
    }
    const name = rawName.trim()
    const newPlan = cloneSnapshotToPlan(snapshot, name)
    const nextDocument = { ...currentDocument, plans: [...currentDocument.plans, newPlan], activePlanId: newPlan.id }
    const baseline = createSnapshot(newPlan, 'auto', snapshot.issueCount)
    const nextSnapshots = appendSnapshot(snapshotsRef.current, baseline)
    try {
      // 先写历史，再写主文档；失败则撤销，当前方案保持不动
      await snapshotRepositoryRef.current.save(nextSnapshots)
      await workspaceRepositoryRef.current.save(nextDocument)
    } catch {
      await snapshotRepositoryRef.current.save(snapshotsRef.current).catch(() => undefined)
      setStatus('error')
      setFeedback('另存为新方案失败，当前方案未改动')
      return false
    }
    commit(nextDocument, nextSnapshots)
    setSelectedItemId(null)
    setStatus('ready')
    setFeedback(`已另存为新方案「${newPlan.name}」，可以接着改`)
    setIsHistoryOpen(false)
    return true
  }, [commit])

  return {
    status,
    document,
    activePlan,
    activeSnapshots,
    selectedItem,
    analysis,
    issueIds,
    issueCount,
    feedback,
    isPreviewOpen,
    isHistoryOpen,
    selectItem,
    addItem,
    removeItem,
    moveItem,
    rotateItem,
    updateItem,
    updateDesk,
    createNewPlan,
    duplicatePlan,
    selectPlan,
    deleteCurrentPlan,
    openPreview,
    closePreview,
    openHistory,
    closeHistory,
    saveNamedSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    forkSnapshot,
  }
}

function enforceOnLoad(existing: PlanSnapshot[], baselines: PlanSnapshot[]): PlanSnapshot[] {
  return baselines.reduce((all, snapshot) => appendSnapshot(all, snapshot), existing)
}
