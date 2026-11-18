import { afterEach, describe, expect, it, vi } from "vitest";
import * as providers from "./provider";
import * as search from "./searchClient";
import * as modes from "./serverConfig";
import { planDirection, type PlanTurn } from "./directionPlanner";
import { directionWorkspaceId } from "./directionWorkspaceId";
import { checkDocumentTarget } from "./learningContext";
import { composeFromExisting } from "./direction";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("direction planning", () => {
  it.each(["stop", "length"])("uses the discussion and sources when the search-word model finishes with %s", async finish => {
    vi.spyOn(modes, "loadCallMode").mockReturnValue("local");
    vi.spyOn(providers, "loadProvider").mockReturnValue({ label: "回归模型", kind: "openai-compatible",
      baseUrl: "https://model.example.test/v1", model: "planning-test", apiKey: "unit-test" });
    const lookup = vi.spyOn(search, "searchWeb").mockResolvedValue({ results: [{ title: "公开课程大纲", snippet: "课程练习包含滑动窗口", url: "https://example.org/lesson", provider: "wikipedia" }],
      notice: null, fromCache: false, error: null, errorKind: null, provider: "wikipedia" });
    const previous = composeFromExisting("数据结构 栈")!;
    const next = { ...previous, title: "栈与队列训练", references: { [previous.concepts[0].id]: [1, 2] }, concepts: previous.concepts.map(c => ({ ...c, chapter: "模拟队列" })) };
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      if (url === "/api/documents/retrieve") {
        expect(body.documentIds).toEqual(["document-a"]);
        expect(body.draftKey).toBe("scope-key");
        return Response.json({ hits: [{ chunk: { id: "a:0", title: "本班讲义", text: "用双栈模拟队列", pageFrom: 8 } }] });
      }
      const text = body.messages.at(-1).content;
      calls.push(text);
      const content = calls.length === 1 ? "队列 算法 课程" : JSON.stringify(next);
      return Response.json({ choices: [{ message: { content }, finish_reason: calls.length === 1 ? finish : "stop" }] });
    }));
    const turns: PlanTurn[] = [{ role: "user", text: "我想学习数据结构" }, { role: "assistant", text: "你有多少时间？" },
      { role: "user", text: "两周，优先队列" }];
    const result = await planDirection({ turns, previous, build: true, web: true, docIds: ["document-a"],
      targetId: "draft-id", draftKey: "scope-key", signal: new AbortController().signal, progress() {} });
    expect(lookup.mock.calls[0][0]).toBe(finish === "length" ? turns[0].text : "队列 算法 课程");
    expect(calls[0]).not.toContain("双栈模拟");
    for (const fragment of ["优先队列", "双栈模拟", "滑动窗口", previous.title, "你有多少时间"])
      expect(calls[1]).toContain(fragment);
    expect(result.draft?.concepts[0].chapter).toBe("模拟队列");
    expect(result.turn.sources?.[0].label).toContain("第8页");
    expect(result.references?.[previous.concepts[0].id]).toEqual([1, 2]);
    expect(result.model).toBe("planning-test");
  });

  it("permits a draft index only for the account and workspace that reserved it", async () => {
    const key = crypto.randomUUID();
    const target = await directionWorkspaceId("owner", key);
    const db = { one: vi.fn() } as unknown as Parameters<typeof checkDocumentTarget>[0];
    await checkDocumentTarget(db, "owner", target, key);
    await expect(checkDocumentTarget(db, "other", target, key)).rejects.toMatchObject({ status: 403 });
    await expect(checkDocumentTarget(db, "owner", target, crypto.randomUUID())).rejects.toMatchObject({ status: 403 });
  });
});
