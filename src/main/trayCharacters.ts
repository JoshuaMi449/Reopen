// 托盘角色库：内置角色（resources/animations 下的 GIF，来自不只因素材库）+ 用户导入素材。
// 点托盘图标弹出下拉菜单选角色（不只因同款交互）。
import { app } from 'electron'
import { existsSync, readdirSync } from 'fs'
import { basename, extname, join } from 'path'
import { getSettings } from './store'

export interface TrayCharacter {
  key: string
  /** 菜单显示名（文件名去后缀） */
  label: string
  /** 素材文件绝对路径 */
  path: string
  builtin: boolean
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
      list.push({
        key: `builtin:${f}`,
        label: f.replace(/\.gif$/i, ''),
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
