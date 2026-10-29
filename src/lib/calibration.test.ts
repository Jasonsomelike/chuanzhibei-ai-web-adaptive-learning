import { describe, it, expect } from "vitest";
import {
  BIN_SMALL_N,
  CALIBRATION_LEVEL_MIN,
  WILSON_Z_95,
  calibrationDetail,
  calibrationHeadline,
  calibrationReport,
  wilsonInterval,
  type CalibrationAttempt,
  type CalibrationLevel,
} from "@/lib/calibration";

function fixedAttempts(n: number, correct: number, predicted: number): CalibrationAttempt[] {
  return Array.from({ length: n }, (_, index) => ({
    predicted,
    correct: index < correct,
  }));
}

describe("wilsonInterval", () => {
  it("10/20 的 95% 区间与公开数值一致", () => {
    const ci = wilsonInterval(10, 20);
    expect(ci.low).toBeCloseTo(0.2992980081982123, 10);
    expect(ci.high).toBeCloseTo(0.7007019918017877, 10);
  });

  it("0/10 的上限约 0.2775，下限为 0", () => {
    const ci = wilsonInterval(0, 10);
    expect(ci.low).toBe(0);
    expect(ci.high).toBeCloseTo(0.2775327998628892, 10);
  });

  it("n=0 返回 [0,1]，避免把「没有样本」误读成 0%", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("默认 z 是 95% 对应的 1.959963984540054", () => {
    expect(WILSON_Z_95).toBe(1.959963984540054);
  });

  it("越界的 successes 会被夹到 [0,n]", () => {
    expect(wilsonInterval(20, 10)).toEqual(wilsonInterval(10, 10));
    expect(wilsonInterval(-3, 10)).toEqual(wilsonInterval(0, 10));
  });
});

describe("calibrationReport：样本档位", () => {
  it("n=0：统计量为 null，level=none，verdict=unknown", () => {
    const report = calibrationReport([]);
    expect(report.n).toBe(0);
    expect(report.hits).toBe(0);
    expect(report.legacy).toBe(0);
    expect(report.excluded).toBe(0);
    expect(report.meanQ).toBeNull();
    expect(report.hitRate).toBeNull();
    expect(report.ci).toBeNull();
    expect(report.halfWidth).toBeNull();
    expect(report.oeRatio).toBeNull();
    expect(report.brier).toBeNull();
    expect(report.qSd).toBeNull();
    expect(report.bins).toHaveLength(5);
    expect(report.bins.every((bin) => bin.n === 0 && bin.meanQ === null)).toBe(true);
    expect(report.level).toBe("none");
    expect(report.verdict).toBe("unknown");
    expect(calibrationHeadline(report)).toBe(
      "还没有可用于校准的作答记录。下一题的预测来自图谱深度先验，不代表你的水平。",
    );
    expect(calibrationDetail(report)).toContain("还没有有效样本");
  });

  it("n=12：insufficient，headline 只谈样本不足", () => {
    const report = calibrationReport(fixedAttempts(12, 8, 0.6));
    expect(report.n).toBe(12);
    expect(report.hits).toBe(8);
    expect(report.hitRate).toBeCloseTo(8 / 12, 12);
    expect(report.level).toBe("insufficient");
    expect(report.verdict).toBe("unknown");

    const headline = calibrationHeadline(report);
    expect(headline).toContain("只有 12 题");
    expect(headline).toContain("样本不足");
    expect(headline).not.toContain("可信");
    expect(headline).not.toContain("不可信");
  });

  it("n=30：preliminary，一致的样本只说「初步」「还不能确认有偏差」", () => {
    const report = calibrationReport(fixedAttempts(30, 19, 0.64));
    expect(report.level).toBe("preliminary");
    expect(report.verdict).toBe("consistent");
    expect(report.ci?.low).toBeCloseTo(0.4551356365479487, 10);
    expect(report.ci?.high).toBeCloseTo(0.7812607919389929, 10);
    expect(report.halfWidth).toBeCloseTo(0.1630625776955221, 10);

    const headline = calibrationHeadline(report);
    expect(headline.startsWith("初步：")).toBe(true);
    expect(headline).toContain("19/30（63%）");
    expect(headline).toContain("还不能确认有偏差");
    expect(headline).toContain("当前样本只能发现约 16 个百分点的系统性偏差");
  });

  it("n=60：weak，headline 用「弱校准」口径", () => {
    const report = calibrationReport(fixedAttempts(60, 38, 0.65));
    expect(report.level).toBe("weak");
    expect(report.verdict).toBe("consistent");
    expect(report.ci?.low).toBeCloseTo(0.5068300063010303, 10);
    expect(report.ci?.high).toBeCloseTo(0.7437908331277456, 10);

    const headline = calibrationHeadline(report);
    expect(headline.startsWith("弱校准：")).toBe(true);
    expect(headline).toContain("38/60（63%）");
    expect(headline).toContain("当前样本只能发现约 12 个百分点的系统性偏差");
  });

  it("档位边界：29 insufficient、30/59 preliminary、60/99 weak、100 moderate", () => {
    const levelAt = (n: number): CalibrationLevel =>
      calibrationReport(fixedAttempts(n, Math.round(n * 0.6), 0.6)).level;

    expect(levelAt(1)).toBe("insufficient");
    expect(levelAt(29)).toBe("insufficient");
    expect(levelAt(30)).toBe("preliminary");
    expect(levelAt(59)).toBe("preliminary");
    expect(levelAt(60)).toBe("weak");
    expect(levelAt(99)).toBe("weak");
    expect(levelAt(100)).toBe("moderate");
    expect(CALIBRATION_LEVEL_MIN).toEqual({ preliminary: 30, weak: 60, moderate: 100 });
  });
});

describe("calibrationReport：n=100（模拟数据，非真实作答）", () => {
  /**
   * 这 100 条是按分箱边界构造的模拟数据：5 个箱各 20 条、各答对 13 条。
   * 只用来说明公式与文案口径，不代表任何真实学生的表现。
   */
  const simulated: CalibrationAttempt[] = [];
  for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    for (let index = 0; index < 20; index += 1) {
      simulated.push({ predicted: q, correct: index < 13 });
    }
  }

  it("n=100（模拟数据）：O/E、Brier、qSd 与手算一致，5 个箱各 20 条", () => {
    const report = calibrationReport(simulated);

    expect(report.n).toBe(100);
    expect(report.hits).toBe(65);
    expect(report.meanQ).toBeCloseTo(0.5, 12);
    expect(report.hitRate).toBeCloseTo(0.65, 12);
    expect(report.oeRatio).toBeCloseTo(1.3, 12);
    expect(report.brier).toBeCloseTo(0.33, 12);
    expect(report.qSd).toBeCloseTo(Math.sqrt(0.08), 12);
    expect(report.ci?.low).toBeCloseTo(0.5525444329688796, 10);
    expect(report.ci?.high).toBeCloseTo(0.7363575175690247, 10);
    expect(report.level).toBe("moderate");
    expect(report.verdict).toBe("underestimated");

    expect(report.bins.map((bin) => bin.n)).toEqual([20, 20, 20, 20, 20]);
    const expectedMeanQ = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const [index, bin] of report.bins.entries()) {
      expect(bin.meanQ).toBeCloseTo(expectedMeanQ[index], 12);
      expect(bin.hitRate).toBeCloseTo(0.65, 12);
      expect(bin.ci?.low).toBeCloseTo(0.43285427668523624, 10);
      expect(bin.ci?.high).toBeCloseTo(0.818808175898918, 10);
    }

    const headline = calibrationHeadline(report);
    expect(headline).toContain("65/100（65%）");
    expect(headline).toContain("相差 15 个百分点（±9）");
    expect(headline).toContain("存在系统性低估");
    expect(headline).not.toContain("±5pp");
    expect(headline).not.toContain("320");
  });

  it("n=100（模拟数据）：预测均值与实际命中接近时判 consistent", () => {
    const report = calibrationReport(fixedAttempts(100, 63, 0.64));
    expect(report.level).toBe("moderate");
    expect(report.verdict).toBe("consistent");

    const headline = calibrationHeadline(report);
    expect(headline).toContain("相差 1 个百分点（±9）");
    expect(headline).toContain("未发现系统性偏差");
  });

  it("分箱内 n=20 不标「样本少」，n<20 才标", () => {
    const report = calibrationReport(simulated);
    const binLines = calibrationDetail(report)
      .split("\n")
      .filter((line) => line.trim().startsWith("["));

    expect(binLines).toHaveLength(5);
    expect(binLines.every((line) => !line.includes("样本少"))).toBe(true);

    const sparse = calibrationReport(fixedAttempts(5, 3, 0.65));
    const sparseLines = calibrationDetail(sparse)
      .split("\n")
      .filter((line) => line.trim().startsWith("["));
    expect(sparseLines.some((line) => line.includes("样本少，仅供参考"))).toBe(true);
    expect(BIN_SMALL_N).toBe(20);
  });
});

describe("calibrationReport：高估 / 低估 / 一致", () => {
  it("系统高估：预测 90%，实际只对一半", () => {
    const report = calibrationReport(fixedAttempts(30, 15, 0.9));
    expect(report.verdict).toBe("overestimated");
    expect(calibrationHeadline(report)).toContain("存在系统性高估");
  });

  it("系统低估：预测 30%，实际对八成", () => {
    const report = calibrationReport(fixedAttempts(30, 24, 0.3));
    expect(report.verdict).toBe("underestimated");
    expect(calibrationHeadline(report)).toContain("存在系统性低估");
  });

  it("区间覆盖预测均值时判 consistent", () => {
    const report = calibrationReport(fixedAttempts(60, 38, 0.65));
    expect(report.verdict).toBe("consistent");
    expect(calibrationHeadline(report)).toContain("还不能确认有偏差");
  });

  it("n<30 即使严重偏离也不下结论", () => {
    const report = calibrationReport(fixedAttempts(29, 2, 0.9));
    expect(report.n).toBe(29);
    expect(report.verdict).toBe("unknown");
    const headline = calibrationHeadline(report);
    expect(headline).not.toContain("高估");
    expect(headline).not.toContain("低估");
  });
});

describe("calibrationReport：旧记录与坏值", () => {
  it("没有 predicted 的旧记录计入 legacy，不参与统计", () => {
    const report = calibrationReport([
      { correct: true },
      { predicted: null as unknown as number, correct: false },
      { predicted: 0.6, correct: true },
      { predicted: 0.6, correct: false },
    ]);

    expect(report.n).toBe(2);
    expect(report.legacy).toBe(2);
    expect(report.excluded).toBe(0);
    expect(report.hitRate).toBe(0.5);
    expect(calibrationHeadline(report)).toContain("另有 2 条旧记录没有预测值，未计入");
    expect(calibrationDetail(report)).toContain("另有 2 条旧记录没有预测值，未计入");
  });

  it("predicted 非有限或不在 (0,1) 内时排除并计数", () => {
    const report = calibrationReport([
      { predicted: Number.NaN, correct: true },
      { predicted: Number.POSITIVE_INFINITY, correct: true },
      { predicted: 0, correct: true },
      { predicted: 1, correct: true },
      { predicted: -0.2, correct: true },
      { predicted: 1.2, correct: true },
      { predicted: 0.5, correct: true },
    ]);

    expect(report.n).toBe(1);
    expect(report.legacy).toBe(0);
    expect(report.excluded).toBe(6);
    expect(calibrationDetail(report)).toContain("另有 6 条记录的预测值不在 (0,1) 内，未计入");
  });

  it("是纯函数：不修改入参数组与元素", () => {
    const attempts = fixedAttempts(30, 19, 0.64).map((attempt) => Object.freeze({ ...attempt }));
    const snapshot = JSON.stringify(attempts);
    calibrationReport(Object.freeze(attempts));
    expect(JSON.stringify(attempts)).toBe(snapshot);
  });
});

describe("calibrationReport：分箱边界", () => {
  it("边界值归入右侧箱：0.2→[0.2,0.4)，0.8→[0.8,1]", () => {
    const report = calibrationReport([
      { predicted: 0.2, correct: true },
      { predicted: 0.4, correct: false },
      { predicted: 0.6, correct: true },
      { predicted: 0.8, correct: false },
      { predicted: 0.95, correct: true },
    ]);

    expect(report.bins.map((bin) => bin.n)).toEqual([0, 1, 1, 1, 2]);
    expect(report.bins[0].low).toBe(0);
    expect(report.bins[0].high).toBe(0.2);
    expect(report.bins[4].low).toBe(0.8);
    expect(report.bins[4].high).toBe(1);
    expect(report.bins[1].meanQ).toBeCloseTo(0.2, 12);
    expect(report.bins[4].meanQ).toBeCloseTo(0.875, 12);
    expect(report.bins[4].hitRate).toBeCloseTo(0.5, 12);
  });
});

describe("报告字段口径", () => {
  it("不含 bss/ece/byFlow —— 本轮明确不实现", () => {
    const report = calibrationReport(fixedAttempts(100, 63, 0.64));

    expect("bss" in report).toBe(false);
    expect("ece" in report).toBe(false);
    expect("byFlow" in report).toBe(false);
    expect(Object.keys(report).sort()).toEqual([
      "bins",
      "brier",
      "ci",
      "excluded",
      "halfWidth",
      "hitRate",
      "hits",
      "legacy",
      "level",
      "meanQ",
      "n",
      "oeRatio",
      "qSd",
      "verdict",
    ]);
  });

  it("明细写明单目标上限，不承诺 ±5pp / n≥320", () => {
    const detail = calibrationDetail(calibrationReport(fixedAttempts(60, 38, 0.65)));

    expect(detail).toContain("最多约 120 题（内置学科）或 80 题（自定义方向）");
    expect(detail).toContain("不承诺 ±5pp");
    expect(detail).not.toContain("320");
    expect(detail).not.toMatch(/±5pp\s*(以内|内)/);
    expect(detail).not.toMatch(/精确到\s*±5pp/);
    // ±5pp 只允许出现在「不承诺」这句里，不能变成承诺
    expect(detail.match(/±5pp/g)).toHaveLength(1);
    expect(detail).toContain("仅同目标内参考");
    expect(detail).toContain("Beta 后验不确定度");
  });

  it("任何档位的 headline 都不出现 ±5pp / 320", () => {
    for (const n of [0, 12, 30, 60, 100]) {
      const headline = calibrationHeadline(
        calibrationReport(fixedAttempts(n, Math.round(n * 0.63), 0.62)),
      );
      expect(headline).not.toContain("±5pp");
      expect(headline).not.toContain("320");
    }
  });

  it("n<30 的 headline 一律不含「可信/不可信」", () => {
    for (const n of [0, 1, 12, 29]) {
      const headline = calibrationHeadline(
        calibrationReport(fixedAttempts(n, Math.floor(n / 2), 0.6)),
      );
      expect(headline).not.toContain("可信");
      expect(headline).not.toContain("不可信");
    }
  });
});


describe("calibrationDetail：小样本提示", () => {
  function detailLines(n: number): string[] {
    return calibrationDetail(
      calibrationReport(fixedAttempts(n, Math.ceil(n / 2), 0.6)),
    ).split("\n");
  }

  it("n=5 与 n=12 在 O/E 与 Brier 行之前写明样本少、不作解读", () => {
    for (const n of [5, 12]) {
      const lines = detailLines(n);
      const notice = `n=${n}<30，样本少，不作解读；以下仅为计算口径`;
      const noticeIndex = lines.indexOf(notice);
      const summaryIndex = lines.findIndex(
        (line) => line.includes("O/E =") && line.includes("Brier ="),
      );

      expect(noticeIndex).toBeGreaterThanOrEqual(0);
      expect(summaryIndex).toBeGreaterThan(noticeIndex);
    }
  });

  it("n=40 已达 preliminary，不加「不作解读」", () => {
    const detail = calibrationDetail(calibrationReport(fixedAttempts(40, 25, 0.62)));
    expect(detail).not.toContain("不作解读");
  });

  it("n=0 分支不变，也不加小样本提示", () => {
    const detail = calibrationDetail(calibrationReport([]));
    expect(detail).toContain("还没有有效样本");
    expect(detail).not.toContain("不作解读");
  });
});

describe("仅练习的作答不进校准（回归）", () => {
  it("counted=false 或 weightScale=0 的样本被排除，不影响 O/E 与 Brier", () => {
    const report = calibrationReport([
      { predicted: 0.6, correct: true, counted: false, weightScale: 0 },
      { predicted: 0.6, correct: false, counted: true, weightScale: 1 },
    ]);
    expect(report.n).toBe(1);
    expect(report.excluded).toBe(1);
    expect(report.hitRate).toBe(0);
    // 单条 q=0.6、答错：(0.6-0)^2
    expect(report.brier).toBeCloseTo(0.36, 6);
  });

  it("没有 counted/weightScale 的旧记录仍按正常作答统计", () => {
    const report = calibrationReport([{ predicted: 0.5, correct: true }]);
    expect(report.n).toBe(1);
    expect(report.excluded).toBe(0);
  });
});
