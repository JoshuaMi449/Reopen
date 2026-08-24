// IPC 注册：渲染层请求的入口（PRD 八·架构：主进程管系统，渲染层画界面）
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { NewProjectInput, Project, Settings } from '../shared/types'
import { detectPath, parseApp } from './detect'
import {
  adoptAllRunning,
  adoptRunning,
  openProjectBrowser,
  startProject,
  stopProject
} from './projectManager'
import { openSettingsWindow } from './settingsWindow'
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
import { showMainWindow } from './window'

/** 设置变化广播给所有窗口（主窗口/托盘面板同步） */
function broadcastSettings(settings: Settings): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('settings:changed', settings)
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
    const project = addProject(input)
    // 登记时检测：项目其实已经在跑（端口有响应）就直接显示运行中
    adoptRunning(project)
    return project
  })
  ipcMain.handle('project:update', (_e, id: string, input: NewProjectInput) =>
    updateProject(id, input)
  )
  ipcMain.handle('project:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('project:start', (_e, id: string, modeId?: string) => startProject(id, modeId))
  ipcMain.handle('project:stop', (_e, id: string) => stopProject(id))
  ipcMain.handle('project:adopt-all', () => adoptAllRunning())
  ipcMain.handle('project:open-browser', (_e, id: string) => openProjectBrowser(id))

  // 设置
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const saved = saveSettings(patch)
    // 托盘启用/图标样式变化 → 立即刷新托盘；快捷键变化 → 重新注册
    if ('trayEnabled' in patch || 'trayIcon' in patch) refreshTray()
    if ('hotkey' in patch || 'quickLaunch' in patch) refreshShortcuts()
    broadcastSettings(saved)
    return saved
  })

  // 窗口与应用
  ipcMain.handle('window:show-main', (_e, action?: string) => showMainWindow(action))
  ipcMain.handle('window:open-settings', (_e, group?: string) => openSettingsWindow(group))
  ipcMain.handle('app:quit', () => appQuit())
  ipcMain.handle('app:set-login', (_e, v: boolean) => {
    app.setLoginItemSettings({ openAtLogin: v })
  })
  ipcMain.handle('shell:open-external', (_e, url: string) => shell.openExternal(url))

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
