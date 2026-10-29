/**
 * 服务端联网搜索：三家供应商的固定端点、请求拼装、超时与错误分类。
 *
 * 边界：
 * - 端点写死在这里，不接受调用方传 URL：搜索是服务端代发，用户可填的只有密钥。
 *   DeepSeek 的密钥可能来自 llm 行（base_url 是官方地址时），但请求仍然只发往
 *   api.deepseek.com，绝不把密钥带到用户自填的中转地址。
 * - 15 秒超时；超时、鉴权、限流、HTTP、解析、空结果六类错误用 kind 区分，
 *   路由据此选状态码。错误信息不含密钥：上游返回体只保留截断并脱敏后的片段。
 * - 归一化只在 websearch.ts 做一次；这里不重复实现排序与字段回退。
 */

import {
  MAX_WEB_RESULTS,
  normalizeDeepSeek,
  normalizeTavily,
  normalizeWikipedia,
  type WebProvider,
  type WebResult,
} from "@/lib/websearch";

export const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const WIKIPEDIA_SEARCH_URL = "https://zh.wikipedia.org/w/api.php";

export const SEARCH_TIMEOUT_MS = 15_000;
/** 与 websearch 的 MAX_WEB_RESULTS 一致；DeepSeek 按次计费，多取没有收益。 */
export const DEFAULT_SEARCH_COUNT = MAX_WEB_RESULTS;
export const MAX_SEARCH_COUNT = 10;

/** 上游错误正文最多保留多少字符；再长对排障没有帮助，只会把日志撑大。 */
const MAX_DETAIL_CHARS = 200;

export type SearchErrorKind =
  | "auth" // 401/403：密钥无效或无权限
  | "rate-limit" // 429：限流或额度不足
  | "timeout" // 15 秒未响应
  | "http" // 其余非 2xx、网络不可达、被拒绝的重定向
  | "parse" // 响应不是合法 JSON
  | "empty"; // 检索词为空或归一化后 0 条

export class SearchUpstreamError extends Error {
  readonly kind: SearchErrorKind;
  readonly provider: WebProvider;
  readonly status: number | null;

  constructor(
    kind: SearchErrorKind,
    message: string,
    provider: WebProvider,
    status: number | null = null,
  ) {
    super(message);
    this.name = "SearchUpstreamError";
    this.kind = kind;
    this.provider = provider;
    this.status = status;
  }
}

export interface SearchDeps {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}

/** 1..MAX_SEARCH_COUNT；非整数按向下取整，越界夹紧。 */
export function clampSearchCount(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_SEARCH_COUNT;
  const value = Math.trunc(count);
  if (value < 1) return 1;
  return Math.min(MAX_SEARCH_COUNT, value);
}

/**
 * 密钥脱敏：上游错误体偶尔会把请求头回显出来，先把密钥字面量替换掉再截断。
 * 截断放在脱敏之后，避免密钥被截成半截后仍能匹配。
 */
export function sanitizeUpstreamText(raw: string, secrets: readonly string[]): string {
  let text = raw.replace(/\s+/g, " ").trim();
  for (const secret of secrets) {
    if (secret.trim() === "") continue;
    text = text.split(secret).join("***");
  }
  return text.slice(0, MAX_DETAIL_CHARS);
}

function httpFailure(
  provider: WebProvider,
  status: number,
  detail: string,
  secrets: readonly string[],
): SearchUpstreamError {
  const suffix = detail === "" ? "" : `：${sanitizeUpstreamText(detail, secrets)}`;
  if (status === 401 || status === 403) {
    return new SearchUpstreamError(
      "auth",
      `搜索供应商拒绝了密钥（HTTP ${status}）${suffix}`,
      provider,
      status,
    );
  }
  if (status === 429) {
    return new SearchUpstreamError(
      "rate-limit",
      `搜索供应商限流或额度不足（HTTP 429）${suffix}`,
      provider,
      status,
    );
  }
  return new SearchUpstreamError(
    "http",
    `搜索失败（HTTP ${status}）${suffix}`,
    provider,
    status,
  );
}

interface RawResponse {
  readonly status: number;
  readonly text: string;
}

function timeoutError(provider: WebProvider, timeoutMs: number): SearchUpstreamError {
  return new SearchUpstreamError(
    "timeout",
    `搜索超时（${Math.round(timeoutMs / 1000)} 秒）`,
    provider,
  );
}

/**
 * 发一次请求并把非 2xx 统一转成 SearchUpstreamError。
 *
 * 先读文本再解析 JSON：错误体通常不是 JSON，直接 res.json() 会把 401
 * 报成「解析失败」，让用户以为是密钥格式问题。
 *
 * 计时器覆盖到正文读完为止：只包住 fetch 的话，上游发完响应头就不再吐字节，
 * 调用会一直挂着，15 秒超时形同虚设。
 */
async function requestText(
  url: string,
  init: RequestInit,
  provider: WebProvider,
  secrets: readonly string[],
  deps: SearchDeps,
): Promise<RawResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    try {
      /*
       * 必须显式 redirect:"manual"：fetch 默认跟随，跟随后再判 3xx 等于没判，
       * 注释里承诺的「不自动跟随」也就成了空话。
       */
      res = await fetchImpl(url, { ...init, signal: controller.signal, redirect: "manual" });
    } catch (error) {
      if (controller.signal.aborted) throw timeoutError(provider, timeoutMs);
      const name =
        typeof error === "object" && error !== null && "name" in error
          ? String((error as { name?: unknown }).name ?? "")
          : "";
      if (name === "AbortError") throw timeoutError(provider, timeoutMs);
      throw new SearchUpstreamError("http", "搜索服务网络不可达", provider);
    }

    // 3xx 说明端点被改道（或被网关劫持）；不自动跟随，避免密钥被带到别的域。
    if (res.status >= 300 && res.status < 400) {
      throw new SearchUpstreamError(
        "http",
        `搜索供应商返回了重定向（HTTP ${res.status}），已拒绝跟随`,
        provider,
        res.status,
      );
    }

    let text: string;
    try {
      /*
       * 有的实现（以及测试里的假 fetch）不把 AbortSignal 透到响应体；
       * 这里用 Promise.race 保证「响应头到了、正文不来」也会在 15 秒结束。
       */
      const aborted = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) {
          reject(timeoutError(provider, timeoutMs));
          return;
        }
        controller.signal.addEventListener(
          "abort",
          () => reject(timeoutError(provider, timeoutMs)),
          { once: true },
        );
      });
      text = await Promise.race([res.text(), aborted]);
    } catch (error) {
      if (error instanceof SearchUpstreamError) throw error;
      if (controller.signal.aborted) throw timeoutError(provider, timeoutMs);
      throw new SearchUpstreamError("parse", "搜索响应无法读取", provider, res.status);
    }

    if (!res.ok) throw httpFailure(provider, res.status, text, secrets);
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string, provider: WebProvider): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SearchUpstreamError("parse", "搜索供应商返回了无法解析的数据", provider);
  }
}

function ensureResults(results: readonly WebResult[], provider: WebProvider): WebResult[] {
  if (results.length === 0) {
    throw new SearchUpstreamError("empty", "没有找到可用结果", provider);
  }
  return [...results];
}

/**
 * DeepSeek 官方搜索。
 *
 * 固定 POST https://api.deepseek.com/v1/tools/search，body 只带 query/count/need_content；
 * need_content=true 让摘要字段可用，归一化时按 summary → snippet → content 取。
 */
export async function searchDeepSeek(
  apiKey: string,
  query: string,
  count: number = DEFAULT_SEARCH_COUNT,
  deps: SearchDeps = {},
): Promise<WebResult[]> {
  const key = apiKey.trim();
  const q = normalizeQuery(query);
  if (q === "") throw new SearchUpstreamError("empty", "检索词为空，未发起搜索", "deepseek");
  if (key === "") {
    throw new SearchUpstreamError("auth", "未配置 DeepSeek 搜索密钥", "deepseek");
  }

  const { text } = await requestText(
    DEEPSEEK_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: q,
        count: clampSearchCount(count),
        need_content: true,
      }),
    },
    "deepseek",
    [key],
    deps,
  );

  return ensureResults(normalizeDeepSeek(parseJson(text, "deepseek")), "deepseek");
}

/** Tavily：固定 api.tavily.com/search，与浏览器直连使用同一套请求字段。 */
export async function searchTavily(
  apiKey: string,
  query: string,
  deps: SearchDeps = {},
): Promise<WebResult[]> {
  const key = apiKey.trim();
  const q = normalizeQuery(query);
  if (q === "") throw new SearchUpstreamError("empty", "检索词为空，未发起搜索", "tavily");
  if (key === "") throw new SearchUpstreamError("auth", "未配置 Tavily 密钥", "tavily");

  const { text } = await requestText(
    TAVILY_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: q,
        search_depth: "basic",
        max_results: MAX_WEB_RESULTS,
        include_answer: false,
        include_raw_content: false,
      }),
    },
    "tavily",
    [key],
    deps,
  );

  return ensureResults(normalizeTavily(parseJson(text, "tavily")), "tavily");
}

/**
 * 维基百科 Action API：免密钥、固定 zh.wikipedia.org。
 *
 * 不传 origin=*（那是浏览器跨域用），服务端请求不需要；其余参数与
 * searchClient.ts 保持一致，返回的 revid 会变成 ?oldid= 稳定链接。
 */
export async function searchWikipedia(
  query: string,
  deps: SearchDeps = {},
): Promise<WebResult[]> {
  const q = normalizeQuery(query);
  if (q === "") throw new SearchUpstreamError("empty", "检索词为空，未发起搜索", "wikipedia");

  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: q,
    gsrlimit: "3",
    prop: "extracts|info|revisions",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    rvprop: "ids|timestamp",
    format: "json",
  });

  const { text } = await requestText(
    `${WIKIPEDIA_SEARCH_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        // Wikimedia 的 API 礼仪要求可识别的 UA；缺省 UA 在部分网络会被限流。
        "User-Agent": "AdaptiveLearningPath/0.1 (educational project)",
      },
    },
    "wikipedia",
    [],
    deps,
  );

  return ensureResults(normalizeWikipedia(parseJson(text, "wikipedia")), "wikipedia");
}

/**
 * llm 行的 base_url 是否是 DeepSeek 官方域。
 *
 * 只比较 hostname；末尾点归一，端口不参与——用户可能写成 https://api.deepseek.com/v1
 * 或 https://api.deepseek.com:443。任何子域、相似域名（api.deepseek.com.evil）
 * 都不算，避免把 llm 密钥发给冒充的搜索供应商。
 */
export function isDeepSeekBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.trim() === "") return false;
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol !== "https:") return false;
    return url.hostname.toLowerCase().replace(/\.$/, "") === "api.deepseek.com";
  } catch {
    return false;
  }
}

/** 供路由做穷尽 switch 的兜底；新增供应商而漏分支时这里会在编译期报错。 */
export function assertNeverProvider(provider: never): never {
  throw new Error(`未处理的搜索供应商：${String(provider)}`);
}

export type { WebProvider, WebResult };
