import { describe, expect, it } from "vitest";

import type { MaterialChunk, MaterialPack, MaterialSource } from "@/lib/materials";
import {
  chaptersOfChunks,
  charCountOf,
  compareChapters,
  readingViewsOf,
} from "@/lib/materialReading";

const SOURCE_A: MaterialSource = {
  id: "src-a",
  kind: "textbook",
  title: "教材 A",
};

const SOURCE_EMPTY: MaterialSource = {
  id: "src-empty",
  kind: "lecture",
  title: "空讲义",
};

function chunk(partial: Pick<MaterialChunk, "id" | "sourceId" | "chapter" | "text">): MaterialChunk {
  return { ...partial, kcIds: [], section: "" };
}

describe("compareChapters", () => {
  /** 只关心符号：排序约定是负数在前、正数在后，不锁定具体差值。 */
  const sign = (value: number): number => Math.sign(value);

  it("按章号数字升序，第10章排在第2章后面", () => {
    expect(sign(compareChapters("第10章 串", "第2章 栈"))).toBe(1);
    expect(sign(compareChapters("第2章 栈", "第10章 串"))).toBe(-1);
    expect(compareChapters("第3章", "第3章")).toBe(0);
  });

  it("无章号的章节名排在有章号的后面", () => {
    expect(sign(compareChapters("附录", "第2章 栈"))).toBe(1);
    expect(sign(compareChapters("第2章 栈", "附录"))).toBe(-1);
  });
});

describe("charCountOf", () => {
  it("按码点计数，emoji 算一个", () => {
    expect(charCountOf("栈顶")).toBe(2);
    expect(charCountOf("学👍")).toBe(2);
    expect(charCountOf("")).toBe(0);
  });
});

describe("chaptersOfChunks", () => {
  it("按章节分组并按章号升序", () => {
    const groups = chaptersOfChunks([
      chunk({ id: "c1", sourceId: "a", chapter: "第4章 串", text: "串的定义" }),
      chunk({ id: "c2", sourceId: "a", chapter: "第3章 栈", text: "栈的定义" }),
      chunk({ id: "c3", sourceId: "a", chapter: "第3章 栈", text: "栈的存储" }),
    ]);
    expect(groups.map((g) => g.chapter)).toEqual(["第3章 栈", "第4章 串"]);
    expect(groups[0].chunks.map((c) => c.id)).toEqual(["c2", "c3"]);
    expect(groups[1].chunks.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("readingViewsOf", () => {
  const pack: MaterialPack = {
    id: "p",
    title: "包",
    sources: [SOURCE_A, SOURCE_EMPTY],
    chunks: [
      chunk({ id: "c1", sourceId: "src-a", chapter: "第3章 栈", text: "栈是后进先出的线性表" }),
      chunk({ id: "c2", sourceId: "src-a", chapter: "第4章 串", text: "串" }),
    ],
    claims: [],
  };

  it("每个来源一份视图，无片段的来源也保留", () => {
    const views = readingViewsOf(pack);
    expect(views).toHaveLength(2);
    expect(views[0].source.id).toBe("src-a");
    expect(views[0].chapters).toHaveLength(2);
    expect(views[0].totalChars).toBe(11);
    expect(views[1].source.id).toBe("src-empty");
    expect(views[1].chapters).toHaveLength(0);
    expect(views[1].totalChars).toBe(0);
  });

  it("空包返回空视图数组", () => {
    expect(readingViewsOf({ id: "p", title: "", sources: [], chunks: [], claims: [] })).toEqual([]);
  });
});
