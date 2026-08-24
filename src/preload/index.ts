import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  NewProjectInput,
  ProjectLogEvent,
  ProjectStatusEvent,
  ReopenApi,
  Settings
} from '../shared/types'

// 渲染层可用的全部 API（contextBridge 安全暴露，类型见 shared/types.ts）
const api: ReopenApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listProjects: () => ipcRenderer.invoke('project:list'),
  detectPath: (path) => ipcRenderer.invoke('project:detect', path),
  /** 「+」按钮：打开访达选项目文件夹；allowFile=true 文件/文件夹都能选（取消返回 null），2026-08-20 拍板 */
  pickProjectFolder: (allowFile?: boolean) =>
    ipcRenderer.invoke('dialog:pick-project-folder', allowFile),
  parseApp: (path) => ipcRenderer.invoke('project:parse-app', path),
  addProject: (input: NewProjectInput) => ipcRenderer.invoke('project:add', input),
  updateProject: (id, input) => ipcRenderer.invoke('project:update', id, input),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  startProject: (id, modeId) => ipcRenderer.invoke('project:start', id, modeId),
  stopProject: (id) => ipcRenderer.invoke('project:stop', id),
  adoptAllRunning: () => ipcRenderer.invoke('project:adopt-all'),
  openProjectBrowser: (id) => ipcRenderer.invoke('project:open-browser', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  showMainWindow: (action) => ipcRenderer.invoke('window:show-main', action),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openSettingsWindow: (group) => ipcRenderer.invoke('window:open-settings', group),
  closeSettingsWindow: () => ipcRenderer.invoke('window:close-settings'),
  listBrowsers: () => ipcRenderer.invoke('system:list-browsers'),
  checkEnvironment: () => ipcRenderer.invoke('system:check-env'),
  setLaunchAtLogin: (v) => ipcRenderer.invoke('app:set-login', v),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  onMenuAction: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, action: string): void => cb(action)
    ipcRenderer.on('app:menu-action', listener)
    return () => ipcRenderer.removeListener('app:menu-action', listener)
  },
  onSettingsChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: Settings): void => cb(s)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  onStatus: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, event: ProjectStatusEvent): void => cb(event)
    ipcRenderer.on('project:status', listener)
    return () => ipcRenderer.removeListener('project:status', listener)
  },
  onLog: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, event: ProjectLogEvent): void => cb(event)
    ipcRenderer.on('project:log', listener)
    return () => ipcRenderer.removeListener('project:log', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
