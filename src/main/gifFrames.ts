// GIF 帧解析：菜单栏图标动图支持。
// 系统菜单栏只收静态图（nativeImage 对 GIF 只取第一帧），动画靠"解码成帧序列 + 定时换图"模拟。
import { readFileSync } from 'fs'
import { nativeImage, type NativeImage } from 'electron'
import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js'
import { PNG } from 'pngjs'

export interface GifFrame {
  image: NativeImage
  /** 该帧停留时长（ms，GIF 自带，最慢按 100ms 计） */
  delay: number
}

/** 帧数上限：菜单栏图标很小，帧数多了没意义还费内存 */
const MAX_FRAMES = 60
const cache = new Map<string, GifFrame[]>()

/** 面积平均缩小（box filter，照系统原生高质量缩放原理——不只因/RunCat 清晰度的关键）：
 *  每个目标像素对应源区域 [x·W/tw,(x+1)·W/tw) × [y·H/th,(y+1)·H/th)，区域内全部源像素
 *  （premultiplied 域）按覆盖面积加权平均——4 倍缩小时 16 像素合成 1 个，细线密度保留；
 *  双线性只取 2×2 邻域，大幅缩小会丢细节（只因篮球 180×210→44 糊的根因）。
 *  默认等比缩放：高度=target、宽度随原比例；box=正方形拉伸缩放（照不只因
 *  .frame(22,22)+.resizable() 显示规格：非正方形素材拉满方框）。
 *  alpha 预乘域运算防透明渗色；unpremultiply：v 与 a 同处 0~255 域，结果 ×255/a（漏乘=全黑） */
function downscale(
  src: Uint8ClampedArray,
  W: number,
  H: number,
  target: number,
  box = false
): { data: Uint8ClampedArray; w: number; h: number } {
  // 缩放尺寸：默认高度=target、宽度按原比例；box=target×target 方框（拉伸）
  const scale = target / H
  const tw = box ? target : Math.max(1, Math.round(W * scale))
  const th = box ? target : Math.max(1, Math.round(H * scale))
  // 转 premultiplied（RGB×alpha）
  const pm = new Float32Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    const a = src[i * 4 + 3] / 255
    pm[i * 4] = src[i * 4] * a
    pm[i * 4 + 1] = src[i * 4 + 1] * a
    pm[i * 4 + 2] = src[i * 4 + 2] * a
    pm[i * 4 + 3] = src[i * 4 + 3]
  }
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const sy0 = (y * H) / th
    const sy1 = ((y + 1) * H) / th
    for (let x = 0; x < tw; x++) {
      const sx0 = (x * W) / tw
      const sx1 = ((x + 1) * W) / tw
      // 累加覆盖的源像素：权重=行重叠×列重叠（边缘像素按部分面积计）
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let weight = 0
      const yStart = Math.max(0, Math.floor(sy0))
      const yEnd = Math.min(H, Math.ceil(sy1))
      const xStart = Math.max(0, Math.floor(sx0))
      const xEnd = Math.min(W, Math.ceil(sx1))
      for (let sy = yStart; sy < yEnd; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        for (let sx = xStart; sx < xEnd; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0)
          const w = wx * wy
          const i = (sy * W + sx) * 4
          r += pm[i] * w
          g += pm[i + 1] * w
          b += pm[i + 2] * w
          a += pm[i + 3] * w
          weight += w
        }
      }
      const d = (y * tw + x) * 4
      if (weight <= 0) continue // 无覆盖：全透明，RGB 置 0
      const inv = 1 / weight
      const aa = a * inv
      out[d + 3] = Math.round(aa)
      if (aa < 1) continue
      out[d] = Math.min(255, Math.round((r * inv * 255) / aa)) // unpremultiply：×255/a
      out[d + 1] = Math.min(255, Math.round((g * inv * 255) / aa))
      out[d + 2] = Math.min(255, Math.round((b * inv * 255) / aa))
    }
  }
  return { data: out, w: tw, h: th }
}

/** 把 gif 解码成帧序列（每帧合成到完整画布 → PNG → nativeImage，统一缩到 size px）。
 *  原图直传（2026-08-28 定稿）：帧保持素材原样 RGB+alpha，剪影角色颜色反转由 Swift 侧
 *  colorInvert 按菜单栏外观处理（不再做模板图编码——模板图把亮度折进 alpha 导致球身发虚、
 *  非活跃时只剩白边）。解析失败 / 只有一帧 → 返回 null（调用方退回静态图） */
export function loadGifFrames(
  path: string,
  size = 18,
  opts: { box?: boolean } = {}
): GifFrame[] | null {
  // 缓存 key 含尺寸/方框：设置变化后必须重新解码，不能命中旧帧
  const key = `${path}:${size}${opts.box ? ':b' : ''}`
  const hit = cache.get(key)
  if (hit) return hit
  // 编码前先缩到 2x（高清屏），上限 44 防大图标白费内存
  const target = Math.min(size * 2, 44)
  try {
    const buf = readFileSync(path)
    if (buf.length === 0) return null
    const parsed = parseGIF(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const W = parsed.lsd.width
    const H = parsed.lsd.height
    if (W === 0 || H === 0) return null
    // gifuct-js 把 GCE 块与 image 块拆成独立元素（NETSCAPE 扩展还会把帧 0 的 GCE 吸走），
    // decompressFrames 输出的帧可能丢 transparentIndex/disposal/delay（丢透明索引=整帧黑底）。
    // 按 GIF 规范配对：每个 image 帧取「前面最近的 GCE」（注释/循环扩展等非渲染块不打断配对）
    type GceInfo = {
      disposal: number
      transparentColorGiven: boolean
      transparentColorIndex: number
      delay: number
    }
    const gceByFrame: (GceInfo | undefined)[] = []
    let pendingGce: GceInfo | undefined
    for (const el of parsed.frames) {
      if ('gce' in el && el.gce) {
        pendingGce = {
          disposal: el.gce.extras.disposal,
          transparentColorGiven: el.gce.extras.transparentColorGiven,
          transparentColorIndex: el.gce.transparentColorIndex,
          delay: el.gce.delay
        }
      }
      if ('image' in el && el.image) gceByFrame.push(pendingGce)
    }
    const frames = decompressFrames(parsed, true).slice(0, MAX_FRAMES)
    if (frames.length === 0) return null
    // 补回丢失的 GCE 信息（透明索引/disposal/帧时长）
    frames.forEach((raw, i) => {
      const f = raw as ParsedFrame
      const gce = gceByFrame[i]
      if (!gce) return
      f.disposalType = gce.disposal
      if (gce.transparentColorGiven) {
        f.transparentIndex = gce.transparentColorIndex
        // patch 是补丁前生成的（透明索引丢失时=全不透明黑底），按新透明索引重建：
        // 像素索引经调色板转 RGBA，透明索引像素 alpha=0
        const totalPixels = f.pixels.length
        const patchData = new Uint8ClampedArray(totalPixels * 4)
        for (let j = 0; j < totalPixels; j++) {
          const pos = j * 4
          const colorIndex = f.pixels[j]
          const color = f.colorTable[colorIndex] || [0, 0, 0]
          patchData[pos] = color[0]
          patchData[pos + 1] = color[1]
          patchData[pos + 2] = color[2]
          patchData[pos + 3] = colorIndex !== f.transparentIndex ? 255 : 0
        }
        f.patch = patchData
      }
      if (f.delay === undefined) f.delay = (gce.delay || 10) * 10
    })
    // 全画布：按 GIF 标准语义合成——画布跨帧保留（局部帧依赖上一帧在画布上的残留），
    // 每帧输出=当前画布快照（完整合成帧，参考实现 CGImageSourceCreateImageAtIndex 同款）。
    // 透明像素（帧的透明索引）不修改画布；disposal 只影响下一帧：
    //   2=帧区域清屏、3=恢复上一帧前画布。帧外（逻辑画布外）始终透明。
    // 两种错误对照：每帧清空重画=残留丢失闪黑；不做 disposal 清屏=全黑残留
    const canvas = new Uint8ClampedArray(W * H * 4)
    const result: GifFrame[] = []
    for (const raw of frames) {
      const f = raw as ParsedFrame
      const prev = f.disposalType === 3 ? canvas.slice() : null // disposal 3=显示后恢复上一帧
      const { width, height, top, left } = f.dims
      const patch = f.patch
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const p = (y * width + x) * 4
          if (patch[p + 3] === 0) continue // 透明像素：保留画布原值
          const c = ((top + y) * W + left + x) * 4
          canvas[c] = patch[p]
          canvas[c + 1] = patch[p + 1]
          canvas[c + 2] = patch[p + 2]
          canvas[c + 3] = patch[p + 3]
        }
      }
      const { data: small, w: fw, h: fh } = downscale(canvas, W, H, target, opts.box)
      const frame = new PNG({ width: fw, height: fh })
      frame.data = Buffer.from(small.buffer)
      const png = PNG.sync.write(frame)
      // target=size×2 的像素按 2x 解码 = size pt 高清显示（Retina 屏不糊；
      // 之前按 1x 解码再 resize 放大，像素被拉扯=马赛克）
      const img = nativeImage.createFromBuffer(png, { scaleFactor: 2 })
      result.push({
        image: img,
        delay: Math.max(f.delay || 100, 100)
      })
      // disposal 影响下一帧前的画布状态：
      //  2=帧区域清屏——规范：帧有透明索引 → 清成透明；没有 → 铺 GIF 背景色（不透明）
      if (f.disposalType === 2) {
        const bgColor =
          f.transparentIndex === undefined
            ? (parsed.gct[parsed.lsd.backgroundColorIndex] ?? null)
            : null
        const [r, g, b, a] = bgColor ? [bgColor[0], bgColor[1], bgColor[2], 255] : [0, 0, 0, 0]
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const c = ((top + y) * W + left + x) * 4
            canvas[c] = r
            canvas[c + 1] = g
            canvas[c + 2] = b
            canvas[c + 3] = a
          }
        }
      }
      if (prev) canvas.set(prev)
    }
    if (result.length === 0) return null
    cache.set(key, result)
    return result
  } catch {
    return null
  }
}

/** 换图后清缓存（同路径覆盖换文件时，旧帧序列作废） */
export function invalidateGifCache(): void {
  cache.clear()
}
