import type { ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  /** 自定义内容（渲染替代 label，点击不自动关菜单；2026-08-21 标签染色滑块用） */
  custom?: ReactNode
  onClick(): void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose(): void
}

/** 右键菜单（PRD 3.3：列表行/卡片右键；2026-08-21 起支持内嵌自定义控件） */
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  return (
    <>
      <div
        className="context-backdrop"
        onClick={(e) => {
          // 只响应左键：macOS 触控板右键手势收尾可能补一个 button=2 的 click，会误关刚弹出的菜单
          if (e.button === 0) onClose()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      {/* 菜单定位在光标右下方一点，让第一个菜单项正好在光标下方，弹出即可点（2026-08-21 修复） */}
      <div className="context-menu" style={{ left: x, top: y - 4 }}>
        {items.map((item) =>
          item.custom ? (
            <div key={item.label} className="context-custom">
              {item.icon}
              {item.custom}
            </div>
          ) : (
            <button
              key={item.label}
              className={`context-item ${item.danger ? 'context-item-danger' : ''}`}
              onClick={() => {
                item.onClick()
                onClose()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          )
        )}
      </div>
    </>
  )
}
