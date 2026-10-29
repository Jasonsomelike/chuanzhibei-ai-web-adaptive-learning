"use client";

/**
 * 只读核对者的浏览器端调用层。
 *
 * verify.ts 只做纯判定（引用逐字校验、按题号落位、状态映射），
 * 本文件负责唯一需要网络的一步：用 callChat 发一次核对请求，再把原始输出交回纯函数。
 *
 * 为什么核对与出题 / 导师问答分开调用而不是顺手复用同一次请求：
 * 核对者必须看不到生成者的答案与解析，否则只是在复述。
 *
 * 失败一律 fail-open：网络 / 超时 / JSON 不可解析都返回「未能核对」，
 * 由调用方保留原状态。绝不能把「核对器没跑完」当成「题目或回答是错的」。
 */

import { callChat } from "@/lib/chat";
import { extractJson } from "@/lib/direction";
import type { ProviderConfig } from "@/lib/provider";
import {
  buildClaimVerifyPrompt,
  buildItemEvidencePrompt,
  parseClaimVerdicts,
  parseItemEvidenceBatch,
  type Claim,
  type ClaimVerdict,
  type EvidenceItem,
  type ItemEvidenceResult,
} from "@/lib/verify";

/** 导师引用核对：一次回答最多 5 条 claim，600 token 足够。 */
export const CLAIM_VERIFY_MAX_TOKENS = 600;
export const CLAIM_VERIFY_TIMEOUT_MS = 30000;

/** 出题整批核对：3–4 题共用一次调用，预算比导师侧宽。 */
export const ITEM_EVIDENCE_MAX_TOKENS = 1200;
export const ITEM_EVIDENCE_TIMEOUT_MS = 45000;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 出题侧 L6：一次核对一整批题（每 KC 只调一次）。
 *
 * 没有可核对原文时不发请求，返回整批 skipped——调用方据此不追加任何检查项。
 * 网络 / 解析失败时 results 全是 unverified，error 带上原因；
 * applyItemEvidence 会把 unverified 映射成「依据核对：未完成」且不改状态。
 */
export interface ItemEvidenceBatchResult {
  readonly results: readonly ItemEvidenceResult[];
  /** 网络 / 超时 / 取消除外的失败原因；完成时为 null。 */
  readonly error: string | null;
}

export async function verifyItemEvidence(
  provider: ProviderConfig,
  items: readonly EvidenceItem[],
  promptContext: string,
  signal?: AbortSignal,
): Promise<ItemEvidenceBatchResult> {
  if (items.length === 0) return { results: [], error: null };

  const prompt = buildItemEvidencePrompt(items, promptContext);
  if (prompt === "") {
    // 没有原文：整批 skipped，不调用模型
    return { results: parseItemEvidenceBatch(null, items, ""), error: null };
  }

  try {
    const { text } = await callChat(provider, {
      system: "你是只读的教材依据核对者，只依据给定原文逐字核对，不修改题目。",
      user: prompt,
      maxTokens: ITEM_EVIDENCE_MAX_TOKENS,
      temperature: 0,
      jsonMode: true,
      timeoutMs: ITEM_EVIDENCE_TIMEOUT_MS,
      signal,
    });
    return {
      results: parseItemEvidenceBatch(extractJson(text), items, promptContext),
      error: null,
    };
  } catch (err) {
    /*
     * 失败不是「题目错」的证据：返回 unverified，让调用方保留 accepted，
     * 只在 checks 里记一条「依据核对：未完成」。
     */
    return {
      results: parseItemEvidenceBatch(null, items, promptContext),
      error: errorText(err),
    };
  }
}

/**
 * 导师侧引用核对。
 *
 * promptContext 必须是**本次实际注入模型的完整上下文**（多片段），
 * 不是 excerptFor 的每 KC 第一条摘录：模型引用第二、三条片段时，
 * 拿窄范围做 substring 校验会把它误判成 not_found。
 *
 * 没有引用或没有原文时返回空数组（不调用模型）；
 * 调用失败时每条 claim 都返回 unable，界面显示「核对未完成」，回答内容不变。
 */
export async function verifyTutorClaims(
  provider: ProviderConfig,
  claims: readonly Claim[],
  promptContext: string,
  signal?: AbortSignal,
): Promise<ClaimVerdict[]> {
  const prompt = buildClaimVerifyPrompt(claims, promptContext);
  if (prompt === "") return [];

  try {
    const { text } = await callChat(provider, {
      system: "你是只读的引用核对者，只依据给定原文逐字核对，不修改回答。",
      user: prompt,
      maxTokens: CLAIM_VERIFY_MAX_TOKENS,
      temperature: 0,
      jsonMode: true,
      timeoutMs: CLAIM_VERIFY_TIMEOUT_MS,
      signal,
    });
    return parseClaimVerdicts(extractJson(text), claims, promptContext);
  } catch (err) {
    const reason = `核对未完成：${errorText(err)}`;
    return claims.map((claim) => ({
      id: claim.id,
      verdict: "unable" as const,
      quote: "",
      reason,
    }));
  }
}
