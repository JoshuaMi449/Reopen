import { useState } from 'react'
import { Layers, X, Zap } from 'lucide-react'
import type { Project } from '../../../shared/types'

interface Props {
  /** 面板内（自启项）的项目，按 autoStartIds 顺序 */
  items: Project[]
  onRemove(id: string): void
  onDropId(id: string): void
}

/**
 * 自启项面板（2026-08-21 拍板：占一列宽度的嵌入式列卡片）：
 * - .app-body 内与中间栏、日志抽屉平级，固定 224 宽，挤入时项目自动让一列
 * - 外层做宽度滑入动画，内层固定 220 不重排（仿抽屉两层结构）
 * - 面板内只有项目 chips+移出（总开关只在设置里，无 ✕）
 * - 关闭：再点 icon / Esc / 点面板外（拖拽期间天然不触发关闭）
 */
export function AutoStartPanel({ items, onRemove, onDropId }: Props): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={`autostart-panel ${dragOver ? 'autostart-panel-over' : ''}`}
      onDragOver={(e) => {
        // 只接收项目拖拽（带 reopen-id），不接收文件
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
      <div className="autostart-panel-inner">
        <div className="autostart-head">
          <Zap size={14} />
          <span className="autostart-title">自启项</span>
        </div>

        <div className="autostart-hint">打开软件后，自动启动你放进来的产品</div>

        <div className="autostart-list">
          {items.length === 0 ? (
            <div className="autostart-empty">把列表行或卡片拖到这里</div>
          ) : (
            items.map((p) => (
              <div key={p.id} className="autostart-item">
                {p.type === 'group' ? (
                  <Layers
                    size={12}
                    className="autostart-item-icon"
                    // 组：开机只拉成品子项（2026-08-21 拍板）
                  />
                ) : (
                  <Zap size={12} className="autostart-item-icon" />
                )}
                <span
                  className="autostart-item-name"
                  title={p.type === 'group' ? '开机只拉组内成品网站' : undefined}
                >
                  {p.name}
                </span>
                <button className="icon-btn" title="移出自启项" onClick={() => onRemove(p.id)}>
                  <X size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
