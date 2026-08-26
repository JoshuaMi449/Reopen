// 托盘角色库：内置角色（resources/animations 下的 GIF）+ 用户导入素材（GIF/图片）。
// 设置页点预览图弹出角色列表选择（自带 + 拖入的，带预览和中文名）。
import { app } from 'electron'
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
  /** 模板角色：转模板图随菜单栏深浅自动变色（素材本身是模板图） */
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

/** 模板素材角色（菜单栏随深浅自动变色） */
const MONO_ROLES = new Set(['zhiyin', 'zhiyin_basketball', 'dogeza'])

/** 不进入角色列表的内置 GIF（功能动画素材，不是角色） */
const EXCLUDED = new Set(['add_zhiyin.gif'])

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
