import { useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  initial: string
  onConfirm(name: string): void
  onCancel(): void
}

/** 标签重命名弹窗（2026-08-21：侧栏标签右键菜单「重命名…」） */
export function TagRenameDialog({ initial, onConfirm, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState(initial)

  const submit = (): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-confirm">
        <div className="modal-header">
          <h2>重命名标签</h2>
          <button className="icon-btn" onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>
        <input
          className="rename-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          autoFocus
          placeholder="标签名（最多6字）"
        />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={!name.trim()}>
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
