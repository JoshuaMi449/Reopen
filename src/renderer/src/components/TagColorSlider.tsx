import { useState } from 'react'

interface Props {
  /** 8 色色板 */
  colors: string[]
  /** 当前染色（无=默认无色） */
  current?: string
  /** 提交颜色；传 null 表示清除染色 */
  onPick(color: string | null): void
}

/**
 * 标签染色滑块（2026-08-21 拍板，嵌在右键菜单里）：
 * 渐变色板条（最左灰段=无色）+ 可拖动刻度线，拖动实时预览、松手提交；无色按钮一键清除。
 * 每次菜单重新打开组件重挂载，初始位置即最新染色，无需同步 effect。
 */
export function TagColorSlider({ colors, current, onPick }: Props): React.JSX.Element {
  // 0 = 无色，1..colors.length = 对应颜色
  const [preview, setPreview] = useState(() => (current ? colors.indexOf(current) + 1 : 0))

  const commit = (v: number): void => {
    if (v <= 0) onPick(null)
    else onPick(colors[v - 1])
  }

  const curColor = preview > 0 ? colors[preview - 1] : undefined

  return (
    <div className="tag-color-slider-row">
      <input
        className="tag-color-slider"
        type="range"
        min={0}
        max={colors.length}
        step={1}
        value={preview}
        style={{ '--cur': curColor ?? '#9e9e9e' } as React.CSSProperties}
        // 拖动过程只更新预览（React 的 onChange=持续 input），松手/键盘松开才真正提交，避免频繁写盘
        onChange={(e) => setPreview(Number(e.target.value))}
        onPointerUp={() => commit(preview)}
        onKeyUp={() => commit(preview)}
      />
      <button
        type="button"
        className={`tag-color-none ${current ? '' : 'tag-color-none-off'}`}
        title="无颜色"
        onClick={() => {
          setPreview(0)
          onPick(null)
        }}
      >
        无色
      </button>
    </div>
  )
}
