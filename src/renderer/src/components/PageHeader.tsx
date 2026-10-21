import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { Settings } from '../../../shared/types'

interface Props {
  title: string
  count: number
  sortMode: Settings['sortMode']
  onSort(m: Settings['sortMode']): void
}

const SORT_OPTIONS: { value: Settings['sortMode']; label: string }[] = [
  { value: 'none', label: '手动' },
  { value: 'name', label: '名称' },
  { value: 'recent', label: '最近打开' },
  { value: 'created', label: '添加日期' },
  { value: 'type', label: '种类' },
  { value: 'tag', label: '标签' }
]

/** 页头：大标题 + 数量 + 排序/视图药丸（参考界面里标题右侧的筛选器） */
export function PageHeader({ title, count, sortMode, onSort }: Props): React.JSX.Element {
  const [sortOpen, setSortOpen] = useState(false)
  const sortBtnRef = useRef<HTMLButtonElement>(null)
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortMode)?.label ?? '手动'

  useEffect(() => {
    if (!sortOpen) return
    const onDown = (e: MouseEvent): void => {
      if (
        sortBtnRef.current?.contains(e.target as Node) ||
        (e.target as Element).closest('.filter-menu')
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
    <div className="page-head">
      <div className="page-title-wrap">
        <h1 className="page-title">{title}</h1>
        <span className="page-chip">{count}</span>
      </div>

      <div className="page-filters">
        <div className="sort-wrap">
          <button
            ref={sortBtnRef}
            className={`filter-pill ${sortOpen ? 'filter-pill-on' : ''}`}
            onClick={() => setSortOpen((v) => !v)}
          >
            <span>排序 · {sortLabel}</span>
            <ChevronDown size={13} />
          </button>
          {sortOpen && (
            <div className="sort-menu filter-menu">
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
      </div>
    </div>
  )
}
