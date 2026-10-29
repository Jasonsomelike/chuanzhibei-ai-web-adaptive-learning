import { NextResponse } from "next/server";
import { MAX_DIRECTIONS_GENERATE_BODY_BYTES } from "@/lib/bodyLimit";
import {
  composeFromExisting,
  validateDraft,
  extractJson,
  coerceDraft,
  DIRECTION_SYSTEM_PROMPT,
  type DirectionDraft,
} from "@/lib/direction";
import { assertMutationOrigin, readLimitedText } from "@/lib/routeAuth";

export const runtime = "nodejs";

interface Body {
  description?: unknown;
  /**
   * 前端在浏览器里直连供应商生成的结果，原样传上来做校验。
   * 服务端不持有密钥，只负责校验——这是本项目的密钥模型。
   */
  rawModelOutput?: unknown;
}

/**
 * POST：把用户描述变成方向草稿。
 *
 * 两种模式：
 *   - 带 rawModelOutput：校验前端生成的草稿（主流路径，密钥在浏览器）
 *   - 不带：服务端用关键词规则从现有学科拼装（降级路径，无密钥可用）
 *
 * 返回的 draft 已经过校验，前端可直接预览并提交到 /api/directions。
 */
export async function POST(request: Request) {
  // 该接口不要求登录，但会消耗解析与校验资源，且写请求没有理由接受跨站代发。
  const rejected = assertMutationOrigin(request);
  if (rejected) return rejected;

  const raw = await readLimitedText(request, MAX_DIRECTIONS_GENERATE_BODY_BYTES);
  if (!raw.ok) return raw.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return NextResponse.json({ error: "请求体必须是 JSON 对象" }, { status: 400 });
  }
  const body = parsed as Body;

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description === "") {
    return NextResponse.json({ error: "请填写你想学什么" }, { status: 400 });
  }
  if (description.length > 500) {
    return NextResponse.json({ error: "描述过长（上限 500 字）" }, { status: 400 });
  }

  // ── 路径 1：校验前端生成的结果 ──
  if (body.rawModelOutput !== undefined) {
    const parsed = extractJson(String(body.rawModelOutput));
    const draft = parsed ? coerceDraft(parsed) : null;

    if (!draft) {
      return NextResponse.json(
        {
          error: "模型返回的内容不是预期的 JSON 结构",
          hint: "可以换个描述重试，或到设置页换一个模型",
        },
        { status: 422 },
      );
    }

    const issues = validateDraft(draft);
    if (issues.length > 0) {
      return NextResponse.json(
        { error: "生成的方向不合格，已拒绝", issues },
        { status: 422 },
      );
    }

    return NextResponse.json({ draft, source: "llm" });
  }

  // ── 路径 2：规则拼装 ──
  const draft: DirectionDraft | null = composeFromExisting(description);
  if (!draft) {
    return NextResponse.json(
      {
        error:
          "未识别出匹配的学科。可以更具体一些，例如「我想系统学树结构」「我想了解进程调度」。",
        hint: "配置模型供应商后，可以用自然语言描述任意主题。",
      },
      { status: 422 },
    );
  }

  const issues = validateDraft(draft);
  if (issues.length > 0) {
    return NextResponse.json({ error: "拼装结果不合格", issues }, { status: 422 });
  }

  return NextResponse.json({ draft, source: "existing" });
}

/** GET：返回系统提示词，供前端在浏览器直连时使用。 */
export async function GET() {
  return NextResponse.json({
    systemPrompt: DIRECTION_SYSTEM_PROMPT,
    limits: { minConcepts: 5, maxConcepts: 20 },
  });
}
