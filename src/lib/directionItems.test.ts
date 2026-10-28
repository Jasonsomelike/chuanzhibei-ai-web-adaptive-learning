import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * 假模型：只记录提示词，不发请求。
 * 这些用例要验证的是「资料有没有进到出题提示词里」，
 * 模型调用本身一律失败即可——生成是否成功不在本文件的关注范围。
 *
 * 用 vi.hoisted 是因为 vi.mock 会被提升到 import 之前，
 * 工厂函数里不能引用普通顶层变量。
 */
const { prompts } = vi.hoisted(() => ({ prompts: [] as string[] }));

vi.mock("@/lib/chat", () => ({
  callChat: async (_provider: unknown, req: { user: string }) => {
    prompts.push(req.user);
    throw new Error("测试里不访问模型");
  },
}));

import { ensureAllItems, materialForConcept } from "@/lib/directionItems";
import type { KnowledgeConcept, KnowledgeGraph } from "@/lib/graph";
import type { MaterialPack, MaterialSelection } from "@/lib/materials";
import type { ProviderConfig } from "@/lib/provider";

const PROVIDER: ProviderConfig = {
  label: "测试供应商",
  kind: "openai-compatible",
  baseUrl: "https://example.invalid/v1",
  apiKey: "test-key",
  model: "test-model",
};

const CONCEPT: KnowledgeConcept = {
  id: "k1",
  name: "栈",
  summary: "后进先出的线性表",
  chapter: "第3章 栈与队列",
};

const GRAPH: KnowledgeGraph = {
  version: "test",
  concepts: [CONCEPT],
  edges: [],
};

const EXCERPT = "栈是只允许在表尾插入和删除的线性表。";

const PACK: MaterialPack = {
  id: "test-pack",
  title: "合成教材",
  sources: [{ id: "src", kind: "textbook", title: "合成教材" }],
  chunks: [
    {
      id: "chunk-1",
      sourceId: "src",
      kcIds: ["k1"],
      chapter: "第3章 栈与队列",
      section: "3.1 栈的定义",
      pageFrom: 45,
      pageTo: 46,
      text: EXCERPT,
    },
  ],
  claims: [],
};

const SELECTION: MaterialSelection = { sourceIds: ["src"], resolutions: {} };

describe("ensureAllItems 的资料口径", () => {
  beforeEach(() => {
    prompts.length = 0;
    // 题目缓存为空：只拦截「拉取某方向全部题目」那一次请求
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("传了 pack + selection 时，出题提示词带上原文与依据", async () => {
    await ensureAllItems({
      directionId: "d1",
      graph: GRAPH,
      provider: PROVIDER,
      material: { pack: PACK, selection: SELECTION },
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("教材原文");
    expect(prompts[0]).toContain(EXCERPT);
    // 引用抬头由 citationLabel 生成，模型只能用这里出现的出处
    expect(prompts[0]).toContain("[教材·《合成教材》·第3章 栈与队列·第45–46页]");

    // 依据标注随题落进 checks，带「依据：」前缀
    const material = materialForConcept({ pack: PACK, selection: SELECTION }, CONCEPT);
    expect(material?.checkLabel).toBe("依据：[教材·《合成教材》·第3章 栈与队列·第45–46页]");
  });

  it("不传资料时提示词里没有教材小节，materialForConcept 返回 undefined", async () => {
    await ensureAllItems({ directionId: "d1", graph: GRAPH, provider: PROVIDER });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("教材原文");
    expect(materialForConcept(undefined, CONCEPT)).toBeUndefined();
  });

  it("没有命中片段时不注入：空选择、未覆盖的 KC、只有分歧没有原文都算", () => {
    const noneSelected: MaterialSelection = { sourceIds: [], resolutions: {} };
    expect(materialForConcept({ pack: PACK, selection: noneSelected }, CONCEPT)).toBeUndefined();

    const otherConcept: KnowledgeConcept = { ...CONCEPT, id: "k2" };
    expect(materialForConcept({ pack: PACK, selection: SELECTION }, otherConcept)).toBeUndefined();

    /*
     * 只有口径分歧、没有可引用片段时，buildMaterialContext 会产出提示文本，
     * 但 citations 为空。判据只看 citations，避免题卡出现没有定位点的「依据」。
     */
    const conflictOnly: MaterialPack = {
      ...PACK,
      chunks: [],
      claims: [
        {
          id: "c1",
          kcId: "k1",
          topic: "栈顶",
          statement: "栈顶是最后入栈的元素",
          basis: "textbook",
          sourceId: "src",
        },
        {
          id: "c2",
          kcId: "k1",
          topic: "栈顶",
          statement: "栈顶是最先入栈的元素",
          basis: "textbook",
          sourceId: "src",
        },
      ],
    };
    expect(materialForConcept({ pack: conflictOnly, selection: SELECTION }, CONCEPT)).toBeUndefined();
  });
});
