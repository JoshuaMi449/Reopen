// 项目在「顶层 ↔ 文件夹内」移动时，连带要更新的设置清单。
// 组内项目不能置顶（置顶只认顶层），也不参与顶层手动排序 —— 进组时把这两处残留清掉。

export interface ParentChangeState {
  pinnedIds: string[]
  manualOrder: string[]
  autoStartIds: string[]
}

/** targetParent 有值 = 移入文件夹；undefined = 移出到顶层。
 *  移出时不恢复置顶（进组时已清掉，自动恢复会让用户意外）；自启项两个方向都保留，
 *  因为开机自启是独立机制，和「显不显示在顶层列表」无关。 */
export function applyParentChange(
  ids: string[],
  targetParent: string | undefined,
  state: ParentChangeState
): ParentChangeState {
  if (!targetParent || ids.length === 0) return state
  const moving = new Set(ids)
  return {
    pinnedIds: state.pinnedIds.filter((id) => !moving.has(id)),
    manualOrder: state.manualOrder.filter((id) => !moving.has(id)),
    autoStartIds: state.autoStartIds
  }
}
