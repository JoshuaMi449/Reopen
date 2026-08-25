// 左上角应用菜单：全量标准六菜单（PRD 3.3 应用内快捷键 ）
import { BrowserWindow, Menu, shell } from 'electron'

/** 给主窗口发菜单动作 */
function send(action: string): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.webContents.isLoading())
  win?.webContents.send('app:menu-action', action)
}

export function createAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: 'Reopen',
            submenu: [
              { label: '关于 Reopen', click: () => send('about') },
              { label: '检查更新…', click: () => send('check-update') },
              { type: 'separator' },
              { label: '偏好设置…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        { label: '添加项目…', accelerator: 'CmdOrCtrl+N', click: () => send('add-project') },
        { type: 'separator' },
        { label: '导入资料库…', enabled: false }, // M3-5 资料库组接线
        { label: '导出资料库…', enabled: false }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '列表视图', click: () => send('set-view-list') },
        { label: '卡片视图', click: () => send('set-view-card') },
        { type: 'separator' },
        { label: '搜索', accelerator: 'CmdOrCtrl+F', click: () => send('focus-search') }
      ]
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'GitHub 仓库',
          click: () => shell.openExternal('https://github.com/JoshuaMi449/Reopen')
        },
        {
          label: '报告问题',
          click: () => shell.openExternal('https://github.com/JoshuaMi449/Reopen/issues')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

export function removeAppMenu(): void {
  Menu.setApplicationMenu(null)
}
