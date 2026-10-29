/**
 * SSRF 防护的纯判定层：IP 归属分类 + URL 形状检查。
 *
 * 边界：
 * - 不做 DNS 解析。主机名安不安全取决于它解析出的每一条 A/AAAA 记录，调用方必须
 *   在 resolve 之后逐个调 isBlockedAddress，并且每一跳重定向都要重新判定。
 * - checkUrlShape 只拦字面量层面的东西（协议、userinfo、端口、长度、已知元数据
 *   主机名、字面量内网 IP），拦不住「公网域名解析到内网」。
 * - 非规范 IPv4 写法（127.1、2130706433、0x7f.0.0.1、0177.0.0.1）按 WHATWG URL
 *   的既有规则解析，否则一个合法 URL 就能绕过字面量判定。
 */

export type IpFamily = "ipv4" | "ipv6";

export type AddressScope =
  | "public"
  | "loopback"
  | "private"
  | "shared"
  | "link-local"
  | "unique-local"
  | "unspecified"
  | "documentation"
  | "benchmark"
  | "multicast"
  | "reserved";

export interface AddressClassification {
  readonly family: IpFamily;
  readonly scope: AddressScope;
  readonly blocked: boolean;
  /** 命中 ::ffff:0:0/96 或 64:ff9b::/96 时，被拆出来的内嵌 IPv4（规范点分十进制）。 */
  readonly embedded?: string;
}

interface V4Range {
  readonly base: number;
  readonly bits: number;
  readonly scope: AddressScope;
}

/** RFC 6890 + 云元数据实践里需要封的全部 IPv4 段。 */
const V4_RANGES: readonly V4Range[] = [
  { base: 0x00000000, bits: 8, scope: "reserved" }, // 0.0.0.0/8 本网络
  { base: 0x0a000000, bits: 8, scope: "private" }, // 10.0.0.0/8
  { base: 0x64400000, bits: 10, scope: "shared" }, // 100.64.0.0/10 CGNAT
  { base: 0x7f000000, bits: 8, scope: "loopback" }, // 127.0.0.0/8
  { base: 0xa9fe0000, bits: 16, scope: "link-local" }, // 169.254.0.0/16
  { base: 0xac100000, bits: 12, scope: "private" }, // 172.16.0.0/12
  { base: 0xc0000000, bits: 24, scope: "reserved" }, // 192.0.0.0/24 IETF 协议分配
  { base: 0xc0000200, bits: 24, scope: "documentation" }, // 192.0.2.0/24 TEST-NET-1
  { base: 0xc0a80000, bits: 16, scope: "private" }, // 192.168.0.0/16
  { base: 0xc6120000, bits: 15, scope: "benchmark" }, // 198.18.0.0/15
  { base: 0xc6336400, bits: 24, scope: "documentation" }, // 198.51.100.0/24 TEST-NET-2
  { base: 0xcb007100, bits: 24, scope: "documentation" }, // 203.0.113.0/24 TEST-NET-3
  { base: 0xe0000000, bits: 4, scope: "multicast" }, // 224.0.0.0/4
  { base: 0xf0000000, bits: 4, scope: "reserved" }, // 240.0.0.0/4（含广播地址）
];

/** 云厂商元数据服务的主机名；它们背后通常是 169.254.169.254。 */
const METADATA_HOSTS: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata.amazonaws.com",
]);

export const MAX_URL_LENGTH = 2048;

export interface UrlShapeOptions {
  /**
   * 允许走 http 的 host:port 白名单。条目不带端口时按 http 默认 80 补齐；
   * 只对 http 生效，https 永远放行（但仍要过端口/主机名/地址判定）。
   */
  readonly allowHttpHosts?: readonly string[];
}

export type UrlShapeRejection =
  | "too-long"
  | "invalid-url"
  | "scheme"
  | "userinfo"
  | "port"
  | "metadata-host"
  | "blocked-address";

export type UrlShapeResult =
  | { readonly ok: true; readonly url: URL }
  | {
      readonly ok: false;
      readonly reason: UrlShapeRejection;
      readonly detail: string;
    };

/**
 * 把一个 IP 字面量分类。不是 IP（域名、乱码、空串）返回 null。
 * 内嵌 IPv4 的 IPv6 先拆出内层地址，按内层封禁状态定夺。
 */
export function classifyAddress(raw: string): AddressClassification | null {
  const input = raw.trim();
  if (input === "") return null;

  if (input.includes(":")) {
    const groups = parseIpv6(input);
    return groups === null ? null : classifyIpv6(groups);
  }

  const value = parseIpv4(input);
  return value === null ? null : classifyIpv4(value);
}

/** 主机名返回 false——它不是地址；调用方必须先解析再逐条判定。 */
export function isBlockedAddress(raw: string): boolean {
  return classifyAddress(raw)?.blocked ?? false;
}

/**
 * URL 形状检查。通过不代表可以请求：主机名仍需解析并对每个地址调
 * isBlockedAddress。
 */
export function checkUrlShape(
  raw: string,
  options: UrlShapeOptions = {},
): UrlShapeResult {
  if (raw.length > MAX_URL_LENGTH) {
    return reject("too-long", `URL 超过 ${MAX_URL_LENGTH} 字符`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return reject("invalid-url", "URL 无法解析");
  }

  const allowHttp = httpAllowList(options.allowHttpHosts);

  if (url.protocol === "http:") {
    const hostPort = `${url.hostname.toLowerCase()}:${url.port === "" ? "80" : url.port}`;
    if (!allowHttp.has(hostPort)) {
      return reject("scheme", "只允许 https（该主机不在 http 白名单内）");
    }
  } else if (url.protocol !== "https:") {
    return reject("scheme", `只允许 https，收到 ${url.protocol}`);
  }

  if (url.username !== "" || url.password !== "") {
    return reject("userinfo", "URL 不允许携带 userinfo");
  }

  if (url.protocol === "https:" && url.port !== "" && url.port !== "443") {
    return reject("port", `https 只允许 443，收到 ${url.port}`);
  }

  // URL 解析器保留末尾的点；判定前归一，避免 metadata.google.internal. 绕过。
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (METADATA_HOSTS.has(hostname)) {
    return reject("metadata-host", `目标是云元数据主机 ${hostname}`);
  }

  const literal = classifyAddress(url.hostname);
  if (literal?.blocked) {
    return reject(
      "blocked-address",
      `目标是字面量内网地址 ${url.hostname}（${literal.scope}）`,
    );
  }

  return { ok: true, url };
}

function reject(reason: UrlShapeRejection, detail: string): UrlShapeResult {
  return { ok: false, reason, detail };
}

function httpAllowList(entries: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const entry of entries ?? []) {
    const value = entry.trim().toLowerCase();
    if (value === "") continue;
    out.add(withDefaultHttpPort(value));
  }
  return out;
}

function withDefaultHttpPort(value: string): string {
  if (/^\[[^\]]+\]:\d+$/.test(value)) return value;
  if (value.startsWith("[")) return `${value}:80`;
  if (/:\d+$/.test(value)) return value;
  return `${value}:80`;
}

/**
 * 按 WHATWG URL 的 IPv4 规则解析：接受 1–4 段、十六进制 0x、八进制前导 0。
 * 返回 32 位无符号整数，非法返回 null。
 */
function parseIpv4(raw: string): number | null {
  let input = raw;
  if (input.endsWith(".")) input = input.slice(0, -1);
  if (input === "") return null;

  const parts = input.split(".");
  if (parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    const value = parseIpv4Part(part);
    if (value === null) return null;
    nums.push(value);
  }

  const last = nums[nums.length - 1];
  // 最后一段吃掉剩余字节：1 段最多 32 位，2 段 24 位，依此类推。
  if (last >= 256 ** (5 - nums.length)) return null;

  let value = last;
  for (let i = 0; i < nums.length - 1; i++) {
    const part = nums[i];
    if (part > 255) return null;
    value += part * 256 ** (3 - i);
  }
  if (!Number.isSafeInteger(value) || value > 0xffffffff) return null;
  return value;
}

function parseIpv4Part(part: string): number | null {
  if (part === "") return null;
  if (/^0x[0-9a-f]+$/i.test(part)) {
    const hex = Number.parseInt(part.slice(2), 16);
    return Number.isSafeInteger(hex) ? hex : null;
  }
  if (part.length > 1 && part.startsWith("0")) {
    if (!/^[0-7]+$/.test(part.slice(1))) return null;
    return Number.parseInt(part, 8);
  }
  if (!/^[0-9]+$/.test(part)) return null;
  const dec = Number.parseInt(part, 10);
  return Number.isSafeInteger(dec) ? dec : null;
}

/** 解析成 8 个 16 位分组；支持方括号与 %zone，非法返回 null。 */
function parseIpv6(raw: string): number[] | null {
  let input = raw;
  if (input.startsWith("[") && input.endsWith("]")) {
    input = input.slice(1, -1);
  }
  const zone = input.indexOf("%");
  if (zone >= 0) input = input.slice(0, zone);
  if (input === "") return null;

  const halves = input.split("::");
  if (halves.length > 2) return null;

  const headText = halves[0];
  const tailText = halves.length === 2 ? halves[1] : null;
  // IPv4 只能出现在整个地址的最后 32 位，不允许藏在 :: 之前
  if (tailText !== null && headText.includes(".")) return null;
  const head = headText === "" ? [] : (groupsOf(headText) ?? null);
  if (head === null) return null;
  const tail = tailText === null || tailText === "" ? [] : (groupsOf(tailText) ?? null);
  if (tail === null) return null;

  if (tailText === null) {
    return head.length === 8 ? head : null;
  }
  // :: 必须至少压缩掉一个分组，否则 9 组无法成立
  if (head.length + tail.length > 7) return null;
  const zeros = new Array<number>(8 - head.length - tail.length).fill(0);
  return [...head, ...zeros, ...tail];
}

function groupsOf(text: string): number[] | null {
  const tokens = text.split(":");
  const out: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "") return null;
    if (i === tokens.length - 1 && token.includes(".")) {
      const v4 = parseIpv4(token);
      if (v4 === null) return null;
      out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(token)) return null;
    out.push(Number.parseInt(token, 16));
  }
  return out;
}

function classifyIpv4(
  value: number,
  family: IpFamily = "ipv4",
  embedded?: string,
): AddressClassification {
  const extra = embedded === undefined ? {} : { embedded };
  for (const range of V4_RANGES) {
    const shift = 32 - range.bits;
    if (value >>> shift === range.base >>> shift) {
      return { family, scope: range.scope, blocked: true, ...extra };
    }
  }
  return { family, scope: "public", blocked: false, ...extra };
}

function classifyIpv6(groups: readonly number[]): AddressClassification {
  const g0 = groups[0] ?? 0;
  const g1 = groups[1] ?? 0;
  const g2 = groups[2] ?? 0;
  const g3 = groups[3] ?? 0;
  const g4 = groups[4] ?? 0;
  const g5 = groups[5] ?? 0;
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;

  if ((g0 | g1 | g2 | g3 | g4 | g5 | g6 | g7) === 0) {
    return { family: "ipv6", scope: "unspecified", blocked: true };
  }
  if ((g0 | g1 | g2 | g3 | g4 | g5 | g6) === 0 && g7 === 1) {
    return { family: "ipv6", scope: "loopback", blocked: true };
  }

  // ::ffff:0:0/96 与 64:ff9b::/96 先拆内嵌 IPv4，再按内层判定
  if ((g0 | g1 | g2 | g3 | g4) === 0 && g5 === 0xffff) {
    const inner = ((g6 << 16) | g7) >>> 0;
    return classifyIpv4(inner, "ipv6", formatIpv4(inner));
  }
  if (g0 === 0x0064 && g1 === 0xff9b && (g2 | g3 | g4 | g5) === 0) {
    const inner = ((g6 << 16) | g7) >>> 0;
    return classifyIpv4(inner, "ipv6", formatIpv4(inner));
  }
  // ::/96 余下的是已废弃的 IPv4-compatible 地址，部分协议栈仍会路由到 IPv4
  if ((g0 | g1 | g2 | g3 | g4 | g5) === 0) {
    return { family: "ipv6", scope: "reserved", blocked: true };
  }
  if ((g0 & 0xfe00) === 0xfc00) {
    return { family: "ipv6", scope: "unique-local", blocked: true };
  }
  if ((g0 & 0xffc0) === 0xfe80) {
    return { family: "ipv6", scope: "link-local", blocked: true };
  }
  if ((g0 & 0xff00) === 0xff00) {
    return { family: "ipv6", scope: "multicast", blocked: true };
  }
  return { family: "ipv6", scope: "public", blocked: false };
}

function formatIpv4(value: number): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}
