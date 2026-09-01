// 配置存储模块：项目清单的 JSON 持久化
// 存到 app.getPath('userData') = ~/Library/Application Support/Reopen/（PRD 四·数据）
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { NewProjectInput, Project, Settings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

let projects: Project[] = []
let loaded = false

function dataFile(): string {
  return join(app.getPath('userData'), 'projects.json')
}

export function listProjects(): Project[] {
  if (loaded) return projects
  try {
    if (existsSync(dataFile())) {
      projects = JSON.parse(readFileSync(dataFile(), 'utf-8'))
    }
  } catch (err) {
    console.error('读取 projects.json 失败，按空列表继续：', err)
    projects = []
  }
  // 旧数据惰性迁移（"顺手刷一遍"）：老项目没有 launchModes → 按 type 生成单方式+activeMode，一次性写回
  if (migrateLaunchModes(projects)) persist()
  // 主入口修正：根层 index.html 才是主页，一次性写回
  if (migrateRootEntry(projects)) persist()
  loaded = true
  return projects
}

/** 老项目补 launchModes/activeMode（前的数据；返回是否有改动） */
function migrateLaunchModes(list: Project[]): boolean {
  let changed = false
  for (const p of list) {
    if (p.type === 'group' || (p.launchModes && p.launchModes.length > 0)) continue
    if (p.type === 'web') {
      p.launchModes = [
        { id: 'preview', kind: 'preview', label: '成品预览', entryPath: p.entryPath }
      ]
      p.activeMode = 'preview'
    } else {
      p.launchModes = [
        { id: 'dev', kind: 'dev', label: '开发服务器', command: p.command, port: p.port }
      ]
      p.activeMode = 'dev'
    }
    changed = true
  }
  return changed
}

/** 主入口修正：入口清单里有根层 index.html 时它就是主页（*  网站的首页被体积更大的内页挤掉；返回是否有改动） */
function migrateRootEntry(list: Project[]): boolean {
  let changed = false
  for (const p of list) {
    if (p.type !== 'web') continue
    const has = p.entryPaths?.includes('/index.html') ?? false
    if (has && p.entryPath !== '/index.html') {
      p.entryPath = '/index.html'
      // 同步进 preview 方式（运行时读 mode.entryPath）
      const mode = p.launchModes?.find((m) => m.kind === 'preview')
      if (mode) mode.entryPath = '/index.html'
      changed = true
    }
  }
  return changed
}

function persist(): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(dataFile(), JSON.stringify(projects, null, 2), 'utf-8')
}

export function addProject(input: NewProjectInput): Project {
  const project: Project = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now()
  }
  projects.push(project)
  persist()
  return project
}

export function deleteProject(id: string): void {
  projects = projects.filter((p) => p.id !== id)
  persist()
}

export function updateProject(id: string, input: Partial<NewProjectInput>): Project {
  const p = projects.find((proj) => proj.id === id)
  if (!p) throw new Error('项目不存在')
  Object.assign(p, input)
  persist()
  return p
}

export function touchStartedAt(id: string): void {
  const p = projects.find((p) => p.id === id)
  if (p) {
    p.lastStartedAt = Date.now()
    persist()
  }
}

/** 惰性补统一入口路由名（老数据无 lanSlug，首次挂载时生成并写回档案） */
export function touchLanSlug(id: string, slug: string): void {
  const p = projects.find((proj) => proj.id === id)
  if (p && p.lanSlug !== slug) {
    p.lanSlug = slug
    persist()
  }
}

/** 回写实际运行端口（重启 Reopen 后用它做接管检测，修复"运行中显示已停止"） */
export function touchLastPort(id: string, port: number): void {
  const p = projects.find((p) => p.id === id)
  if (p && p.lastPort !== port) {
    p.lastPort = port
    persist()
  }
}

// ---------- 设置（settings.json） ----------

let settings: Settings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  if (settings) return settings
  try {
    if (existsSync(settingsFile())) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(settingsFile(), 'utf-8')) }
    }
  } catch (err) {
    console.error('读取 settings.json 失败，按默认设置继续：', err)
  }
  if (!settings) settings = { ...DEFAULT_SETTINGS }
  // 旧数据迁移：排序方式重做后 'manual' 已更名为 'none'（
  if ((settings.sortMode as string) === 'manual') settings.sortMode = 'none'
  // 旧数据迁移：动图速度语义重做（倍率 0.25~3 → 只因速 0~1），老值超出范围回落默认 0.5
  if (settings.trayIconSpeed > 1 || settings.trayIconSpeed < 0) settings.trayIconSpeed = 0.5
  // 旧数据迁移：彩色托盘图标选项已删除 → 回落黑白（用户要求只留黑白/自定义）
  if ((settings.trayIcon as string) === 'color') settings.trayIcon = 'mono'
  // 旧数据迁移：特殊风格七套改名换代为 六套主题（磷光→森息夜语最接近）
  const STYLE_MAP: Record<string, string> = {
    'special-sl': 'special-clouddancer',
    'special-ol': 'special-oceanlight',
    'special-fl': 'special-forestlight',
    'special-od': 'special-oceandark',
    'special-fd': 'special-forestdark',
    'special-md': 'special-slatedark',
    'special-td': 'special-forestdark'
  }
  if (settings.specialStyle && STYLE_MAP[settings.specialStyle]) {
    settings = { ...settings, specialStyle: STYLE_MAP[settings.specialStyle] }
    saveSettings({ specialStyle: settings.specialStyle })
  }
  return settings
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings()
  settings = { ...current, ...patch }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}
