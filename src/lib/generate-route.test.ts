import { describe, expect, it } from "vitest";

/**
 * /api/directions/generate 的入口守卫与两条生成路径。
 *
 * 这个接口不要求登录，却会解析前端直连模型带回的整段 JSON，是最典型的
 * pre-auth 写入口：必须同源、必须在解析前限量。
 */

const { GET, POST } = await import("../../app/api/directions/generate/route");

const VALID_DRAFT = {
  title: "树结构入门",
  description: "从基本概念到平衡树",
  concepts: [
    { id: "k1", name: "树的基本概念", summary: "结点、度、层次" },
    { id: "k2", name: "二叉树", summary: "左右孩子" },
    { id: "k3", name: "二叉树遍历", summary: "先中后序" },
    { id: "k4", name: "二叉排序树", summary: "中序有序" },
    { id: "k5", name: "平衡二叉树", summary: "平衡因子与旋转" },
  ],
  edges: [
    { before: "k1", after: "k2" },
    { before: "k2", after: "k3" },
    { before: "k3", after: "k4" },
    { before: "k4", after: "k5" },
  ],
};

interface RequestOptions {
  /** null 表示完全不发 Origin，模拟 curl。 */
  readonly origin?: string | null;
}

function postRequest(payload: unknown, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.origin !== null) headers.origin = options.origin ?? "http://localhost";
  return new Request("http://localhost/api/directions/generate", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

describe("POST /api/directions/generate 的入口守卫", () => {
  it("300KB 请求体在解析前返回 413", async () => {
    const res = await POST(
      postRequest({ description: "树结构", rawModelOutput: "x".repeat(300 * 1024) }),
    );

    expect(res.status).toBe(413);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("payload_too_large");
  });

  it("跨站 Origin 返回 403", async () => {
    const res = await POST(
      postRequest({ description: "树结构" }, { origin: "https://evil.example" }),
    );

    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("forbidden");
  });

  it("不带 Origin 的写请求返回 403", async () => {
    const res = await POST(postRequest({ description: "树结构" }, { origin: null }));
    expect(res.status).toBe(403);
  });

  it("坏 JSON 返回 400", async () => {
    const request = new Request("http://localhost/api/directions/generate", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: "{oops",
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/directions/generate 的生成路径", () => {
  it("无 rawModelOutput 时用规则拼装，返回 source=existing", async () => {
    const res = await POST(postRequest({ description: "我想系统学树结构" }));

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      source: string;
      draft: { title: string; concepts: unknown[] };
    };
    expect(data.source).toBe("existing");
    expect(data.draft.concepts.length).toBeGreaterThanOrEqual(5);
  });

  it("带合法的 rawModelOutput 时校验后返回 source=llm", async () => {
    const res = await POST(
      postRequest({
        description: "树结构",
        rawModelOutput: JSON.stringify(VALID_DRAFT),
      }),
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { source: string; draft: { title: string } };
    expect(data.source).toBe("llm");
    expect(data.draft.title).toBe("树结构入门");
  });

  it("非法草稿返回 422 并带 issues", async () => {
    const res = await POST(
      postRequest({
        description: "树结构",
        rawModelOutput: JSON.stringify({ title: "环", concepts: [], edges: [] }),
      }),
    );

    expect(res.status).toBe(422);
  });

  it("空描述返回 400", async () => {
    const res = await POST(postRequest({ description: "   " }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/directions/generate", () => {
  it("返回系统提示词与知识点数量限制", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      systemPrompt: string;
      limits: { minConcepts: number; maxConcepts: number };
    };
    expect(data.systemPrompt.length).toBeGreaterThan(0);
    expect(data.limits.minConcepts).toBeGreaterThan(0);
  });
});
