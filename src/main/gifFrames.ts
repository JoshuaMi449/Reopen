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
    const frames = decompressFrames(parsed, true).slice(0, MAX_FRAMES)
    if (frames.length === 0) return null
    // 全画布：GIF 帧往往只覆盖局部（patch 是帧区域），透明像素保留旧画面
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
          if (patch[p + 3] === 0) continue
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
      if (f.disposalType === 2) canvas.fill(0) // 显示后清屏，下一帧画在空白上
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
