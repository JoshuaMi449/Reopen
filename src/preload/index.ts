import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  EnvInstallEvent,
  NewProjectInput,
  ProjectLogEvent,
  ProjectStatusEvent,
  ReopenApi,
  Settings,
  SystemInfo
} from '../shared/types'

// 渲染层可用的全部 API（contextBridge 安全暴露，类型见 shared/types.ts）
const api: ReopenApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listProjects: () => ipcRenderer.invoke('project:list'),
  detectPath: (path) => ipcRenderer.invoke('project:detect', path),
  /** 「+」按钮：打开访达选项目文件夹；allowFile=true 文件/文件夹都能选（取消返回 null） */
  pickProjectFolder: (allowFile?: boolean) =>
    ipcRenderer.invoke('dialog:pick-project-folder', allowFile),
  parseApp: (path) => ipcRenderer.invoke('project:parse-app', path),
  addProject: (input: NewProjectInput) => ipcRenderer.invoke('project:add', input),
  updateProject: (id, input) => ipcRenderer.invoke('project:update', id, input),
  deleteProject: (id) => ipcRenderer.invoke('project:delete', id),
  createGroup: (ids: string[], name?: string) =>
    ipcRenderer.invoke('project:create-group', ids, name),
  ungroup: (id: string) => ipcRenderer.invoke('project:ungroup', id),
  rewriteProjectPortFile: (path, source, port) =>
    ipcRenderer.invoke('project:rewrite-port-file', path, source, port),
  startProject: (id, modeId) => ipcRenderer.invoke('project:start', id, modeId),
  checkPortInUse: (port, excludeId) => ipcRenderer.invoke('project:check-port', port, excludeId),
  pickTrayIcon: (filter) => ipcRenderer.invoke('tray:pick-icon', filter),
  importTrayIcon: (filePath: string) => ipcRenderer.invoke('tray:import-icon', filePath),
  renameTrayIcon: (path: string, newName: string) =>
    ipcRenderer.invoke('tray:rename-icon', path, newName),
  deleteTrayIcon: (path: string) => ipcRenderer.invoke('tray:delete-icon', path),
  listTrayCharacters: () => ipcRenderer.invoke('tray:list-characters'),
  stopProject: (id) => ipcRenderer.invoke('project:stop', id),
  installProjectDeps: (id) => ipcRenderer.invoke('project:install-deps', id),
  killResidual: (id) => ipcRenderer.invoke('project:kill-residual', id),
  adoptAllRunning: () => ipcRenderer.invoke('project:adopt-all'),
  openProjectBrowser: (id, entry) => ipcRenderer.invoke('project:open-browser', id, entry),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  showMainWindow: (action) => ipcRenderer.invoke('window:show-main', action),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openSettingsWindow: (group) => ipcRenderer.invoke('window:open-settings', group),
  closeSettingsWindow: () => ipcRenderer.invoke('window:close-settings'),
  listBrowsers: () => ipcRenderer.invoke('system:list-browsers'),
  checkEnvironment: () => ipcRenderer.invoke('system:check-env'),
  installEnvTool: (key) => ipcRenderer.invoke('system:install-env', key),
  cancelEnvInstall: (key) => ipcRenderer.invoke('system:env-install-cancel', key),
  onEnvInstallEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: EnvInstallEvent): void => cb(ev)
    ipcRenderer.on('system:env-install-event', listener)
    return () => ipcRenderer.removeListener('system:env-install-event', listener)
  },
  getLanIp: () => ipcRenderer.invoke('system:get-lan-ip'),
  checkPermissions: () => ipcRenderer.invoke('perm:check'),
  requestPermissions: () => ipcRenderer.invoke('perm:request'),
  getPlatform: () => ipcRenderer.invoke('app:platform'),
  getTrayIconPreview: () => ipcRenderer.invoke('tray:get-icon-preview'),
  recheckLan: () => ipcRenderer.invoke('system:recheck-lan'),
  rehostProject: (id) => ipcRenderer.invoke('project:rehost', id),
  setLaunchAtLogin: (v) => ipcRenderer.invoke('app:set-login', v),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  revealInFolder: (path) => ipcRenderer.invoke('shell:reveal-in-folder', path),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
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
  },
  onSystemInfo: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: SystemInfo): void => cb(s)
    ipcRenderer.on('tray:system-info', listener)
    return () => ipcRenderer.removeListener('tray:system-info', listener)
  },
  switchTrayCharacter: (path) => ipcRenderer.invoke('tray:switch-character', path),
  switchTrayTheme: () => ipcRenderer.invoke('tray:switch-theme'),
  openActivityMonitor: () => ipcRenderer.invoke('tray:open-activity-monitor'),
  onTrayResetView: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('tray:reset-view', listener)
    return () => ipcRenderer.removeListener('tray:reset-view', listener)
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
