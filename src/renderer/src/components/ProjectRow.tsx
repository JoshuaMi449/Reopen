import {
  ExternalLink,
  Eye,
  Folder,
  FileCode2,
  MonitorPause,
  MonitorPlay,
  Tag,
  Zap
} from 'lucide-react'
import {
  hasPreviewFallback,
  isPureWeb,
  type Project,
  type ProjectStatusEvent
} from '../../../shared/types'

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
  /** 点端口在浏览器打开（运行中时端口可点，2026-08-21 网站常驻） */
  onOpenBrowser?(): void
  /** 启动失败后的「看成品」兜底按钮（2026-08-24 拍板） */
  onViewPreview?(): void
  /** 是组内子项（缩进显示，2026-08-21 项目组） */
  isChild?: boolean
  /** 标签 → 染色（有颜色时 Tag icon 填色；默认无色，2026-08-21） */
  tagColor?(tag: string): string | undefined
  /** 框选多选中（2026-08-24 拍板）：高亮描边 */
  selected?: boolean
  /** 有选中时点击=切换选中（代替打开抽屉） */
  selectMode?: boolean
  onSelectToggle?(): void
  /** 本机局域网 IP（非空=局域网访问开着，端口旁显示局域网地址，2026-08-24） */
  lanIp?: string
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
  tagColor,
  onOpenBrowser,
  onViewPreview,
  isChild,
  selected,
  selectMode,
  onSelectToggle,
  lanIp
}: Props): React.JSX.Element {
  const st = status?.status ?? 'stopped'
  const failed = st === 'failed'
  const running = st === 'running'
  const starting = st === 'starting'
  const port = status?.port ?? project.port

  return (
    <div
      className={`project-row ${failed ? 'row-failed' : ''} ${dragging ? 'dragging' : ''} ${
        isChild ? 'child-row' : ''
      } ${selected ? 'selected' : ''}`}
      data-pid={project.id}
    >
      <div
        className={`row-main ${dropTarget ? 'drop-target' : ''}`}
        draggable={sortDraggable}
        onClick={selectMode ? onSelectToggle : onOpen}
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
            <Zap size={13} />
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
        {/* 运行中端口可点开浏览器（2026-08-21 网站常驻；局域网访问开时副链显示局域网地址） */}
        <span className="row-port">
          {running && port ? (
            <>
              <a
                className="port-link"
                title="在浏览器打开"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenBrowser?.()
                }}
              >
                :{port}
                <ExternalLink size={11} />
              </a>
              {lanIp && (
                <a
                  className="lan-link"
                  title="局域网地址（同一 Wi-Fi 的设备用这个）"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.api.openExternal(`http://${lanIp}:${port}`)
                  }}
                >
                  {lanIp}:{port}
                </a>
              )}
            </>
          ) : port ? (
            `:${port}`
          ) : (
            ''
          )}
        </span>
        <span className="row-last">{formatTime(project.lastStartedAt)}</span>
        {project.note && <span className="row-note">{project.note}</span>}
        {failed && status?.reason && (
          <span className="row-fail-reason" title={status.reason}>
            {status.reason}
            {hasPreviewFallback(project) && (
              <button
                className="btn-mini"
                onClick={(e) => {
                  e.stopPropagation()
                  onViewPreview?.()
                }}
              >
                <Eye size={12} /> 看成品
              </button>
            )}
          </span>
        )}
        <span className="row-actions">
          {/* 纯网页（2026-08-24 拍板）：无需激活、永远在线——没有启动/停止，只有「在浏览器打开」 */}
          {isPureWeb(project) ? (
            <button
              className="icon-btn"
              title="在浏览器打开"
              onClick={(e) => {
                e.stopPropagation()
                onOpenBrowser?.()
              }}
            >
              <ExternalLink size={16} />
            </button>
          ) : running || starting || failed ? (
            // failed 时进程可能还活着（端口没起来但进程在跑），给停止按钮
            <button
              className="icon-btn"
              title="停止"
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
            >
              <MonitorPause size={16} />
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
              <MonitorPlay size={16} />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
