import { FileCode2, Folder, LayoutGrid, Settings as SettingsIcon, Tag } from 'lucide-react'
import logo from '../../../../resources/tray-icon.png'
import wordmark from '../assets/wordmark.png'

/** 侧边栏分类：全部/服务/网页 + tag:xxx（2026-08-20 拍板：删"最近使用"） */
export type Category = 'all' | 'service' | 'web' | `tag:${string}`

interface Props {
  category: Category
  tags: { name: string; color: string }[]
  counts: { all: number; service: number; web: number }
  onSelect(c: Category): void
}

/** 侧边栏（PRD 3.3：按类型和标签浏览你的项目；底部 logo + 设置入口，2026-08-20 拍板） */
export function Sidebar({ category, tags, counts, onSelect }: Props): React.JSX.Element {
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
          {tags.map((t) => {
            const key = `tag:${t.name}` as Category
            return (
              <button
                key={t.name}
                className={`sidebar-item ${category === key ? 'sidebar-item-active' : ''}`}
                onClick={() => onSelect(key)}
              >
                <span className="tag-dot" style={{ background: t.color }} />
                <span className="sidebar-label">{t.name}</span>
                <Tag size={13} className="sidebar-tag-icon" />
              </button>
            )
          })}
        </div>
      )}

      <div className="sidebar-bottom">
        <div className="sidebar-logo">
          <img className="sidebar-logo-mark" src={logo} alt="" draggable={false} />
          {/* Reopen 文字：HFPoohBear 字体渲染成的透明 PNG（2026-08-20 用户要求，不打包字体文件） */}
          <img className="sidebar-logo-word" src={wordmark} alt="Reopen" draggable={false} />
        </div>
        <button className="sidebar-item" onClick={() => window.api.openSettingsWindow()}>
          <span className="sidebar-icon">
            <SettingsIcon size={15} />
          </span>
          <span className="sidebar-label">设置</span>
        </button>
      </div>
    </aside>
  )
}
