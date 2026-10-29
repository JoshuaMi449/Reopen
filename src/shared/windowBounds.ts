// 窗口位置记忆的合法性校验。
// 记忆本身很简单，坑在后面：外接屏拔掉、分辨率变小时，保存的坐标会落在不存在的屏幕上，
// 窗口恢复后打不开 —— 用户会当成 app 崩了。这里把所有回落规则集中成一个可单测的纯函数。

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayArea {
  bounds: Bounds
  workArea: Bounds
}

/** 保存的位置还能不能用：能就和最小尺寸/所在屏幕夹一下，不能就回落到 fallback。 */
export function clampWindowBounds(
  saved: Bounds | undefined,
  displays: DisplayArea[],
  min: { width: number; height: number },
  fallback: Bounds
): Bounds {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return fallback
  const cx = saved.x + saved.width / 2
  const cy = saved.y + saved.height / 2
  const host = displays.find(
    (d) =>
      cx >= d.workArea.x &&
      cx <= d.workArea.x + d.workArea.width &&
      cy >= d.workArea.y &&
      cy <= d.workArea.y + d.workArea.height
  )
  if (!host) return fallback
  const width = Math.min(Math.max(saved.width, min.width), host.workArea.width)
  const height = Math.min(Math.max(saved.height, min.height), host.workArea.height)
  return {
    x: Math.min(Math.max(saved.x, host.workArea.x), host.workArea.x + host.workArea.width - width),
    y: Math.min(Math.max(saved.y, host.workArea.y), host.workArea.y + host.workArea.height - height),
    width,
    height
  }
}
