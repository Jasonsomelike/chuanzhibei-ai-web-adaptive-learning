/**
 * SSRF 防护的落地层：URL 形状检查 + DNS 解析 + 连接钉在解析出的 IP 上。
 *
 * 纯判定在 ssrf.ts（不做 IO）。这里补上两件纯函数做不到的事：
 * 1. 解析主机名并逐条判定 A/AAAA，任一条落在内网就整体拒绝；
 * 2. 连接时用自定义 lookup 直接返回已判定的 IP，避免「判定用一次解析、连接用另一次解析」
 *    的 DNS rebinding 窗口。证书校验的 SNI 仍用原主机名，Host 头也保持原主机名。
 *
 * 唯一的上游放行口是环境变量 ALP_ALLOW_HTTP_PROVIDER_HOSTS（逗号分隔 host[:port]）：
 * 命中它的目标允许 http，且允许解析到私网地址。它只用于自建/本地模型端点，
 * 不是「关闭 SSRF 防护」的开关——其他目标仍逐条检查。
 *
 * 本文件只提供传给鉴权/代理层的传输原语，不读环境变量以外的配置，也不发任何
 * 业务请求；重定向一律不跟随（node:http 本来就不跟随，这里显式把 3xx 交给调用方）。
 */

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";
import { PassThrough, type Readable } from "node:stream";

import { checkUrlShape, classifyAddress, isBlockedAddress } from "@/lib/ssrf";

/** 允许 http 与私网地址的 host 白名单。这是本项目唯一的相关开关。 */
export const ALLOW_HTTP_PROVIDER_HOSTS_ENV = "ALP_ALLOW_HTTP_PROVIDER_HOSTS";

/** 默认响应体上限。非流式与流式共用，调用方可按接口另给。 */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

export interface AllowedTarget {
  /** 通过形状检查的完整 URL；请求路径直接取自这里。 */
  readonly url: URL;
  /** 去掉方括号的主机名（IPv6 字面量也能直接提交给 net）。 */
  readonly hostname: string;
  /** 已判定为公网（或白名单放行）的 IP。连接只会连它。 */
  readonly pinned: string;
  /** TLS SNI 使用的名字。IP 字面量时为空串，此时不发送 SNI。 */
  readonly servername: string;
}

export type SsrfReason = "url-shape" | "no-records" | "blocked-address";

export class SsrfGuardError extends Error {
  readonly reason: SsrfReason;

  constructor(reason: SsrfReason, message: string) {
    super(message);
    this.name = "SsrfGuardError";
    this.reason = reason;
  }
}

export function isSsrfGuardError(value: unknown): value is SsrfGuardError {
  return value instanceof SsrfGuardError;
}

export type UpstreamFailure = "timeout" | "too-large" | "aborted" | "network";

export class UpstreamRequestError extends Error {
  readonly reason: UpstreamFailure;

  constructor(reason: UpstreamFailure, message: string) {
    super(message);
    this.name = "UpstreamRequestError";
    this.reason = reason;
  }
}

export function isUpstreamRequestError(value: unknown): value is UpstreamRequestError {
  return value instanceof UpstreamRequestError;
}

// ── 环境白名单 ────────────────────────────────────────────────────

/** 解析 ALP_ALLOW_HTTP_PROVIDER_HOSTS；返回原样条目（空串已剔除）。 */
export function allowHttpProviderHosts(): string[] {
  const raw = process.env[ALLOW_HTTP_PROVIDER_HOSTS_ENV] ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

interface AllowEntry {
  /** 小写、去方括号。 */
  readonly host: string;
  /** null 表示条目没写端口，此时任意端口都算命中。 */
  readonly port: string | null;
}

/**
 * 解析一条白名单。允许 `host`、`host:port`、`http://host:port/path` 三种写法；
 * 端口写成默认值（80/443）时仍按写了的端口比较，与 checkUrlShape 的语义一致。
 */
function parseAllowEntry(entry: string): AllowEntry | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(entry) ? entry : `http://${entry}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "") return null;
  return { host, port: url.port === "" ? null : url.port };
}

function isAllowlisted(url: URL, entries: readonly string[]): boolean {
  if (entries.length === 0) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  for (const entry of entries) {
    const parsed = parseAllowEntry(entry);
    if (parsed === null) continue;
    if (parsed.host !== host) continue;
    if (parsed.port === null || parsed.port === port) return true;
  }
  return false;
}

// ── DNS 解析（测试可替换） ────────────────────────────────────────

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export type HostResolver = (
  hostname: string,
  options: { readonly all: true; readonly verbatim: true },
) => Promise<readonly ResolvedAddress[]>;

const defaultResolver: HostResolver = (hostname, options) => dnsLookup(hostname, options);

let resolver: HostResolver = defaultResolver;

/** 测试用：注入一个假解析器；传 null 恢复真实 DNS。 */
export function __setResolverForTests(fn: HostResolver | null): void {
  resolver = fn ?? defaultResolver;
}

// ── 目标判定 ──────────────────────────────────────────────────────

/**
 * 校验一个上游地址并返回可钉住的目标。
 *
 * 顺序固定：形状 → 字面量地址 → DNS → 逐条地址。形状检查失败时，如果该
 * host:port 在白名单里且失败原因是「字面量内网地址」，则继续解析（本地
 * 模型端点常写 127.0.0.1）；其他失败原因仍然拒绝。
 */
export async function assertUpstreamAllowed(raw: string): Promise<AllowedTarget> {
  const entries = allowHttpProviderHosts();
  const shape = checkUrlShape(raw, { allowHttpHosts: entries });

  let url: URL;
  if (shape.ok) {
    url = shape.url;
  } else {
    const allowlisted = shape.reason === "blocked-address" && isAllowlistedUrl(raw, entries);
    if (!allowlisted) throw new SsrfGuardError("url-shape", shape.detail);
    try {
      url = new URL(raw);
    } catch {
      throw new SsrfGuardError("url-shape", "URL 无法解析");
    }
  }

  const bracketed = url.hostname;
  const hostname = bracketed.toLowerCase().replace(/^\[|\]$/g, "");
  const allowPrivate = isAllowlisted(url, entries);

  const literal = classifyAddress(bracketed);
  if (literal !== null) {
    if (literal.blocked && !allowPrivate) {
      throw new SsrfGuardError(
        "blocked-address",
        `目标是内网地址 ${hostname}（${literal.scope}）`,
      );
    }
    return {
      url,
      hostname,
      pinned: hostname,
      // 对 IP 不能发 SNI：Node 会把它当作无效服务名并给出警告。
      servername: "",
    };
  }

  let records: readonly ResolvedAddress[];
  try {
    records = await resolver(hostname, { all: true, verbatim: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SsrfGuardError("no-records", `无法解析 ${hostname}：${detail}`);
  }
  if (records.length === 0) {
    throw new SsrfGuardError("no-records", `${hostname} 没有 A/AAAA 记录`);
  }

  if (!allowPrivate) {
    for (const record of records) {
      if (isBlockedAddress(record.address)) {
        throw new SsrfGuardError(
          "blocked-address",
          `${hostname} 解析到内网地址 ${record.address}`,
        );
      }
    }
  }

  // 固定用第一条：verbatim 保持解析器给出的顺序，不做 v4/v6 重排。
  const first = records[0];
  return { url, hostname, pinned: first.address, servername: hostname };
}

function isAllowlistedUrl(raw: string, entries: readonly string[]): boolean {
  try {
    return isAllowlisted(new URL(raw), entries);
  } catch {
    return false;
  }
}

// ── 传输 ──────────────────────────────────────────────────────────

export interface GuardedRequestOptions {
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  /** 连接/读取的空闲超时。流式响应收到头之后按 socket 空闲时间计。 */
  readonly timeoutMs: number;
  readonly maxBytes?: number;
  /** 反向取消：客户端断开时用它销毁上游连接。 */
  readonly signal?: AbortSignal;
  /** 由重载选择：true 返回字节流而不是读完的 Buffer。 */
  readonly stream?: boolean;
}

export interface GuardedResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface GuardedStreamResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  /** 上游响应字节流。调用方必须消费或 destroy，否则连接会挂着。 */
  readonly stream: Readable;
  /** 显式中断上游（客户端取消时调用）。 */
  readonly abort: () => void;
}

/**
 * 唯一的上游传输。禁止在路由里直接用 fetch 请求用户配置的地址：
 * 那会绕过 pin 住的 IP 与逐条地址判定。
 *
 * 3xx 不跟随：返回 status 交给调用方，Location 不外传。
 */
export function guardedRequest(
  target: AllowedTarget,
  options: GuardedRequestOptions & { readonly stream: true },
): Promise<GuardedStreamResponse>;
export function guardedRequest(
  target: AllowedTarget,
  options: GuardedRequestOptions,
): Promise<GuardedResponse>;
export function guardedRequest(
  target: AllowedTarget,
  options: GuardedRequestOptions,
): Promise<GuardedResponse | GuardedStreamResponse> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === "https:";
    const transport = isHttps ? https : http;
    const family = target.pinned.includes(":") ? 6 : 4;

    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let request: ClientRequest | null = null;
    let response: IncomingMessage | null = null;

    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const detach = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      clearTimer();
      detach();
      request?.destroy();
      response?.destroy();
      reject(err);
    };
    const onAbort = (): void => {
      if (!settled) {
        fail(new UpstreamRequestError("aborted", "上游请求已被取消"));
        return;
      }
      response?.destroy();
      request?.destroy();
    };

    if (options.signal?.aborted) {
      reject(new UpstreamRequestError("aborted", "上游请求已被取消"));
      return;
    }

    /*
     * 自定义 lookup 是防 DNS rebinding 的关键：TCP 连接只会去 pinned。
     * Node 18+ 在 autoSelectFamily 下会以 { all: true } 调用，回调形状不同。
     */
    const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) {
        callback(null, [{ address: target.pinned, family }]);
      } else {
        callback(null, target.pinned, family);
      }
    };

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    // 上游必须回明文：压缩流会让「原样转发」变成「解压后转发」，破坏 SSE 的逐块时序。
    headers["accept-encoding"] = "identity";
    // Host 由传输层决定：连接钉在 IP 上，但 Host / SNI 必须保持原主机名。
    const defaultPort = isHttps ? "443" : "80";
    const port = target.url.port === "" ? defaultPort : target.url.port;
    const hostPart = target.hostname.includes(":") ? `[${target.hostname}]` : target.hostname;
    headers["host"] = port === defaultPort ? hostPart : `${hostPart}:${port}`;

    try {
      const requestOptions: https.RequestOptions = {
        protocol: target.url.protocol,
        hostname: target.hostname,
        port: target.url.port === "" ? undefined : Number(target.url.port),
        path: `${target.url.pathname}${target.url.search}`,
        method: options.method,
        headers,
        lookup: pinnedLookup,
      };
      if (isHttps && target.servername !== "") {
        requestOptions.servername = target.servername;
      }
      request = transport.request(requestOptions, onResponse);
    } catch (err) {
      fail(
        new UpstreamRequestError(
          "network",
          `无法创建上游连接：${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    request.on("error", (err) => {
      const reason: UpstreamFailure = options.signal?.aborted ? "aborted" : "network";
      fail(new UpstreamRequestError(reason, `上游连接失败：${err.message}`));
    });

    timer = setTimeout(() => {
      fail(new UpstreamRequestError("timeout", `上游在 ${options.timeoutMs}ms 内没有完成响应`));
    }, options.timeoutMs);

    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.body !== undefined) {
      request.end(options.body);
    } else {
      request.end();
    }

    function onResponse(res: IncomingMessage): void {
      response = res;
      const status = res.statusCode ?? 0;

      if (options.stream === true) {
        clearTimer();
        // 响应头已到，后续用 socket 空闲超时兜住「连上了但再也不发数据」。
        res.setTimeout(options.timeoutMs, () => {
          res.destroy(new UpstreamRequestError("timeout", "上游流式响应超时"));
        });
        const stream = capStream(res, maxBytes);
        res.once("close", detach);
        if (!settled) {
          settled = true;
          resolve({ status, headers: res.headers, stream, abort: () => res.destroy() });
        }
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;

      res.on("data", (chunk: Buffer) => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) {
          fail(new UpstreamRequestError("too-large", `上游响应超过 ${maxBytes} 字节`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        clearTimer();
        detach();
        resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
      });
      res.on("error", (err) => {
        fail(new UpstreamRequestError("network", `读取上游响应失败：${err.message}`));
      });
    }
  });
}

/** 流式上限：超过即销毁上游，并把错误交给下游（sseProxyStream 会转成 SSE error 事件）。 */
function capStream(source: IncomingMessage, maxBytes: number): Readable {
  const out = new PassThrough();
  let total = 0;

  source.on("data", (chunk: Buffer) => {
    if (out.destroyed) {
      source.destroy();
      return;
    }
    total += chunk.length;
    if (total > maxBytes) {
      source.destroy();
      out.destroy(new UpstreamRequestError("too-large", `上游响应超过 ${maxBytes} 字节`));
      return;
    }
    if (!out.write(chunk)) source.pause();
  });
  out.on("drain", () => source.resume());
  // 下游取消（客户端断开）时把上游一起关掉，否则 socket 会一直挂着。
  out.on("close", () => {
    if (!source.destroyed) source.destroy();
  });
  source.on("end", () => out.end());
  source.on("error", (err) => out.destroy(err));
  source.on("close", () => {
    if (!source.readableEnded) {
      out.destroy(new UpstreamRequestError("network", "上游连接在响应结束前断开"));
    }
  });

  return out;
}
