/**
 * 打印 golden case 的输入/输出指纹。
 *
 * 用途只有一个：改了 plan 算法或图谱之后，用它重新生成
 * plan.test.ts 里的两个字面量，并人工确认变化是预期的。
 *
 * 运行：node node_modules/tsx/dist/cli.mjs scripts/path-hash.ts
 */

import { planPath, computeInputHash, ALGO_VERSION } from "../src/lib/plan";
import { initialMastery } from "../src/lib/mastery";
import { knowledgeGraph } from "../src/data/knowledge-graph";

// 与 plan.test.ts 的 baseInput({ budgetMinutes: 120 }) 保持一致：
// 空掌握度（全部零观测）+ 120 分钟预算 + 数据结构图谱。
const mastery = knowledgeGraph.concepts.map((c) => initialMastery(c.id, 0));
const input = {
  graph: knowledgeGraph,
  mastery,
  budgetMinutes: 120,
};

const result = planPath(input);

console.log(`algoVersion  ${ALGO_VERSION}`);
console.log(`kgVersion    ${knowledgeGraph.version}`);
console.log(`inputHash    ${computeInputHash(input)}`);
console.log(`pathHash     ${result.pathHash}`);
console.log(`steps        ${result.steps.map((s) => `${s.kcId}:${s.estMinutes}`).join(" ")}`);
console.log(`totalMinutes ${result.totalMinutes}`);
console.log(`deferred     ${result.deferred.join(" ")}`);
console.log(
  `blocked      ${result.blocked.map((b) => `${b.kcId}<-${b.by.join("|")}`).join(" ") || "（无）"}`,
);
