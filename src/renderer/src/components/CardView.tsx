import { Fragment, useEffect, useRef, useState } from 'react'
import { Check, FileCode2, Folder, Play, Square } from 'lucide-react'
import type { Project, ProjectStatusEvent } from '../../../shared/types'

const GAP = 12
const TARGET = 220

interface ListItem {
  p: Project
  /** 标签排序时：该项目前是否需要插组头（组头文字+色点颜色） */
  header: { label: string; color: string } | null
}

interface Props {
  items: ListItem[]
  statuses: Record<string, ProjectStatusEvent>
  /** 自启项内的项目 id（打勾同步显示） */
  autoStartIds: string[]
  /** 标签 → 颜色（右下角折角标签用） */
  tagColor(tag: string): string
  /** 点击卡片：打开右侧详情抽屉 */
  onOpen(p: Project): void
  onStart(p: Project): void
  onStop(p: Project): void
  onContextMenu(e: React.MouseEvent, p: Project): void
}

/** 折角上显示的标签名：超 5 字截断（标签本身限制 6 字，2026-08-20 拍板） */
function cornerLabel(tag: string): string {
  return tag.length > 5 ? `${tag.slice(0, 4)}…` : tag
}

function formatTime(ts?: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 卡片视图（PRD 3.3：同数据不同排版；点击打开右侧详情抽屉；标签排序时插组头） */
export function CardView({
  items,
  statuses,
  autoStartIds,
  tagColor,
  onOpen,
  onStart,
  onStop,
  onContextMenu
}: Props): React.JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState<{ n: number; w: number }>({ n: 3, w: TARGET })

  // 动态列宽（2026-08-20 拍板）：整数列 + 居中左右等距，卡片宽度随窗口自适应
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const compute = (): void => {
      const W = el.clientWidth
      const n = Math.max(1, Math.round((W + GAP) / (TARGET + GAP)))
      const w = Math.floor((W - (n - 1) * GAP) / n)
      setCols({ n, w })
    }
    const id = requestAnimationFrame(compute) // 初始计算放 rAF，避免 effect 内同步 setState
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => {
      cancelAnimationFrame(id)
      ro.disconnect()
    }
  }, [])

  return (
    <div
      ref={gridRef}
      className="card-grid"
      style={{ gridTemplateColumns: `repeat(${cols.n}, ${cols.w}px)`, justifyContent: 'center' }}
    >
      {items.map(({ p, header }) => {
        const st = statuses[p.id]?.status ?? 'stopped'
        const failed = st === 'failed'
        const active = st === 'running' || st === 'starting'
        const port = statuses[p.id]?.port ?? p.port
        return (
          <Fragment key={p.id}>
            {header && (
              <div className="list-group-header card-grid-full">
                <span
                  className="tag-dot"
                  style={header.color ? { background: header.color } : undefined}
                />
                {header.label}
              </div>
            )}
            <div
              className={`card ${failed ? 'card-failed' : ''}`}
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
              {/* 右下角折角标签（2026-08-20 拍板）：三角填色+标签名，不再占卡片高度 */}
              {p.tags.length > 0 && (
                <span
                  className="card-corner-tag"
                  style={{ '--corner': tagColor(p.tags[0]) } as React.CSSProperties}
                >
                  <span>{cornerLabel(p.tags[0])}</span>
                </span>
              )}
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
