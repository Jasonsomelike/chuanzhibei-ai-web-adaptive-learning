/**
 * 项目自带的 5 个只读工具（纯函数 + schema）。
 *
 * 为什么单独成文件：同一份工具要被两个入口复用——
 *   - app/api/mcp/route.ts：对外 MCP 端点（JSON-RPC 的 tools/list 与 tools/call）；
 *   - /api/agent 的有界工具循环：把同一份定义发给模型，并执行同一份实现。
 * 复制两份的代价不是行数，而是「MCP 客户端看到的工具行为」与「Agent 跑出来的行为」
 * 会悄悄分叉：改了一处忘了另一处，线上就会出现同输入不同输出。
 *
 * 边界：
 * - 这里只有**只读**工具，全部是纯函数（同输入同输出）。写工具必须先过鉴权与限流，
 *   不能只在这里加一个名字。
 * - 参数清洗对模型幻觉宽容、对越界严格：未知 subject 明确报错而不是静默回落默认学科
 *   （getSubject 本身会回落，见 src/data/subjects/index.ts:118-121）。
 * - 返回值是 MCP 的 content 数组形状，Agent 侧再把它压成一段文本回灌给模型。
 */

import {
  SUBJECTS,
  getSubject,
  DEFAULT_SUBJECT_ID,
  type Subject,
} from "@/data/subjects";
import { planPath } from "@/lib/plan";
import { masteryMean, masterySd, type MasteryState } from "@/lib/mastery";
import { search, buildIndex } from "@/lib/rag";
import { prerequisiteClosure } from "@/lib/graph";

/** 工具名必须满足 OpenAI 函数名的字符集与长度。 */
export const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/** 代码内只读集合。任何不在此列表里的名字都不得进入 Agent 工具集。 */
export const READ_ONLY_TOOL_NAMES = [
  "list_subjects",
  "get_learner_state",
  "plan_path",
  "search_knowledge",
  "get_prerequisites",
] as const;

export type ReadOnlyToolName = (typeof READ_ONLY_TOOL_NAMES)[number];

const READ_ONLY_SET: ReadonlySet<string> = new Set(READ_ONLY_TOOL_NAMES);

export function isReadOnlyToolName(name: string): name is ReadOnlyToolName {
  return READ_ONLY_SET.has(name);
}

/** 工具定义。inputSchema 是 JSON Schema（与 MCP tools/list 的 inputSchema 同形）。 */
export interface ToolDescriptor {
  readonly name: ReadOnlyToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** 学科参数的 schema 片段，复用在多个工具里。 */
export const SUBJECT_SCHEMA = {
  type: "string",
  enum: SUBJECTS.map((s) => s.id),
  description: `学科 id，默认 ${DEFAULT_SUBJECT_ID}`,
} as const;

export const MASTERY_SCHEMA = {
  type: "array",
  description: "客户端持有的掌握度数组；不传则用先验",
  items: {
    type: "object",
    properties: {
      kcId: { type: "string" },
      alpha: { type: "number" },
      beta: { type: "number" },
      evidenceN: { type: "number" },
    },
    required: ["kcId", "alpha", "beta"],
  },
} as const;

export const TOOLS: readonly ToolDescriptor[] = [
  {
    name: "list_subjects",
    description: "列出所有可用学科及其规模（知识点数、先修边数、题数）。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_learner_state",
    description: "读取学习者当前各知识点的掌握度点估计、不确定度与已测题数。",
    inputSchema: {
      type: "object",
      properties: { subject: SUBJECT_SCHEMA, mastery: MASTERY_SCHEMA },
    },
  },
  {
    name: "plan_path",
    description:
      "根据掌握度与时间预算生成学习路径。纯函数，同输入同输出，返回路径指纹用于复现校验。",
    inputSchema: {
      type: "object",
      properties: {
        subject: SUBJECT_SCHEMA,
        mastery: MASTERY_SCHEMA,
        budgetMinutes: { type: "number", description: "本轮可投入的分钟数" },
        targets: {
          type: "array",
          items: { type: "string" },
          description: "目标知识点 id；不传则对全部未掌握点规划",
        },
      },
      required: ["budgetMinutes"],
    },
  },
  {
    name: "search_knowledge",
    description: "在指定学科的知识库中检索相关知识点，返回 kcId、标题与摘要。",
    inputSchema: {
      type: "object",
      properties: {
        subject: SUBJECT_SCHEMA,
        query: { type: "string" },
        topK: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_prerequisites",
    description: "查询某知识点的全部先修（传递闭包），用于解释「为什么不能直接学这个」。",
    inputSchema: {
      type: "object",
      properties: { subject: SUBJECT_SCHEMA, kcId: { type: "string" } },
      required: ["kcId"],
    },
  },
];

/** MCP 的 content 数组形状；工具只产出文本。 */
export interface ToolContent {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
}

/** 参数错误。MCP 端点把它映射成 JSON-RPC -32602，Agent 把它映射成一次失败的调用。 */
export class ToolArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolArgsError";
  }
}

/** 把客户端传来的掌握度清洗成合法状态；缺失的点用先验补齐。 */
export function normalizeMastery(input: unknown, subject: Subject): MasteryState[] {
  const validIds = new Set(subject.graph.concepts.map((c) => c.id));
  const map = new Map<string, MasteryState>();

  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw !== "object" || raw === null) continue;
      const m = raw as Record<string, unknown>;
      if (typeof m.kcId !== "string" || !validIds.has(m.kcId)) continue;
      if (typeof m.alpha !== "number" || typeof m.beta !== "number") continue;
      if (!Number.isFinite(m.alpha) || !Number.isFinite(m.beta)) continue;
      if (m.alpha <= 0 || m.beta <= 0) continue;
      map.set(m.kcId, {
        kcId: m.kcId,
        alpha: m.alpha,
        beta: m.beta,
        evidenceN: typeof m.evidenceN === "number" ? m.evidenceN : 0,
      });
    }
  }

  // 缺失的点用中性先验补齐（0.7 / 1.3 对应 p=0.35, s=2）
  for (const c of subject.graph.concepts) {
    if (!map.has(c.id)) map.set(c.id, { kcId: c.id, alpha: 0.7, beta: 1.3, evidenceN: 0 });
  }

  return [...map.values()];
}

/**
 * 解析并校验 subject 参数。
 *
 * getSubject 对未知 id 会静默回落到 SUBJECTS[0]（src/data/subjects/index.ts:118-121），
 * 这里把回落翻译成参数错误：否则模型幻觉一个 id 就能拿到标错学科的路径，
 * 响应里回显的还是那个不存在的 id。
 */
export function resolveSubject(args: Record<string, unknown>): {
  readonly id: string;
  readonly subject: Subject;
} {
  const requested = typeof args.subject === "string" ? args.subject : DEFAULT_SUBJECT_ID;
  const subject = getSubject(requested);
  if (subject.id !== requested) {
    throw new ToolArgsError(`未知学科：${requested}`);
  }
  return { id: subject.id, subject };
}

/**
 * 执行一个只读工具。
 *
 * 未知工具名抛普通 Error（消息保持与旧 MCP 端点一致），参数问题抛 ToolArgsError；
 * 两者的 message 都会原样出现在 MCP 的 -32602 里，调用方只需 catch Error。
 */
export function callReadOnlyTool(name: string, args: Record<string, unknown>): ToolContent {
  if (name === "list_subjects") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            SUBJECTS.map((s) => ({
              id: s.id,
              name: s.name,
              tagline: s.tagline,
              concepts: s.graph.concepts.length,
              edges: s.graph.edges.length,
              questions: s.questions.length,
            })),
          ),
        },
      ],
    };
  }

  const { id: subjectId, subject } = resolveSubject(args);

  if (name === "get_learner_state") {
    const mastery = normalizeMastery(args.mastery, subject);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            subject: subjectId,
            concepts: mastery.map((m) => ({
              kcId: m.kcId,
              name: subject.graph.concepts.find((c) => c.id === m.kcId)?.name ?? m.kcId,
              mean: Number(masteryMean(m).toFixed(4)),
              sd: Number(masterySd(m).toFixed(4)),
              evidenceN: m.evidenceN,
            })),
          }),
        },
      ],
    };
  }

  if (name === "plan_path") {
    const budget = typeof args.budgetMinutes === "number" ? args.budgetMinutes : 90;
    const targets = Array.isArray(args.targets)
      ? args.targets.filter((t): t is string => typeof t === "string")
      : undefined;

    const result = planPath({
      graph: subject.graph,
      mastery: normalizeMastery(args.mastery, subject),
      budgetMinutes: budget,
      targets,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            subject: subjectId,
            pathHash: result.pathHash,
            algoVersion: result.algoVersion,
            kgVersion: result.kgVersion,
            totalMinutes: result.totalMinutes,
            steps: result.steps,
            deferredCount: result.deferred.length,
          }),
        },
      ],
    };
  }

  if (name === "search_knowledge") {
    const query = typeof args.query === "string" ? args.query : "";
    const topK = typeof args.topK === "number" ? Math.min(10, Math.max(1, args.topK)) : 3;

    const docs = subject.graph.concepts.map((c) => {
      const qs = subject.questions.filter((q) => q.kcId === c.id);
      const qa = qs
        .map((q, i) => `第${i + 1}题（难度${q.difficulty}）：${q.stem} 解析：${q.explanation}`)
        .join(" ");
      return {
        kcId: c.id,
        title: c.name,
        text: `${c.chapter}。${c.summary}。常见考点与解析：${qa}`,
      };
    });

    const index = buildIndex(docs);
    return {
      content: [{ type: "text", text: JSON.stringify(search(index, query, topK)) }],
    };
  }

  if (name === "get_prerequisites") {
    const kcId = typeof args.kcId === "string" ? args.kcId : "";
    const closure = prerequisiteClosure(subject.graph, kcId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            subject: subjectId,
            kcId,
            prerequisites: [...closure].map((id) => ({
              kcId: id,
              name: subject.graph.concepts.find((c) => c.id === id)?.name ?? id,
            })),
          }),
        },
      ],
    };
  }

  throw new Error(`未知工具：${name}`);
}

/** Agent 侧用的便捷封装：只取第一段文本。 */
export function callReadOnlyToolText(name: string, args: Record<string, unknown>): string {
  return callReadOnlyTool(name, args).content[0]?.text ?? "";
}
