// CPU 使用率采样：os.cpus() 两次采样差分（RunCat 的 host_statistics tick 差分的 Node 等价物）。
// 用途：菜单栏动图「随 CPU 变速」——CPU 忙动画跑得快、空闲跑得慢（不只因/RunCat 同款玩法）。
import { cpus } from 'os'

/** 采样间隔：低于此窗口直接返回缓存，避免每帧都算（帧间隔几十 ms，算一次 CPU 不划算） */
const INTERVAL = 2000
let cached = 0
let lastTotal = 0
let lastIdle = 0
let lastSampleAt = 0

/** 当前 CPU 使用率 0~1（忙=1 空闲=0；首次调用返回 0，两秒后才出真值） */
export function getCpuUsage(): number {
  const now = Date.now()
  if (lastSampleAt > 0 && now - lastSampleAt < INTERVAL) return cached
  lastSampleAt = now
  let total = 0
  let idle = 0
  for (const core of cpus()) {
    total += core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq
    idle += core.times.idle
  }
  if (lastTotal > 0) {
    const totalDiff = total - lastTotal
    const idleDiff = idle - lastIdle
    if (totalDiff > 0) cached = Math.min(1, Math.max(0, 1 - idleDiff / totalDiff))
  }
  lastTotal = total
  lastIdle = idle
  return cached
}
