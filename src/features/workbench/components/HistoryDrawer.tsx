import { useState } from 'react'
import { Bookmark, History, RotateCcw, Save, Trash2, X } from 'lucide-react'
import {
  formatFullSnapshotTime,
  formatSnapshotTime,
  snapshotKindLabel,
  snapshotTitle,
  snapshotTrend,
  type PlanSnapshot,
} from '../../../shared/snapshotModels'

interface HistoryDrawerProps {
  snapshots: PlanSnapshot[]
  planName: string
  busySnapshotId: string | null
  onClose: () => void
  onSaveNamed: (name: string) => boolean
  onRestore: (id: string) => void
  onFork: (id: string, name: string) => void
  onDelete: (id: string) => void
}

interface TrendChipProps {
  label: string
  value: string
  tone: 'up' | 'down' | 'flat'
}

function TrendChip({ label, value, tone }: TrendChipProps) {
  return <span className={`trend-chip trend-${tone}`}><small>{label}</small>{value}</span>
}

function trendChips(snapshot: PlanSnapshot, previous: PlanSnapshot | null) {
  const trend = snapshotTrend(snapshot, previous)
  if (!trend) return null
  const chips: TrendChipProps[] = []
  if (trend.itemDelta !== 0) {
    chips.push({
      label: '设备',
      value: trend.itemDelta > 0 ? `+${trend.itemDelta}` : `${trend.itemDelta}`,
      tone: trend.itemDelta > 0 ? 'up' : 'down',
    })
  }
  if (trend.deskChanged) {
    chips.push({ label: '桌面', value: '已调整', tone: 'flat' })
  }
  if (trend.issueDelta !== 0) {
    chips.push({
      label: '问题',
      value: trend.issueDelta > 0 ? `+${trend.issueDelta}` : `${trend.issueDelta}`,
      tone: trend.issueDelta > 0 ? 'down' : 'up',
    })
  }
  if (chips.length === 0) chips.push({ label: '走向', value: '无变化', tone: 'flat' })
  return chips.map((chip) => <TrendChip key={chip.label} {...chip} />)
}

export function HistoryDrawer({ snapshots, planName, busySnapshotId, onClose, onSaveNamed, onRestore, onFork, onDelete }: HistoryDrawerProps) {
  const [name, setName] = useState('')
  const [forkName, setForkName] = useState('')
  const [forkingId, setForkingId] = useState<string | null>(null)

  const submitNamed = () => {
    if (onSaveNamed(name)) setName('')
  }

  const submitFork = (id: string) => {
    onFork(id, forkName)
    setForkingId(null)
    setForkName('')
  }

  return (
    <div className="history-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title" onMouseDown={onClose}>
      <aside className="history-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="history-header">
          <div>
            <span className="eyebrow">VERSION HISTORY</span>
            <h2 id="history-title"><History size={18} /> {planName} 的版本历史</h2>
            <p>编辑停顿后自动留档，也可以手动命名留存；自动节点每方案保留最近 15 个。</p>
          </div>
          <button className="close-preview" aria-label="关闭历史" onClick={onClose} type="button"><X size={18} /></button>
        </header>

        <div className="history-save-box">
          <label htmlFor="snapshot-name">留存当前摆法</label>
          <div className="history-save-row">
            <input
              id="snapshot-name"
              value={name}
              maxLength={30}
              placeholder="给这个满意的版本起个名字，如：双屏定稿"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submitNamed() }}
            />
            <button className="history-save-button" onClick={submitNamed} type="button"><Bookmark size={14} /> 命名留存</button>
          </div>
        </div>

        <div className="history-list">
          {snapshots.length === 0 && (
            <div className="history-empty">
              <History size={26} />
              <strong>还没有历史版本</strong>
              <p>继续调整设备，停顿一下就会自动生成第一条记录；也可以在上方手动命名留存。</p>
            </div>
          )}
          {snapshots.map((snapshot, index) => {
            const previous = snapshots[index + 1] ?? null
            const isBusy = busySnapshotId === snapshot.id
            return (
              <article className={`snapshot-card snapshot-${snapshot.kind}`} key={snapshot.id}>
                <div className="snapshot-main">
                  <div className="snapshot-heading">
                    <span className={`snapshot-badge badge-${snapshot.kind}`}>{snapshotKindLabel(snapshot.kind)}</span>
                    <strong title={snapshot.name ?? snapshotTitle(snapshot)}>{snapshotTitle(snapshot)}</strong>
                    <time dateTime={snapshot.createdAt} title={formatFullSnapshotTime(snapshot.createdAt)}>{formatSnapshotTime(snapshot.createdAt)}</time>
                  </div>
                  <div className="snapshot-metrics">
                    <span><small>设备</small>{snapshot.itemCount} 件</span>
                    <span><small>桌面</small>{snapshot.deskWidthMm} × {snapshot.deskHeightMm}</span>
                    <span className={snapshot.issueCount > 0 ? 'snapshot-issues-warn' : ''}><small>问题</small>{snapshot.issueCount === 0 ? '无' : `${snapshot.issueCount} 个`}</span>
                  </div>
                  <div className="snapshot-trend">{trendChips(snapshot, previous)}</div>
                </div>
                <div className="snapshot-actions">
                  <button className="snapshot-action-button" disabled={isBusy} onClick={() => onRestore(snapshot.id)} type="button">
                    <RotateCcw size={13} /> {isBusy ? '处理中…' : '整体恢复'}
                  </button>
                  {forkingId === snapshot.id ? (
                    <span className="fork-row">
                      <input
                        autoFocus
                        value={forkName}
                        maxLength={40}
                        placeholder="新方案名称"
                        onChange={(event) => setForkName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') submitFork(snapshot.id)
                          if (event.key === 'Escape') { setForkingId(null); setForkName('') }
                        }}
                      />
                      <button className="fork-confirm" onClick={() => submitFork(snapshot.id)} type="button"><Save size={13} /> 生成</button>
                      <button className="fork-cancel" onClick={() => { setForkingId(null); setForkName('') }} type="button"><X size={13} /></button>
                    </span>
                  ) : (
                    <button
                      className="snapshot-action-button"
                      disabled={busySnapshotId !== null}
                      onClick={() => { setForkingId(snapshot.id); setForkName(`${snapshot.planName} · 找回版本`) }}
                      type="button"
                    >
                      <Save size={13} /> 另存为新方案
                    </button>
                  )}
                  {snapshot.kind === 'manual' && (
                    <button
                      className="snapshot-action-button snapshot-delete"
                      disabled={busySnapshotId !== null}
                      onClick={() => onDelete(snapshot.id)}
                      aria-label="删除该命名版本"
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>

        <footer className="history-footer">
          自动节点保留最近 15 条，命名版本保留最近 20 条；删除方案时其历史会一并清理。恢复操作会先自动留存当前摆法，随时可以再退回来。
        </footer>
      </aside>
    </div>
  )
}
