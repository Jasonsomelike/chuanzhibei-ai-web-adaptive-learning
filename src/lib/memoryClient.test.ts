import { afterEach, describe, expect, it, vi } from "vitest";

import type { MemoryItem } from "@/lib/memory";
import {
  clearMemories,
  deleteMemory,
  pullMemories,
  pushMemories,
} from "@/lib/memoryClient";

const AT = "2026-05-01T00:00:00.000Z";

function card(overrides: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: "mem-error-q1",
    kind: "error",
    kcId: "c01",
    questionId: "q1",
    prompt: "栈的出栈顺序",
    correction: "后进先出",
    createdAt: AT,
    lastSeenAt: AT,
    status: "open",
    streak: 0,
    reviewCount: 0,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return mock;
}

function callOf(mock: ReturnType<typeof vi.fn>, index = 0): [RequestInfo | URL, RequestInit?] {
  return mock.mock.calls[index] as [RequestInfo | URL, RequestInit?];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pullMemories", () => {
  it("成功时返回清洗后的卡片，subjectId 做 URL 编码", async () => {
    const mock = stubFetch(async () =>
      jsonResponse({
        subjectId: "data-structures",
        memories: [card(), { id: "坏了" }],
      }),
    );

    const memories = await pullMemories(" data-structures ");

    expect(memories?.map((item) => item.id)).toEqual(["mem-error-q1"]);
    const [url, init] = callOf(mock);
    expect(String(url)).toBe("/api/memories?subjectId=data-structures");
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("401 返回 null，不把未登录当成「服务端没有卡」", async () => {
    stubFetch(async () => jsonResponse({ error: "unauthorized" }, 401));

    await expect(pullMemories("ds")).resolves.toBeNull();
  });

  it("网络失败返回 null，不抛错", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(pullMemories("ds")).resolves.toBeNull();
  });

  it("响应形状不对（memories 不是数组）返回 null", async () => {
    stubFetch(async () => jsonResponse({ subjectId: "ds", memories: {} }));

    await expect(pullMemories("ds")).resolves.toBeNull();
  });

  it("空 subjectId 直接返回 null，不发请求", async () => {
    const mock = stubFetch(async () => jsonResponse({ memories: [] }));

    await expect(pullMemories("   ")).resolves.toBeNull();
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("pushMemories", () => {
  it("成功时 PUT 快照并返回 true", async () => {
    const mock = stubFetch(async () => jsonResponse({ stored: 1, skippedStale: 0 }));

    await expect(pushMemories("ds", [card()])).resolves.toBe(true);

    const [url, init] = callOf(mock);
    expect(String(url)).toBe("/api/memories");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toMatchObject({ "Content-Type": "application/json" });
    const body = JSON.parse(String(init?.body)) as {
      subjectId: string;
      memories: MemoryItem[];
    };
    expect(body.subjectId).toBe("ds");
    expect(body.memories.map((item) => item.id)).toEqual(["mem-error-q1"]);
  });

  it("发送前清洗重复 id：服务端契约会拒绝重复，客户端先收口", async () => {
    const mock = stubFetch(async () => jsonResponse({ stored: 1, skippedStale: 0 }));

    await pushMemories("ds", [card(), card({ prompt: "同 id 的第二张" })]);

    const body = JSON.parse(String(callOf(mock)[1]?.body)) as { memories: MemoryItem[] };
    expect(body.memories).toHaveLength(1);
    expect(body.memories[0].prompt).toBe("栈的出栈顺序");
  });

  it("401 返回 false", async () => {
    stubFetch(async () => jsonResponse({ error: "unauthorized" }, 401));

    await expect(pushMemories("ds", [card()])).resolves.toBe(false);
  });

  it("网络失败返回 false，不抛错", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(pushMemories("ds", [card()])).resolves.toBe(false);
  });
});

describe("clearMemories", () => {
  it("DELETE 带 subjectId，成功返回 true", async () => {
    const mock = stubFetch(async () => jsonResponse({ deleted: 3 }));

    await expect(clearMemories("data-structures")).resolves.toBe(true);

    const [url, init] = callOf(mock);
    expect(String(url)).toBe("/api/memories?subjectId=data-structures");
    expect(init?.method).toBe("DELETE");
  });

  it("401 与网络失败都返回 false", async () => {
    stubFetch(async () => jsonResponse({ error: "unauthorized" }, 401));
    await expect(clearMemories("ds")).resolves.toBe(false);

    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(clearMemories("ds")).resolves.toBe(false);
  });
});

describe("deleteMemory", () => {
  it("DELETE 带 memId，成功返回 true", async () => {
    const mock = stubFetch(async () => jsonResponse({ deleted: 1 }));

    await expect(deleteMemory("mem-error-q1")).resolves.toBe(true);

    const [url, init] = callOf(mock);
    expect(String(url)).toBe("/api/memories?memId=mem-error-q1");
    expect(init?.method).toBe("DELETE");
  });

  it("401 与网络失败都返回 false", async () => {
    stubFetch(async () => jsonResponse({ error: "unauthorized" }, 401));
    await expect(deleteMemory("mem-error-q1")).resolves.toBe(false);

    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(deleteMemory("mem-error-q1")).resolves.toBe(false);
  });

  it("空 memId 不发请求", async () => {
    const mock = stubFetch(async () => jsonResponse({ deleted: 0 }));

    await expect(deleteMemory("  ")).resolves.toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });
});
