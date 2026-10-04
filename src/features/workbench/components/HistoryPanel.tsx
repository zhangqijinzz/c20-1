import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BookmarkPlus, History, Minus, RotateCcw, Trash2, X } from 'lucide-react'
import type { PlanSnapshot } from '../../../shared/models'
import { MAX_AUTO_SNAPSHOTS_PER_PLAN, MAX_SNAPSHOTS_PER_PLAN } from '../historyViewModel'

interface HistoryPanelProps {
  planName: string
  snapshots: PlanSnapshot[]
  onSaveSnapshot: (label: string) => void
  onRestore: (id: string) => void
  onBranch: (id: string) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function Trend({ current, previous, goodWhenDown = false }: { current: number; previous: number | null; goodWhenDown?: boolean }) {
  if (previous === null || current === previous) {
    return <span className="trend trend-flat"><Minus size={11} /></span>
  }
  const delta = current - previous
  const isGood = goodWhenDown ? delta < 0 : delta > 0
  return (
    <span className={`trend ${isGood ? 'trend-good' : 'trend-bad'}`}>
      {delta > 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{Math.abs(delta)}
    </span>
  )
}

export function HistoryPanel({ planName, snapshots, onSaveSnapshot, onRestore, onBranch, onDelete, onClose }: HistoryPanelProps) {
  const [label, setLabel] = useState('')

  const handleSave = () => {
    onSaveSnapshot(label)
    setLabel('')
  }

  return (
    <div className="preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <section className="preview-modal history-modal">
        <header className="preview-modal-header">
          <div>
            <span className="eyebrow">VERSION HISTORY</span>
            <h2 id="history-title">「{planName}」的历史版本</h2>
            <p>每个方案最多保留 {MAX_SNAPSHOTS_PER_PLAN} 个快照（其中自动快照 {MAX_AUTO_SNAPSHOTS_PER_PLAN} 个），超出后从最旧的自动快照开始清理</p>
          </div>
          <button className="close-preview" aria-label="关闭历史版本" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="history-save-row">
          <input
            aria-label="快照名称"
            maxLength={24}
            onChange={(event) => setLabel(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') handleSave() }}
            placeholder="给当前状态起个名字，例如「双屏靠左」"
            value={label}
          />
          <button className="history-save-button" onClick={handleSave} type="button"><BookmarkPlus size={15} /> 留存当前状态</button>
        </div>
        {snapshots.length === 0 ? (
          <p className="history-empty"><History size={15} /> 还没有快照。继续编辑会自动留存，也可以手动保存一个。</p>
        ) : (
          <ul className="history-list">
            {snapshots.map((snapshot, index) => {
              const older = snapshots[index + 1] ?? null
              return (
                <li className="history-row" key={snapshot.id}>
                  <div className="history-main">
                    <span className={`history-badge ${snapshot.reason === 'manual' ? 'badge-manual' : 'badge-auto'}`}>
                      {snapshot.reason === 'manual' ? '手动' : '自动'}
                    </span>
                    <div className="history-title">
                      <strong>{snapshot.label ?? (snapshot.reason === 'manual' ? '手动留存' : '自动留存')}</strong>
                      <small>{formatTime(snapshot.createdAt)}</small>
                    </div>
                  </div>
                  <div className="history-stats">
                    <span>设备 {snapshot.deviceCount} <Trend current={snapshot.deviceCount} previous={older ? older.deviceCount : null} /></span>
                    <span>{snapshot.deskWidthMm} × {snapshot.deskHeightMm} mm</span>
                    <span>问题 {snapshot.issueCount} <Trend current={snapshot.issueCount} previous={older ? older.issueCount : null} goodWhenDown /></span>
                  </div>
                  <div className="history-actions">
                    <button className="history-action" onClick={() => onRestore(snapshot.id)} type="button"><RotateCcw size={13} /> 恢复</button>
                    <button className="history-action" onClick={() => onBranch(snapshot.id)} type="button">另存为新方案</button>
                    <button aria-label="删除该快照" className="history-action history-delete" onClick={() => onDelete(snapshot.id)} type="button"><Trash2 size={13} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
