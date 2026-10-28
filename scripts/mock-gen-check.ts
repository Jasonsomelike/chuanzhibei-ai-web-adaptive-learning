/**
 * 生成链路集成检查：真实 ensureItems + 可控 mock 供应商。
 *
 * 不依赖数据库与 Next 服务：/api/directions/items 由本脚本 stub 掉，
 * 模型请求全部发往本地 mock。检查的内容：
 *   1. normal 档：4 accepted，每题同时带「双解校验」与依据
 *   2. shuffle 档：answers 数组倒序时仍按 index 归位 → 4 accepted、error 为 null
 *   3. 依据标注随每道题进入 checks（payload 与落库回显两处）
 *   4. badsolve 档：反转批次答错第 3、4 题 → 2 accepted + 2 practice，且报门槛不足
 *   5. 哨兵：按数组顺序取答案会让 compareSolverAnswers 全 false（缺陷 3 的回归）
 *   6. truncate 档：callChat 抛 ChatError(kind=truncated)；ensureItems 会吞掉异常，不能在那里断言
 *   7. dupstem 档：同批重复题干被 L2 拒掉，不能凑够 4 题
 *   8. badjson 档：两次都不可解析时报「模型输出无法解析」，而不是静默 0 题
 *
 * 运行：node node_modules/tsx/dist/cli.mjs scripts/mock-gen-check.ts
 */

import { startMockProvider } from "./mock-provider";
import { ensureItems } from "../src/lib/directionItems";
import { callChat, ChatError } from "../src/lib/chat";
import { compareSolverAnswers } from "../src/lib/itemgen";
import { knowledgeGraph } from "../src/data/knowledge-graph";
import { dataStructuresMaterialPack } from "../src/data/materials/data-structures";
import {
  MATERIAL_CHECK_PREFIX,
  buildMaterialContext,
  materialCheckLabel,
} from "../src/lib/materials";
import type { ProviderConfig } from "../src/lib/provider";

interface StubItemBody {
  readonly difficulty?: unknown;
  readonly stem?: unknown;
  readonly options?: unknown;
  readonly answerText?: unknown;
  readonly explanation?: unknown;
  readonly source?: unknown;
  readonly status?: unknown;
  readonly checks?: unknown;
}

interface StubPostBody {
  readonly directionId?: unknown;
  readonly kcId?: unknown;
  readonly items?: unknown;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** 把提交的题补成 DirectionItem 的形状，模拟服务端落库后的回显。 */
function toDirectionItem(
  raw: StubItemBody,
  directionId: string,
  kcId: string,
  now: string,
  index: number,
): Record<string, unknown> {
  const options = Array.isArray(raw.options)
    ? raw.options.filter((o): o is string => typeof o === "string")
    : [];
  const answerText = typeof raw.answerText === "string" ? raw.answerText : "";
  const difficulty = raw.difficulty === "basic" ? 2 : raw.difficulty === "challenge" ? 4 : 3;

  return {
    id: `mock-${index}`,
    directionId,
    kcId,
    difficulty,
    stem: typeof raw.stem === "string" ? raw.stem : "",
    options,
    answerIndex: Math.max(0, options.indexOf(answerText)),
    explanation: typeof raw.explanation === "string" ? raw.explanation : "",
    source: raw.source === "manual" || raw.source === "borrowed" ? raw.source : "generated",
    status: raw.status === "practice" || raw.status === "rejected" ? raw.status : "accepted",
    checks: Array.isArray(raw.checks)
      ? raw.checks.filter((c): c is string => typeof c === "string")
      : [],
    contentHash: `mock-hash-${now}-${index}`,
    createdAt: now,
  };
}

interface FetchStub {
  /** 批解响应里的原始 answers（数组顺序，未按 index 归位），供哨兵使用。 */
  readonly recordedAnswers: () => readonly string[][];
  readonly resetRecords: () => void;
  readonly restore: () => void;
}

/**
 * 只拦 /api/directions/items；其余请求透传给真实 fetch（本地 mock）。
 * 透传时顺带记录批解响应，避免为了拿「原始 answers」再加一个旁路接口。
 */
function installFetchStub(): FetchStub {
  const realFetch = globalThis.fetch;
  let recorded: string[][] = [];

  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("/api/directions/items")) {
      if ((init?.method ?? "GET").toUpperCase() !== "POST") {
        return jsonResponse({ items: [] });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as StubPostBody;
      const directionId = typeof body.directionId === "string" ? body.directionId : "";
      const kcId = typeof body.kcId === "string" ? body.kcId : "";
      const submitted = Array.isArray(body.items) ? (body.items as StubItemBody[]) : [];
      const now = new Date().toISOString();
      const items = submitted.map((item, i) => toDirectionItem(item, directionId, kcId, now, i));
      return jsonResponse({
        ok: true,
        inserted: items.length,
        skipped: 0,
        accepted: items.filter((i) => i.status === "accepted").length,
        practice: items.filter((i) => i.status === "practice").length,
        rejected: [],
        items,
      });
    }

    const res = await realFetch(input, init);
    try {
      const json = (await res.clone().json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        const parsed = JSON.parse(content) as { answers?: unknown };
        if (Array.isArray(parsed.answers)) {
          recorded.push(
            parsed.answers.map((entry) => {
              const e = entry as { answerText?: unknown };
              return typeof e.answerText === "string" ? e.answerText : "";
            }),
          );
        }
      }
    } catch {
      // 非 JSON 响应（或空响应体）不记录
    }
    return res;
  };

  globalThis.fetch = stub as typeof fetch;

  return {
    recordedAnswers: () => recorded,
    resetRecords: () => {
      recorded = [];
    },
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

async function main(): Promise<number> {
  let failures = 0;
  const check = (name: string, ok: boolean, detail = ""): void => {
    if (ok) {
      console.log(`PASS ${name}`);
    } else {
      failures += 1;
      console.log(`FAIL ${name}${detail === "" ? "" : `：${detail}`}`);
    }
  };

  const concept = knowledgeGraph.concepts.find((c) => c.id === "c09");
  if (!concept) {
    check("找到数据结构包的 c09 知识点", false, "知识图谱里没有 c09");
    return failures;
  }

  const mock = await startMockProvider({ port: 0 });
  const stub = installFetchStub();

  try {
    /*
     * 必须显式选中来源：sourceIds 是过滤条件，空选择等于「模型通用知识」，
     * 拿不到任何片段，也就没有「依据：」可断言。
     */
    const materialSelection = {
      sourceIds: dataStructuresMaterialPack.sources.map((s) => s.id),
      resolutions: {},
    };
    const context = buildMaterialContext(dataStructuresMaterialPack, [concept], materialSelection);
    const checkLabel = materialCheckLabel(context.citations);
    check("资料上下文覆盖 c09", context.coveredKcIds.includes("c09"), JSON.stringify(context.missingKcIds));
    check(
      "依据标注以「依据：」开头",
      checkLabel.startsWith(MATERIAL_CHECK_PREFIX),
      checkLabel,
    );

    const providerFor = (mode: string): ProviderConfig => ({
      label: `mock-${mode}`,
      kind: "openai-compatible",
      baseUrl: mode === "normal" ? `${mock.url}/v1` : `${mock.url}/${mode}/v1`,
      apiKey: "mock-test-key",
      model: "mock-model",
    });

    const base = {
      directionId: "mock-direction",
      concept,
      material: { context: context.text, checkLabel },
    };

    // ── 第一轮：shuffle，数组倒序但 index 正确 ──
    stub.resetRecords();
    const shuffle = await ensureItems({ ...base, provider: providerFor("shuffle") });
    const shuffleAccepted = shuffle.items.filter((i) => i.status === "accepted").length;
    const shufflePractice = shuffle.items.filter((i) => i.status === "practice").length;
    check(
      "shuffle：4 题全部 accepted",
      shuffleAccepted === 4 && shuffle.items.length === 4,
      `accepted=${shuffleAccepted} practice=${shufflePractice}`,
    );
    check("shuffle：error 为 null", shuffle.error === null, String(shuffle.error));
    check(
      "shuffle：每题 checks 带依据",
      shuffle.items.every((i) => i.checks.some((c) => c.startsWith(MATERIAL_CHECK_PREFIX))),
      JSON.stringify(shuffle.items.map((i) => i.checks)),
    );

    /*
     * 缺陷 3 的哨兵：mock 返回的 answers 是倒序数组。
     * 若按数组顺序当题号（旧行为），四道题会整体错位，
     * compareSolverAnswers 必须全部判 false——这正说明必须按 index 落槽。
     */
    const recorded = stub.recordedAnswers();
    check("shuffle：捕获两次批解的原始 answers", recorded.length === 2, `收到 ${recorded.length} 次`);
    const expectedByIndex = shuffle.items.map((item) => item.options[item.answerIndex] ?? "");
    const naive = recorded[0] ?? [];
    const naiveVerdict = compareSolverAnswers(expectedByIndex, naive, naive);
    check(
      "哨兵：按数组顺序取答案会让全部题判不一致",
      naiveVerdict.length === 4 && naiveVerdict.every((v) => v === false),
      naiveVerdict.map(String).join(","),
    );

    // ── 第二轮：badsolve，反转批次里第 3、4 题答错 ──
    const badsolve = await ensureItems({ ...base, provider: providerFor("badsolve") });
    const badAccepted = badsolve.items.filter((i) => i.status === "accepted").length;
    const badPractice = badsolve.items.filter((i) => i.status === "practice").length;
    check("badsolve：2 accepted", badAccepted === 2, `accepted=${badAccepted}`);
    check("badsolve：2 practice（双解不一致降级）", badPractice === 2, `practice=${badPractice}`);
    check(
      "badsolve：error 报「未达到 4 题门槛」",
      badsolve.error !== null && badsolve.error.includes("未达到 4 题门槛"),
      String(badsolve.error),
    );

    // ── dupstem：同批重复题干必须被 L2 拒掉 ──
    const dupstem = await ensureItems({ ...base, provider: providerFor("dupstem") });
    const dupAccepted = dupstem.items.filter((i) => i.status === "accepted").length;
    const dupRejected = dupstem.items.filter((i) => i.status === "rejected").length;
    check(
      "dupstem：重复题干被拒 1 题，本批凑不够 4 题",
      dupRejected === 1 && dupAccepted < 4,
      `accepted=${dupAccepted} rejected=${dupRejected}`,
    );
    /*
     * rejects 的具体原因只存在 batch 的 issues 里、不落库，所以用「哪些检查项缺失」定位：
     * 被拒的那题其它项都通过、唯独没有「题干未重复」，说明走的正是去重规则。
     */
    check(
      "dupstem：被拒处唯一缺失的检查项是「题干未重复」",
      dupstem.items.some(
        (i) =>
          i.status === "rejected" &&
          !i.checks.includes("题干未重复") &&
          i.checks.includes("题干长度") &&
          i.checks.includes("选项互异") &&
          i.checks.includes("答案唯一匹配"),
      ),
      JSON.stringify(dupstem.items.map((i) => ({ s: i.status, c: i.checks }))),
    );
    check(
      "dupstem：error 报「未达到 4 题门槛」",
      dupstem.error !== null && dupstem.error.includes("未达到 4 题门槛"),
      String(dupstem.error),
    );

    // ── badjson：两次都不可解析，必须报错而不是静默 0 题 ──
    const badjson = await ensureItems({ ...base, provider: providerFor("badjson") });
    check(
      "badjson：0 题生成",
      badjson.generated === 0 && badjson.items.length === 0,
      `generated=${badjson.generated} items=${badjson.items.length}`,
    );
    check(
      "badjson：error 报「模型输出无法解析」",
      badjson.error !== null && badjson.error.includes("模型输出无法解析"),
      String(badjson.error),
    );

    // ── normal：正常档必须真的被走过，且 L4 与依据两条 check 都在 ──
    const normal = await ensureItems({ ...base, provider: providerFor("normal") });
    const normalAccepted = normal.items.filter((i) => i.status === "accepted").length;
    check("normal：4 题全部 accepted", normalAccepted === 4, `accepted=${normalAccepted}`);
    check(
      "normal：每题带「双解校验」",
      normal.items.length > 0 && normal.items.every((i) => i.checks.includes("双解校验")),
      JSON.stringify(normal.items.map((i) => i.checks)),
    );
    check(
      "normal：每题带依据",
      normal.items.every((i) => i.checks.some((c) => c.startsWith(MATERIAL_CHECK_PREFIX))),
      JSON.stringify(normal.items.map((i) => i.checks)),
    );

    // ── truncate：ensureItems 会吞异常，这里直接对 callChat 断言 ──
    let truncated: unknown = null;
    try {
      await callChat(providerFor("truncate"), {
        system: "生成链路集成检查",
        user: "请返回一个 JSON 对象",
        jsonMode: true,
        timeoutMs: 5000,
      });
    } catch (err) {
      truncated = err;
    }
    check(
      "truncate：callChat 抛 ChatError(kind=truncated)",
      truncated instanceof ChatError && truncated.kind === "truncated",
      truncated instanceof Error ? `${truncated.name}: ${truncated.message}` : String(truncated),
    );
  } finally {
    stub.restore();
    await mock.close();
  }

  return failures;
}

try {
  const failures = await main();
  console.log(failures === 0 ? "全部检查通过。" : `失败 ${failures} 项。`);
  // 用 exitCode 而不是 process.exit：Windows 上在 net handle 关闭过程中强退
  // 会触发 libuv 的 UV_HANDLE_CLOSING 断言，把成功的退出码变成 127
  process.exitCode = failures === 0 ? 0 : 1;
} catch (err) {
  console.log(`FAIL 脚本异常：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
}
