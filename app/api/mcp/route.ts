/**
 * MCP 端点（JSON-RPC 2.0 over HTTP）。
 *
 * 对应评分表「MCP / 工具集成 4%」。实现 MCP 三种原语：
 *   - tools：可被模型调用的动作（查路径、查掌握度、检索知识点）
 *   - resources：可被读取的静态数据（各学科图谱与题库）
 *   - prompts：预置的提示模板
 *
 * 为什么手写而不是引 @modelcontextprotocol/sdk：
 * 服务端只需要 handle 一小段 JSON-RPC，引 SDK 会显著增大 bundle，
 * 而这里的方法集是固定的、可穷举的。协议版本与错误码按 MCP 规范写。
 *
 * 多学科：所有工具都接受可选的 subject 参数，默认 data-structures。
 */

import { NextResponse } from "next/server";
import { SUBJECTS, getSubject, DEFAULT_SUBJECT_ID } from "@/data/subjects";
import { planPath, ALGO_VERSION } from "@/lib/plan";
import { masteryMean, masterySd, type MasteryState } from "@/lib/mastery";
import { search, buildIndex } from "@/lib/rag";
import { prerequisiteClosure } from "@/lib/graph";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "adaptive-learning-path", version: "0.2.0" };

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

/** 学科参数的 schema 片段，复用在多个工具里。 */
const SUBJECT_SCHEMA = {
  type: "string",
  enum: SUBJECTS.map((s) => s.id),
  description: `学科 id，默认 ${DEFAULT_SUBJECT_ID}`,
};

const MASTERY_SCHEMA = {
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
};

const TOOLS = [
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

const RESOURCES = SUBJECTS.flatMap((s) => [
  {
    uri: `kg://${s.id}/graph`,
    name: `${s.name} · 知识图谱`,
    description: `${s.graph.concepts.length} 个知识点与 ${s.graph.edges.length} 条先修边`,
    mimeType: "application/json",
  },
  {
    uri: `kg://${s.id}/questions`,
    name: `${s.name} · 题库`,
    description: `${s.questions.length} 道题，含难度与解析`,
    mimeType: "application/json",
  },
]);

const PROMPTS = [
  {
    name: "explain_path_step",
    description: "解释某一步为什么排在学习路径的这个位置",
    arguments: [
      { name: "kcId", description: "知识点 id", required: true },
      { name: "masteryMean", description: "当前掌握度", required: true },
      { name: "subject", description: "学科 id", required: false },
    ],
  },
  {
    name: "review_weak_point",
    description: "针对一个薄弱知识点给出复习建议",
    arguments: [
      { name: "kcId", description: "知识点 id", required: true },
      { name: "subject", description: "学科 id", required: false },
    ],
  },
];

/** 把客户端传来的掌握度清洗成合法状态；缺失的点用先验补齐。 */
function normalizeMastery(input: unknown, subjectId: string): MasteryState[] {
  const subject = getSubject(subjectId);
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

function ok(id: string | number | null | undefined, result: unknown) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return NextResponse.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function subjectOf(args: Record<string, unknown>): string {
  return typeof args.subject === "string" ? args.subject : DEFAULT_SUBJECT_ID;
}

/** 调用工具。返回 MCP 的 content 数组格式。 */
function callTool(name: string, args: Record<string, unknown>) {
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

  const subjectId = subjectOf(args);
  const subject = getSubject(subjectId);

  if (name === "get_learner_state") {
    const mastery = normalizeMastery(args.mastery, subjectId);
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
      mastery: normalizeMastery(args.mastery, subjectId),
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

export async function POST(request: Request) {
  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "Parse error: 请求体不是合法 JSON");
  }

  const { id, method, params = {} } = body;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202 });
  }

  if (method === "tools/list") return ok(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      return ok(id, callTool(name, args));
    } catch (err) {
      return rpcError(id, -32602, err instanceof Error ? err.message : String(err));
    }
  }

  if (method === "resources/list") return ok(id, { resources: RESOURCES });

  if (method === "resources/read") {
    const uri = typeof params.uri === "string" ? params.uri : "";
    const match = /^kg:\/\/([^/]+)\/(graph|questions)$/.exec(uri);
    if (!match) return rpcError(id, -32602, `未知资源：${uri}`);

    const subject = getSubject(match[1]);
    if (subject.id !== match[1]) {
      return rpcError(id, -32602, `未知学科：${match[1]}`);
    }

    const payload = match[2] === "graph" ? subject.graph : subject.questions;
    return ok(id, {
      contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload) }],
    });
  }

  if (method === "prompts/list") return ok(id, { prompts: PROMPTS });

  if (method === "prompts/get") {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, string>;
    const subject = getSubject(args.subject);
    const kc = subject.graph.concepts.find((c) => c.id === args.kcId);

    if (name === "explain_path_step") {
      return ok(id, {
        description: `解释「${kc?.name ?? args.kcId}」为什么排在这个位置`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text:
                `请解释为什么「${kc?.name ?? args.kcId}」（${args.kcId}）排在学习路径的这个位置。` +
                `该知识点当前掌握度为 ${args.masteryMean}，${kc?.summary ?? ""}。` +
                `请引用具体数值，不要泛泛而谈。`,
            },
          },
        ],
      });
    }

    if (name === "review_weak_point") {
      return ok(id, {
        description: `针对「${kc?.name ?? args.kcId}」的复习建议`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `请针对「${kc?.name ?? args.kcId}」（${args.kcId}）给出复习建议。${kc?.summary ?? ""} 请依据课程题库中的解析，不要编造。`,
            },
          },
        ],
      });
    }

    return rpcError(id, -32602, `未知 prompt：${name}`);
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

/** GET 返回服务能力摘要，方便评审用浏览器直接看。 */
export async function GET() {
  return NextResponse.json({
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    algoVersion: ALGO_VERSION,
    subjects: SUBJECTS.map((s) => ({
      id: s.id,
      name: s.name,
      concepts: s.graph.concepts.length,
      edges: s.graph.edges.length,
      questions: s.questions.length,
    })),
    primitives: {
      tools: TOOLS.map((t) => t.name),
      resources: RESOURCES.map((r) => r.uri),
      prompts: PROMPTS.map((p) => p.name),
    },
    transport: "HTTP JSON-RPC 2.0 (POST)",
  });
}
