import { AlertTriangle, X } from 'lucide-react'
import { useState } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  /** 同名同类型的分组（组内已按登记时间从早到晚排） */
  groups: { key: string; items: Project[] }[]
  /** 全部项目（用来查每一条是不是在某个文件夹里） */
  projects: Project[]
  /** 删除勾选的 id */
  onDelete(ids: string[]): void
  onClose(): void
}

/** 通用文件名：这些名字撞车太正常（两个完全无关的项目都可能叫 index.html），默认不勾选 */
const GENERIC_NAMES = new Set([
  'index.html',
  'index.htm',
  'index.php',
  'index.js',
  'index.ts',
  'index.tsx',
  'app',
  'site',
  'dist',
  'build'
])

/** 检查重复弹窗：按「文件夹名/文件名相同 + 类型相同」找出可能是同一份东西的项目，
 *  默认勾选每组里除最早一条以外的所有条目（保留最早登记的那份），用户可以自己改。
 *  通用文件名那一组默认全不勾——撞名太正常，得你自己判断。 */
export function DuplicateFinderModal({
  groups,
  projects,
  onDelete,
  onClose
}: Props): React.JSX.Element {
  const [checked, setChecked] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const g of groups) {
      const base = (g.items[0].path.split('/').pop() ?? '').toLowerCase()
      if (GENERIC_NAMES.has(base)) continue
      g.items.slice(1).forEach((p) => initial.add(p.id))
    }
    return initial
  })

  const toggle = (id: string): void => {
    setChecked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const folderOf = (p: Project): string =>
    p.parentId ? (projects.find((x) => x.id === p.parentId)?.name ?? '文件夹里') : '顶层'

  return (
    <div className="modal-backdrop">
      <div className="modal modal-multi dup-modal">
        <div className="modal-header">
          <h2>发现 {groups.length} 组可能重复的项目</h2>
          <button className="icon-btn" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <p className="multi-hint">
          判断依据：文件名或文件夹名相同、类型也相同（不比较内容）。默认勾选每组里较晚登记的那些，
          保留最早的一份——你可以自己改。
        </p>

        <div className="dup-list">
          {groups.map((g) => (
            <div className="dup-group" key={g.key}>
              <div className="dup-group-head">
                <AlertTriangle size={12} />
                {g.items[0].type === 'web' ? '网页' : '服务'} ·{' '}
                {g.items[0].path.split('/').pop()}
                {GENERIC_NAMES.has((g.items[0].path.split('/').pop() ?? '').toLowerCase()) && (
                  <span className="dup-generic">通用文件名，请自行判断</span>
                )}
              </div>
              {g.items.map((p, i) => (
                <label className={`dup-item ${checked.has(p.id) ? 'dup-item-checked' : ''}`} key={p.id}>
                  <input
                    type="checkbox"
                    checked={checked.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <span className="dup-body">
                    <span className="dup-name">
                      {p.name}
                      {i === 0 && <span className="dup-oldest">最早登记</span>}
                    </span>
                    <span className="dup-path">{p.path}</span>
                    <span className="dup-meta">
                      {new Date(p.createdAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                      {' · '}
                      {folderOf(p)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>
            关闭
          </button>
          <button
            className="btn-danger"
            disabled={checked.size === 0}
            onClick={() => onDelete([...checked])}
          >
            删除选中 {checked.size} 个
          </button>
        </div>
      </div>
    </div>
  )
}
