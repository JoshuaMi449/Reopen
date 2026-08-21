import { Check, FileCode2, Folder, X } from 'lucide-react'
import type { DetectMulti, DetectSuccess, Project } from '../../../shared/types'

interface Props {
  multi: DetectMulti
  /** 全部项目：候选路径已登记则行首打勾、整行不可再点 */
  projects: Project[]
  /** 点选一个候选：App 打开确认表单（预填） */
  onPick(detect: DetectSuccess): void
  /** 全部登记完（或不再登记）点「完成」收工 */
  onDone(): void
}

/** 多项目容器候选清单（2026-08-21 S2，逐个确认式拍板）：
 *  点一个候选 → 确认表单预填 → 提交 → 回到清单该行打勾，可继续登记下一个；点「完成」收工 */
export function MultiProjectModal({ multi, projects, onPick, onDone }: Props): React.JSX.Element {
  const registered = new Set(projects.map((p) => p.path))
  return (
    <div className="modal-backdrop">
      <div className="modal modal-multi">
        <div className="modal-header">
          <h2>发现 {multi.projects.length} 个项目</h2>
          <button className="icon-btn" onClick={onDone} title="完成">
            <X size={16} />
          </button>
        </div>
        <p className="multi-hint">
          这个文件夹里装了好几个独立项目，点选一个进行登记，可连续登记多个
        </p>
        <div className="multi-list">
          {multi.projects.map((p) => {
            const done = registered.has(p.path)
            return (
              <button
                key={p.path}
                type="button"
                className={`multi-item ${done ? 'multi-item-done' : ''}`}
                disabled={done}
                onClick={() => onPick(p)}
              >
                {done ? (
                  <Check size={14} className="multi-check" />
                ) : (
                  <span className="row-icon">
                    {p.type === 'service' ? <Folder size={15} /> : <FileCode2 size={15} />}
                  </span>
                )}
                <span className="multi-name">{p.suggested.name}</span>
                <span className="multi-summary">
                  {p.type === 'service'
                    ? [p.suggested.command, p.suggested.port ? `:${p.suggested.port}` : '']
                        .filter(Boolean)
                        .join(' · ')
                    : '静态网页'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="modal-actions">
          <button className="btn-primary" onClick={onDone}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
