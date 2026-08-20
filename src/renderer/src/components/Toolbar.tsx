import type { RefObject } from 'react'
import {
  ArrowDownWideNarrow,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings as SettingsIcon,
  Zap
} from 'lucide-react'
import type { Settings } from '../../../shared/types'

interface Props {
  search: string
  onSearch(v: string): void
  view: Settings['view']
  onView(v: Settings['view']): void
  sortMode: Settings['sortMode']
  onSort(m: Settings['sortMode']): void
  onAdd(): void
  onOpenSettings(): void
  onOpenAutoStart(): void
  /** 自启项里有几个项目（角标） */
  autoStartCount: number
  searchInputRef: RefObject<HTMLInputElement | null>
}

/** 顶部工具栏（PRD 3.3：搜索框+视图切换+添加+设置齿轮+排序） */
export function Toolbar({
  search,
  onSearch,
  view,
  onView,
  sortMode,
  onSort,
  onAdd,
  onOpenSettings,
  onOpenAutoStart,
  autoStartCount,
  searchInputRef
}: Props): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className="search-box">
        <Search size={14} className="search-icon" />
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="搜索名称、备注、标签、端口…（⌘F）"
        />
      </div>

      <div className="toolbar-right">
        <button className="icon-btn" title="自启项" onClick={onOpenAutoStart}>
          <Zap size={16} />
          {autoStartCount > 0 && <span className="autostart-badge">{autoStartCount}</span>}
        </button>

        <select
          className="sort-select"
          value={sortMode}
          onChange={(e) => onSort(e.target.value as Settings['sortMode'])}
          title="排序方式"
        >
          <option value="manual">手动排序（可拖拽）</option>
          <option value="recent">最近使用</option>
          <option value="name">名称</option>
        </select>

        <div className="view-switch">
          <button
            className={`icon-btn ${view === 'list' ? 'icon-btn-active' : ''}`}
            title="列表视图"
            onClick={() => onView('list')}
          >
            <List size={15} />
          </button>
          <button
            className={`icon-btn ${view === 'card' ? 'icon-btn-active' : ''}`}
            title="卡片视图"
            onClick={() => onView('card')}
          >
            <LayoutGrid size={15} />
          </button>
        </div>

        <span className="toolbar-divider" />

        <button className="icon-btn" title="添加项目" onClick={onAdd}>
          <Plus size={16} />
        </button>
        <button className="icon-btn" title="偏好设置" onClick={onOpenSettings}>
          <SettingsIcon size={16} />
        </button>
      </div>

      <span className="toolbar-sort-hint">
        <ArrowDownWideNarrow size={12} />
      </span>
    </header>
  )
}
