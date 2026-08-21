import { Check, ChevronDown, ChevronRight, Layers, Tag } from 'lucide-react'
import type { Project } from '../../../shared/types'

interface Props {
  group: Project
  expanded: boolean
  onToggle(): void
  /** 子项总数 / 在线子项数（组行摘要：N 个子项 · M 个在线） */
  childrenCount: number
  onlineCount: number
  /** 标签 → 染色（与项目行一致） */
  tagColor(tag: string): string | undefined
  /** 组在自启项里（开机只拉组内成品子项，2026-08-21 拍板） */
  autoStartChecked: boolean
  onContextMenu(e: React.MouseEvent): void
  /** 拖拽排序（与项目行同规则） */
  sortDraggable: boolean
  dragging: boolean
  dropTarget: boolean
  onDragStart(e: React.DragEvent): void
  onDragOver(e: React.DragEvent): void
  onDragEnd(e: React.DragEvent): void
  onDrop(e: React.DragEvent): void
}

/** 项目组行（2026-08-21 拍板）：展开箭头 + 组名 + 标签 + 子项摘要；点击=展开/收起，不启动 */
export function GroupRow({
  group,
  expanded,
  onToggle,
  childrenCount,
  onlineCount,
  tagColor,
  autoStartChecked,
  onContextMenu,
  sortDraggable,
  dragging,
  dropTarget,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop
}: Props): React.JSX.Element {
  return (
    <div className={`project-row group-row ${dragging ? 'dragging' : ''}`}>
      <div
        className={`row-main ${dropTarget ? 'drop-target' : ''}`}
        draggable={sortDraggable}
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e)
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
      >
        <span className="group-arrow">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span className="row-icon">
          <Layers size={16} />
        </span>
        <span className="row-name">{group.name}</span>
        {autoStartChecked && (
          <span className="autostart-check" title="在自启项里（开机只拉组内成品网站）">
            <Check size={13} />
          </span>
        )}
        {group.tags.length > 0 && (
          <span className="row-tags">
            {group.tags.map((t) => {
              const color = tagColor(t)
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
        <span className="group-summary">
          {childrenCount} 个子项 · {onlineCount} 个在线
        </span>
      </div>
    </div>
  )
}
