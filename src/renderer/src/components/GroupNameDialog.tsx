import { useState } from 'react'

interface Props {
  /** 要收纳进组的项目数（提示用） */
  count: number
  onConfirm(name: string): void
  onCancel(): void
}

/** 框选成组：先起组名（默认「新建项目组」，聚焦时全选方便直接覆盖）——
 *  否则每个组都叫「新建项目组」（用户反馈） */
export function GroupNameDialog({ count, onConfirm, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState('新建项目组')

  return (
    <div className="modal-backdrop">
      <div className="modal modal-confirm">
        <h2>收纳成一个组</h2>
        <p className="confirm-message">把选中的 {count} 个项目收纳成一个组，先给它起个名字：</p>
        <label className="group-name-row">
          <span>组名</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={() => onConfirm(name.trim() || '新建项目组')}>
            成组
          </button>
        </div>
      </div>
    </div>
  )
}
