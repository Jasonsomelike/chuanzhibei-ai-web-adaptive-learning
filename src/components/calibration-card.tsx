"use client";

/**
 * 预测校准卡：把「作答前的预测」与「实际对错」放在一起看。
 *
 * 只展示一句话结论 + 折叠的计算口径。样本档位按产品可达性写死 30/60/100，
 * n<30 一律不下结论——单目标最多约 120/80 题，做不到 ECE/BSS 所需的几百题。
 * 口径见 docs/superpowers/specs/2026-10-28-next-features-design.md §6。
 */

import { useId, useMemo, useState } from "react";
import {
  CALIBRATION_LEVEL_MIN,
  calibrationDetail,
  calibrationHeadline,
  calibrationReport,
  type CalibrationAttempt,
  type CalibrationLevel,
  type CalibrationReport,
} from "@/lib/calibration";

/**
 * 永远可见的目标规模说明。
 *
 * 不能只放在折叠详情里：用户很容易把「校准」理解成精确到几个百分点，
 * 而单目标题量硬上限就决定了做不到 ±5pp。
 */
export const CALIBRATION_SCOPE_NOTE =
  "本目标最多约 120 题（内置学科）或 80 题（自定义方向），因此不承诺 ±5pp；n≥100 只在内置学科可达。";

const LEVEL_LABEL: Record<CalibrationLevel, string> = {
  none: "还没有样本",
  insufficient: "样本不足（n<30）",
  preliminary: "初步（n=30–59）",
  weak: "弱校准（n=60–99）",
  moderate: "较稳结论（n≥100）",
};

export function calibrationLevelLabel(level: CalibrationLevel): string {
  return LEVEL_LABEL[level];
}

/**
 * 未计入校准的记录提示。
 *
 * 旧存档没有 predicted，坏值（不在 (0,1)）也不参与统计；
 * 两者都要说清楚条数，否则用户会奇怪「我明明答了 40 题，为什么只有 12 条」。
 */
export function calibrationLegacyNote(report: CalibrationReport): string | null {
  const parts: string[] = [];
  if (report.legacy > 0) parts.push(`${report.legacy} 条旧记录没有预测值`);
  if (report.excluded > 0) parts.push(`${report.excluded} 条记录的预测值不在 (0,1) 内`);
  if (parts.length === 0) return null;
  return `另有 ${parts.join("、")}，未计入校准。`;
}

/**
 * 档位说明。n<30 只描述样本量，不下「准/不准」的结论，
 * 也不出现「可信 / 不可信」这类二元措辞。
 */
export function calibrationLevelNote(report: CalibrationReport): string {
  if (report.n < CALIBRATION_LEVEL_MIN.preliminary) {
    return `当前只有 ${report.n} 条可用于校准，不满 ${CALIBRATION_LEVEL_MIN.preliminary} 条时只看预测均值与实际命中率的差，不下结论。`;
  }
  const half =
    report.halfWidth === null ? null : Math.round(Math.abs(report.halfWidth) * 100);
  const precision =
    half === null ? "" : `95% 区间半宽约 ±${half} 个百分点，只能发现大于这个幅度的系统性偏差。`;
  if (report.n >= CALIBRATION_LEVEL_MIN.moderate) {
    return `样本达到本目标的上限档（n≥100），这是本目标能给出的较稳结论；仍不承诺 ±5pp。${precision}`;
  }
  if (report.n >= CALIBRATION_LEVEL_MIN.weak) {
    return `样本 60–99 条，属于弱校准。${precision}`;
  }
  return `样本 30–59 条，只能算初步观察。${precision}`;
}

export function CalibrationCard({
  attempts,
  className = "",
}: {
  /** 该目标的全部作答记录。没有 predicted 的旧记录会被单独计数。 */
  readonly attempts: readonly CalibrationAttempt[];
  readonly className?: string;
}) {
  const report = useMemo(() => calibrationReport(attempts), [attempts]);
  const legacyNote = calibrationLegacyNote(report);
  /** 卡片折叠状态：默认收起，标题与档位徽章始终可见，展开看口径与结论。 */
  const [collapsed, setCollapsed] = useState(true);
  const bodyId = useId();

  return (
    <section
      aria-label="预测校准与历史"
      className={`rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 ${className}`}
    >
      <h2 className="text-lg font-semibold tracking-tight">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(value => !value)}
          className="cursor-interaction flex items-center gap-1.5 rounded-md text-left"
        >
          预测校准与历史
          <span
            aria-hidden="true"
            className={`text-base leading-none text-[var(--ink-faint)] transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}
          >
            ▾
          </span>
        </button>
      </h2>
      <p className="mt-1.5 text-xs text-[var(--ink-soft)]">{calibrationLevelLabel(report.level)}</p>

      {!collapsed ? (
        <>
      <p className="mt-2 text-sm leading-relaxed">{calibrationHeadline(report)}</p>
      <p className="mt-1 text-xs text-[var(--ink-faint)]">{calibrationLevelNote(report)}</p>
      {legacyNote ? (
        <p className="mt-1 text-xs text-[var(--warn)]">{legacyNote}</p>
      ) : null}

      <details className="mt-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
        <summary className="cursor-pointer text-xs text-[var(--ink-soft)]">
          查看计算口径（O/E、Brier、分箱）
        </summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--ink-soft)]">
          {calibrationDetail(report)}
        </pre>
      </details>

      <p className="mt-2 text-xs text-[var(--ink-faint)]">{CALIBRATION_SCOPE_NOTE}</p>
        </>
      ) : null}
    </section>
  );
}
