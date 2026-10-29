// 全局快捷键的注册计划。
// 现在的写法是「先 unregisterAll 再逐个 register，失败静默吃掉」—— 一旦新键被别的软件占用，
// 用户不但没设上新的，连原来的 ⌥+R 也一起丢了，且完全无感知。
// 这里把「全部成功才生效」抽成纯函数，注册器由调用方注入，方便单测。

export interface ShortcutRegistry {
  register(accelerator: string): boolean
  unregisterAll(): void
}

/** 尝试注册 desired；任一失败即整体回滚到 previous，并返回失败的组合。
 *  desired 里重复的组合只注册一次（主快捷键和项目快捷启动可能撞车，重复注册会误报失败）。 */
export function registerWithRollback(
  desired: string[],
  previous: string[],
  reg: ShortcutRegistry
): string[] {
  const unique = [...new Set(desired.filter(Boolean))]
  reg.unregisterAll()
  const failed: string[] = []
  for (const acc of unique) {
    if (!reg.register(acc)) failed.push(acc)
  }
  if (failed.length > 0) {
    reg.unregisterAll()
    for (const acc of previous) if (acc) reg.register(acc)
  }
  return failed
}
