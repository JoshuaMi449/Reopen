import { app, BrowserWindow, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { createAppMenu } from './menu'
import { autoStartAll, stopAllRuntimes } from './projectManager'
import { getSettings } from './store'
import { refreshShortcuts } from './shortcuts'
import { initTray } from './tray'
import { createWindow, isQuitConfirmed, markQuitConfirmed, showMainWindow } from './window'

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
    // Dock 点击唤起：窗口被隐藏（最小化到托盘）时也重新显示——只查「没有窗口」会导致
    // 隐藏状态下点 Dock 没反应（用户反馈「启动台的 app 打不开」）
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      showMainWindow()
    }
  })
})

// ⌘Q 退出需要二次确认（防误触；托盘右键「退出」是明确意图，走 appQuit 直接退不弹窗）；
// 关窗口最小化到托盘不走这里（常驻菜单栏设计不变）；
// 设置里「退出后项目继续运行」勾选时，退出不停正在跑的项目
app.on('before-quit', (e) => {
  if (isQuitConfirmed()) return
  e.preventDefault()
  const keep = getSettings().keepProjectsOnQuit
  const choice = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['退出', '取消'],
    defaultId: 1,
    cancelId: 1,
    message: '确定退出 Reopen 吗？',
    detail: keep
      ? '正在运行的项目会继续在本地运行。'
      : '正在运行的项目会一并停止，之后再打开可随时重新启动。'
  })
  if (choice !== 0) return
  if (!keep) stopAllRuntimes()
  markQuitConfirmed()
  app.quit()
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
