import { Fragment } from 'react'
import { Check, FileCode2, Folder, Play, Square } from 'lucide-react'
import type { Project, ProjectStatusEvent } from '../../../shared/types'

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
  /** 是否可拖拽（无排序时拖拽排序 / 自启总开关开时拖入面板，与列表行同规则） */
  sortDraggable: boolean
  onDragStart(e: React.DragEvent, p: Project): void
  onDragOver(e: React.DragEvent): void
  onDrop(e: React.DragEvent, p: Project): void
  /** 点击卡片：打开右侧详情抽屉 */
  onOpen(p: Project): void
  onStart(p: Project): void
  onStop(p: Project): void
  onContextMenu(e: React.MouseEvent, p: Project): void
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
  sortDraggable,
  onDragStart,
  onDragOver,
  onDrop,
  onOpen,
  onStart,
  onStop,
  onContextMenu
}: Props): React.JSX.Element {
  return (
    <div className="card-grid">
      {items.map(({ p, header }) => {
        const st = statuses[p.id]?.status ?? 'stopped'
        const failed = st === 'failed'
        const active = st === 'running' || st === 'starting'
        const port = statuses[p.id]?.port ?? p.port
        return (
          <Fragment key={p.id}>
            {header && <div className="list-group-header card-grid-full">{header.label}</div>}
            <div
              className={`card ${failed ? 'card-failed' : ''}`}
              draggable={sortDraggable}
              onDragStart={(e) => onDragStart(e, p)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, p)}
              onClick={() => onOpen(p)}
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
                    <Check size={13} />
                  </span>
                )}
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
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
