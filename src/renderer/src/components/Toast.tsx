export interface ToastData {
  id: string
  message: string
  kind: 'info' | 'success' | 'error'
}

/** 右上角通知（PRD 3.4：启动失败带原因的通知） */
export function Toast({ toasts }: { toasts: ToastData[] }): React.JSX.Element {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
