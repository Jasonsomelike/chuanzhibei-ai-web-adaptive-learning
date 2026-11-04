import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { checkItem, type DirectionItem, type ItemStatus, type ItemSource } from "@/lib/itemgen";
import { borrowItems } from "@/lib/borrow";
import { MATERIAL_CHECK_PREFIX } from "@/lib/materials";
import type { Difficulty } from "@/lib/mastery";
import { assertMutationOrigin, readLimitedText } from "@/lib/routeAuth";
import { MAX_DIRECTION_ITEMS_BODY_BYTES } from "@/lib/bodyLimit";

export const runtime = "nodejs";

interface ItemRow {
  id: string;
  direction_id: string;
  kc_id: string;
  difficulty: number;
  stem: string;
  options_json: string;
  answer_index: number;
  explanation: string;
  content_hash: string;
  source: string;
  status: string;
  checks_json: string;
  created_at: string;
}

interface DirectionRow {
  id: string;
  user_id: string;
  is_public: boolean;
  graph_json?: string;
}

function rowToItem(row: ItemRow): DirectionItem {
  return {
    id: row.id,
    directionId: row.direction_id,
    kcId: row.kc_id,
    difficulty: row.difficulty as Difficulty,
    stem: row.stem,
    options: JSON.parse(row.options_json) as string[],
    answerIndex: row.answer_index,
    explanation: row.explanation,
    source: row.source as ItemSource,
    status: row.status as ItemStatus,
    checks: JSON.parse(row.checks_json) as string[],
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

/** 读方向并校验可见性。作者本人或已公开才放行。 */
async function loadVisibleDirection(
  id: string,
): Promise<{ ok: true; row: DirectionRow } | { ok: false; status: number; error: string }> {
  const db = await getDb();
  const row = await db.one<DirectionRow>(
    "SELECT * FROM directions WHERE id = $1",
    [id],
  );
  if (!row) return { ok: false, status: 404, error: "方向不存在" };
  if (row.is_public) return { ok: true, row };
  const user = await getCurrentUser();
  if (user?.id === row.user_id) return { ok: true, row };
  return { ok: false, status: 403, error: "该方向未公开" };
}

/**
 * GET ?directionId=&kcId=
 *
 * 返回该 KC 下的题。默认只给 accepted 与 practice（rejected 不展示）；
 * 传 includeRejected=1 可看被拒的题与原因，用于调试生成质量。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const directionId = (url.searchParams.get("directionId") ?? "").trim();
  const kcId = (url.searchParams.get("kcId") ?? "").trim();
  const includeRejected = url.searchParams.get("includeRejected") === "1";

  if (directionId === "") {
    return NextResponse.json({ error: "缺少 directionId" }, { status: 400 });
  }

  const access = await loadVisibleDirection(directionId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const db = await getDb();
  const rows = kcId
    ? await db.all<ItemRow>(
        "SELECT * FROM direction_items WHERE direction_id = $1 AND kc_id = $2 ORDER BY created_at",
        [directionId, kcId],
      )
    : await db.all<ItemRow>(
        "SELECT * FROM direction_items WHERE direction_id = $1 ORDER BY created_at",
        [directionId],
      );

  const items = rows
    .map(rowToItem)
    .filter((it) => includeRejected || it.status !== "rejected");

  return NextResponse.json({
    items,
    accepted: items.filter((i) => i.status === "accepted").length,
    practice: items.filter((i) => i.status === "practice").length,
  });
}

interface PostBody {
  directionId?: unknown;
  kcId?: unknown;
  /**
   * 已在前端校验过的题目。服务端会**重跑一遍**确定性校验，
   * 不信任前端结论——前端可以被改，服务端不行。
   */
  items?: unknown;
}

/**
 * POST：批量落库。
 *
 * 服务端重跑 L2/L3（不重跑 L4，那需要再调模型，成本高且结论不可缓存）。
 * 因此前端必须把 L4 的结果体现在 status 上：L4 不一致的题前端标 practice，
 * 服务端校验通过后仍保留 practice，不会被提升成 accepted。
 */
export async function POST(request: Request) {
  const origin = assertMutationOrigin(request);
  if (origin) return origin;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: PostBody;
  const limited = await readLimitedText(request, MAX_DIRECTION_ITEMS_BODY_BYTES);
  if (!limited.ok) return limited.response;
  try {
    body = JSON.parse(limited.text) as PostBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const directionId = typeof body.directionId === "string" ? body.directionId : "";
  const kcId = typeof body.kcId === "string" ? body.kcId : "";
  if (directionId === "" || kcId === "") {
    return NextResponse.json({ error: "缺少 directionId 或 kcId" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items 必须是非空数组" }, { status: 400 });
  }
  if (body.items.length > 8) {
    return NextResponse.json({ error: "一次最多提交 8 题" }, { status: 400 });
  }

  const access = await loadVisibleDirection(directionId);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (access.row.user_id !== user.id) {
    return NextResponse.json({ error: "只能往自己的方向里加题" }, { status: 403 });
  }

  const db = await getDb();
  const existing = await db.all<ItemRow>(
    "SELECT * FROM direction_items WHERE direction_id = $1 AND kc_id = $2",
    [directionId, kcId],
  );
  const seenStems = new Set(
    existing.map((r) => r.stem.replace(/\s+/g, "").toLowerCase()),
  );
  const now = new Date().toISOString();
  const inserted: DirectionItem[] = [];
  const rejected: { stem: string; issues: string[] }[] = [];
  /** 唯一约束命中的条数。与 rejected 分开：已存在的题既不是失败也不是新增。 */
  let skipped = 0;

  for (const candidate of body.items) {
    const raw = candidate as {
      difficulty?: unknown;
      difficultyReason?: unknown;
      stem?: unknown;
      options?: unknown;
      answerText?: unknown;
      explanation?: unknown;
      source?: unknown;
      status?: unknown;
      checks?: unknown;
    };

    /*
     * source 决定诊断页的折扣（generated 打 0.8，manual/borrowed 不打折），
     * 所以它不能完全由客户端说了算。约束：
     *   - manual：必须没有 difficultyReason。那是生成流程才会产出的字段，
     *     带着它却声称 manual，就是想把生成题洗成不打折的。
     *   - borrowed：题干必须能在内置题库里找到同名知识点下的同一道题，
     *     否则只是客户端自己编的 source。
     *   - 其余一律按 generated 处理（更严格，且打 0.8 折）。
     */
    const claimedSource: ItemSource =
      raw.source === "manual" ? "manual" : raw.source === "borrowed" ? "borrowed" : "generated";
    const hasModelReason =
      typeof raw.difficultyReason === "string" && raw.difficultyReason.trim() !== "";

    const source: ItemSource =
      claimedSource === "manual" && !hasModelReason ? "manual" : "generated";

    /** 借用题的真实难度（1–5）；非借用路径保持 null。 */
    let borrowedDifficulty: 1 | 2 | 3 | 4 | 5 | null = null;

    if (claimedSource === "borrowed") {
      /*
       * 借用必须能被服务端独立复算：拿方向图里这个 KC 的名字去内置题库找同名点，
       * 题干也必须真的出现在那里。否则「borrowed」只是客户端自己写的字符串，
       * 却能绕过 0.8 折扣。
       */
      const stem = typeof raw.stem === "string" ? raw.stem.trim() : "";
      let conceptName = "";
      try {
        const graph = JSON.parse(access.row.graph_json ?? "{}") as {
          concepts?: { id: string; name: string }[];
        };
        conceptName = graph.concepts?.find((c) => c.id === kcId)?.name ?? "";
      } catch {
        conceptName = "";
      }
      const found = conceptName
        ? borrowItems(
            { id: kcId, name: conceptName, summary: "", chapter: "" },
            { directionId, now },
          )
        : [];
      const matched = found.find((b) => b.stem === stem);
      if (!matched) {
        rejected.push({
          stem: stem.slice(0, 40),
          issues: ["声称借用自内置题库，但内置题库里找不到同名知识点下的这道题"],
        });
        continue;
      }
      /*
       * 借用题的难度以内置题库为准，不采信客户端的三档映射。
       * 三档只有 2/3/4，会把难度 1 抬成 3、把难度 5 压成 4，
       * 而掌握度的权重 w=0.5+0.25d 对难度敏感，抬一档就多算了证据。
       */
      borrowedDifficulty = matched.difficulty;
    }

    const normalized = {
      difficulty: (raw.difficulty === "basic" || raw.difficulty === "advanced" || raw.difficulty === "challenge"
        ? raw.difficulty
        : "advanced") as "basic" | "advanced" | "challenge",
      difficultyReason: typeof raw.difficultyReason === "string" ? raw.difficultyReason : undefined,
      stem: typeof raw.stem === "string" ? raw.stem : "",
      options: Array.isArray(raw.options) ? raw.options.filter((o): o is string => typeof o === "string") : [],
      answerText: typeof raw.answerText === "string" ? raw.answerText : "",
      explanation: typeof raw.explanation === "string" ? raw.explanation : "",
    };

    const { item, issues } = checkItem(normalized, {
      directionId,
      kcId,
      now,
      seenStems,
    });


    // 结构问题（选项不足 4 个等）直接拒，连 practice 都不算
    if (normalized.options.length !== 4) {
      rejected.push({ stem: normalized.stem.slice(0, 40), issues: ["选项数量不是 4"] });
      continue;
    }

    const status: ItemStatus =
      item.status === "accepted" && (raw.status === "practice" || raw.status === "accepted")
        ? (raw.status as ItemStatus)
        : item.status;

    /*
     * 前端声称的 checks 不采信，只保留两类服务端无法重跑的结论：
     *   - 「双解校验」：需要再调两次模型，成本高
     *   - 「依据核对…」：L6 只读核对，含通过、未通过、未完成三种
     *   - 「依据：…」：教材 / 讲义出处，只影响展示
     * 依据与核对结论都不参与 source / status / 折扣的任何判定，
     * 编造一条最多让界面多显示一行字，不会让题变成可计证据的高分题。
     * status 仍由客户端显式 practice 保留（见上），所以 L6 未过的题
     * 落库后仍是 practice，不计证据。
     */
    const clientChecks = Array.isArray(raw.checks)
      ? raw.checks.filter(
          (c): c is string =>
            typeof c === "string" &&
            (c === "双解校验" || c.startsWith("依据核对") || c.startsWith(MATERIAL_CHECK_PREFIX)),
        )
      : [];

    /*
     * rejected 的题不落库。
     * 落库没有意义（界面永不展示），还会占住 UNIQUE(direction_id, content_hash)：
     * 同一题干第二次生成时会被当成「已存在」而跳过，等于永久封死这道题。
     */
    if (status === "rejected") {
      rejected.push({ stem: item.stem.slice(0, 40), issues: [...issues] });
      continue;
    }

    const finalItem: DirectionItem = {
      ...item,
      /*
       * 借用题的难度以内置题库为准，覆盖三档映射的结果。
       * 三档只有 2/3/4，会把难度 1 抬成 3、把难度 5 压成 4；
       * 掌握度权重 w=0.5+0.25d 对难度敏感，抬一档就多算了证据。
       */
      difficulty: borrowedDifficulty !== null ? borrowedDifficulty : item.difficulty,
      source,
      status,
      checks: [...item.checks, ...clientChecks],
    };

    const affected = await db.run(
      `INSERT INTO direction_items
         (id, direction_id, kc_id, difficulty, stem, options_json, answer_index, explanation,
          content_hash, source, status, checks_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (direction_id, content_hash) DO NOTHING`,
      [
        finalItem.id,
        directionId,
        kcId,
        finalItem.difficulty,
        finalItem.stem,
        JSON.stringify(finalItem.options),
        finalItem.answerIndex,
        finalItem.explanation,
        finalItem.contentHash,
        finalItem.source,
        finalItem.status,
        JSON.stringify(finalItem.checks),
        now,
      ],
    );

    seenStems.add(normalized.stem.replace(/\s+/g, "").toLowerCase());
    if (affected > 0) {
      inserted.push(finalItem);
      /*
       * rejected 数组只放「没落库」的题，与 inserted 互斥。
       * 曾经把已插入的 practice 也塞进来，响应语义自相矛盾：
       * 客户端无法判断这道题到底存没存。
       */
      if (issues.length > 0) {
        rejected.push({ stem: finalItem.stem.slice(0, 40), issues: [...issues] });
      }
    } else {
      // 唯一约束命中：题已在库里，不算失败，但也不该进 inserted
      skipped += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    inserted: inserted.length,
    skipped,
    accepted: inserted.filter((i) => i.status === "accepted").length,
    practice: inserted.filter((i) => i.status === "practice").length,
    rejected,
    items: inserted,
  });
}
