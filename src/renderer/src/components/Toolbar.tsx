import type { RefObject } from 'react'
import { LayoutGrid, List, Plus, Search, Zap } from 'lucide-react'
import type { Settings } from '../../../shared/types'
import { Tooltip } from './Tooltip'

interface Props {
  search: string
  onSearch(v: string): void
  /** 搜索框是否展开（⌘F 或点搜索 icon 展开；Esc/再点 icon/失焦收起） */
  searchOpen: boolean
  onSearchOpen(v: boolean): void
  view: Settings['view']
  onView(v: Settings['view']): void
  sortMode: Settings['sortMode']
  onSort(m: Settings['sortMode']): void
  onAdd(): void
  onOpenAutoStart(): void
  /** 自启项里有几个项目（角标） */
  autoStartCount: number
  /** 自启项总开关：关=功能消失，顶部图标不显示（2026-08-20 验收整改） */
  autoStartEnabled: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  /** 自启 icon 的 DOM 引用（自启面板定位用） */
  autoStartBtnRef: RefObject<HTMLButtonElement | null>
}

/** 顶部工具栏（2026-08-20 拍板：右侧=搜索 icon→自启→排序→视图切换→+；搜索收起式；悬停提示全覆盖） */
export function Toolbar({
  search,
  onSearch,
  searchOpen,
  onSearchOpen,
  view,
  onView,
  sortMode,
  onSort,
  onAdd,
  onOpenAutoStart,
  autoStartCount,
  autoStartEnabled,
  searchInputRef,
  autoStartBtnRef
}: Props): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className={`search-box ${searchOpen ? 'search-box-open' : ''}`}>
        <Search size={14} className="search-icon" />
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onSearchOpen(false)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={() => onSearchOpen(false)}
          placeholder="搜索名称、备注、标签、端口…"
        />
      </div>

      <div className="toolbar-right">
        <Tooltip text="搜索项目（⌘F）">
          <button
            className={`icon-btn ${searchOpen ? 'icon-btn-active' : ''}`}
            title="搜索"
            onClick={() => {
              const next = !searchOpen
              onSearchOpen(next)
              if (next) requestAnimationFrame(() => searchInputRef.current?.focus())
            }}
          >
            <Search size={16} />
          </button>
        </Tooltip>

        {/* 添加按钮紧跟搜索（2026-08-21 用户反馈：原来在最右，极端压缩时被裁一半，往前移保证可见） */}
        <Tooltip text="添加项目">
          <button className="icon-btn" title="添加项目" onClick={onAdd} data-tour="add">
            <Plus size={16} />
          </button>
        </Tooltip>

        {autoStartEnabled && (
          <Tooltip text="自启项：打开软件自动启动">
            <button
              ref={autoStartBtnRef}
              className="icon-btn"
              title="自启项"
              onClick={onOpenAutoStart}
              data-tour="autostart"
            >
              <Zap size={16} />
              {autoStartCount > 0 && <span className="autostart-badge">{autoStartCount}</span>}
            </button>
          </Tooltip>
        )}

        <Tooltip text="排序方式">
          <select
            className="sort-select"
            value={sortMode}
            onChange={(e) => onSort(e.target.value as Settings['sortMode'])}
            title="排序方式"
          >
            <option value="name">名称</option>
            <option value="recent">最近打开</option>
            <option value="created">添加日期</option>
            <option value="tag">标签</option>
            <option value="none">无</option>
          </select>
        </Tooltip>

        <div className="view-switch">
          <Tooltip text="列表视图">
            <button
              className={`icon-btn ${view === 'list' ? 'icon-btn-active' : ''}`}
              title="列表视图"
              onClick={() => onView('list')}
            >
              <List size={15} />
            </button>
          </Tooltip>
          <Tooltip text="卡片视图">
            <button
              className={`icon-btn ${view === 'card' ? 'icon-btn-active' : ''}`}
              title="卡片视图"
              onClick={() => onView('card')}
            >
              <LayoutGrid size={15} />
            </button>
          </Tooltip>
        </div>
      </div>
    </header>
  )
}
