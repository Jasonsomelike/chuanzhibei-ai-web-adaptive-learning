import { expect, it } from "vitest";
import { SUBJECTS } from "@/data/subjects";
import { createLearner, recordAttempt, progressOf, clearKcEvidence } from "@/lib/learner";
import { learningReport } from "@/lib/learningReport";
import { planPath } from "@/lib/plan";
const subject = SUBJECTS[0];
it("最近作答前版本与真实旧计划一致，当前版本与规划器一致", () => {
  const learner = createLearner();
  const before = progressOf(learner, subject.id);
  const q = subject.questions[0];
  const after = progressOf(recordAttempt(learner, subject.id, q, true, "2026-11-04T00:00:00Z"), subject.id);
  const report = learningReport(subject.graph, after, 60)!;
  expect(report.before.pathHash).toBe(planPath({ graph: subject.graph, mastery: before.mastery, budgetMinutes: 60 }).pathHash);
  expect(report.after.pathHash).toBe(planPath({ graph: subject.graph, mastery: after.mastery, budgetMinutes: 60 }).pathHash);
});
it("归档记录不能成为本轮最新证据，历史数量仍保留", () => {
  const q = subject.questions[0];
  let learner = recordAttempt(createLearner(), subject.id, q, false, "2026-11-04T00:00:00Z");
  learner = clearKcEvidence(learner, subject.id, q.kcId);
  expect(learningReport(subject.graph, progressOf(learner, subject.id), 60)).toBeNull();
  learner = recordAttempt(learner, subject.id, q, true, "2026-11-04T00:01:00Z");
  const report = learningReport(subject.graph, progressOf(learner, subject.id), 60)!;
  expect(report.archived).toBe(1);
  expect(report.last.correct).toBe(true);
});
