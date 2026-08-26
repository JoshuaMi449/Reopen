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

/** 最近邻缩小：动图原尺寸可能上千像素，先缩到 TARGET 再编码 PNG，省内存省 CPU */
function downscale(
  src: Uint8ClampedArray,
  W: number,
  H: number,
  tw: number,
  th: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const sy = Math.min(Math.floor((y * H) / th), H - 1)
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(Math.floor((x * W) / tw), W - 1)
      const s = (sy * W + sx) * 4
      const d = (y * tw + x) * 4
      out[d] = src[s]
      out[d + 1] = src[s + 1]
      out[d + 2] = src[s + 2]
      out[d + 3] = src[s + 3]
    }
  }
  return out
}

/** 把 gif 解码成帧序列（每帧合成到完整画布 → PNG → nativeImage，统一缩到 size px）。
 *  opts.mono=转模板图（随菜单栏深浅自动变色）。
 *  解析失败 / 只有一帧 → 返回 null（调用方退回静态图） */
export function loadGifFrames(
  path: string,
  size = 18,
  opts: { mono?: boolean } = {}
): GifFrame[] | null {
  // 缓存 key 含尺寸/单色：设置变化后必须重新解码，不能命中旧帧
  const key = `${path}:${size}${opts.mono ? ':t' : ''}`
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
      const small = downscale(canvas, W, H, target, target)
      const frame = new PNG({ width: target, height: target })
      frame.data = Buffer.from(small.buffer)
      const png = PNG.sync.write(frame)
      const img = nativeImage.createFromBuffer(png).resize({ width: size, height: size })
      if (opts.mono) img.setTemplateImage(true)
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
