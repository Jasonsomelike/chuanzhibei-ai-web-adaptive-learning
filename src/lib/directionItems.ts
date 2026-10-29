"use client";

/**
 * 自定义方向的题目：按 KC 懒生成、落库缓存、带双解校验。
 *
 * 为什么按 KC 懒生成而不是创建方向时批量：
 * 一个 20 点方向要 80 题，每 KC 3 次模型调用就是 60 次串行请求，
 * 用户点「保存」后要等 1–3 分钟；而一次 15 题的诊断最多触达前 5–8 个 KC，
 * 为剩下的 KC 付费生成、用户可能永远不测，是纯浪费。
 *
 * 缓存必须落库而不是只放内存：市场里「选用」是复制图谱，
 * 落库后副本第二次诊断、换设备、复习都零调用。
 *
 * 调用次数是 1 次生成 + 2 次批解 = 3 次/KC，不是 3 次/题。
 */

import {
  callChat,
  runStructuredCall,
  type StructuredCallResult,
  type StructuredValidation,
} from "@/lib/chat";
import { extractJson } from "@/lib/direction";
import type { ProviderConfig } from "@/lib/provider";
import {
  checkBatch,
  parseBatch,
  buildSolverPrompt,
  compareSolverAnswers,
  parseSolverAnswers,
  normalizeText,
  kcEvidenceTarget,
  type DirectionItem,
  type ItemCheckResult,
  type ItemStatus,
  type RawBatch,
  type RawItem,
} from "@/lib/itemgen";
import type { KnowledgeGraph, KnowledgeConcept } from "@/lib/graph";
import { borrowItems } from "@/lib/borrow";
import {
  buildMaterialContext,
  materialCheckLabel,
  mergePacks,
  type MaterialPack,
  type MaterialSelection,
} from "@/lib/materials";
import { applyItemEvidence, stripNonEvidenceBlocks, type ItemEvidenceResult } from "@/lib/verify";
import { verifyItemEvidence } from "@/lib/verifyClient";

export const ITEM_SYSTEM_PROMPT = `你是大学课程的出题老师。根据给定的知识点，出一批四选一选择题。

严格输出 JSON，不要任何解释文字、不要 markdown 代码块。格式：

{
  "items": [
    {
      "difficulty": "basic" | "advanced" | "challenge",
      "difficultyReason": "一句话说明为什么是这个档",
      "stem": "题干",
      "options": ["选项A", "选项B", "选项C", "选项D"],
      "answerText": "必须与 options 中某一项逐字相同",
      "explanation": "为什么对，其它选项错在哪，至少 20 字"
    }
  ]
}

硬性规则：
1. 每道题恰好 4 个选项，选项之间不能同义重复。
2. 不要使用「以上都对」「以上都不对」「无法确定」这类选项。
3. answerText 必须从 options 里原样复制，不要写「A」「选项A」或编号。
4. 难度三档都要覆盖，basic 考记忆与定义，advanced 考理解与应用，challenge 考综合与推导。
5. 题干 8–200 字，不要出现「如图所示」「见上文」这类依赖外部材料的表述。
6. 题目必须能仅凭题干与选项判断对错，不要出需要额外假设的题。`;

/** 生成题的证据折扣：标签来自模型，可信度低于人工校准的内置题。 */
export interface EnsureItemsResult {
  readonly items: readonly DirectionItem[];
  /** 新生成并落库的题数。0 表示全部来自缓存。 */
  readonly generated: number;
  /** 降级原因。非空时界面必须如实展示。 */
  readonly error: string | null;
  /** 本次生成的流程轨迹。只存在于内存，不落库。 */
  readonly trace: readonly ItemTraceStep[];
  /** 依据核对（L6）的汇总。 */
  readonly verification: ItemVerificationSummary;
}

/**
 * 生成流程的一步，供界面展示 L1–L6 的轨迹。
 *
 * 这是可核对的过程记录（跑了哪几层、哪层没过），不是模型的原始思维链。
 */
export interface ItemTraceStep {
  readonly key: "generate" | "L1" | "L2" | "L3" | "L4" | "L6" | "save";
  readonly label: string;
  readonly status: "ok" | "warn" | "fail" | "skip";
  readonly detail?: string;
}

/**
 * 一个 KC 的依据核对汇总。
 *
 * attempted=false 时 note 说明为什么没核对（开关关闭 / 无原文 / 无题）。
 * unverified 单独计数：它和 failed 不同，不构成降级证据。
 */
export interface ItemVerificationSummary {
  readonly attempted: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly unverified: number;
  readonly skipped: number;
  readonly note: string | null;
}

/**
 * ensureAllItems 一次最多核对多少个 KC。
 *
 * 每个 KC 一次调用，20 个恰好对应方向图谱的知识点上限；
 * 超过时只核对前 20 个，其余在结果里如实报「未核对」。
 */
export const MAX_VERIFIED_CONCEPTS = 20;

export interface EnsureItemsOptions {
  readonly directionId: string;
  readonly concept: KnowledgeConcept;
  readonly provider: ProviderConfig | null;
  readonly signal?: AbortSignal;
  /** 已存在的题，传了就跳过网络请求（缓存命中）。 */
  readonly cached?: readonly DirectionItem[];
  /**
   * 教材 / 讲义口径。context 拼进提示词作为出题依据，
   * checkLabel 随题落进 checks 供界面展示出处。
   * 两者都不参与 source / status / 证据折扣的判定。
   */
  readonly material?: EnsureItemsMaterial;
  /**
   * 是否执行 L6 依据核对。不传时读 provider.verification（缺省开启）。
   * 显式 false 时完全不发核对请求。
   */
  readonly verification?: boolean;
}

/** 注入生成链路的资料口径。详见 materials.ts 的 buildMaterialContext。 */
export interface EnsureItemsMaterial {
  /** 已拼好的原文片段（含引用抬头）。 */
  readonly context: string;
  /** 展示用的依据标注，如「依据：[教材·《…》·第3章·第45–46页]」。 */
  readonly checkLabel: string;
}

/** 整批生成题目时的资料输入：数据包 + 用户对来源与口径的选择。 */
export interface EnsureAllItemsMaterial {
  readonly pack: MaterialPack;
  readonly selection: MaterialSelection;
  /**
   * 该方向的上传资料包（IndexedDB → uploadsToPack）。
   * 只包含绑定了知识点的文档；不传时行为与旧版一致。
   */
  readonly uploadedPack?: MaterialPack;
}

/**
 * 单个知识点的资料口径。
 *
 * 这里是「资料怎么拼」的唯一实现：ensureAllItems 逐点调用它，
 * 诊断页的懒生成也按同一判据（citations 非空才注入）。
 *
 * uploadedPack 与内置包合并，并把上传来源追加进选择：uploadsToPack 的
 * source id 是文档 id，不在用户的教材选择里；不追加就永远命中不了上传片段。
 * 追加在末尾，因此上传资料优先级低于用户已选的教材 / 讲义。
 *
 * 没有可引用的片段时返回 undefined，而不是空上下文：
 * 空上下文只会让提示词多一个空的「教材原文」小节，
 * 题卡也会多一行没有定位点的「依据」。
 */
export function materialForConcept(
  material: EnsureAllItemsMaterial | undefined,
  concept: KnowledgeConcept,
): EnsureItemsMaterial | undefined {
  if (!material) return undefined;

  const uploaded = material.uploadedPack;
  const pack = uploaded ? mergePacks([material.pack, uploaded]) : material.pack;
  const selection = uploaded
    ? {
        ...material.selection,
        sourceIds: [
          ...material.selection.sourceIds,
          ...uploaded.sources
            .map((source) => source.id)
            .filter((id) => !material.selection.sourceIds.includes(id)),
        ],
      }
    : material.selection;

  const context = buildMaterialContext(pack, [concept], selection);
  if (context.citations.length === 0) return undefined;

  return {
    context: context.text,
    checkLabel: materialCheckLabel(context.citations),
  };
}

// ── 流程轨迹与依据核对开关 ─────────────────────────────────────────

const TRACE_LABEL: Record<ItemTraceStep["key"], string> = {
  generate: "生成题目",
  L1: "L1 结构",
  L2: "L2 卫生",
  L3: "L3 答案",
  L4: "L4 双解",
  L6: "L6 依据核对",
  save: "落库",
};

function traceStep(
  key: ItemTraceStep["key"],
  status: ItemTraceStep["status"],
  detail?: string,
): ItemTraceStep {
  return detail === undefined
    ? { key, label: TRACE_LABEL[key], status }
    : { key, label: TRACE_LABEL[key], status, detail };
}

function emptyVerification(note: string | null): ItemVerificationSummary {
  return { attempted: false, passed: 0, failed: 0, unverified: 0, skipped: 0, note };
}

/** 取某层的第一条问题，用于 trace 的 detail。 */
function firstIssue(
  results: readonly ItemCheckResult[],
  key: "l2Issues" | "l3Issues",
): string {
  for (const result of results) {
    const issue = result[key][0];
    if (issue !== undefined) return issue;
  }
  return "";
}

/**
 * 是否执行 L6：显式参数优先，其次读 provider.verification !== false。
 *
 * 没有 provider 时一定不开启——核对本身也要调用模型。
 */
function verificationEnabled(
  provider: ProviderConfig | null,
  explicit: boolean | undefined,
): boolean {
  if (provider === null) return false;
  if (explicit !== undefined) return explicit;
  return provider.verification !== false;
}

/** 拉取某 KC 已落库的题。 */
export async function fetchItems(
  directionId: string,
  kcId: string,
): Promise<DirectionItem[]> {
  const res = await fetch(
    `/api/directions/items?directionId=${encodeURIComponent(directionId)}&kcId=${encodeURIComponent(kcId)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: DirectionItem[] };
  return data.items ?? [];
}

/** 一次批解的结果。ordered 与传入题目等长，按 index 归位，未作答为空串。 */
export interface SolverBatchResult {
  readonly ordered: readonly string[];
  /** 模型没有给出答案的题号（1-based）。 */
  readonly missing: readonly number[];
  /** 解析层面的问题：缺 answers 数组、重复 index、越界。 */
  readonly issues: readonly string[];
}

/**
 * 批解校验（L4）。
 *
 * 只给题干与选项，不给答案与解析——给了就是让模型复述。
 * 两次独立调用，第二次反转选项顺序：模型若在猜，位置一换就会露馅。
 *
 * 返回的 ordered 必须按 index 归位后再比较：两次调用是 Promise.all 并发的，
 * 模型返回的数组顺序不可依赖。missing 是留空的题号，调用方据此判断哪些题没答。
 */
export async function solveBatch(
  provider: ProviderConfig,
  items: readonly RawItem[],
  reverseOptions: boolean,
  signal?: AbortSignal,
): Promise<SolverBatchResult> {
  const { text } = await callChat(provider, {
    system: "你是严格的考试阅卷人，只依据题干与选项作答。",
    user: buildSolverPrompt(items, reverseOptions),
    maxTokens: 1200,
    temperature: 0,
    jsonMode: true,
    timeoutMs: 45000,
    signal,
    purpose: "verify",
  });

  const { answers, issues } = parseSolverAnswers(extractJson(text), items.length);
  const missing: number[] = [];
  for (let i = 0; i < answers.length; i += 1) {
    if (answers[i].trim() === "") missing.push(i + 1);
  }

  return { ordered: answers, missing, issues };
}

/**
 * 把资料口径拼到提示词末尾。
 *
 * 只注入原文与引用抬头，不注入结论：题目必须能在这段原文里找到依据。
 * 没有上下文时原样返回，避免提示词里出现空的「教材原文」小节。
 */
function withMaterialContext(user: string, material: EnsureItemsMaterial | undefined): string {
  const context = material?.context.trim() ?? "";
  if (context === "") return user;
  return `${user}

教材原文（题目必须与下列口径一致；引用只能使用这里出现的书目、章节与页码，不要编造出处）：
${context}`;
}

/**
 * 确保某 KC 有足够的题。
 *
 * 缓存命中（accepted ≥ ITEMS_PER_KC）时零调用直接返回。
 * 生成失败返回 error，由界面降级：跳过该 KC、只规划路径、或手动录题。
 */
export async function ensureItems(opts: EnsureItemsOptions): Promise<EnsureItemsResult> {
  const { directionId, concept, provider, cached } = opts;
  const checkLabel = opts.material?.checkLabel.trim() ?? "";

  const existing = cached ?? (await fetchItems(directionId, concept.id));
  const accepted = existing.filter((i) => i.status === "accepted");
  const acceptedNow = accepted.length;

  /*
   * 门槛按已有题目的来源动态取，不能一律用 ITEMS_PER_KC。
   *
   * 生成题的可信度低于人工校准题，所以要求 4 道；manual/borrowed 只需 3 道。
   * 一律按 4 判断会让「已有 3 道借用题」的知识点仍被判定不足，
   * 白跑一次生成并报「未达到 4 题门槛」的假失败。
   */
  const threshold = kcEvidenceTarget(accepted.map((i) => i.source));
  if (acceptedNow >= threshold) {
    return {
      items: existing,
      generated: 0,
      error: null,
      trace: [
        traceStep("generate", "skip", `缓存命中：已有 ${acceptedNow} 道通过校验的题`),
      ],
      verification: emptyVerification("缓存命中，未发起生成与核对"),
    };
  }

  if (!provider) {
    /*
     * 无模型时先尝试借用：方向若来自 composeFromExisting，
     * 知识点名称就是原学科的名称，能借到人工校准的题。
     * 借不到才报「无题」，由界面给「只规划路径 / 手动补题」出口。
     */
    const borrowed = borrowItems(concept, { directionId, now: new Date().toISOString() });
    if (borrowed.length === 0) {
      return {
        items: existing,
        generated: 0,
        error: "未配置模型供应商，且内置题库里没有同名知识点可借用。可以只规划路径、手动补题，或到设置页配置模型。",
        trace: [traceStep("generate", "skip", "未配置模型供应商")],
        verification: emptyVerification("未配置模型供应商，无法核对"),
      };
    }

    try {
      const res = await fetch("/api/directions/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directionId,
          kcId: concept.id,
          items: borrowed.map((b) => ({
            difficulty: b.difficulty === 2 ? "basic" : b.difficulty === 4 ? "challenge" : "advanced",
            /*
             * 不能带 difficultyReason：服务端把「声称 borrowed 却带生成理由」
             * 视为洗白，会一律降级成 generated 并打 0.8 折、抬高门槛。
             * 借用题的难度来自内置题库的人工校准，本来就没有生成理由。
             */
            stem: b.stem,
            options: b.options,
            answerText: b.options[b.answerIndex] ?? "",
            explanation: b.explanation,
            source: "borrowed",
            status: "accepted",
          })),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        return {
          items: existing,
          generated: 0,
          error: `借用题目落库失败：${data.error ?? `HTTP ${res.status}`}`,
          trace: [traceStep("save", "fail", "借用题目落库失败")],
          verification: emptyVerification("借用题未发起依据核对"),
        };
      }
      const data = (await res.json()) as { items?: DirectionItem[] };
      const saved = data.items ?? [];
      return {
        items: [...existing, ...saved],
        generated: saved.length,
        error: null,
        trace: [
          traceStep("generate", "skip", `从内置题库借用 ${saved.length} 题`),
          traceStep("save", "ok", `落库 ${saved.length} 题`),
        ],
        verification: emptyVerification("借用题来自人工校准题库，未发起依据核对"),
      };
    } catch (err) {
      return {
        items: existing,
        generated: 0,
        error: `借用题目落库失败：${err instanceof Error ? err.message : String(err)}`,
        trace: [traceStep("save", "fail", "借用题目落库失败")],
        verification: emptyVerification("借用题未发起依据核对"),
      };
    }
  }

  const need = Math.max(1, threshold - acceptedNow);
  const seenStems = new Set(existing.map((i) => normalizeText(i.stem)));

  let outcome: StructuredCallResult<RawBatch>;
  try {
    outcome = await runStructuredCall(
      provider,
      {
        system: ITEM_SYSTEM_PROMPT,
        user: withMaterialContext(
          `知识点：${concept.name}
说明：${concept.summary}
所属章节：${concept.chapter}

请出 ${Math.max(need, 3)} 道题，覆盖三个难度档。`,
          opts.material,
        ),
        maxTokens: 3500,
        temperature: 0.3,
        jsonMode: true,
        timeoutMs: 90000,
        signal: opts.signal,
        purpose: "items",
      },
      (text): StructuredValidation<RawBatch> => {
        const parsed = parseBatch(extractJson(text));
        return parsed.ok ? { ok: true, value: parsed.batch } : { ok: false, reason: parsed.reason };
      },
      // 只降一点温度；maxTokens 保持 3500（截断重试在这里没有更大预算可用）
      { temperature: 0.2 },
    );
  } catch (err) {
    return {
      items: existing,
      generated: 0,
      error: `生成失败：${err instanceof Error ? err.message : String(err)}`,
      trace: [traceStep("generate", "fail", `生成失败：${err instanceof Error ? err.message : String(err)}`)],
      verification: emptyVerification("生成失败，未发起核对"),
    };
  }

  const raw = outcome.firstText;
  // 截断的 JSON 不硬 parse——runStructuredCall 已按失败原因重问过一次
  const parsed = outcome.value;
  if (parsed === null) {
    const reason = outcome.reason ?? "结构不合格";
    return {
      items: existing,
      generated: 0,
      error: `模型输出无法解析：${reason}`,
      trace: [
        traceStep("generate", "ok", `模型返回 ${raw.length} 字`),
        traceStep("L1", "fail", reason),
      ],
      verification: emptyVerification("结构未通过，未发起核对"),
    };
  }

  const now = new Date().toISOString();
  const checked = checkBatch(parsed, {
    directionId,
    kcId: concept.id,
    now,
    seenStems,
  });

  /*
   * 把「原始输出」与「校验结果」按题干配对。
   * checkBatch 保持输入顺序，所以下标可以直接对齐；
   * 用下标而不是再查一遍，是为了避免 normalize 后题干相同的两题错配。
   */
  const pairs = checked.map((result, i) => ({
    raw: parsed.items[i],
    result,
  }));

  // L4 只对结构+答案都过的题做，失败也不阻塞——降级成 practice
  const solvable = pairs.filter((p) => p.result.item.status === "accepted");
  let l4Pass: boolean[] = solvable.map(() => false);
  let l4Error: string | null = null;
  let l4Complete = true;

  if (solvable.length > 0) {
    const raws = solvable.map((p) => p.raw).filter((r): r is RawItem => r !== undefined);
    try {
      const [first, reversed] = await Promise.all([
        solveBatch(provider, raws, false, opts.signal),
        solveBatch(provider, raws, true, opts.signal),
      ]);
      // 两次都按下标归位后再比文本；数组顺序不可信（并发返回顺序不定）
      l4Pass = compareSolverAnswers(
        raws.map((r) => r.answerText),
        first.ordered,
        reversed.ordered,
      );
      /*
       * 两次批解各自的问题都要报出来，去重后拼成一条。
       * 缺 answers 数组、重复 index、越界都意味着「对齐可能不可靠」，
       * 不能让界面只显示「题量不足」而把真实原因藏起来。
       */
      const solverIssues = [...new Set([...first.issues, ...reversed.issues])];
      if (solverIssues.length > 0) {
        l4Error = `双解校验有问题：${solverIssues.join("；")}`;
      }
    } catch (err) {
      l4Complete = false;
      l4Error = `双解校验未能完成：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ── 流程轨迹：L1 / L2 / L3 / L4 ──
  const l2Bad = checked.filter((r) => r.l2Issues.length > 0).length;
  const l3Bad = checked.filter((r) => r.l3Issues.length > 0).length;
  const trace: ItemTraceStep[] = [
    traceStep("generate", "ok", `模型返回 ${raw.length} 字`),
    traceStep("L1", "ok", `结构通过，共 ${parsed.items.length} 题`),
    l2Bad === 0
      ? traceStep("L2", "ok", `${checked.length} 题通过卫生检查`)
      : traceStep(
          "L2",
          l2Bad === checked.length ? "fail" : "warn",
          `${l2Bad} 题未通过：${firstIssue(checked, "l2Issues")}`,
        ),
    l3Bad === 0
      ? traceStep("L3", "ok", `${checked.length} 题答案唯一匹配`)
      : traceStep(
          "L3",
          l3Bad === checked.length ? "fail" : "warn",
          `${l3Bad} 题未通过：${firstIssue(checked, "l3Issues")}`,
        ),
  ];
  if (solvable.length === 0) {
    trace.push(traceStep("L4", "skip", "没有可批解的题"));
  } else if (l4Error !== null && !l4Complete) {
    trace.push(traceStep("L4", "fail", l4Error));
  } else if (l4Error !== null) {
    trace.push(traceStep("L4", "warn", l4Error));
  } else {
    const l4Bad = l4Pass.filter((pass) => !pass).length;
    trace.push(
      l4Bad === 0
        ? traceStep("L4", "ok", `${solvable.length} 题两次批解一致`)
        : traceStep("L4", "warn", `${l4Bad} 题两次批解不一致，降为练习`),
    );
  }

  // ── L6 依据核对：整批题只发一次调用 ──
  /*
   * 只核对未被 L2/L3 拒掉的题：rejected 不落库，核对它们没有意义。
   * L4 已降为 practice 的题仍在核对范围——通过也不会升级（applyItemEvidence
   * 保持原状态），但未通过时能把原因一并写进 checks。
   */
  const evidenceTargets: { pairIndex: number; raw: RawItem; result: ItemCheckResult }[] = [];
  pairs.forEach((pair, pairIndex) => {
    if (pair.result.item.status === "rejected") return;
    if (pair.raw === undefined) return;
    evidenceTargets.push({ pairIndex, raw: pair.raw, result: pair.result });
  });

  const verificationOn = verificationEnabled(provider, opts.verification);
  const materialContext = opts.material?.context ?? "";
  // 只有口径指令块、没有原文时同样算「无原文可核对」
  const evidenceAvailable = stripNonEvidenceBlocks(materialContext) !== "";
  let evidenceResults: readonly ItemEvidenceResult[] | null = null;
  let verification: ItemVerificationSummary;

  if (!verificationOn) {
    verification = emptyVerification("本次未开启依据核对");
    trace.push(traceStep("L6", "skip", "本次未开启依据核对"));
  } else if (!evidenceAvailable) {
    verification = emptyVerification("无原文可核对");
    trace.push(traceStep("L6", "skip", "无原文可核对"));
  } else if (evidenceTargets.length === 0) {
    verification = emptyVerification("没有可核对的题目");
    trace.push(traceStep("L6", "skip", "没有可核对的题目"));
  } else {
    const outcome = await verifyItemEvidence(
      provider,
      evidenceTargets.map((target) => ({
        stem: target.result.item.stem,
        options: target.result.item.options,
        answerText: target.raw.answerText,
      })),
      materialContext,
      opts.signal,
    );
    evidenceResults = outcome.results;

    let passed = 0;
    let failed = 0;
    let unverified = 0;
    let skipped = 0;
    for (const result of outcome.results) {
      if (result.outcome === "passed") passed += 1;
      else if (result.outcome === "failed") failed += 1;
      else if (result.outcome === "unverified") unverified += 1;
      else skipped += 1;
    }

    const note =
      outcome.error !== null
        ? `核对未完成：${outcome.error}`
        : failed > 0
          ? `${failed} 题未通过依据核对`
          : unverified > 0
            ? `${unverified} 题核对未完成`
            : null;
    verification = { attempted: true, passed, failed, unverified, skipped, note };

    if (outcome.error !== null || unverified > 0) {
      trace.push(traceStep("L6", "warn", note ?? "核对未完成"));
    } else if (failed > 0) {
      trace.push(traceStep("L6", "warn", `${failed} 题未通过，已降为练习`));
    } else if (passed === 0) {
      trace.push(traceStep("L6", "skip", "没有可核对的题目"));
    } else {
      trace.push(traceStep("L6", "ok", `${passed} 题有逐字依据`));
    }
  }

  // 依据核对结果按题目在批次里的位置归位（parseItemEvidenceBatch 保持输入顺序）
  const evidenceFor = new Map<number, ItemEvidenceResult>();
  if (evidenceResults !== null) {
    evidenceTargets.forEach((target, index) => {
      const result = evidenceResults?.[index];
      if (result !== undefined) evidenceFor.set(target.pairIndex, result);
    });
  }

  let solvableIndex = 0;
  const payload = pairs.map(({ raw, result }, pairIndex) => {
    const item = result.item;
    const l4Passed = item.status === "accepted" && l4Pass[solvableIndex] === true;
    if (item.status === "accepted") solvableIndex += 1;

    const l4Status: ItemStatus =
      item.status === "rejected" ? "rejected" : l4Passed ? "accepted" : "practice";

    /*
     * L6 结果只改状态与检查项，不改答案。
     * 通过不升级（L4 降成 practice 的题保持 practice）；
     * 未完成不降级（网络 / 解析失败不是「题目错」的证据）。
     */
    const evidenceResult = evidenceFor.get(pairIndex) ?? null;
    const applied = evidenceResult === null ? null : applyItemEvidence({ status: l4Status }, evidenceResult);
    const status: ItemStatus = applied === null ? l4Status : applied.status;

    const checks = [...item.checks];
    if (l4Passed) checks.push("双解校验");
    if (applied !== null && applied.check !== null) checks.push(applied.check);
    // 依据只用于展示出处，不参与 status 与证据折扣；空标注不落库
    if (checkLabel !== "") checks.push(checkLabel);

    return {
      difficulty: raw?.difficulty ?? "advanced",
      difficultyReason: raw?.difficultyReason,
      stem: item.stem,
      options: item.options,
      /*
       * 用模型原始的 answerText，而不是反查 answerIndex。
       * item.answerIndex 只在 L3 通过时才是真值；rejected 时它是兜底 0，
       * 反查会把「选项 A」当成答案回传，等于把兜底值洗成事实。
       */
      answerText: raw?.answerText ?? item.options[item.answerIndex] ?? "",
      explanation: item.explanation,
      source: item.source,
      status,
      checks,
    };
  });

  // 落库。服务端会重跑 L2/L3，status 由服务端最终决定
  try {
    const res = await fetch("/api/directions/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        directionId,
        kcId: concept.id,
        items: payload,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      const message = `题目落库失败：${data.error ?? `HTTP ${res.status}`}`;
      trace.push(traceStep("save", "fail", message));
      return {
        items: existing,
        generated: 0,
        error: message,
        trace,
        verification,
      };
    }

    const data = (await res.json()) as { items?: DirectionItem[] };
    const saved = data.items ?? [];
    const totalAccepted =
      existing.filter((i) => i.status === "accepted").length +
      saved.filter((i) => i.status === "accepted").length;

    /*
     * 生成成功但通过校验的题仍不够门槛时，也要如实报出来。
     * 否则界面会静默停在「没有题目」，用户不知道是模型质量差还是系统坏了；
     * 诊断页也据此把该 KC 标为已尝试，避免反复计费。
     *
     * 门槛要按「生成之后这一池子的来源」重算：空库时 threshold 是 3，
     * 沿用它会认为 3 道生成题已达标，而诊断页与方向页对同一批生成题按 4 判未就绪。
     */
    const finalThreshold = kcEvidenceTarget([
      ...accepted.map((i) => i.source),
      ...saved.map((i) => i.source),
    ]);
    const shortfall =
      totalAccepted < finalThreshold
        ? `本次只生成 ${saved.length} 题、其中 ${totalAccepted} 题通过校验，未达到 ${finalThreshold} 题门槛。可以重试、换模型，或手动补题。`
        : null;

    /*
     * 两条降级原因可以同时成立：双解对齐有疑问 + 通过校验的题不够门槛。
     * 只显示其中一条会让另一半原因在界面上消失，所以拼接而不是二选一。
     */
    const errorParts = [l4Error, shortfall].filter((e): e is string => e !== null);

    trace.push(
      traceStep(
        "save",
        "ok",
        `落库 ${saved.length} 题（accepted ${saved.filter((i) => i.status === "accepted").length}，practice ${saved.filter((i) => i.status === "practice").length}）`,
      ),
    );

    return {
      items: [...existing, ...saved],
      generated: saved.length,
      error: errorParts.length > 0 ? errorParts.join("；") : null,
      trace,
      verification,
    };
  } catch (err) {
    const message = `题目落库失败：${err instanceof Error ? err.message : String(err)}`;
    trace.push(traceStep("save", "fail", message));
    return {
      items: existing,
      generated: 0,
      error: message,
      trace,
      verification,
    };
  }
}

/** 整批生成的结果。 */
export interface EnsureAllItemsResult {
  readonly generated: number;
  readonly failed: { kcId: string; name: string; error: string }[];
  /**
   * 依据核对的执行汇总：checked 为实际发起核对的 KC 数；
   * capped 为超过 MAX_VERIFIED_CONCEPTS 而未核对的知识点。
   */
  readonly verification: {
    readonly checked: number;
    readonly capped: readonly { readonly kcId: string; readonly name: string }[];
  };
}

/**
 * 为一个方向的所有 KC 生成题目。给「生成全部题目」按钮用。
 *
 * 串行而不是并行：多数供应商对并发有限制，而且串行能给稳定的进度数字。
 * onProgress 在每 KC 完成后调用，界面据此显示 x/y。
 *
 * material 是整批共用的资料包与选择，逐点用 materialForConcept 拼成该点的口径：
 * 与诊断页的懒生成一致，没有可引用片段的知识点不带资料，提示词与旧行为相同。
 *
 * L6 最多核对 MAX_VERIFIED_CONCEPTS 个 KC（每 KC 一次调用）；超出的知识点
 * 仍照常生成题目，只是不发核对请求，并在返回值里列出来。
 */
export async function ensureAllItems(opts: {
  readonly directionId: string;
  readonly graph: KnowledgeGraph;
  readonly provider: ProviderConfig | null;
  readonly onProgress?: (done: number, total: number, kcName: string) => void;
  /** 每个 KC 的流程轨迹回调。与 onProgress 一样在 KC 完成后调用。 */
  readonly onTrace?: (kcId: string, kcName: string, trace: readonly ItemTraceStep[]) => void;
  readonly signal?: AbortSignal;
  /** 资料口径。不传时与旧行为完全一致（只用模型通用知识出题）。 */
  readonly material?: EnsureAllItemsMaterial;
  /** 是否执行 L6；不传时读 provider.verification（缺省开启）。 */
  readonly verification?: boolean;
}): Promise<EnsureAllItemsResult> {
  const { directionId, graph, provider, onProgress, onTrace } = opts;
  const all = await fetchItems(directionId, "");
  const byKc = new Map<string, DirectionItem[]>();
  for (const it of all) {
    const list = byKc.get(it.kcId) ?? [];
    list.push(it);
    byKc.set(it.kcId, list);
  }

  const verificationOn = verificationEnabled(provider, opts.verification);
  let verifiedCount = 0;
  const capped: { kcId: string; name: string }[] = [];

  let generated = 0;
  const failed: { kcId: string; name: string; error: string }[] = [];

  for (let i = 0; i < graph.concepts.length; i += 1) {
    const concept = graph.concepts[i];
    if (opts.signal?.aborted) break;

    /*
     * 上限按「实际发起核对的 KC 数」计，而不是按知识点序号：
     * 前面若有没配资料的知识点（不发请求），不应挤占后面的名额。
     */
    const overCap = verificationOn && verifiedCount >= MAX_VERIFIED_CONCEPTS;
    if (overCap) capped.push({ kcId: concept.id, name: concept.name });

    const r = await ensureItems({
      directionId,
      concept,
      provider,
      cached: byKc.get(concept.id) ?? [],
      signal: opts.signal,
      material: materialForConcept(opts.material, concept),
      verification: overCap ? false : opts.verification,
    });
    generated += r.generated;
    if (r.error) failed.push({ kcId: concept.id, name: concept.name, error: r.error });
    if (r.verification.attempted) verifiedCount += 1;
    onTrace?.(concept.id, concept.name, r.trace);
    onProgress?.(i + 1, graph.concepts.length, concept.name);
  }

  return { generated, failed, verification: { checked: verifiedCount, capped } };
}
