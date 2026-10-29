/**
 * 手动改写路径的持久化。
 *
 * 只存「顺序 + 被移除集合」（与 plan.ts 的 ManualEdit 同形），不存整份 steps：
 * 预算或章节范围变化后算法会给出新的步骤集合，显示顺序由 applyManualOrder 重放，
 * 手动调整过的相对次序保留，新装不下的点自动消失（见 app/path/page.tsx）。
 *
 * 按 targetId 分条存，一个目标的存档坏掉不影响其它目标。
 * 存储是不可信输入：JSON 解析失败、版本号不符、字段形状不对一律返回 null——
 * 界面回落算法顺序，而不是把半截顺序带进路径计算。
 */

import type { ManualEdit } from "@/lib/plan";

/** localStorage 键。一个键里按目标 id 分条，清理时只需 removeItem 一次。 */
export const MANUAL_PATH_STORAGE_KEY = "alp.path.manual.v1";

/**
 * 存档格式版本。字段语义变化时递增；读取时版本不符一律当作「没有存档」，
 * 不做迁移——手动顺序是可以重做的低成本数据，宁可回到算法序也不猜旧格式。
 */
export const MANUAL_PATH_VERSION = 1;

/**
 * 只依赖 getItem / setItem，测试可注入内存实现。
 * 浏览器里默认取 window.localStorage；隐私模式下访问它本身也可能抛错。
 */
export interface ManualPathStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredManualPath {
  readonly version: number;
  readonly order: readonly string[];
  readonly removed: readonly string[];
}

type ManualPathStore = Record<string, StoredManualPath>;

function browserStorage(): ManualPathStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 校验一个 id 列表。任何一项不是非空字符串就整份判坏：
 * 静默过滤掉坏项会让「order 里少了谁」与「order 本来就短」无法区分。
 */
function idList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") return null;
    ids.push(entry);
  }
  return ids;
}

/** 把一条存档记录转成 ManualEdit；版本不符 / 形状不对 / 空编辑都返回 null。 */
function toManualEdit(raw: unknown): ManualEdit | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== MANUAL_PATH_VERSION) return null;

  const order = idList(raw.order);
  const removed = idList(raw.removed);
  if (order === null || removed === null) return null;
  // 空编辑等价于「没有手动改写」，不必在界面上显示「已手动修改」
  if (order.length === 0 && removed.length === 0) return null;

  return { order, removed };
}

/** 读整个存储。整份 JSON 坏掉时返回 null（写回时会重建，顺带修好坏文件）。 */
function readStore(storage: ManualPathStorage): ManualPathStore | null {
  let raw: string | null;
  try {
    raw = storage.getItem(MANUAL_PATH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as ManualPathStore) : null;
  } catch {
    return null;
  }
}

/**
 * 读取某个目标的手动改写；没有存档、存档损坏或版本不符时返回 null。
 */
export function readManualPath(
  targetId: string,
  storage: ManualPathStorage | null = browserStorage(),
): ManualEdit | null {
  if (storage === null || targetId === "") return null;
  const store = readStore(storage);
  if (store === null) return null;
  return toManualEdit(store[targetId]);
}

/**
 * 写入（或清除）某个目标的手动改写。
 *
 * edit 为 null 或空编辑时删掉该目标的条目——「恢复算法排序」必须真的清掉存档，
 * 否则刷新后旧顺序会自己回来，等于没恢复。
 * 其它目标的条目原样保留；整份存储原本就是坏的，则用只含本条的新对象覆盖。
 */
export function writeManualPath(
  targetId: string,
  edit: ManualEdit | null,
  storage: ManualPathStorage | null = browserStorage(),
): void {
  if (storage === null || targetId === "") return;

  const store = readStore(storage) ?? {};
  const entries = Object.entries(store).filter(([id]) => id !== targetId);
  if (edit !== null && (edit.order.length > 0 || edit.removed.length > 0)) {
    entries.push([
      targetId,
      {
        version: MANUAL_PATH_VERSION,
        order: [...edit.order],
        removed: [...edit.removed],
      },
    ]);
  }

  try {
    // Object.fromEntries 用数据属性写入，targetId 即使是 "__proto__" 也不会改原型
    storage.setItem(MANUAL_PATH_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 隐私模式或配额满：存不进去不影响当前会话，刷新后回落到算法顺序
  }
}
