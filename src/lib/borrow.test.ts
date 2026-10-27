import { describe, it, expect } from "vitest";
import { borrowItems } from "@/lib/borrow";
import { SUBJECTS } from "@/data/subjects";

const NOW = "2026-10-26T00:00:00.000Z";
const META = { directionId: "dir-abcdef12-3456", now: NOW };

describe("无模型时借用内置题库", () => {
  it("同名知识点能借到题，source=borrowed、status=accepted", () => {
    const ds = SUBJECTS.find((s) => s.id === "data-structures")!;
    const stack = ds.graph.concepts.find((c) => c.name === "栈")!;
    const items = borrowItems(stack, META);

    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(4);
    for (const it of items) {
      expect(it.source).toBe("borrowed");
      expect(it.status).toBe("accepted");
      expect(it.directionId).toBe(META.directionId);
      expect(it.options).toHaveLength(4);
      expect(it.answerIndex).toBeGreaterThanOrEqual(0);
      expect(it.answerIndex).toBeLessThan(4);
    }
  });

  it("id 带方向前缀，不与内置题库撞车", () => {
    const ds = SUBJECTS.find((s) => s.id === "data-structures")!;
    const stack = ds.graph.concepts.find((c) => c.name === "栈")!;
    const items = borrowItems(stack, META);
    for (const it of items) {
      expect(it.id.startsWith("di-")).toBe(true);
      expect(it.id).toContain("dir-abcd");
    }
  });

  it("名称归一化后匹配（忽略空白与大小写）", () => {
    const ds = SUBJECTS.find((s) => s.id === "data-structures")!;
    const stack = ds.graph.concepts.find((c) => c.name === "栈")!;
    const padded = { ...stack, name: " 栈 " };
    expect(borrowItems(padded, META).length).toBeGreaterThan(0);
  });

  it("找不到同名知识点时返回空数组，不硬凑", () => {
    const items = borrowItems(
      { id: "k1", name: "这个知识点在内置题库里绝对不存在", summary: "", chapter: "自定义" },
      META,
    );
    expect(items).toEqual([]);
  });

  it("名称只是包含关系时不借用（问的不是同一个点）", () => {
    // 「栈的应用」在内置题库里有，但「栈」也在；这里测的是反向：
    // 用「栈的」这种不完整的名字不应该借到「栈」
    const items = borrowItems(
      { id: "k1", name: "栈的", summary: "", chapter: "自定义" },
      META,
    );
    expect(items).toEqual([]);
  });

  it("借用题的 contentHash 与题干绑定，不同方向算出同样的 hash", () => {
    const ds = SUBJECTS.find((s) => s.id === "data-structures")!;
    const stack = ds.graph.concepts.find((c) => c.name === "栈")!;
    const a = borrowItems(stack, { directionId: "dir-a", now: NOW });
    const b = borrowItems(stack, { directionId: "dir-b", now: NOW });
    expect(a.map((x) => x.contentHash)).toEqual(b.map((x) => x.contentHash));
    // 但 id 不同（带方向前缀）
    expect(a[0].id).not.toBe(b[0].id);
  });
});
