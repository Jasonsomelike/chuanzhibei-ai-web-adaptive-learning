"use client";

/**
 * 资料选择的持久化与订阅。
 *
 * 本文件只做三件事：JSON 序列化、localStorage 读写、React 订阅。
 * 数据形状与文本拼装全在 materials.ts（纯函数，可在 Node 里直接测）。
 *
 * 与 provider.ts 的刻意区别：保存失败必须把原因原样交回界面。
 * 供应商配置丢了大不了重填；笔记是用户敲进去的内容，静默吞错等于丢稿。
 */

import { useEffect, useMemo, useState } from "react";
import type { KnowledgeGraph } from "@/lib/graph";
import {
  MATERIALS_STORAGE_KEY,
  coerceMaterialsForSave,
  emptyMaterialsState,
  mergePacks,
  notesAsPack,
  normalizeSelection,
  parseMaterialsState,
  selectionForTarget,
  serializeMaterialsState,
  unresolvedConflicts,
  type MaterialConflict,
  type MaterialNote,
  type MaterialPack,
  type MaterialSelection,
  type MaterialsState,
} from "@/lib/materials";
import { getMaterialPack } from "@/data/materials";

/** 同标签页内保存成功后广播的事件；storage 事件只会在其它标签页触发。 */
export const MATERIALS_CHANGED_EVENT = "alp-materials-changed";

/** 只用到读取与写入，测试可以传一个假实现进来。 */
export interface MaterialStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SaveMaterialsResult =
  | { readonly ok: true; readonly state: MaterialsState }
  | { readonly ok: false; readonly error: string };

function defaultStorage(): MaterialStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // 隐私模式或策略禁用了本地存储，按「没有存储」处理
    return null;
  }
}

function readMaterials(storage: MaterialStorage | null): {
  readonly state: MaterialsState;
  readonly error: string | null;
} {
  if (!storage) return { state: emptyMaterialsState(), error: null };
  try {
    return { state: parseMaterialsState(storage.getItem(MATERIALS_STORAGE_KEY)), error: null };
  } catch (err) {
    return {
      state: emptyMaterialsState(),
      error: `读取本地资料失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function loadMaterials(storage?: MaterialStorage): MaterialsState {
  return readMaterials(storage ?? defaultStorage()).state;
}

/**
 * 保存。先跑 coerce，失败原样返回；写入异常也返回错误，不吞。
 *
 * 顺序有意为之：超长检查不需要存储可用，先报「哪条笔记超了」比
 * 报「浏览器不允许存储」更接近用户当下要解决的问题。
 */
export function saveMaterials(
  state: MaterialsState,
  storage?: MaterialStorage,
): SaveMaterialsResult {
  const checked = coerceMaterialsForSave(state);
  if (!checked.ok) return { ok: false, error: checked.error };

  const store = storage ?? defaultStorage();
  if (!store) {
    return { ok: false, error: "当前环境无法访问本地存储，资料未保存" };
  }

  try {
    store.setItem(MATERIALS_STORAGE_KEY, serializeMaterialsState(checked.state));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `保存失败：本地存储写入出错（可能已满）：${reason}` };
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MATERIALS_CHANGED_EVENT));
  }
  return { ok: true, state: checked.state };
}

/**
 * 订阅资料变化。
 *
 * 两个来源都要听：storage 事件只在其它标签页触发，同一标签页里保存后
 * 必须靠自定义事件通知，否则「保存了但界面没变」会反复出现。
 */
export function subscribeMaterials(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const onStorage = (event: StorageEvent): void => {
    // key 为 null 表示整份存储被清空
    if (event.key === MATERIALS_STORAGE_KEY || event.key === null) listener();
  };
  const onLocal = (): void => listener();

  window.addEventListener("storage", onStorage);
  window.addEventListener(MATERIALS_CHANGED_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MATERIALS_CHANGED_EVENT, onLocal);
  };
}

export interface UseMaterialPackResult {
  /** 内置资料 + 当前全部笔记（笔记作为「我的笔记」讲义并入）。 */
  readonly pack: MaterialPack;
  readonly selection: MaterialSelection;
  readonly unresolved: readonly MaterialConflict[];
  readonly notes: readonly MaterialNote[];
  readonly error: string | null;
}

/**
 * 读取某个目标的资料选择。
 *
 * 首屏用空状态渲染再在 effect 里读存储：服务端渲染没有 localStorage，
 * 直接在 render 里读会造成 hydration 不一致。因此没有浏览器环境时
 * 返回的是可用的默认值（内置包 + 默认选中内置来源），不是 null。
 *
 * graph 用于让笔记继承知识点章节；自定义方向应把自己的图传进来。
 */
export function useMaterialPack(targetId: string, graph?: KnowledgeGraph): UseMaterialPackResult {
  const [state, setState] = useState<MaterialsState>(emptyMaterialsState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const read = (): void => {
      const result = readMaterials(defaultStorage());
      setState(result.state);
      setError(result.error);
    };
    read();
    return subscribeMaterials(read);
  }, []);

  /*
   * 默认口径只看内置包：内置学科首次进入就选中内置教材，
   * 自定义方向没有内置资料（emptyPack），默认仍是「模型通用知识」。
   * 笔记是用户另外选用的来源，不能在自定义方向里被默认勾上。
   */
  const builtin = useMemo(() => getMaterialPack(targetId), [targetId]);

  const pack = useMemo(() => {
    if (state.notes.length === 0) return builtin;
    return mergePacks([builtin, notesAsPack(state.notes, graph)]);
  }, [builtin, state.notes, graph]);

  /*
   * 有存档用存档（含显式保存的空选择），没有才落默认口径；
   * 规范化放在合并后的 pack 上，避免把显式选中的「我的笔记」当成未知来源丢掉。
   */
  const selection = useMemo(
    () => normalizeSelection(selectionForTarget(state.targets[targetId], builtin), pack),
    [state.targets, targetId, builtin, pack],
  );

  const unresolved = useMemo(() => unresolvedConflicts(pack, selection), [pack, selection]);

  return { pack, selection, unresolved, notes: state.notes, error };
}
