/**
 * routeAuth 的守卫语义。
 *
 * 重点是三件容易被写漏的事：
 * - 未登录必须是 401，且错误码来自 apiContracts；
 * - 写请求必须同源（没有 Origin 的 curl 也要拒）；
 * - 请求体上限必须在「读流的过程中」生效——chunked 请求没有 Content-Length，
 *   只查头等于没有上限。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    email: string;
    displayName: string;
    createdAt: string;
  },
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => authState.user,
}));

const {
  assertMutationOrigin,
  jsonError,
  readJsonObject,
  readLimitedText,
  requireApiUser,
  timingSafeEqualText,
} = await import("@/lib/routeAuth");

const USER = {
  id: "u1",
  email: "u@test.local",
  displayName: "测试用户",
  createdAt: "2026-10-29T00:00:00.000Z",
};

beforeEach(() => {
  authState.user = USER;
});

function streamRequest(
  chunks: readonly Uint8Array[],
  init: { method?: string; headers?: Record<string, string>; keepOpen?: boolean } = {},
  onCancel?: () => void,
): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (init.keepOpen !== true) controller.close();
    },
    cancel() {
      onCancel?.();
    },
  });
  const withDuplex: RequestInit & { duplex: "half" } = {
    method: init.method ?? "PUT",
    headers: { "content-type": "application/json", ...init.headers },
    body: stream,
    duplex: "half",
  };
  return new Request("http://localhost/api/test", withDuplex);
}

function jsonRequest(body: string, contentType = "application/json"): Request {
  return new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": contentType },
    body,
  });
}

describe("requireApiUser", () => {
  it("未登录返回 401 与契约错误码", async () => {
    authState.user = null;
    const guard = await requireApiUser();
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(401);
    const body = (await guard.response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("已登录返回用户本身", async () => {
    const guard = await requireApiUser();
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    expect(guard.user.id).toBe("u1");
  });
});

describe("assertMutationOrigin", () => {
  it("GET 视为安全方法，无 Origin 也放行", () => {
    const req = new Request("http://localhost/api/test", { method: "GET" });
    expect(assertMutationOrigin(req)).toBeNull();
  });

  it("写请求没有 Origin 时拒绝（curl 也不放行）", () => {
    const req = new Request("http://localhost/api/test", { method: "PUT" });
    const res = assertMutationOrigin(req);
    expect(res?.status).toBe(403);
  });

  it("Sec-Fetch-Site: cross-site 一律拒绝", () => {
    const req = new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { origin: "http://localhost", "sec-fetch-site": "cross-site" },
    });
    expect(assertMutationOrigin(req)?.status).toBe(403);
  });

  it("同源 Origin 放行", () => {
    const req = new Request("http://localhost/api/test", {
      method: "DELETE",
      headers: { origin: "http://localhost" },
    });
    expect(assertMutationOrigin(req)).toBeNull();
  });
});

describe("jsonError", () => {
  it("输出统一错误体并禁止缓存", async () => {
    const res = jsonError(413, "payload_too_large", "太大了");
    expect(res.status).toBe(413);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body).toEqual({ error: { code: "payload_too_large", message: "太大了" } });
  });
});

describe("readLimitedText", () => {
  it("无 Content-Length 的超限流在读取中被 413 拦截并 cancel", async () => {
    let cancelled = false;
    const req = streamRequest(
      [new Uint8Array(600), new Uint8Array(600)],
      { keepOpen: true },
      () => {
        cancelled = true;
      },
    );
    // 前提：这条请求真的没有 Content-Length，否则测不到流式计数
    expect(req.headers.get("content-length")).toBeNull();

    const guard = await readLimitedText(req, 1000);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(413);
    const body = (await guard.response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("payload_too_large");
    expect(cancelled).toBe(true);
  });

  it("头部声明的长度超限时直接 413，不必读完", async () => {
    const req = new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { "content-length": "999999" },
      body: "small",
    });
    const guard = await readLimitedText(req, 16);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(413);
  });

  it("正常读取并解码 UTF-8", async () => {
    const req = streamRequest([new TextEncoder().encode("你好，配置")]);
    const guard = await readLimitedText(req, 1024);
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    expect(guard.text).toBe("你好，配置");
  });

  it("非法 UTF-8 返回 400 而不是悄悄替换字符", async () => {
    const req = streamRequest([new Uint8Array([0xff, 0xfe, 0xfd])]);
    const guard = await readLimitedText(req, 1024);
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(400);
  });
});

describe("readJsonObject", () => {
  it("缺少 application/json 返回 415", async () => {
    const guard = await readJsonObject(jsonRequest("{}", "text/plain"));
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(415);
  });

  it("带 charset 的 application/json 可用", async () => {
    const guard = await readJsonObject(jsonRequest('{"a":1}', "application/json; charset=utf-8"));
    expect(guard.ok).toBe(true);
    if (!guard.ok) return;
    expect(guard.value).toEqual({ a: 1 });
  });

  it("坏 JSON 返回 400", async () => {
    const guard = await readJsonObject(jsonRequest("{a:"));
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(400);
  });

  it("数组不是 JSON 对象，返回 400", async () => {
    const guard = await readJsonObject(jsonRequest("[1,2]"));
    expect(guard.ok).toBe(false);
    if (guard.ok) return;
    expect(guard.response.status).toBe(400);
  });
});

describe("timingSafeEqualText", () => {
  it("相同为真，不同为假，长度不同也不提前返回", async () => {
    await expect(timingSafeEqualText("Bearer abc", "Bearer abc")).resolves.toBe(true);
    await expect(timingSafeEqualText("Bearer abc", "Bearer abd")).resolves.toBe(false);
    await expect(timingSafeEqualText("Bearer abc", "Bearer abcdef")).resolves.toBe(false);
    await expect(timingSafeEqualText("", "")).resolves.toBe(true);
  });
});
