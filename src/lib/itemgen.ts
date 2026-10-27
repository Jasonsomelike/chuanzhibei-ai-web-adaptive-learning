/**
 * 生成题目的确定性校验。
 *
 * 这里没有任何 LLM 调用，全是纯函数：同样的模型输出，任何时候跑出同样的结论。
 * 这一条是「不信任模型输出」的落点——模型说的话只当候选，
 * 能不能进题库由这里的代码决定。
 *
 * 校验分五层，见 research 与 README 的「题目来源策略」：
 *   L1 结构   zod schema（4 题、4 选项、字段齐全）
 *   L2 卫生   选项互异、无「以上都对」、题干长度、解析含答案片段、同 KC 去重
 *   L3 答案   answerText 必须逐字等于恰好一个选项
 *   L4 双解   两次独立批解（其中一次反转选项顺序）必须选同一文本 —— 需要网络，不在这里
 *   L5 难度   三档标签映射到 2/3/4，不做算术收缩
 *
 * L4 是唯一需要发请求的一层，所以它留在调用方（诊断页/方向页），
 * 本文件只提供「怎么问」与「怎么比对」两个纯函数。
 */

import { z } from "zod";
import type { Difficulty } from "@/lib/mastery";
import type { Question } from "@/data/questions";
import { sha256Sync } from "@/lib/plan";

/** 题目来源。borrowed = 从内置学科题库按知识点名借用。 */
export type ItemSource = "generated" | "borrowed" | "manual";

/** accepted = 计入掌握度；practice = 可做但不计证据；rejected = 不展示。 */
export type ItemStatus = "accepted" | "practice" | "rejected";

/** 一道落在库里的题。字段与 Question 对齐，另加来源与校验痕迹。 */
export interface DirectionItem extends Question {
  readonly directionId: string;
  readonly source: ItemSource;
  readonly status: ItemStatus;
  /** 通过/未通过的检查项，便于界面如实展示「已通过 N 项校验」。 */
  readonly checks: readonly string[];
  readonly contentHash: string;
  readonly createdAt: string;
}

/** 难度三档。刻意不给 d=5：题库里没有这个档位，凭空引入无法校准。 */
export const DIFFICULTY_TIERS = ["basic", "advanced", "challenge"] as const;
export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

/** 三档 → 2/3/4。直接映射本身就是收缩，不再套 round(0.5d+1) 之类的公式。 */
export function tierToDifficulty(tier: DifficultyTier): Difficulty {
  switch (tier) {
    case "basic":
      return 2;
    case "advanced":
      return 3;
    case "challenge":
      return 4;
  }
}

/** 生成题证据折扣：标签来自模型，可信度低于人工校准的内置题。 */
export const GENERATED_WEIGHT_SCALE = 0.8;

/** 一次生成请求要几道题（生成题打 0.8 折，所以要 4 道才够）。 */
export const ITEMS_PER_KC = 4;

/**
 * 某 KC 的证据门槛：accepted 里只要有生成题就要 4 道，否则 3 道。
 *
 * 这是**唯一**的门槛定义，诊断页的停测、方向页的「就绪」判断都走这里。
 * 曾经两处各写一份（诊断按来源算 3/4，方向页写死 4），
 * 结果手动题 3 道已可诊断、方向页却显示「未就绪」。
 */
export function kcEvidenceTarget(sources: readonly ItemSource[]): number {
  return sources.includes("generated") ? ITEMS_PER_KC : 3;
}

// ── L1 结构 ────────────────────────────────────────────────────────

const rawItemSchema = z.object({
  difficulty: z.enum(DIFFICULTY_TIERS),
  difficultyReason: z.string().optional(),
  stem: z.string(),
  options: z.array(z.string()).length(4),
  /** 刻意要文本而不是下标：模型数下标经常错位，抄文本可确定性核对。 */
  answerText: z.string(),
  explanation: z.string(),
});

export const rawBatchSchema = z.object({
  items: z.array(rawItemSchema).min(1).max(8),
});

export type RawItem = z.infer<typeof rawItemSchema>;
export type RawBatch = z.infer<typeof rawBatchSchema>;

/** L1：结构解析。失败返回 null 与原因，调用方据此整批重试一次。 */
export function parseBatch(
  raw: unknown,
): { ok: true; batch: RawBatch } | { ok: false; reason: string } {
  const parsed = rawBatchSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      reason: `结构不合格：${first ? `${first.path.join(".")} ${first.message}` : "未知"}`,
    };
  }
  return { ok: true, batch: parsed.data };
}

// ── 归一化 ────────────────────────────────────────────────────────

/**
 * 比对用的归一化：去所有空白、统一小写、去尾部句读。
 *
 * 刻意不去括号：`O(1)` 与 `O(1` 必须算两个不同选项，
 * 否则「去括号」会把数学表达式改成另一个意思。
 */
export function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[。．.！!？?；;：:、，,「」『』"'"'']+$/g, "");
}

const BANNED_OPTION_PATTERNS = [
  /以上(都|均)?(对|正确|是)/,
  /以上(都|均)?(错|不正确|不是)/,
  /以上(两|三|四)?者?都/,
  /无法确定/,
  /都不对/,
  /all of the above/i,
  /none of the above/i,
];

// ── L2 / L3 ───────────────────────────────────────────────────────

export interface ItemCheckResult {
  readonly item: DirectionItem;
  /** 未通过项。空数组表示 L2+L3 全过。 */
  readonly issues: readonly string[];
  /** 不构成拒绝的提示（如 L5 难度理由不匹配），供人工核查生成质量。 */
  readonly notes: readonly string[];
}

/**
 * 校验单题。返回的 status：
 *   accepted —— L2、L3 全过
 *   rejected —— L2 或 L3 失败。L3 失败时我们不知道正确答案，
 *               不能降级成 practice，否则诊断会按一个瞎猜的下标判分
 *   practice —— 只由调用方在 L4 双解不一致时降级，本函数不产生
 */
export function checkItem(
  raw: RawItem,
  meta: {
    readonly directionId: string;
    readonly kcId: string;
    readonly now: string;
    /** 同 KC 已存在的题干归一化集合，用于去重。 */
    readonly seenStems?: ReadonlySet<string>;
  },
): ItemCheckResult {
  const issues: string[] = [];
  const passed: string[] = [];
  const notes: string[] = [];

  const stem = raw.stem.trim();
  const options = raw.options.map((o) => o.trim());
  const explanation = raw.explanation.trim();

  // ── L2 ──
  if (stem.length < 8 || stem.length > 200) {
    issues.push(`题干长度 ${stem.length}，需在 8–200 字之间`);
  } else {
    passed.push("题干长度");
  }

  const normalizedOptions = options.map(normalizeText);
  if (normalizedOptions.some((o) => o === "")) {
    issues.push("存在空选项");
  } else if (new Set(normalizedOptions).size !== normalizedOptions.length) {
    issues.push("选项归一化后存在重复");
  } else {
    passed.push("选项互异");
  }

  const banned = options.filter((o) => BANNED_OPTION_PATTERNS.some((p) => p.test(o)));
  if (banned.length > 0) {
    issues.push(`选项含禁用表述：${banned.join("、")}`);
  } else {
    passed.push("无禁用表述");
  }

  if (explanation.length < 20) {
    issues.push(`解析长度 ${explanation.length}，至少 20 字`);
  } else {
    passed.push("解析长度");
  }

  // ── L3 先算，因为解析是否「提到答案」依赖答案是否对得上 ──
  const answerNorm = normalizeText(raw.answerText);
  const matches = options.filter((o) => normalizeText(o) === answerNorm);
  let answerIndex = -1;
  const l3Issues: string[] = [];
  if (matches.length !== 1) {
    l3Issues.push(
      matches.length === 0
        ? "answerText 与任何选项都不逐字相同"
        : `answerText 同时匹配 ${matches.length} 个选项`,
    );
  } else {
    answerIndex = options.findIndex((o) => normalizeText(o) === answerNorm);
    passed.push("答案唯一匹配");
  }

  /*
   * 解析必须提到正确选项，否则多半是答非所问。
   * 只在答案文本归一化后 ≥6 字时才检查——短答案（如「3,1,2」）常被解析
   * 换一种方式复述，硬查会误伤；这是可判定性边界，不是放松要求。
   */
  if (l3Issues.length === 0 && answerNorm.length >= 6) {
    if (normalizeText(explanation).includes(answerNorm.slice(0, 6))) {
      passed.push("解析含答案");
    } else {
      issues.push("解析未包含正确选项的前 6 个字");
    }
  }

  if (meta.seenStems?.has(normalizeText(stem))) {
    issues.push("题干与同知识点已有题目重复");
  } else {
    passed.push("题干未重复");
  }

  /*
   * L5 难度合理性：模型给的理由要提到与档位相符的字眼。
   * 这一层**不拒绝题目**（三档已经映射到 2/3/4），只把「标签与理由自相矛盾」
   * 记进 checks 的附注里，供人工核查生成质量。
   * 若把它计入 issues，会让「缺一句难度理由」这种小事把整道题丢掉。
   */
  const labelIssue = difficultyLabelIssue(raw);
  if (labelIssue !== null) {
    notes.push(labelIssue);
  } else {
    passed.push("难度理由相符");
  }

  const l2Ok = issues.length === 0;
  const l3Ok = l3Issues.length === 0;

  /*
   * L2 失败 → rejected：题目本身有问题。
   * L3 失败 → 也是 rejected：answerText 对不上任何选项，我们**不知道正确答案**，
   *   存成 practice 会让诊断按一个瞎猜的下标判分，学生选对也会被判错。
   *   只有 L4 失败才降级为 practice——那时答案文本是确定的，只是模型两次不一致。
   */
  const status: ItemStatus = l2Ok && l3Ok ? "accepted" : "rejected";

  const item: DirectionItem = {
    id: `di-${sha256Sync(`${meta.directionId}|${meta.kcId}|${normalizeText(stem)}`).slice(0, 16)}`,
    directionId: meta.directionId,
    kcId: meta.kcId,
    difficulty: tierToDifficulty(raw.difficulty),
    stem,
    options,
    // 仅 rejected 会走到 0；rejected 既不落库也不展示，不会拿来判分
    answerIndex: answerIndex < 0 ? 0 : answerIndex,
    explanation,
    source: "generated",
    status,
    /*
     * notes 并入 checks 落库（表里没有单独的 notes 列）。
     * 用「提示：」前缀区分「通过了什么」与「没通过但没拒绝」，
     * 界面据此显示「已通过 N 项校验」，人工核查时能看到哪条提示被触发。
     */
    checks: [...passed, ...notes.map((n) => `提示：${n}`)],
    contentHash: contentHashOf({ stem, options, explanation, kcId: meta.kcId }),
    createdAt: meta.now,
  };

  return { item, issues: [...issues, ...l3Issues], notes };
}

/** 内容指纹：同 KC 下题干+选项+解析相同视为同一题（唯一索引据此幂等）。 */
export function contentHashOf(input: {
  readonly kcId: string;
  readonly stem: string;
  readonly options: readonly string[];
  readonly explanation: string;
}): string {
  return sha256Sync(
    JSON.stringify({
      kcId: input.kcId,
      stem: normalizeText(input.stem),
      options: input.options.map(normalizeText),
      explanation: normalizeText(input.explanation),
    }),
  );
}

/** 一批题整批校验。同批内也做题干去重。 */
export function checkBatch(
  batch: RawBatch,
  meta: {
    readonly directionId: string;
    readonly kcId: string;
    readonly now: string;
    readonly seenStems?: ReadonlySet<string>;
  },
): ItemCheckResult[] {
  const seen = new Set(meta.seenStems ?? []);
  const out: ItemCheckResult[] = [];
  for (const raw of batch.items) {
    const result = checkItem(raw, { ...meta, seenStems: seen });
    seen.add(normalizeText(raw.stem));
    out.push(result);
  }
  return out;
}

// ── L4 双解校验（协议部分） ─────────────────────────────────────────

/**
 * 构造批解提示词。
 *
 * 刻意只给题干与选项，不给答案与解析——给了就是让模型复述，
 * 那样两次「独立」调用必然一致，校验失去意义。
 */
export function buildSolverPrompt(
  items: readonly { stem: string; options: readonly string[] }[],
  reverseOptions: boolean,
): string {
  const blocks = items.map((it, i) => {
    const opts = reverseOptions ? [...it.options].reverse() : [...it.options];
    const lines = opts.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join("\n");
    return `第 ${i + 1} 题：${it.stem}\n${lines}`;
  });

  return `你是严格的考试阅卷人。下面每道题只有一个正确选项。请只依据题干与选项判断，不要假设任何未给出的信息。

${blocks.join("\n\n")}

严格输出 JSON，不要解释文字：
{"answers":[{"index":1,"answerText":"与你选中的选项逐字相同的文本"}]}`;
}

/**
 * 比对两次批解与 L3 的答案。
 *
 * 返回每题是否一致。不一致的题降级为 practice——可做、记录作答、不计证据。
 * 注意第二次是反转选项顺序后问的，所以只比文本，不比下标。
 */
export function compareSolverAnswers(
  expected: readonly string[],
  first: readonly string[],
  reversed: readonly string[],
): boolean[] {
  return expected.map((want, i) => {
    const norm = normalizeText(want);
    return normalizeText(first[i] ?? "") === norm && normalizeText(reversed[i] ?? "") === norm;
  });
}

// ── L5 难度标签 ────────────────────────────────────────────────────

/**
 * 难度合理性：模型给的理由必须提到与档位相符的字眼。
 * 不匹配不拒绝，只记一条提示——难度标签本身已经映射到 2/3/4。
 */
export function difficultyLabelIssue(raw: RawItem): string | null {
  const reason = (raw.difficultyReason ?? "").trim();
  if (reason === "") return "缺少难度理由";
  const text = reason.toLowerCase();
  const expect: Record<DifficultyTier, string[]> = {
    basic: ["基础", "基本", "简单", "记忆", "概念", "定义", "识记"],
    advanced: ["进阶", "理解", "应用", "分析", "中等", "推导"],
    challenge: ["挑战", "综合", "难", "高阶", "创造", "评价", "证明"],
  };
  return expect[raw.difficulty].some((w) => text.includes(w))
    ? null
    : `难度理由与「${raw.difficulty}」档不匹配`;
}
