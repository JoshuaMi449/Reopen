import { useState } from 'react'
import { X } from 'lucide-react'
import type { DetectSuccess, NewProjectInput, ProjectType } from '../../../shared/types'

interface Props {
  detect: DetectSuccess
  /** 已有标签：可直接点选（用户要求：选之前已有的标签） */
  existingTags: string[]
  onSubmit(input: NewProjectInput): void
  onCancel(): void
}

/** 确认表单：全自动猜预填，只需确认或修改（PRD 3.2） */
export function ProjectFormModal({
  detect,
  existingTags,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const [name, setName] = useState(detect.suggested.name)
  const [type, setType] = useState<ProjectType>(detect.type)
  const [path, setPath] = useState(detect.path)
  const [command, setCommand] = useState(detect.suggested.command ?? '')
  const [port, setPort] = useState(detect.suggested.port?.toString() ?? '')
  // PRD 3.2：启动后开浏览器默认关（两种类型都是）
  const [openBrowser, setOpenBrowser] = useState(false)
  const [note, setNote] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  const switchType = (t: ProjectType): void => {
    setType(t)
  }

  const toggleTag = (tag: string): void => {
    setSelectedTags((ts) => (ts.includes(tag) ? ts.filter((t) => t !== tag) : [...ts, tag]))
  }

  const commandMissing = type === 'service' && !command.trim()

  const submit = (): void => {
    const portNum = Number(port.trim())
    onSubmit({
      name: name.trim() || detect.suggested.name,
      type,
      path,
      command: type === 'service' ? command.trim() || undefined : undefined,
      port: port.trim() && !Number.isNaN(portNum) ? portNum : undefined,
      openBrowser,
      note: note.trim(),
      tags: [
        ...selectedTags,
        ...tagInput
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean)
      ]
    })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-form">
        <div className="modal-header">
          <h2>登记项目</h2>
          <button className="icon-btn" onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="form-body">
          <label>
            <span>类型</span>
            <select value={type} onChange={(e) => switchType(e.target.value as ProjectType)}>
              <option value="service">本地服务（起命令）</option>
              <option value="web">网页文件（起临时服务）</option>
            </select>
          </label>

          <label>
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>

          <label>
            <span>路径</span>
            <input value={path} onChange={(e) => setPath(e.target.value)} />
          </label>

          {type === 'service' && (
            <label>
              <span>启动命令</span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="如 npm run dev"
              />
            </label>
          )}

          <label>
            <span>端口</span>
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={type === 'service' ? '如 5173（读不到就填项目的端口）' : '留空自动分配'}
            />
          </label>

          <label className="form-switch">
            <span>启动后打开浏览器</span>
            <input
              type="checkbox"
              checked={openBrowser}
              onChange={(e) => setOpenBrowser(e.target.checked)}
            />
          </label>

          <label>
            <span>备注</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填" />
          </label>

          <div className="form-tags">
            <span className="form-tags-label">标签</span>
            <div className="tag-picker">
              {existingTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`tag-chip ${selectedTags.includes(t) ? 'tag-chip-on' : ''}`}
                  onClick={() => toggleTag(t)}
                >
                  {t}
                </button>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder={existingTags.length ? '或输入新标签，逗号分隔' : '输入标签，逗号分隔'}
              />
            </div>
          </div>
        </div>

        <div className="modal-actions">
          {commandMissing && <span className="form-error">本地服务需要填启动命令</span>}
          <button className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={commandMissing}>
            添加
          </button>
        </div>
      </div>
    </div>
  )
}
