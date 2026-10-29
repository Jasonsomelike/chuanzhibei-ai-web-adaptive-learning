/**
 * ssrfGuard 的行为测试：DNS 逐条判定、钉 IP 连接、3xx 不跟随、超时与字节上限。
 *
 * 所有上游都是本机 http 服务器（127.0.0.1 临时端口），并在白名单里显式放行；
 * 域名解析用假解析器注入，不依赖真实 DNS，也不发外网请求。
 */

import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ALLOW_HTTP_PROVIDER_HOSTS_ENV,
  __setResolverForTests,
  assertUpstreamAllowed,
  guardedRequest,
  isSsrfGuardError,
  isUpstreamRequestError,
  type ResolvedAddress,
} from "@/lib/ssrfGuard";

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  savedEnv.set(ALLOW_HTTP_PROVIDER_HOSTS_ENV, process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV]);
  delete process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV];
  __setResolverForTests(null);
});

afterEach(() => {
  const previous = savedEnv.get(ALLOW_HTTP_PROVIDER_HOSTS_ENV);
  if (previous === undefined) delete process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV];
  else process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV] = previous;
  savedEnv.clear();
  __setResolverForTests(null);
});

function stubResolver(map: Record<string, readonly ResolvedAddress[]>): void {
  __setResolverForTests(async (hostname) => {
    const records = map[hostname];
    if (records === undefined) throw new Error(`ENOTFOUND ${hostname}`);
    return records;
  });
}

function address(value: string): ResolvedAddress {
  return { address: value, family: value.includes(":") ? 6 : 4 };
}

describe("assertUpstreamAllowed：解析到内网一律拒绝", () => {
  const BLOCKED: ReadonlyArray<readonly [string, string]> = [
    ["169.254.169.254", "云元数据"],
    ["198.18.0.153", "benchmark 段"],
    ["::ffff:127.0.0.1", "IPv4-mapped 环回"],
    ["64:ff9b::7f00:1", "NAT64 里包着的环回"],
    ["10.0.0.1", "私网"],
    ["fd00::1", "unique-local"],
  ];

  for (const [record, label] of BLOCKED) {
    it(`${record}（${label}）`, async () => {
      stubResolver({ "api.example.com": [address(record)] });
      const error = await assertUpstreamAllowed("https://api.example.com/v1").catch(
        (err: unknown) => err,
      );
      expect(isSsrfGuardError(error)).toBe(true);
      if (isSsrfGuardError(error)) {
        expect(error.reason).toBe("blocked-address");
        expect(error.message).toContain(record);
      }
    });
  }

  it("一条 A 记录干净、另一条落在内网，仍然整体拒绝", async () => {
    stubResolver({
      "api.example.com": [address("8.8.8.8"), address("10.0.0.7")],
    });
    await expect(assertUpstreamAllowed("https://api.example.com/v1")).rejects.toMatchObject({
      reason: "blocked-address",
    });
  });

  it("解析不到记录时拒绝（no-records）", async () => {
    stubResolver({});
    await expect(assertUpstreamAllowed("https://missing.example/v1")).rejects.toMatchObject({
      reason: "no-records",
    });
  });
});

describe("assertUpstreamAllowed：公网放行并钉住第一个地址", () => {
  it("8.8.8.8 放行，pinned 与 servername 分开", async () => {
    stubResolver({ "api.example.com": [address("8.8.8.8")] });
    const target = await assertUpstreamAllowed("https://api.example.com/v1/chat/completions");
    expect(target.hostname).toBe("api.example.com");
    expect(target.pinned).toBe("8.8.8.8");
    expect(target.servername).toBe("api.example.com");
    expect(target.url.pathname).toBe("/v1/chat/completions");
  });

  it("IP 字面量不做 DNS，也不发 SNI", async () => {
    __setResolverForTests(async () => {
      throw new Error("字面量地址不应触发 DNS");
    });
    const target = await assertUpstreamAllowed("https://8.8.8.8/v1");
    expect(target.pinned).toBe("8.8.8.8");
    expect(target.servername).toBe("");
  });

  it("IPv6 字面量的方括号会被去掉", async () => {
    const target = await assertUpstreamAllowed("https://[2001:4860:4860::8888]/v1");
    expect(target.hostname).toBe("2001:4860:4860::8888");
    expect(target.pinned).toBe("2001:4860:4860::8888");
    expect(target.servername).toBe("");
  });
});

describe("assertUpstreamAllowed：形状检查优先", () => {
  it("http 默认拒绝，且不会去解析 DNS", async () => {
    let resolved = false;
    __setResolverForTests(async () => {
      resolved = true;
      return [address("8.8.8.8")];
    });
    await expect(assertUpstreamAllowed("http://api.example.com/v1")).rejects.toMatchObject({
      reason: "url-shape",
    });
    expect(resolved).toBe(false);
  });

  it("userinfo 与云元数据主机名拒绝", async () => {
    await expect(
      assertUpstreamAllowed("https://user:pass@api.example.com/v1"),
    ).rejects.toMatchObject({ reason: "url-shape" });
    await expect(
      assertUpstreamAllowed("https://metadata.google.internal/computeMetadata/v1/"),
    ).rejects.toMatchObject({ reason: "url-shape" });
  });

  it("字面量内网地址在没有白名单时拒绝", async () => {
    await expect(assertUpstreamAllowed("https://169.254.169.254/latest/meta-data/")).rejects.toMatchObject({
      reason: "url-shape",
    });
    await expect(assertUpstreamAllowed("https://[::ffff:7f00:1]/")).rejects.toMatchObject({
      reason: "url-shape",
    });
  });
});

// ── 上机测试：本机 HTTP 服务器 ────────────────────────────────────

interface TestServer {
  readonly port: number;
  readonly server: http.Server;
  hits: string[];
  mode: "echo" | "redirect" | "slow" | "big" | "stream" | "error";
}

let current: TestServer | null = null;

async function startServer(mode: TestServer["mode"] = "echo"): Promise<TestServer> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    if (mode === "redirect") {
      res.statusCode = 302;
      res.setHeader("location", "/second");
      res.end();
      return;
    }
    if (mode === "slow") return;
    if (mode === "big") {
      res.end("x".repeat(20_000));
      return;
    }
    if (mode === "error") {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { message: "boom sk-test-secret" } }));
      return;
    }
    if (mode === "stream") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: one\n\n");
      setTimeout(() => {
        res.write("data: two\n\n");
        res.end();
      }, 5);
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          method: req.method,
          host: req.headers.host,
          acceptEncoding: req.headers["accept-encoding"],
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  current = { port, server, hits, mode };
  process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV] = `127.0.0.1:${port}`;
  return current;
}

afterEach(async () => {
  if (current !== null) {
    current.server.closeAllConnections();
    await new Promise<void>((resolve) => current?.server.close(() => resolve()));
    current = null;
  }
});

describe("guardedRequest：钉 IP 与请求头", () => {
  it("连接落在 pinned 地址，Host 保持域名，Accept-Encoding 强制 identity", async () => {
    const server = await startServer("echo");
    stubResolver({ "local.test": [address("127.0.0.1")] });
    process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV] = `local.test:${server.port}`;

    const target = await assertUpstreamAllowed(`http://local.test:${server.port}/echo`);
    expect(target.pinned).toBe("127.0.0.1");

    const response = await guardedRequest(target, {
      method: "POST",
      headers: { "content-type": "application/json", "accept-encoding": "gzip" },
      body: '{"hello":1}',
      timeoutMs: 5_000,
    });

    expect(response.status).toBe(200);
    const echoed = JSON.parse(response.body.toString("utf8")) as Record<string, string>;
    expect(echoed["host"]).toBe(`local.test:${server.port}`);
    expect(echoed["acceptEncoding"]).toBe("identity");
    expect(echoed["body"]).toBe('{"hello":1}');
    expect(echoed["method"]).toBe("POST");
  });

  it("3xx 不跟随：返回 302，且第二个地址从未被请求", async () => {
    const server = await startServer("redirect");
    const target = await assertUpstreamAllowed(`http://127.0.0.1:${server.port}/first`);
    const response = await guardedRequest(target, { method: "GET", timeoutMs: 5_000 });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/second");
    expect(server.hits).toEqual(["/first"]);
  });

  it("超时抛 timeout 并断开连接", async () => {
    const server = await startServer("slow");
    const target = await assertUpstreamAllowed(`http://127.0.0.1:${server.port}/slow`);
    const error = await guardedRequest(target, { method: "GET", timeoutMs: 120 }).catch(
      (err: unknown) => err,
    );
    expect(isUpstreamRequestError(error)).toBe(true);
    if (isUpstreamRequestError(error)) expect(error.reason).toBe("timeout");
  });

  it("超过 maxBytes 抛 too-large", async () => {
    const server = await startServer("big");
    const target = await assertUpstreamAllowed(`http://127.0.0.1:${server.port}/big`);
    const error = await guardedRequest(target, {
      method: "GET",
      timeoutMs: 5_000,
      maxBytes: 1024,
    }).catch((err: unknown) => err);
    expect(isUpstreamRequestError(error)).toBe(true);
    if (isUpstreamRequestError(error)) expect(error.reason).toBe("too-large");
  });

  it("流式模式原样转发字节，并可显式 abort", async () => {
    const server = await startServer("stream");
    const target = await assertUpstreamAllowed(`http://127.0.0.1:${server.port}/stream`);
    const response = await guardedRequest(target, {
      method: "GET",
      timeoutMs: 5_000,
      stream: true,
    });

    expect(response.status).toBe(200);
    const chunks: Buffer[] = [];
    for await (const chunk of response.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("data: one\n\ndata: two\n\n");
  });

  it("流式模式 3xx 同样不跟随", async () => {
    const server = await startServer("redirect");
    const target = await assertUpstreamAllowed(`http://127.0.0.1:${server.port}/first`);
    const response = await guardedRequest(target, {
      method: "GET",
      timeoutMs: 5_000,
      stream: true,
    });
    expect(response.status).toBe(302);
    response.abort();
    expect(server.hits).toEqual(["/first"]);
  });
});

describe("白名单：唯一允许 http 与私网的入口", () => {
  it("白名单里的 host:port 才允许 http", async () => {
    const server = await startServer("echo");
    const target = await assertUpstreamAllowed(`http://127.0.0.1:${server.port}/echo`);
    expect(target.pinned).toBe("127.0.0.1");

    // 同一台机器换个端口就不在白名单里
    await expect(assertUpstreamAllowed(`http://127.0.0.1:${server.port + 1}/echo`)).rejects.toMatchObject(
      { reason: "url-shape" },
    );
  });

  it("命中白名单的域名允许解析到私网地址", async () => {
    const server = await startServer("echo");
    stubResolver({ "local.test": [address("127.0.0.1")] });
    process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV] = `local.test:${server.port}`;

    const target = await assertUpstreamAllowed(`http://local.test:${server.port}/echo`);
    const response = await guardedRequest(target, { method: "GET", timeoutMs: 5_000 });
    expect(response.status).toBe(200);
  });

  it("不在白名单的域名解析到私网仍拒绝", async () => {
    stubResolver({ "evil.example": [address("127.0.0.1")] });
    await expect(assertUpstreamAllowed("https://evil.example/v1")).rejects.toMatchObject({
      reason: "blocked-address",
    });
  });
});
