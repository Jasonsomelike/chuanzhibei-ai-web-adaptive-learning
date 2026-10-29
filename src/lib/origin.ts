/**
 * CSRF 同源校验：只相信浏览器写的 Origin / Sec-Fetch-Site，以及反代透传的 Host。
 *
 * 边界：
 * - GET/HEAD 约定为安全方法，直接放行；有副作用的请求必须带 Origin。
 * - 比较的是 host:port，不比较协议——反代后面 request.url 的协议可能与外部不一致，
 *   拿它做协议比对会误杀正常请求。本项目对外只暴露 https。
 * - 纯函数：不读环境变量，不解析 cookie/token；只回答「这个请求是不是同源发起的」。
 */

export interface SameOriginInput {
  readonly method: string;
  readonly origin?: string | null;
  readonly host?: string | null;
  readonly forwardedHost?: string | null;
  readonly secFetchSite?: string | null;
  /** 兜底的 host 来源；只有 Host 与 X-Forwarded-Host 都缺失时才用。 */
  readonly url?: string | null;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

export function isSameOriginRequest(input: SameOriginInput): boolean {
  const method = input.method.trim().toUpperCase();
  if (SAFE_METHODS.has(method)) return true;

  if ((input.secFetchSite ?? "").trim().toLowerCase() === "cross-site") {
    return false;
  }

  const originText = (input.origin ?? "").trim();
  // 浏览器对沙箱 iframe、file:// 发的是字面量 "null"
  if (originText === "" || originText.toLowerCase() === "null") return false;

  let origin: URL;
  try {
    origin = new URL(originText);
  } catch {
    return false;
  }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") return false;
  if (origin.host === "") return false;

  const expected = expectedHost(input);
  if (expected === null) return false;

  const defaultPort = origin.protocol === "https:" ? 443 : 80;
  const fromOrigin = normalizeHost(origin.host, defaultPort);
  const fromHeader = normalizeHost(expected, defaultPort);
  return fromOrigin !== null && fromHeader !== null && fromOrigin === fromHeader;
}

/** 从 Next 的 Route Handler Request 取头并判定。 */
export function sameOriginFromRequest(req: Request): boolean {
  return isSameOriginRequest({
    method: req.method,
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
    forwardedHost: req.headers.get("x-forwarded-host"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    url: req.url,
  });
}

/**
 * 反代后面 Host 可能是内部主机名，X-Forwarded-Host 才是浏览器实际访问的域名；
 * 因此优先取后者。
 */
function expectedHost(input: SameOriginInput): string | null {
  const forwarded = firstHeaderValue(input.forwardedHost);
  if (forwarded !== null) return forwarded;

  const host = firstHeaderValue(input.host);
  if (host !== null) return host;

  const url = (input.url ?? "").trim();
  if (url === "") return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function firstHeaderValue(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const first = raw.split(",")[0].trim();
  return first === "" ? null : first;
}

/** 归一成 host:port 再比较：小写、去掉域名末尾的点、补默认端口。 */
function normalizeHost(raw: string, defaultPort: number): string | null {
  const value = raw.trim().toLowerCase();
  if (value === "") return null;

  let host: string;
  let port: string | null;
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close < 0) return null;
    host = value.slice(0, close + 1);
    const rest = value.slice(close + 1);
    port = rest.startsWith(":") ? rest.slice(1) : null;
  } else {
    const colon = value.indexOf(":");
    host = colon < 0 ? value : value.slice(0, colon);
    port = colon < 0 ? null : value.slice(colon + 1);
  }

  if (!host.startsWith("[")) host = host.replace(/\.$/, "");
  if (host === "" || host === "[]") return null;

  if (port === null || port === "") return `${host}:${defaultPort}`;
  return /^\d+$/.test(port) ? `${host}:${Number.parseInt(port, 10)}` : null;
}
