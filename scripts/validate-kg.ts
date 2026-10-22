/**
 * 数据集校验脚本。CI 与提交前的硬门禁。
 *
 * 用法：npm run kg:validate
 * 有 error 时以非 0 退出码结束，让 CI 红。
 */

import { validateDataset, datasetStats, QUESTIONS_PER_KC } from "@/lib/dataset";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { computeDepths } from "@/lib/graph";

const issues = validateDataset();
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");
const stats = datasetStats();
const depths = computeDepths(knowledgeGraph);
const maxDepth = Math.max(...depths.values());

console.log("知识图谱与题库校验");
console.log("─".repeat(52));
console.log(`知识点        ${stats.kcCount} 个`);
console.log(`先修边        ${stats.edgeCount} 条`);
console.log(`题目          ${stats.qCount} 道（每知识点 ${QUESTIONS_PER_KC} 道）`);
console.log(`最大先修深度  ${maxDepth} 层`);
console.log(`难度分布      ${Object.entries(stats.byDifficulty).map(([d, n]) => `d=${d}: ${n} 题`).join("  ")}`);
console.log(`难度均值      ${stats.meanDifficulty.toFixed(2)}`);

// 难度均值决定「几题够用」，这个数偏离设计假设时要显式提醒
if (Math.abs(stats.meanDifficulty - 2) > 0.5) {
  warnings.push({
    severity: "warning",
    detail: `难度均值 ${stats.meanDifficulty.toFixed(2)} 偏离设计假设 d=2 较多，需重新核对「3 题/KC 是否仍能让 sd≤0.20」`,
  });
}

if (warnings.length > 0) {
  console.log(`\n提醒 ${warnings.length} 条：`);
  for (const w of warnings) console.log(`  · ${w.detail}`);
}

if (errors.length > 0) {
  console.error(`\n错误 ${errors.length} 条：`);
  for (const e of errors) console.error(`  ✗ ${e.detail}`);
  console.error("\n校验未通过。");
  process.exit(1);
}

console.log("\n校验通过：0 error。");
