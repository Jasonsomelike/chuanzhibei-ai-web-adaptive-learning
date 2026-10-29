import { describe, it, expect } from "vitest";
import {
  CALIBRATION_SCOPE_NOTE,
  calibrationLegacyNote,
  calibrationLevelLabel,
  calibrationLevelNote,
} from "@/components/calibration-card";
import {
  calibrationHeadline,
  calibrationReport,
  type CalibrationAttempt,
} from "@/lib/calibration";

function fixedAttempts(n: number, correct: number, predicted: number): CalibrationAttempt[] {
  return Array.from({ length: n }, (_, index) => ({
    predicted,
    correct: index < correct,
  }));
}

describe("CalibrationCard 的档位文案", () => {
  it("n=0：还没有样本，headline 说明先验不代表个人水平", () => {
    const report = calibrationReport([]);
    expect(calibrationLevelLabel(report.level)).toBe("还没有样本");
    expect(calibrationLevelNote(report)).toContain("只有 0 条");
    expect(calibrationHeadline(report)).toContain("图谱深度先验");
  });

  it("n<30：档位写「样本不足」，任何文案都不出现「可信/不可信」", () => {
    const report = calibrationReport(fixedAttempts(12, 8, 0.6));
    expect(calibrationLevelLabel(report.level)).toBe("样本不足（n<30）");

    const texts = [
      calibrationLevelLabel(report.level),
      calibrationLevelNote(report),
      calibrationHeadline(report),
      calibrationLegacyNote(report) ?? "",
      CALIBRATION_SCOPE_NOTE,
    ];
    for (const text of texts) {
      expect(text).not.toContain("可信");
      expect(text).not.toContain("不可信");
    }
  });

  it("30/60/100 三档标签按产品可达性命名", () => {
    expect(calibrationLevelLabel(calibrationReport(fixedAttempts(30, 19, 0.64)).level)).toBe(
      "初步（n=30–59）",
    );
    expect(calibrationLevelLabel(calibrationReport(fixedAttempts(60, 38, 0.65)).level)).toBe(
      "弱校准（n=60–99）",
    );
    expect(calibrationLevelLabel(calibrationReport(fixedAttempts(100, 63, 0.64)).level)).toBe(
      "较稳结论（n≥100）",
    );
  });

  it("n=30 的档位说明给出区间半宽，提醒只能发现更大的偏差", () => {
    const note = calibrationLevelNote(calibrationReport(fixedAttempts(30, 19, 0.64)));
    expect(note).toContain("只能算初步观察");
    expect(note).toContain("95% 区间半宽约 ±16 个百分点");
  });

  it("n=100（模拟数据，非真实学生）：标注上限档，且仍不承诺 ±5pp", () => {
    /*
     * 按分箱边界构造的模拟数据：5 个箱各 20 条、各答对 13 条。
     * 只用来说明文案在 n=100 时如何标注，不代表任何真实学生的表现。
     */
    const simulated: CalibrationAttempt[] = [];
    for (const q of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (let index = 0; index < 20; index += 1) {
        simulated.push({ predicted: q, correct: index < 13 });
      }
    }

    const report = calibrationReport(simulated);
    expect(report.n).toBe(100);
    const note = calibrationLevelNote(report);
    expect(note).toContain("本目标的上限档");
    expect(note).toContain("仍不承诺 ±5pp");
    expect(note).not.toContain("可信");
  });
});

describe("CalibrationCard 的排除提示", () => {
  it("旧记录与坏预测值分别计数", () => {
    const report = calibrationReport([
      { correct: true },
      { predicted: 0.6, correct: true },
      { predicted: 1.2, correct: false },
    ]);
    const note = calibrationLegacyNote(report);
    expect(note).toContain("1 条旧记录没有预测值");
    expect(note).toContain("1 条记录的预测值不在 (0,1) 内");
  });

  it("没有需要排除的记录时返回 null，不显示空提示", () => {
    expect(calibrationLegacyNote(calibrationReport(fixedAttempts(30, 19, 0.64)))).toBeNull();
  });

  it("常驻的规模说明写明 120/80 题上限与不承诺 ±5pp", () => {
    expect(CALIBRATION_SCOPE_NOTE).toContain("最多约 120 题（内置学科）或 80 题（自定义方向）");
    expect(CALIBRATION_SCOPE_NOTE).toContain("不承诺 ±5pp");
    expect(CALIBRATION_SCOPE_NOTE).toContain("n≥100 只在内置学科可达");
  });
});
