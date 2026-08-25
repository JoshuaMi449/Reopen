import { useMemo, useState } from 'react'
import { CheckSquare, FileCode2, Folder, Square, X } from 'lucide-react'
import type { DetectMulti, DetectSuccess } from '../../../shared/types'

interface Props {
  multi: DetectMulti
  /** 确认成组：组名 + 勾选的子项（按清单顺序） */
  onConfirm(name: string, selected: DetectSuccess[]): void
  onCancel(): void
}

/** 多项目容器 → 项目组预览（组预览勾选式）：
 *  拖入的文件夹里有多个项目 → 弹组名输入+候选勾选 → 确认登记成一个组
 *  二轮候选行显示网站标题；默认只勾「最大的成品」（fileCount 最多），多个成品不再全勾 */
export function GroupPreviewModal({ multi, onConfirm, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState(multi.path.split('/').pop() || '项目组')
  // 勾选状态：候选 path 的集合。默认只勾「最大的成品」（含成品预览方式且非单页附件、fileCount 最多的那个）；
  // 散装 html（单页附件）与纯开发项目默认不勾，要的再手动勾（实测：用户只要官网首页端口）
  const [checked, setChecked] = useState<Set<string>>(() => {
    const finished = multi.projects.filter((p) =>
      p.suggested.launchModes.some((m) => m.kind === 'preview' && !m.entryPath)
    )
    if (finished.length === 0) return new Set()
    const max = Math.max(...finished.map((p) => p.suggested.fileCount ?? 0))
    return new Set(finished.filter((p) => (p.suggested.fileCount ?? 0) === max).map((p) => p.path))
  })
  // 成品（web 类型）排最前，开发项目在后
  const sorted = useMemo(
    () =>
      [...multi.projects].sort((a, b) => {
        if (a.type === b.type) return 0
        return a.type === 'web' ? -1 : 1
      }),
    [multi.projects]
  )

  const toggle = (path: string): void => {
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selected = sorted.filter((p) => checked.has(p.path))
  const allChecked = checked.size === sorted.length

  return (
    <div className="modal-backdrop">
      <div className="modal modal-multi">
        <div className="modal-header">
          <h2>发现一个项目组</h2>
          <button className="icon-btn" onClick={onCancel} title="取消">
            <X size={16} />
          </button>
        </div>
        <p className="multi-hint">这个文件夹里有多个项目，勾选想收纳的，登记后列表里是一个组</p>
        <label className="group-name-row">
          <span>组名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <div className="multi-list">
          {sorted.map((p) => {
            const on = checked.has(p.path)
            return (
              <button
                key={p.path}
                type="button"
                className={`multi-item ${on ? '' : 'multi-item-off'}`}
                onClick={() => toggle(p.path)}
              >
                {on ? (
                  <CheckSquare size={15} className="multi-check" />
                ) : (
                  <Square size={15} className="multi-check" />
                )}
                <span className="row-icon">
                  {p.type === 'service' ? <Folder size={15} /> : <FileCode2 size={15} />}
                </span>
                <span className="multi-name">{p.suggested.name}</span>
                <span className="multi-summary">
                  {p.type === 'service'
                    ? [p.suggested.command, p.suggested.port ? `:${p.suggested.port}` : '']
                        .filter(Boolean)
                        .join(' · ')
                    : (p.suggested.title ?? '成品网页')}
                </span>
              </button>
            )
          })}
        </div>
        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={() => setChecked(allChecked ? new Set() : new Set(sorted.map((p) => p.path)))}
          >
            {allChecked ? '全不选' : '全选'}
          </button>
          <span className="multi-count">已选 {selected.length} 个</span>
          <button
            className="btn-primary"
            disabled={selected.length === 0}
            onClick={() =>
              onConfirm(name.trim() || (multi.path.split('/').pop() ?? '项目组'), selected)
            }
          >
            登记成组
          </button>
        </div>
      </div>
    </div>
  )
}
