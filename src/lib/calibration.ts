/**
 * 预测校准：把「作答前预测答对的概率」与「实际对错」放在一起看。
 *
 * 只做同一目标内的弱校准。单学科最多约 120 题（40 KC × 3 题），
 * 自定义方向最多约 80 题（20 KC × 4 题），到不了 ECE/BSS 需要的几百题，
 * 所以这里不输出 BSS/ECE/byFlow，也不把 5 个分箱明细当结论。
 * 设计与取舍见 docs/superpowers/specs/2026-10-28-next-features-design.md §6。
 */

/** 一条可用于校准的作答。旧存档没有 predicted，只能计入 legacy。 */
export interface CalibrationAttempt {
  /** 作答前的 predictCorrect(mean, difficulty)，取值 (0,1)。 */
  readonly predicted?: number;
  readonly correct: boolean;
  /** 是否计入掌握度；false 表示只练习（L4 双解未过 / L6 依据核对未过）。 */
  readonly counted?: boolean;
  /** 掌握度更新权重；0 表示不计证据。 */
  readonly weightScale?: number;
}

export interface CalibrationInterval {
  readonly low: number;
  readonly high: number;
}

/**
 * 样本档位由 n 决定，阈值按产品可达性定：
 * 30 是能看出十几个百分点偏差的下限，60 是弱校准，100 是内置学科的上限档。
 */
export type CalibrationLevel = "none" | "insufficient" | "preliminary" | "weak" | "moderate";

export type CalibrationVerdict = "unknown" | "underestimated" | "overestimated" | "consistent";

export interface CalibrationBin {
  /** 左闭右开；最后一个箱是 [0.8, 1]。 */
  readonly low: number;
  readonly high: number;
  readonly n: number;
  readonly meanQ: number | null;
  readonly hitRate: number | null;
  readonly ci: CalibrationInterval | null;
}

export interface CalibrationReport {
  /** 有效样本数（predicted 是有限数且 0 < q < 1）。 */
  readonly n: number;
  /** 其中答对的条数。 */
  readonly hits: number;
  /** 没有 predicted 的旧记录数，不参与统计。 */
  readonly legacy: number;
  /** 有 predicted 但不合法（非有限数或不在 (0,1)）的记录数，不参与统计。 */
  readonly excluded: number;
  readonly meanQ: number | null;
  readonly hitRate: number | null;
  /** hitRate 的 Wilson 95% 区间。n=0 时为 null。 */
  readonly ci: CalibrationInterval | null;
  readonly halfWidth: number | null;
  /** O/E = hitRate / meanQ。 */
  readonly oeRatio: number | null;
  readonly brier: number | null;
  /** 预测概率的总体标准差，用来看 q 是否被选题压窄。 */
  readonly qSd: number | null;
  readonly bins: readonly CalibrationBin[];
  readonly level: CalibrationLevel;
  readonly verdict: CalibrationVerdict;
}

export const WILSON_Z_95 = 1.959963984540054;

export const CALIBRATION_LEVEL_MIN = {
  preliminary: 30,
  weak: 60,
  moderate: 100,
} as const;

/** 箱内样本少于这个数时只展示、不下结论。 */
export const BIN_SMALL_N = 20;

const BIN_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1] as const;
const BIN_COUNT = 5;

/**
 * Wilson 得分区间，默认 95%。
 *
 * 不用正态近似：n=30、p=0.9 时正态区间会越过 1，Wilson 不会。
 * n<=0 返回 [0,1]——没有样本时不存在区间，调用方不得据此下结论。
 */
export function wilsonInterval(
  successes: number,
  n: number,
  z: number = WILSON_Z_95,
): CalibrationInterval {
  if (!Number.isFinite(n) || n <= 0) return { low: 0, high: 1 };

  const bounded = Number.isFinite(successes) ? Math.min(n, Math.max(0, successes)) : 0;
  const p = bounded / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;

  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

function levelFor(n: number): CalibrationLevel {
  if (n === 0) return "none";
  if (n < CALIBRATION_LEVEL_MIN.preliminary) return "insufficient";
  if (n < CALIBRATION_LEVEL_MIN.weak) return "preliminary";
  if (n < CALIBRATION_LEVEL_MIN.moderate) return "weak";
  return "moderate";
}

function verdictFor(
  n: number,
  ci: CalibrationInterval | null,
  meanQ: number | null,
): CalibrationVerdict {
  // n<30 一律 unknown：不显示「可信/不可信」。
  if (n < CALIBRATION_LEVEL_MIN.preliminary || ci === null || meanQ === null) return "unknown";
  if (ci.low > meanQ) return "underestimated";
  if (ci.high < meanQ) return "overestimated";
  return "consistent";
}

export function calibrationReport(attempts: readonly CalibrationAttempt[]): CalibrationReport {
  let legacy = 0;
  let excluded = 0;
  const sample: { q: number; y: number }[] = [];

  for (const attempt of attempts) {
    const raw: unknown = attempt.predicted;
    if (raw === undefined || raw === null) {
      legacy += 1;
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw >= 1) {
      excluded += 1;
      continue;
    }
    /*
     * 只练习、不计证据的作答不能进校准：这类题多来自 L4 双解不一致或 L6 依据核对未过，
     * 答案本身就未必对，拿去算命中率会把 O/E 与 Brier 拉偏——界面同时还在告诉用户
     * 这些题不计入掌握度。没有这两个字段的旧记录视为正常作答。
     */
    if (attempt.counted === false || attempt.weightScale === 0) {
      excluded += 1;
      continue;
    }
    sample.push({ q: raw, y: attempt.correct ? 1 : 0 });
  }

  const n = sample.length;
  const hits = sample.reduce((sum, row) => sum + row.y, 0);
  const meanQ = n > 0 ? sample.reduce((sum, row) => sum + row.q, 0) / n : null;
  const hitRate = n > 0 ? hits / n : null;
  const ci = n > 0 ? wilsonInterval(hits, n) : null;
  const halfWidth = ci === null ? null : (ci.high - ci.low) / 2;
  const oeRatio = meanQ === null || hitRate === null ? null : hitRate / meanQ;
  const brier =
    n > 0
      ? sample.reduce((sum, row) => sum + (row.q - row.y) ** 2, 0) / n
      : null;
  const qSd =
    n > 0 && meanQ !== null
      ? Math.sqrt(sample.reduce((sum, row) => sum + (row.q - meanQ) ** 2, 0) / n)
      : null;

  const bins: CalibrationBin[] = BIN_EDGES.slice(0, BIN_COUNT).map((low, index) => {
    const high = BIN_EDGES[index + 1];
    const rows = sample.filter((row) =>
      index === BIN_COUNT - 1
        ? row.q >= low && row.q <= high
        : row.q >= low && row.q < high,
    );
    const binN = rows.length;
    const binHits = rows.reduce((sum, row) => sum + row.y, 0);
    return {
      low,
      high,
      n: binN,
      meanQ: binN > 0 ? rows.reduce((sum, row) => sum + row.q, 0) / binN : null,
      hitRate: binN > 0 ? binHits / binN : null,
      ci: binN > 0 ? wilsonInterval(binHits, binN) : null,
    };
  });

  return {
    n,
    hits,
    legacy,
    excluded,
    meanQ,
    hitRate,
    ci,
    halfWidth,
    oeRatio,
    brier,
    qSd,
    bins,
    level: levelFor(n),
    verdict: verdictFor(n, ci, meanQ),
  };
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 比例差换算成整数百分点，避免把 0.163 写成 0.16 个百分点。 */
function points(value: number): number {
  return Math.round(Math.abs(value) * 100);
}

/**
 * 一句话结论。n<30 只说样本不足，不出现「可信/不可信」；
 * 30/60/100 三档分别用「初步」「弱校准」「较稳结论」的措辞。
 */
export function calibrationHeadline(report: CalibrationReport): string {
  const legacyNote =
    report.legacy > 0 ? `另有 ${report.legacy} 条旧记录没有预测值，未计入。` : "";

  if (report.n === 0) {
    return `还没有可用于校准的作答记录。下一题的预测来自图谱深度先验，不代表你的水平。${legacyNote}`;
  }

  const { meanQ, hitRate, ci, halfWidth } = report;
  if (meanQ === null || hitRate === null || ci === null || halfWidth === null) {
    return `可用于校准的作答只有 ${report.n} 题，样本不足，暂时看不出预测准不准。${legacyNote}`;
  }

  if (report.n < CALIBRATION_LEVEL_MIN.preliminary) {
    return `可用于校准的作答只有 ${report.n} 题，样本不足，暂时看不出预测准不准。${legacyNote}`;
  }

  const half = points(halfWidth);
  const diff = points(hitRate - meanQ);
  const base = `系统预测平均 ${percent(meanQ)}，你实际答对 ${report.hits}/${report.n}（${percent(hitRate)}），95% 区间 ${percent(ci.low)}–${percent(ci.high)}`;

  if (report.n >= CALIBRATION_LEVEL_MIN.moderate) {
    const conclusion =
      report.verdict === "overestimated"
        ? "存在系统性高估：实际命中低于预测均值"
        : report.verdict === "underestimated"
          ? "存在系统性低估：实际命中高于预测均值"
          : "未发现系统性偏差";
    return `${base}，相差 ${diff} 个百分点（±${half}）。${conclusion}。${legacyNote}`;
  }

  const prefix = report.n >= CALIBRATION_LEVEL_MIN.weak ? "弱校准：" : "初步：";
  const detection = `当前样本只能发现约 ${half} 个百分点的系统性偏差。`;

  if (report.verdict === "overestimated") {
    return `${prefix}${base}，存在系统性高估（实际命中低于预测均值）。${detection}${legacyNote}`;
  }
  if (report.verdict === "underestimated") {
    return `${prefix}${base}，存在系统性低估（实际命中高于预测均值）。${detection}${legacyNote}`;
  }
  return `${prefix}${base}，与预测均值相差 ${diff} 个百分点（±${half}），还不能确认有偏差。${detection}${legacyNote}`;
}

/**
 * 「查看计算口径」的明细。每行一条，用 \n 分隔。
 *
 * 末尾两行是产品口径的一部分：单目标最多约 120/80 题，不承诺 ±5pp；
 * n>=100 只在内置学科可达。不要把这两行删成「更简洁」的版本。
 */
export function calibrationDetail(report: CalibrationReport): string {
  const lines: string[] = [];
  const { meanQ, hitRate, ci, halfWidth, oeRatio, brier, qSd } = report;

  if (
    report.n === 0 ||
    meanQ === null ||
    hitRate === null ||
    ci === null ||
    halfWidth === null ||
    oeRatio === null ||
    brier === null ||
    qSd === null
  ) {
    lines.push("还没有有效样本：至少需要一条带预测值的作答记录。");
  } else {
    // n<30 的 O/E、Brier 只是算出来的数，不能当结论读；提示必须紧挨在这两行之前。
    if (report.n < CALIBRATION_LEVEL_MIN.preliminary) {
      lines.push(
        `n=${report.n}<${CALIBRATION_LEVEL_MIN.preliminary}，样本少，不作解读；以下仅为计算口径`,
      );
    }
    lines.push(
      `O/E = ${oeRatio.toFixed(2)}；Brier = ${brier.toFixed(3)}（仅同目标内参考，不跨目标比较）`,
    );
    lines.push(
      `预测均值 ${percent(meanQ)}；实际命中 ${report.hits}/${report.n}（${percent(hitRate)}）；95% Wilson 区间 ${percent(ci.low)}–${percent(ci.high)}；半宽 ±${points(halfWidth)} 个百分点；预测概率标准差 ${qSd.toFixed(3)}`,
    );
  }

  lines.push(`分箱（只用于核对计算口径，不作为结论；箱内 n<${BIN_SMALL_N} 时仅供参考）：`);
  for (const bin of report.bins) {
    const range = `[${bin.low.toFixed(1)}, ${bin.high.toFixed(1)}${bin.high === 1 ? "]" : ")"}`;
    if (bin.n === 0 || bin.meanQ === null || bin.hitRate === null || bin.ci === null) {
      lines.push(`  ${range}：n=${bin.n}，无样本`);
      continue;
    }
    const small = bin.n < BIN_SMALL_N ? "（样本少，仅供参考）" : "";
    lines.push(
      `  ${range}：n=${bin.n}，预测均值 ${percent(bin.meanQ)}，实际命中 ${percent(bin.hitRate)}，95% 区间 ${percent(bin.ci.low)}–${percent(bin.ci.high)}${small}`,
    );
  }

  lines.push("掌握度的 ± 是 Beta 后验不确定度，不是下一题的预测误差。");
  lines.push(
    "本目标最多约 120 题（内置学科）或 80 题（自定义方向），因此不承诺 ±5pp；n≥100 只在内置学科可达。",
  );
  if (report.legacy > 0) {
    lines.push(`另有 ${report.legacy} 条旧记录没有预测值，未计入。`);
  }
  if (report.excluded > 0) {
    lines.push(`另有 ${report.excluded} 条记录的预测值不在 (0,1) 内，未计入。`);
  }

  return lines.join("\n");
}
