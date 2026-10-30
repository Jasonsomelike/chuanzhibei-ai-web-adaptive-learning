/**
 * 导师回答评测脚本。
 *
 * 用法：
 *   npm run eval:tutor                       # 等价于 --judge rules（零 key）
 *   npm run eval:tutor -- --judge rules
 *   npm run eval:tutor -- --judge llm        # 需要 ALP_E2E_LLM_*；未配置则打印「judge 未测」并 exit 0
 *   npm run eval:tutor -- --answers a.jsonl  # 用外部答案替换默认答案（JSONL：{"id":"t01","answer":"…"}）
 *   npm run eval:tutor -- --verbose          # 逐条打印每一维的理由
 *
 * 默认答案来自 composeDeterministic（无模型路径的真实输出），不是手写金标；
 * 所以 --judge rules 不需要任何密钥，也能测到结构回退。
 *
 * 输出只有逐条分数与硬门结果，不打印通过率：规则评分覆盖不了「说得好不好」，
 * 把 8 个维度的平均分包装成百分比只会制造虚假的确定感。
 *
 * 退出码：0 = 硬门全过（或 judge 未测）；1 = 硬门未过 / 输入或网络错误。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  TUTOR_EVAL_CASES,
  buildJudgePrompt,
  deterministicAnswerFor,
  evaluateHardGates,
  judgeAnswerByRules,
  judgementsFromLlm,
  validateLlmJudge,
  type CaseJudgement,
  type JudgeRequestItem,
  type TutorEvalCase,
} from "@/lib/tutorEval";

// tsx 不会自动读取 .env.local；不先加载，ALP_E2E_LLM_* 永远读不到。
try {
  process.loadEnvFile(".env.local");
} catch {
  // 文件不存在或运行环境不支持时继续：变量也可能由 shell 直接提供。
}

const JUDGE_TIMEOUT_MS = 120_000;

interface ScriptArgs {
  readonly judge: "rules" | "llm";
  readonly answersPath: string | null;
  readonly verbose: boolean;
}

interface LlmConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

function parseArgs(argv: readonly string[]): ScriptArgs {
  let judge: "rules" | "llm" = "rules";
  let answersPath: string | null = null;
  let verbose = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--judge") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--judge 需要值（rules 或 llm）");
      if (value !== "rules" && value !== "llm") {
        throw new Error(`不支持的 --judge：${value}（目前只有 rules / llm）`);
      }
      judge = value;
      i += 1;
    } else if (arg.startsWith("--judge=")) {
      const value = arg.slice("--judge=".length);
      if (value !== "rules" && value !== "llm") {
        throw new Error(`不支持的 --judge：${value}（目前只有 rules / llm）`);
      }
      judge = value;
    } else if (arg === "--answers") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--answers 需要文件路径");
      answersPath = value;
      i += 1;
    } else if (arg.startsWith("--answers=")) {
      answersPath = arg.slice("--answers=".length);
    } else if (arg === "--verbose") {
      verbose = true;
    } else {
      throw new Error(`不认识的参数：${arg}`);
    }
  }

  return { judge, answersPath, verbose };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envText(name: string): string {
  return (process.env[name] ?? "").trim();
}

function readLlmConfig(): LlmConfig | null {
  const baseUrl = envText("ALP_E2E_LLM_BASE_URL");
  const apiKey = envText("ALP_E2E_LLM_API_KEY");
  const model = envText("ALP_E2E_LLM_MODEL");
  if (baseUrl === "" || apiKey === "" || model === "") return null;
  return { baseUrl, apiKey, model };
}

function loadAnswerFile(path: string): Map<string, string> {
  const fullPath = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(fullPath, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`读取答案文件失败（${fullPath}）：${reason}`);
  }

  const answers = new Map<string, string>();
  raw.split("\n").forEach((line, index) => {
    const text = line.trim();
    if (text === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`答案文件第 ${index + 1} 行不是合法 JSON`);
    }
    if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.answer !== "string") {
      throw new Error(`答案文件第 ${index + 1} 行需要 {id, answer} 两个字符串字段`);
    }
    if (answers.has(parsed.id)) throw new Error(`答案文件里 ${parsed.id} 重复`);
    answers.set(parsed.id, parsed.answer);
  });

  if (answers.size === 0) throw new Error(`答案文件是空的：${fullPath}`);
  return answers;
}

/** 默认答案逐条来自无模型拼装；外部文件必须覆盖全部 10 条。 */
function resolveAnswers(
  args: ScriptArgs,
  testCases: readonly TutorEvalCase[],
): { readonly answers: Map<string, string>; readonly source: string } {
  if (args.answersPath !== null) {
    const answers = loadAnswerFile(args.answersPath);
    const missing = testCases.filter((testCase) => !answers.has(testCase.id));
    if (missing.length > 0) {
      throw new Error(`答案文件缺少条目：${missing.map((item) => item.id).join("、")}`);
    }
    return { answers, source: `外部文件 ${resolve(args.answersPath)}` };
  }

  return {
    answers: new Map(
      testCases.map((testCase) => [testCase.id, deterministicAnswerFor(testCase)] as const),
    ),
    source: "无模型拼装（composeDeterministic）",
  };
}

function printScoreTable(judgements: readonly CaseJudgement[]): void {
  const kindWidth = Math.max(...judgements.map((judgement) => judgement.kind.length)) + 2;
  console.log("\n逐条分数（0/1/2）");
  console.log(
    "id".padEnd(6) +
      "kind".padEnd(kindWidth) +
      "chars".padEnd(8) +
      "R1 R2 R3 R4 R5 R6 R7 R8",
  );
  for (const judgement of judgements) {
    const scores = judgement.scores
      .map((entry) => String(entry.score).padStart(2))
      .join(" ");
    console.log(
      judgement.caseId.padEnd(6) +
        judgement.kind.padEnd(kindWidth) +
        String(judgement.answerChars).padEnd(8) +
        scores,
    );
  }
}

function printReasons(judgements: readonly CaseJudgement[]): void {
  console.log("\n逐条理由");
  for (const judgement of judgements) {
    console.log(`${judgement.caseId}（${judgement.kind}）`);
    for (const entry of judgement.scores) {
      console.log(`  ${entry.id} ${entry.label} = ${entry.score}：${entry.reason}`);
    }
  }
}

function printGates(gates: ReturnType<typeof evaluateHardGates>): boolean {
  console.log("\n硬门");
  let allPassed = true;
  for (const gate of gates) {
    const demand = `${gate.id} ${gate.label} ${gate.op}${gate.threshold}`;
    if (gate.passed) {
      console.log(`  ${demand}：✓`);
    } else {
      allPassed = false;
      console.log(`  ${demand}：✗ 未过 ${gate.failedCaseIds.join("、")}`);
    }
  }
  return allPassed;
}

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
  }[];
}

async function callLlmJudge(config: LlmConfig, prompt: string): Promise<string> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`judge 请求失败（${endpoint}）：${reason}`);
  }

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`judge 请求失败：HTTP ${response.status} ${bodyText.slice(0, 300)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new Error("judge 响应不是合法 JSON");
  }
  const content = (parsed as ChatCompletionResponse).choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("judge 响应缺少 choices[0].message.content");
  }
  return content;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const { answers, source } = resolveAnswers(args, TUTOR_EVAL_CASES);

  console.log("导师回答评测");
  console.log("═".repeat(72));
  console.log(`问题：${TUTOR_EVAL_CASES.length} 条；维度：8 个（0/1/2）`);
  console.log(`答案来源：${source}`);
  console.log(`judge：${args.judge}`);

  const judgements: CaseJudgement[] = [];

  if (args.judge === "rules") {
    for (const testCase of TUTOR_EVAL_CASES) {
      judgements.push(
        judgeAnswerByRules({ case: testCase, answer: answers.get(testCase.id) ?? "" }),
      );
    }
  } else {
    const config = readLlmConfig();
    if (config === null) {
      console.log(
        "\njudge 未测（未配置 ALP_E2E_LLM_BASE_URL / ALP_E2E_LLM_API_KEY / ALP_E2E_LLM_MODEL）",
      );
      return 0;
    }
    console.log(`judge 模型：${config.model}`);
    console.log("注意：同模型判自己的输出会偏高，结论需配人工校准 3 条以上。");

    const items: readonly JudgeRequestItem[] = TUTOR_EVAL_CASES.map((testCase) => ({
      id: testCase.id,
      question: testCase.question,
      answer: answers.get(testCase.id) ?? "",
    }));
    const raw = await callLlmJudge(config, buildJudgePrompt(items));
    const result = validateLlmJudge(raw, answers);

    if (result.rejected.length > 0) {
      console.log("\njudge 输出未通过校验");
      for (const rejection of result.rejected) {
        console.log(`  ${rejection.id}：${rejection.reason}`);
      }
      console.log("逐条必须有 quote，且 quote 必须是该条答案的子串；不合格的条目不参与计分。");
    }

    judgements.push(...judgementsFromLlm(TUTOR_EVAL_CASES, result, answers));
    if (result.rejected.length > 0) {
      printScoreTable(judgements);
      console.log("\n硬门：未判定（judge 输出未通过校验）");
      return 1;
    }
  }

  printScoreTable(judgements);
  if (args.verbose) printReasons(judgements);

  const allPassed = printGates(evaluateHardGates(judgements));
  return allPassed ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`\nFAIL ${message}`);
  process.exitCode = 1;
}
