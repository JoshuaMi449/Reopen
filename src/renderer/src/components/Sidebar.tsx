import { useState } from 'react'
import { FileCode2, Folder, LayoutGrid, Settings as SettingsIcon, Tag } from 'lucide-react'
import wordmark from '../assets/wordmark.png'

/** 侧边栏分类：全部/服务/网页 + group:xxx + tag:xxx（删"最近使用"：加组区块） */
export type Category = 'all' | 'service' | 'web' | `group:${string}` | `tag:${string}`

/** 侧栏拖拽排序的载荷 MIME（tag/group 分开：容器级 dragover 拿不到数据，靠 MIME 区分 kind） */
const MIME = (kind: 'tag' | 'group'): string =>
  kind === 'tag' ? 'application/x-reopen-sort-tag' : 'application/x-reopen-sort-group'

/** 拖拽悬停目标：条目（插前/插后）或列表首尾（拖出条目范围落到上方/下方仍可排序） */
type DropTarget =
  | { kind: 'tag' | 'group'; key: string; before: boolean; rect: DOMRect }
  | { kind: 'tag' | 'group'; edge: 'start' | 'end'; rect: DOMRect }

interface Props {
  category: Category
  /** 已有标签名（按 tagOrder 排序后传入；标签染色后右侧 icon 填色） */
  tags: string[]
  /** 标签 → 染色（无颜色返回 undefined，默认无色） */
  tagColor(tag: string): string | undefined
  counts: { all: number; service: number; web: number }
  /** 项目组列表（按 groupOrder 排序后传入；无组时整个区块不显示） */
  groups: { id: string; name: string; childCount: number }[]
  /** 实时运行中的项目数量（底部状态行，左下角排版） */
  runningCount: number
  onSelect(c: Category): void
  /** 标签右键：重命名/删除/染色菜单（ */
  onTagContextMenu(tag: string, e: React.MouseEvent): void
  /** 组右键：重命名/编辑/解散/删除（与中间栏组右键同一套菜单） */
  onGroupContextMenu(id: string, e: React.MouseEvent): void
  /** 拖动标签换顺序（from/to 是标签名；before=插到目标前面；决定标签排序模式下的分组先后） */
  onTagMove(from: string, to: string, before: boolean): void
  /** 拖动组换顺序（from/to 是组 id；before=插到目标前面） */
  onGroupMove(from: string, to: string, before: boolean): void
  /** 拖出条目范围落到列表上方/下方：直接排到最前/最后 */
  onTagMoveToEdge(from: string, edge: 'start' | 'end'): void
  onGroupMoveToEdge(from: string, edge: 'start' | 'end'): void
  /** 检查更新发现新版本时，设置 icon 右上角显示红点（M4 接入更新检查后由 App 传入） */
  showUpdateDot?: boolean
}

/** 侧边栏（PRD 3.3：按类型/组/标签浏览你的项目；底部 logo + 设置入口） */
export function Sidebar({
  category,
  tags,
  tagColor,
  counts,
  groups,
  runningCount,
  onSelect,
  onTagContextMenu,
  onGroupContextMenu,
  onTagMove,
  onGroupMove,
  onTagMoveToEdge,
  onGroupMoveToEdge,
  showUpdateDot
}: Props): React.JSX.Element {
  const items: { key: Category; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'all', label: '全部', icon: <LayoutGrid size={15} />, count: counts.all },
    { key: 'service', label: '服务', icon: <Folder size={15} />, count: counts.service },
    { key: 'web', label: '网页', icon: <FileCode2 size={15} />, count: counts.web }
  ]

  /** 插入指示（条目插前/插后或列表首尾），线用 fixed 全局渲染 */
  const [dropOn, setDropOn] = useState<DropTarget | null>(null)

  /** 条目拖拽（kind 区分标签/组；指针在目标上半=插到它前面，仿访达侧栏插入线） */
  const dragHandlers = (kind: 'tag' | 'group', key: string): React.ComponentProps<'button'> => ({
    draggable: true,
    onDragStart: (e: React.DragEvent): void => {
      e.dataTransfer.setData(MIME(kind), key)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e: React.DragEvent): void => {
      if (!e.dataTransfer.types.includes(MIME(kind))) return
      e.preventDefault()
      e.stopPropagation() // 不让 aside 的首尾判定接管（指针在条目上=按条目判定）
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const before = e.clientY < r.top + r.height / 2
      if (
        dropOn?.kind !== kind ||
        !('key' in dropOn) ||
        dropOn.key !== key ||
        dropOn.before !== before
      ) {
        setDropOn({ kind, key, before, rect: r })
      }
    },
    onDragLeave: (): void => setDropOn(null),
    onDrop: (e: React.DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const raw = e.dataTransfer.getData(MIME(kind))
      const cur = dropOn
      setDropOn(null)
      if (!raw || !cur || !('key' in cur)) return
      if (cur.key !== key) return
      if (kind === 'tag') onTagMove(raw, key, cur.before)
      else onGroupMove(raw, key, cur.before)
    }
  })

  /** aside 容器级：拖出条目范围（列表上方/下方空白、底部设置区）→ 按指针判定排到最前/最后。
   *  React 19 的 ComponentProps<'aside'> 含 ref，展开会污染 div 的 ref 类型——Omit 掉；
   *  容器就是 e.currentTarget，不用 ref */
  const containerHandlers = (
    kind: 'tag' | 'group'
  ): Omit<React.ComponentProps<'aside'>, 'ref'> => ({
    onDragOver: (e: React.DragEvent): void => {
      if (!e.dataTransfer.types.includes(MIME(kind))) return
      const rows = Array.from(
        (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.sidebar-item')
      )
      if (rows.length === 0) return
      e.preventDefault()
      const first = rows[0].getBoundingClientRect()
      const last = rows[rows.length - 1].getBoundingClientRect()
      let edge: 'start' | 'end' | null = null
      if (e.clientY < first.top + first.height / 2) edge = 'start'
      else if (e.clientY > last.top + last.height / 2) edge = 'end'
      if (!edge) {
        setDropOn(null) // 指针在条目之间：条目自己的 dragover 会接管
        return
      }
      setDropOn({
        kind,
        edge,
        rect: edge === 'start' ? first : last
      })
    },
    onDrop: (e: React.DragEvent): void => {
      if (!e.dataTransfer.types.includes(MIME(kind))) return
      e.preventDefault()
      const raw = e.dataTransfer.getData(MIME(kind))
      const cur = dropOn
      setDropOn(null)
      if (!raw || !cur || !('edge' in cur)) return
      if (kind === 'tag') onTagMoveToEdge(raw, cur.edge)
      else onGroupMoveToEdge(raw, cur.edge)
    }
  })

  return (
    <aside className="sidebar" data-tour="sidebar" {...containerHandlers('tag')}>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <button
            key={item.key}
            className={`sidebar-item ${category === item.key ? 'sidebar-item-active' : ''}`}
            onClick={() => onSelect(item.key)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
            <span className="sidebar-count">{item.count}</span>
          </button>
        ))}
      </nav>

      {/* 组区块（标题字后跟细灰虚线；没有组整个区块不显示 */}
      {groups.length > 0 && (
        <div className="sidebar-tags sidebar-groups" {...containerHandlers('group')}>
          <div className="sidebar-section-title">组</div>
          {groups.map((g) => {
            const key = `group:${g.id}` as Category
            const dnd = dragHandlers('group', g.id)
            return (
              <button
                key={g.id}
                {...dnd}
                className={`sidebar-item ${category === key ? 'sidebar-item-active' : ''}`}
                onClick={() => onSelect(key)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onGroupContextMenu(g.id, e)
                }}
              >
                <span className="sidebar-label">{g.name}</span>
                <span className="sidebar-count">{g.childCount}</span>
              </button>
            )
          })}
        </div>
      )}

      {tags.length > 0 && (
        <div className="sidebar-tags" {...containerHandlers('tag')}>
          <div className="sidebar-section-title">标签</div>
          {tags.map((name) => {
            const key = `tag:${name}` as Category
            const color = tagColor(name)
            const dnd = dragHandlers('tag', name)
            return (
              <button
                key={name}
                {...dnd}
                className={`sidebar-item ${category === key ? 'sidebar-item-active' : ''}`}
                onClick={() => onSelect(key)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onTagContextMenu(name, e)
                }}
              >
                <span className="sidebar-label">{name}</span>
                {/* 无色时显式 fill="none"：传 undefined 会被 React 移除 fill 属性，SVG 默认填充黑色（修复） */}
                <Tag
                  size={13}
                  className="sidebar-tag-icon"
                  fill={color ?? 'none'}
                  color={color ?? undefined}
                />
              </button>
            )
          })}
        </div>
      )}

      {/* 底部（运行数量行 + wordmark/设置 icon 整条水平居中；整条可点开设置，无分割线 */}
      <div className="sidebar-bottom-area">
        <div className="sidebar-running">
          <span className="sidebar-running-dot" />
          {runningCount} 个运行中
        </div>
        <div className="sidebar-bottom" onClick={() => window.api.openSettingsWindow()}>
          <img className="sidebar-logo-word" src={wordmark} alt="Reopen" draggable={false} />
          <button className="sidebar-settings-btn" title="设置" data-tour="settings">
            <SettingsIcon size={15} />
            {showUpdateDot && <span className="update-dot" />}
          </button>
        </div>
      </div>

      {/* 侧栏拖拽插入线（fixed 渲染在条目上/下缘，仿访达侧栏蓝灰线） */}
      {dropOn && (
        <div
          className="drop-line drop-line-h"
          style={{
            left: dropOn.rect.left + 8,
            width: dropOn.rect.width - 16,
            top:
              'edge' in dropOn
                ? dropOn.edge === 'start'
                  ? dropOn.rect.top - 2
                  : dropOn.rect.bottom
                : dropOn.before
                  ? dropOn.rect.top - 2
                  : dropOn.rect.bottom
          }}
        />
      )}
    </aside>
  )
}
