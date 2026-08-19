// IPC 注册：渲染层请求的入口（PRD 八·架构：主进程管系统，渲染层画界面）
import { ipcMain } from 'electron'
import type { NewProjectInput } from '../shared/types'
import { detectPath, parseApp } from './detect'
import { startProject, stopProject } from './projectManager'
import { addProject, deleteProject, listProjects } from './store'

export function registerIpc(): void {
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:detect', (_e, path: string) => detectPath(path))
  ipcMain.handle('project:parse-app', (_e, path: string) => parseApp(path))
  ipcMain.handle('project:add', (_e, input: NewProjectInput) => addProject(input))
  ipcMain.handle('project:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('project:start', (_e, id: string) => startProject(id))
  ipcMain.handle('project:stop', (_e, id: string) => stopProject(id))
}
