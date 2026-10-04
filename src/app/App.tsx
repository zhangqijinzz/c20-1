import { useState } from 'react'
import { Check, Cloud, FileCheck2, History, PanelTop, TriangleAlert } from 'lucide-react'
import { DEVICE_DEFINITIONS } from '../shared/models'
import { CanvasStage } from '../features/canvas/components/CanvasStage'
import { DevicePalette } from '../features/materials/components/DevicePalette'
import { InspectorPanel } from '../features/inspection/components/InspectorPanel'
import { PreviewOverlay } from '../features/inspection/components/PreviewOverlay'
import { PlanSidebar } from '../features/workbench/components/PlanSidebar'
import { HistoryDrawer } from '../features/workbench/components/HistoryDrawer'
import { useWorkspaceViewModel } from '../features/workbench/workbenchViewModel'

export function App() {
  const viewModel = useWorkspaceViewModel()
  const { document, activePlan, selectedItem, analysis, issueIds, issueCount } = viewModel
  const [busySnapshotId, setBusySnapshotId] = useState<string | null>(null)

  if (!document || !activePlan) {
    return <main className="loading-screen"><span className="loading-orb" /><p>正在打开 FocusDesk…</p></main>
  }

  const handleRestore = (id: string) => {
    setBusySnapshotId(id)
    void viewModel.restoreSnapshot(id).then((ok) => {
      setBusySnapshotId(null)
      if (ok) viewModel.closeHistory()
    })
  }

  const handleFork = (id: string, name: string) => {
    setBusySnapshotId(id)
    void viewModel.forkSnapshot(id, name).then(() => setBusySnapshotId(null))
  }

  return (
    <main className="app-shell">
      <PlanSidebar plans={document.plans} activePlanId={document.activePlanId} onSelect={viewModel.selectPlan} onCreate={viewModel.createNewPlan} onDuplicate={viewModel.duplicatePlan} onDelete={viewModel.deleteCurrentPlan} />
      <section className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>工作台</span><span>/</span><strong>{activePlan.name}</strong></div>
          <div className="topbar-actions"><span className={`save-state ${viewModel.status === 'error' ? 'save-error' : ''}`}><Cloud size={15} /> {viewModel.status === 'saving' ? '保存中…' : viewModel.status === 'error' ? '保存异常' : '已保存到本地'}</span><button className="preview-button" onClick={viewModel.openPreview} type="button"><PanelTop size={16} /> 预览方案</button><span className="avatar">FD</span></div>
        </header>
        <div className="workspace-content">
          <div className="page-heading"><div><span className="eyebrow">DESK PLANNER / {new Date().getFullYear()}</span><h1>把桌面，变成一张清晰的地图。</h1><p>先放置，再调整。每个尺寸与间距都在你的掌控之中。</p></div><div className="feedback-chip"><span className={viewModel.status === 'error' ? 'feedback-icon error' : 'feedback-icon'}>{viewModel.status === 'error' ? <TriangleAlert size={14} /> : <Check size={14} />}</span>{viewModel.feedback}</div></div>
          <div className="metrics-row"><div className="metric-card"><span>桌面尺寸</span><strong>{activePlan.deskWidthMm} <i>×</i> {activePlan.deskHeightMm}<small>mm</small></strong><em>可用面积</em></div><div className="metric-card"><span>已放置设备</span><strong>{activePlan.items.length}<small>件</small></strong><em>点击设备可编辑</em></div><div className={`metric-card ${analysis.status === 'attention' ? 'metric-warning' : ''}`}><span>空间检查</span><strong>{issueCount === 0 ? '通过' : `${issueCount} 个问题`}</strong><em>{issueCount === 0 ? '布局目前很舒展' : '请查看红色标记'}</em></div><div className="coverage-card"><div><span>占用率</span><strong>{analysis.coveragePercent}%</strong></div><div className="coverage-bar"><span style={{ width: `${Math.max(4, analysis.coveragePercent)}%` }} /></div><small>设备投影面积 / 桌面面积</small></div></div>
          <div className="editor-grid"><DevicePalette devices={DEVICE_DEFINITIONS} onAdd={viewModel.addItem} /><section className="stage-panel"><div className="stage-header"><div><span className="eyebrow">LIVE CANVAS</span><h2>{activePlan.name}</h2></div><div className="stage-heading-actions"><button className="history-entry-button" onClick={viewModel.openHistory} type="button"><History size={14} /> 历史版本<span className="history-entry-count">{viewModel.activeSnapshots.length}</span></button><div className={`status-pill ${analysis.status === 'attention' ? 'status-attention' : ''}`}>{analysis.status === 'attention' ? <TriangleAlert size={14} /> : <FileCheck2 size={14} />}{analysis.status === 'attention' ? '需要调整' : '布局健康'}</div></div></div><CanvasStage plan={activePlan} selectedItemId={selectedItem?.id ?? null} analysis={analysis} onSelect={viewModel.selectItem} onMove={viewModel.moveItem} /></section><InspectorPanel plan={activePlan} item={selectedItem} issueIds={issueIds} onUpdateDesk={viewModel.updateDesk} onUpdateItem={viewModel.updateItem} onRotate={viewModel.rotateItem} onDelete={viewModel.removeItem} /></div>
        </div>
      </section>
      {viewModel.isPreviewOpen && <PreviewOverlay plan={activePlan} analysis={analysis} issueCount={issueCount} onClose={viewModel.closePreview} />}
      {viewModel.isHistoryOpen && <HistoryDrawer snapshots={viewModel.activeSnapshots} planName={activePlan.name} busySnapshotId={busySnapshotId} onClose={viewModel.closeHistory} onSaveNamed={viewModel.saveNamedSnapshot} onRestore={handleRestore} onFork={handleFork} onDelete={viewModel.deleteSnapshot} />}
    </main>
  )
}
