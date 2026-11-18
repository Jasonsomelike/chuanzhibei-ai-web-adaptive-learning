import { directionWorkspaceId } from "@/lib/directionWorkspaceId";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMutationOrigin, readLimitedText } from "@/lib/routeAuth";
import { MAX_DIRECTION_BODY_BYTES } from "@/lib/bodyLimit";
import {
  validateDraft,
  draftToDirection,
  composeFromExisting,
  coerceDraft,
  MAX_TITLE_LENGTH,
  type CustomDirection,
  type DirectionDraft,
} from "@/lib/direction";

export const runtime = "nodejs";

interface DirectionRow {
  id: string;
  user_id: string;
  title: string;
  subject_id: string;
  description: string;
  graph_json: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

function rowToDirection(row: DirectionRow): CustomDirection {
  const graph = JSON.parse(row.graph_json) as CustomDirection["graph"];
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    subjectId: row.subject_id,
    description: row.description,
    graph,
    questions: [],
    isPublic: row.is_public,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * GET：
 *   ?id=<uuid>    单个方向（作者本人或已公开），含完整图谱与各 KC 的题量
 *   ?scope=mine   我的方向（需登录）
 *   ?scope=market 公开的方向（含搜索 q、学科筛选 subject）
 *   默认 market
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  const scope = url.searchParams.get("scope") ?? "market";
  const q = (url.searchParams.get("q") ?? "").trim();
  const subject = (url.searchParams.get("subject") ?? "").trim();

  const db = await getDb();

  if (id !== "") {
    const row = await db.one<DirectionRow>("SELECT * FROM directions WHERE id = $1", [id]);
    if (!row) return NextResponse.json({ error: "方向不存在" }, { status: 404 });

    const isOwner = (await getCurrentUser())?.id === row.user_id;
    if (!row.is_public && !isOwner) {
      return NextResponse.json({ error: "该方向未公开" }, { status: 403 });
    }

    const direction = rowToDirection(row);

    /*
     * 题目覆盖度：每 KC 的 accepted/practice 计数，诊断页据此决定要不要生成。
     * 刻意不用 GROUP BY：内存实现只支持固定几种查询模式，
     * 多一条聚合查询就要在两处实现里各写一遍，出错面更大。
     */
    const itemRows = await db.all<{ kc_id: string; status: string; source: string }>(
      "SELECT kc_id, status, source FROM direction_items WHERE direction_id = $1",
      [id],
    );
    /*
     * 每 KC 的 accepted/practice 计数 + accepted 的来源构成。
     * 来源是必需的：门槛按来源区分（生成题 4 道、手动/借用 3 道），
     * 只给总数会让方向页无法判断「就绪」。
     */
    const coverage: Record<
      string,
      { accepted: number; practice: number; sources: string[] }
    > = {};
    for (const r of itemRows) {
      const bucket = (coverage[r.kc_id] ??= { accepted: 0, practice: 0, sources: [] });
      if (r.status === "accepted") {
        bucket.accepted += 1;
        if (typeof r.source === "string") bucket.sources.push(r.source);
      } else if (r.status === "practice") bucket.practice += 1;
    }

    return NextResponse.json({
      id: direction.id,
      title: direction.title,
      description: direction.description,
      subjectId: direction.subjectId,
      graph: direction.graph,
      isPublic: direction.isPublic,
      isOwner,
      updatedAt: direction.updatedAt,
      coverage,
    });
  }

  if (scope === "mine") {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const rows = await db.all<DirectionRow>(
      "SELECT * FROM directions WHERE user_id = $1 ORDER BY updated_at DESC",
      [user.id],
    );
    return NextResponse.json({ directions: rows.map(rowToDirection) });
  }

  // market：只返回公开的
  let sql = "SELECT * FROM directions WHERE is_public = true";
  const params: unknown[] = [];

  if (q !== "") {
    params.push(`%${q}%`);
    sql += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
  }
  if (subject !== "") {
    params.push(subject);
    sql += ` AND subject_id = $${params.length}`;
  }
  sql += " ORDER BY updated_at DESC LIMIT 100";

  const rows = await db.all<DirectionRow>(sql, params);

  // 市场列表不需要完整图谱，只给摘要，减小响应体
  const summary = rows.map((row) => {
    const d = rowToDirection(row);
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      subjectId: d.subjectId,
      conceptCount: d.graph.concepts.length,
      edgeCount: d.graph.edges.length,
      isPublic: d.isPublic,
      updatedAt: d.updatedAt,
    };
  });

  return NextResponse.json({ directions: summary });
}

interface CreateBody {
  draftKey?: unknown;
  /** 用户自然语言描述。 */
  description?: unknown;
  /** 可选：直接提交一份已生成的草稿（前端预览后确认）。 */
  draft?: unknown;
  /** 可选：从市场复制的方向 id。 */
  copyFrom?: unknown;
  isPublic?: unknown;
}

/**
 * POST：创建自定义方向。
 *
 * 三种来源：
 *   1. description + draft：前端已经用 LLM 生成并预览过，直接落库
 *   2. description only：服务端用规则从现有学科拼装（无模型时的降级）
 *   3. copyFrom：把市场里的某个公开方向复制到自己名下
 *
 * 无论哪种，落库前都必须过 validateDraft。
 */
export async function POST(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  let body: CreateBody;
  const limited = await readLimitedText(request, MAX_DIRECTION_BODY_BYTES);
  if (!limited.ok) return limited.response;
  try {
    body = JSON.parse(limited.text) as CreateBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const db = await getDb();
  const now = new Date().toISOString();

  // ── 路径 3：复制市场里的方向 ──
  if (typeof body.copyFrom === "string" && body.copyFrom !== "") {
    const src = await db.one<DirectionRow>("SELECT * FROM directions WHERE id = $1", [
      body.copyFrom,
    ]);
    if (!src) return NextResponse.json({ error: "方向不存在" }, { status: 404 });
    if (!src.is_public) {
      return NextResponse.json({ error: "该方向未公开，无法复制" }, { status: 403 });
    }

    const original = rowToDirection(src);
    const id = crypto.randomUUID();
    const graphJson = JSON.stringify(original.graph);

    await db.run(
      `INSERT INTO directions (id, user_id, title, subject_id, description, graph_json, is_public, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        user.id,
        // 「（副本）」占 4 个字，60 字的合法标题直接拼会超限；先截断再拼
        `${original.title.slice(0, MAX_TITLE_LENGTH - 4)}（副本）`,
        original.subjectId,
        original.description,
        graphJson,
        false, // 副本默认私有，由用户决定是否公开
        now,
        now,
      ],
    );

    await db.run(
      /*
       * ON CONFLICT：同一用户再次选用同一个公开方向时，
       * 主键 (user_id, direction_id) 会冲突。没有这一句在 Postgres 下会抛错，
       * 而此时 directions 行已插入且无事务，会留下孤儿副本。
       */
      `INSERT INTO direction_picks (user_id, direction_id, created_at)
       VALUES ($1, $2, $3) ON CONFLICT (user_id, direction_id) DO NOTHING`,
      [user.id, body.copyFrom, now],
    );

    return NextResponse.json({ ok: true, id });
  }

  // ── 路径 1/2：从描述生成 ──
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description === "") {
    return NextResponse.json({ error: "请填写你想学什么" }, { status: 400 });
  }
  if (description.length > 500) {
    return NextResponse.json({ error: "描述过长（上限 500 字）" }, { status: 400 });
  }

  let draft: DirectionDraft | null = null;
  let source: "llm" | "existing" = "existing";

  if (body.draft !== undefined) {
    // 前端已生成并让用户确认过
    draft = coerceDraft(body.draft);
    source = "llm";
    if (!draft) {
      return NextResponse.json({ error: "草稿格式不正确" }, { status: 400 });
    }
  } else {
    // 无模型时从现有学科拼装
    draft = composeFromExisting(description);
    if (!draft) {
      return NextResponse.json(
        {
          error:
            "没有识别出匹配的学科。请更具体地描述，例如「我想系统学树结构」或「我想了解进程调度」。",
        },
        { status: 422 },
      );
    }
  }

  const issues = validateDraft(draft);
  if (issues.length > 0) {
    return NextResponse.json(
      { error: "生成的方向不合格", issues },
      { status: 422 },
    );
  }

  const key = z.string().uuid().optional().safeParse(body.draftKey);
  if (!key.success) return NextResponse.json({ error: "草稿编号无效" }, { status: 400 });
  const id = key.data ? await directionWorkspaceId(user.id, key.data) : crypto.randomUUID();
  const isPublic = body.isPublic === true;
  const direction = draftToDirection(draft, {
    id,
    userId: user.id,
    subjectId: "custom",
    isPublic,
    now,
  });

  await db.run(
    `INSERT INTO directions (id, user_id, title, subject_id, description, graph_json, is_public, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
    [
      id,
      user.id,
      direction.title,
      direction.subjectId,
      direction.description,
      JSON.stringify(direction.graph),
      isPublic,
      now,
      now,
    ],
  );

  return NextResponse.json({
    ok: true,
    id,
    source,
    conceptCount: direction.graph.concepts.length,
  });
}

interface UpdateBody {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  isPublic?: unknown;
}

/** PATCH：改标题、描述、公开状态。只有作者本人能改。 */
export async function PATCH(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: UpdateBody;
  const limited = await readLimitedText(request, MAX_DIRECTION_BODY_BYTES);
  if (!limited.ok) return limited.response;
  try {
    body = JSON.parse(limited.text) as UpdateBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (id === "") return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const db = await getDb();
  const existing = await db.one<DirectionRow>("SELECT * FROM directions WHERE id = $1", [id]);
  if (!existing) return NextResponse.json({ error: "方向不存在" }, { status: 404 });
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "只能修改自己创建的方向" }, { status: 403 });
  }

  const title =
    typeof body.title === "string" && body.title.trim() !== ""
      ? body.title.trim().slice(0, 60)
      : existing.title;
  const description =
    typeof body.description === "string" && body.description.trim() !== ""
      ? body.description.trim().slice(0, 500)
      : existing.description;
  const isPublic = typeof body.isPublic === "boolean" ? body.isPublic : existing.is_public;

  await db.run(
    `UPDATE directions SET title = $1, description = $2, graph_json = $3, is_public = $4, updated_at = $5
     WHERE id = $6 AND user_id = $7`,
    [title, description, existing.graph_json, isPublic, new Date().toISOString(), id, user.id],
  );

  return NextResponse.json({ ok: true });
}

/** DELETE：删自己的方向。 */
export async function DELETE(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (id === "") return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const db = await getDb();
  const affected = await db.run("DELETE FROM directions WHERE id = $1 AND user_id = $2", [
    id,
    user.id,
  ]);

  if (affected === 0) {
    return NextResponse.json({ error: "方向不存在或无权删除" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
