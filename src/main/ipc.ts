// IPC 注册：渲染层请求的入口（PRD 八·架构：主进程管系统，渲染层画界面）
import { execSync, spawn, ChildProcess } from 'child_process'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'fs'
import { connect } from 'net'
import { basename, extname, join } from 'path'
import type {
  EnvCheckItem,
  NewProjectInput,
  PortSource,
  Project,
  Settings,
  UpdateInfo
} from '../shared/types'
import { detectPath, parseApp } from './detect'
import {
  adoptAllRunning,
  adoptRunning,
  installProjectDeps,
  killResidualAndStart,
  openProjectBrowser,
  rehostProject,
  reprobeAllLan,
  startProject,
  stopProject
} from './projectManager'
import { closeSettingsWindow, openSettingsWindow } from './settingsWindow'
import { refreshShortcuts } from './shortcuts'
import {
  addProject,
  deleteProject,
  getSettings,
  listProjects,
  saveSettings,
  updateProject
} from './store'
import { appQuit, refreshTray } from './tray'
import { invalidateGifCache } from './gifFrames'
import { listCharacters } from './trayCharacters'
import { getLanIp } from './lan'
import { showMainWindow } from './window'

/** 设置变化广播给所有窗口（主窗口/托盘面板同步） */
function broadcastSettings(settings: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('settings:changed', settings)
  }
}

/** 常见浏览器 .app 名单（显示名：去 .app 后缀"自动检索电脑有哪些浏览器"） */
const KNOWN_BROWSERS = [
  'Safari',
  'Google Chrome',
  'Google Chrome Canary',
  'Microsoft Edge',
  'Firefox',
  'Firefox Developer Edition',
  'Arc',
  'Brave Browser',
  'Opera',
  'Opera GX',
  'Vivaldi',
  'Chromium',
  'Mozilla Firefox',
  'DuckDuckGo',
  '360Chrome',
  'QQBrowser'
]

/** 扫描常见位置，返回这台电脑里装了的浏览器 app 名（按名单顺序） */
function listBrowsers(): string[] {
  const dirs = [
    '/Applications',
    '/System/Applications',
    join(app.getPath('home'), 'Applications'),
    '/Applications/Setapp'
  ]
  const found = new Set<string>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    let names: string[] = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.app')) continue
      const label = name.slice(0, -4)
      // 名单命中直接收；另对 Chromium 系做兜底（XXX.app 内容与 Chrome 同款壳）
      if (KNOWN_BROWSERS.includes(label) || /chrome|browser|firefox|safari|edge/i.test(label)) {
        found.add(label)
      }
    }
  }
  // Safari 特殊：系统应用位置在 /System/Applications，扫描到才算
  return Array.from(found)
}

/** 跑一个命令拿版本（没装返回 null；Windows 用 where 探测） */
function runVersion(cmd: string): string | null {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which'
    execSync(`${probe} ${cmd}`, { stdio: 'ignore' })
    return execSync(`${cmd} --version`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')[0]
  } catch {
    return null
  }
}

/** 环境监测（设置-关于组下方；项目要什么运行时一目了然，没装给安装官网+一键安装） */
function checkEnvironment(): EnvCheckItem[] {
  const items: EnvCheckItem[] = []
  const node = runVersion('node')
  items.push(
    node
      ? { key: 'node', name: 'Node.js', ok: true, version: node }
      : {
          key: 'node',
          name: 'Node.js',
          ok: false,
          hint: '跑 npm 项目的运行时',
          link: 'https://nodejs.org',
          installCommand: 'brew install node'
        }
  )
  const python = runVersion('python3') ?? runVersion('python')
  items.push(
    python
      ? { key: 'python', name: 'Python', ok: true, version: python }
      : {
          key: 'python',
          name: 'Python',
          ok: false,
          hint: '跑 python 程序的运行时',
          link: 'https://python.org',
          installCommand: 'brew install python@3.12'
        }
  )
  const docker = runVersion('docker')
  items.push(
    docker
      ? { key: 'docker', name: 'Docker', ok: true, version: docker }
      : {
          key: 'docker',
          name: 'Docker',
          ok: false,
          hint: '跑 Docker 项目的运行时',
          link: 'https://docker.com',
          installCommand: 'brew install --cask docker'
        }
  )
  const bun = runVersion('bun')
  items.push(
    bun
      ? { key: 'bun', name: 'Bun', ok: true, version: bun }
      : {
          key: 'bun',
          name: 'Bun',
          ok: false,
          hint: '跑 bun 项目的运行时',
          link: 'https://bun.sh',
          installCommand: 'brew install oven-sh/bun/bun'
        }
  )
  return items
}

/** 正在安装的进程（key → child；取消与防重复：进度+取消） */
const envInstallChildren = new Map<string, ChildProcess>()

function broadcastEnvInstall(e: {
  key: string
  line?: string
  ok?: boolean
  error?: string
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('system:env-install-event', e)
  }
}

/** 一键安装环境运行时（Cakebrew 式流式输出——spawn 实时推日志，
 *  取消=掐进程；HOMEBREW_NO_AUTO_UPDATE 跳过 brew 自更新刷屏/拖时间） */
function installEnvTool(key: string): void {
  const cmd =
    key === 'node'
      ? 'brew install node'
      : key === 'python'
        ? 'brew install python@3.12'
        : key === 'docker'
          ? 'brew install --cask docker'
          : key === 'bun'
            ? 'brew install oven-sh/bun/bun'
            : null
  if (!cmd || envInstallChildren.has(key)) return
  const child = spawn(cmd, {
    shell: true,
    detached: true,
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' }
  })
  envInstallChildren.set(key, child)
  broadcastEnvInstall({ key, line: `> ${cmd}` })
  const pipe = (d: Buffer): void => {
    for (const line of d.toString().split('\n')) {
      if (line.trim()) broadcastEnvInstall({ key, line })
    }
  }
  child.stdout?.on('data', pipe)
  child.stderr?.on('data', pipe)
  child.on('exit', (code) => {
    envInstallChildren.delete(key)
    broadcastEnvInstall({
      key,
      ok: code === 0,
      error: code === 0 ? undefined : `安装退出（代码 ${code}）——看上面的日志，或去官网手动装`
    })
  })
  child.on('error', (err) => {
    envInstallChildren.delete(key)
    broadcastEnvInstall({ key, ok: false, error: err.message })
  })
}

/** 取消安装：掐整个进程组（再点一次=取消） */
function cancelEnvInstall(key: string): void {
  const child = envInstallChildren.get(key)
  if (!child?.pid) return
  envInstallChildren.delete(key)
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      // 已退出
    }
  }
  const pid = child.pid
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // 已退出
    }
  }, 3000)
  broadcastEnvInstall({ key, line: '已取消安装' })
  broadcastEnvInstall({ key, ok: false, error: '已取消' })
}

/** 版本比较：1.2.3 式逐段比（tag 的 v 前缀去掉；更新检查用） */
function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number(n) || 0)
  const pb = b
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** 检查更新：GitHub Releases 拿最新正式版（发现新版本弹窗 ，
 *  弹窗里渲染 Release 正文=git 更新内容，链接与按钮跳发布页） */
async function checkUpdate(): Promise<UpdateInfo> {
  const currentVersion = app.getVersion()
  try {
    const res = await fetch('https://api.github.com/repos/JoshuaMi449/Reopen/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Reopen' }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as {
      tag_name: string
      body?: string
      html_url: string
    }
    const latestVersion = data.tag_name.replace(/^v/, '')
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return { hasUpdate: false, currentVersion }
    }
    return {
      hasUpdate: true,
      currentVersion,
      latestVersion,
      body: data.body,
      htmlUrl: data.html_url
    }
  } catch (err) {
    return { hasUpdate: false, currentVersion, error: (err as Error).message }
  }
}

/** 已有项目 → 更新用的完整输入（手动成组/解散组时改 parentId 用）*/
function toProjectInput(p: Project): NewProjectInput {
  return {
    name: p.name,
    type: p.type,
    path: p.path,
    command: p.command,
    port: p.port,
    entryPath: p.entryPath,
    parentId: p.parentId,
    launchModes: p.launchModes,
    activeMode: p.activeMode,
    openBrowser: p.openBrowser,
    note: p.note,
    tags: p.tags,
    lastPort: p.lastPort
  }
}

export function registerIpc(): void {
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:detect', (_e, path: string) => detectPath(path))
  ipcMain.handle('project:parse-app', (_e, path: string) => parseApp(path))
  // 「+」按钮：打开访达选项目文件夹；allowFile=true 时文件/文件夹都能选（网页项目重新定位用）
  ipcMain.handle('dialog:pick-project-folder', async (_e, allowFile?: boolean) => {
    const res = await dialog.showOpenDialog({
      title: allowFile ? '选择项目文件或文件夹' : '选择项目文件夹',
      properties: allowFile ? ['openFile', 'openDirectory'] : ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })
  ipcMain.handle('project:add', async (_e, input: NewProjectInput) => {
    // 组重名禁止：顶层列表里两个同名组会分不清（用户要求；项目和组同名不拦）
    if (
      input.type === 'group' &&
      listProjects().some((p) => p.type === 'group' && p.name === input.name)
    ) {
      throw new Error('已经有同名项目组了，换个名字吧')
    }
    const project = addProject(input)
    // 登记时检测：项目其实已经在跑（端口有响应）就直接显示运行中
    adoptRunning(project)
    return project
  })
  ipcMain.handle('project:update', (_e, id: string, input: NewProjectInput) => {
    // 组重名禁止（排除自己）
    if (
      input.type === 'group' &&
      listProjects().some((p) => p.id !== id && p.type === 'group' && p.name === input.name)
    ) {
      throw new Error('已经有同名项目组了，换个名字吧')
    }
    return updateProject(id, input)
  })
  ipcMain.handle('project:delete', (_e, id: string) => deleteProject(id))

  // 手动成组 / 解散组（框选右键"添加成组"；组右键"解散组"）
  ipcMain.handle('project:create-group', (_e, ids: string[], name?: string) => {
    const items = listProjects().filter(
      (p) => ids.includes(p.id) && !p.parentId && p.type !== 'group'
    )
    if (items.length < 2) throw new Error('成组至少需要两个顶层项目（组和组内子项不算）')
    const group = addProject({
      name: (name ?? '').trim() || '新建项目组',
      type: 'group',
      path: items[0].path,
      openBrowser: false,
      note: '',
      tags: []
    })
    for (const p of items) {
      updateProject(p.id, { ...toProjectInput(p), parentId: group.id })
    }
    return group
  })
  ipcMain.handle('project:ungroup', (_e, id: string) => {
    const group = listProjects().find((p) => p.id === id)
    if (!group || group.type !== 'group') return
    for (const c of listProjects().filter((p) => p.parentId === id)) {
      updateProject(c.id, { ...toProjectInput(c), parentId: undefined })
    }
    deleteProject(id)
  })
  // 改端口直接改写项目源文件（只动文件不动档案——档案由调用方在改写成功后落新端口，
  //  保证「源码改不动时档案也不会记成新端口」，两边永不打架）
  ipcMain.handle(
    'project:rewrite-port-file',
    (_e, path: string, src: PortSource, newPort: number) => {
      const file = join(path, src.file)
      try {
        const content = readFileSync(file, 'utf-8')
        if (!content.includes(src.find)) {
          return {
            ok: false,
            reason: `在 ${src.file} 里没找到原端口片段（文件可能被改过），已保持项目端口不变，请手动修改`
          }
        }
        // 把片段里的端口数字换成新端口（portLen=0 表示原片段没数字，直接插进去）
        const newFind =
          src.find.slice(0, src.portAt) + String(newPort) + src.find.slice(src.portAt + src.portLen)
        writeFileSync(file, content.replace(src.find, newFind), 'utf-8')
        // 返回新片段：调用方把它连同新端口一起写进档案（下次再改还能找到）
        return {
          ok: true,
          source: { ...src, find: newFind, portLen: String(newPort).length }
        }
      } catch (err) {
        return {
          ok: false,
          reason: `改写失败：${err instanceof Error ? err.message : String(err)}`
        }
      }
    }
  )
  // 端口输入实时查重：先查 Reopen 档案里其他项目登记的端口，再探测本机 TCP 是否被监听
  ipcMain.handle('project:check-port', async (_e, port: number, excludeId?: string) => {
    const by = listProjects().find((p) => p.id !== excludeId && p.port === port)
    if (by) return { inUse: true, byProject: by.name }
    const system = await new Promise<boolean>((resolve) => {
      const sock = connect({ port, host: '127.0.0.1' })
      sock.setTimeout(600)
      sock.on('connect', () => {
        sock.destroy()
        resolve(true)
      })
      sock.on('timeout', () => {
        sock.destroy()
        resolve(false)
      })
      sock.on('error', () => resolve(false))
    })
    return system ? { inUse: true, bySystem: true } : { inUse: false }
  })
  ipcMain.handle('project:start', (_e, id: string, modeId?: string) => startProject(id, modeId))
  ipcMain.handle('project:stop', (_e, id: string) => stopProject(id))
  ipcMain.handle('project:install-deps', (_e, id: string) => installProjectDeps(id))
  ipcMain.handle('project:kill-residual', (_e, id: string) => killResidualAndStart(id))
  ipcMain.handle('project:adopt-all', () => adoptAllRunning())
  ipcMain.handle('project:open-browser', (_e, id: string, entry?: string) =>
    openProjectBrowser(id, entry)
  )

  // 设置
  ipcMain.handle('settings:get', () => getSettings())
  // 自定义菜单栏图标：选图 → 检查大小 → 复制到 userData（原图移动/删除不影响显示）
  ipcMain.handle('tray:pick-icon', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await (win
      ? dialog.showOpenDialog(win, {
          title: '选择菜单栏图标',
          filters: [{ name: '图片（PNG/JPG/GIF）', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
          properties: ['openFile']
        })
      : dialog.showOpenDialog({
          title: '选择菜单栏图标',
          filters: [{ name: '图片（PNG/JPG/GIF）', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
          properties: ['openFile']
        }))
    if (res.canceled || !res.filePaths[0]) return null
    const f = res.filePaths[0]
    if (statSync(f).size > 2 * 1024 * 1024) throw new Error('图片太大（最大 2MB），换一张小一点的')
    const dest = join(
      app.getPath('userData'),
      `custom-tray-icon${extname(f).toLowerCase() || '.png'}`
    )
    copyFileSync(f, dest)
    invalidateGifCache() // 换图后旧帧序列作废（同路径覆盖换文件）
    return dest
  })
  // 导入菜单栏素材（设置页拖放的 GIF/PNG）：复制到 userData/tray-icons/ 保原名并加入角色库
  ipcMain.handle('tray:import-icon', (_e, filePath: string) => {
    const f = String(filePath ?? '')
    const ext = extname(f).toLowerCase()
    if (!['.gif', '.png', '.jpg', '.jpeg'].includes(ext) || !existsSync(f)) {
      throw new Error('只支持 GIF/PNG/JPG 图片')
    }
    if (statSync(f).size > 2 * 1024 * 1024) throw new Error('图片太大（最大 2MB），换一张小一点的')
    const dir = join(app.getPath('userData'), 'tray-icons')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, basename(f))
    copyFileSync(f, dest)
    const s = getSettings()
    const list = s.customTrayIcons.filter((p) => p !== dest) // 同路径重导=覆盖文件，不重复记
    saveSettings({ customTrayIcons: [...list, dest] })
    invalidateGifCache()
    return dest
  })
  // 托盘角色清单：内置角色 + 用户导入素材，带预览 dataURL（设置页角色弹窗用）
  ipcMain.handle('tray:list-characters', () =>
    listCharacters().map((c) => {
      const ext = extname(c.path).toLowerCase()
      const mime = ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : 'image/jpeg'
      return {
        key: c.key,
        label: c.label,
        path: c.path,
        builtin: c.builtin,
        dataUrl: `data:${mime};base64,${readFileSync(c.path).toString('base64')}`,
        isGif: mime === 'image/gif'
      }
    })
  )
  // 当前自定义图标的预览（渲染层 <img> 显示；GIF 原样给，浏览器原生动画）；没设置返回 null
  ipcMain.handle('tray:get-icon-preview', () => {
    const { trayIcon, trayIconPath } = getSettings()
    if (trayIcon !== 'custom' || !trayIconPath || !existsSync(trayIconPath)) return null
    const ext = extname(trayIconPath).toLowerCase()
    const mime = ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : 'image/jpeg'
    return {
      dataUrl: `data:${mime};base64,${readFileSync(trayIconPath).toString('base64')}`,
      isGif: mime === 'image/gif'
    }
  })
  // 重新探测所有运行中项目的局域网可达性（换网 IP 变化后调用）
  ipcMain.handle('system:recheck-lan', () => reprobeAllLan())
  // 改由本应用托管：停掉手动起的旧服务重新启动（对局域网开门）
  ipcMain.handle('project:rehost', (_e, id: string) => rehostProject(id))
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const saved = saveSettings(patch)
    // 托盘启用/图标样式/速度/大小变化 → 立即刷新托盘；快捷键变化 → 重新注册
    if (
      'trayEnabled' in patch ||
      'trayIcon' in patch ||
      'trayIconPath' in patch ||
      'trayIconSpeed' in patch ||
      'cpuFollow' in patch ||
      'trayAutoReverse' in patch
    ) {
      refreshTray()
    }
    // 开「允许局域网访问」→ 立即补探所有运行中项目（关则渲染层按门控隐藏）
    if ('lanAccess' in patch && patch.lanAccess === true) reprobeAllLan()
    if ('hotkey' in patch || 'quickLaunch' in patch) refreshShortcuts()
    broadcastSettings(saved)
    return saved
  })

  // 窗口与应用
  ipcMain.handle('window:show-main', (_e, action?: string) => showMainWindow(action))
  ipcMain.handle('window:open-settings', () => openSettingsWindow())
  ipcMain.handle('window:close-settings', () => closeSettingsWindow())
  ipcMain.handle('system:list-browsers', () => listBrowsers())
  ipcMain.handle('system:check-env', () => checkEnvironment())
  ipcMain.handle('system:install-env', (_e, key: string) => installEnvTool(key))
  ipcMain.handle('system:env-install-cancel', (_e, key: string) => cancelEnvInstall(key))
  ipcMain.handle('system:get-lan-ip', () => getLanIp())
  ipcMain.handle('update:check', () => checkUpdate())
  ipcMain.handle('app:quit', () => appQuit())
  ipcMain.handle('app:set-login', (_e, v: boolean) => {
    app.setLoginItemSettings({ openAtLogin: v })
  })
  ipcMain.handle('shell:open-external', (_e, url: string) => shell.openExternal(url))
  // 在访达中显示（右键「访问项目原目录」、资料库路径跳转）
  ipcMain.handle('shell:reveal-in-folder', (_e, path: string) => shell.showItemInFolder(path))

  // 资料库：导出/导入 JSON
  ipcMain.handle('data:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出资料库',
      defaultPath: join(app.getPath('desktop'), `reopen-资料库-${Date.now()}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return
    const data = {
      exportedAt: new Date().toISOString(),
      projects: listProjects(),
      settings: getSettings()
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  })
  ipcMain.handle('data:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '导入资料库',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return
    const data = JSON.parse(readFileSync(filePaths[0], 'utf-8'))
    if (!Array.isArray(data.projects)) throw new Error('不是有效的资料库文件')
    // 与现有项目合并（按路径查重）
    const existing = listProjects()
    const existingPaths = new Set(existing.map((p) => p.path))
    for (const p of data.projects as Project[]) {
      if (!existingPaths.has(p.path)) {
        addProject({
          name: p.name,
          type: p.type,
          path: p.path,
          command: p.command,
          port: p.port,
          openBrowser: p.openBrowser,
          note: p.note,
          tags: p.tags
        })
      }
    }
    if (data.settings) saveSettings({ ...getSettings(), ...data.settings })
    broadcastSettings(getSettings())
  })
}
