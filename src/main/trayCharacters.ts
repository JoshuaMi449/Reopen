// 托盘角色库：内置角色（resources/animations 下的 GIF）+ 用户导入素材（GIF/图片）。
// 设置页点预览图弹出角色列表选择（自带 + 拖入的，带预览和中文名）。
import { app } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { basename, extname, join } from 'path'
import { getSettings } from './store'

export interface TrayCharacter {
  key: string
  /** 显示名（内置=中文名；用户导入=文件名去后缀） */
  label: string
  /** 素材文件绝对路径 */
  path: string
  builtin: boolean
}

/** 内置角色的中文显示名（用户拍板的名字表） */
const LABELS: Record<string, string> = {
  '3body': '三体',
  add_zhiyin: '加只因',
  baby_circle: '宝宝圈',
  big_mouse_frog: '大老鼠蛙',
  cat: '猫',
  cat2: '猫2',
  cat3: '猫3',
  color_worm: '彩虫',
  everonecat0: '万人猫',
  gojo_satoru: '五条悟',
  hoshiguma: '星熊',
  jerry: '杰瑞',
  karby: '卡比',
  mongmong: '蒙蒙',
  my0: '我的0',
  pink_cat: '粉猫',
  xiaolan_turn: '小蓝转',
  zhiyin: '只因',
  zhiyin_basketball: '只因篮球'
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
      if (!f.toLowerCase().endsWith('.gif')) continue
      const name = f.replace(/\.gif$/i, '')
      list.push({
        key: `builtin:${f}`,
        label: LABELS[name] ?? name,
        path: join(dir, f),
        builtin: true
      })
    }
  }
  for (const p of getSettings().customTrayIcons) {
    if (!existsSync(p)) continue
    list.push({
      key: `custom:${p}`,
      label: basename(p, extname(p)),
      path: p,
      builtin: false
    })
  }
  return list
}
