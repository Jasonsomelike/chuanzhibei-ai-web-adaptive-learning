import { afterEach, describe, expect, it, vi } from "vitest";
import { PATH_VIEW_KEY, readPathView, writePathView } from "./pathView";

afterEach(() => vi.unstubAllGlobals());
describe("图谱视图存档", () => {
  it("课程之间独立保存预算、知识点和目标范围", () => {
    const values = new Map<string,string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string,value: string) => values.set(key,value) });
    const view = { budget: 90, kcId: "c09", targets: ["c09"] };
    writePathView("data-structures", view);
    writePathView("network", { budget: 30, kcId: "n01", targets: [] });
    expect(readPathView("data-structures")).toEqual(view);
    expect(readPathView("network").budget).toBe(30);
    expect(values.get(PATH_VIEW_KEY)).not.toContain("mastery");
  });
  it("损坏或不可用的存储回到安全默认值", () => {
    for (const raw of ["broken", "null", "[]", '{"course":{"budget":9999,"kcId":42,"targets":["x",null]}}']) {
      vi.stubGlobal("localStorage", { getItem: () => raw });
      const value = readPathView("course");
      expect(value.budget).toBe(60);
      expect(value.kcId).toBeNull();
      expect(value.targets.every(id => typeof id === "string")).toBe(true);
    }
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("denied"); } });
    expect(readPathView("course")).toEqual({ budget: 60, kcId: null, targets: [] });
    expect(() => writePathView("course", { budget: 60, kcId: null, targets: [] })).not.toThrow();
  });
});
