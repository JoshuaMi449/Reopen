import { useEffect, useRef } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Folder,
  FileCode2,
  Play,
  RotateCcw,
  Square,
  Trash2
} from 'lucide-react'
import type { Project, ProjectStatusEvent } from '../../../shared/types'

interface Props {
  project: Project
  status?: ProjectStatusEvent
  logs: string[]
  expanded: boolean
  onToggle(): void
  onStart(): void
  onStop(): void
  onDelete(): void
  /** 右键菜单（PRD 3.3） */
  onContextMenu(e: React.MouseEvent): void
  /** 手动排序（访达式拖拽）：仅在手动排序模式下启用 */
  sortDraggable?: boolean
  onDragStart?(e: React.DragEvent): void
  onDragOver?(e: React.DragEvent): void
  onDrop?(e: React.DragEvent): void
}

const STATUS_TEXT: Record<string, string> = {
  stopped: '已停止',
  starting: '启动中…',
  running: '运行中',
  failed: '启动失败'
}

function formatTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 列表行 + 行内展开面板（PRD 3.3 列表行、3.4 行内面板） */
export function ProjectRow({
  project,
  status,
  logs,
  expanded,
  onToggle,
  onStart,
  onStop,
  onDelete,
  onContextMenu,
  sortDraggable,
  onDragStart,
  onDragOver,
  onDrop
}: Props): React.JSX.Element {
  const st = status?.status ?? 'stopped'
  const failed = st === 'failed'
  const running = st === 'running'
  const starting = st === 'starting'
  const port = status?.port ?? project.port

  return (
    <div className={`project-row ${failed ? 'row-failed' : ''}`}>
      <div
        className="row-main"
        draggable={sortDraggable}
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e)
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <span className={`status-dot dot-${st}`} title={STATUS_TEXT[st]} />
        <span className="row-icon">
          {project.type === 'service' ? <Folder size={16} /> : <FileCode2 size={16} />}
        </span>
        <span className="row-name">{project.name}</span>
        <span className="row-port">{port ? `:${port}` : ''}</span>
        <span className="row-last">{formatTime(project.lastStartedAt)}</span>
        {project.note && <span className="row-note">{project.note}</span>}
        {failed && status?.reason && (
          <span className="row-fail-reason" title={status.reason}>
            {status.reason}
          </span>
        )}
        <span className="row-actions">
          {/* failed 时进程可能还活着（端口没起来但进程在跑），给停止按钮 */}
          {running || starting || failed ? (
            <button
              className="icon-btn"
              title="停止"
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="icon-btn"
              title="启动"
              onClick={(e) => {
                e.stopPropagation()
                onStart()
              }}
            >
              <Play size={16} />
            </button>
          )}
          <button className="icon-btn" title={expanded ? '收起' : '展开'}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </span>
      </div>

      {expanded && (
        <DetailPanel
          project={project}
          status={status}
          logs={logs}
          onStart={onStart}
          onStop={onStop}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

/** 行内展开面板：状态、端口、命令、实时日志（PRD 3.4；卡片视图共用） */
export function DetailPanel({
  project,
  status,
  logs,
  onStart,
  onStop,
  onDelete
}: {
  project: Project
  status?: ProjectStatusEvent
  logs: string[]
  onStart(): void
  onStop(): void
  onDelete(): void
}): React.JSX.Element {
  const logRef = useRef<HTMLDivElement>(null)

  // 日志自动滚到底
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const st = status?.status ?? 'stopped'

  return (
    <div className="detail-panel">
      <div className="detail-meta">
        <span>
          状态：<b>{STATUS_TEXT[st]}</b>
        </span>
        <span>端口：{status?.port ?? project.port ?? '—'}</span>
        {project.type === 'service' && <span>命令：{project.command ?? '—'}</span>}
        <span className="detail-actions">
          <button
            className="btn-secondary"
            onClick={onStart}
            disabled={st === 'running' || st === 'starting'}
          >
            <RotateCcw size={14} /> 重启
          </button>
          {st === 'running' || st === 'starting' ? (
            <button className="btn-secondary" onClick={onStop}>
              <Square size={14} /> 停止
            </button>
          ) : null}
          <button className="btn-danger" onClick={onDelete}>
            <Trash2 size={14} /> 删除
          </button>
        </span>
      </div>
      <div className="detail-log" ref={logRef}>
        {logs.length === 0 ? (
          <div className="log-empty">还没有日志。点「重启」开始运行。</div>
        ) : (
          logs.map((line, i) => <div key={i}>{line}</div>)
        )}
      </div>
    </div>
  )
}
