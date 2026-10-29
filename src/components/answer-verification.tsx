"use client";

import { Pill } from "@/components/ui";
import type { Claim, ClaimVerdict } from "@/lib/verify";
import { summarizeClaimVerdicts } from "@/lib/verify";
import {
  verdictLabel,
  verdictTone,
  verificationFailureReason,
} from "@/components/tutor-logic";

/**
 * 导师回答的引用核对结果。
 *
 * 只展示核对者给出的逐字依据，不改写回答；核对失败一律 fail-open——
 * 「核对器没跑完」不是「回答错了」的证据，文案必须把这两件事分开。
 */
export function AnswerVerification({
  claims,
  verdicts,
  checking,
  error,
  skippedReason,
}: {
  readonly claims: readonly Claim[];
  readonly verdicts: readonly ClaimVerdict[] | null;
  readonly checking: boolean;
  /** 整次核对调用失败的原因（正常情况下 verifyTutorClaims 不会抛，这里是兜底）。 */
  readonly error: string | null;
  /** 没有发起核对的原因：开关关闭、没有注入原文等。 */
  readonly skippedReason: string | null;
}) {
  if (claims.length === 0) return null;

  const summary = verdicts !== null ? summarizeClaimVerdicts(verdicts) : null;
  const failure = verdicts !== null ? verificationFailureReason(verdicts) : null;
  const byId = new Map((verdicts ?? []).map((verdict) => [verdict.id, verdict] as const));

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--line)]/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-[var(--ink-soft)]">引用核对</p>
        {checking ? <Pill tone="neutral">核对中…</Pill> : null}
        {summary !== null ? (
          <Pill tone={summary.supported > 0 ? "accent" : "neutral"}>{summary.text}</Pill>
        ) : null}
      </div>

      {checking ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
          正在用本次注入的原文逐字核对引用（会多一次模型调用）…
        </p>
      ) : null}

      {!checking && error !== null ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--warn)]">
          核对未完成（{error}）；回答内容未改动。这不是回答错误的证据。
        </p>
      ) : null}

      {!checking && error === null && verdicts === null && skippedReason !== null ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">{skippedReason}</p>
      ) : null}

      {failure !== null ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--warn)]">
          {failure}；回答内容未改动。这不是回答错误的证据。
        </p>
      ) : null}

      {verdicts !== null && verdicts.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {claims.map((claim) => {
            const verdict = byId.get(claim.id);
            if (verdict === undefined) return null;
            return (
              <li key={claim.id} className="text-xs leading-relaxed">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={verdictTone(verdict.verdict)}>
                    {verdictLabel(verdict.verdict)}
                  </Pill>
                  <span className="text-[var(--ink-soft)]">{claim.text}</span>
                </div>
                {verdict.verdict === "supported" && verdict.quote !== "" ? (
                  <p className="mt-0.5 text-[var(--ink-faint)]">原文：「{verdict.quote}」</p>
                ) : null}
                {verdict.reason !== null && verdict.reason !== "" ? (
                  <p className="mt-0.5 text-[var(--ink-faint)]">{verdict.reason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
        核对只做逐字 substring：同义改写、知识点摘要与网络结果都不算依据。
      </p>
    </div>
  );
}
