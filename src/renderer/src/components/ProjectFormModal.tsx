import { useState } from 'react'
import { X } from 'lucide-react'
import type { DetectSuccess, NewProjectInput, Project, ProjectType } from '../../../shared/types'

interface Props {
  /** create：拖拽识别后登记；edit：编辑已有项目；manual：「+」按钮手动添加 */
  mode: 'create' | 'edit' | 'manual'
  detect?: DetectSuccess
  project?: Project
  /** 已有标签：可直接点选 */
  existingTags: string[]
  onSubmit(input: NewProjectInput): void
  onCancel(): void
}

interface FormValues {
  name: string
  type: ProjectType
  path: string
  command: string
  port: string
  openBrowser: boolean
  note: string
  tags: string[]
}

function initialValues(mode: Props['mode'], detect?: DetectSuccess, project?: Project): FormValues {
  if (mode === 'edit' && project) {
    return {
      name: project.name,
      type: project.type,
      path: project.path,
      command: project.command ?? '',
      port: project.port?.toString() ?? '',
      openBrowser: project.openBrowser,
      note: project.note,
      tags: project.tags
    }
  }
  if (mode === 'create' && detect) {
    return {
      name: detect.suggested.name,
      type: detect.type,
      path: detect.path,
      command: detect.suggested.command ?? '',
      port: detect.suggested.port?.toString() ?? '',
      openBrowser: false,
      note: '',
      tags: []
    }
  }
  return {
    name: '',
    type: 'service',
    path: '',
    command: '',
    port: '',
    openBrowser: false,
    note: '',
    tags: []
  }
}

const TITLES: Record<Props['mode'], string> = {
  create: '登记项目',
  edit: '编辑项目',
  manual: '添加项目'
}

const SUBMIT_TEXT: Record<Props['mode'], string> = {
  create: '添加',
  edit: '保存',
  manual: '添加'
}

/** 项目表单：登记/编辑/手动三种模式（PRD 3.2 确认表单 + 3.3 右键编辑） */
export function ProjectFormModal({
  mode,
  detect,
  project,
  existingTags,
  onSubmit,
  onCancel
}: Props): React.JSX.Element {
  const init = initialValues(mode, detect, project)
  const [name, setName] = useState(init.name)
  const [type, setType] = useState<ProjectType>(init.type)
  const [path, setPath] = useState(init.path)
  const [command, setCommand] = useState(init.command)
  const [port, setPort] = useState(init.port)
  // PRD 3.2：启动后开浏览器默认关（两种类型都是）
  const [openBrowser, setOpenBrowser] = useState(init.openBrowser)
  const [note, setNote] = useState(init.note)
  const [selectedTags, setSelectedTags] = useState<string[]>(init.tags)
  const [tagInput, setTagInput] = useState('')

  const toggleTag = (tag: string): void => {
    setSelectedTags((ts) => (ts.includes(tag) ? ts.filter((t) => t !== tag) : [...ts, tag]))
  }

  const commandMissing = type === 'service' && !command.trim()
  const pathMissing = !path.trim()

  const submit = (): void => {
    const portNum = Number(port.trim())
    onSubmit({
      name: name.trim() || init.name,
      type,
      path: path.trim(),
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
        .map((t) => t.slice(0, 6)) // 标签最多 6 个字（2026-08-20 拍板：卡片折角放不下更长）
        .filter((t, i, arr) => arr.indexOf(t) === i)
    })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal modal-form">
        <div className="modal-header">
          <h2>{TITLES[mode]}</h2>
          <button className="icon-btn" onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="form-body">
          <label>
            <span>类型</span>
            <select value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
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
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="项目文件夹或 html 文件的路径"
            />
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
                placeholder={
                  existingTags.length
                    ? '或输入新标签（最多6字），逗号分隔'
                    : '输入标签（最多6字），逗号分隔'
                }
              />
            </div>
          </div>
        </div>

        <div className="modal-actions">
          {commandMissing && <span className="form-error">本地服务需要填启动命令</span>}
          {!commandMissing && pathMissing && <span className="form-error">需要填路径</span>}
          <button className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={submit} disabled={commandMissing || pathMissing}>
            {SUBMIT_TEXT[mode]}
          </button>
        </div>
      </div>
    </div>
  )
}
