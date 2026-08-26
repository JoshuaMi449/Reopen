// 系统权限：新手引导第 5 步之后的权限幕用。
// macOS 两项权限：
//   文件夹访问——TCC 保护桌面/文稿/下载目录，未授权列出目录内容会失败；
//   通知——没有 API 能查授权状态：发一条测试通知触发系统授权弹窗，用户看到通知=已开启。
// 授权弹窗都是 macOS 系统统一模板，应用只能触发、不能自绘。
// Windows 无这两项权限（防火墙弹窗由系统在首次监听端口时自动弹），视为已就绪。
import { Notification, shell } from 'electron'
import { readdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/** 文件夹访问检测：列出桌面目录内容。未授权时 macOS 抛权限错误 */
export function checkFolderAccess(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    readdirSync(join(homedir(), 'Desktop'))
    return true
  } catch {
    return false
  }
}

/** 当前平台（渲染层：非 Mac 直接跳过权限幕） */
export function getPlatform(): NodeJS.Platform {
  return process.platform
}

/** 请求两个权限：
 *  文件夹访问——访问桌面目录，应用首次访问会触发系统授权弹窗；
 *  通知——发一条测试通知，首次发送会触发系统授权弹窗；再打开系统设置通知页兜底。
 *  返回请求后的文件夹访问检测结果 */
export function requestPermissions(): { folder: boolean } {
  checkFolderAccess()
  if (Notification.isSupported()) {
    new Notification({
      title: 'Reopen 通知测试',
      body: '看到这条通知，说明通知权限已开启'
    }).show()
  }
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications')
  }
  return { folder: checkFolderAccess() }
}
