// 共享类型：主进程与渲染进程共用的数据定义（PRD 第三章功能需求的数据模型）

/** 项目类型：本地服务（起命令） / 网页文件（起临时服务+开浏览器） / 项目组（收纳子项） */
export type ProjectType = 'service' | 'web' | 'group'

/** 运行时状态：只存在主进程内存，不写进 JSON */
export type ProjectStatus = 'stopped' | 'starting' | 'running' | 'failed'

/** 项目（对应确认表单的字段） */
/** 启动方式类别（一个项目合并一条，条目内切换启动方式） */
export type LaunchModeKind = 'preview' | 'dev' | 'python-static' | 'docker'

/** 一个启动方式（同一项目的多种启动方式之一，如"成品预览"与"开发服务器"） */
export interface LaunchMode {
  /** 项目内唯一：preview / dev / python-dev / bun / launch / python-static / docker */
  id: string
  kind: LaunchModeKind
  /** 界面显示名（成品预览 / 开发服务器 / python http.server / Docker…） */
  label: string
  /** 启动命令（dev/python-static/docker 用） */
  command?: string
  /** 预计端口（dev/python-static 用） */
  port?: number
  /** 端口来源（表单改端口时直接改写源文件用） */
  portSource?: PortSource
  /** 网页入口文件相对路径（preview 单文件场景） */
  entryPath?: string
  /** preview 的静态根目录（pkg 项目的 dist；默认=项目路径） */
  staticRoot?: string
}

/** 启动方式类别 → 项目类型（preview=web，其余=service；图标与端口显示用） */
export function launchKindToType(kind: LaunchModeKind): ProjectType {
  return kind === 'preview' ? 'web' : 'service'
}

/** 纯网页项目：无需依赖激活、永远在线——界面不显示启动/停止按钮，只有「在浏览器打开」。
 *  判定：方式清单非空且全是成品预览；老数据（无 launchModes）按 type=web 兼容 */
export function isPureWeb(p: Pick<Project, 'type' | 'launchModes'>): boolean {
  const modes = p.launchModes
  if (modes && modes.length > 0) return modes.every((m) => m.kind === 'preview')
  return p.type === 'web'
}

/** 启动失败时的「看成品」兜底：项目有成品预览方式且当前跑的不是它 → 失败界面给「看成品」按钮 */
export function hasPreviewFallback(p: Pick<Project, 'launchModes' | 'activeMode'>): boolean {
  return (p.launchModes ?? []).some((m) => m.kind === 'preview') && p.activeMode !== 'preview'
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  path: string
  /** 仅 service：启动命令（如 npm run dev） */
  command?: string
  /** 端口：service 用于健康检查；web 自动分配 */
  port?: number
  /** 端口来源（改端口时直接改写项目源文件；无来源=框架默认决定，只能提示） */
  portSource?: PortSource
  /** 网页入口文件相对路径（如 /case-home.html；S3：启动打开该文件而非目录根） */
  entryPath?: string
  /** 全部网页入口清单（项目里多个页面都能打开；第一个=主入口；老数据无此字段用 entryPath 兼容） */
  entryPaths?: string[]
  /** 属于哪个项目组（组收纳子项，子项与独立项目同结构） */
  parentId?: string
  /** 全部启动方式（老数据无此字段=单方式，运行时按 type 兼容） */
  launchModes?: LaunchMode[]
  /** 当前选中的启动方式 id（默认第一个） */
  activeMode?: string
  /** 启动后打开默认浏览器，默认关 */
  openBrowser: boolean
  note: string
  tags: string[]
  createdAt: number
  /** 上次启动时间（毫秒时间戳） */
  lastStartedAt?: number
  /** 上次实际运行端口（web 自动分配/实际端口回写；重启 Reopen 后用它接管检测）*/
  lastPort?: number
}

/** 端口检测来源（表单改端口时直接改写项目源文件用）：
 *  file=相对项目根的文件路径；find=匹配到的原始片段；portAt/portLen=端口数字在片段里的位置。
 *  portLen=0 表示片段里没有数字（如 `vite --host --port`），改写时把新端口插到 portAt 处 */
export interface PortSource {
  file: string
  find: string
  portAt: number
  portLen: number
}

/** 新建项目的输入（确认表单提交，id/时间戳由主进程生成） */
export type NewProjectInput = Omit<Project, 'id' | 'createdAt' | 'lastStartedAt'>

/** 拖拽识别成功：类型已确定，带全自动猜的表单预填 */
export interface DetectSuccess {
  ok: true
  type: ProjectType
  /** 实际要登记的路径 */
  path: string
  suggested: {
    name: string
    command?: string
    port?: number
    /** 端口来源（改端口时直接改写源文件用） */
    portSource?: PortSource
    /** 网页入口文件相对路径（S3） */
    entryPath?: string
    /** 全部网页入口清单（多页面项目登记时展示+登记后都能打开；第一个=主入口） */
    entryPaths?: string[]
    /** 页面标题（读 index.html 的 <title>，弹窗里显示让用户一眼认出是哪个网站） */
    title?: string
    /** 成品文件数（弹窗默认勾选"最大的成品"用） */
    fileCount?: number
    /** 全部启动方式（一个项目合并一条，preview 排最前为默认） */
    launchModes: LaunchMode[]
    /** 默认启动方式 id（= launchModes[0].id） */
    activeMode: string
  }
}

/** 拖拽识别：文件夹里有多个独立项目（S2 多项目容器，UI 逐个确认登记） */
export interface DetectMulti {
  ok: true
  kind: 'multi'
  /** 拖入的文件夹路径 */
  path: string
  /** 候选项目（每个都带全自动猜的预填） */
  projects: DetectSuccess[]
}

/** 拖到 .app：第一版不支持，需询问用户是否解析（PRD 3.2 兜底流程） */
export interface DetectNeedParseApp {
  ok: false
  kind: 'unsupported-app'
  path: string
}

/** 拖拽识别失败：找不出任何可管理的东西 */
export interface DetectFailed {
  ok: false
  kind: 'no-match'
  reason: string
}

/** 拖拽识别：这个路径已经登记过了 */
export interface DetectDuplicate {
  ok: false
  kind: 'duplicate'
  /** 已登记项目的名称 */
  name: string
}

export type DetectOutcome =
  DetectSuccess | DetectMulti | DetectNeedParseApp | DetectFailed | DetectDuplicate

/** 失败后界面可提供的自动修复动作（小白一键装依赖；同目录残留进程一键终止重启） */
export interface ProjectFix {
  kind: 'npm-install' | 'kill-residue'
  /** 界面按钮文字（如"帮我装依赖"） */
  label: string
}

/** 项目状态变化事件（主进程推送 → 渲染层更新圆点/标红） */
export interface ProjectStatusEvent {
  id: string
  status: ProjectStatus
  /** 实际端口（web 自动分配后回传） */
  port?: number
  /** 失败原因（PRD 3.4：通知带失败原因） */
  reason?: string
  startedAt?: number
  /** 局域网探测用的本机 IP（探测那一刻的值，与 lanReachable 成对出现；显示地址以此为准，防换网后显示旧 IP） */
  lanIp?: string
  /** 局域网探测结果：true=同一 Wi-Fi 设备能访问；false=服务只绑了本机（如手动起服务没开门）；
   *  undefined=未探测（没开局域网访问） */
  lanReachable?: boolean
  /** 服务是否本应用自己拉起的（true=是 → 局域网打不开时只能提示改项目命令；false/缺省=接管的 → 可「由本应用托管」重启） */
  spawned?: boolean
  /** 失败时可自动修复的动作（有则界面显示按钮） */
  fix?: ProjectFix
}

/** 日志事件（主进程推送 → 行内面板实时显示） */
export interface ProjectLogEvent {
  id: string
  line: string
}

/** 启动的结果 */
export interface StartResult {
  ok: boolean
  reason?: string
}

/** 应用设置（settings.json；随 M3 各步扩展） */
export interface Settings {
  /** 手动排序的 id 顺序（访达式"手动拖拽"排序） */
  manualOrder: string[]
  /** 列表/卡片视图 */
  view: 'list' | 'card'
  /** 当前排序方式（名称/最近打开/添加日期/种类/标签/无） */
  sortMode: 'name' | 'recent' | 'created' | 'type' | 'tag' | 'none'
  /** 种类排序的类型顺序（group=项目组「文件夹」/service/web；设置里拖动调整） */
  typeOrder: string[]
  /** 标签顺序（侧栏拖动调整）：侧栏标签区块显示顺序 + 标签排序模式下分组先后 */
  tagOrder: string[]
  /** 组顺序（侧栏拖动调整）：侧栏组区块显示顺序 + 任何排序方式下组之间按此先后 */
  groupOrder: string[]
  /** 标签染色：标签 → 颜色（侧栏标签右键染色，默认无色，颜色填进标签 icon） */
  tagColors: Record<string, string>
  /** 自启项总开关（默认开，PRD 3.5；关=顶部图标不显示，验收整改） */
  autoStartEnabled: boolean
  /** 自启项内的项目 id */
  autoStartIds: string[]
  /** 主题风格（PRD 3.8） */
  theme: 'morandi' | 'ocean' | 'slate'
  /** 亮暗：跟随系统 / 浅 / 深 / 特殊风格 */
  darkMode: 'system' | 'light' | 'dark' | 'special'
  /** 特殊风格 id（darkMode=special 时生效；切回其他模式自动清空） */
  specialStyle: string
  /** 关闭窗口 = 最小化到托盘（默认开） */
  closeToTray: boolean
  /** 托盘图标：黑白模板（随系统深浅自动反转） / 自定义图片（彩色已删，老数据迁移为黑白） */
  trayIcon: 'mono' | 'custom'
  /** 自定义托盘图标的文件路径（trayIcon=custom 时生效） */
  trayIconPath?: string
  /** 菜单栏动图播放速度倍率（GIF 轮播用；0.5=半速 / 1=原速 / 1.5 / 2=双倍快） */
  trayIconSpeed: number
  /** 菜单栏图标大小（像素 14~22，默认 18；黑白/自定义统一生效） */
  trayIconSize: number
  /** 菜单栏（托盘）启用，默认开（PRD 3.7） */
  trayEnabled: boolean
  /** 全局唤起窗口的快捷键（默认 ⌥+R） */
  hotkey: string
  /** 项目快捷启动绑定：项目 id → 组合键 */
  quickLaunch: Record<string, string>
  /** 开机自启（Mac 登录项） */
  launchAtLogin: boolean
  /** 失败时发系统通知 */
  notifyOnFail: boolean
  /** Onboarding 是否已完成（仅首次显示） */
  onboarded: boolean
  /** 打开项目网页用的默认浏览器（app 名，如 Google Chrome；空=系统默认浏览器） */
  defaultBrowser?: string
  /** 允许同一 Wi-Fi 的设备访问跑的项目（默认关；开=服务绑 0.0.0.0+dev 注入 HOST） */
  lanAccess: boolean
  /** 退出 Reopen 后项目继续在本地运行（默认关：退出时一并停止） */
  keepProjectsOnQuit: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  manualOrder: [],
  view: 'card',
  sortMode: 'recent',
  typeOrder: ['group', 'service', 'web'],
  tagOrder: [],
  groupOrder: [],
  tagColors: {},
  autoStartEnabled: true,
  autoStartIds: [],
  theme: 'morandi',
  darkMode: 'system',
  specialStyle: '',
  closeToTray: true,
  trayIcon: 'mono',
  trayIconSpeed: 1,
  trayIconSize: 18,
  trayEnabled: true,
  hotkey: 'Alt+R',
  quickLaunch: {},
  launchAtLogin: false,
  notifyOnFail: false,
  onboarded: false,
  lanAccess: true,
  keepProjectsOnQuit: false
}

/** 环境一键安装事件（实时日志行 / 结束结果） */
export interface EnvInstallEvent {
  /** 哪个运行时（node/python/docker/bun） */
  key: string
  /** 有=一行实时日志 */
  line?: string
  /** 有=安装结束，ok=true 装成功 */
  ok?: boolean
  /** 结束且失败时的原因 */
  error?: string
}

/** 环境监测项（设置-关于组下方：检测电脑装了哪些运行时） */
export interface EnvCheckItem {
  key: string
  /** 显示名（Node.js / Python / Docker / Bun） */
  name: string
  /** 装没装 */
  ok: boolean
  /** 已装时的版本号 */
  version?: string
  /** 没装时的作用说明 */
  hint?: string
  /** 没装时的安装官网 */
  link?: string
  /** 没装时的一键安装命令（Mac 走 brew；空=只能去官网手动装） */
  installCommand?: string
}

/** 更新检查结果（发现新版本弹窗 ——git 更新内容+git 链接+按钮） */
export interface UpdateInfo {
  /** 有没有新版本 */
  hasUpdate: boolean
  /** 当前版本（如 0.1.0） */
  currentVersion: string
  /** 最新版本号（tag 去 v 前缀） */
  latestVersion?: string
  /** 更新内容（GitHub Release 正文，markdown） */
  body?: string
  /** 最新版发布页链接（弹窗「前往下载」与「官网下载页」用） */
  htmlUrl?: string
  /** 检查失败原因（hasUpdate=false 且 error 有值=网络错误等） */
  error?: string
}

/** 渲染层可用的全部 API（preload 通过 contextBridge 暴露为 window.api） */
export interface ReopenApi {
  /** 拖拽的 File 对象 → 磁盘路径（Electron 32+ 需 webUtils） */
  getPathForFile(file: File): string
  listProjects(): Promise<Project[]>
  detectPath(path: string): Promise<DetectOutcome>
  parseApp(path: string): Promise<DetectOutcome>
  /** 「+」按钮：打开访达选项目文件夹；allowFile=true 文件/文件夹都能选（取消返回 null） */
  pickProjectFolder(allowFile?: boolean): Promise<string | null>
  addProject(input: NewProjectInput): Promise<Project>
  updateProject(id: string, input: NewProjectInput): Promise<Project>
  deleteProject(id: string): Promise<void>
  /** 手动成组：把一批顶层项目收纳成一个新组，返回新组（框选右键添加成组） */
  createGroup(ids: string[], name?: string): Promise<Project>
  /** 解散组：子项回到顶层，组删除（ */
  ungroup(id: string): Promise<void>
  /** 改端口直接改写项目源文件（只动文件；成功返回更新后的来源片段，档案由调用方落新端口） */
  rewriteProjectPortFile(
    path: string,
    source: PortSource,
    port: number
  ): Promise<{ ok: boolean; reason?: string; source?: PortSource }>
  startProject(id: string, modeId?: string): Promise<StartResult>
  /** 端口查重：档案里其他项目登记的端口 + 本机 TCP 监听探测（表单输入时实时调用） */
  checkPortInUse(
    port: number,
    excludeId?: string
  ): Promise<{ inUse: boolean; byProject?: string; bySystem?: boolean }>
  /** 选择自定义菜单栏图标（返回复制后的文件路径；取消返回 null） */
  pickTrayIcon(): Promise<string | null>
  stopProject(id: string): Promise<void>
  /** 一键安装依赖：在项目目录跑 npm install，日志实时推项目日志面板（ */
  installProjectDeps(id: string): Promise<void>
  /** 终止同目录残留 dev 进程并重新启动（残留检测的「终止残留并启动」按钮） */
  killResidual(id: string): Promise<StartResult>
  /** 打开应用时：检测哪些项目其实已经在跑（端口有响应），直接显示运行中 */
  adoptAllRunning(): Promise<void>
  /** 在默认浏览器打开该项目（右键菜单），需项目已运行；entry=入口文件相对路径（多入口列表用） */
  openProjectBrowser(id: string, entry?: string): Promise<StartResult>
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  /** 显示主窗口（托盘面板调用；可附带菜单动作） */
  showMainWindow(action?: string): Promise<void>
  quitApp(): Promise<void>
  /** 打开偏好设置窗口（独立窗口）*/
  openSettingsWindow(group?: string): Promise<void>
  /** 关闭偏好设置窗口（右上角 ✕） */
  closeSettingsWindow(): Promise<void>
  /** 自动检索电脑里装的浏览器（app 名列表，默认浏览器选择用） */
  listBrowsers(): Promise<string[]>
  /** 环境监测：检测 Node.js/Python/Docker/Bun 装没装（设置-关于组下方） */
  checkEnvironment(): Promise<EnvCheckItem[]>
  /** 一键安装环境运行时（Mac brew；触发即返回，进度与结果走 onEnvInstallEvent 事件流：进度+取消） */
  installEnvTool(key: string): Promise<void>
  /** 取消正在进行的安装 */
  cancelEnvInstall(key: string): Promise<void>
  /** 订阅安装实时日志与结束事件，返回取消订阅函数 */
  onEnvInstallEvent(cb: (e: EnvInstallEvent) => void): () => void
  /** 本机局域网 IP（局域网访问功能显示用；没有返回空串） */
  getLanIp(): Promise<string>
  /** 当前自定义菜单栏图标的预览（base64 dataURL；GIF 原样返回，浏览器原生动画）；没设置返回 null */
  getTrayIconPreview(): Promise<{ dataUrl: string; isGif: boolean } | null>
  /** 重新探测所有运行中项目的局域网可达性（换网 IP 变化后调用，结果走 onStatus 事件） */
  recheckLan(): Promise<void>
  /** 改由 Reopen 托管：停掉占着项目端口的外部服务（用户手动起的），用项目自己的启动方式重新起（对局域网开门） */
  rehostProject(id: string): Promise<StartResult>
  /** 开机自启（Mac 登录项）开关 */
  setLaunchAtLogin(v: boolean): Promise<void>
  /** 资料库导出/导入（JSON 文件对话框） */
  exportData(): Promise<void>
  importData(): Promise<void>
  /** 在默认浏览器打开链接（关于组） */
  openExternal(url: string): Promise<void>
  /** 在访达中显示路径（右键「访问项目原目录」、资料库路径跳转） */
  revealInFolder(path: string): Promise<void>
  /** 检查更新：GitHub Releases 拿最新版（发现新版本弹窗 ） */
  checkUpdate(): Promise<UpdateInfo>
  /** 订阅左上角应用菜单的动作，返回取消订阅函数 */
  onMenuAction(cb: (action: string) => void): () => void
  /** 订阅设置变化（设置窗口改了之后主窗口同步），返回取消订阅函数 */
  onSettingsChanged(cb: (s: Settings) => void): () => void
  /** 订阅状态变化，返回取消订阅函数 */
  onStatus(cb: (e: ProjectStatusEvent) => void): () => void
  /** 订阅日志，返回取消订阅函数 */
  onLog(cb: (e: ProjectLogEvent) => void): () => void
}
