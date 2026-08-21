import { Ban, X } from 'lucide-react'

interface Props {
  tag: string
  /** 8 色色板 */
  colors: string[]
  /** 当前染色（无=默认无色） */
  current?: string
  /** 选中颜色；传 null 表示清除染色 */
  onPick(color: string | null): void
  onCancel(): void
}

/** 标签染色弹窗（2026-08-21：侧栏标签右键菜单「染色…」；默认无色，颜色填进标签 icon） */
export function TagColorModal({
  tag,
  colors,
  current,
  onPick,
  onCancel
}: Props): React.JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>给「{tag}」染色</h2>
          <button className="icon-btn" onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="tag-color-grid">
          <button
            className={`tag-color-cell ${!current ? 'tag-color-cell-on' : ''}`}
            title="无颜色"
            onClick={() => {
              onPick(null)
              onCancel()
            }}
          >
            <Ban size={16} />
          </button>
          {colors.map((c) => (
            <button
              key={c}
              className={`tag-color-cell ${current === c ? 'tag-color-cell-on' : ''}`}
              title={c}
              style={{ background: c }}
              onClick={() => {
                onPick(c)
                onCancel()
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
