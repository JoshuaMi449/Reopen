import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  NewProjectInput,
  ProjectLogEvent,
  ProjectStatusEvent,
  ReopenApi
} from '../shared/types'

// 渲染层可用的全部 API（contextBridge 安全暴露，类型见 shared/types.ts）
const api: ReopenApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listProjects: () => ipcRenderer.invoke('project:list'),
  detectPath: (path) => ipcRenderer.invoke('project:detect', path),
  parseApp: (path) => ipcRenderer.invoke('project:parse-app', path),
  addProject: (input: NewProjectInput) => ipcRenderer.invoke('project:add', input),
  updateProject: (id, input) => ipcRenderer.invoke('project:update', id, input),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  startProject: (id) => ipcRenderer.invoke('project:start', id),
  stopProject: (id) => ipcRenderer.invoke('project:stop', id),
  adoptAllRunning: () => ipcRenderer.invoke('project:adopt-all'),
  openProjectBrowser: (id) => ipcRenderer.invoke('project:open-browser', id),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
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
