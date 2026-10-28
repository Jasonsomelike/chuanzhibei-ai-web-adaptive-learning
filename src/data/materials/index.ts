/**
 * 内置资料包注册表。
 *
 * 按目标 id 取包：内置学科直接用学科 id；自定义方向没有内置资料，
 * 返回一个空包而不是抛错——路径页会照常显示「未内置教材」，
 * 笔记仍然可以挂上去。新增学科资料只需在这里加一条。
 */

import type { MaterialPack } from "@/lib/materials";
import { emptyPack } from "@/lib/materials";
import { dataStructuresMaterialPack } from "./data-structures";
import { networkMaterialPack } from "./network";

export const MATERIAL_PACKS: readonly MaterialPack[] = [
  dataStructuresMaterialPack,
  networkMaterialPack,
];

/** 取某目标的资料包；没有内置资料时返回空包（不是 null，调用方不必分支）。 */
export function getMaterialPack(targetId: string): MaterialPack {
  return MATERIAL_PACKS.find((pack) => pack.id === targetId) ?? emptyPack(targetId, "未内置资料");
}
