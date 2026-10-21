import { Plus, Search, Zap } from 'lucide-react'
import type { RefObject } from 'react'
import { Tooltip } from './Tooltip'

interface Props {
  search: string
  onSearch(v: string): void
  onAdd(): void
  onOpenAutoStart(): void
  /** 自启项里有几个项目（角标） */
  autoStartCount: number
  /** 自启项总开关：关=功能消失，顶部图标不显示（验收整改） */
  autoStartEnabled: boolean
  searchInputRef: RefObject<HTMLInputElement | null>
  /** 自启 icon 的 DOM 引用（自启面板定位用） */
  autoStartBtnRef: RefObject<HTMLButtonElement | null>
}

/** 顶部栏：常显搜索框（⌘F 提示）+ 自启 + 添加项目药丸 */
export function Toolbar({
  search,
  onSearch,
  onAdd,
  onOpenAutoStart,
  autoStartCount,
  autoStartEnabled,
  searchInputRef,
  autoStartBtnRef
}: Props): React.JSX.Element {
  return (
    <header className="toolbar">
      <div className="search-box">
        <Search size={15} className="search-icon" />
        <input
          ref={searchInputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          placeholder="搜索项目、标签、端口…"
        />
        <kbd className="search-kbd">⌘F</kbd>
      </div>

      <div className="toolbar-right">
        {autoStartEnabled && (
          <Tooltip text="自启项：打开软件自动启动">
            <button
              ref={autoStartBtnRef}
              data-tour="autostart"
              className="icon-btn"
              title="自启项"
              onClick={onOpenAutoStart}
            >
              <Zap size={16} />
              {autoStartCount > 0 && <span className="autostart-badge">{autoStartCount}</span>}
            </button>
          </Tooltip>
        )}

        <button className="add-pill" title="添加项目" onClick={onAdd} data-tour="add">
          <Plus size={15} />
          <span>添加项目</span>
        </button>
      </div>
    </header>
  )
}
