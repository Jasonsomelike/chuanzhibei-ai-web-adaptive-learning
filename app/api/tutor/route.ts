import { NextResponse } from "next/server";
import { answerQuestion, readLlmConfig } from "@/lib/llm";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { initialMastery } from "@/lib/mastery";
import { computeDepths } from "@/lib/graph";
import type { MasteryState } from "@/lib/mastery";

export const runtime = "nodejs";

interface RequestBody {
  question?: unknown;
  mastery?: unknown;
}

/** 校验客户端传来的掌握度，避免脏数据进入提示词。 */
function parseMastery(input: unknown): MasteryState[] | null {
  if (!Array.isArray(input)) return null;
  const ids = new Set(knowledgeGraph.concepts.map((c) => c.id));
  const result: MasteryState[] = [];

  for (const raw of input) {
    if (typeof raw !== "object" || raw === null) continue;
    const m = raw as Record<string, unknown>;
    if (typeof m.kcId !== "string" || !ids.has(m.kcId)) continue;
    if (typeof m.alpha !== "number" || typeof m.beta !== "number") continue;
    if (!Number.isFinite(m.alpha) || !Number.isFinite(m.beta)) continue;
    if (m.alpha <= 0 || m.beta <= 0) continue;

    result.push({
      kcId: m.kcId,
      alpha: m.alpha,
      beta: m.beta,
      evidenceN: typeof m.evidenceN === "number" ? m.evidenceN : 0,
    });
  }

  return result.length > 0 ? result : null;
}

/** 客户端没传掌握度时，用先验兜底，保证接口始终可答。 */
function defaultMastery(): MasteryState[] {
  const depths = computeDepths(knowledgeGraph);
  return knowledgeGraph.concepts.map((c) => initialMastery(c.id, depths.get(c.id) ?? 0));
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (question.length === 0) {
    return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
  }
  if (question.length > 500) {
    return NextResponse.json({ error: "问题过长（上限 500 字）" }, { status: 400 });
  }

  const mastery = parseMastery(body.mastery) ?? defaultMastery();
  const config = readLlmConfig();

  try {
    const answer = await answerQuestion({ question, mastery }, config);
    return NextResponse.json({
      ...answer,
      // 让前端知道当前是哪种模式，界面上要如实展示
      mode: config.provider === "none" ? "retrieval-only" : "llm",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "回答生成失败",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

/** 健康检查：让评审一眼看出 AI 层当前是哪种模式。 */
export async function GET() {
  const config = readLlmConfig();
  return NextResponse.json({
    provider: config.provider,
    model: config.provider === "none" ? null : config.model,
    retrieval: "bm25-bigram",
    documents: knowledgeGraph.concepts.length,
  });
}
