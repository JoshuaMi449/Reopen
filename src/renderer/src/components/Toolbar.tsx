import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowUpDown, Check, LayoutGrid, List, Plus, Search, Zap } from 'lucide-react'
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

const SORT_OPTIONS: { value: Settings['sortMode']; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'recent', label: '最近打开' },
  { value: 'created', label: '添加日期' },
  { value: 'tag', label: '标签' },
  { value: 'none', label: '无' }
]

/** 顶部工具栏（2026-08-21 拍板：搜索→添加→自启→排序图标→视图单按钮；
 *  排序从下拉框改图标+弹出小菜单、视图切换合成一个按钮——极端窄栏时全部放得下） */
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
  /** 排序小菜单是否打开（点外部/Esc/选中后关闭） */
  const [sortOpen, setSortOpen] = useState(false)
  const sortBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!sortOpen) return
    const onDown = (e: MouseEvent): void => {
      if (
        sortBtnRef.current?.contains(e.target as Node) ||
        (e.target as Element).closest('.sort-menu')
      )
        return
      setSortOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSortOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [sortOpen])

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

        <div className="sort-wrap">
          <Tooltip text="排序方式">
            <button
              ref={sortBtnRef}
              className={`icon-btn ${sortOpen ? 'icon-btn-active' : ''}`}
              title="排序方式"
              onClick={() => setSortOpen((v) => !v)}
            >
              <ArrowUpDown size={15} />
            </button>
          </Tooltip>
          {sortOpen && (
            <div className="sort-menu">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`sort-menu-item ${sortMode === o.value ? 'sort-menu-item-on' : ''}`}
                  onClick={() => {
                    onSort(o.value)
                    setSortOpen(false)
                  }}
                >
                  {o.label}
                  {sortMode === o.value && <Check size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 视图切换合成一个按钮：显示目标视图图标，点一下切过去（2026-08-21 拍板） */}
        <Tooltip text={view === 'list' ? '切换到卡片视图' : '切换到列表视图'}>
          <button
            className="icon-btn"
            title="切换视图"
            onClick={() => onView(view === 'list' ? 'card' : 'list')}
          >
            {view === 'list' ? <LayoutGrid size={15} /> : <List size={15} />}
          </button>
        </Tooltip>
      </div>
    </header>
  )
}
