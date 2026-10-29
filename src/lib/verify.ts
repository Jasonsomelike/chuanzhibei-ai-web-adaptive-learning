/**
 * 依据核对：生成者之外的只读核对者。
 *
 * 核对者只回答「哪句原文支持 / 找不到 / 与原文冲突」，不修改题目与回答；
 * 状态由 applyItemEvidence 这类纯函数决定。判定只做可计算的事：
 * quote 归一化空白后必须是原文子串、至少 MIN_QUOTE_CHARS 个码点、含实质字符。
 * 不做语义判断——同义改写的「引用」一律不采信。
 *
 * 本模块不碰网络、浏览器存储与时钟；同样的输入必须得到同样的结论。
 */

import { MATERIAL_CHECK_PREFIX } from "@/lib/materials";

/** 一条 quote 至少要有多少个码点。2–4 个常见字（如「栈顶」）不能当依据。 */
export const MIN_QUOTE_CHARS = 12;

/** 单次回答最多核对多少条引用。 */
export const MAX_CLAIMS = 5;

/** 出题侧通过 L6 时追加的检查项。 */
export const EVIDENCE_CHECK = "依据核对";

/** 出题侧 L6 未通过 / 未完成的前缀。 */
export const EVIDENCE_CHECK_PREFIX = "依据核对：";

/** 网络、解析或字段缺失导致没有结论时追加的检查项；不降级。 */
export const EVIDENCE_INCOMPLETE = "依据核对：未完成";

/** 核对结论。unable 表示原文不足以判断，属于明确的不通过。 */
export type Verdict = "supported" | "not_found" | "contradicted" | "unable";

/** 一条待核对的引用说法。text 是引用标记前的那句话。 */
export interface Claim {
  readonly id: string;
  readonly kcId: string;
  readonly text: string;
}

/** 单条说法的核对结论。quote 只在通过逐字校验时非空。 */
export interface ClaimVerdict {
  readonly id: string;
  readonly verdict: Verdict;
  readonly quote: string;
  readonly reason: string | null;
}

/**
 * 一道参与 L6 的题。
 *
 * answerText 是生成器给的答案，buildItemEvidencePrompt 刻意不注入它——
 * 给了就是让核对器复述生成者的结论；这里只在 parse 阶段用于比对。
 */
export interface EvidenceItem {
  readonly stem: string;
  readonly options: readonly string[];
  readonly answerText: string;
}

/**
 * passed = 答案一致且引用逐字可查；failed = 有明确的不通过结论；
 * unverified = 解析失败/缺项，不能当题目错的证据；skipped = 没有原文可核对。
 */
export type EvidenceOutcome = "passed" | "failed" | "unverified" | "skipped";

/** 对一道题的依据核对结果。数组按输入题序落位，长度恒等于题数。 */
export interface ItemEvidenceResult {
  /** 题目在批次里的 1-based 序号；没有可信序号时为 0。 */
  readonly itemIndex: number;
  /** 模型给出的判定；没有可信判定时为 null。 */
  readonly verdict: Verdict | null;
  readonly outcome: EvidenceOutcome;
  /** 模型声称的答案（原样保留）；没有时为空串。 */
  readonly answerText: string;
  /** 通过逐字校验的引用；未通过时为空串。 */
  readonly quote: string;
  /** 不通过或无法解析的原因；通过时为 null。 */
  readonly reason: string | null;
}

/** 与 itemgen.ItemStatus 同构；刻意不 import，避免把出题模块带进导师页 bundle。 */
export type EvidenceStatus = "accepted" | "practice" | "rejected";

/** 逐题落库决定。check 为 null 表示没有可核对原文，不追加检查项。 */
export interface EvidenceApplication {
  readonly status: EvidenceStatus;
  readonly check: string | null;
  readonly passed: boolean;
}

// ── quote 校验 ─────────────────────────────────────────────────────

/** 去掉所有空白：中文原文的换行与缩进不应让逐字引用失配。 */
function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

/**
 * quote 是否是 source 的逐字子串（只忽略空白，不忽略大小写与标点）。
 *
 * 不做同义、错别字或语义匹配：核对器编造的引用必须在这里被挡住。
 */
export function quoteIsVerbatim(quote: string, source: string): boolean {
  const q = compact(quote);
  if (q === "") return false;
  return compact(source).includes(q);
}

/**
 * quote 是否含足够的实质字符。
 *
 * 引用抬头 `[教材·《…》·第3章·第45页]` 本身也逐字出现在原文里，
 * 且往往超过 12 个码点；若只做 substring，模型可以拿抬头冒充依据。
 * 因此先去掉方括号抬头，再数字母/汉字：标点、数字、符号都不算实质字符。
 */
export function isSubstantiveQuote(quote: string): boolean {
  const withoutLabels = quote.replace(/\[[^\[\]]*\]/g, "");
  const minimum = Math.ceil(MIN_QUOTE_CHARS / 2);
  let substantive = 0;
  for (const ch of withoutLabels) {
    if (/\p{L}/u.test(ch)) substantive += 1;
  }
  return substantive >= minimum;
}

/** 返回 quote 不被采信的原因；null 表示通过。 */
function quoteProblem(quote: string, source: string): string | null {
  const trimmed = quote.trim();
  if (trimmed === "") return "缺少逐字引用";
  if (codePointLength(trimmed) < MIN_QUOTE_CHARS) {
    return `引用不足 ${MIN_QUOTE_CHARS} 个字符`;
  }
  if (!isSubstantiveQuote(trimmed)) return "引用只由抬头、标点或数字组成";
  if (!quoteIsVerbatim(trimmed, source)) return "引用无法在原文中逐字找到";
  return null;
}

// ── 原文清洗 ───────────────────────────────────────────────────────

/**
 * 去掉只给生成器看的指令块（【口径分歧｜…】【口径裁定｜…】）。
 *
 * 这些块里写着「请同时列出两种说法」之类的话；不删掉，核对器会把
 * 指令本身当成教材原文来引用。引用抬头 [教材·…] 要保留——它仍是原文的一部分。
 */
export function stripNonEvidenceBlocks(context: string): string {
  return context
    .replace(/【口径(?:分歧|裁定)[^】]*】[^\n]*(?:\n|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── 出题侧 L6：整批核对 ────────────────────────────────────────────

/**
 * 构造整批核对提示词。一次 KC 的 3–4 题只问一次，按 itemIndex 落位。
 *
 * 只给题干与选项，不给生成器的 answerText 与解析；否则核对器只是在复述。
 * 没有可核对原文时返回空串，调用方据此完全跳过 L6。
 */
export function buildItemEvidencePrompt(
  items: readonly EvidenceItem[],
  context: string,
): string {
  const evidence = stripNonEvidenceBlocks(context);
  if (items.length === 0 || evidence === "") return "";

  const blocks = items
    .map((item, index) => {
      const options = item.options
        .map((option, i) => `${String.fromCharCode(65 + i)}. ${option.trim()}`)
        .join("\n");
      return `第 ${index + 1} 题：${item.stem.trim()}\n${options}`;
    })
    .join("\n\n");

  return `你是只读的教材依据核对者。你不参与出题，也不修改题目；只判断每道题的答案能否在给定原文中找到逐字依据。

原文（唯一依据）：
${evidence}

待核对题目：
${blocks}

规则：
1. answerText 必须与对应题目的某个选项逐字相同。
2. quote 必须逐字出现在上面的原文中，至少 ${MIN_QUOTE_CHARS} 个字符；不要用引用抬头、页码、标点或数字充当依据。
3. verdict 只能是 supported（原文支持该答案）、contradicted（原文与答案冲突）、not_found（原文找不到依据）、unable（原文不足以判断）。
4. 每道题都必须有一条结果，itemIndex 从 1 开始，与题目序号对应。
5. 不评价题目质量、难度或讲解方式。

严格输出 JSON，不要解释文字或 markdown 代码块：
{"verdicts":[{"itemIndex":1,"answerText":"与选项逐字相同","quote":"逐字原文","verdict":"supported"}]}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? (value as readonly unknown[]) : null;
}

/** 取对象里的某个数组字段（如 verdicts）。 */
function arrayField(value: unknown, key: string): readonly unknown[] | null {
  const record = asRecord(value);
  if (record === null) return null;
  return asArray(record[key]);
}

function parseJsonish(raw: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof raw !== "string") return { ok: true, value: raw };
  const text = raw.trim();
  if (text === "") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

function isVerdict(value: string): value is Verdict {
  return (
    value === "supported" ||
    value === "not_found" ||
    value === "contradicted" ||
    value === "unable"
  );
}

/** 模型常把题号写成字符串；两种写法都收，落位后再判范围。 */
function toItemIndex(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** 与 itemgen.normalizeText 同规则：去空白、小写、去尾部句读。 */
function normalizeAnswer(text: string): string {
  return text
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/[。．.！!？?；;：:、，,「」『』"'“”‘’]+$/u, "");
}

function optionMatchProblem(options: readonly string[], answerText: string): string | null {
  const want = normalizeAnswer(answerText);
  if (want === "") return "核对答案为空";
  const matches = options.filter((option) => normalizeAnswer(option) === want);
  if (matches.length === 0) return "核对答案不是选项之一";
  if (matches.length > 1) return "核对答案同时匹配多个选项";
  return null;
}

function verdictFailureReason(verdict: Verdict): string {
  switch (verdict) {
    case "contradicted":
      return "原文与答案冲突";
    case "not_found":
      return "原文未找到依据";
    case "unable":
      return "原文不足以判断";
    case "supported":
      // 走到这里说明 supported 已经通过了全部校验
      return "原文支持该答案";
  }
}

function unverifiedResult(itemIndex: number, reason: string): ItemEvidenceResult {
  return {
    itemIndex,
    verdict: null,
    outcome: "unverified",
    answerText: "",
    quote: "",
    reason,
  };
}

function judgeItemEvidence(
  item: EvidenceItem,
  itemIndex: number,
  record: Record<string, unknown>,
  evidence: string,
): ItemEvidenceResult {
  const verdictText =
    typeof record.verdict === "string" ? record.verdict.trim().toLowerCase() : "";
  const answerText = typeof record.answerText === "string" ? record.answerText.trim() : "";
  const quote = typeof record.quote === "string" ? record.quote.trim() : "";

  if (!isVerdict(verdictText)) {
    return {
      itemIndex,
      verdict: null,
      outcome: "unverified",
      answerText,
      quote: "",
      reason: "核对结果缺少有效 verdict",
    };
  }

  /*
   * 只有 supported 需要同时满足「答案在选项里」「答案与生成器一致」
   * 「引用逐字可查」。前两条任一失败都按 not_found 处理：
   * 核对器给出的答案不是这道题的答案，它的引用再真也不能证明这道题。
   */
  if (verdictText === "supported") {
    const optionIssue = optionMatchProblem(item.options, answerText);
    const mismatch =
      optionIssue === null &&
      normalizeAnswer(answerText) !== normalizeAnswer(item.answerText);
    const issue = optionIssue ?? (mismatch ? "核对答案与生成答案不一致" : quoteProblem(quote, evidence));
    if (issue !== null) {
      return {
        itemIndex,
        verdict: "not_found",
        outcome: "failed",
        answerText,
        quote: "",
        reason: issue,
      };
    }
    return {
      itemIndex,
      verdict: "supported",
      outcome: "passed",
      answerText,
      quote,
      reason: null,
    };
  }

  return {
    itemIndex,
    verdict: verdictText,
    outcome: "failed",
    answerText,
    quote: "",
    reason: verdictFailureReason(verdictText),
  };
}

/**
 * 把整批核对输出按 itemIndex 落到长度为 items.length 的数组。
 *
 * 缺失的题记为 unverified（未完成），而不是 not_found：
 * 模型漏答一题不等于这道题没有依据，不能因此把题降成 practice。
 * 越界或非整数 itemIndex 直接丢弃；重复 itemIndex 取最后一条。
 * 没有原文时整批 skipped，输出长度仍然等于题数。
 */
export function parseItemEvidenceBatch(
  raw: unknown,
  items: readonly EvidenceItem[],
  context: string,
): ItemEvidenceResult[] {
  if (items.length === 0) return [];

  const evidence = stripNonEvidenceBlocks(context);
  if (evidence === "") {
    return items.map((_, index) => ({
      itemIndex: index + 1,
      verdict: null,
      outcome: "skipped",
      answerText: "",
      quote: "",
      reason: "没有可核对的原文",
    }));
  }

  const parsed = parseJsonish(raw);
  const list = parsed.ok ? arrayField(parsed.value, "verdicts") : null;
  if (list === null) {
    const reason = parsed.ok ? "核对输出缺少 verdicts 数组" : "核对输出无法解析";
    return items.map((_, index) => unverifiedResult(index + 1, reason));
  }

  const slots: Array<ItemEvidenceResult | null> = items.map(() => null);
  for (const entry of list) {
    const record = asRecord(entry);
    if (record === null) continue;
    const index = toItemIndex(record.itemIndex);
    if (index === null || index < 1 || index > items.length) continue;
    const item = items[index - 1];
    if (item === undefined) continue;
    slots[index - 1] = judgeItemEvidence(item, index, record, evidence);
  }

  return slots.map(
    (slot, index) => slot ?? unverifiedResult(index + 1, `核对结果缺少第 ${index + 1} 题`),
  );
}

/**
 * 把一道题的依据核对结论落成状态与检查项。
 *
 * 通过不升级：L4 已经降成 practice 的题，L6 通过也不会变回 accepted。
 * 未完成不降级：网络抖动不是「题目错」的证据。
 * 只有明确的不通过（含 unable）才降 practice。
 */
export function applyItemEvidence(
  item: { readonly status: EvidenceStatus },
  result: ItemEvidenceResult | null,
): EvidenceApplication {
  if (item.status === "rejected") {
    return { status: "rejected", check: null, passed: false };
  }
  if (result === null || result.outcome === "unverified") {
    return { status: item.status, check: EVIDENCE_INCOMPLETE, passed: false };
  }
  if (result.outcome === "skipped") {
    return { status: item.status, check: null, passed: false };
  }
  if (result.outcome === "failed") {
    const reason = result.reason !== null && result.reason !== "" ? result.reason : "未找到依据";
    return {
      status: "practice",
      check: `${EVIDENCE_CHECK_PREFIX}未通过（${reason}）`,
      passed: false,
    };
  }
  return { status: item.status, check: EVIDENCE_CHECK, passed: true };
}

// ── 导师侧：引用核对 ───────────────────────────────────────────────

/** 与 tutor 页面的引用识别保持一致：小写字母开头、最多 16 个字符。 */
const CITATION_PATTERN = /\[([a-z][a-z0-9_]{0,15})\]/gi;

/** 句子边界。引用标记前的「那句话」在这些字符之后开始。 */
const SENTENCE_BOUNDARY = /[。！？!?；;\n]+/;

function cleanClaim(text: string): string {
  return text
    .replace(/^\s*(?:#{1,6}\s*|[-*>•]+\s*)?(?:\d+[.、)）]\s*)?/, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[：:，,、]+/, "")
    .replace(/[：:，,、]+$/, "")
    .trim();
}

/** 取 marker 之前那句话；上一个引用标记也视为边界。 */
function claimTextBefore(answer: string, markerStart: number): string {
  const prefix = answer.slice(0, markerStart).replace(CITATION_PATTERN, "。");
  const segments = prefix.split(SENTENCE_BOUNDARY);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const text = cleanClaim(segments[i] ?? "");
    if (text !== "") return text;
  }
  return "";
}

/**
 * 从回答里抽出带 [kcId] 引用的说法，最多 MAX_CLAIMS 条。
 *
 * 只认 knownKcIds 里的 id：模型编造的 id 不算引用，不能拿去核对。
 * 同一 id + 同一句话只保留一次；顺序按回答里首次出现的位置。
 */
export function extractClaims(
  answer: string,
  knownKcIds: readonly string[],
): Claim[] {
  const known = new Set(
    knownKcIds.map((id) => id.trim().toLowerCase()).filter((id) => id !== ""),
  );
  if (known.size === 0 || answer.trim() === "") return [];

  const claims: Claim[] = [];
  const seen = new Set<string>();
  for (const match of answer.matchAll(CITATION_PATTERN)) {
    const kcId = (match[1] ?? "").toLowerCase();
    if (!known.has(kcId)) continue;
    const text = claimTextBefore(answer, match.index ?? 0);
    if (text === "") continue;
    const key = `${kcId}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ id: `c${claims.length + 1}`, kcId, text });
    if (claims.length >= MAX_CLAIMS) break;
  }
  return claims;
}

/**
 * 构造引用核对提示词。
 *
 * promptContext 必须是本次实际注入模型的完整上下文（多片段 2400 字），
 * 不是每 KC 的第一条摘录；否则引用第二、三条片段时会被误判 not_found。
 * 没有原文时返回空串，调用方跳过核对。
 */
export function buildClaimVerifyPrompt(
  claims: readonly Claim[],
  promptContext: string,
): string {
  const evidence = stripNonEvidenceBlocks(promptContext);
  if (claims.length === 0 || evidence === "") return "";

  const list = claims.map((claim) => `[${claim.id}] ${claim.text}`).join("\n");

  return `你是只读的引用核对者。你不修改回答，只逐条判断下列说法能否在原文中找到逐字依据。

原文（唯一依据，可能有多段摘录）：
${evidence}

待核对说法：
${list}

规则：
1. quote 必须逐字出现在上面的原文中，至少 ${MIN_QUOTE_CHARS} 个字符；不要用引用抬头、页码、标点或数字充当依据。
2. verdict 只能是 supported（原文支持该说法）、not_found（原文找不到依据）、contradicted（原文与该说法冲突）。
3. 每条说法都必须有一条结果，id 原样返回。
4. 不评价回答质量，不重写回答。

严格输出 JSON 数组，不要解释文字或 markdown 代码块：
[{"id":"c1","verdict":"supported","quote":"逐字原文"}]`;
}

function judgeClaim(
  claim: Claim,
  record: Record<string, unknown> | undefined,
  evidence: string,
): ClaimVerdict {
  if (record === undefined) {
    return { id: claim.id, verdict: "unable", quote: "", reason: "核对结果缺少该条" };
  }
  const verdictText =
    typeof record.verdict === "string" ? record.verdict.trim().toLowerCase() : "";
  if (!isVerdict(verdictText)) {
    return { id: claim.id, verdict: "unable", quote: "", reason: "核对结果缺少有效 verdict" };
  }
  const quote = typeof record.quote === "string" ? record.quote.trim() : "";

  if (verdictText === "supported") {
    const issue = quoteProblem(quote, evidence);
    if (issue !== null) {
      return { id: claim.id, verdict: "not_found", quote: "", reason: issue };
    }
    return { id: claim.id, verdict: "supported", quote, reason: null };
  }
  if (verdictText === "contradicted") {
    const valid = quoteProblem(quote, evidence) === null;
    return { id: claim.id, verdict: "contradicted", quote: valid ? quote : "", reason: null };
  }
  return { id: claim.id, verdict: verdictText, quote: "", reason: null };
}

/**
 * 解析引用核对输出，按 claims 的顺序返回等长数组。
 *
 * 支持裸数组与 {"verdicts":[...]} 两种写法；缺项或无法解析记为 unable，
 * 由界面显示「核对未完成」，不据此改写回答。
 */
export function parseClaimVerdicts(
  raw: unknown,
  claims: readonly Claim[],
  context: string,
): ClaimVerdict[] {
  if (claims.length === 0) return [];
  const evidence = stripNonEvidenceBlocks(context);
  if (evidence === "") {
    /*
     * 没有注入任何原文时不能把「找不到」算到回答头上：
     * 这不是引用错了，而是无从核对。verifyClient 应在 build 返回空串时跳过，
     * 这里兜底成 unable，避免调用方漏判时误显示「未找到依据」。
     */
    return claims.map((claim) => ({
      id: claim.id,
      verdict: "unable",
      quote: "",
      reason: "没有可核对的原文",
    }));
  }
  const parsed = parseJsonish(raw);
  const list = parsed.ok
    ? (asArray(parsed.value) ?? arrayField(parsed.value, "verdicts"))
    : null;
  if (list === null) {
    const reason = parsed.ok ? "核对输出格式不可识别" : "核对输出无法解析";
    return claims.map((claim) => ({
      id: claim.id,
      verdict: "unable",
      quote: "",
      reason,
    }));
  }

  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of list) {
    const record = asRecord(entry);
    if (record === null || typeof record.id !== "string") continue;
    byId.set(record.id.trim(), record);
  }

  return claims.map((claim) => judgeClaim(claim, byId.get(claim.id), evidence));
}

export interface ClaimSummary {
  readonly total: number;
  readonly supported: number;
  readonly notFound: number;
  readonly contradicted: number;
  readonly unable: number;
  /** 一行中文汇总，例如「5 条引用中 4 条有原文支持，1 条未找到依据」。 */
  readonly text: string;
}

/** 汇总引用核对结果；没有引用时给出明确文案，不显示「0 条支持」。 */
export function summarizeClaimVerdicts(
  verdicts: readonly ClaimVerdict[],
): ClaimSummary {
  let supported = 0;
  let notFound = 0;
  let contradicted = 0;
  let unable = 0;
  for (const verdict of verdicts) {
    if (verdict.verdict === "supported") supported += 1;
    else if (verdict.verdict === "not_found") notFound += 1;
    else if (verdict.verdict === "contradicted") contradicted += 1;
    else unable += 1;
  }
  const total = verdicts.length;

  if (total === 0) {
    return {
      total,
      supported,
      notFound,
      contradicted,
      unable,
      text: "本次回答没有可核对的引用",
    };
  }

  const parts = [`${total} 条引用中 ${supported} 条有原文支持`];
  if (notFound > 0) parts.push(`${notFound} 条未找到依据`);
  if (contradicted > 0) parts.push(`${contradicted} 条与原文冲突`);
  if (unable > 0) parts.push(`${unable} 条未能核对`);

  return {
    total,
    supported,
    notFound,
    contradicted,
    unable,
    text: `${parts.join("，")}。`,
  };
}

// ── 检查项判定 ─────────────────────────────────────────────────────

/**
 * 一条 check 是否算「已通过」。
 *
 * 界面用「已通过 N 项」计数，未通过/未完成/提示/依据出处都不能计入——
 * 否则用户会看到「依据核对：未完成」也被算成通过。
 */
export function isPassingCheck(check: string): boolean {
  const text = check.trim();
  if (text === "") return false;
  if (text.startsWith("提示：")) return false;
  if (text.startsWith(MATERIAL_CHECK_PREFIX)) return false;
  /*
   * 通过项只有「依据核对」四个字，任何后缀（未通过/未完成/半角冒号）
   * 都不算通过。用 startsWith + 全等而不是只查前缀，避免
   * 「依据核对:未完成」这种半角写法漏进「已通过 N 项」。
   */
  if (text.startsWith(EVIDENCE_CHECK)) return text === EVIDENCE_CHECK;
  return true;
}
