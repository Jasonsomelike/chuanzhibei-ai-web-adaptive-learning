/**
 * 联网搜索运行时：配置读写、Tavily/维基百科浏览器直连、会话缓存与错误分类。
 *
 * 边界：
 * - 浏览器直连供应商，没有本项目服务端代理；Tavily key 只落在 localStorage，
 *   请求头也只发往 api.tavily.com（BYOK）。
 * - searchWeb 永不抛错：任何失败都折成 { results: [], error, errorKind }，
 *   导师页据此照常回答，只显示一条非阻塞提示。
 * - sessionStorage 在 SSR、隐私模式、配额耗尽时可能不存在，甚至属性访问本身就抛错；
 *   所有读写都包在 try/catch 里，缓存失败不影响本次搜索。
 */

import {
  MAX_WEB_RESULTS,
  normalizeTavily,
  normalizeWikipedia,
  type WebProvider,
  type WebResult,
} from "@/lib/websearch";

export const SEARCH_CONFIG_KEY = "alp.search.v1";
export const SEARCH_CACHE_PREFIX = "alp.websearch.v1:";
/** 会话缓存 30 分钟；过期后重新请求。 */
export const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
export const SEARCH_TIMEOUT_MS = 15_000;
/** 维基摘录比 Tavily 短，取 3 条足够；多取只会稀释提示词。 */
export const WIKI_RESULT_LIMIT = 3;

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const WIKI_ENDPOINT = "https://zh.wikipedia.org/w/api.php";

export interface SearchConfig {
  readonly provider: WebProvider;
  /** 明文只存本机 localStorage；空串表示未配置。 */
  readonly tavilyApiKey: string;
  readonly defaultOn: boolean;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  provider: "wikipedia",
  tavilyApiKey: "",
  defaultOn: false,
};

export type SearchFailureKind =
  | "no-key" // 选了 Tavily 却没填密钥（直接调用 searchTavily 时）
  | "cors" // 浏览器拦截或网络不可达
  | "rate-limit" // HTTP 429
  | "timeout" // 15 秒未响应
  | "auth" // 401/403
  | "http" // 其余非 2xx
  | "empty" // 检索词为空或 0 条结果
  | "parse" // 响应不是合法 JSON
  | "aborted" // 调用方主动取消
  | "network"; // 其余意外错误

export class SearchError extends Error {
  readonly kind: SearchFailureKind;

  constructor(kind: SearchFailureKind, message: string) {
    super(message);
    this.name = "SearchError";
    this.kind = kind;
  }
}

export interface SearchOutcome {
  readonly results: WebResult[];
  /** 实际使用的供应商；未填 Tavily 密钥时会回退成 wikipedia。 */
  readonly provider: WebProvider;
  /** 成功为 null；失败为可直接展示的中文短句。 */
  readonly error: string | null;
  readonly errorKind: SearchFailureKind | null;
  readonly fromCache: boolean;
  /** 不是失败：例如「未填写 Tavily 密钥，已改用维基百科」。 */
  readonly notice: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeQuery(query: string): string {
  return query.replace(/\s+/gu, " ").trim();
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/** SSR 或隐私模式下 localStorage 可能连属性访问都抛错。 */
function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage: Storage | undefined = window.localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage: Storage | undefined = window.sessionStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}

// ── 配置 ──────────────────────────────────────────────────────────

/** 读配置。缺字段、坏 JSON、SSR 都返回默认值，绝不抛错。 */
export function loadSearchConfig(): SearchConfig {
  const store = getLocalStorage();
  if (!store) return { ...DEFAULT_SEARCH_CONFIG };

  try {
    const raw = store.getItem(SEARCH_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_SEARCH_CONFIG };

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_SEARCH_CONFIG };

    return {
      provider: parsed.provider === "tavily" ? "tavily" : "wikipedia",
      tavilyApiKey: typeof parsed.tavilyApiKey === "string" ? parsed.tavilyApiKey.trim() : "",
      defaultOn: parsed.defaultOn === true,
    };
  } catch {
    return { ...DEFAULT_SEARCH_CONFIG };
  }
}

/** 三个字段总是整份写入；存不进去（隐私模式/配额）也不阻断当前会话。 */
export function saveSearchConfig(config: SearchConfig): void {
  const store = getLocalStorage();
  if (!store) return;

  try {
    const payload: SearchConfig = {
      provider: config.provider === "tavily" ? "tavily" : "wikipedia",
      tavilyApiKey: config.tavilyApiKey.trim(),
      defaultOn: config.defaultOn === true,
    };
    store.setItem(SEARCH_CONFIG_KEY, JSON.stringify(payload));
  } catch {
    // 保存失败不阻断使用
  }
}

/** 选定实际供应商：没填 Tavily 密钥时回退维基百科，并给出原因。 */
export function resolveSearchProvider(config: SearchConfig): {
  provider: WebProvider;
  notice: string | null;
} {
  if (config.provider === "tavily" && config.tavilyApiKey.trim() === "") {
    return {
      provider: "wikipedia",
      notice: "未填写 Tavily 密钥，已改用维基百科（无需密钥）",
    };
  }
  return {
    provider: config.provider === "tavily" ? "tavily" : "wikipedia",
    notice: null,
  };
}

// ── 会话缓存 ──────────────────────────────────────────────────────

export function searchCacheKey(provider: WebProvider, query: string): string {
  return `${SEARCH_CACHE_PREFIX}${provider}:${normalizeQuery(query)}`;
}

function readCache(provider: WebProvider, query: string): WebResult[] | null {
  const store = getSessionStorage();
  if (!store) return null;

  const key = searchCacheKey(provider, query);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;

    const entry: unknown = JSON.parse(raw);
    if (!isRecord(entry)) return null;

    // at 在未来或超过 TTL 都当未命中：系统时钟回拨不应让旧结果长期驻留。
    const at = typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : Number.NaN;
    const age = Date.now() - at;
    if (!Number.isFinite(age) || age < 0 || age > SEARCH_CACHE_TTL_MS) {
      store.removeItem(key);
      return null;
    }

    if (!Array.isArray(entry.results)) return null;

    const results: WebResult[] = [];
    for (const item of entry.results) {
      if (!isRecord(item)) continue;
      if (item.provider !== provider) continue;
      if (typeof item.title !== "string" || typeof item.url !== "string") continue;
      if (typeof item.snippet !== "string" || !isHttpUrl(item.url)) continue;
      results.push({
        title: item.title,
        url: item.url,
        snippet: item.snippet,
        provider,
        ...(typeof item.revision === "string" && item.revision !== ""
          ? { revision: item.revision }
          : {}),
      });
      if (results.length === MAX_WEB_RESULTS) break;
    }
    // 空缓存等同未命中，避免把一次 0 结果的坏状态固化成 30 分钟不可重试。
    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

function writeCache(provider: WebProvider, query: string, results: readonly WebResult[]): void {
  if (results.length === 0) return;

  const store = getSessionStorage();
  if (!store) return;

  try {
    store.setItem(
      searchCacheKey(provider, query),
      JSON.stringify({ at: Date.now(), results: results.slice(0, MAX_WEB_RESULTS) }),
    );
  } catch {
    // 配额/隐私模式：缓存失败不影响本次结果
  }
}

// ── 请求 ──────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  if (signal?.aborted) throw new SearchError("aborted", "搜索已取消");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    return await fetch(url, { ...init, signal: combined });
  } catch (err) {
    if (err instanceof SearchError) throw err;
    if (isAbortError(err)) {
      // 外部取消与内部超时都是 AbortError，按外部信号状态区分。
      if (signal?.aborted) throw new SearchError("aborted", "搜索已取消");
      throw new SearchError("timeout", `搜索超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    // 浏览器直连被 CORS 拦截与 DNS/断网在 fetch 层都是 TypeError，无法进一步区分。
    throw new SearchError("cors", "该搜索服务不允许浏览器直连（也可能是网络不可达）");
  } finally {
    clearTimeout(timer);
  }
}

function classifyHttp(source: "Tavily" | "维基百科", status: number): SearchError {
  if (status === 429) {
    return new SearchError("rate-limit", "搜索服务限流，请稍后再试");
  }
  if (status === 401 || status === 403) {
    return source === "Tavily"
      ? new SearchError("auth", "Tavily 密钥无效或无权限，请到设置页检查")
      : new SearchError("auth", `维基百科拒绝了本次请求（HTTP ${status}）`);
  }
  if (status >= 500) {
    return new SearchError("http", `${source}搜索服务暂时不可用（HTTP ${status}），请稍后再试`);
  }
  return new SearchError("http", `${source}搜索失败（HTTP ${status}）`);
}

async function readJson(res: Response, source: "Tavily" | "维基百科"): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new SearchError("parse", `${source}返回了无法解析的数据`);
  }
}

/**
 * Tavily 直连。
 *
 * 只请求 content 摘录：include_raw_content=false 让响应体保持小，
 * 也避免把整页 HTML 塞进提示词。
 */
export async function searchTavily(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<WebResult[]> {
  const q = normalizeQuery(query);
  const key = apiKey.trim();
  if (key === "") throw new SearchError("no-key", "未填写 Tavily 密钥，无法搜索");
  if (q === "") throw new SearchError("empty", "检索词为空，未发起搜索");

  const res = await fetchWithTimeout(
    TAVILY_ENDPOINT,
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
    signal,
    SEARCH_TIMEOUT_MS,
  );

  if (!res.ok) throw classifyHttp("Tavily", res.status);
  const results = normalizeTavily(await readJson(res, "Tavily"));
  if (results.length === 0) throw new SearchError("empty", "没有找到可用结果");
  return results;
}

/**
 * 维基百科 Action API 直连。
 *
 * origin=* 是匿名跨域的前提；prop 同时要 extracts（正文摘录）与 revisions（revid），
 * 后者用来生成 ?oldid= 稳定链接，避免条目被编辑后引用对不上原文。
 */
export async function searchWikipedia(
  query: string,
  signal?: AbortSignal,
): Promise<WebResult[]> {
  const q = normalizeQuery(query);
  if (q === "") throw new SearchError("empty", "检索词为空，未发起搜索");

  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: q,
    gsrlimit: String(WIKI_RESULT_LIMIT),
    prop: "extracts|info|revisions",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    rvprop: "ids|timestamp",
    format: "json",
    origin: "*",
  });

  const res = await fetchWithTimeout(
    `${WIKI_ENDPOINT}?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json" } },
    signal,
    SEARCH_TIMEOUT_MS,
  );

  if (!res.ok) throw classifyHttp("维基百科", res.status);
  const results = normalizeWikipedia(await readJson(res, "维基百科"));
  if (results.length === 0) throw new SearchError("empty", "没有找到可用结果");
  return results;
}

function failure(
  provider: WebProvider,
  notice: string | null,
  kind: SearchFailureKind,
  error: string,
): SearchOutcome {
  return { results: [], provider, error, errorKind: kind, fromCache: false, notice };
}

/**
 * 网页搜索的统一入口。
 *
 * 刻意不抛错：调用方（导师页）在搜索失败时仍要继续回答，
 * 只把 error 当一条非阻塞提示展示。
 */
export async function searchWeb(
  query: string,
  config: SearchConfig,
  signal?: AbortSignal,
): Promise<SearchOutcome> {
  const { provider, notice } = resolveSearchProvider(config);
  const q = normalizeQuery(query);

  if (signal?.aborted) return failure(provider, notice, "aborted", "搜索已取消");
  if (q === "") return failure(provider, notice, "empty", "检索词为空，未发起搜索");

  const cached = readCache(provider, q);
  if (cached) {
    return { results: cached, provider, error: null, errorKind: null, fromCache: true, notice };
  }

  try {
    const results =
      provider === "tavily"
        ? await searchTavily(q, config.tavilyApiKey, signal)
        : await searchWikipedia(q, signal);
    writeCache(provider, q, results);
    return { results, provider, error: null, errorKind: null, fromCache: false, notice };
  } catch (err) {
    if (err instanceof SearchError) {
      return failure(provider, notice, err.kind, err.message);
    }
    return failure(
      provider,
      notice,
      "network",
      `搜索失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
