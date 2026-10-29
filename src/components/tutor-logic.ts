/**
 * 导师页的纯函数层。
 *
 * 页面只负责网络与渲染；引用抽取、提示词拼装、核对上下文、失败取舍都在这里。
 * 这样这些最容易「说错话」的规则可以直接用 vitest 锁住——
 * 直接 import page.tsx 会把 Next 的客户端运行时一起拖进来。
 *
 * 边界：不碰 fetch、localStorage、React；同样的输入必须得到同样的输出。
 */

import type { KnowledgeConcept } from "@/lib/graph";
import { masteryMean, masterySd } from "@/lib/mastery";
import type { MasteryState } from "@/lib/mastery";
import {
  MAX_CONTEXT_CHARS,
  buildMaterialContext,
  citationLabel,
  excerptFor,
  type MaterialConflict,
  type MaterialExcerpt,
  type MaterialPack,
  type MaterialSelection,
} from "@/lib/materials";
import type { RetrievedDoc } from "@/lib/rag";
import type { UploadHit } from "@/lib/knowledge";
import { uploadCitationLabel } from "@/lib/knowledge";
import type { WebHit } from "@/lib/websearch";
import type { AnswerPlan } from "@/lib/grounding";
import type { ProviderConfig } from "@/lib/provider";
import type { ThinkingStrength } from "@/lib/reasoning";
import type { Claim, ClaimVerdict, Verdict } from "@/lib/verify";
import { stripNonEvidenceBlocks } from "@/lib/verify";

export interface CitationRef {
  readonly kcId: string;
  readonly title: string;
}

export type BadgeTone = "neutral" | "good" | "warn" | "bad";

// ── 回答里的引用 ──────────────────────────────────────────────────

/**
 * 否定 / 无关语境的标记。
 *
 * 「[c01][c20] 与天气无关，不引用」里的 id 是模型在说明「这些资料不能用」，
 * 不是引用。按子句排除这些语境，引用区才不会把「不引用」列成引用。
 */
const NON_CITATION_MARKERS = [
  "不引用",
  "未引用",
  "不能引用",
  "不可引用",
  "不再引用",
  "不予引用",
  "无关",
  "不相关",
  "无法据此回答",
  "无法回答",
  "不能据此回答",
  "没有依据",
  "无依据",
  "缺乏依据",
  "不作为依据",
  "不作依据",
  "不能作为依据",
] as const;

/**
 * 按句读切成子句。
 *
 * 逗号也算边界：模型常写「[c01] 与天气无关，不引用」，
 * 前半句里的 id 属于「无关」，后半句属于「不引用」，不能整段一起算。
 */
function clausesOf(text: string): string[] {
  return text.match(/[^。！？!?；;，,、\n]+/g) ?? [];
}

function isNonCitationClause(clause: string): boolean {
  return NON_CITATION_MARKERS.some((marker) => clause.includes(marker));
}

/**
 * 从模型回复里抽出真正被引用的知识点。
 *
 * 只保留「回复里出现过 [kcId]、且该 kcId 确实在本次检索结果里」的项：
 * 前者防止把没引用说成引用，后者防止模型编造一个不在资料里的 id。
 * 出现在否定 / 无关子句里的 id 不算引用——那是在说明「不能用这些资料」。
 */
export function extractCitedKcIds(
  reply: string,
  docs: readonly { kcId: string; title: string }[],
): CitationRef[] {
  const byId = new Map(docs.map((doc) => [doc.kcId.toLowerCase(), doc] as const));
  const seen = new Set<string>();
  const out: CitationRef[] = [];

  for (const clause of clausesOf(reply)) {
    if (isNonCitationClause(clause)) continue;
    for (const match of clause.matchAll(/\[([a-z][a-z0-9_]{0,15})\]/gi)) {
      const id = (match[1] ?? "").toLowerCase();
      if (seen.has(id)) continue;
      const doc = byId.get(id);
      if (doc === undefined) continue;
      seen.add(id);
      out.push({ kcId: doc.kcId, title: doc.title });
    }
  }

  return out;
}

// ── 教材 / 讲义材料 ───────────────────────────────────────────────

/**
 * 一次回答要用的教材 / 讲义材料。
 *
 * promptContext 是按全部命中知识点共享 2400 字预算裁剪后的整段摘录，注入模型；
 * excerpts 按 kcId 拆开，给无模型拼装逐条标出处。
 * 两者都出自同一条排序规则（materials.ts 的 chunksForConcept），页码口径不会分叉。
 */
export interface AnswerMaterial {
  readonly promptContext: string;
  readonly excerpts: ReadonlyMap<string, MaterialExcerpt>;
  /** 实际注入模型的出处抬头，去重后保持首次出现顺序。 */
  readonly sources: string[];
  readonly conflicts: readonly MaterialConflict[];
}

export function materialForAnswer(
  pack: MaterialPack,
  selection: MaterialSelection,
  concepts: readonly KnowledgeConcept[],
): AnswerMaterial {
  const combined = buildMaterialContext(pack, concepts, selection, MAX_CONTEXT_CHARS);

  const excerpts = new Map<string, MaterialExcerpt>();
  for (const concept of concepts) {
    const excerpt = excerptFor(pack, concept, selection);
    if (excerpt) excerpts.set(concept.id, excerpt);
  }

  return {
    promptContext: combined.text,
    excerpts,
    sources: [...new Set(combined.citations.map((citation) => citation.label))],
    conflicts: combined.unresolved,
  };
}

/**
 * 未决分歧的提示语：把每种说法和它的出处都摆出来，不替用户选边。
 *
 * 书目名只从数据包里取；没有实体来源的说法标成「模型」，
 * 不能给它编一个《…》——那会变成假书目。
 */
export function describeConflict(pack: MaterialPack, conflict: MaterialConflict): string {
  const titles = new Map(pack.sources.map((source) => [source.id, source.title] as const));
  const parts = conflict.claims.map((claim) => {
    const title = claim.sourceId ? titles.get(claim.sourceId) : undefined;
    return `${title ? `《${title}》` : "模型"}称「${claim.statement}」`;
  });
  return `「${conflict.topic}」尚未选定口径：${parts.join("，")}。两种说法都保留，不替你决定。`;
}

// ── 提示词拼装 ────────────────────────────────────────────────────

/** 通用知识声明的识别词；plan.declaration 里一定包含它。 */
const DECLARATION_MARKER = "不是来自你的教材";

/** 声明必须落在正文开头这么多字之内，否则视为没写。 */
const DECLARATION_HEAD_WINDOW = 20;

/** 按句读切句，保留句末标点；空串会被滤掉。 */
function sentencesOf(text: string): string[] {
  return (text.match(/[^。！？!?\n]*[。！？!?\n]?/g) ?? []).filter((sentence) => sentence !== "");
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = text.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

/** 删掉包含声明的整句：模型通常把声明单独成句，删掉它不会动到正文内容。 */
function stripDeclarationSentences(text: string): string {
  return sentencesOf(text)
    .filter((sentence) => !sentence.includes(DECLARATION_MARKER))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 把回答策略里的声明句真正落到回答正文。
 *
 * 模型不一定照提示词写声明，界面不能因此假装它写过了：
 *   - grounded：不改写（教材命中时不需要通用知识声明）；
 *   - general-only：声明必须在开头（前 20 字内）；中段出现时，
 *     删掉原声明句后补在最前面，保证只出现一次、且不夹在正文中间；
 *   - refuse-hint：不允许通用知识，只保留声明，不展示模型编的答案。
 */
export function ensureAnswerDeclaration(reply: string, plan: AnswerPlan): string {
  if (plan.mode === "grounded") return reply;
  if (plan.mode === "refuse-hint") return plan.declaration;

  const trimmed = reply.trim();
  const head = Array.from(trimmed).slice(0, DECLARATION_HEAD_WINDOW).join("");
  // 只有开头 20 字内的声明才算数；中段声明即使措辞完整也要重排。
  if (head.includes(DECLARATION_MARKER) && countOccurrences(trimmed, DECLARATION_MARKER) === 1) {
    return trimmed;
  }

  // 中段声明连同所在句一起删掉，再补一次标准声明：不重复、不夹在正文中间。
  const body = stripDeclarationSentences(trimmed);
  return body === "" ? plan.declaration : `${plan.declaration}\n\n${body}`;
}

/**
 * 引用区只列「回复里真的引用了、且本次确实有摘录」的教材 / 讲义出处。
 *
 * materialForAnswer().sources 是「本次注入的摘录」，不是「模型用了的」。
 * 直接把注入清单当出处展示，会让没被引用的书目也看起来像依据。
 */
export function citedMaterialSources(
  excerpts: ReadonlyMap<string, MaterialExcerpt>,
  citedKcIds: readonly string[],
): string[] {
  const sources: string[] = [];
  for (const kcId of citedKcIds) {
    const excerpt = excerpts.get(kcId);
    if (excerpt === undefined) continue;
    const label = citationLabel(excerpt);
    if (!sources.includes(label)) sources.push(label);
  }
  return sources;
}

export interface TutorPromptInput {
  readonly question: string;
  readonly docs: readonly RetrievedDoc[];
  readonly mastery: readonly MasteryState[];
  readonly materialContext: string;
  readonly uploadContext: string;
  readonly webContext: string;
  /** 本次回答口径（教材优先 / 通用知识 / 拒绝作答）。缺省时保持旧行为。 */
  readonly plan?: AnswerPlan;
}

/**
 * 回答口径块：把产品规则写进提示词，而不是指望模型自己猜。
 *
 * 尤其是「教材没命中」这一支：必须让模型先写声明，否则它会把
 * 通用知识包装成「资料里说」——这正是用户投诉的那种跑偏。
 */
export function answerPolicyBlock(plan: AnswerPlan): string {
  const lines = ["【回答口径】"];

  switch (plan.mode) {
    case "grounded":
      lines.push(
        "教材 / 上传资料已命中：以这些摘录为第一依据，每个结论都要给出书目、章节或页码；知识点资料只用于定位知识点，不能替代教材；不得用网络结果替代教材。",
      );
      break;
    case "general-only":
      lines.push(
        "教材与上传资料都没有命中：可以基于通用知识回答，但不得声称内容来自教材，不得编造书名、章节或页码。",
      );
      break;
    case "refuse-hint":
      lines.push(
        "教材与上传资料都没有命中，且不允许使用通用知识：只说明资料里没有，不要编造答案。",
      );
      break;
  }

  lines.push(`必须在回答中写明：${plan.declaration}`);
  lines.push(
    plan.webAllowed
      ? "网络结果只作补充；与教材 / 讲义冲突时以教材为准。与当前方向无关的网页一律忽略，不要写进回答，也不要引用。"
      : "本次没有可注入的网络结果；不要用记忆里的网页内容凑依据。",
  );

  return lines.join("\n");
}

/**
 * 拼装这一次真正发给模型的用户消息。
 *
 * 知识点资料、教材摘录、上传片段、网络结果各自成块：
 * 混在一起时，模型会把网络摘要当成教材原文去编页码。
 */
export function buildTutorUserPrompt(input: TutorPromptInput): string {
  const byId = new Map(input.mastery.map((state) => [state.kcId, state] as const));

  const context =
    input.docs.length > 0
      ? input.docs
          .map((doc) => {
            const state = byId.get(doc.kcId);
            const mastery = state
              ? `学生当前：已测 ${state.evidenceN} 题，掌握度 ${Math.round(masteryMean(state) * 100)}%（±${Math.round(masterySd(state) * 100)}）`
              : "学生当前：未测评";
            return `[${doc.kcId}] ${doc.title}\n资料：${doc.snippet}\n${mastery}`;
          })
          .join("\n\n")
      : input.plan?.mode === "general-only"
        ? "（没有检索到相关知识点，也没有教材 / 上传资料摘录；可按通用知识回答并声明）"
        : input.plan?.mode === "grounded"
          ? "（课程知识库没有检索到相关知识点；请以教材 / 上传资料摘录为准）"
          : "（没有检索到相关资料，请直接说明资料里没有）";

  const blocks: string[] = [];
  if (input.plan !== undefined) blocks.push(answerPolicyBlock(input.plan));
  blocks.push(`学生的问题：${input.question}`, `可用资料：\n${context}`);

  const material = input.materialContext.trim();
  if (material !== "") {
    blocks.push(`教材 / 讲义摘录（有摘录时以此为准；引用只能使用这里出现的书目、章节与页码）：\n${material}`);
  }

  const upload = input.uploadContext.trim();
  if (upload !== "") blocks.push(upload);

  const web = input.webContext.trim();
  if (web !== "") blocks.push(web);

  return blocks.join("\n\n");
}

/**
 * 引用核对用的原文。
 *
 * 必须是本次实际注入的完整上下文（多片段 2400 字），不是 excerptFor 的每 KC 第一条：
 * 模型引用第二、三条片段时，拿窄范围做 substring 校验会误判 not_found。
 *
 * 上传片段同样是原文，可以支撑引用；网络结果明确不算证据，不进核对上下文。
 */
export function buildVerificationContext(
  materialContext: string,
  uploads: readonly UploadHit[],
): string {
  const parts: string[] = [];
  const material = materialContext.trim();
  if (material !== "") parts.push(material);

  for (const hit of uploads) {
    const text = hit.chunk.text.trim();
    if (text === "") continue;
    parts.push(`${uploadCitationLabel(hit)}\n${text}`);
  }

  return parts.join("\n\n");
}

/**
 * 上下文里是否有核对者可用的原文。
 *
 * 【口径分歧｜…】这类块是写给生成器的指令，verify.ts 会在核对前删掉；
 * 只有指令没有摘录时不能发起核对，否则模型会被要求从指令里找依据。
 */
export function hasUsableEvidence(context: string): boolean {
  return stripNonEvidenceBlocks(context) !== "";
}

/** 是否值得发起一次核对：开关打开、有引用、有可核对的原文。 */
export function shouldVerifyClaims(
  provider: ProviderConfig,
  claimCount: number,
  context: string,
): boolean {
  return provider.verification !== false && claimCount > 0 && hasUsableEvidence(context);
}

// ── 无模型时的结构化拼装 ──────────────────────────────────────────

export interface ComposeInput {
  readonly question: string;
  readonly docs: readonly RetrievedDoc[];
  readonly mastery: readonly MasteryState[];
  readonly excerpts: ReadonlyMap<string, MaterialExcerpt>;
  readonly uploads: readonly UploadHit[];
  readonly web: readonly WebHit[];
}

function clipText(text: string, maxChars: number): string {
  const points = Array.from(text.trim());
  return points.length <= maxChars ? points.join("") : `${points.slice(0, maxChars).join("")}…`;
}

/**
 * 无模型时的回答：检索结果 + 教材摘录 + 上传片段 + 网络摘录 + 掌握度数值。
 *
 * 每一类来源都单独成段并标清「是否核对」：教材摘录优先，
 * 上传资料只在本浏览器可见，网络结果未核对，三者不能混成一种口径。
 */
export function composeDeterministic(input: ComposeInput): {
  readonly text: string;
  readonly sources: string[];
} {
  const byId = new Map(input.mastery.map((state) => [state.kcId, state] as const));
  const sources: string[] = [];
  const sections: string[] = [];

  if (input.docs.length === 0) {
    sections.push(`课程知识库没有检索到与「${input.question}」直接相关的知识点。`);
  } else {
    for (const doc of input.docs) {
      const state = byId.get(doc.kcId);
      const mastery = state
        ? `你目前在这个知识点上已测 ${state.evidenceN} 题，掌握度 ${Math.round(masteryMean(state) * 100)}%（±${Math.round(masterySd(state) * 100)}）。`
        : "你还没有测过这个知识点。";

      /*
       * 每条都先给出处再给原文：摘录才是教材口径，
       * 检索摘要只是知识点文档，两者不能混在一起让学生分不清哪句是书上的。
       */
      const excerpt = input.excerpts.get(doc.kcId);
      const sourceLine = excerpt
        ? `出处：${citationLabel(excerpt)}`
        : "出处：教材 / 讲义里没有这个知识点的摘录";
      if (excerpt) {
        const label = citationLabel(excerpt);
        if (!sources.includes(label)) sources.push(label);
      }
      const body = excerpt ? excerpt.text : doc.snippet;

      sections.push(`**${doc.title}** [${doc.kcId}]\n${sourceLine}\n${body}\n${mastery}`);
    }
  }

  if (input.uploads.length > 0) {
    const blocks = input.uploads.map(
      (hit, index) =>
        `[资料${index + 1}] ${uploadCitationLabel(hit)}\n${clipText(hit.chunk.text, 400)}`,
    );
    sections.push(`**上传资料（本浏览器，未核对）**\n${blocks.join("\n\n")}`);
  }

  if (input.web.length > 0) {
    const blocks = input.web.map((hit) =>
      hit.snippet === ""
        ? `[网络${hit.ref}] ${hit.label}`
        : `[网络${hit.ref}] ${hit.label}\n${hit.snippet}`,
    );
    sections.push(`**网络检索结果（外部网页，未核对）**\n${blocks.join("\n\n")}`);
  }

  const hasMaterial = input.docs.some((doc) => input.excerpts.has(doc.kcId));
  const origins = ["课程知识库"];
  if (input.uploads.length > 0) origins.push("上传资料");
  if (input.web.length > 0) origins.push("网络检索");
  const originText =
    origins.length === 1
      ? origins[0]
      : `${origins.slice(0, -1).join("、")}与${origins[origins.length - 1]}`;
  const footer =
    `（以上内容由${originText}直接拼装，没有经过模型改写。` +
    (hasMaterial ? "教材 / 讲义摘录优先；" : "") +
    (input.web.length > 0 ? "网络结果未核对，不能当成教材结论。" : "") +
    "）";

  return { text: `${sections.join("\n\n")}\n\n${footer}`, sources };
}

// ── 流式失败与思考状态 ────────────────────────────────────────────

/**
 * 流式失败后怎么处理。
 *
 * 已经输出过正文或思考时保留半截内容（keep-partial），
 * 不能再用检索拼装覆盖它——用户看到的是模型真实说过的话，
 * 覆盖会让人误以为那就是完整回答。完全没有输出时才允许退回检索拼装。
 */
export function streamFailureDecision(text: string, reasoning: string): "keep-partial" | "fallback" {
  return text.trim() === "" && reasoning.trim() === "" ? "fallback" : "keep-partial";
}

/** 该端点曾拒绝思考参数时不再发送，避免每次问答都先吃一个 400。 */
export function effectiveThinking(provider: ProviderConfig): ThinkingStrength {
  if (provider.thinkingStatus === "unsupported") return "off";
  return provider.thinking ?? "off";
}

/** 只有开思考且端点没有被判不支持时才显示思考面板。 */
export function thinkingEnabledFor(provider: ProviderConfig): boolean {
  return (provider.thinking ?? "off") !== "off" && provider.thinkingStatus !== "unsupported";
}

export function thinkingStrengthLabel(strength: ThinkingStrength): string {
  if (strength === "standard") return "标准";
  if (strength === "deep") return "深入";
  return "关";
}

export type ThinkingPanelMode = "hidden" | "empty" | "panel";

export function thinkingPanelMode(input: {
  readonly reasoning: string;
  readonly enabled: boolean;
}): ThinkingPanelMode {
  if (!input.enabled) return "hidden";
  return input.reasoning.trim() === "" ? "empty" : "panel";
}

// ── 核对结论展示 ──────────────────────────────────────────────────

export function verdictLabel(verdict: Verdict): string {
  switch (verdict) {
    case "supported":
      return "已核对";
    case "not_found":
      return "未找到依据";
    case "contradicted":
      return "与原文冲突";
    case "unable":
      return "未能核对";
  }
}

export function verdictTone(verdict: Verdict): BadgeTone {
  switch (verdict) {
    case "supported":
      return "good";
    case "not_found":
      return "warn";
    case "contradicted":
      return "bad";
    case "unable":
      return "neutral";
  }
}

/**
 * 核对流程本身没跑完（网络 / 超时 / 输出不可解析）时的原因。
 *
 * 显式的 unable 是核对者的结论，reason 为 null；带 reason 的 unable
 * 表示流程没有得出结论，界面要按「未完成」展示，不能当成回答错误。
 */
export function verificationFailureReason(verdicts: readonly ClaimVerdict[]): string | null {
  for (const verdict of verdicts) {
    if (verdict.verdict === "unable" && verdict.reason !== null && verdict.reason.trim() !== "") {
      return verdict.reason;
    }
  }
  return null;
}

/**
 * 引用 Pill 旁的徽标：同一个知识点可能被多条 claim 引用，
 * 有任何一个未通过就按最严重的那条展示，不能只挑一条通过的。
 */
export function citationVerificationBadge(
  kcId: string,
  claims: readonly Claim[],
  verdicts: readonly ClaimVerdict[] | null,
): { readonly label: string; readonly tone: BadgeTone } | null {
  if (verdicts === null || verdicts.length === 0) return null;

  const wanted = kcId.trim().toLowerCase();
  const relevant = claims.filter((claim) => claim.kcId.trim().toLowerCase() === wanted);
  if (relevant.length === 0) return null;

  const byId = new Map(verdicts.map((verdict) => [verdict.id, verdict] as const));
  const found = relevant
    .map((claim) => byId.get(claim.id))
    .filter((verdict): verdict is ClaimVerdict => verdict !== undefined);
  if (found.length === 0) return null;

  const worst: Verdict = found.some((verdict) => verdict.verdict === "contradicted")
    ? "contradicted"
    : found.some((verdict) => verdict.verdict === "not_found")
      ? "not_found"
      : found.some((verdict) => verdict.verdict === "unable")
        ? "unable"
        : "supported";

  return { label: verdictLabel(worst), tone: verdictTone(worst) };
}

// ── 来源块文案 ────────────────────────────────────────────────────

/** 网络来源的采用情况。检索到 ≠ 采用，文案必须把两者分开。 */
export function webUsageNote(used: number, total: number): string {
  if (total <= 0) return "";
  if (used <= 0) return "本次回答未采用网络结果；以下为检索到的条目，仅列出以备核对。";
  if (used >= total) return "本次回答引用了全部网络条目。";
  return `本次回答引用了 ${used}/${total} 条网络结果。`;
}

/** 上传片段的采用情况。模型没写 [资料n] 时不能暗示它用了这些片段。 */
export function uploadUsageNote(used: number, total: number): string {
  if (total <= 0) return "";
  if (used <= 0) {
    return "模型未标注 [资料n]；以下为本次注入的上传片段，不等于回答采用了它们。";
  }
  if (used >= total) return "模型引用了本次注入的全部上传片段。";
  return `模型引用了 ${used}/${total} 条上传片段。`;
}

/** 朗读按钮的文案：播放中优先显示「停止」。 */
export function readAloudLabel(active: boolean, busy: boolean): string {
  if (active) return "停止";
  if (busy) return "准备中…";
  return "朗读";
}
