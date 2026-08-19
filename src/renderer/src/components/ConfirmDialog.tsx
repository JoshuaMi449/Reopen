interface Props {
  title: string
  message: string
  confirmText: string
  onConfirm(): void
  onCancel(): void
}

/** 通用确认弹窗（PRD 3.3：删除前确认，文案强调不删原文件） */
export function ConfirmDialog({
  title,
  message,
  confirmText,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  return (
    <div className="modal-backdrop">
      <div className="modal modal-confirm">
        <h2>{title}</h2>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn-danger" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
