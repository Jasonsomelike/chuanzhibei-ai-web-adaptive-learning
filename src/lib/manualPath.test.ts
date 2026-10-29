import { describe, it, expect } from "vitest";
import {
  MANUAL_PATH_STORAGE_KEY,
  MANUAL_PATH_VERSION,
  readManualPath,
  writeManualPath,
  type ManualPathStorage,
} from "@/lib/manualPath";

/*
 * 手动改写路径的持久化：按 targetId 存 {version, order, removed}。
 * 这里是纯存储层测试，不依赖浏览器——storage 注入内存实现。
 */

interface TestStorage extends ManualPathStorage {
  readonly data: Map<string, string>;
}

function testStorage(initial?: string): TestStorage {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(MANUAL_PATH_STORAGE_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const EDIT_A = { order: ["c03", "c01", "c02"], removed: ["c04"] };
const EDIT_B = { order: ["n2", "n1"], removed: [] };

describe("手动改写路径的存档", () => {
  it("写入后读回同一份 order / removed（往返）", () => {
    const storage = testStorage();
    writeManualPath("data-structures", EDIT_A, storage);

    expect(readManualPath("data-structures", storage)).toEqual({
      order: ["c03", "c01", "c02"],
      removed: ["c04"],
    });
    // 存档里带版本号，便于以后整体弃用旧格式
    const raw = JSON.parse(storage.data.get(MANUAL_PATH_STORAGE_KEY)!) as Record<
      string,
      { version: number }
    >;
    expect(raw["data-structures"].version).toBe(MANUAL_PATH_VERSION);
  });

  it("按目标隔离：写 A 不影响 B，清空 A 不影响 B", () => {
    const storage = testStorage();
    writeManualPath("data-structures", EDIT_A, storage);
    writeManualPath("network", EDIT_B, storage);

    expect(readManualPath("data-structures", storage)).toEqual(EDIT_A);
    expect(readManualPath("network", storage)).toEqual(EDIT_B);
    expect(readManualPath("os", storage)).toBeNull();

    // 恢复算法排序 = 写 null：只删当前目标那一条
    writeManualPath("data-structures", null, storage);
    expect(readManualPath("data-structures", storage)).toBeNull();
    expect(readManualPath("network", storage)).toEqual(EDIT_B);
  });

  it("空编辑不落盘，读回 null", () => {
    const storage = testStorage();
    writeManualPath("data-structures", { order: [], removed: [] }, storage);
    expect(readManualPath("data-structures", storage)).toBeNull();
  });

  it("坏 JSON 回退 null，且下一次写入会修好整份存储", () => {
    const storage = testStorage("{not json");
    expect(readManualPath("data-structures", storage)).toBeNull();

    writeManualPath("data-structures", EDIT_A, storage);
    expect(readManualPath("data-structures", storage)).toEqual(EDIT_A);
  });

  it("版本号不符回退 null，其它目标的合法条目照常读取", () => {
    const storage = testStorage(
      JSON.stringify({
        legacy: { version: MANUAL_PATH_VERSION - 1, order: ["c02", "c01"], removed: [] },
        fresh: { version: MANUAL_PATH_VERSION, order: ["c05"], removed: ["c06"] },
      }),
    );

    expect(readManualPath("legacy", storage)).toBeNull();
    expect(readManualPath("fresh", storage)).toEqual({ order: ["c05"], removed: ["c06"] });
  });

  it("字段形状不对回退 null", () => {
    const broken = [
      { version: MANUAL_PATH_VERSION, order: "c01", removed: [] },
      { version: MANUAL_PATH_VERSION, order: ["c01"], removed: null },
      { version: MANUAL_PATH_VERSION, order: ["c01", 2], removed: [] },
      { version: MANUAL_PATH_VERSION, order: ["c01"], removed: [""] },
      { version: MANUAL_PATH_VERSION, order: ["c01"] },
      [],
      "nope",
    ];

    for (const entry of broken) {
      const storage = testStorage(JSON.stringify({ target: entry }));
      expect(readManualPath("target", storage)).toBeNull();
    }
  });

  it("顶层不是对象时回退 null", () => {
    for (const raw of ["[]", "42", "null", '"x"']) {
      expect(readManualPath("data-structures", testStorage(raw))).toBeNull();
    }
  });

  it("没有 window 时默认存储为 null：读写都不抛错", () => {
    // vitest 的 environment 是 node，默认参数取不到 localStorage
    expect(readManualPath("data-structures")).toBeNull();
    expect(() => writeManualPath("data-structures", EDIT_A)).not.toThrow();
  });

  it("targetId 为空串时不读也不写", () => {
    const storage = testStorage();
    writeManualPath("", EDIT_A, storage);
    expect(storage.data.has(MANUAL_PATH_STORAGE_KEY)).toBe(false);
    expect(readManualPath("", storage)).toBeNull();
  });
});
