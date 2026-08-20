// 共享类型：主进程与渲染进程共用的数据定义（PRD 第三章功能需求的数据模型）

/** 项目类型：本地服务（起命令） / 网页文件（起临时服务+开浏览器） */
export type ProjectType = 'service' | 'web'

/** 运行时状态：只存在主进程内存，不写进 JSON */
export type ProjectStatus = 'stopped' | 'starting' | 'running' | 'failed'

/** 项目（对应确认表单的字段） */
export interface Project {
  id: string
  name: string
  type: ProjectType
  path: string
  /** 仅 service：启动命令（如 npm run dev） */
  command?: string
  /** 端口：service 用于健康检查；web 自动分配 */
  port?: number
  /** 启动后打开默认浏览器，默认关 */
  openBrowser: boolean
  note: string
  tags: string[]
  createdAt: number
  /** 上次启动时间（毫秒时间戳） */
  lastStartedAt?: number
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
  }
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

export type DetectOutcome = DetectSuccess | DetectNeedParseApp | DetectFailed | DetectDuplicate

/** 项目状态变化事件（主进程推送 → 渲染层更新圆点/标红） */
export interface ProjectStatusEvent {
  id: string
  status: ProjectStatus
  /** 实际端口（web 自动分配后回传） */
  port?: number
  /** 失败原因（PRD 3.4：通知带失败原因） */
  reason?: string
  startedAt?: number
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
  /** 当前排序方式 */
  sortMode: 'manual' | 'recent' | 'name'
  /** 标签 → 颜色（访达式彩色标签，色板循环分配） */
  tagColors: Record<string, string>
  /** 自启项总开关（默认关，PRD 3.5） */
  autoStartEnabled: boolean
  /** 自启项内的项目 id */
  autoStartIds: string[]
  /** 主题风格（PRD 3.8） */
  theme: 'morandi' | 'ocean' | 'slate'
  /** 亮暗：跟随系统 / 浅 / 深 / 特殊风格（Proma 式，2026-08-20 用户拍板） */
  darkMode: 'system' | 'light' | 'dark' | 'special'
  /** 特殊风格 id（darkMode=special 时生效；切回其他模式自动清空） */
  specialStyle: string
  /** 关闭窗口 = 最小化到托盘（默认开，2026-08-20 拍板） */
  closeToTray: boolean
  /** 托盘图标：黑白模板 / 彩色 */
  trayIcon: 'mono' | 'color'
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
  /** 列表间距（外观设置） */
  rowDensity: 'comfortable' | 'compact'
  /** Onboarding 是否已完成（仅首次显示） */
  onboarded: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  manualOrder: [],
  view: 'list',
  sortMode: 'manual',
  tagColors: {},
  autoStartEnabled: false,
  autoStartIds: [],
  theme: 'morandi',
  darkMode: 'system',
  specialStyle: '',
  closeToTray: true,
  trayIcon: 'mono',
  trayEnabled: true,
  hotkey: 'Alt+R',
  quickLaunch: {},
  launchAtLogin: false,
  notifyOnFail: false,
  rowDensity: 'comfortable',
  onboarded: false
}

/** 渲染层可用的全部 API（preload 通过 contextBridge 暴露为 window.api） */
export interface ReopenApi {
  /** 拖拽的 File 对象 → 磁盘路径（Electron 32+ 需 webUtils） */
  getPathForFile(file: File): string
  listProjects(): Promise<Project[]>
  detectPath(path: string): Promise<DetectOutcome>
  parseApp(path: string): Promise<DetectOutcome>
  addProject(input: NewProjectInput): Promise<Project>
  updateProject(id: string, input: NewProjectInput): Promise<Project>
  deleteProject(id: string): Promise<void>
  startProject(id: string): Promise<StartResult>
  stopProject(id: string): Promise<void>
  /** 打开应用时：检测哪些项目其实已经在跑（端口有响应），直接显示运行中 */
  adoptAllRunning(): Promise<void>
  /** 在默认浏览器打开该项目（右键菜单），需项目已运行 */
  openProjectBrowser(id: string): Promise<StartResult>
  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
  /** 显示主窗口（托盘面板调用；可附带菜单动作） */
  showMainWindow(action?: string): Promise<void>
  quitApp(): Promise<void>
  /** 打开偏好设置窗口（独立窗口，Proma 式） */
  openSettingsWindow(group?: string): Promise<void>
  /** 开机自启（Mac 登录项）开关 */
  setLaunchAtLogin(v: boolean): Promise<void>
  /** 资料库导出/导入（JSON 文件对话框） */
  exportData(): Promise<void>
  importData(): Promise<void>
  /** 在默认浏览器打开链接（关于组） */
  openExternal(url: string): Promise<void>
  /** 订阅左上角应用菜单的动作，返回取消订阅函数 */
  onMenuAction(cb: (action: string) => void): () => void
  /** 订阅设置变化（设置窗口改了之后主窗口同步），返回取消订阅函数 */
  onSettingsChanged(cb: (s: Settings) => void): () => void
  /** 订阅状态变化，返回取消订阅函数 */
  onStatus(cb: (e: ProjectStatusEvent) => void): () => void
  /** 订阅日志，返回取消订阅函数 */
  onLog(cb: (e: ProjectLogEvent) => void): () => void
}
