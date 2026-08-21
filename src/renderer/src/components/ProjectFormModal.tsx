import { useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { pinyin } from 'pinyin-pro'
import type { DetectSuccess, NewProjectInput, Project, ProjectType } from '../../../shared/types'

interface Props {
  /** create：拖拽识别后登记；edit：编辑已有项目；manual：「+」按钮手动添加 */
  mode: 'create' | 'edit' | 'manual'
  detect?: DetectSuccess
  project?: Project
  /** 已有标签：联想下拉的数据源 */
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

/** 标签上限（2026-08-20 拍板） */
const TAG_MAX = 6

/** 项目表单：登记/编辑/手动三种模式（PRD 3.2 确认表单 + 3.3 右键编辑）
 *  标签控件（2026-08-21 拍板）：空的输入框 → 点击展开联想下拉（拼音/英文/中文匹配已有标签，
 *  无匹配显示"作为新标签"候选）→ 只有提交时才真正创建新标签，输入过程中零持久化 */
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
  /** 标签文本：已选标签直接显示在输入框里，逗号分隔可直接编辑（2026-08-21 拍板） */
  const [tagText, setTagText] = useState(() => init.tags.join(', '))
  /** 联想下拉是否展开（点输入框展开；点外部/选完收起） */
  const [open, setOpen] = useState(false)

  // 已有标签的拼音缓存（全拼+首字母），打开表单时算一次
  const pyCache = useMemo(() => {
    const m = new Map<string, { full: string; initials: string }>()
    for (const t of existingTags) {
      m.set(t, {
        full: pinyin(t, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase(),
        initials: pinyin(t, { pattern: 'first', toneType: 'none' })
          .replace(/\s+/g, '')
          .toLowerCase()
      })
    }
    return m
  }, [existingTags])

  // 联想针对"正在输入的当前词"（最后一个逗号之后的部分）
  const parts = tagText.split(/[,，]/)
  const current = (parts[parts.length - 1] ?? '').trim()
  const q = current.toLowerCase()
  const matches = q
    ? existingTags.filter((t) => {
        if (t.toLowerCase().includes(q)) return true
        const py = pyCache.get(t)
        if (!py) return false
        return py.full.startsWith(q) || py.initials.startsWith(q)
      })
    : existingTags
  const showNewCandidate = q !== '' && !existingTags.includes(current)

  /** 点选已有标签：把当前词替换成完整标签，然后收起下拉 */
  const pickTag = (tag: string): void => {
    const before = parts
      .slice(0, -1)
      .map((p) => p.trim())
      .filter(Boolean)
    setTagText([...before, tag].join(', '))
    setOpen(false)
  }

  const commandMissing = type === 'service' && !command.trim()
  const pathMissing = !path.trim()

  const submit = (): void => {
    const portNum = Number(port.trim())
    // 新标签只在提交这一刻才真正创建（2026-08-21 拍板）：输入框文本就是最终标签列表
    onSubmit({
      name: name.trim() || init.name,
      type,
      path: path.trim(),
      command: type === 'service' ? command.trim() || undefined : undefined,
      port: port.trim() && !Number.isNaN(portNum) ? portNum : undefined,
      openBrowser,
      note: note.trim(),
      tags: [
        ...new Set(
          tagText
            .split(/[,，]/)
            .map((t) => t.trim())
            .filter(Boolean)
            .map((t) => t.slice(0, TAG_MAX))
        )
      ]
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
              <input
                value={tagText}
                onChange={(e) => {
                  setTagText(e.target.value)
                  setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onBlur={(e) => {
                  // 点下拉项时 input 不失焦（项上 preventDefault），这里只处理真失焦
                  if (!(e.relatedTarget as Element | null)?.closest?.('.tag-picker')) setOpen(false)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  // 有联想选第一个（替换当前词），没有就把当前词留在文本里（提交时才成为新标签）
                  if (matches.length > 0) pickTag(matches[0])
                  else setOpen(false)
                }}
                placeholder="输入标签，用逗号分隔（最多6字）"
              />

              {open && (
                <div className="tag-dropdown">
                  {matches.length > 0 ? (
                    <div className="tag-dropdown-list">
                      {matches.map((t) => (
                        <button
                          key={t}
                          type="button"
                          className="tag-dropdown-item"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            pickTag(t)
                          }}
                        >
                          <span>{t}</span>
                          {parts.map((p) => p.trim()).includes(t) && (
                            <Check size={12} className="tag-check" />
                          )}
                        </button>
                      ))}
                    </div>
                  ) : q === '' ? (
                    <div className="tag-dropdown-empty">还没有标签，输入一个就能新建</div>
                  ) : null}
                  {showNewCandidate && (
                    <div className="tag-dropdown-new">
                      <button
                        type="button"
                        className="tag-dropdown-new-item"
                        onMouseDown={(e) => {
                          // 新词已在输入框文本里，点一下=确认收进列表，收起下拉；提交时才真正创建
                          e.preventDefault()
                          setOpen(false)
                        }}
                      >
                        <Plus size={12} />
                        作为新标签「{current.slice(0, TAG_MAX)}」
                      </button>
                    </div>
                  )}
                </div>
              )}
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
