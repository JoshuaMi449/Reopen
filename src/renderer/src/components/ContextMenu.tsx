import type { ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  onClick(): void
}

interface Props {
  x: number
  y: number
  items: MenuItem[]
  onClose(): void
}

/** 右键菜单（PRD 3.3：列表行/卡片右键） */
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  return (
    <>
      <div
        className="context-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div className="context-menu" style={{ left: x, top: y }}>
        {items.map((item) => (
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
        ))}
      </div>
    </>
  )
}
