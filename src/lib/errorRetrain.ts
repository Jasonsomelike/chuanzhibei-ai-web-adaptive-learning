/**
 * 错题统计与重训队列的数据口径（纯函数，可在 Node 里直接测）。
 *
 * 数据源只有 attempts（作答记录），不读存储、不取时钟。
 * 口径与掌握度一致：`counted !== false` 才算证据，仅练习题不计入。
 *
 * 重训队列的入选规则：一道题**最近一次**作答是「计入证据的答错」才入选。
 * 答错后又答对（含重训答对）的题会自动退出队列——记忆卡此时也已毕业，
 * 再练一次只是刷熟练度，不是补漏洞。
 */

import type { AttemptRecord } from "@/lib/learner";

/** 一个知识点的错题汇总。 */
export interface ErrorKcSummary {
  readonly kcId: string;
  /** 计入证据的答错次数。 */
  readonly wrongCount: number;
  /** 该知识点计入证据的总作答数。 */
  readonly totalCount: number;
  /** 从最近往回数、连续计入证据的答错次数（被一次答对截断）。 */
  readonly recentWrongStreak: number;
  /** 最近一次答错的 ISO 时间；从未答错为 null。 */
  readonly lastWrongAt: string | null;
}

function isCounted(attempt: AttemptRecord): boolean {
  return attempt.counted !== false;
}

/**
 * 重训队列的题 id，按首次答错的先后排列（去重、确定性）。
 * 只有「最近一次作答为计入证据的答错」的题入选。
 */
export function lastWrongQuestionIds(
  attempts: readonly AttemptRecord[],
): readonly string[] {
  const lastByQuestion = new Map<string, AttemptRecord>();
  for (const attempt of attempts) {
    // attempts 是追加序，后写覆盖即「最近一次」
    lastByQuestion.set(attempt.questionId, attempt);
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (seen.has(attempt.questionId)) continue;
    const last = lastByQuestion.get(attempt.questionId);
    if (last === undefined || !isCounted(last) || last.correct) continue;
    seen.add(attempt.questionId);
    ids.push(attempt.questionId);
  }
  return ids;
}

/** 按知识点汇总错题；无错题的知识点不出现。排序：错得多的在前，同数按 kcId 稳定排序。 */
export function summarizeErrorsByKc(
  attempts: readonly AttemptRecord[],
): readonly ErrorKcSummary[] {
  interface Accumulator {
    wrongCount: number;
    totalCount: number;
    trailingWrong: number;
    lastWrongAt: string | null;
  }
  const byKc = new Map<string, Accumulator>();

  for (const attempt of attempts) {
    if (!isCounted(attempt)) continue;
    let acc = byKc.get(attempt.kcId);
    if (!acc) {
      acc = { wrongCount: 0, totalCount: 0, trailingWrong: 0, lastWrongAt: null };
      byKc.set(attempt.kcId, acc);
    }
    acc.totalCount += 1;
    if (attempt.correct) {
      acc.trailingWrong = 0;
    } else {
      acc.wrongCount += 1;
      acc.trailingWrong += 1;
      acc.lastWrongAt = attempt.at;
    }
  }

  return [...byKc.entries()]
    .filter(([, acc]) => acc.wrongCount > 0)
    .map(([kcId, acc]) => ({
      kcId,
      wrongCount: acc.wrongCount,
      totalCount: acc.totalCount,
      recentWrongStreak: acc.trailingWrong,
      lastWrongAt: acc.lastWrongAt,
    }))
    .sort((a, b) => {
      if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
      if (a.recentWrongStreak !== b.recentWrongStreak) {
        return b.recentWrongStreak - a.recentWrongStreak;
      }
      return a.kcId < b.kcId ? -1 : a.kcId > b.kcId ? 1 : 0;
    });
}
