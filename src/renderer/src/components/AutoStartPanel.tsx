import { useState } from 'react'
import { X, Zap } from 'lucide-react'
import type { Project } from '../../../shared/types'

interface Props {
  /** 面板内（自启项）的项目，按 autoStartIds 顺序 */
  items: Project[]
  enabled: boolean
  onToggleEnabled(): void
  onRemove(id: string): void
  onDropId(id: string): void
  onClose(): void
}

/** 自启项气泡面板（PRD 3.5：浮在主界面上方的小面板，列表行拖入即加入） */
export function AutoStartPanel({
  items,
  enabled,
  onToggleEnabled,
  onRemove,
  onDropId,
  onClose
}: Props): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)

  // 2026-08-20 修复：不再全屏遮罩——遮罩会挡住列表，导致行拖不进面板（用户实测反馈）
  return (
    <div
      className={`autostart-panel ${dragOver ? 'autostart-panel-over' : ''}`}
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
        <label className="autostart-switch" title="总开关">
          <input type="checkbox" checked={enabled} onChange={onToggleEnabled} />
        </label>
        <button className="icon-btn" onClick={onClose} title="关闭">
          <X size={14} />
        </button>
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
