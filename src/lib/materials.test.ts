import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_CHARS,
  MAX_EXCERPT_CHARS,
  MAX_NOTE_CHARS,
  MAX_NOTES_TOTAL_CHARS,
  MATERIALS_STORAGE_KEY,
  MATERIAL_CHECK_PREFIX,
  buildMaterialContext,
  chunksForConcept,
  citationLabel,
  coerceMaterialsForSave,
  defaultSelectionFor,
  describeSelection,
  detectConflicts,
  emptyMaterialsState,
  emptyPack,
  emptySelection,
  excerptFor,
  materialCheckLabel,
  mergePacks,
  normalizeSelection,
  notesAsPack,
  parseMaterialsState,
  selectableSources,
  selectionForTarget,
  serializeMaterialsState,
  unresolvedConflicts,
  validatePack,
  type MaterialChunk,
  type MaterialNote,
  type MaterialPack,
  type MaterialSelection,
  type MaterialsState,
} from "@/lib/materials";
import { MATERIAL_PACKS, getMaterialPack } from "@/data/materials";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { networkGraph } from "@/data/subjects/network";
import type { KnowledgeConcept } from "@/lib/graph";
import { saveMaterials, type MaterialStorage } from "@/lib/materialStore";

function concept(id: string, chapter: string, name = id): KnowledgeConcept {
  return { id, name, summary: `${name} 的说明`, chapter };
}

function findConcept(graphConcepts: readonly KnowledgeConcept[], id: string): KnowledgeConcept {
  const found = graphConcepts.find((c) => c.id === id);
  if (!found) throw new Error(`测试数据里缺少知识点 ${id}`);
  return found;
}

function singleChunkPack(chunk: MaterialChunk): MaterialPack {
  return {
    id: "synthetic",
    title: "合成数据包",
    sources: [{ id: chunk.sourceId, kind: "textbook", title: "合成教材" }],
    chunks: [chunk],
    claims: [],
  };
}

/**
 * 选中包里全部来源。
 *
 * sourceIds 是过滤条件，空选择等于「模型通用知识」模式、什么都不注入，
 * 所以需要正文的用例必须显式全选，不能靠 emptySelection 顺手拿到整包。
 */
function allSources(pack: MaterialPack): MaterialSelection {
  return { sourceIds: pack.sources.map((s) => s.id), resolutions: {} };
}

describe("内置资料包", () => {
  it("两个包各有 2 个来源、至少 6 个片段，且片段都带小节与页码", () => {
    for (const pack of MATERIAL_PACKS) {
      expect(pack.sources).toHaveLength(2);
      expect(pack.chunks.length).toBeGreaterThanOrEqual(6);
      for (const chunk of pack.chunks) {
        expect(chunk.section.trim()).not.toBe("");
        expect(typeof chunk.pageFrom).toBe("number");
        expect(typeof chunk.pageTo).toBe("number");
      }
    }
  });

  it("数据结构包覆盖 c09/c10/c11/c14", () => {
    const pack = getMaterialPack("data-structures");
    const kcIds = new Set(pack.chunks.flatMap((c) => c.kcIds));
    for (const id of ["c09", "c10", "c11", "c14"]) {
      expect(kcIds.has(id)).toBe(true);
    }
  });

  it("网络包覆盖 n23–n28，n28 属于『第5章 运输层』", () => {
    const pack = getMaterialPack("network");
    const kcIds = new Set(pack.chunks.flatMap((c) => c.kcIds));
    for (const id of ["n23", "n24", "n25", "n26", "n27", "n28"]) {
      expect(kcIds.has(id)).toBe(true);
    }

    const n28 = findConcept(networkGraph.concepts, "n28");
    expect(n28.chapter).toBe("第5章 运输层");

    const hits = chunksForConcept(pack, n28, allSources(pack));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((c) => c.chapter === n28.chapter)).toBe(true);
    expect(hits.map((c) => c.id)).toContain("net-n28-lect-1");
  });

  it("章名字面量与图谱完全一致（差一个空格都会让章节排序失效）", () => {
    const dsById = new Map(knowledgeGraph.concepts.map((c) => [c.id, c]));
    for (const chunk of getMaterialPack("data-structures").chunks) {
      for (const kcId of chunk.kcIds) {
        expect(chunk.chapter).toBe(dsById.get(kcId)?.chapter);
      }
    }

    const netById = new Map(networkGraph.concepts.map((c) => [c.id, c]));
    for (const chunk of getMaterialPack("network").chunks) {
      for (const kcId of chunk.kcIds) {
        expect(chunk.chapter).toBe(netById.get(kcId)?.chapter);
      }
    }
  });

  it("validatePack 对两个内置包返回 0 issue", () => {
    expect(validatePack(getMaterialPack("data-structures"))).toEqual([]);
    expect(validatePack(getMaterialPack("network"))).toEqual([]);
  });

  it("validatePack 会真的报错，不是永远返回空数组", () => {
    const broken: MaterialPack = {
      id: "broken",
      title: "坏包",
      sources: [
        { id: "s", kind: "textbook", title: "教材" },
        { id: "s", kind: "textbook", title: "重复来源" },
      ],
      chunks: [
        {
          id: "c",
          sourceId: "missing",
          kcIds: [],
          chapter: "",
          section: "",
          pageFrom: 10,
          pageTo: 5,
          text: "",
        },
        {
          id: "c",
          sourceId: "s",
          kcIds: ["k"],
          chapter: "ch",
          section: "sec",
          pageFrom: 1,
          pageTo: 2,
          text: "x",
        },
      ],
      claims: [{ id: "cl", kcId: "", topic: "", statement: "", basis: "model" }],
    };
    expect(validatePack(broken).length).toBeGreaterThanOrEqual(6);
  });

  it("内置分歧是真实口径差异，不是同义改写", () => {
    const ds = detectConflicts(getMaterialPack("data-structures"));
    expect(ds).toHaveLength(1);
    expect(ds[0].claims.map((c) => c.statement).sort()).toEqual(
      ["栈顶指针指向栈顶元素", "栈顶指针指向栈顶元素的下一个空位"].sort(),
    );

    const net = detectConflicts(getMaterialPack("network"));
    expect(net).toHaveLength(2);
    expect(net.map((c) => c.topic).sort()).toEqual(
      ["slow start 的中文译名", "第 5 章的章名"].sort(),
    );
    const chapterConflict = net.find((c) => c.topic === "第 5 章的章名");
    expect(chapterConflict?.claims.map((c) => c.statement).sort()).toEqual(
      ["第 5 章叫传输层", "第 5 章叫运输层"].sort(),
    );
    const slowConflict = net.find((c) => c.topic === "slow start 的中文译名");
    expect(slowConflict?.claims.map((c) => c.statement).sort()).toEqual(
      ["slow start 叫慢启动", "slow start 叫慢开始"].sort(),
    );
  });
});

/**
 * 默认来源口径。
 *
 * 内置学科首次进入应当直接落在教材口径；自定义方向没有内置资料，
 * 不能被默认值伪装成「已选教材」；用户显式保存的「模型通用知识」（空选择）
 * 必须原样保留，否则每次打开都会被默认值覆盖。
 */
describe("默认来源口径", () => {
  it("空包没有可选来源，默认选择为空", () => {
    expect(defaultSelectionFor(emptyPack("custom", "未内置资料"))).toEqual(emptySelection());
  });

  it("内置包默认选中全部来源", () => {
    for (const pack of MATERIAL_PACKS) {
      expect(pack.sources.length).toBeGreaterThan(0);
      expect(defaultSelectionFor(pack)).toEqual({
        sourceIds: pack.sources.map((source) => source.id),
        resolutions: {},
      });
    }
    expect(defaultSelectionFor(getMaterialPack("data-structures")).sourceIds).toEqual([
      "ds-textbook",
      "ds-lecture",
    ]);
  });

  it("已保存的空选择原样返回，不被默认值覆盖", () => {
    const pack = getMaterialPack("data-structures");
    expect(selectionForTarget(emptySelection(), pack)).toEqual(emptySelection());
  });

  it("没有存档时才使用默认口径；自定义方向仍为空", () => {
    const pack = getMaterialPack("network");
    expect(selectionForTarget(undefined, pack).sourceIds).toEqual(
      pack.sources.map((source) => source.id),
    );
    expect(selectionForTarget(undefined, emptyPack("custom", "未内置资料"))).toEqual(
      emptySelection(),
    );
  });
});

describe("片段筛选与排序", () => {
  const dsPack = getMaterialPack("data-structures");
  const c09 = findConcept(knowledgeGraph.concepts, "c09");

  it("sourceIds 是过滤条件：未勾选来源的片段不会进入结果", () => {
    const hits = chunksForConcept(dsPack, c09, { sourceIds: ["ds-textbook"], resolutions: {} });
    expect(hits.map((c) => c.id).sort()).toEqual(["ds-c09-text-1", "ds-c09-text-2"].sort());
    expect(new Set(hits.map((c) => c.sourceId))).toEqual(new Set(["ds-textbook"]));
  });

  it("空选择（模型通用知识）不返回任何片段，也不产生引用", () => {
    expect(chunksForConcept(dsPack, c09, emptySelection())).toEqual([]);
    const context = buildMaterialContext(dsPack, [c09], emptySelection());
    expect(context.citations).toEqual([]);
    expect(context.coveredKcIds).toEqual([]);
    expect(context.missingKcIds).toEqual(["c09"]);
    // 连分歧块也不能出现：它援引的是书目原文，等于绕过「不引用具体书目」
    expect(context.text).toBe("");
    expect(context.unresolved).toEqual([]);
  });

  it("来源优先级决定先后", () => {
    const lectureFirst = chunksForConcept(dsPack, c09, {
      sourceIds: ["ds-lecture"],
      resolutions: {},
    });
    expect(lectureFirst[0].id).toBe("ds-c09-lect-1");

    const textbookFirst = chunksForConcept(dsPack, c09, {
      sourceIds: ["ds-textbook"],
      resolutions: {},
    });
    expect(textbookFirst[0].id).toBe("ds-c09-text-1");
  });

  it("章节相等只是排序键：章节不同但 kcId 命中的片段仍被选中", () => {
    const k = concept("kx", "第1章 测试", "跨章知识点");
    const pack: MaterialPack = {
      id: "chapter-sort",
      title: "章节排序",
      sources: [{ id: "s", kind: "lecture", title: "讲义" }],
      chunks: [
        {
          id: "z-other-chapter",
          sourceId: "s",
          kcIds: ["kx"],
          chapter: "第9章 别处",
          section: "9.1",
          pageFrom: 1,
          pageTo: 1,
          text: "跨章片段正文",
        },
        {
          id: "a-same-chapter",
          sourceId: "s",
          kcIds: ["kx"],
          chapter: "第1章 测试",
          section: "1.1",
          pageFrom: 50,
          pageTo: 50,
          text: "同章片段正文",
        },
      ],
      claims: [],
    };

    const ordered = chunksForConcept(pack, k, allSources(pack));
    expect(ordered.map((c) => c.id)).toEqual(["a-same-chapter", "z-other-chapter"]);

    const context = buildMaterialContext(pack, [k], allSources(pack));
    expect(context.coveredKcIds).toEqual(["kx"]);
    expect(context.missingKcIds).toEqual([]);
    expect(context.text).toContain("跨章片段正文");
    expect(context.text).toContain("同章片段正文");
  });

  it("同来源同章节时按 pageFrom 升序、再按 id 字典序", () => {
    const k = concept("k", "第1章", "知识点");
    const chunks: MaterialChunk[] = [
      {
        id: "z",
        sourceId: "s",
        kcIds: ["k"],
        chapter: "第1章",
        section: "1.1",
        pageFrom: 3,
        pageTo: 3,
        text: "z",
      },
      {
        id: "b",
        sourceId: "s",
        kcIds: ["k"],
        chapter: "第1章",
        section: "1.1",
        pageFrom: 3,
        pageTo: 3,
        text: "b",
      },
      {
        id: "a",
        sourceId: "s",
        kcIds: ["k"],
        chapter: "第1章",
        section: "1.1",
        pageFrom: 1,
        pageTo: 1,
        text: "a",
      },
    ];
    const pack: MaterialPack = {
      id: "order",
      title: "排序",
      sources: [{ id: "s", kind: "textbook", title: "教材" }],
      chunks,
      claims: [],
    };
    expect(chunksForConcept(pack, k, allSources(pack)).map((c) => c.id)).toEqual(["a", "b", "z"]);
  });
});

describe("摘录与引用", () => {
  const dsPack = getMaterialPack("data-structures");
  const c09 = findConcept(knowledgeGraph.concepts, "c09");
  const c10 = findConcept(knowledgeGraph.concepts, "c10");

  it("超长正文按码点截断到 400，并标记 truncated", () => {
    // 「𠮷」是代理对：按 UTF-16 长度会算成 2，只有按码点截断才会得到 400
    const pack = singleChunkPack({
      id: "long",
      sourceId: "s",
      kcIds: ["k"],
      chapter: "第1章 测试",
      section: "1.1",
      pageFrom: 1,
      pageTo: 1,
      text: "𠮷".repeat(500),
    });
    const excerpt = excerptFor(pack, concept("k", "第1章 测试"), allSources(pack));
    expect(excerpt).not.toBeNull();
    expect(excerpt?.truncated).toBe(true);
    expect(Array.from(excerpt!.text)).toHaveLength(MAX_EXCERPT_CHARS);
    expect(excerpt!.text.length).toBe(MAX_EXCERPT_CHARS * 2);
  });

  it("没有命中返回 null，没有页码也不编造页码", () => {
    expect(excerptFor(emptyPack("empty", "空包"), c09, emptySelection())).toBeNull();

    const noPage = singleChunkPack({
      id: "no-page",
      sourceId: "s",
      kcIds: ["k"],
      chapter: "第1章 测试",
      section: "1.1",
      text: "没有页码的讲义片段",
    });
    const excerpt = excerptFor(noPage, concept("k", "第1章 测试"), allSources(noPage));
    expect(excerpt).not.toBeNull();
    expect(excerpt!.pageFrom).toBeNull();
    expect(excerpt!.pageTo).toBeNull();
    const label = citationLabel(excerpt!);
    expect(label).not.toContain("页");
    expect(label).toBe("[教材·《合成教材》·第1章 测试]");
  });

  it("引用抬头包含类型、书名、章节与页码", () => {
    const excerpt = excerptFor(dsPack, c09, { sourceIds: ["ds-textbook"], resolutions: {} });
    expect(excerpt).not.toBeNull();
    const label = citationLabel(excerpt!);
    expect(label).toContain("教材");
    expect(label).toContain("《数据结构（C 语言版）》");
    expect(label).toContain("第3章 栈与队列");
    expect(label).toContain("第45–46页");
  });

  it("selectableSources 返回全部实体来源（模型不是来源，不会出现）", () => {
    const ids = selectableSources(dsPack).map((s) => s.id);
    expect(ids).toEqual(["ds-textbook", "ds-lecture"]);
    // 类型上 MaterialKind 不含 model；这里再从运行时值确认一次
    expect(selectableSources(dsPack).every((s) => (s.kind as string) !== "model")).toBe(true);
  });

  it("materialCheckLabel 带固定前缀，没有引用时为空", () => {
    const context = buildMaterialContext(dsPack, [c09], {
      sourceIds: ["ds-textbook", "ds-lecture"],
      resolutions: {},
    });
    const label = materialCheckLabel(context.citations);
    expect(label.startsWith(MATERIAL_CHECK_PREFIX)).toBe(true);
    expect(label).toContain("教材·《数据结构（C 语言版）》");
    expect(materialCheckLabel([])).toBe("");
  });

  it("describeSelection 说明来源数与待定分歧", () => {
    expect(describeSelection(dsPack, emptySelection())).toBe("未选择来源");
    const text = describeSelection(dsPack, {
      sourceIds: ["ds-textbook", "ds-lecture"],
      resolutions: {},
    });
    expect(text).toContain("2 个来源");
    expect(text).toContain("数据结构（C 语言版）");
    expect(text).toContain("1 处口径分歧待选定");
  });

  it("normalizeSelection 去掉不存在的来源、重复项与失效裁定", () => {
    const normalized = normalizeSelection(
      {
        sourceIds: ["nope", "ds-lecture", "ds-lecture", "ds-textbook"],
        resolutions: { "c09::栈顶指针的含义": "不存在的说法", "别的冲突": "x" },
      },
      dsPack,
    );
    expect(normalized.sourceIds).toEqual(["ds-lecture", "ds-textbook"]);
    expect(normalized.resolutions).toEqual({});
  });

  it("选中的冲突裁定会被保留", () => {
    const conflict = detectConflicts(dsPack)[0];
    const normalized = normalizeSelection(
      { sourceIds: [], resolutions: { [conflict.key]: conflict.claims[0].id } },
      dsPack,
    );
    expect(normalized.resolutions).toEqual({ [conflict.key]: conflict.claims[0].id });
    expect(unresolvedConflicts(dsPack, normalized)).toHaveLength(0);
  });

  it("空包与空知识点的行为", () => {
    const empty = emptyPack("empty", "空包");
    expect(excerptFor(empty, c09, emptySelection())).toBeNull();

    const context = buildMaterialContext(empty, [c09, c10], emptySelection());
    expect(context).toEqual({
      text: "",
      citations: [],
      coveredKcIds: [],
      missingKcIds: ["c09", "c10"],
      unresolved: [],
    });
  });
});

describe("buildMaterialContext", () => {
  const dsPack = getMaterialPack("data-structures");
  const dsConcepts = ["c09", "c10", "c11", "c14"].map((id) =>
    findConcept(knowledgeGraph.concepts, id),
  );
  const selection = { sourceIds: ["ds-textbook", "ds-lecture"], resolutions: {} };

  it("同一输入两次调用逐字节相同", () => {
    const a = buildMaterialContext(dsPack, dsConcepts, selection);
    const b = buildMaterialContext(dsPack, dsConcepts, selection);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.text).toBe(b.text);
  });

  it("每个知识点都有以引用抬头开始的正文，章节与页码来自真实片段", () => {
    const context = buildMaterialContext(dsPack, dsConcepts, selection);
    expect(context.coveredKcIds).toEqual(["c09", "c10", "c11", "c14"]);
    expect(context.missingKcIds).toEqual([]);
    expect(context.text).toContain("[教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]");
    expect(context.text).toContain("[教材·《数据结构（C 语言版）》·第4章 串·第79–82页]");
    expect(context.text).toContain("KMP");
  });

  it("超过 MAX_CONTEXT_CHARS 时先截单条、再丢最低优先级；引用与覆盖如实，未决分歧不丢", () => {
    const concepts: KnowledgeConcept[] = [];
    const chunks: MaterialChunk[] = [];
    for (let i = 1; i <= 8; i += 1) {
      const id = `k${i}`;
      concepts.push(concept(id, "第1章 测试", `知识点${i}`));
      chunks.push({
        id: `chunk-${i}`,
        sourceId: "s1",
        kcIds: [id],
        chapter: "第1章 测试",
        section: "1.1",
        pageFrom: i,
        pageTo: i,
        text: `第${i}段开始` + "长".repeat(500),
      });
    }

    const pack: MaterialPack = {
      id: "budget",
      title: "预算测试",
      sources: [{ id: "s1", kind: "textbook", title: "长教材" }],
      chunks,
      claims: [
        {
          id: "claim-a",
          kcId: "k8",
          topic: "第 8 个知识点的说法",
          statement: "甲说",
          basis: "textbook",
          sourceId: "s1",
        },
        {
          id: "claim-b",
          kcId: "k8",
          topic: "第 8 个知识点的说法",
          statement: "乙说",
          basis: "model",
        },
      ],
    };

    const context = buildMaterialContext(pack, concepts, { sourceIds: ["s1"], resolutions: {} }, MAX_CONTEXT_CHARS);

    // 8 段 × 400 字（加上抬头）一定超预算，必须真的丢掉了一些
    expect(context.citations.length).toBeLessThan(8);
    expect(context.missingKcIds.length).toBeGreaterThan(0);

    // 最低优先级的是页码最大的 chunk-8
    expect(context.missingKcIds).toContain("k8");
    expect(context.coveredKcIds).not.toContain("k8");
    expect(context.citations.some((c) => c.chunkId === "chunk-8")).toBe(false);
    expect(context.text).not.toContain("第8段开始");
    expect(context.text).toContain("第1段开始");

    // 引用与覆盖必须一一对应（每个知识点只有一段）
    expect(context.citations).toHaveLength(context.coveredKcIds.length);
    expect(context.citations.every((c) => !context.missingKcIds.includes(c.chunkId))).toBe(true);

    // 预算裁剪不能把未决分歧删掉
    expect(context.unresolved).toHaveLength(1);
    expect(context.unresolved[0].key).toBe("k8::第 8 个知识点的说法");
    expect(context.text).toContain("【口径分歧｜尚未选定】");
    expect(context.text).toContain("甲说");
    expect(context.text).toContain("乙说");
    expect(context.text).toContain("请同时列出两种说法，不要替用户选择");
  });

  it("冲突检测与选定后消除", () => {
    const c09 = findConcept(knowledgeGraph.concepts, "c09");
    const conflicts = detectConflicts(dsPack);
    expect(conflicts).toHaveLength(1);
    const key = conflicts[0].key;

    const pending = buildMaterialContext(dsPack, [c09], allSources(dsPack));
    expect(pending.unresolved).toHaveLength(1);
    expect(pending.text).toContain("【口径分歧｜尚未选定】");
    expect(pending.text).toContain("不要替用户选择");

    const chosen = {
      sourceIds: dsPack.sources.map((s) => s.id),
      resolutions: { [key]: conflicts[0].claims[0].id },
    };
    const resolved = buildMaterialContext(dsPack, [c09], chosen);
    expect(resolved.unresolved).toHaveLength(0);
    expect(resolved.text).not.toContain("口径分歧");
    // 裁定必须落成指令：只把提示删掉、仍让模型两说并陈，等于让用户以为自己选过了
    expect(resolved.text).toContain("【口径裁定｜以此为准】");
    expect(resolved.text).toContain(conflicts[0].claims[0].statement);
  });

  it("只保留被请求知识点的分歧", () => {
    const c10 = findConcept(knowledgeGraph.concepts, "c10");
    const context = buildMaterialContext(dsPack, [c10], emptySelection());
    expect(context.unresolved).toHaveLength(0);
  });
});

describe("笔记", () => {
  const c09 = findConcept(knowledgeGraph.concepts, "c09");
  const note: MaterialNote = {
    id: "n1",
    title: "我的栈笔记",
    body: "栈顶指针也可以指向栈顶元素的下一个空位，这是讲义里的约定。",
    kcIds: ["c09"],
  };

  it("notesAsPack 继承绑定知识点的 chapter，页码保持为空", () => {
    const pack = notesAsPack([note], knowledgeGraph);
    expect(pack.sources).toHaveLength(1);
    expect(pack.sources[0].kind).toBe("lecture");
    expect(pack.chunks).toHaveLength(1);
    expect(pack.chunks[0].chapter).toBe("第3章 栈与队列");
    expect(pack.chunks[0].pageFrom).toBeUndefined();
  });

  it("只含笔记的 pack 能跑出上下文，正文真的出现在引用里", () => {
    const pack = notesAsPack([note], knowledgeGraph);
    const context = buildMaterialContext(pack, [c09], allSources(pack));

    expect(context.coveredKcIds).toEqual(["c09"]);
    expect(context.missingKcIds).toEqual([]);
    expect(context.text).toContain(note.body);
    expect(context.text).toContain("[讲义·《我的笔记》·第3章 栈与队列]");
    expect(context.coveredKcIds).toEqual(["c09"]);
    expect(context.citations[0].chunkId).toBe("note-n1");
  });

  it("没有图谱时章节留空，但正文仍然可摘录", () => {
    const pack = notesAsPack([note]);
    expect(pack.chunks[0].chapter).toBe("");
    const context = buildMaterialContext(pack, [c09], allSources(pack));
    expect(context.text).toContain(note.body);
  });

  it("合并内置包与笔记包：两边的正文都能出现", () => {
    const merged = mergePacks([getMaterialPack("data-structures"), notesAsPack([note], knowledgeGraph)]);
    expect(merged.sources).toHaveLength(3);
    expect(merged.chunks).toHaveLength(getMaterialPack("data-structures").chunks.length + 1);

    const context = buildMaterialContext(merged, [c09], allSources(merged));
    expect(context.text).toContain("《数据结构（C 语言版）》");
    expect(context.text).toContain(note.body);
  });

  it("mergePacks 按 id 去重，先出现者优先", () => {
    const pack = getMaterialPack("data-structures");
    const merged = mergePacks([pack, pack]);
    expect(merged.sources).toHaveLength(2);
    expect(merged.chunks).toHaveLength(pack.chunks.length);
  });
});

describe("存档解析与保存校验", () => {
  const validState: MaterialsState = {
    version: 1,
    targets: {
      "data-structures": {
        sourceIds: ["ds-textbook", "ds-lecture"],
        resolutions: { "c09::栈顶指针的含义": "ds-claim-top-a" },
      },
    },
    notes: [
      { id: "n1", title: "栈笔记", body: "栈顶指针的含义要按教材约定。", kcIds: ["c09", "c09", "c10"] },
    ],
  };

  it("坏 JSON、版本不符一律回到默认状态", () => {
    expect(parseMaterialsState("{oops")).toEqual(emptyMaterialsState());
    expect(parseMaterialsState("null")).toEqual(emptyMaterialsState());
    expect(parseMaterialsState(undefined)).toEqual(emptyMaterialsState());
    expect(parseMaterialsState(JSON.stringify({ version: 2, targets: {}, notes: [] }))).toEqual(
      emptyMaterialsState(),
    );
  });

  it("解析时丢弃缺知识点或 id 重复的笔记", () => {
    const parsed = parseMaterialsState(
      JSON.stringify({
        version: 1,
        targets: {},
        notes: [
          { id: "n", title: "t", body: "b", kcIds: [] },
          { id: "m", title: "t", body: "b", kcIds: ["c09", "c09"] },
          { id: "m", title: "重复", body: "b", kcIds: ["c10"] },
        ],
      }),
    );
    expect(parsed.notes.map((n) => n.id)).toEqual(["m"]);
    expect(parsed.notes[0].kcIds).toEqual(["c09"]);
  });

  it("序列化后解析能还原选择与笔记", () => {
    // 解析会做与 coerce 相同的规范化（去重 kcIds），所以用规范化后的状态做往返
    const coerced = coerceMaterialsForSave(validState);
    const state = coerced.ok ? coerced.state : emptyMaterialsState();
    expect(parseMaterialsState(serializeMaterialsState(state))).toEqual(state);
  });

  it("合法输入返回 ok，kcIds 去重且其它字段不丢", () => {
    const result = coerceMaterialsForSave(validState);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.notes[0].kcIds).toEqual(["c09", "c10"]);
    expect(result.state.notes[0].id).toBe("n1");
    expect(result.state.notes[0].title).toBe("栈笔记");
    expect(result.state.notes[0].body).toBe(validState.notes[0].body);
    expect(result.state.targets).toEqual(validState.targets);
    expect(result.state.version).toBe(1);
  });

  it("单条正文超限返回 ok:false，并说明是哪条", () => {
    const state: MaterialsState = {
      ...validState,
      notes: [
        {
          id: "n-long",
          title: "超长笔记",
          body: "长".repeat(MAX_NOTE_CHARS + 1),
          kcIds: ["c09"],
        },
      ],
    };
    const result = coerceMaterialsForSave(state);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("第 1 条");
    expect(result.error).toContain("超长笔记");
    expect(result.error).toContain(String(MAX_NOTE_CHARS));
  });

  it("全部笔记合计超限返回 ok:false，并说明合计与超限条数", () => {
    const notes: MaterialNote[] = Array.from({ length: 11 }, (_, i) => ({
      id: `n${i + 1}`,
      title: `笔记${i + 1}`,
      body: "长".repeat(19000),
      kcIds: ["c09"],
    }));
    expect(19000 * 11).toBeGreaterThan(MAX_NOTES_TOTAL_CHARS);

    const result = coerceMaterialsForSave({ ...validState, notes });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("合计");
    expect(result.error).toContain(String(MAX_NOTES_TOTAL_CHARS));
    expect(result.error).toContain("第 11 条");
  });

  it("标题为空或没有绑定知识点都返回 ok:false", () => {
    const noTitle = coerceMaterialsForSave({
      ...validState,
      notes: [{ id: "a", title: "  ", body: "正文", kcIds: ["c09"] }],
    });
    expect(noTitle.ok).toBe(false);

    const noKc = coerceMaterialsForSave({
      ...validState,
      notes: [{ id: "b", title: "标题", body: "正文", kcIds: [] }],
    });
    expect(noKc.ok).toBe(false);
    if (!noKc.ok) expect(noKc.error).toContain("知识点");
  });

  it("setItem 失败时返回 ok:false 而不是静默吞错", () => {
    const storage: MaterialStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const result = saveMaterials(validState, storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("保存失败");
    expect(result.error).toContain("QuotaExceededError");
  });

  it("coerce 失败时不写存储，错误原样返回", () => {
    let writes = 0;
    const storage: MaterialStorage = {
      getItem: () => null,
      setItem: () => {
        writes += 1;
      },
    };
    const oversized: MaterialsState = {
      ...validState,
      notes: [{ id: "n", title: "超长", body: "长".repeat(MAX_NOTE_CHARS + 1), kcIds: ["c09"] }],
    };
    const result = saveMaterials(oversized, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("超过单条上限");
    expect(writes).toBe(0);
  });

  it("保存成功后能从同一个假存储读回", () => {
    const data: Record<string, string> = {};
    const storage: MaterialStorage = {
      getItem: (key) => data[key] ?? null,
      setItem: (key, value) => {
        data[key] = value;
      },
    };

    const result = saveMaterials(validState, storage);
    expect(result.ok).toBe(true);
    expect(data[MATERIALS_STORAGE_KEY]).toBeDefined();

    const reloaded = parseMaterialsState(data[MATERIALS_STORAGE_KEY]);
    expect(reloaded.notes[0].kcIds).toEqual(["c09", "c10"]);
    expect(reloaded.targets["data-structures"].sourceIds).toEqual(["ds-textbook", "ds-lecture"]);
  });

  it("没有浏览器存储时返回 ok:false，而不是假装保存成功", () => {
    // vitest 的 node 环境没有 window
    const result = saveMaterials(validState);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("本地存储");
  });
});
