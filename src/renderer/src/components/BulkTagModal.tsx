import { useState } from 'react'

/**
 * 批量加标签弹窗（框选多个项目 → 右键 → 标签）。
 * 规则：已有目标标签的项目跳过；无标签的直接加；
 * 在别的标签里的 → 提示窗口：跳过（保留原标签）还是转移到新标签（原标签换成新标签）。
 */
export function BulkTagModal({
  count,
  existingTags,
  onCheck,
  onApply,
  onCancel
}: {
  /** 选中的项目数 */
  count: number
  /** 已有标签（点击快速填入） */
  existingTags: string[]
  /** 提交前让父组件算冲突数（不应用；返回在别的标签里的项目数） */
  onCheck(tag: string): Promise<number>
  /** 最终应用：conflictMode=skip 保留原标签 / move 原标签换成新标签 */
  onApply(tag: string, conflictMode: 'skip' | 'move'): Promise<void>
  onCancel(): void
}): React.JSX.Element {
  const [tag, setTag] = useState('')
  const [step, setStep] = useState<'pick' | 'conflict'>('pick')
  const [conflict, setConflict] = useState(0)
  const [busy, setBusy] = useState(false)

  const trimmed = tag.trim().slice(0, 6)

  const submit = async (): Promise<void> => {
    if (!trimmed || busy) return
    setBusy(true)
    const n = await onCheck(trimmed)
    setBusy(false)
    if (n > 0) {
      setConflict(n)
      setStep('conflict')
    } else {
      await onApply(trimmed, 'skip')
    }
  }

  return (
    <div className="modal-backdrop">
      {step === 'pick' ? (
        <div className="modal">
          <h2>给 {count} 个项目加标签</h2>
          <p className="bulk-tag-desc">
            已经在这个标签里的项目会自动跳过；在别的标签里的会单独问你。
          </p>
          <input
            className="text-input bulk-tag-input"
            value={tag}
            placeholder="输入标签名（最多 6 个字）"
            autoFocus
            maxLength={6}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          {existingTags.length > 0 && (
            <div className="bulk-tag-chips">
              {existingTags.map((t) => (
                <button key={t} className="bulk-tag-chip" onClick={() => setTag(t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onCancel}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={!trimmed || busy}
              onClick={() => void submit()}
            >
              加标签
            </button>
          </div>
        </div>
      ) : (
        <div className="modal">
          <h2>这些项目已经在别的标签里</h2>
          <p>
            {conflict}{' '}
            个项目有别的标签。「跳过」=保留原标签、不加新标签；「转移」=把它们的原标签换成「
            {trimmed}」。
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={onCancel}>
              取消
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => void onApply(trimmed, 'skip')}
            >
              跳过
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() => void onApply(trimmed, 'move')}
            >
              转移
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
