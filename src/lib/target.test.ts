import { describe, it, expect } from "vitest";
import {
  targetFromSubject,
  targetFromDirection,
  questionsOf,
  targetQuery,
} from "@/lib/target";
import { getSubject, SUBJECTS } from "@/data/subjects";
import type { DirectionItem } from "@/lib/itemgen";

const graph = {
  version: "kg-test-v1",
  concepts: [
    { id: "k1", name: "栈", summary: "", chapter: "自定义" },
    { id: "k2", name: "队列", summary: "", chapter: "自定义" },
  ],
  edges: [{ before: "k1", after: "k2" }],
};

function fakeItem(over: Partial<DirectionItem> = {}): DirectionItem {
  return {
    id: "di-1",
    directionId: "dir-1",
    kcId: "k1",
    difficulty: 3,
    stem: "题目",
    options: ["A", "B", "C", "D"],
    answerIndex: 0,
    explanation: "解析",
    source: "generated",
    status: "accepted",
    checks: [],
    contentHash: "h",
    createdAt: "2026-10-26T00:00:00.000Z",
    ...over,
  };
}

describe("LearningTarget", () => {
  it("内置学科目标带题库与展示信息", () => {
    const subject = getSubject("network");
    const t = targetFromSubject(subject);
    expect(t.kind).toBe("subject");
    expect(t.id).toBe("network");
    expect(t.name).toBe(subject.name);
    expect(t.questions).toBe(subject.questions);
    expect(t.tagline).toBe(subject.tagline);
    expect(t.graph).toBe(subject.graph);
  });

  it("方向目标只有图谱，没有题库", () => {
    const t = targetFromDirection({ id: "dir-1", title: "树结构入门", graph });
    expect(t.kind).toBe("direction");
    expect(t.name).toBe("树结构入门");
    expect("questions" in t).toBe(false);
    expect(t.graph.concepts).toHaveLength(2);
  });

  it("questionsOf：学科直接给题库，方向靠外部传入", () => {
    const subject = targetFromSubject(getSubject("os"));
    expect(questionsOf(subject).length).toBe(subject.questions.length);

    const direction = targetFromDirection({ id: "dir-1", title: "t", graph });
    expect(questionsOf(direction)).toEqual([]);
    expect(questionsOf(direction, [fakeItem()])).toHaveLength(1);
  });

  it("URL 参数名按目标类型区分", () => {
    const subject = targetFromSubject(getSubject("python"));
    expect(targetQuery(subject)).toBe("?subject=python");

    const direction = targetFromDirection({ id: "abc-123", title: "t", graph });
    expect(targetQuery(direction)).toBe("?direction=abc-123");
  });

  it("所有内置学科都能构造成目标，且 id 唯一", () => {
    const ids = SUBJECTS.map((s) => targetFromSubject(s).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(9);
  });
});
