import { useState } from 'react'
import { X, Zap } from 'lucide-react'
import type { Project } from '../../../shared/types'

interface Props {
  /** 面板内（自启项）的项目，按 autoStartIds 顺序 */
  items: Project[]
  onRemove(id: string): void
  onDropId(id: string): void
  /** 面板定位（App 按闪电 icon 位置计算） */
  style?: React.CSSProperties
}

/**
 * 自启项气泡面板（2026-08-20 拍板简化版）：
 * - 闪电 icon 下方弹出（定位由 App 传入 style）
 * - 面板内只有项目列表+移出（总开关只在设置里，无 ✕）
 * - 关闭：再点 icon / Esc / 点面板外（拖拽期间天然不触发关闭）
 */
export function AutoStartPanel({ items, onRemove, onDropId, style }: Props): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={`autostart-panel ${dragOver ? 'autostart-panel-over' : ''}`}
      style={style}
      onDragOver={(e) => {
        // 只接收行拖拽（带 reopen-id），不接收文件
        if (!e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const id = e.dataTransfer.getData('application/x-reopen-id')
        if (id) onDropId(id)
      }}
    >
      <div className="autostart-head">
        <Zap size={14} />
        <span className="autostart-title">自启项</span>
      </div>

      <div className="autostart-hint">打开软件后，自动启动你放进来的产品</div>

      <div className="autostart-list">
        {items.length === 0 ? (
          <div className="autostart-empty">把项目列表里的行拖到这里</div>
        ) : (
          items.map((p) => (
            <div key={p.id} className="autostart-item">
              <Zap size={12} className="autostart-item-icon" />
              <span className="autostart-item-name">{p.name}</span>
              <button className="icon-btn" title="移出自启项" onClick={() => onRemove(p.id)}>
                <X size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
