import type { Db } from "./db";
import type { LearningContext } from "./learningContext";
import type { LlmConfig } from "./upstream";
import { readArtifact, writeArtifact } from "./learningArtifacts";
import {
  ruleTimeEstimates,
  timeFingerprint,
  timeBatches,
  parseTimeJson,
  validateTimeEstimates,
  type LearningTimeResult,
} from "./learningTime";
import { callStructuredModel } from "./structuredModel";
import { listDirectionDocs } from "./kbServer";
import { readContextBudget } from "./contextBudget";
export async function estimateLearningTime(
  db: Db,
  user: string,
  context: LearningContext,
  config: LlmConfig | null,
  signal?: AbortSignal,
  run = callStructuredModel,
): Promise<LearningTimeResult> {
  const { course, progress } = context;
  const documents = await listDirectionDocs(db, user, course.id);
  const evidence = {
    questions: course.questions.map((q) => ({
      kcId: q.kcId,
      difficulty: q.difficulty,
      stem: q.stem.slice(0, 140),
    })),
    recentAttempts: progress.attempts.filter((a) => !a.retired).slice(-30),
    materials: documents.map((d) => ({
      title: d.title,
      chars: d.charCount,
      kcIds: d.kcIds,
    })),
  };
  const fingerprint = timeFingerprint(course.graph, progress.mastery, {
    evidence,
    model: config
      ? {
          api: config.api,
          baseUrl: config.options.baseUrl,
          model: config.options.model,
          ...readContextBudget(config.options),
        }
      : null,
  });
  const fallback: LearningTimeResult = {
    version: "learning-time-v1",
    fingerprint,
    source: "rules",
    estimates: ruleTimeEstimates(course.graph, progress.mastery),
    stages: [
      {
        node: "estimator",
        label: "按内容与学习证据生成初估",
        status: "complete",
      },
      {
        node: "time_validator",
        label: "已校验分钟范围和知识点覆盖",
        status: "complete",
      },
    ],
  };
  if (!config) return fallback;
  const cached = await readArtifact<{
    result?: LearningTimeResult;
    leaseUntil: number;
  }>(db, user, "learning-times", fingerprint);
  if (
    cached?.value.result &&
    cached.touched >
      Date.now() - (cached.value.result.source === "llm" ? 86400_000 : 60_000)
  )
    return {
      ...cached.value.result,
      cached: true,
      stages: cached.value.result.stages.map((s) => ({
        ...s,
        label: `复用估算 · ${s.label}`,
      })),
    };
  if (cached && cached.value.leaseUntil > Date.now())
    return {
      ...fallback,
      notice: "另一轮正在估算，暂用规则初估；稍后可刷新。",
    };
  if (
    !(await writeArtifact(
      db,
      user,
      "learning-times",
      fingerprint,
      { leaseUntil: Date.now() + 150_000 },
      cached?.revision ?? null,
    ))
  )
    return { ...fallback, notice: "时长估算正在准备，暂用规则初估。" };
  const revision = cached ? cached.revision + 1 : 0;
  let failure = "";
  const deadline = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(120_000),
  ]);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const estimates = [];
      const batches = timeBatches(
        course.graph,
        progress.mastery,
        evidence,
        config.options,
      );
      for (let offset = 0; offset < batches.length; offset += 2) {
        const results = await Promise.all(
          batches.slice(offset, offset + 2).map(async (batch) => {
            const prompt =
              batch.prompt +
              (attempt
                ? `\n上轮结构校验失败：${failure}。请重新输出完整且合法的 JSON。`
                : "");
            return validateTimeEstimates(
              parseTimeJson(await run(config, prompt, deadline)),
              batch.graph,
            );
          }),
        );
        estimates.push(...results.flat());
      }
      const result: LearningTimeResult = {
        version: "learning-time-v1",
        fingerprint,
        source: "llm",
        model: config.options.model,
        estimates,
        stages: [
          {
            node: "estimator",
            label: `时长估算 Agent 已结合内容和作答证据估算${attempt ? "（校验后修复）" : ""}`,
            status: "complete",
          },
          {
            node: "time_validator",
            label: "知识点覆盖、区间与分钟范围校验通过",
            status: "complete",
          },
        ],
      };
      await writeArtifact(
        db,
        user,
        "learning-times",
        fingerprint,
        { result, leaseUntil: 0 },
        revision,
      );
      return result;
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = "请检查每个课程 ID 恰好一次、整数范围和区间覆盖。";
    }
  }
  // A failed estimate is briefly cached to avoid spending tokens repeatedly on every navigation.
  const result = {
    ...fallback,
    notice: "模型估算未通过校验或暂时不可用，当前使用规则初估。",
    stages: [
      {
        node: "estimator" as const,
        label: "模型估算失败，已使用规则初估",
        status: "failed" as const,
      },
      fallback.stages[1],
    ],
  };
  await writeArtifact(
    db,
    user,
    "learning-times",
    fingerprint,
    { result, leaseUntil: 0 },
    revision,
  );
  return result;
}
