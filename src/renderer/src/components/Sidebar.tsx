import { FileCode2, Folder, LayoutGrid, Settings as SettingsIcon, Tag } from 'lucide-react'
import wordmark from '../assets/wordmark.png'

/** 侧边栏分类：全部/服务/网页 + tag:xxx（2026-08-20 拍板：删"最近使用"） */
export type Category = 'all' | 'service' | 'web' | `tag:${string}`

interface Props {
  category: Category
  /** 已有标签名（标签染色后右侧 icon 填色；2026-08-21 拍板） */
  tags: string[]
  /** 标签 → 染色（无颜色返回 undefined，默认无色） */
  tagColor(tag: string): string | undefined
  counts: { all: number; service: number; web: number }
  /** 实时运行中的项目数量（底部状态行，2026-08-24 拍板，Proma 左下角排版） */
  runningCount: number
  onSelect(c: Category): void
  /** 标签右键：重命名/删除/染色菜单（2026-08-21） */
  onTagContextMenu(tag: string, e: React.MouseEvent): void
  /** 检查更新发现新版本时，设置 icon 右上角显示红点（M4 接入更新检查后由 App 传入） */
  showUpdateDot?: boolean
}

/** 侧边栏（PRD 3.3：按类型和标签浏览你的项目；底部 logo + 设置入口，2026-08-20 拍板） */
export function Sidebar({
  category,
  tags,
  tagColor,
  counts,
  runningCount,
  onSelect,
  onTagContextMenu,
  showUpdateDot
}: Props): React.JSX.Element {
  const items: { key: Category; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'all', label: '全部', icon: <LayoutGrid size={15} />, count: counts.all },
    { key: 'service', label: '服务', icon: <Folder size={15} />, count: counts.service },
    { key: 'web', label: '网页', icon: <FileCode2 size={15} />, count: counts.web }
  ]

  return (
    <aside className="sidebar" data-tour="sidebar">
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

      {tags.length > 0 && (
        <div className="sidebar-tags">
          <div className="sidebar-tags-title">标签</div>
          {tags.map((name) => {
            const key = `tag:${name}` as Category
            const color = tagColor(name)
            return (
              <button
                key={name}
                className={`sidebar-item ${category === key ? 'sidebar-item-active' : ''}`}
                onClick={() => onSelect(key)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onTagContextMenu(name, e)
                }}
              >
                <span className="sidebar-label">{name}</span>
                {/* 无色时显式 fill="none"：传 undefined 会被 React 移除 fill 属性，SVG 默认填充黑色（2026-08-21 修复） */}
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

      {/* 底部（2026-08-24 拍板）：运行数量行 + wordmark/设置 icon 整条水平居中；整条可点开设置，无分割线 */}
      <div className="sidebar-bottom-area">
        <div className="sidebar-running">
          <span className="sidebar-running-dot" />
          {runningCount} 个运行中
        </div>
        <div className="sidebar-bottom" onClick={() => window.api.openSettingsWindow()}>
          <img className="sidebar-logo-word" src={wordmark} alt="Reopen" draggable={false} />
          <button className="sidebar-settings-btn" title="设置">
            <SettingsIcon size={15} />
            {showUpdateDot && <span className="update-dot" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
