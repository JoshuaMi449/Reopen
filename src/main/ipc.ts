// IPC 注册：渲染层请求的入口（PRD 八·架构：主进程管系统，渲染层画界面）
import { ipcMain } from 'electron'
import type { NewProjectInput, Settings } from '../shared/types'
import { detectPath, parseApp } from './detect'
import {
  adoptAllRunning,
  adoptRunning,
  openProjectBrowser,
  startProject,
  stopProject
} from './projectManager'
import {
  addProject,
  deleteProject,
  getSettings,
  listProjects,
  saveSettings,
  updateProject
} from './store'

export function registerIpc(): void {
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:detect', (_e, path: string) => detectPath(path))
  ipcMain.handle('project:parse-app', (_e, path: string) => parseApp(path))
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
  ipcMain.handle('project:start', (_e, id: string) => startProject(id))
  ipcMain.handle('project:stop', (_e, id: string) => stopProject(id))
  ipcMain.handle('project:adopt-all', () => adoptAllRunning())
  ipcMain.handle('project:open-browser', (_e, id: string) => openProjectBrowser(id))
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => saveSettings(patch))
}
