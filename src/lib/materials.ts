/**
 * 教材 / 讲义的知识口径：来源、片段、说法与可引用的上下文。
 *
 * 为什么把「来源」与「依据」分开：
 *   教材、讲义是可以引用的来源；模型生成的说法不是来源，只是依据之一。
 *   因此 MaterialKind 只有 textbook / lecture，model 只出现在 MaterialBasis 里。
 *   把 model 塞进来源列表会让界面出现「《某模型》第 1 版」这种假书目。
 *
 * 本模块是纯函数：不读时钟、不取随机数、不碰网络与浏览器存储，
 * 同样的输入必须得到逐字节相同的上下文——生成链路要能复现、要能单测。
 * 持久化在 materialStore.ts，这里只做数据形状与文本拼装。
 */

import type { KnowledgeConcept, KnowledgeGraph } from "@/lib/graph";

/** 可引用的来源类型。模型不在其中：模型是依据，不是书目。 */
export type MaterialKind = "textbook" | "lecture";

/** 一条说法的依据。model 表示由模型生成，没有对应的实体书目。 */
export type MaterialBasis = MaterialKind | "model";

/** 资料存档的键。与 provider / learner 的存档互不影响。 */
export const MATERIALS_STORAGE_KEY = "alp.materials.v1";

/** 作答与解析结果里标注依据的前缀。 */
export const MATERIAL_CHECK_PREFIX = "依据：";

/** 单条摘录最多保留的码点数。 */
export const MAX_EXCERPT_CHARS = 400;

/** 一次上下文注入的字符预算（按码点计，不含冲突提示）。 */
export const MAX_CONTEXT_CHARS = 2400;

/** 单条笔记正文上限。 */
export const MAX_NOTE_CHARS = 20000;

/** 全部笔记正文合计上限。 */
export const MAX_NOTES_TOTAL_CHARS = 200000;

/** 笔记转成数据包时使用的来源 id。 */
export const NOTES_SOURCE_ID = "notes";

/** 一本教材 / 一份讲义。 */
export interface MaterialSource {
  readonly id: string;
  readonly kind: MaterialKind;
  readonly title: string;
  readonly author?: string;
  readonly publisher?: string;
  readonly edition?: string;
  readonly year?: number;
  /** 一句话说明该来源覆盖什么，用于选择界面。 */
  readonly note?: string;
}

/**
 * 一条关于某个知识点的说法。
 *
 * topic 是分歧的维度：同一 kcId + topic 下出现不同 statement 才算口径分歧。
 * 没有 topic 就只能按整段文本比较，措辞稍改就会被误报成冲突。
 */
export interface MaterialClaim {
  readonly id: string;
  readonly kcId: string;
  readonly topic: string;
  /** 说法本身的一句话摘要，用于冲突提示，不用于正文。 */
  readonly statement: string;
  readonly basis: MaterialBasis;
  /** 实体来源；basis 为 model 时可以没有。 */
  readonly sourceId?: string;
  readonly pageFrom?: number;
  readonly pageTo?: number;
}

/** 一段可检索、可摘录的原文。 */
export interface MaterialChunk {
  readonly id: string;
  readonly sourceId: string;
  readonly kcIds: readonly string[];
  readonly chapter: string;
  readonly section: string;
  /** 页码缺失表示来源没有分页（如笔记），此时引用不能编造页码。 */
  readonly pageFrom?: number;
  readonly pageTo?: number;
  readonly text: string;
}

/** 一份内置或合并后的资料包。 */
export interface MaterialPack {
  readonly id: string;
  readonly title: string;
  readonly sources: readonly MaterialSource[];
  readonly chunks: readonly MaterialChunk[];
  readonly claims: readonly MaterialClaim[];
}

/** 用户对某个学习目标的选择：来源优先级 + 冲突裁定。 */
export interface MaterialSelection {
  /** 顺序即优先级，越靠前越优先。 */
  readonly sourceIds: readonly string[];
  /** 冲突 key → 选中的 claim id。 */
  readonly resolutions: Readonly<Record<string, string>>;
}

/** 单条摘录。页码为 null 表示来源没有页码，不是 0。 */
export interface MaterialExcerpt {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly kind: MaterialKind;
  readonly chapter: string;
  readonly section: string;
  readonly pageFrom: number | null;
  readonly pageTo: number | null;
  readonly text: string;
  readonly truncated: boolean;
}

/** 上下文里的一条引用，保留 chunkId 便于界面回跳与核对。 */
export interface MaterialCitation {
  readonly chunkId: string;
  readonly sourceId: string;
  readonly label: string;
}

/** 同一知识点、同一维度上的多种说法。 */
export interface MaterialConflict {
  readonly key: string;
  readonly kcId: string;
  readonly topic: string;
  readonly claims: readonly MaterialClaim[];
}

/** 注入给生成链路的上下文。 */
export interface MaterialContext {
  readonly text: string;
  readonly citations: readonly MaterialCitation[];
  readonly coveredKcIds: readonly string[];
  readonly missingKcIds: readonly string[];
  /** 未裁定的口径分歧。预算裁剪不会删掉它们。 */
  readonly unresolved: readonly MaterialConflict[];
}

/** 用户手写的一条笔记，绑定到至少一个知识点。 */
export interface MaterialNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly kcIds: readonly string[];
}

/** 按学习目标保存的选择与全部笔记。 */
export interface MaterialsState {
  readonly version: 1;
  /** targetId → 该目标的来源选择与冲突裁定。 */
  readonly targets: Readonly<Record<string, MaterialSelection>>;
  readonly notes: readonly MaterialNote[];
}

export function emptySelection(): MaterialSelection {
  return { sourceIds: [], resolutions: {} };
}

export function emptyMaterialsState(): MaterialsState {
  return { version: 1, targets: {}, notes: [] };
}

export function emptyPack(id = "", title = ""): MaterialPack {
  return { id, title, sources: [], chunks: [], claims: [] };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 按 id 去重并保留首次出现的顺序。 */
function dedupeById<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

/** 码点长度。中文与 emoji 都按 1 个字算，避免 UTF-16 代理对把长度算成 2。 */
function charLength(text: string): number {
  return Array.from(text).length;
}

// ── 选择与来源 ────────────────────────────────────────────────────

/**
 * 可选的来源。
 *
 * MaterialKind 已经把 model 排除在外，所以这里不需要再按类型过滤；
 * 保留这个函数是为了让界面只依赖「可选来源」这一语义，而不是直接摸 pack.sources。
 */
export function selectableSources(pack: MaterialPack): readonly MaterialSource[] {
  return pack.sources;
}

/**
 * 规范化选择：去掉不存在的来源、重复项与失效的冲突裁定。
 *
 * 不按 pack.sources 的顺序重排 sourceIds——顺序就是优先级，
 * 重排会悄悄改变用户选定的优先级。
 */
export function normalizeSelection(
  selection: MaterialSelection,
  pack: MaterialPack,
): MaterialSelection {
  const known = new Set(pack.sources.map((s) => s.id));
  const sourceIds: string[] = [];
  for (const id of selection.sourceIds) {
    if (!known.has(id) || sourceIds.includes(id)) continue;
    sourceIds.push(id);
  }

  const resolutions: Record<string, string> = {};
  for (const conflict of detectConflicts(pack)) {
    const chosen = selection.resolutions[conflict.key];
    if (chosen && conflict.claims.some((claim) => claim.id === chosen)) {
      resolutions[conflict.key] = chosen;
    }
  }

  return { sourceIds, resolutions };
}

/**
 * 内置资料包的默认口径：选中包内全部来源。
 *
 * 没有内置来源（自定义方向、空包）时返回空选择——不能把「没有教材」
 * 伪装成「已经选了教材」。这是「模型通用知识」与「没有资料」的分界：
 * 前者是用户显式保存的空选择，后者根本没有可选来源。
 */
export function defaultSelectionFor(pack: MaterialPack): MaterialSelection {
  if (pack.sources.length === 0) return emptySelection();
  return { sourceIds: pack.sources.map((source) => source.id), resolutions: {} };
}

/**
 * 某个目标的来源选择：有存档就用存档，没有才落默认口径。
 *
 * 显式保存的空选择（模型通用知识）必须原样返回，不能被默认值覆盖，
 * 否则用户每次打开设置页都会被切回教材口径。
 *
 * 这里不做 normalizeSelection：调用方传进来的 pack 可能是「内置包 + 笔记」
 * 的合并结果，而默认值只该看内置包；把规范化留给合并后的调用方，
 * 才不会把用户显式选中的「我的笔记」当成未知来源丢掉。
 */
export function selectionForTarget(
  stored: MaterialSelection | undefined,
  pack: MaterialPack,
): MaterialSelection {
  return stored ?? defaultSelectionFor(pack);
}

// ── 片段筛选与排序 ────────────────────────────────────────────────

/**
 * 某个知识点命中的片段。
 *
 * 过滤条件有两条：来源被用户勾选，且 chunk.kcIds 含 concept.id。
 * 勾掉一个来源就是「不希望它出现在上下文与依据里」，不是「排在后面」——
 * 空选择代表「模型通用知识」模式，此时返回空集合，而不是把整包塞进去。
 * 章节相等只是排序键，不是过滤条件——跨章引用（例如在「串」一章讲 KMP 的
 * 复杂度追溯）如果因为章节不同被丢掉，学生就看不到教材里真实存在的段落。
 *
 * 排序键依次为：
 *   1. selection.sourceIds 中的优先级
 *   2. chunk.chapter 与 concept.chapter 是否相等（相等靠前，仅影响顺序）
 *   3. pageFrom 升序（没有页码的排最后）
 *   4. chunk.id 字典序，保证结果完全确定
 */
export function chunksForConcept(
  pack: MaterialPack,
  concept: KnowledgeConcept,
  selection: MaterialSelection,
): readonly MaterialChunk[] {
  const rank = new Map<string, number>();
  selection.sourceIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });

  return pack.chunks
    .filter((chunk) => rank.has(chunk.sourceId) && chunk.kcIds.includes(concept.id))
    .sort((a, b) => {
      const ra = rank.get(a.sourceId) ?? 0;
      const rb = rank.get(b.sourceId) ?? 0;
      if (ra !== rb) return ra - rb;

      const ca = a.chapter === concept.chapter ? 0 : 1;
      const cb = b.chapter === concept.chapter ? 0 : 1;
      if (ca !== cb) return ca - cb;

      const pa = a.pageFrom ?? Number.POSITIVE_INFINITY;
      const pb = b.pageFrom ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;

      return compareIds(a.id, b.id);
    });
}

/** 片段 → 摘录。正文为空或来源缺失时返回 null，绝不补造页码。 */
function excerptOf(chunk: MaterialChunk, source: MaterialSource | undefined): MaterialExcerpt | null {
  if (!source) return null;
  const text = chunk.text.trim();
  if (text === "") return null;

  const codePoints = Array.from(text);
  const truncated = codePoints.length > MAX_EXCERPT_CHARS;

  return {
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    sourceTitle: source.title,
    kind: source.kind,
    chapter: chunk.chapter,
    section: chunk.section,
    pageFrom: chunk.pageFrom ?? null,
    pageTo: chunk.pageTo ?? null,
    text: truncated ? codePoints.slice(0, MAX_EXCERPT_CHARS).join("") : text,
    truncated,
  };
}

/** 某个知识点优先级最高的一条摘录；没有命中返回 null。 */
export function excerptFor(
  pack: MaterialPack,
  concept: KnowledgeConcept,
  selection: MaterialSelection,
): MaterialExcerpt | null {
  const sources = new Map(pack.sources.map((s) => [s.id, s] as const));
  for (const chunk of chunksForConcept(pack, concept, selection)) {
    const excerpt = excerptOf(chunk, sources.get(chunk.sourceId));
    if (excerpt) return excerpt;
  }
  return null;
}

/**
 * 引用抬头，例如：
 *   [教材·《数据结构（C 语言版）》·第3章 栈与队列·第45–46页]
 *
 * 页码缺失时整段省略，不写「第 0 页」也不猜；
 * 章节缺失时同样省略，宁可少一个定位点也不编一个。
 */
export function citationLabel(excerpt: MaterialExcerpt): string {
  const kind = excerpt.kind === "textbook" ? "教材" : "讲义";
  const parts = [`${kind}·《${excerpt.sourceTitle}》`];
  if (excerpt.chapter.trim() !== "") parts.push(excerpt.chapter);
  if (excerpt.pageFrom !== null) {
    const to = excerpt.pageTo !== null ? excerpt.pageTo : excerpt.pageFrom;
    parts.push(to === excerpt.pageFrom ? `第${excerpt.pageFrom}页` : `第${excerpt.pageFrom}–${to}页`);
  }
  return `[${parts.join("·")}]`;
}

// ── 上下文拼装 ────────────────────────────────────────────────────

interface Candidate {
  readonly concept: KnowledgeConcept;
  readonly excerpt: MaterialExcerpt;
  readonly sourceRank: number;
  readonly chapterMatch: 0 | 1;
}

/** 与 chunksForConcept 相同的优先级，用于跨知识点比较与丢弃。 */
function priorityCompare(a: Candidate, b: Candidate): number {
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
  if (a.chapterMatch !== b.chapterMatch) return a.chapterMatch - b.chapterMatch;
  const pa = a.excerpt.pageFrom ?? Number.POSITIVE_INFINITY;
  const pb = b.excerpt.pageFrom ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return compareIds(a.excerpt.chunkId, b.excerpt.chunkId);
}

/** 当前列表里优先级最低的一条。 */
function worstIndex(items: readonly Candidate[]): number {
  let worst = 0;
  for (let i = 1; i < items.length; i += 1) {
    if (priorityCompare(items[worst], items[i]) < 0) worst = i;
  }
  return worst;
}

/**
 * 渲染正文：同一个知识点的片段排在一起，每个片段以引用抬头开始。
 * 片段之间用单个换行，知识点之间空一行。
 */
function renderExcerpts(items: readonly Candidate[]): string {
  const paragraphs: string[] = [];
  let currentConcept = "";
  let blocks: string[] = [];

  for (const item of items) {
    if (item.concept.id !== currentConcept) {
      if (blocks.length > 0) paragraphs.push(blocks.join("\n"));
      currentConcept = item.concept.id;
      blocks = [];
    }
    blocks.push(`${citationLabel(item.excerpt)}\n${item.excerpt.text}`);
  }
  if (blocks.length > 0) paragraphs.push(blocks.join("\n"));

  return paragraphs.join("\n\n");
}

function conflictBlock(pack: MaterialPack, conflict: MaterialConflict): string {
  const titles = new Map(pack.sources.map((s) => [s.id, s.title] as const));
  const parts = conflict.claims.map((claim) => {
    const sourceTitle = claim.sourceId ? titles.get(claim.sourceId) : undefined;
    const speaker = sourceTitle
      ? `《${sourceTitle}》`
      : claim.basis === "model"
        ? "模型"
        : claim.basis === "textbook"
          ? "教材"
          : "讲义";
    return `${speaker} 称「${claim.statement}」`;
  });
  return `【口径分歧｜尚未选定】${parts.join("；")}；请同时列出两种说法，不要替用户选择`;
}

/** 已裁定口径的指令块：给出被选中说法的出处与原文摘要。 */
function resolutionBlock(
  pack: MaterialPack,
  conflict: MaterialConflict,
  claim: MaterialClaim,
): string {
  const source = claim.sourceId ? pack.sources.find((s) => s.id === claim.sourceId) : undefined;
  const speaker = source
    ? `《${source.title}》`
    : claim.basis === "model"
      ? "模型"
      : claim.basis === "textbook"
        ? "教材"
        : "讲义";
  const pages =
    claim.pageFrom === undefined
      ? ""
      : claim.pageTo === undefined || claim.pageTo === claim.pageFrom
        ? `第${claim.pageFrom}页`
        : `第${claim.pageFrom}–${claim.pageTo}页`;
  const where = pages === "" ? speaker : `${speaker}${pages}`;
  return `【口径裁定｜以此为准】${conflict.topic}：按${where}的说法——「${claim.statement}」；不要再列出其他来源的不同说法。`;
}

/**
 * 为若干知识点拼装可注入的上下文。
 *
 * 预算是这样花的：
 *   1. 单条摘录先按 MAX_EXCERPT_CHARS 截断（excerptOf 已完成）
 *   2. 总长仍超 maxChars 时，按「来源优先级 → 章节是否匹配 → 页码 → id」
 *      从最低优先级开始丢，直到装得下
 *   3. 未决分歧在预算之外追加，且永远保留——静默替用户选边比超长更糟
 *
 * 因此返回的 coveredKcIds / missingKcIds / citations 都是裁剪之后的事实：
 * 某个知识点的片段全被丢掉时，它必须出现在 missingKcIds 里。
 */
export function buildMaterialContext(
  pack: MaterialPack,
  concepts: readonly KnowledgeConcept[],
  selection: MaterialSelection,
  maxChars: number = MAX_CONTEXT_CHARS,
): MaterialContext {
  const unique = dedupeById(concepts);
  const sources = new Map(pack.sources.map((s) => [s.id, s] as const));
  const rank = new Map<string, number>();
  selection.sourceIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });

  const candidates: Candidate[] = [];
  for (const concept of unique) {
    for (const chunk of chunksForConcept(pack, concept, selection)) {
      const excerpt = excerptOf(chunk, sources.get(chunk.sourceId));
      if (!excerpt) continue;
      candidates.push({
        concept,
        excerpt,
        sourceRank: rank.get(chunk.sourceId) ?? selection.sourceIds.length,
        chapterMatch: chunk.chapter === concept.chapter ? 0 : 1,
      });
    }
  }

  let included = [...candidates];
  let text = renderExcerpts(included);
  const limit = Math.max(0, maxChars);
  while (charLength(text) > limit && included.length > 0) {
    const worst = worstIndex(included);
    included = included.filter((_, index) => index !== worst);
    text = renderExcerpts(included);
  }

  const requested = new Set(unique.map((c) => c.id));
  /*
   * 分歧与裁定都只在「按资料」模式下出现。
   * 模型通用知识模式（空选择）连这两块也要一起收起来：它们援引的是书目原文，
   * 在用户明确说「不引用具体书目」之后还出现在提示词里，等于绕过选择。
   */
  const usingMaterials = selection.sourceIds.length > 0;
  const unresolved = usingMaterials
    ? unresolvedConflicts(pack, selection).filter((c) => requested.has(c.kcId))
    : [];

  const conflictText = unresolved.map((c) => conflictBlock(pack, c)).join("\n\n");
  if (conflictText !== "") {
    text = text === "" ? conflictText : `${text}\n\n${conflictText}`;
  }

  /*
   * 已裁定的分歧要落成指令，而不是「少一条提示」。
   * 裁定块只对本次请求的知识点生效；它不是摘录，所以不占预算、也不进 citations。
   */
  const resolved = usingMaterials
    ? resolvedConflicts(pack, selection).filter((r) => requested.has(r.conflict.kcId))
    : [];
  const resolvedText = resolved
    .map((r) => resolutionBlock(pack, r.conflict, r.claim))
    .join("\n");
  if (resolvedText !== "") {
    text = text === "" ? resolvedText : `${text}\n\n${resolvedText}`;
  }

  const citations: MaterialCitation[] = included.map((item) => ({
    chunkId: item.excerpt.chunkId,
    sourceId: item.excerpt.sourceId,
    label: citationLabel(item.excerpt),
  }));

  const coveredKcIds: string[] = [];
  const missingKcIds: string[] = [];
  for (const concept of unique) {
    const covered = included.some((item) => item.concept.id === concept.id);
    if (covered) coveredKcIds.push(concept.id);
    else missingKcIds.push(concept.id);
  }

  return { text, citations, coveredKcIds, missingKcIds, unresolved };
}

/** 依据标注。没有引用时返回空串，调用方据此不显示「依据：」。 */
export function materialCheckLabel(citations: readonly MaterialCitation[]): string {
  if (citations.length === 0) return "";
  const labels = [...new Set(citations.map((c) => c.label))];
  return `${MATERIAL_CHECK_PREFIX}${labels.join("；")}`;
}

// ── 口径分歧 ──────────────────────────────────────────────────────

/** 冲突的稳定 key：知识点 + 争议维度。 */
export function materialConflictKey(kcId: string, topic: string): string {
  return `${kcId}::${topic}`;
}

/**
 * 同一知识点、同一维度下出现两种以上不同说法的位置。
 *
 * 只在 statement 真正不同时算分歧：同一句话被两本书都写了，是共识不是冲突。
 * 结果按 key 排序、claims 按 id 排序，保证每次检测顺序一致。
 */
export function detectConflicts(pack: MaterialPack): readonly MaterialConflict[] {
  const groups = new Map<string, MaterialClaim[]>();
  for (const claim of pack.claims) {
    const key = materialConflictKey(claim.kcId, claim.topic);
    const list = groups.get(key);
    if (list) list.push(claim);
    else groups.set(key, [claim]);
  }

  const conflicts: MaterialConflict[] = [];
  const entries = [...groups.entries()].sort((a, b) => compareIds(a[0], b[0]));
  for (const [key, claims] of entries) {
    if (new Set(claims.map((c) => c.statement)).size < 2) continue;
    const sorted = [...claims].sort((a, b) => compareIds(a.id, b.id));
    conflicts.push({ key, kcId: sorted[0].kcId, topic: sorted[0].topic, claims: sorted });
  }
  return conflicts;
}

/**
 * 尚未裁定的分歧。
 *
 * 裁定记录必须指向该冲突里真实存在的 claim；指向已删除说法的旧记录视为未裁定，
 * 否则用户会在界面上看到「已选定」但正文里没有任何对应说法。
 */
export function unresolvedConflicts(
  pack: MaterialPack,
  selection: MaterialSelection,
): readonly MaterialConflict[] {
  return detectConflicts(pack).filter((conflict) => {
    const chosen = selection.resolutions[conflict.key];
    return chosen === undefined || !conflict.claims.some((claim) => claim.id === chosen);
  });
}

/**
 * 已裁定的分歧，带上用户选中的那条说法。
 *
 * 只隐藏「口径分歧」提示是不够的：模型仍然同时看到两段互相矛盾的原文，
 * 照样可能按另一家的说法生成。所以裁定必须落成一条明确的指令，
 * 连同被选中说法的正文与出处一起注入。
 */
export function resolvedConflicts(
  pack: MaterialPack,
  selection: MaterialSelection,
): readonly { readonly conflict: MaterialConflict; readonly claim: MaterialClaim }[] {
  const out: { conflict: MaterialConflict; claim: MaterialClaim }[] = [];
  for (const conflict of detectConflicts(pack)) {
    const chosen = selection.resolutions[conflict.key];
    if (chosen === undefined) continue;
    const claim = conflict.claims.find((c) => c.id === chosen);
    if (!claim) continue;
    out.push({ conflict, claim });
  }
  return out;
}

/** 一句话描述当前选择，用于路径页与设置页的回显。 */
export function describeSelection(pack: MaterialPack, selection: MaterialSelection): string {
  const chosen = selection.sourceIds
    .map((id) => pack.sources.find((s) => s.id === id))
    .filter((s): s is MaterialSource => s !== undefined);

  if (chosen.length === 0) return "未选择来源";

  const names = chosen.map((s) => `${s.kind === "textbook" ? "教材" : "讲义"}《${s.title}》`);
  const chunkCount = pack.chunks.filter((c) => selection.sourceIds.includes(c.sourceId)).length;
  const pending = unresolvedConflicts(pack, selection).length;
  const tail = pending > 0 ? `；${pending} 处口径分歧待选定` : "";
  return `已选 ${chosen.length} 个来源：${names.join("、")}；可摘录 ${chunkCount} 段${tail}`;
}

// ── 笔记与数据包合并 ────────────────────────────────────────────────

/**
 * 把笔记转成数据包。
 *
 * 笔记没有独立书目，统一挂在一份「我的笔记」讲义下；章节从绑定的知识点继承，
 * 这样它与教材片段在同一条排序线上比较，章节匹配的笔记不会被排到后面。
 * 一条笔记绑定多个知识点且跨章时，取第一个能找到的知识点的章节。
 */
export function notesAsPack(
  notes: readonly MaterialNote[],
  graph?: KnowledgeGraph,
): MaterialPack {
  if (notes.length === 0) return emptyPack(NOTES_SOURCE_ID, "我的笔记");

  const chapters = new Map<string, string>();
  if (graph) {
    for (const concept of graph.concepts) chapters.set(concept.id, concept.chapter);
  }

  const chunks: MaterialChunk[] = notes.map((note) => {
    const chapter =
      note.kcIds.map((id) => chapters.get(id)).find((c): c is string => c !== undefined && c !== "") ?? "";
    return {
      id: `note-${note.id}`,
      sourceId: NOTES_SOURCE_ID,
      kcIds: note.kcIds,
      chapter,
      section: note.title.trim() === "" ? "笔记" : note.title,
      text: note.body,
    };
  });

  return {
    id: NOTES_SOURCE_ID,
    title: "我的笔记",
    sources: [
      {
        id: NOTES_SOURCE_ID,
        kind: "lecture",
        title: "我的笔记",
        note: "用户手工录入，按绑定知识点归入对应章节",
      },
    ],
    chunks,
    claims: [],
  };
}

/**
 * 合并多个数据包（内置资料 + 笔记）。
 *
 * 按 id 去重，先出现的优先：同 id 片段以第一个包为准，
 * 这样「内置包在前、笔记在后」的合并顺序不会让笔记覆盖内置原文。
 */
export function mergePacks(packs: readonly MaterialPack[]): MaterialPack {
  if (packs.length === 0) return emptyPack();
  if (packs.length === 1) return packs[0];

  return {
    id: packs.map((p) => p.id).filter((id) => id !== "").join("+"),
    title: packs.map((p) => p.title).filter((title) => title !== "").join("、"),
    sources: dedupeById(packs.flatMap((p) => p.sources)),
    chunks: dedupeById(packs.flatMap((p) => p.chunks)),
    claims: dedupeById(packs.flatMap((p) => p.claims)),
  };
}

// ── 校验 ──────────────────────────────────────────────────────────

/**
 * 数据包自检。返回全部问题，空数组表示可用。
 *
 * 书名、章节名是否与图谱一致无法在这里判断（本模块不认识具体图谱），
 * 由数据包自身的测试对照图谱断言；这里只查结构上一定会让界面出错的项。
 */
export function validatePack(pack: MaterialPack): string[] {
  const issues: string[] = [];

  if (pack.id.trim() === "") issues.push("数据包 id 为空");
  if (pack.title.trim() === "") issues.push("数据包标题为空");
  if (pack.sources.length === 0) issues.push("数据包没有任何来源");
  if (pack.chunks.length === 0) issues.push("数据包没有任何片段");

  const sourceIds = new Set<string>();
  for (const source of pack.sources) {
    if (source.id.trim() === "") issues.push("存在 id 为空的来源");
    if (sourceIds.has(source.id)) issues.push(`来源 id 重复：${source.id}`);
    sourceIds.add(source.id);
    if (source.title.trim() === "") issues.push(`来源 ${source.id} 标题为空`);
    const kind: string = source.kind;
    if (kind !== "textbook" && kind !== "lecture") {
      issues.push(`来源 ${source.id} 的类型非法：${kind}`);
    }
  }

  const chunkIds = new Set<string>();
  for (const chunk of pack.chunks) {
    if (chunk.id.trim() === "") issues.push("存在 id 为空的片段");
    if (chunkIds.has(chunk.id)) issues.push(`片段 id 重复：${chunk.id}`);
    chunkIds.add(chunk.id);
    if (!sourceIds.has(chunk.sourceId)) {
      issues.push(`片段 ${chunk.id} 指向不存在的来源 ${chunk.sourceId}`);
    }
    if (chunk.kcIds.length === 0) issues.push(`片段 ${chunk.id} 未绑定知识点`);
    if (chunk.kcIds.some((id) => id.trim() === "")) issues.push(`片段 ${chunk.id} 含空的知识点 id`);
    if (chunk.chapter.trim() === "") issues.push(`片段 ${chunk.id} 缺章节`);
    if (chunk.section.trim() === "") issues.push(`片段 ${chunk.id} 缺小节`);
    if (chunk.text.trim() === "") issues.push(`片段 ${chunk.id} 正文为空`);

    const hasFrom = chunk.pageFrom !== undefined;
    const hasTo = chunk.pageTo !== undefined;
    if (hasFrom !== hasTo) issues.push(`片段 ${chunk.id} 的页码不成对`);
    if (chunk.pageFrom !== undefined && (!Number.isInteger(chunk.pageFrom) || chunk.pageFrom < 1)) {
      issues.push(`片段 ${chunk.id} 的起始页非法：${chunk.pageFrom}`);
    }
    if (chunk.pageTo !== undefined && (!Number.isInteger(chunk.pageTo) || chunk.pageTo < 1)) {
      issues.push(`片段 ${chunk.id} 的结束页非法：${chunk.pageTo}`);
    }
    if (
      chunk.pageFrom !== undefined &&
      chunk.pageTo !== undefined &&
      chunk.pageTo < chunk.pageFrom
    ) {
      issues.push(`片段 ${chunk.id} 的结束页早于起始页`);
    }
  }

  const claimIds = new Set<string>();
  for (const claim of pack.claims) {
    if (claim.id.trim() === "") issues.push("存在 id 为空的说法");
    if (claimIds.has(claim.id)) issues.push(`说法 id 重复：${claim.id}`);
    claimIds.add(claim.id);
    if (claim.kcId.trim() === "") issues.push(`说法 ${claim.id} 未绑定知识点`);
    if (claim.topic.trim() === "") issues.push(`说法 ${claim.id} 缺争议维度`);
    if (claim.statement.trim() === "") issues.push(`说法 ${claim.id} 内容为空`);
    if (claim.sourceId !== undefined && !sourceIds.has(claim.sourceId)) {
      issues.push(`说法 ${claim.id} 指向不存在的来源 ${claim.sourceId}`);
    }
    const basis: string = claim.basis;
    if (basis !== "textbook" && basis !== "lecture" && basis !== "model") {
      issues.push(`说法 ${claim.id} 的依据非法：${basis}`);
    }
    if (claim.basis !== "model" && claim.sourceId === undefined) {
      issues.push(`说法 ${claim.id} 依据是教材 / 讲义却没有来源`);
    }
  }

  return issues;
}

// ── 存档解析 ──────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "" || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

/**
 * 解析存档。坏 JSON、版本不符、形状不对一律回到默认空状态。
 *
 * 这里刻意不抛错也不保留半截数据：存档损坏时让学生「重新选来源」，
 * 比让界面拿着残缺的选择去拼一个看似正常的上下文安全。
 */
export function parseMaterialsState(raw: string | null | undefined): MaterialsState {
  if (!raw) return emptyMaterialsState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyMaterialsState();
  }

  if (!isRecord(parsed) || parsed.version !== 1) return emptyMaterialsState();

  const targets: Record<string, MaterialSelection> = {};
  if (isRecord(parsed.targets)) {
    for (const [targetId, value] of Object.entries(parsed.targets)) {
      if (targetId.trim() === "" || !isRecord(value)) continue;
      const resolutions: Record<string, string> = {};
      if (isRecord(value.resolutions)) {
        for (const [key, claimId] of Object.entries(value.resolutions)) {
          if (key.trim() !== "" && typeof claimId === "string" && claimId.trim() !== "") {
            resolutions[key] = claimId;
          }
        }
      }
      targets[targetId] = { sourceIds: stringList(value.sourceIds), resolutions };
    }
  }

  const notes: MaterialNote[] = [];
  const noteIds = new Set<string>();
  if (Array.isArray(parsed.notes)) {
    for (const item of parsed.notes) {
      if (!isRecord(item)) continue;
      const id = typeof item.id === "string" ? item.id : "";
      const title = typeof item.title === "string" ? item.title : "";
      const body = typeof item.body === "string" ? item.body : "";
      const kcIds = stringList(item.kcIds);
      if (id.trim() === "" || noteIds.has(id) || kcIds.length === 0) continue;
      noteIds.add(id);
      notes.push({ id, title, body, kcIds });
    }
  }

  return { version: 1, targets, notes };
}

/** 序列化为存档字符串。字段顺序由对象字面量固定，便于 diff 与排查。 */
export function serializeMaterialsState(state: MaterialsState): string {
  return JSON.stringify({
    version: 1,
    targets: state.targets,
    notes: state.notes.map((note) => ({
      id: note.id,
      title: note.title,
      body: note.body,
      kcIds: note.kcIds,
    })),
  });
}

export type CoerceMaterialsResult =
  | { readonly ok: true; readonly state: MaterialsState }
  | { readonly ok: false; readonly error: string };

/**
 * 保存前的强制检查。
 *
 * 与 provider 的静默降级不同：笔记是用户亲手写的内容，
 * 存不下必须让他知道是哪一条超限，而不是关掉页面后才发现丢了几千字。
 * 检查顺序是先结构、后长度，错误信息里带序号与标题，方便定位。
 */
export function coerceMaterialsForSave(state: MaterialsState): CoerceMaterialsResult {
  let total = 0;
  const notes: MaterialNote[] = [];

  for (let i = 0; i < state.notes.length; i += 1) {
    const note = state.notes[i];
    const trimmedTitle = note.title.trim();
    const label = trimmedTitle === "" ? `第 ${i + 1} 条笔记` : `第 ${i + 1} 条笔记《${trimmedTitle}》`;

    if (trimmedTitle === "") return { ok: false, error: `${label}的标题为空` };

    const kcIds = stringList(note.kcIds);
    if (kcIds.length === 0) return { ok: false, error: `${label}没有绑定知识点` };

    const bodyLength = charLength(note.body);
    if (bodyLength > MAX_NOTE_CHARS) {
      return {
        ok: false,
        error: `${label}正文 ${bodyLength} 字，超过单条上限 ${MAX_NOTE_CHARS} 字`,
      };
    }

    total += bodyLength;
    if (total > MAX_NOTES_TOTAL_CHARS) {
      return {
        ok: false,
        error: `全部笔记正文合计 ${total} 字，超过上限 ${MAX_NOTES_TOTAL_CHARS} 字（${label}已超）`,
      };
    }

    notes.push({ id: note.id, title: note.title, body: note.body, kcIds });
  }

  return { ok: true, state: { ...state, version: 1, notes } };
}
