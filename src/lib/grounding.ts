/**
 * 回答依据的选择：网络结果筛选 + 回答策略。
 *
 * 产品规则（已与用户确认）：
 *   1. 教材 / 上传资料优先，命中就必须以它为准并给出处；
 *   2. 教材没命中时，允许用模型通用知识作答，但必须显式声明
 *      「以下不是来自你的教材」；
 *   3. 联网只作补充，与当前方向无关的结果一律不进入回答、不进入引用。
 *
 * 本文件是纯函数：不读时钟、不碰网络 / 存储 / React。
 * 筛选必须能挡住「只共享一个泛词」的网页：问「什么是树」时，
 * Btrfs（文件系统）与佛经里的「树」都不算相关证据。
 */

import type { WebResult } from "@/lib/websearch";

// ── 网络结果筛选 ──────────────────────────────────────────────────

export interface WebScreenInput {
  /** 当前方向的名称、说明、章节名等。 */
  readonly directionTerms: readonly string[];
  /** 当前方向的知识点名称。 */
  readonly kcNames: readonly string[];
  /** 学生这次的问题。 */
  readonly question: string;
}

export interface ScreenedWebResult {
  readonly result: WebResult;
  readonly score: number;
  /** 命中的上下文词，按权重从高到低（去重）。 */
  readonly matched: readonly string[];
}

export type WebDropReason = "no-overlap" | "generic-only" | "title-mismatch";

export interface DroppedWebResult {
  readonly result: WebResult;
  readonly reason: WebDropReason;
  /** 可直接展示的中文原因。 */
  readonly detail: string;
  /** 命中的上下文词；generic-only 时可能是单个汉字。 */
  readonly matched: readonly string[];
}

export interface WebScreenResult {
  readonly kept: readonly ScreenedWebResult[];
  readonly dropped: readonly DroppedWebResult[];
}

type TermSource = "direction" | "kc" | "question";

interface WeightedTerm {
  readonly term: string;
  readonly weight: number;
  readonly source: TermSource;
}

/**
 * 没有区分度的常见双字 / 多字词。
 *
 * 这些词在任何领域都会出现，拿它们当「相关」的证据，
 * 就会把 Btrfs 的「基本概念」或佛经的「结构」当成教材内容。
 * 只过滤 n-gram；完整的方向名 / 知识点名永远保留。
 */
const GENERIC_TERMS = new Set([
  "数据",
  "结构",
  "系统",
  "方法",
  "问题",
  "基本",
  "概念",
  "实现",
  "使用",
  "进行",
  "可以",
  "一个",
  "这个",
  "以及",
  "或者",
  "由于",
  "因此",
  "通过",
  "相关",
  "内容",
  "特点",
  "作用",
  "主要",
  "需要",
  "包括",
  "不同",
  "相同",
  "时候",
  "情况",
  "方式",
  "过程",
  "结果",
  "关系",
  "定义",
  "类型",
  "部分",
  "之间",
  "之后",
  "之前",
  "其中",
  "这种",
  "一种",
  "什么",
  "怎么",
  "如何",
  "为什么",
  "是否",
  "哪些",
  "哪个",
  "我们",
  "你们",
  "他们",
  "介绍",
  "解释",
  "知道",
  "理解",
  "简单",
  "复杂",
  "重要",
  "应用",
  "原理",
  "基础",
  "入门",
  "教程",
  "文档",
  "页面",
  "百科",
  "维基百科",
  "百度百科",
]);

/** 中文功能字：一个 n-gram 全由它们组成时没有区分度。 */
const FUNCTION_CHARS = new Set([
  "的",
  "了",
  "是",
  "在",
  "有",
  "和",
  "与",
  "或",
  "及",
  "吗",
  "呢",
  "啊",
  "吧",
  "呀",
  "我",
  "你",
  "他",
  "她",
  "它",
  "这",
  "那",
  "什",
  "么",
  "怎",
  "如",
  "何",
  "为",
  "请",
  "一",
  "下",
  "个",
  "些",
  "哪",
  "谁",
  "时",
  "候",
  "会",
  "能",
  "可",
  "以",
  "要",
  "就",
  "都",
  "也",
  "还",
  "不",
  "很",
  "最",
  "更",
  "把",
  "被",
  "给",
  "对",
  "从",
  "到",
  "中",
  "上",
  "下",
  "里",
  "外",
  "而",
  "且",
  "但",
  "却",
  "则",
  "所",
  "其",
  "之",
]);

/** 英文检索里没有区分度的词。 */
const ASCII_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "with",
  "from",
  "this",
  "that",
  "these",
  "those",
  "what",
  "which",
  "who",
  "how",
  "why",
  "when",
  "where",
  "into",
  "than",
  "then",
  "also",
  "such",
  "have",
  "has",
  "had",
  "not",
  "but",
  "you",
  "your",
  "its",
  "can",
  "may",
  "will",
  "would",
  "should",
  "could",
  "about",
  "over",
  "under",
  "between",
  "using",
  "use",
  "used",
  "more",
  "most",
  "some",
  "any",
  "all",
  "one",
  "two",
  "wikipedia",
  "wiki",
]);

/** 只去掉明显分隔用的标点；连字符与加号保留（b-tree、c++）。 */
const SEPARATORS = /[\s\u3000，。！？；：、,!?;:()（）[\]【】{}"'“”‘’《》〈〉…·—–|/\\]+/gu;
const CHINESE_RUN = /[\u3400-\u9fff]+/gu;
const ASCII_TOKEN = /^[a-z0-9][a-z0-9_+#.-]*$/u;

const QUESTION_LEAD =
  /^(?:请问|请帮忙|请帮我|帮我|我想知道|我想问|想知道|想问|解释一下|介绍一下|介绍|解释|什么是|是什么|什么叫作|什么叫|如何理解|怎么理解|为什么|如何|怎么|请)+/u;
const QUESTION_TAIL = /(?:是什么意思|的定义是什么|的定义|是什么|有哪些|怎么样|怎样|呢|吗|呀|啊|吧)+$/u;

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(SEPARATORS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** 去掉「什么是 / 如何理解 / ……呢」这类问句外壳，只留下主题词。 */
function stripQuestion(question: string): string {
  let out = normalizeText(question);
  for (let i = 0; i < 3; i += 1) {
    const next = out.replace(QUESTION_LEAD, "").trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(QUESTION_TAIL, "").trim();
}

function isAsciiTerm(term: string): boolean {
  return ASCII_TOKEN.test(term);
}

function isDiscriminative(term: string): boolean {
  if (term.length < 2) return false;
  if (GENERIC_TERMS.has(term)) return false;
  if (isAsciiTerm(term)) return !ASCII_STOPWORDS.has(term);

  let hasContent = false;
  for (const ch of term) {
    if (!FUNCTION_CHARS.has(ch)) {
      hasContent = true;
      break;
    }
  }
  return hasContent;
}

function addTerm(
  map: Map<string, WeightedTerm>,
  raw: string,
  weight: number,
  source: TermSource,
): void {
  const term = raw.trim().replace(/\.+$/u, "");
  if (!isDiscriminative(term)) return;

  const prev = map.get(term);
  if (prev === undefined || prev.weight < weight) {
    map.set(term, { term, weight, source });
  }
}

const FULL_WEIGHT: Record<TermSource, number> = {
  direction: 4,
  kc: 3,
  question: 2,
};

const NGRAM_WEIGHT: Record<TermSource, number> = {
  direction: 2,
  kc: 1.5,
  question: 1.5,
};

/** 从一个来源文本里抽出「完整词 + 3/4 字 n-gram + 英文词」。 */
function collectTerms(
  text: string,
  source: TermSource,
  map: Map<string, WeightedTerm>,
  minNgram: number,
): void {
  for (const token of normalizeText(text).split(" ")) {
    if (token === "") continue;

    if (isAsciiTerm(token)) {
      addTerm(map, token, FULL_WEIGHT[source], source);
      continue;
    }

    /*
     * 中英混合词（B 树、KMP 算法、C 语言）整体也是一个有效检索词；
     * 只按纯中文 run 切分会把前面的字母丢掉，导致「什么是 B 树」筛不出 B 树页面。
     */
    if (/[a-z0-9]/u.test(token) && /[\u3400-\u9fff]/u.test(token)) {
      addTerm(map, token.replace(/\s+/gu, ""), FULL_WEIGHT[source], source);
    }

    for (const run of token.match(CHINESE_RUN) ?? []) {
      // 完整片段本身就是最有区分度的证据（「数据结构」「二叉树的遍历」）
      if (run.length >= 2) addTerm(map, run, FULL_WEIGHT[source], source);

      const maxN = Math.min(4, run.length);
      for (let n = Math.max(2, minNgram); n <= maxN; n += 1) {
        for (let i = 0; i + n <= run.length; i += 1) {
          const gram = run.slice(i, i + n);
          // 双字 n-gram 噪声大，只在问题里使用，并进一步降权
          const weight = n === 2 ? NGRAM_WEIGHT[source] * 0.5 : NGRAM_WEIGHT[source];
          addTerm(map, gram, weight, source);
        }
      }
    }
  }
}

interface BuiltTerms {
  readonly terms: readonly WeightedTerm[];
  /** 上下文里出现过的单个汉字，用于解释「只共享泛词」。 */
  readonly genericChars: ReadonlySet<string>;
}

function buildTerms(input: WebScreenInput): BuiltTerms {
  const map = new Map<string, WeightedTerm>();
  const genericChars = new Set<string>();

  const collectGenericChars = (text: string): void => {
    for (const ch of text) {
      if (/[\u3400-\u9fff]/u.test(ch) && !FUNCTION_CHARS.has(ch)) {
        genericChars.add(ch);
      }
    }
  };

  for (const term of input.directionTerms) {
    collectTerms(term, "direction", map, 3);
    collectGenericChars(normalizeText(term));
  }

  for (const name of input.kcNames) {
    collectTerms(name, "kc", map, 3);
    collectGenericChars(normalizeText(name));
  }

  const question = stripQuestion(input.question);
  if (question !== "") {
    collectTerms(question, "question", map, 2);
    collectGenericChars(question);
  }

  const terms = [...map.values()].sort((a, b) => b.weight - a.weight);
  return { terms, genericChars };
}

function titleTokensOf(title: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of normalizeText(title).split(" ")) {
    if (token === "") continue;
    tokens.add(token);
    for (const run of token.match(CHINESE_RUN) ?? []) tokens.add(run);
  }
  return tokens;
}

interface MatchDetail {
  readonly score: number;
  readonly matched: string[];
  readonly titleMatched: string[];
  readonly genericTitle: string[];
  readonly genericBody: string[];
}

function matchResult(
  result: WebResult,
  terms: readonly WeightedTerm[],
  genericChars: ReadonlySet<string>,
): MatchDetail {
  const title = normalizeText(result.title);
  const body = normalizeText(`${result.title} ${result.snippet}`);
  const titleTokens = titleTokensOf(result.title);

  let score = 0;
  const matched: string[] = [];
  const titleMatched: string[] = [];

  for (const term of terms) {
    const inTitle = title.includes(term.term);
    if (!inTitle && !body.includes(term.term)) continue;
    matched.push(term.term);
    if (inTitle) titleMatched.push(term.term);
    score += term.weight * (inTitle ? 2 : 1);
  }

  const genericTitle: string[] = [];
  const genericBody: string[] = [];
  for (const ch of genericChars) {
    const inTitle = titleTokens.has(ch);
    if (inTitle) genericTitle.push(ch);
    if (body.includes(ch)) genericBody.push(ch);
  }

  return {
    score: Math.round(score * 100) / 100,
    matched,
    titleMatched,
    genericTitle,
    genericBody,
  };
}

function genericDetail(chars: readonly string[]): string {
  const shown = chars.slice(0, 3).map((ch) => `「${ch}」`).join("");
  return shown === ""
    ? "网页与当前方向没有任何共同主题"
    : `只共享${shown}这类泛词，主题与当前方向无关`;
}

/**
 * 按方向词、知识点名与问题关键词筛选网络结果。
 *
 * 保留条件（宁缺毋滥）：
 *   - 标题里出现至少一个有区分度的上下文词；或
 *   - 标题是一个泛词，但正文里出现了完整的方向名 / 知识点名。
 *
 * 只共享「树」这种单字、主题却讲文件系统或宗教的网页会被丢弃，
 * 并给出可直接展示的中文原因。
 */
export function screenWebResults(
  results: readonly WebResult[],
  input: WebScreenInput,
): WebScreenResult {
  const { terms, genericChars } = buildTerms(input);

  const kept: ScreenedWebResult[] = [];
  const dropped: DroppedWebResult[] = [];

  for (const result of results) {
    const detail = matchResult(result, terms, genericChars);

    /*
     * 标题没有命中，只看正文也不算相关：Btrfs 的摘要可能顺带提到
     * 「数据结构」，但那不是这次问题的主题。唯一例外是标题本身就是
     * 一个泛词（如「树 - 维基百科」），且正文给出了完整的方向 / 知识点名
     * （分数至少达到一个完整方向词的权重）。
     */
    const strongBody = detail.matched.some(
      (term) => !detail.titleMatched.includes(term) && term.length >= 3,
    );
    const allowedByGenericTitle =
      detail.titleMatched.length === 0 &&
      detail.genericTitle.length > 0 &&
      strongBody &&
      detail.score >= FULL_WEIGHT.direction;

    if (detail.titleMatched.length === 0 && !allowedByGenericTitle) {
      const reason: WebDropReason =
        detail.matched.length > 0
          ? "title-mismatch"
          : detail.genericBody.length > 0
            ? "generic-only"
            : "no-overlap";
      dropped.push({
        result,
        reason,
        matched: detail.matched.length > 0 ? detail.matched : detail.genericBody,
        detail:
          reason === "generic-only"
            ? genericDetail(detail.genericBody)
            : reason === "no-overlap"
              ? "网页与当前方向没有任何共同主题"
              : "标题与当前方向 / 问题没有直接关系（只有正文顺带提到）",
      });
      continue;
    }

    kept.push({
      result,
      score: detail.score,
      matched: detail.matched.length > 0 ? detail.matched : detail.genericTitle,
    });
  }

  // 分数高的先注入；同分保持检索原始顺序
  const ordered = kept
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.score !== a.item.score ? b.item.score - a.item.score : a.index - b.index))
    .map((entry) => entry.item);

  return { kept: ordered, dropped };
}

// ── 回答策略 ──────────────────────────────────────────────────────

export type AnswerMode = "grounded" | "general-only" | "refuse-hint";

export interface AnswerPlanInput {
  /** 教材 / 上传资料真正命中的条数（有摘录才算命中）。 */
  readonly materialHits: number;
  /** 通过 screenWebResults 后保留下来的网络结果条数。 */
  readonly webHits: number;
  /** 当前是否允许用模型通用知识回答（没有模型时为 false）。 */
  readonly generalAllowed: boolean;
}

export interface AnswerPlan {
  readonly mode: AnswerMode;
  /** 必须在回答里出现的中文声明句。 */
  readonly declaration: string;
  /** 教材 / 上传资料是否是本次回答的唯一依据。 */
  readonly mustUseMaterial: boolean;
  /** 网络结果能否作为补充注入。 */
  readonly webAllowed: boolean;
}

/** 命中数必须是有效的非负整数；坏输入按 0 处理，不能因此放行通用知识。 */
function hitCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * 决定这次回答按哪种口径组织。
 *
 * - grounded：教材 / 上传资料命中，只能以它为准并给出处；
 * - general-only：没命中，可以讲通用知识，但必须先声明不是来自教材；
 * - refuse-hint：没命中且不允许通用知识，只说明资料里没有。
 */
export function buildAnswerPlan(input: AnswerPlanInput): AnswerPlan {
  const materialHits = hitCount(input.materialHits);
  const webHits = hitCount(input.webHits);

  if (materialHits > 0) {
    return {
      mode: "grounded",
      declaration: "以下内容以你的教材 / 上传资料为准，出处见引用。",
      mustUseMaterial: true,
      webAllowed: webHits > 0,
    };
  }

  if (input.generalAllowed) {
    return {
      mode: "general-only",
      declaration: "以下内容不是来自你的教材，是基于模型通用知识的回答。",
      mustUseMaterial: false,
      webAllowed: webHits > 0,
    };
  }

  return {
    mode: "refuse-hint",
    declaration: "你的教材 / 资料里没有找到相关内容，无法据此回答。",
    mustUseMaterial: false,
    webAllowed: false,
  };
}
