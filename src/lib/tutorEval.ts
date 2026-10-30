/**
 * 导师回答质量评测：10 条中文问题 + 8 维 0/1/2 rubric + 硬门。
 *
 * 设计取舍：
 * - 规则评分（默认，零 key）只看结构：段落是否齐、声明是否在结论前、例子是否具体、
 *   是否命中禁语。它覆盖不了「说得好不好」，所以调用方只报逐条分数，不报通过率。
 * - 默认答案来自 composeDeterministic：无模型路径是真实代码输出，不是手写金标，
 *   跑一次就能发现结构回退。
 * - LLM judge 只能替换「谁来打分」，不能替换「打分的尺子」：它必须逐条给一句
 *   逐字摘抄（quote），由 validateLlmJudge 校验确实是答案子串，否则该条作废。
 * - 8 维里只有 3 个硬门：R1≥1（结构不能缺两处以上）、R5=2（例子必须具体）、
 *   R7=2（不许出现禁语）。
 */

import type { UploadHit } from "@/lib/knowledge";
import type { MasteryState } from "@/lib/mastery";
import type { MaterialExcerpt } from "@/lib/materials";
import type { RetrievedDoc } from "@/lib/rag";
import type { WebHit } from "@/lib/websearch";
import { composeDeterministic, COMPOSED_DECLARATIONS, type ComposeInput } from "@/components/tutor-logic";
import {
  findBannedPhrases,
  parseAnswerSections,
  type AnswerSectionKey,
  type ParsedAnswer,
} from "@/lib/tutorPersona";

// ── 评测集 ────────────────────────────────────────────────────────

export type TutorEvalKind =
  | "grounded"
  | "knowledge-only"
  | "answer-absent"
  | "conflict"
  | "upload-only"
  | "web-only";

export interface TutorEvalCase {
  readonly id: string;
  readonly kind: TutorEvalKind;
  readonly question: string;
  /** 本次回答是否必须写声明；与 fixtures 会不会触发声明无关，是期望值。 */
  readonly needsDeclaration: boolean;
  /** 期望如实说「资料里没有」。 */
  readonly expectsAbsence: boolean;
  /** 期望出现「两说并存」并保留两边出处。 */
  readonly expectsConflict: boolean;
  /** 期望的声明原句；不需要声明时为 null。 */
  readonly declaration: string | null;
  /** 生成默认答案用的检索 / 材料夹具（question 单独给）。 */
  readonly fixtures: Omit<ComposeInput, "question">;
}

function doc(kcId: string, title: string, snippet: string, score = 1): RetrievedDoc {
  return { kcId, title, snippet, score };
}

function mastery(kcId: string, alpha: number, beta: number, evidenceN: number): MasteryState {
  return { kcId, alpha, beta, evidenceN };
}

function textbook(
  text: string,
  overrides: Partial<Omit<MaterialExcerpt, "text">> = {},
): MaterialExcerpt {
  return {
    chunkId: "chunk-1",
    sourceId: "src-1",
    sourceTitle: "数据结构（C 语言版）",
    kind: "textbook",
    chapter: "第3章 栈与队列",
    section: "3.1",
    pageFrom: 45,
    pageTo: 46,
    text,
    truncated: false,
    ...overrides,
  };
}

function upload(
  id: string,
  title: string,
  section: string,
  page: number,
  text: string,
): UploadHit {
  return {
    score: 1,
    chunk: {
      id,
      docId: `doc-${id}`,
      directionId: "dir-1",
      title,
      section,
      pageFrom: page,
      pageTo: page,
      text,
      index: 0,
    },
  };
}

function web(ref: number, title: string, url: string, snippet: string): WebHit {
  const host = url.replace(/^https?:\/\//, "").split("/")[0] ?? "";
  return { title, url, snippet, provider: "tavily", ref, label: `《${title}》 ${host}` };
}

const NO_MASTERY: readonly MasteryState[] = [];
const NO_UPLOADS: readonly UploadHit[] = [];
const NO_WEB: readonly WebHit[] = [];
const NO_EXCERPTS: ReadonlyMap<string, MaterialExcerpt> = new Map();

/**
 * 10 条中文问题，覆盖：教材命中 / 只有知识点摘要 / 资料没有 / 两说并存 /
 * 只有上传资料 / 只有网络线索 / 多知识点复习。
 */
export const TUTOR_EVAL_CASES: readonly TutorEvalCase[] = [
  {
    id: "t01",
    kind: "grounded",
    question: "栈和队列到底有什么区别？",
    needsDeclaration: false,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: null,
    fixtures: {
      docs: [doc("c09", "栈", "栈是后进先出的线性表", 2.1), doc("c10", "队列", "队列是先进先出的线性表", 1.7)],
      mastery: [mastery("c09", 3, 1, 4)],
      excerpts: new Map([
        ["c09", textbook("栈是限定仅在表尾进行插入和删除操作的线性表。")],
      ]),
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
  {
    id: "t02",
    kind: "knowledge-only",
    question: "为什么我的路径里先学栈再学队列？",
    needsDeclaration: true,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: COMPOSED_DECLARATIONS.knowledgeOnly,
    fixtures: {
      docs: [doc("c09", "栈", "后进先出的受限线性表，理解栈顶与入出栈", 2.3)],
      mastery: [mastery("c09", 3, 1, 6)],
      excerpts: NO_EXCERPTS,
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
  {
    id: "t03",
    kind: "grounded",
    question: "这道括号匹配题我选了 B，答案是 C，我错在哪？",
    needsDeclaration: false,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: null,
    fixtures: {
      docs: [doc("c11", "栈的应用", "括号匹配、表达式求值、递归转非递归", 1.9)],
      mastery: [mastery("c11", 2, 1, 3)],
      excerpts: new Map([
        [
          "c11",
          textbook("遇到右括号时弹出栈顶，若栈为空或括号类型不匹配则说明序列非法。", {
            chapter: "第3章 栈与队列",
            pageFrom: 52,
            pageTo: 52,
          }),
        ],
      ]),
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
  {
    id: "t04",
    kind: "answer-absent",
    question: "Dijkstra 为什么不能处理负权边？",
    needsDeclaration: true,
    expectsAbsence: true,
    expectsConflict: false,
    declaration: COMPOSED_DECLARATIONS.absent,
    fixtures: {
      docs: [],
      mastery: NO_MASTERY,
      excerpts: NO_EXCERPTS,
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
  {
    id: "t05",
    kind: "conflict",
    question: "教材说栈顶在表尾，我看到的讲义说栈顶在表头，到底哪个对？",
    needsDeclaration: false,
    expectsAbsence: false,
    expectsConflict: true,
    declaration: null,
    fixtures: {
      docs: [doc("c09", "栈", "后进先出的受限线性表，理解栈顶与入出栈", 2.0)],
      mastery: [mastery("c09", 3, 1, 4)],
      excerpts: new Map([
        ["c09", textbook("栈是限定仅在表尾进行插入和删除操作的线性表。")],
      ]),
      uploads: NO_UPLOADS,
      web: NO_WEB,
      conflicts: [
        "「栈顶位置」尚未选定口径：《数据结构（C 语言版）》称「栈顶是表尾允许插入和删除的一端」，讲义《数据结构讲义.pdf》称「栈顶在表头」",
      ],
    },
  },
  {
    id: "t06",
    kind: "upload-only",
    question: "我上传的讲义里这道例题的第二步怎么来的？",
    needsDeclaration: false,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: null,
    fixtures: {
      docs: [],
      mastery: NO_MASTERY,
      excerpts: NO_EXCERPTS,
      uploads: [
        upload(
          "up-1",
          "数据结构讲义.pdf",
          "第3页",
          3,
          "例题：用栈判断括号匹配。第一步压入左括号，第二步遇到右括号时弹出栈顶并比较类型。",
        ),
      ],
      web: NO_WEB,
    },
  },
  {
    id: "t07",
    kind: "web-only",
    question: "网上说 B+ 树比 B 树更适合做磁盘索引，这个说法对吗？",
    needsDeclaration: true,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: COMPOSED_DECLARATIONS.webOnly,
    fixtures: {
      docs: [],
      mastery: NO_MASTERY,
      excerpts: NO_EXCERPTS,
      uploads: NO_UPLOADS,
      web: [
        web(
          1,
          "B+ 树",
          "https://zh.wikipedia.org/wiki/B+树",
          "B+ 树的非叶结点只存键，数据都放在叶结点，叶结点之间用指针相连。",
        ),
      ],
    },
  },
  {
    id: "t08",
    kind: "grounded",
    question: "帮我用一句话总结这一章（栈与队列）的三个重点。",
    needsDeclaration: false,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: null,
    fixtures: {
      docs: [
        doc("c09", "栈", "后进先出的受限线性表", 2.4),
        doc("c10", "队列", "先进先出，注意循环队列的判空判满", 2.2),
        doc("c11", "栈的应用", "括号匹配、表达式求值", 1.8),
      ],
      mastery: [mastery("c09", 3, 1, 4)],
      excerpts: new Map([
        ["c09", textbook("栈是限定仅在表尾进行插入和删除操作的线性表。")],
        ["c10", textbook("队列是只允许在表的一端插入、另一端删除的线性表。", { chapter: "第3章 栈与队列", pageFrom: 58, pageTo: 59 })],
      ]),
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
  {
    id: "t09",
    kind: "knowledge-only",
    question: "为什么这个循环的时间复杂度是 O(n) 而不是 O(n²)？",
    needsDeclaration: true,
    expectsAbsence: false,
    expectsConflict: false,
    declaration: COMPOSED_DECLARATIONS.knowledgeOnly,
    fixtures: {
      docs: [doc("c02", "时间复杂度分析", "只统计随规模增长的主项，常数与低阶项忽略", 2.6)],
      mastery: NO_MASTERY,
      excerpts: NO_EXCERPTS,
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
  {
    id: "t10",
    kind: "answer-absent",
    question: "我们课本里有没有讲红黑树的删除？",
    needsDeclaration: true,
    expectsAbsence: true,
    expectsConflict: false,
    declaration: COMPOSED_DECLARATIONS.absent,
    fixtures: {
      docs: [],
      mastery: NO_MASTERY,
      excerpts: NO_EXCERPTS,
      uploads: NO_UPLOADS,
      web: NO_WEB,
    },
  },
];

/** 默认答案：真实的无模型路径输出，不是手写金标。 */
export function deterministicAnswerFor(testCase: TutorEvalCase): string {
  return composeDeterministic({ question: testCase.question, ...testCase.fixtures }).text;
}

// ── 8 维 rubric ───────────────────────────────────────────────────

export const RUBRIC_DIMENSIONS = [
  { id: "R1", label: "结构完整", gate: 1, op: ">=" },
  { id: "R2", label: "结论先行", gate: null, op: ">=" },
  { id: "R3", label: "结论不超过 40 字", gate: null, op: ">=" },
  { id: "R4", label: "声明在结论之前", gate: null, op: ">=" },
  { id: "R5", label: "例子具体", gate: 2, op: "=" },
  { id: "R6", label: "下一步可执行", gate: null, op: ">=" },
  { id: "R7", label: "无禁语", gate: 2, op: "=" },
  { id: "R8", label: "不确定协议", gate: null, op: ">=" },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly gate: number | null;
  readonly op: ">=" | "=";
}[];

export type RubricId = (typeof RUBRIC_DIMENSIONS)[number]["id"];

export interface DimensionScore {
  readonly id: RubricId;
  readonly label: string;
  readonly score: 0 | 1 | 2;
  readonly reason: string;
}

export interface CaseJudgement {
  readonly caseId: string;
  readonly kind: TutorEvalKind;
  readonly answerChars: number;
  readonly scores: readonly DimensionScore[];
}

const REQUIRED_SECTIONS: readonly AnswerSectionKey[] = [
  "conclusion",
  "explanation",
  "example",
  "nextStep",
];

function codePoints(text: string): number {
  return Array.from(text.trim()).length;
}

function dimension(
  id: RubricId,
  score: 0 | 1 | 2,
  reason: string,
): DimensionScore {
  const meta = RUBRIC_DIMENSIONS.find((item) => item.id === id);
  return { id, label: meta?.label ?? id, score, reason };
}

function scoreStructure(testCase: TutorEvalCase, parsed: ParsedAnswer, answer: string): DimensionScore {
  const hasDeclaration = testCase.needsDeclaration
    ? testCase.declaration !== null
      ? answer.includes(testCase.declaration)
      : parsed.declaration !== ""
    : false;
  const missingSections = REQUIRED_SECTIONS.filter(
    (key) => (parsed.sections[key] ?? "").trim() === "",
  );
  const missing = missingSections.length + (testCase.needsDeclaration && !hasDeclaration ? 1 : 0);
  if (missing === 0) return dimension("R1", 2, "声明（按需）与结论 / 解释 / 例子 / 下一步齐备");
  if (missing === 1) return dimension("R1", 1, "缺少一处必需段落");
  return dimension("R1", 0, `缺少 ${missing} 处必需段落`);
}

function scoreConclusionFirst(parsed: ParsedAnswer): DimensionScore {
  const first = parsed.order[0];
  if (first === undefined) return dimension("R2", 0, "没有任何段落标签，无法判断结论位置");
  if (first === "conclusion") return dimension("R2", 2, "第一个段落就是结论");
  return dimension("R2", 1, `第一个段落是「${first}」，结论被推后`);
}

function scoreConclusionLength(parsed: ParsedAnswer): DimensionScore {
  const conclusion = parsed.sections.conclusion ?? "";
  if (conclusion.trim() === "") return dimension("R3", 0, "没有结论段");
  const length = codePoints(conclusion);
  if (length <= 40) return dimension("R3", 2, `结论 ${length} 字`);
  if (length <= 60) return dimension("R3", 1, `结论 ${length} 字，超过 40 字`);
  return dimension("R3", 0, `结论 ${length} 字，已经不像一句结论`);
}

function scoreDeclarationPosition(
  testCase: TutorEvalCase,
  answer: string,
): DimensionScore {
  if (!testCase.needsDeclaration) return dimension("R4", 2, "本次不需要声明");
  if (testCase.declaration === null) return dimension("R4", 2, "没有指定声明句");
  const declarationIndex = answer.indexOf(testCase.declaration);
  if (declarationIndex < 0) {
    return answer.includes("不是来自你的教材")
      ? dimension("R4", 1, "有「不是来自你的教材」的说法，但不是标准声明句")
      : dimension("R4", 0, "缺少声明");
  }
  const conclusionIndex = answer.indexOf("结论：");
  if (conclusionIndex < 0) return dimension("R4", 1, "有声明，但没有结论段可定位");
  return declarationIndex < conclusionIndex
    ? dimension("R4", 2, "声明在结论之前")
    : dimension("R4", 1, "声明落在结论之后");
}

const CONCRETE_EXAMPLE_RE =
  /[「『][^」』]{4,}[」』]|《[^》]+》|`[^`]{3,}`|\[(教材|讲义|资料\d+|网络\d+)\b|\[[a-z]\d{1,3}\]|\d/;

function scoreExample(testCase: TutorEvalCase, parsed: ParsedAnswer): DimensionScore {
  const example = (parsed.sections.example ?? "").trim();
  if (example === "") return dimension("R5", 0, "没有例子段");
  if (testCase.expectsAbsence && /没有可引用|没有原文|不给例子|没有例子/.test(example)) {
    return dimension("R5", 2, "资料确实没有原文，如实说明不给例子");
  }
  if (CONCRETE_EXAMPLE_RE.test(example)) return dimension("R5", 2, "例子带有可核对的具体内容");
  if (/比如|例如/.test(example)) return dimension("R5", 1, "只有「比如」，没有具体内容");
  return dimension("R5", 1, "例子存在，但看不出具体对象");
}

const ACTIONABLE_STEP_RE =
  /第\s*\d+\s*[页步章题]|\d+\s*(道|题|行|步|页)|「[^」]+」|《[^》]+》|\[[a-z]\d+\]|诊断|教材|摘录|例题|代码/;

function scoreNextStep(parsed: ParsedAnswer): DimensionScore {
  const nextStep = (parsed.sections.nextStep ?? "").trim();
  if (nextStep === "") return dimension("R6", 0, "没有下一步");
  if (ACTIONABLE_STEP_RE.test(nextStep)) return dimension("R6", 2, "下一步指向具体动作或位置");
  if (/继续努力|加油|多练习|好好学习|慢慢来/.test(nextStep)) {
    return dimension("R6", 1, "下一步只有鼓励，没有动作");
  }
  return dimension("R6", 1, "下一步存在，但不够具体");
}

function scoreBanned(answer: string): DimensionScore {
  const hits = findBannedPhrases(answer);
  if (hits.length === 0) return dimension("R7", 2, "没有命中禁语");
  const names = hits.map((hit) => hit.phrase).join("、");
  return hits.length <= 2
    ? dimension("R7", 1, `命中禁语：${names}`)
    : dimension("R7", 0, `命中 ${hits.length} 条禁语：${names}`);
}

function scoreUncertainty(testCase: TutorEvalCase, answer: string): DimensionScore {
  if (testCase.expectsAbsence) {
    if (/资料里没有|没有找到|没有检索到|没有可引用/.test(answer)) {
      return dimension("R8", 2, "资料没有时如实说明，没有硬答");
    }
    if (/我不确定/.test(answer)) return dimension("R8", 1, "说了不确定，但没说明资料里没有");
    return dimension("R8", 0, "资料没有却给出了确定答案");
  }

  if (testCase.expectsConflict) {
    const hasBoth = /两说并存|两种说法|各有出处|未选定口径/.test(answer);
    const claimCount = (answer.match(/称「/g) ?? []).length;
    if (hasBoth && claimCount >= 2) return dimension("R8", 2, "两说并存，两边出处都在");
    if (hasBoth) return dimension("R8", 1, "说了两说，但只保留了一边出处");
    return dimension("R8", 0, "没有指出两说并存");
  }

  if (testCase.needsDeclaration) {
    if (testCase.declaration !== null && answer.includes(testCase.declaration)) {
      return dimension("R8", 2, "通用知识已按要求声明");
    }
    return /不是来自你的教材/.test(answer)
      ? dimension("R8", 1, "有声明但措辞不标准")
      : dimension("R8", 0, "没有声明就给出通用知识结论");
  }

  return /资料里没有这条的答案|我不确定/.test(answer)
    ? dimension("R8", 1, "有资料依据却说不知道")
    : dimension("R8", 2, "有资料依据，直接给结论");
}

/**
 * 规则评分：只看结构，不看内容对不对。
 *
 * 它必须对「好样例」和「坏样例」给出明显不同的分数，否则硬门没有意义；
 * 但不要指望它判断解释是否讲对——那是 LLM judge 和人工校准的事。
 */
export function judgeAnswerByRules(input: {
  readonly case: TutorEvalCase;
  readonly answer: string;
}): CaseJudgement {
  const parsed = parseAnswerSections(input.answer);
  const scores: readonly DimensionScore[] = [
    scoreStructure(input.case, parsed, input.answer),
    scoreConclusionFirst(parsed),
    scoreConclusionLength(parsed),
    scoreDeclarationPosition(input.case, input.answer),
    scoreExample(input.case, parsed),
    scoreNextStep(parsed),
    scoreBanned(input.answer),
    scoreUncertainty(input.case, input.answer),
  ];

  return {
    caseId: input.case.id,
    kind: input.case.kind,
    answerChars: codePoints(input.answer),
    scores,
  };
}

// ── 硬门 ──────────────────────────────────────────────────────────

export interface HardGateResult {
  readonly id: RubricId;
  readonly label: string;
  /** 要求的最低分：R1 要求 ≥1，R5 / R7 要求 =2。 */
  readonly threshold: number;
  readonly op: ">=" | "=";
  readonly passed: boolean;
  readonly failedCaseIds: readonly string[];
}

/** 按维度求硬门结果；不输出通过率，只列出没过的条目。 */
export function evaluateHardGates(judgements: readonly CaseJudgement[]): HardGateResult[] {
  return RUBRIC_DIMENSIONS.filter((item) => item.gate !== null).map((item) => {
    const failed = judgements.filter((judgement) => {
      const score = judgement.scores.find((entry) => entry.id === item.id)?.score ?? 0;
      return score < (item.gate as number);
    });
    return {
      id: item.id,
      label: item.label,
      threshold: item.gate as number,
      op: item.op,
      passed: failed.length === 0,
      failedCaseIds: failed.map((judgement) => judgement.caseId),
    };
  });
}

// ── LLM judge：必须逐条 quote，代码校验子串 ─────────────────────────

export interface JudgeRequestItem {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

export interface LlmJudgeItem {
  readonly id: string;
  readonly quote: string;
  readonly scores: Readonly<Record<RubricId, number>>;
  readonly reason: string;
}

export interface JudgeRejection {
  readonly id: string;
  readonly reason: string;
}

export interface JudgeParseResult {
  readonly items: readonly LlmJudgeItem[];
  readonly rejected: readonly JudgeRejection[];
}

/** judge 的评分尺子与规则评分共用同一份维度定义。 */
export function buildJudgePrompt(items: readonly JudgeRequestItem[]): string {
  const dimensions = RUBRIC_DIMENSIONS.map(
    (item) =>
      `- ${item.id} ${item.label}：0 = 缺失或错误；1 = 部分做到；2 = 做到。` +
      (item.gate === null ? "" : `（硬门：至少 ${item.gate} 分）`),
  ).join("\n");

  const payload = items
    .map(
      (item) =>
        `### ${item.id}\n问题：${item.question}\n回答：\n${item.answer}\n`,
    )
    .join("\n");

  return [
    "你是严格的导师回答评审。只按下面的 8 个维度给每条回答打分，不要改写回答。",
    dimensions,
    "",
    "输出必须是一个 JSON 数组，每项恰好包含：",
    '{"id":"t01","quote":"从该条回答里逐字复制的一句原文","scores":{"R1":2,"R2":2,"R3":2,"R4":2,"R5":2,"R6":2,"R7":2,"R8":2},"reason":"一句话说明"}',
    "硬性要求：quote 必须逐字出现在该条回答里（不能改写、不能拼接、不能跨段），否则该条评分无效。",
    "每条回答都要有一项，不能漏、不能多。只输出 JSON 数组，不要加代码块或解释。",
    "",
    "待评回答：",
    payload,
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? (fenced[1] ?? "") : trimmed;
}

/**
 * 校验 judge 输出：逐条必须有 quote，且 quote 是该条答案的子串。
 *
 * 任何一条不合格都不放行——宁可把硬门判失败，也不接受「看起来打了分」。
 */
export function validateLlmJudge(
  raw: string,
  answers: ReadonlyMap<string, string>,
): JudgeParseResult {
  const rejected: JudgeRejection[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { items: [], rejected: [{ id: "*", reason: `judge 输出不是 JSON：${reason}` }] };
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : null;
  if (rows === null) {
    return { items: [], rejected: [{ id: "*", reason: "judge 输出既不是数组也没有 items 数组" }] };
  }

  const items: LlmJudgeItem[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== "string") {
      rejected.push({ id: `#${index}`, reason: "缺少 id" });
      return;
    }
    const id = row.id;
    if (seen.has(id)) {
      rejected.push({ id, reason: "重复评分" });
      return;
    }
    seen.add(id);

    const answer = answers.get(id);
    if (answer === undefined) {
      rejected.push({ id, reason: "不是本次评测的条目" });
      return;
    }

    const quote = typeof row.quote === "string" ? row.quote.trim() : "";
    if (quote === "") {
      rejected.push({ id, reason: "缺少 quote" });
      return;
    }
    if (!answer.includes(quote)) {
      rejected.push({ id, reason: `quote 不是答案子串：${quote.slice(0, 40)}` });
      return;
    }

    if (!isRecord(row.scores)) {
      rejected.push({ id, reason: "缺少 scores" });
      return;
    }
    const scores = {} as Record<RubricId, number>;
    for (const dimension of RUBRIC_DIMENSIONS) {
      const rawScore = row.scores[dimension.id];
      if (rawScore !== 0 && rawScore !== 1 && rawScore !== 2) {
        rejected.push({ id, reason: `${dimension.id} 不是 0/1/2` });
        return;
      }
      scores[dimension.id] = rawScore;
    }

    items.push({
      id,
      quote,
      scores,
      reason: typeof row.reason === "string" ? row.reason : "",
    });
  });

  for (const id of answers.keys()) {
    if (!seen.has(id)) rejected.push({ id, reason: "缺少该条评分" });
  }

  return { items, rejected };
}

/** 把 LLM judge 的逐条结果转成与规则评分相同的结构，供硬门复用。 */
export function judgementsFromLlm(
  testCases: readonly TutorEvalCase[],
  result: JudgeParseResult,
  answers?: ReadonlyMap<string, string>,
): CaseJudgement[] {
  const byId = new Map(result.items.map((item) => [item.id, item] as const));
  return testCases.map((testCase) => {
    const item = byId.get(testCase.id);
    const scores: DimensionScore[] = RUBRIC_DIMENSIONS.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      score: (item?.scores[dimension.id] ?? 0) as 0 | 1 | 2,
      reason: item === undefined ? "judge 未给出有效评分" : item.reason,
    }));
    return {
      caseId: testCase.id,
      kind: testCase.kind,
      answerChars: answers === undefined ? 0 : codePoints(answers.get(testCase.id) ?? ""),
      scores,
    };
  });
}
