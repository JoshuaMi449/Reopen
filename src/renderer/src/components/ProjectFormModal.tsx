import { useEffect, useMemo, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { pinyin } from 'pinyin-pro'
import type {
  DetectSuccess,
  LaunchMode,
  NewProjectInput,
  PortSource,
  Project,
  ProjectType
} from '../../../shared/types'

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
  /** 识别出的网页入口路径（表单不展示，提交时静默保留，S3） */
  entryPath?: string
  /** 全部网页入口清单（弹窗展示+提交静默保留） */
  entryPaths?: string[]
  /** 全部启动方式与默认方式（表单不编辑，静默保留） */
  launchModes?: LaunchMode[]
  activeMode?: string
  /** 端口来源（改端口时直接改写项目源文件；提交后由 App 调用 rewrite） */
  portSource?: PortSource
  /** 统一入口路由名（识别生成，表单不编辑，静默带进档案） */
  lanSlug?: string
  /** JS 根路径扫描结果（识别生成，静默带进档案） */
  lanSuspicious?: boolean
}

/** 规格摘要行（用户拖入登记时就标明里面有什么，大白话事实陈述，不出现「启动方式」这个词） */
function modeSummary(m: LaunchMode): string {
  switch (m.id) {
    case 'preview':
      return m.entryPath
        ? '网页文件——登记后立刻在线，无需启动'
        : '成品网页——登记后立刻在线，浏览器直接打开'
    case 'dev':
      return `需要激活：${m.command ?? '开发依赖'}`
    case 'python-dev':
      return '需要激活：python 程序'
    case 'python-static':
      return '可用 python 打开成品'
    case 'docker':
      return '支持 Docker 启动'
    case 'bun':
      return '需要激活：bun/deno 服务'
    case 'launch':
      return '需要激活：启动脚本'
    default:
      return m.label
  }
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
      tags: project.tags,
      entryPath: project.entryPath,
      entryPaths: project.entryPaths,
      launchModes: project.launchModes,
      activeMode: project.activeMode,
      portSource: project.portSource,
      lanSlug: project.lanSlug,
      lanSuspicious: project.lanSuspicious
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
      tags: [],
      entryPath: detect.suggested.entryPath,
      entryPaths: detect.suggested.entryPaths,
      launchModes: detect.suggested.launchModes,
      activeMode: detect.suggested.activeMode,
      portSource: detect.suggested.portSource,
      lanSlug: detect.suggested.lanSlug,
      lanSuspicious: detect.suggested.lanSuspicious
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

/** 标签上限（ */
const TAG_MAX = 6

/** 项目表单：登记/编辑/手动三种模式（PRD 3.2 确认表单 + 3.3 右键编辑）
 *  标签控件（空的输入框 → 点击展开联想下拉（拼音/英文/中文匹配已有标签，
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
  /** 标签文本：已选标签直接显示在输入框里，逗号分隔可直接编辑（ */
  const [tagText, setTagText] = useState(() => init.tags.join(', '))
  /** 端口冲突（输入时实时查重：档案撞车=project / 本机被监听=system） */
  const [portConflict, setPortConflict] = useState<
    { kind: 'project'; name: string } | { kind: 'system' } | null
  >(null)
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

  // 端口输入实时查重（防抖 400ms，全部异步更新避免 lint set-state-in-effect）：
  // 先查 Reopen 里其他项目登记的端口（编辑自己时排除自身），再探测本机有没有程序在监听
  useEffect(() => {
    const num = Number(port.trim())
    const t = setTimeout(() => {
      if (!port.trim() || Number.isNaN(num)) {
        setPortConflict(null)
        return
      }
      void window.api.checkPortInUse(num, mode === 'edit' ? project?.id : undefined).then((r) => {
        if (!r.inUse) setPortConflict(null)
        else if (r.byProject) setPortConflict({ kind: 'project', name: r.byProject })
        else setPortConflict({ kind: 'system' })
      })
    }, 400)
    return () => clearTimeout(t)
  }, [port, mode, project?.id])

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
    const finalPort = port.trim() && !Number.isNaN(portNum) ? portNum : undefined
    // 改了端口 → 同步进默认启动方式（启动时实际读 mode.port；破案"拖入时设置别的端口没反应"）
    const launchModes = init.launchModes
      ? init.launchModes.map((m) =>
          m.id === init.activeMode && finalPort !== undefined && m.port !== finalPort
            ? { ...m, port: finalPort }
            : m
        )
      : init.launchModes
    // 新标签只在提交这一刻才真正创建（输入框文本就是最终标签列表
    onSubmit({
      name: name.trim() || init.name,
      type,
      path: path.trim(),
      command: type === 'service' ? command.trim() || undefined : undefined,
      port: finalPort,
      // 网页类型才保留识别出的入口路径；改成服务类型就丢弃
      entryPath: type === 'web' ? init.entryPath : undefined,
      entryPaths: type === 'web' ? init.entryPaths : undefined,
      // 启动方式清单静默保留（方式在详情抽屉切换，表单不编辑）
      launchModes,
      activeMode: init.activeMode,
      portSource: init.portSource,
      // 统一入口：路由名与 JS 扫描结果由识别生成，表单不编辑，原样带进档案
      lanSlug: init.lanSlug,
      lanSuspicious: init.lanSuspicious,
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
          <h2>{mode === 'edit' && type === 'group' ? '编辑项目组' : TITLES[mode]}</h2>
          <button className="icon-btn" onClick={onCancel} title="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="form-body">
          {/* 组（项目组）：只编辑名称/备注/标签，类型与路径不可改 */}
          {type !== 'group' && (
            <label>
              <span>类型</span>
              <select value={type} onChange={(e) => setType(e.target.value as ProjectType)}>
                <option value="service">本地服务（起命令）</option>
                <option value="web">网页文件（起临时服务）</option>
              </select>
            </label>
          )}

          <label>
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>

          {/* 辨认小字（用户拖进来的项目名称下都有小字——
              网页类显示读到的 <title>（英文文件名也能认出是哪个网站）；
              开发类没有标题，显示文件夹完整路径；标题与名称重复就不显示） */}
          {mode === 'create' &&
            detect &&
            (detect.suggested.title && detect.suggested.title !== name ? (
              <div className="form-title-hint" title={detect.suggested.title}>
                网站标题：{detect.suggested.title}
              </div>
            ) : (
              <div className="form-title-hint" title={detect.path}>
                位置：{detect.path}
              </div>
            ))}

          {type !== 'group' && (
            <label>
              <span>路径</span>
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="项目文件夹或 html 文件的路径"
              />
            </label>
          )}

          {/* 规格摘要区（用户拖入时就标明里面有什么；只读事实陈述） */}
          {type !== 'group' && (init.launchModes?.length ?? 0) > 0 && (
            <div className="form-modes">
              <span>发现</span>
              <div className="form-modes-list">
                {init.launchModes?.map((m) => (
                  <div key={m.id} className="form-mode-line">
                    {modeSummary(m)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 入口文件清单（用户多页面项目登记时就能看到里面有哪些页面，登记后都能打开） */}
          {type === 'web' && (init.entryPaths?.length ?? 0) > 1 && (
            <div className="form-modes">
              <span>里面有 {init.entryPaths?.length} 个页面，登记后都能打开</span>
              <div className="form-modes-list">
                {init.entryPaths?.map((ep, i) => (
                  <div key={ep} className="form-mode-line form-entry-line">
                    <span className="form-entry-name" title={ep}>
                      {ep}
                    </span>
                    {i === 0 && <span className="form-entry-main">主页</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

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

          {type !== 'group' && (
            <label>
              <span>端口</span>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={portConflict ? 'port-conflict' : ''}
                placeholder={
                  type === 'service' ? '如 5173（读不到就填项目的端口）' : '留空自动分配'
                }
              />
              {portConflict && (
                <span className="form-hint port-conflict-hint">
                  {portConflict.kind === 'project'
                    ? `「${portConflict.name}」也登记了这个端口，启动时会撞车`
                    : '电脑上有程序正在使用这个端口'}
                </span>
              )}
              {init.portSource && (
                <span className="form-hint">修改后会直接替换项目源代码里写死的端口</span>
              )}
            </label>
          )}

          {type !== 'group' && (
            <label className="form-switch">
              <span>启动后打开浏览器</span>
              <input
                type="checkbox"
                checked={openBrowser}
                onChange={(e) => setOpenBrowser(e.target.checked)}
              />
            </label>
          )}

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
