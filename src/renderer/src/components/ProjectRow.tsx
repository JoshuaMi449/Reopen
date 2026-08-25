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
import { useState } from 'react'
import {
  hasPreviewFallback,
  isPureWeb,
  type Project,
  type ProjectStatusEvent
} from '../../../shared/types'

interface Props {
  project: Project
  status?: ProjectStatusEvent
  /** 点击行：打开右侧详情抽屉（不再行内展开） */
  onOpen(): void
  onStart(): void
  onStop(): void
  /** 右键菜单（PRD 3.3） */
  onContextMenu(e: React.MouseEvent): void
  /** 手动排序（访达式拖拽）：仅在手动排序模式下启用 */
  sortDraggable?: boolean
  /** 正在被拖拽（半透明拖影）*/
  dragging?: boolean
  /** 拖拽悬停在本行上：行底显示插入指示线（ */
  onDragStart?(e: React.DragEvent): void
  onDragOver?(e: React.DragEvent): void
  onDragEnd?(e: React.DragEvent): void
  onDrop?(e: React.DragEvent): void
  /** 在自启项里（PRD 3.5：打勾同步显示） */
  autoStartChecked?: boolean
  /** 点端口在浏览器打开（运行中时端口可点，网站常驻） */
  onOpenBrowser?(): void
  /** 启动失败后的「看成品」兜底按钮（ */
  onViewPreview?(): void
  /** 是组内子项（缩进显示，项目组） */
  isChild?: boolean
  /** 标签 → 染色（有颜色时 Tag icon 填色；默认无色）*/
  tagColor?(tag: string): string | undefined
  /** 框选多选中（高亮描边 */
  selected?: boolean
  /** 有选中时点击=切换选中（代替打开抽屉） */
  selectMode?: boolean
  onSelectToggle?(): void
  /** 本机局域网 IP（非空=局域网访问开着，端口旁显示局域网地址）*/
  lanIp?: string
  /** 局域网打不开时「由本应用托管」（接管服务没开门） */
  onRehost?(): void
  /** 引导期演示行专用的假局域网地址（demo 行专用，引导结束消失）*/
  demoLanIp?: string
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
  lanIp,
  onRehost,
  demoLanIp
}: Props): React.JSX.Element {
  const st = status?.status ?? 'stopped'
  const failed = st === 'failed'
  const running = st === 'running'
  const starting = st === 'starting'
  const port = status?.port ?? project.port
  // 引导期 demo 行显示假局域网地址（演示用，引导结束消失）
  // 局域网地址以主进程实测为准：通→显示；不通→灰字（demo 卡片显示假地址演示用）
  const rowLan =
    project.id === 'demo-app' && demoLanIp
      ? demoLanIp
      : status?.lanReachable === true
        ? (status.lanIp ?? lanIp)
        : ''
  const rowBlocked = project.id !== 'demo-app' && status?.lanReachable === false
  // 局域网地址复制反馈（点击=复制，不再跳转）
  const [lanCopied, setLanCopied] = useState(false)

  return (
    <div
      className={`project-row ${failed ? 'row-failed' : ''} ${dragging ? 'dragging' : ''} ${
        isChild ? 'child-row' : ''
      } ${selected ? 'selected' : ''}`}
      data-pid={project.id}
      data-tour={project.id === 'demo-app' ? 'demo-card' : undefined}
    >
      <div
        className="row-main"
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
        {/* 标签放行中间（名称之后：Tag icon+文字，染了色则 icon 填色） */}
        {project.tags.length > 0 && (
          <span className="row-tags">
            {project.tags.map((t) => {
              const color = tagColor?.(t)
              return (
                <span key={t} className="row-tag">
                  {/* 无色时显式 fill="none"，避免 SVG 默认黑填充（修复） */}
                  <Tag size={11} fill={color ?? 'none'} color={color ?? undefined} />
                  {t}
                </span>
              )
            })}
          </span>
        )}
        {/* 运行中端口可点开浏览器（网站常驻；局域网访问开时副链显示局域网地址） */}
        <span className="row-port">
          {running && port ? (
            <>
              <a
                className="port-link"
                data-tour={project.id === 'demo-app' ? 'lan-link' : undefined}
                title="在浏览器打开"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenBrowser?.()
                }}
              >
                :{port}
                <ExternalLink size={11} />
              </a>
              {rowLan && (
                <a
                  className={`lan-link ${lanCopied ? 'lan-copied' : ''}`}
                  data-tour={project.id === 'demo-app' ? 'lan-link' : undefined}
                  title="局域网地址（点击复制，同一 Wi-Fi 的设备用这个）"
                  onClick={(e) => {
                    e.stopPropagation()
                    void navigator.clipboard.writeText(`http://${rowLan}:${port}`)
                    setLanCopied(true)
                    setTimeout(() => setLanCopied(false), 1500)
                  }}
                >
                  {rowLan}:{port}
                  {lanCopied && <span className="lan-copied-tag">已复制 ✓</span>}
                </a>
              )}
              {rowBlocked && (
                <span
                  className="lan-blocked"
                  title={
                    status?.spawned === true
                      ? '这个服务是本应用拉起的，在项目的启动命令里加 --host 0.0.0.0 才能局域网访问'
                      : '这个服务只绑了本机，同一 Wi-Fi 的其他设备访问不了'
                  }
                >
                  仅本机可访问
                  {status?.spawned !== true && (
                    <button
                      className="lan-rehost"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRehost?.()
                      }}
                    >
                      由本应用托管
                    </button>
                  )}
                </span>
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
            启动失败 · 点击查看
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
          {/* 纯网页（无需激活、永远在线——没有启动/停止，只有「在浏览器打开」 */}
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
              data-tour={project.id === 'demo-app' ? 'row-play' : undefined}
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
