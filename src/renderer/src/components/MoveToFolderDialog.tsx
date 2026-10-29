import { Folder } from 'lucide-react'

interface Props {
  /** 要移入的项目数（标题用） */
  count: number
  /** 可选的文件夹（顶层项目组） */
  folders: { id: string; name: string; childCount: number }[]
  onMove(folderId: string): void
  /** 没有合适的现成文件夹 → 新建一个并放进去（复用「添加成组」流程） */
  onNew(): void
  onCancel(): void
}

/** 把选中的项目放进已有文件夹（单项目/批量右键「移入文件夹…」） */
export function MoveToFolderDialog({
  count,
  folders,
  onMove,
  onNew,
  onCancel
}: Props): React.JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <h2>把 {count} 个项目放进文件夹</h2>
        <p className="confirm-message">选一个文件夹：</p>
        <div className="move-folder-list">
          {folders.length === 0 && <div className="move-folder-empty">还没有文件夹</div>}
          {folders.map((f) => (
            <button key={f.id} className="move-folder-item" onClick={() => onMove(f.id)}>
              <Folder size={15} />
              <span className="move-folder-name">{f.name}</span>
              <span className="move-folder-count">{f.childCount} 个子项</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={onNew}>
            新建文件夹并放入
          </button>
        </div>
      </div>
    </div>
  )
}
