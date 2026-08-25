// 偏好设置：主窗口内的浮层界面（浮层交互）// 不是独立窗口——固定显示在主界面之上、不可拖动，右上角叉或点击主界面（遮罩）关闭；
// 渲染层 App.tsx 挂 settings-overlay，主进程只负责"唤起主窗口+发开关事件"
import { getMainWindow, showMainWindow } from './window'

/** 打开偏好设置：唤起主窗口并通知渲染层弹出设置浮层 */
export function openSettingsWindow(): void {
  showMainWindow('settings-open')
}

/** 关闭偏好设置：通知主窗口渲染层收起浮层 */
export function closeSettingsWindow(): void {
  getMainWindow()?.webContents.send('app:menu-action', 'settings-close')
}
