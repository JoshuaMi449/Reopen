// 系统权限：新手引导第 5 步之后的权限幕用。
// 只剩通知一项：
//   通知——没有 API 能查授权状态：发一条测试通知触发系统授权弹窗，用户看到通知=已开启。
//   文件夹访问（桌面/文稿/下载）不引导：拖拽进窗口与系统面板选择本身即授权，系统弹窗自然出现
//   （2026-09-01 拍板砍掉权限检测幕，与主流 Mac 软件行为一致）。
// 授权弹窗都是 macOS 系统统一模板，应用只能触发、不能自绘。
import { Notification, shell } from 'electron'

/** 当前平台（渲染层：非 Mac 直接跳过权限幕） */
export function getPlatform(): NodeJS.Platform {
  return process.platform
}

/** 请求通知权限：发一条测试通知，首次发送会触发系统授权弹窗；再打开系统设置通知页兜底。 */
export function requestPermissions(): void {
  if (Notification.isSupported()) {
    new Notification({
      title: 'Reopen 通知测试',
      body: '看到这条通知，说明通知权限已开启'
    }).show()
  }
  if (process.platform === 'darwin') {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.notifications')
  }
}
