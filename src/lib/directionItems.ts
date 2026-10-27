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

import { callChat } from "@/lib/chat";
import { extractJson } from "@/lib/direction";
import type { ProviderConfig } from "@/lib/provider";
import {
  checkBatch,
  parseBatch,
  buildSolverPrompt,
  compareSolverAnswers,
  normalizeText,
  kcEvidenceTarget,
  type DirectionItem,
  type RawItem,
} from "@/lib/itemgen";
import type { KnowledgeGraph, KnowledgeConcept } from "@/lib/graph";
import { borrowItems } from "@/lib/borrow";

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
}

export interface EnsureItemsOptions {
  readonly directionId: string;
  readonly concept: KnowledgeConcept;
  readonly provider: ProviderConfig | null;
  readonly signal?: AbortSignal;
  /** 已存在的题，传了就跳过网络请求（缓存命中）。 */
  readonly cached?: readonly DirectionItem[];
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

/**
 * 批解校验（L4）。
 *
 * 只给题干与选项，不给答案与解析——给了就是让模型复述。
 * 两次独立调用，第二次反转选项顺序：模型若在猜，位置一换就会露馅。
 */
async function solveBatch(
  provider: ProviderConfig,
  items: readonly RawItem[],
  reverseOptions: boolean,
  signal?: AbortSignal,
): Promise<string[]> {
  const { text } = await callChat(provider, {
    system: "你是严格的考试阅卷人，只依据题干与选项作答。",
    user: buildSolverPrompt(items, reverseOptions),
    maxTokens: 1200,
    temperature: 0,
    jsonMode: true,
    timeoutMs: 45000,
    signal,
  });

  const parsed = extractJson(text) as { answers?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.answers)) return [];

  return parsed.answers.map((a) => {
    const o = a as { answerText?: unknown };
    return typeof o.answerText === "string" ? o.answerText : "";
  });
}

/**
 * 确保某 KC 有足够的题。
 *
 * 缓存命中（accepted ≥ ITEMS_PER_KC）时零调用直接返回。
 * 生成失败返回 error，由界面降级：跳过该 KC、只规划路径、或手动录题。
 */
export async function ensureItems(opts: EnsureItemsOptions): Promise<EnsureItemsResult> {
  const { directionId, concept, provider, cached } = opts;

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
    return { items: existing, generated: 0, error: null };
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
        };
      }
      const data = (await res.json()) as { items?: DirectionItem[] };
      const saved = data.items ?? [];
      return {
        items: [...existing, ...saved],
        generated: saved.length,
        error: null,
      };
    } catch (err) {
      return {
        items: existing,
        generated: 0,
        error: `借用题目落库失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const need = Math.max(1, threshold - acceptedNow);
  const seenStems = new Set(existing.map((i) => normalizeText(i.stem)));

  let raw: string;
  try {
    ({ text: raw } = await callChat(provider, {
      system: ITEM_SYSTEM_PROMPT,
      user: `知识点：${concept.name}
说明：${concept.summary}
所属章节：${concept.chapter}

请出 ${Math.max(need, 3)} 道题，覆盖三个难度档。`,
      maxTokens: 3500,
      temperature: 0.3,
      jsonMode: true,
      timeoutMs: 90000,
      signal: opts.signal,
    }));
  } catch (err) {
    return {
      items: existing,
      generated: 0,
      error: `生成失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 截断的 JSON 不硬 parse——宁可判失败重试一次
  let parsed = parseBatch(extractJson(raw));
  if (!parsed.ok) {
    try {
      const { text: retry } = await callChat(provider, {
        system: ITEM_SYSTEM_PROMPT,
        user: `知识点：${concept.name}
说明：${concept.summary}

上一次输出有结构问题：${parsed.reason}
请严格按 JSON schema 重新输出 ${Math.max(need, 3)} 道题，不要任何解释文字。`,
        maxTokens: 3500,
        temperature: 0.2,
        jsonMode: true,
        timeoutMs: 90000,
        signal: opts.signal,
      });
      parsed = parseBatch(extractJson(retry));
    } catch {
      /* 落到下面统一报错 */
    }
  }

  if (!parsed.ok) {
    return { items: existing, generated: 0, error: `模型输出无法解析：${parsed.reason}` };
  }

  const now = new Date().toISOString();
  const checked = checkBatch(parsed.batch, {
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
    raw: parsed.ok ? parsed.batch.items[i] : undefined,
    result,
  }));

  // L4 只对结构+答案都过的题做，失败也不阻塞——降级成 practice
  const solvable = pairs.filter((p) => p.result.item.status === "accepted");
  let l4Pass: boolean[] = solvable.map(() => false);
  let l4Error: string | null = null;

  if (solvable.length > 0) {
    const raws = solvable.map((p) => p.raw).filter((r): r is RawItem => r !== undefined);
    try {
      const [first, reversed] = await Promise.all([
        solveBatch(provider, raws, false, opts.signal),
        solveBatch(provider, raws, true, opts.signal),
      ]);
      l4Pass = compareSolverAnswers(
        raws.map((r) => r.answerText),
        first,
        reversed,
      );
    } catch (err) {
      l4Error = `双解校验未能完成：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  let solvableIndex = 0;
  const payload = pairs.map(({ raw, result }) => {
    const item = result.item;
    const passed = item.status === "accepted" && l4Pass[solvableIndex] === true;
    if (item.status === "accepted") solvableIndex += 1;

    const status = item.status === "rejected" ? "rejected" : passed ? "accepted" : "practice";
    const checks = passed ? [...item.checks, "双解校验"] : [...item.checks];

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
      return {
        items: existing,
        generated: 0,
        error: `题目落库失败：${data.error ?? `HTTP ${res.status}`}`,
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
     */
    const shortfall =
      totalAccepted < threshold
        ? `本次只生成 ${saved.length} 题、其中 ${totalAccepted} 题通过校验，未达到 ${threshold} 题门槛。可以重试、换模型，或手动补题。`
        : null;

    return {
      items: [...existing, ...saved],
      generated: saved.length,
      error: l4Error ?? shortfall,
    };
  } catch (err) {
    return {
      items: existing,
      generated: 0,
      error: `题目落库失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 为一个方向的所有 KC 生成题目。给「生成全部题目」按钮用。
 *
 * 串行而不是并行：多数供应商对并发有限制，而且串行能给稳定的进度数字。
 * onProgress 在每 KC 完成后调用，界面据此显示 x/y。
 */
export async function ensureAllItems(opts: {
  readonly directionId: string;
  readonly graph: KnowledgeGraph;
  readonly provider: ProviderConfig | null;
  readonly onProgress?: (done: number, total: number, kcName: string) => void;
  readonly signal?: AbortSignal;
}): Promise<{ generated: number; failed: { kcId: string; name: string; error: string }[] }> {
  const { directionId, graph, provider, onProgress } = opts;
  const all = await fetchItems(directionId, "");
  const byKc = new Map<string, DirectionItem[]>();
  for (const it of all) {
    const list = byKc.get(it.kcId) ?? [];
    list.push(it);
    byKc.set(it.kcId, list);
  }

  let generated = 0;
  const failed: { kcId: string; name: string; error: string }[] = [];

  for (let i = 0; i < graph.concepts.length; i += 1) {
    const concept = graph.concepts[i];
    if (opts.signal?.aborted) break;

    const r = await ensureItems({
      directionId,
      concept,
      provider,
      cached: byKc.get(concept.id) ?? [],
      signal: opts.signal,
    });
    generated += r.generated;
    if (r.error) failed.push({ kcId: concept.id, name: concept.name, error: r.error });
    onProgress?.(i + 1, graph.concepts.length, concept.name);
  }

  return { generated, failed };
}
