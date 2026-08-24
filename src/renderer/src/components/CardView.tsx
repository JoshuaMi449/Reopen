import { Fragment, useState } from 'react'
import {
  ExternalLink,
  Eye,
  FileCode2,
  Folder,
  Layers,
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

interface ListItem {
  p: Project
  /** 标签排序时：该项目前是否需要插组头（2026-08-21 起只留文字，无颜色） */
  header: { label: string } | null
}

interface Props {
  items: ListItem[]
  statuses: Record<string, ProjectStatusEvent>
  /** 自启项内的项目 id（打勾同步显示） */
  autoStartIds: string[]
  /** 标签 → 染色（有颜色时 Tag icon 填色；默认无色，2026-08-21） */
  tagColor(tag: string): string | undefined
  /** 正在被拖拽的项目 id（半透明拖影） */
  dragId: string | null
  /** 拖拽悬停的目标 id：其后面显示占位空位（动态让位） */
  dragOverId: string | null
  /** 是否可拖拽（无排序时拖拽排序 / 自启总开关开时拖入面板，与列表行同规则） */
  sortDraggable: boolean
  onDragStart(e: React.DragEvent, p: Project): void
  onDragOver(e: React.DragEvent, p: Project): void
  onDragEnd(e: React.DragEvent): void
  onDrop(e: React.DragEvent, p: Project): void
  /** 点击卡片：打开右侧详情抽屉 */
  onOpen(p: Project): void
  /** 点端口在浏览器打开（运行中时端口可点，2026-08-21 网站常驻） */
  onOpenBrowser(p: Project): void
  onStart(p: Project): void
  onStop(p: Project): void
  /** 启动失败后的「看成品」兜底按钮（2026-08-24 拍板） */
  onViewPreview(p: Project): void
  onContextMenu(e: React.MouseEvent, p: Project): void
  /** 组 → 子项（2026-08-21 项目组：组卡显示子项汇总+成品端口） */
  childrenOf(id: string): Project[]
  /** 框选多选中（2026-08-24 拍板）：高亮描边 */
  selected(p: Project): boolean
  /** 有选中时点击=切换选中（代替打开抽屉） */
  selectMode: boolean
  onSelectToggle(p: Project): void
  /** 本机局域网 IP（非空=局域网访问开着，端口旁显示局域网地址，2026-08-24） */
  lanIp?: string
}

function formatTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 卡片视图（PRD 3.3：同数据不同排版；点击打开右侧详情抽屉；标签排序时插组头）
 *  2026-08-21 拍板：卡片固定 220 宽（CSS auto-fill 决定列数，面板/抽屉挤入自动让列），
 *  卡片支持拖拽（排序/拖入自启面板） */
export function CardView({
  items,
  statuses,
  autoStartIds,
  tagColor,
  dragId,
  dragOverId,
  sortDraggable,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onOpen,
  onOpenBrowser,
  onStart,
  onStop,
  onViewPreview,
  onContextMenu,
  childrenOf,
  selected,
  selectMode,
  onSelectToggle,
  lanIp
}: Props): React.JSX.Element {
  // 局域网地址复制反馈（2026-08-24 拍板：点击=复制不再跳转；记录是哪张卡在显示「已复制」）
  const [lanCopiedId, setLanCopiedId] = useState<string | null>(null)
  return (
    <div className="card-grid">
      {items.map(({ p, header }) => {
        // 组卡（2026-08-21 项目组，2026-08-21 实测重做）：与普通卡片同样大小；
        // 卡内=组名+子项汇总+成品网站端口可点；点卡=打开组抽屉（子项列表）；子卡不铺开
        if (p.type === 'group') {
          const children = childrenOf(p.id)
          const online = children.filter((c) => statuses[c.id]?.status === 'running')
          const webOnline = online.find((c) => c.type === 'web')
          const webPort = webOnline ? statuses[webOnline.id]?.port : undefined
          return (
            <Fragment key={p.id}>
              {header && <div className="list-group-header card-grid-full">{header.label}</div>}
              <div
                className={`card ${dragOverId === p.id ? 'drop-target' : ''} ${
                  selected(p) ? 'selected' : ''
                }`}
                data-pid={p.id}
                draggable={sortDraggable}
                onClick={selectMode ? () => onSelectToggle(p) : () => onOpen(p)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onContextMenu(e, p)
                }}
                onDragStart={(e) => onDragStart(e, p)}
                onDragOver={(e) => onDragOver(e, p)}
                onDragEnd={onDragEnd}
                onDrop={(e) => onDrop(e, p)}
              >
                <div className="card-head">
                  <span className="row-icon">
                    <Layers size={15} />
                  </span>
                  <span className="card-name">{p.name}</span>
                  {autoStartIds.includes(p.id) && (
                    <span className="autostart-check" title="在自启项里（开机只拉组内成品网站）">
                      <Zap size={13} />
                    </span>
                  )}
                </div>
                <div className="card-body">
                  <div className="card-port">
                    {children.length} 个子项 · {online.length} 个在线
                  </div>
                  {webOnline && webPort && (
                    <a
                      className="port-link"
                      title="在浏览器打开（组内成品网站）"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenBrowser(webOnline)
                      }}
                    >
                      localhost:{webPort}
                      <ExternalLink size={11} />
                    </a>
                  )}
                </div>
                {p.tags.length > 0 && (
                  <div className="card-tags">
                    {p.tags.map((t) => {
                      const color = tagColor(t)
                      return (
                        <span key={t} className="card-tag-item">
                          {/* 无色时显式 fill="none"，避免 SVG 默认黑填充（2026-08-21 修复） */}
                          <Tag size={11} fill={color ?? 'none'} color={color ?? undefined} />
                          {t}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            </Fragment>
          )
        }
        const st = statuses[p.id]?.status ?? 'stopped'
        const failed = st === 'failed'
        const active = st === 'running' || st === 'starting'
        const port = statuses[p.id]?.port ?? p.port
        return (
          <Fragment key={p.id}>
            {header && <div className="list-group-header card-grid-full">{header.label}</div>}
            <div
              className={`card ${failed ? 'card-failed' : ''} ${dragId === p.id ? 'dragging' : ''} ${
                dragOverId === p.id ? 'drop-target' : ''
              } ${selected(p) ? 'selected' : ''}`}
              data-pid={p.id}
              // 组内子项不可拖拽排序（顺序固定在组内，2026-08-21 项目组）
              draggable={sortDraggable && !p.parentId}
              onDragStart={(e) => onDragStart(e, p)}
              onDragOver={(e) => onDragOver(e, p)}
              onDragEnd={onDragEnd}
              onDrop={(e) => onDrop(e, p)}
              onClick={selectMode ? () => onSelectToggle(p) : () => onOpen(p)}
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
                {autoStartIds.includes(p.id) && (
                  <span className="autostart-check" title="在自启项里">
                    <Zap size={13} />
                  </span>
                )}
                <span className="row-actions">
                  {/* 纯网页（2026-08-24 拍板）：无需激活、永远在线——没有启动/停止，只有「在浏览器打开」 */}
                  {isPureWeb(p) ? (
                    <button
                      className="icon-btn"
                      title="在浏览器打开"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenBrowser(p)
                      }}
                    >
                      <ExternalLink size={15} />
                    </button>
                  ) : active ? (
                    <button
                      className="icon-btn"
                      title="停止"
                      onClick={(e) => {
                        e.stopPropagation()
                        onStop(p)
                      }}
                    >
                      <MonitorPause size={15} />
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
                      <MonitorPlay size={15} />
                    </button>
                  )}
                </span>
              </div>
              <div className="card-body">
                {/* 运行中端口可点开浏览器（2026-08-21 网站常驻；局域网访问开时副链显示局域网地址） */}
                <div className="card-port">
                  {active && port ? (
                    <>
                      <a
                        className="port-link"
                        title="在浏览器打开"
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenBrowser(p)
                        }}
                      >
                        localhost:{port}
                        <ExternalLink size={11} />
                      </a>
                      {lanIp && (
                        <a
                          className="lan-link"
                          title="局域网地址（点击复制，同一 Wi-Fi 的设备用这个）"
                          onClick={(e) => {
                            e.stopPropagation()
                            void navigator.clipboard.writeText(`http://${lanIp}:${port}`)
                            setLanCopiedId(p.id)
                            setTimeout(() => setLanCopiedId(null), 1500)
                          }}
                        >
                          {lanCopiedId === p.id ? '已复制 ✓' : `${lanIp}:${port}`}
                        </a>
                      )}
                    </>
                  ) : port ? (
                    `localhost:${port}`
                  ) : (
                    '未设置端口'
                  )}
                </div>
                <div className="card-last">上次启动：{formatTime(p.lastStartedAt)}</div>
                {p.note && <div className="card-note">{p.note}</div>}
                {failed && statuses[p.id]?.reason && (
                  <div className="card-fail-reason">
                    {statuses[p.id].reason}
                    {hasPreviewFallback(p) && (
                      <button
                        className="btn-mini"
                        onClick={(e) => {
                          e.stopPropagation()
                          onViewPreview(p)
                        }}
                      >
                        <Eye size={12} /> 看成品
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* 右下角标签（2026-08-21 拍板）：绝对定位不撑高卡片，Tag icon+文字，染了色则 icon 填色 */}
              {p.tags.length > 0 && (
                <div className="card-tags">
                  {p.tags.map((t) => {
                    const color = tagColor(t)
                    return (
                      <span key={t} className="card-tag-item">
                        {/* 无色时显式 fill="none"，避免 SVG 默认黑填充（2026-08-21 修复） */}
                        <Tag size={11} fill={color ?? 'none'} color={color ?? undefined} />
                        {t}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
