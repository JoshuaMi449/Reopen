// 原生托盘统一入口（native/build/Release/reopen_native.node，macOS 专用）：
//   自建 NSStatusItem，图标=按钮上的 NSHostingView（SwiftUI 视图，libtray_runner.dylib，
//   照抄 BuZhiYin 机制）——三图标对比实验实锤：只有 SwiftUI 管线能获得系统
//   「非活跃屏冻结最后一帧」托管。换帧由 Swift 内部 .common Timer 驱动（BuZhiYin 同款），
//   JS 只传帧序列与换帧间隔（CPU 变速）。加载失败降级：全部 no-op（应用不崩，托盘功能缺失）。
let native: {
  createStatusItem(cb: (type: string, payload: string) => void): void
  initTrayRunner(dylibPath: string): void
  setFrames(pngs: Buffer[], isTemplate: boolean, intervalMs: number, box: boolean): void
  setInterval(intervalMs: number): void
  setInvert(light: boolean, dark: boolean): void
  getFrame(): { x: number; y: number; w: number; h: number }
  setPanelBehavior(handle: Buffer): void
  startGlobalClickMonitor(cb: (type: string, payload: string) => void): void
  stopGlobalClickMonitor(): void
  destroyStatusItem(): void
} | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require('../../native/build/Release/reopen_native.node')
} catch {
  native = null
}

export function nativeCreateStatusItem(cb: (type: string, payload: string) => void): void {
  try {
    native?.createStatusItem(cb)
  } catch {
    /* no-op */
  }
}

export function nativeInitTrayRunner(dylibPath: string): void {
  try {
    native?.initTrayRunner(dylibPath)
  } catch {
    /* no-op */
  }
}

export function nativeSetFrames(
  pngs: Buffer[],
  isTemplate: boolean,
  intervalMs: number,
  box: boolean
): void {
  try {
    native?.setFrames(pngs, isTemplate, intervalMs, box)
  } catch {
    /* no-op */
  }
}

export function nativeSetInterval(intervalMs: number): void {
  try {
    native?.setInterval(intervalMs)
  } catch {
    /* no-op */
  }
}

export function nativeSetInvert(light: boolean, dark: boolean): void {
  try {
    native?.setInvert(light, dark)
  } catch {
    /* no-op */
  }
}

export function nativeGetFrame(): { x: number; y: number; w: number; h: number } {
  try {
    return native?.getFrame() ?? { x: 0, y: 0, w: 0, h: 0 }
  } catch {
    return { x: 0, y: 0, w: 0, h: 0 }
  }
}

export function nativeSetPanelBehavior(handle: Buffer): void {
  try {
    native?.setPanelBehavior(handle)
  } catch {
    /* no-op */
  }
}

export function nativeStartGlobalClickMonitor(cb: (type: string, payload: string) => void): void {
  try {
    native?.startGlobalClickMonitor(cb)
  } catch {
    /* no-op */
  }
}

export function nativeStopGlobalClickMonitor(): void {
  try {
    native?.stopGlobalClickMonitor()
  } catch {
    /* no-op */
  }
}

export function nativeDestroyStatusItem(): void {
  try {
    native?.destroyStatusItem()
  } catch {
    /* no-op */
  }
}
