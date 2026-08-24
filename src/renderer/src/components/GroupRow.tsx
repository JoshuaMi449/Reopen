import { Layers, Tag, Zap } from 'lucide-react'
import type { Project } from '../../../shared/types'

interface Props {
  group: Project
  /** 点击组 = 跳侧栏「组」页面显示组内项目（2026-08-24 拍板：不再展开/弹抽屉） */
  onOpen(): void
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
  /** 框选多选中（2026-08-24 拍板）：高亮描边 */
  selected?: boolean
  /** 有选中时点击=切换选中（代替展开/收起） */
  selectMode?: boolean
  onSelectToggle?(): void
}

/** 项目组行（2026-08-24 拍板重做）：组名 + 标签 + 子项摘要；点击=跳侧栏「组」页面显示组内项目 */
export function GroupRow({
  group,
  onOpen,
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
  onDrop,
  selected,
  selectMode,
  onSelectToggle
}: Props): React.JSX.Element {
  return (
    <div
      className={`project-row group-row ${dragging ? 'dragging' : ''} ${selected ? 'selected' : ''}`}
      data-pid={group.id}
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
        <span className="row-icon">
          <Layers size={16} />
        </span>
        <span className="row-name">{group.name}</span>
        {autoStartChecked && (
          <span className="autostart-check" title="在自启项里（开机只拉组内成品网站）">
            <Zap size={13} />
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
