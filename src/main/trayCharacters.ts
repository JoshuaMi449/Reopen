// 托盘角色库：内置角色（resources/animations 下的 GIF）+ 用户导入素材（GIF/图片）。
// 设置页点预览图弹出角色列表选择（自带 + 拖入的，带预览和中文名）。
import { app, nativeImage } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { basename, extname, join } from 'path'
import { getSettings } from './store'

export interface TrayCharacter {
  key: string
  /** 显示名（内置=内置角色中文名；用户导入=文件名去后缀） */
  label: string
  /** 素材文件绝对路径 */
  path: string
  builtin: boolean
  /** 反转着色角色（黑色剪影素材）：深色菜单栏时反转成白（保留灰度细节，照不只因 colorInvert） */
  mono?: boolean
}

/** 内置角色的中文显示名 */
const LABELS: Record<string, string> = {
  '3body': '金凯瑞摇🤘',
  baby_circle: '可爱小圈圈😲',
  big_mouse_frog: '大嘴🐸',
  cat: '猫砸键盘🐱',
  cat2: '猫砸键盘盘😼',
  cat3: '猫猫摇爪😺',
  color_worm: '🌈🐛',
  dogeza: '日本人磕头',
  everonecat0: 'EveroneCat',
  gojo_satoru: '五条梧🥷',
  hoshiguma: '星熊警官🛡️',
  jerry: 'Jerry🐭',
  karby: '星之卡比',
  mongmong: 'mongmong🐰',
  my0: 'BenignX',
  pink_cat: '粉色猫猫🐱',
  xiaolan_turn: '小蓝转圈圈♿️',
  zhiyin: '只因铁山靠⛰️',
  zhiyin_basketball: '只因篮球🏀'
}

/** 反转着色角色（黑色剪影素材：深色菜单栏反转成白） */
const MONO_ROLES = new Set(['zhiyin', 'zhiyin_basketball', 'dogeza'])

/** 方框显示角色（与不只因同素材）：22×22pt 方框拉伸显示（照不只因 .frame(22,22)+.resizable()
 *  显示规格——非正方形素材拉满方框，只因篮球等与不只因菜单栏显示尺寸一致） */
const BOX_ROLES = new Set(['zhiyin', 'zhiyin_basketball'])

/** 是否方框显示角色（照不只因显示规格） */
export function isBoxRole(path: string): boolean {
  return BOX_ROLES.has(basename(path, extname(path)))
}

/** 不进入角色列表的内置 GIF（功能动画素材，不是角色） */
const EXCLUDED = new Set(['add_zhiyin.gif'])

/** 图片是否单色（每个像素 R=G=B；GIF 取第一帧）：单色素材转模板图，随菜单栏深浅自动变色 */
export function isMonoImage(path: string): boolean {
  try {
    const bitmap = nativeImage.createFromPath(path).toBitmap() // BGRA
    for (let i = 0; i < bitmap.length; i += 4) {
      if (bitmap[i] !== bitmap[i + 1] || bitmap[i + 1] !== bitmap[i + 2]) return false
    }
    return true
  } catch {
    return false
  }
}

/** 内置角色目录：dev=项目根 resources/animations；打包后 electron-builder 的 asarUnpack 保证实体文件可读 */
export function animationsDir(): string {
  return join(app.getAppPath(), 'resources', 'animations')
}

/** 全部可选角色：内置在前（文件名排序）、用户导入素材在后 */
export function listCharacters(): TrayCharacter[] {
  const list: TrayCharacter[] = []
  const dir = animationsDir()
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (!f.toLowerCase().endsWith('.gif') || EXCLUDED.has(f)) continue
      const name = f.replace(/\.gif$/i, '')
      list.push({
        key: `builtin:${f}`,
        label: LABELS[name] ?? name,
        path: join(dir, f),
        builtin: true,
        mono: MONO_ROLES.has(name)
      })
    }
  }
  const monoSet = new Set(getSettings().customTrayIconMono ?? [])
  for (const p of getSettings().customTrayIcons) {
    if (!existsSync(p)) continue
    list.push({
      key: `custom:${p}`,
      label: basename(p, extname(p)),
      path: p,
      builtin: false,
      mono: monoSet.has(p)
    })
  }
  return list
}
