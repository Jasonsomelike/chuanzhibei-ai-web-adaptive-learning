import { describe, expect, it } from "vitest";

import {
  ANSWER_SHAPE,
  ANSWER_TIERS,
  BANNED_EXAMPLES,
  BASE_RULES,
  DEFAULT_TUTOR_TONE,
  TONE_BLOCKS,
  TONE_LABELS,
  TUTOR_IDENTITY,
  TUTOR_TONES,
  UNCERTAINTY_PROTOCOL,
  findBannedPhrases,
  isTutorTone,
  parseAnswerSections,
  tutorSystemPrompt,
} from "@/lib/tutorPersona";

describe("tutorSystemPrompt（三套语气共用一套规则）", () => {
  it("固定身份与 12 条安全规则对每套语气逐字一致", () => {
    expect(BASE_RULES).toHaveLength(12);
    // 12 条安全口径逐条在位：引用、[资料n]、网络未核对、不得编造页码、资料没有就说没有。
    expect(BASE_RULES.join("\n")).toContain("[知识点ID]");
    expect(BASE_RULES.join("\n")).toContain("[资料n]");
    expect(BASE_RULES.join("\n")).toContain("[网络n]");
    expect(BASE_RULES.join("\n")).toContain("不得编造页码");
    expect(BASE_RULES.join("\n")).toContain("教材 / 资料里没有的就说没有");

    for (const tone of TUTOR_TONES) {
      const prompt = tutorSystemPrompt({ tone });
      expect(prompt).toContain(TUTOR_IDENTITY);
      for (const rule of BASE_RULES) expect(prompt).toContain(rule);
      expect(prompt).toContain(`【语气：${TONE_LABELS[tone]}】`);
    }
  });

  it("三套语气的差别只在语气块，回答结构与不确定协议不变", () => {
    const prompts = TUTOR_TONES.map((tone) => tutorSystemPrompt({ tone }));
    expect(new Set(prompts).size).toBe(3);

    expect(prompts[0]).toContain(TONE_BLOCKS.companion[0]);
    expect(prompts[1]).toContain(TONE_BLOCKS.senior[0]);
    expect(prompts[2]).toContain(TONE_BLOCKS.strict[0]);

    // 陪伴语气的句子不能出现在严格语气里，反之亦然。
    expect(prompts[2]).not.toContain(TONE_BLOCKS.companion[0]);
    expect(prompts[0]).not.toContain(TONE_BLOCKS.strict[0]);

    for (const prompt of prompts) {
      expect(prompt).toContain("【回答结构】");
      expect(prompt).toContain("【不确定时】");
      expect(prompt).toContain("【禁语与改写】");
    }
  });

  it("默认语气是陪伴，未知语气不被接受", () => {
    expect(DEFAULT_TUTOR_TONE).toBe("companion");
    expect(tutorSystemPrompt()).toBe(tutorSystemPrompt({ tone: "companion" }));
    expect(isTutorTone("senior")).toBe(true);
    expect(isTutorTone("rude")).toBe(false);
  });
});

describe("回答结构（声明必须在结论之前）", () => {
  it("结构顺序固定：声明 → 结论 → 解释 → 例子 → 易错点 → 下一步", () => {
    expect(ANSWER_SHAPE.map((part) => part.label)).toEqual([
      "声明",
      "结论",
      "解释",
      "例子",
      "易错点",
      "下一步",
    ]);
    const declaration = ANSWER_SHAPE.findIndex((part) => part.key === "declaration");
    const conclusion = ANSWER_SHAPE.findIndex((part) => part.key === "conclusion");
    expect(declaration).toBeLessThan(conclusion);
    expect(ANSWER_SHAPE[conclusion]?.guidance).toContain("40 字以内");
  });

  it("提示词明确要求声明排在结论之前", () => {
    const prompt = tutorSystemPrompt({ tone: "strict" });
    expect(prompt).toContain("声明必须排在结论之前");
    expect(prompt).toContain("再写「结论：」");
    // 解析器也认这个顺序：声明先于第一个标签。
    const parsed = parseAnswerSections("以下内容不是来自你的教材。\n结论：甲。\n解释：乙。");
    expect(parsed.declaration).toBe("以下内容不是来自你的教材。");
    expect(parsed.order[0]).toBe("conclusion");
  });
});

describe("长度只看结构（三档，不设总字数预算）", () => {
  it("短 / 中 / 长三档按段落与例子数递进", () => {
    expect(ANSWER_TIERS.map((tier) => tier.label)).toEqual(["短答", "中答", "长答"]);
    const [short, medium, long] = ANSWER_TIERS;
    expect(short?.includesPitfall).toBe(false);
    expect(medium?.includesPitfall).toBe(true);
    expect(long?.includesPitfall).toBe(true);
    expect([short?.exampleCount, medium?.exampleCount, long?.exampleCount]).toEqual([1, 1, 2]);
    expect(short?.requiredKeys.length).toBeLessThan(medium?.requiredKeys.length ?? 0);
    expect(short?.requiredKeys.every((key) => medium?.requiredKeys.includes(key))).toBe(true);
  });

  it("三档说明里没有「多少字」的硬预算，提示词也没有旧的 200 字上限", () => {
    for (const tier of ANSWER_TIERS) {
      expect(/\d+\s*字/.test(tier.guidance)).toBe(false);
    }
    for (const tone of TUTOR_TONES) {
      const prompt = tutorSystemPrompt({ tone });
      expect(prompt).not.toContain("200 字");
      expect(prompt).not.toContain("总字数");
    }
  });
});

describe("禁语命中", () => {
  it("序数套话与空话开场会被命中", () => {
    expect(findBannedPhrases("首先，我们看定义。").map((hit) => hit.phrase)).toEqual(["首先"]);
    expect(
      findBannedPhrases("综上所述，答案是 B。").map((hit) => hit.phrase),
    ).toEqual(["综上所述"]);
  });

  it("大小写与空格不敏感：「作为 AI」与「作为AI」算同一条", () => {
    expect(findBannedPhrases("作为 AI 助手，我认为").map((hit) => hit.phrase)).toEqual(["作为 AI"]);
    expect(findBannedPhrases("作为AI，我认为").map((hit) => hit.phrase)).toEqual(["作为 AI"]);
  });

  it("干净回答不误伤；命中只报一次", () => {
    expect(findBannedPhrases("结论：栈是后进先出。例子：1、2、3 依次压栈。")).toEqual([]);
    expect(findBannedPhrases("首先，首先还是首先").map((hit) => hit.phrase)).toEqual(["首先"]);
  });

  it("提示词带整句反例与改写，而不是只列禁词", () => {
    const prompt = tutorSystemPrompt({ tone: "senior" });
    expect(prompt).toContain("【反例 → 改写】");
    for (const example of BANNED_EXAMPLES) {
      expect(prompt).toContain(example.before);
      expect(prompt).toContain(example.after);
    }
  });
});

describe("不确定协议", () => {
  it("三支齐全：资料没有 / 两说并存 / 我不确定，且都要求说清怎么验证或出处", () => {
    expect(UNCERTAINTY_PROTOCOL.map((branch) => branch.key)).toEqual([
      "absent",
      "conflict",
      "unsure",
    ]);
    const text = UNCERTAINTY_PROTOCOL.map((branch) => branch.wording).join("\n");
    expect(text).toContain("资料里没有");
    expect(text).toContain("两说并存");
    expect(text).toContain("我不确定");
    expect(text).toContain("验证");
  });
});

describe("parseAnswerSections", () => {
  it("按标签切开，声明是第一个标签之前的文字", () => {
    const parsed = parseAnswerSections(
      "以下内容不是来自你的教材。\n结论：栈后进先出。\n解释：只在一端插入删除。\n例子：1、2、3 压栈后弹出 3、2、1。\n下一步：做第 3 题。",
    );
    expect(parsed.declaration).toBe("以下内容不是来自你的教材。");
    expect(parsed.sections.conclusion).toBe("栈后进先出。");
    expect(parsed.sections.example).toContain("3、2、1");
    expect(parsed.order).toEqual(["conclusion", "explanation", "example", "nextStep"]);
  });

  it("正文里的「我举个例子：」不算段落标签", () => {
    const parsed = parseAnswerSections("结论：甲。\n解释：乙。我举个例子：丙。\n下一步：做第 2 题。");
    expect(parsed.sections.example).toBeUndefined();
    expect(parsed.sections.explanation).toContain("我举个例子");
  });

  it("单独一行的「——」之后是附录，不并进最后一段", () => {
    const parsed = parseAnswerSections("结论：甲。\n下一步：做第 2 题。\n\n——\n参考材料（原文，未改写）\n**栈** [c09]");
    expect(parsed.sections.nextStep).toBe("做第 2 题。");
    expect(parsed.sections.nextStep).not.toContain("参考材料");
  });

  it("加粗标签与【】标签也能识别", () => {
    const parsed = parseAnswerSections(
      "结论：甲。\n**解释**：乙。\n【例子】「丙丁戊己」\n下一步：做第 1 题。",
    );
    expect(parsed.sections.explanation).toBe("乙。");
    expect(parsed.sections.example).toContain("丙丁戊己");
    expect(parsed.order).toEqual(["conclusion", "explanation", "example", "nextStep"]);
  });

  it("没有任何标签时整段算声明前的文字", () => {
    const parsed = parseAnswerSections("就是一段普通回答。");
    expect(parsed.declaration).toBe("就是一段普通回答。");
    expect(parsed.order).toEqual([]);
  });
});
