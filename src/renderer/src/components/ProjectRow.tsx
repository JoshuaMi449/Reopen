import { Check, Folder, FileCode2, Play, Square, Tag } from 'lucide-react'
import type { Project, ProjectStatusEvent } from '../../../shared/types'

interface Props {
  project: Project
  status?: ProjectStatusEvent
  /** 点击行：打开右侧详情抽屉（2026-08-20 拍板，不再行内展开） */
  onOpen(): void
  onStart(): void
  onStop(): void
  /** 右键菜单（PRD 3.3） */
  onContextMenu(e: React.MouseEvent): void
  /** 手动排序（访达式拖拽）：仅在手动排序模式下启用 */
  sortDraggable?: boolean
  /** 正在被拖拽（半透明拖影，2026-08-21） */
  dragging?: boolean
  /** 拖拽悬停在本行上：行底显示插入指示线（2026-08-21） */
  dropTarget?: boolean
  onDragStart?(e: React.DragEvent): void
  onDragOver?(e: React.DragEvent): void
  onDragEnd?(e: React.DragEvent): void
  onDrop?(e: React.DragEvent): void
  /** 在自启项里（PRD 3.5：打勾同步显示） */
  autoStartChecked?: boolean
  /** 标签 → 染色（有颜色时 Tag icon 填色；默认无色，2026-08-21） */
  tagColor?(tag: string): string | undefined
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

/** 列表行（PRD 3.3 列表行；点击打开右侧详情抽屉） */
export function ProjectRow({
  project,
  status,
  onOpen,
  onStart,
  onStop,
  onContextMenu,
  sortDraggable,
  dragging,
  dropTarget,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  autoStartChecked,
  tagColor
}: Props): React.JSX.Element {
  const st = status?.status ?? 'stopped'
  const failed = st === 'failed'
  const running = st === 'running'
  const starting = st === 'starting'
  const port = status?.port ?? project.port

  return (
    <div className={`project-row ${failed ? 'row-failed' : ''} ${dragging ? 'dragging' : ''}`}>
      <div
        className={`row-main ${dropTarget ? 'drop-target' : ''}`}
        draggable={sortDraggable}
        onClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e)
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
      >
        <span className={`status-dot dot-${st}`} title={STATUS_TEXT[st]} />
        <span className="row-icon">
          {project.type === 'service' ? <Folder size={16} /> : <FileCode2 size={16} />}
        </span>
        <span className="row-name">{project.name}</span>
        {autoStartChecked && (
          <span className="autostart-check" title="在自启项里">
            <Check size={13} />
          </span>
        )}
        {/* 标签放行中间（名称之后；2026-08-21 拍板：Tag icon+文字，染了色则 icon 填色） */}
        {project.tags.length > 0 && (
          <span className="row-tags">
            {project.tags.map((t) => {
              const color = tagColor?.(t)
              return (
                <span key={t} className="row-tag">
                  {/* 无色时显式 fill="none"，避免 SVG 默认黑填充（2026-08-21 修复） */}
                  <Tag size={11} fill={color ?? 'none'} color={color ?? undefined} />
                  {t}
                </span>
              )
            })}
          </span>
        )}
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
        </span>
      </div>
    </div>
  )
}
