import { FileCode2, Folder, Play, Square } from 'lucide-react'
import type { Project, ProjectStatusEvent } from '../../../shared/types'
import { DetailPanel } from './ProjectRow'

interface Props {
  projects: Project[]
  statuses: Record<string, ProjectStatusEvent>
  logs: Record<string, string[]>
  expandedId: string | null
  onToggle(id: string): void
  onStart(p: Project): void
  onStop(p: Project): void
  onDelete(p: Project): void
  onContextMenu(e: React.MouseEvent, p: Project): void
}

function formatTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 卡片视图（PRD 3.3：同数据不同排版） */
export function CardView({
  projects,
  statuses,
  logs,
  expandedId,
  onToggle,
  onStart,
  onStop,
  onDelete,
  onContextMenu
}: Props): React.JSX.Element {
  return (
    <div className="card-grid">
      {projects.map((p) => {
        const st = statuses[p.id]?.status ?? 'stopped'
        const failed = st === 'failed'
        const active = st === 'running' || st === 'starting'
        const port = statuses[p.id]?.port ?? p.port
        const expanded = expandedId === p.id
        return (
          <div key={p.id} className="card-wrap">
            <div
              className={`card ${failed ? 'card-failed' : ''}`}
              onClick={() => onToggle(p.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                onContextMenu(e, p)
              }}
            >
              <div className="card-head">
                <span className={`status-dot dot-${st}`} />
                <span className="row-icon">
                  {p.type === 'service' ? <Folder size={15} /> : <FileCode2 size={15} />}
                </span>
                <span className="card-name">{p.name}</span>
                <span className="row-actions">
                  {active ? (
                    <button
                      className="icon-btn"
                      title="停止"
                      onClick={(e) => {
                        e.stopPropagation()
                        onStop(p)
                      }}
                    >
                      <Square size={15} />
                    </button>
                  ) : (
                    <button
                      className="icon-btn"
                      title="启动"
                      onClick={(e) => {
                        e.stopPropagation()
                        onStart(p)
                      }}
                    >
                      <Play size={15} />
                    </button>
                  )}
                </span>
              </div>
              <div className="card-body">
                <div className="card-port">{port ? `localhost:${port}` : '未设置端口'}</div>
                <div className="card-last">上次启动：{formatTime(p.lastStartedAt)}</div>
                {p.note && <div className="card-note">{p.note}</div>}
                {failed && statuses[p.id]?.reason && (
                  <div className="card-fail-reason">{statuses[p.id].reason}</div>
                )}
                {p.tags.length > 0 && (
                  <div className="card-tags">
                    {p.tags.map((t) => (
                      <span key={t} className="card-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {expanded && (
              <div className="card-panel">
                <DetailPanel
                  project={p}
                  status={statuses[p.id]}
                  logs={logs[p.id] ?? []}
                  onStart={() => onStart(p)}
                  onStop={() => onStop(p)}
                  onDelete={() => onDelete(p)}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
