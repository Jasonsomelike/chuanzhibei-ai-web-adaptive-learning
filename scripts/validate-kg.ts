/**
 * 数据集校验脚本。CI 与提交前的硬门禁。
 *
 * 用法：npm run kg:validate
 * 有 error 时以非 0 退出码结束，让 CI 红。
 */

import { validateDataset, subjectStats, QUESTIONS_PER_KC } from "@/lib/dataset";
import { SUBJECTS } from "@/data/subjects";
import { computeDepths } from "@/lib/graph";

const issues = validateDataset();
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");

console.log("知识图谱与题库校验（全学科）");
console.log("═".repeat(72));

let totalKc = 0;
let totalEdge = 0;
let totalQ = 0;

for (const s of SUBJECTS) {
  const st = subjectStats(s);
  const maxDepth = Math.max(...computeDepths(s.graph).values());
  totalKc += st.kcCount;
  totalEdge += st.edgeCount;
  totalQ += st.qCount;

  const subjErrors = errors.filter((e) => e.subject === s.id).length;
  const subjWarns = warnings.filter((w) => w.subject === s.id).length;
  const mark = subjErrors > 0 ? "✗" : subjWarns > 0 ? "!" : "✓";

  console.log(
    `${mark} ${s.name.padEnd(14)} ${String(st.kcCount).padStart(3)} 点 / ${String(st.edgeCount).padStart(3)} 边 / ${String(st.qCount).padStart(3)} 题` +
      ` · ${st.chapterCount} 章 · 深度 ${maxDepth} · 难度均值 ${st.meanDifficulty.toFixed(2)}`,
  );
}

console.log("─".repeat(72));
console.log(
  `合计 ${SUBJECTS.length} 个学科 · ${totalKc} 知识点 · ${totalEdge} 先修边 · ${totalQ} 题` +
    `（每知识点 ${QUESTIONS_PER_KC} 题）`,
);

if (warnings.length > 0) {
  console.log(`\n提醒 ${warnings.length} 条：`);
  for (const w of warnings) console.log(`  · [${w.subject}] ${w.detail}`);
}

if (errors.length > 0) {
  console.error(`\n错误 ${errors.length} 条：`);
  for (const e of errors) console.error(`  ✗ [${e.subject}] ${e.detail}`);
  console.error("\n校验未通过。");
  process.exit(1);
}

console.log("\n校验通过：0 error。");
