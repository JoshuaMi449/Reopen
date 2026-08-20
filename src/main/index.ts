import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { createAppMenu } from './menu'
import { autoStartAll } from './projectManager'
import { refreshShortcuts } from './shortcuts'
import { initTray } from './tray'
import { createWindow, markQuitting, showMainWindow } from './window'

// 单例锁：重复启动时唤起已有窗口而不是开两个（PRD 四·稳定性）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 项目管理的 IPC 入口
  registerIpc()

  createWindow()

  // 左上角应用菜单（全量标准六菜单）+ 右上角托盘 + 全局快捷键
  createAppMenu()
  initTray()
  refreshShortcuts()

  // 自启项：打开 Reopen 自动拉起（PRD 3.5 两层自动机制中的软件层）
  autoStartAll()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  markQuitting()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
