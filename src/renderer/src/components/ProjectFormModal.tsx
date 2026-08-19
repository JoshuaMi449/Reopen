import { useState } from 'react'
import { X } from 'lucide-react'
import type { DetectSuccess, NewProjectInput, ProjectType } from '../../../shared/types'

interface Props {
  detect: DetectSuccess
  onSubmit(input: NewProjectInput): void
  onCancel(): void
}

/** 确认表单：全自动猜预填，只需确认或修改（PRD 3.2） */
export function ProjectFormModal({ detect, onSubmit, onCancel }: Props): React.JSX.Element {
  const [name, setName] = useState(detect.suggested.name)
  const [type, setType] = useState<ProjectType>(detect.type)
  const [path, setPath] = useState(detect.path)
  const [command, setCommand] = useState(detect.suggested.command ?? '')
  const [port, setPort] = useState(detect.suggested.port?.toString() ?? '')
  // web 类型本身就是"起临时服务+浏览器打开"（PRD 3.1），预填开；service 默认关（PRD 3.2）
  const [openBrowser, setOpenBrowser] = useState(detect.type === 'web')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')

  const switchType = (t: ProjectType): void => {
    setType(t)
    setOpenBrowser(t === 'web')
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
      tags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
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
              <option value="web">网页文件（起临时服务+浏览器打开）</option>
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
            <>
              <label>
                <span>启动命令</span>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="如 npm run dev"
                />
              </label>
              <label>
                <span>端口</span>
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="如 5173"
                />
              </label>
            </>
          )}

          {type === 'web' && <div className="form-note">端口：自动分配一个空闲端口</div>}

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

          <label>
            <span>标签</span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="用逗号分隔，如：演示,临时"
            />
          </label>
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
