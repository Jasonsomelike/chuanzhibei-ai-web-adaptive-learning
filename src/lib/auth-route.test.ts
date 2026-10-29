import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /api/auth 的入口守卫。
 *
 * 登录/注册本身不需要登录，所以它是 pre-auth 攻击面：这里验证
 * - 写请求必须同源（跨站与不带 Origin 的 curl 都 403）；
 * - 请求体在解析前就被限量，300KB 直接 413（不再整包读进内存）。
 *
 * 业务分支只做最基本的往返，具体校验规则由 auth.test.ts 覆盖。
 */

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  setSessionCookie: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: h.getCurrentUser,
  register: h.register,
  login: h.login,
  logout: h.logout,
  setSessionCookie: h.setSessionCookie,
}));

const { GET, POST } = await import("../../app/api/auth/route");

const USER = {
  id: "u1",
  email: "u@test.local",
  displayName: "测试用户",
  createdAt: "2026-10-29T00:00:00.000Z",
};

interface RequestOptions {
  /** null 表示完全不发 Origin，模拟 curl。 */
  readonly origin?: string | null;
  readonly contentType?: string;
  readonly body?: string;
}

function postRequest(payload: unknown, options: RequestOptions = {}): Request {
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json",
  };
  if (options.origin !== null) headers.origin = options.origin ?? "http://localhost";

  return new Request("http://localhost/api/auth", {
    method: "POST",
    headers,
    body: options.body ?? JSON.stringify(payload),
  });
}

beforeEach(() => {
  for (const mock of [
    h.getCurrentUser,
    h.register,
    h.login,
    h.logout,
    h.setSessionCookie,
  ]) {
    mock.mockReset();
  }
  h.getCurrentUser.mockResolvedValue(null);
  h.login.mockResolvedValue({ ok: true, token: "t-login", user: USER });
  h.register.mockResolvedValue({ ok: true, token: "t-register", user: USER });
  h.logout.mockResolvedValue(undefined);
  h.setSessionCookie.mockResolvedValue(undefined);
});

describe("POST /api/auth 的入口守卫", () => {
  it("300KB 请求体在解析前返回 413", async () => {
    const res = await POST(
      postRequest({
        action: "login",
        email: "u@test.local",
        password: "x".repeat(300 * 1024),
      }),
    );

    expect(res.status).toBe(413);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("payload_too_large");
    expect(h.login).not.toHaveBeenCalled();
  });

  it("chunked 请求没有 Content-Length 也按流量计数拦截", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(request.headers.get("content-length")).toBeNull();

    const res = await POST(request);
    expect(res.status).toBe(413);
  });

  it("跨站 Origin 返回 403，且不调用登录", async () => {
    const res = await POST(
      postRequest(
        { action: "login", email: "u@test.local", password: "pw" },
        { origin: "https://evil.example" },
      ),
    );

    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("forbidden");
    expect(h.login).not.toHaveBeenCalled();
  });

  it("不带 Origin 的写请求返回 403（服务端 curl 也不放行）", async () => {
    const res = await POST(
      postRequest({ action: "login", email: "u@test.local", password: "pw" }, { origin: null }),
    );

    expect(res.status).toBe(403);
    expect(h.login).not.toHaveBeenCalled();
  });

  it("同源登录成功会写会话 Cookie", async () => {
    const res = await POST(
      postRequest({ action: "login", email: "u@test.local", password: "pw" }),
    );

    expect(res.status).toBe(200);
    expect(h.login).toHaveBeenCalledWith("u@test.local", "pw");
    expect(h.setSessionCookie).toHaveBeenCalledWith("t-login");
  });

  it("同源注册成功会写会话 Cookie", async () => {
    const res = await POST(
      postRequest({
        action: "register",
        email: "u@test.local",
        password: "pw",
        displayName: "测试",
      }),
    );

    expect(res.status).toBe(200);
    expect(h.register).toHaveBeenCalledWith("u@test.local", "pw", "测试");
    expect(h.setSessionCookie).toHaveBeenCalledWith("t-register");
  });

  it("坏 JSON 返回 400，非对象 JSON 也返回 400", async () => {
    const bad = await POST(postRequest(null, { body: "{oops" }));
    expect(bad.status).toBe(400);

    const array = await POST(postRequest([1, 2]));
    expect(array.status).toBe(400);
    expect(h.login).not.toHaveBeenCalled();
  });
});

describe("GET /api/auth", () => {
  it("未登录返回 user:null", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ user: null });
  });
});
