/**
 * 联网搜索运行时：配置读写、供应商解析、直连与代理两条调用链、会话缓存。
 *
 * 两条链路：
 * - local：浏览器直连 Tavily / 维基百科；Tavily 密钥只落 localStorage（BYOK）。
 * - server：Tavily 与 DeepSeek 走本项目 POST /api/search，密钥加密存在账号里，
 *   浏览器不接触明文；维基百科免密钥，两种模式下都直连。
 *
 * 边界：
 * - searchWeb 永不抛错：任何失败都折成 { results: [], error, errorKind }，
 *   导师页据此照常回答，只显示一条非阻塞提示。
 * - 供应商解析是穷尽 switch：deepseek 未登录时明确回退维基百科并给 notice，
 *   绝不静默降级成别家，也不会把 deepseek 标成 Tavily。
 * - sessionStorage 在 SSR、隐私模式、配额耗尽时可能不存在，甚至属性访问本身就抛错；
 *   所有读写都包在 try/catch 里，缓存失败不影响本次搜索。
 */

import {
  MAX_SNIPPET_CHARS,
  MAX_WEB_RESULTS,
  normalizeTavily,
  normalizeWikipedia,
  type WebProvider,
  type WebResult,
} from "@/lib/websearch";
import type { CallMode } from "@/lib/serverConfig";

export const SEARCH_CONFIG_KEY = "alp.search.v1";
export const SEARCH_CACHE_PREFIX = "alp.websearch.v1:";
/** 会话缓存 30 分钟；过期后重新请求。 */
export const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
export const SEARCH_TIMEOUT_MS = 15_000;
/** 维基摘录比 Tavily 短，取 3 条足够；多取只会稀释提示词。 */
export const WIKI_RESULT_LIMIT = 3;

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const WIKI_ENDPOINT = "https://zh.wikipedia.org/w/api.php";
const SEARCH_PROXY_ENDPOINT = "/api/search";

export interface SearchConfig {
  /** 用户选定的供应商；deepseek 没有本机密钥，只有账号配置。 */
  readonly provider: WebProvider;
  /** 明文只存本机 localStorage；空串表示未配置。server 模式下不使用。 */
  readonly tavilyApiKey: string;
  readonly defaultOn: boolean;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  provider: "wikipedia",
  tavilyApiKey: "",
  defaultOn: false,
};

/**
 * 一次搜索按哪套链路走。
 *
 * 默认是本机直连：未显式传入时（例如导师页的旧调用）保持原有行为，
 * 不会因为账号里存了配置就悄悄改走代理。
 */
export interface SearchRuntime {
  readonly mode: CallMode;
  readonly loggedIn: boolean;
}

export const DEFAULT_SEARCH_RUNTIME: SearchRuntime = Object.freeze({
  mode: "local",
  loggedIn: false,
});

export type SearchFailureKind =
  | "no-key" // 选了 Tavily 却没填密钥（直接调用 searchTavily 时）
  | "unauthorized" // 服务端代理需要登录
  | "not-configured" // 服务端还没有对应的配置行
  | "cors" // 浏览器拦截或网络不可达
  | "rate-limit" // HTTP 429
  | "timeout" // 15 秒未响应
  | "auth" // 401/403（直连供应商时）
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
  /** 实际使用的供应商；未登录选 DeepSeek 或没填 Tavily 密钥时会回退成 wikipedia。 */
  readonly provider: WebProvider;
  /** 成功为 null；失败为可直接展示的中文短句。 */
  readonly error: string | null;
  readonly errorKind: SearchFailureKind | null;
  readonly fromCache: boolean;
  /** 不是失败：例如「未登录，DeepSeek 搜索已改用维基百科」。 */
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

function assertNeverProvider(provider: never): never {
  throw new Error(`未处理的搜索供应商：${String(provider)}`);
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

/** 只认已知供应商；旧存档或手改的值一律回落到维基百科。 */
function providerOf(value: unknown): WebProvider {
  switch (value) {
    case "tavily":
    case "wikipedia":
    case "deepseek":
      return value;
    default:
      return "wikipedia";
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
      provider: providerOf(parsed.provider),
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
      provider: providerOf(config.provider),
      tavilyApiKey: config.tavilyApiKey.trim(),
      defaultOn: config.defaultOn === true,
    };
    store.setItem(SEARCH_CONFIG_KEY, JSON.stringify(payload));
  } catch {
    // 保存失败不阻断使用
  }
}

/**
 * 清除搜索配置与全部会话缓存。
 *
 * 只删 SEARCH_CONFIG_KEY 不够：缓存里有完整的网页摘要，公共电脑上同样需要清掉。
 * 缓存键带 30 分钟 TTL，但删除是即时的，不依赖过期。
 */
export function clearSearchConfig(): void {
  const local = getLocalStorage();
  if (local !== null) {
    try {
      local.removeItem(SEARCH_CONFIG_KEY);
    } catch {
      // ignore
    }
  }

  const session = getSessionStorage();
  if (session === null) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < session.length; i += 1) {
      const key = session.key(i);
      if (key !== null && key.startsWith(SEARCH_CACHE_PREFIX)) keys.push(key);
    }
    for (const key of keys) session.removeItem(key);
  } catch {
    // 隐私模式：没有缓存可清
  }
}

/**
 * 选定实际供应商。穷尽 switch，新增供应商时编译期就会提醒补分支。
 *
 * 回退必须带 notice：调用方把它显示在检索提示里，用户才知道不是「没有结果」
 * 而是「换了供应商」。
 */
export function resolveSearchProvider(
  config: SearchConfig,
  runtime: SearchRuntime = DEFAULT_SEARCH_RUNTIME,
): {
  provider: WebProvider;
  notice: string | null;
} {
  switch (config.provider) {
    case "wikipedia":
      return { provider: "wikipedia", notice: null };

    case "deepseek":
      // DeepSeek 搜索没有浏览器直连路径，必须登录后由服务端代发。
      return runtime.loggedIn
        ? { provider: "deepseek", notice: null }
        : {
            provider: "wikipedia",
            notice: "DeepSeek 搜索需要登录后由服务端代发，当前未登录，已改用维基百科（免密钥）",
          };

    case "tavily":
      if (runtime.mode === "server") {
        return runtime.loggedIn
          ? { provider: "tavily", notice: null }
          : {
              provider: "wikipedia",
              notice: "服务端 Tavily 代理需要登录，当前未登录，已改用维基百科（免密钥）",
            };
      }
      return config.tavilyApiKey.trim() === ""
        ? {
            provider: "wikipedia",
            notice: "未填写 Tavily 密钥，已改用维基百科（无需密钥）",
          }
        : { provider: "tavily", notice: null };

    default:
      return assertNeverProvider(config.provider);
  }
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

function classifyHttp(source: string, status: number): SearchError {
  if (status === 429) {
    return new SearchError("rate-limit", "搜索服务限流，请稍后再试");
  }
  if (status === 401 || status === 403) {
    return source === "Tavily"
      ? new SearchError("auth", "Tavily 密钥无效或无权限，请到设置页检查")
      : new SearchError("auth", `${source}拒绝了本次请求（HTTP ${status}）`);
  }
  if (status >= 500) {
    return new SearchError("http", `${source}搜索服务暂时不可用（HTTP ${status}），请稍后再试`);
  }
  return new SearchError("http", `${source}搜索失败（HTTP ${status}）`);
}

async function readJson(res: Response, source: string): Promise<unknown> {
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

// ── 服务端代理 ────────────────────────────────────────────────────

function providerText(provider: WebProvider): string {
  switch (provider) {
    case "deepseek":
      return "DeepSeek 搜索";
    case "tavily":
      return "Tavily 搜索";
    case "wikipedia":
      return "维基百科";
    default:
      return assertNeverProvider(provider);
  }
}

async function readErrorBody(res: Response): Promise<{ code: string; message: string }> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body)) {
      return {
        code: typeof body.code === "string" ? body.code : "",
        message: typeof body.error === "string" ? body.error : "",
      };
    }
  } catch {
    // 非 JSON 错误体：只保留状态码
  }
  return { code: "", message: "" };
}

/** 代理失败按 HTTP 状态与业务码分开：401 / 未配置 / 限流 / 超时各不相同。 */
function proxyFailure(
  provider: WebProvider,
  status: number,
  code: string,
  message: string,
): SearchError {
  const label = providerText(provider);
  if (status === 401 || code === "unauthorized") {
    return new SearchError(
      "unauthorized",
      "登录后才能使用服务端搜索代理，请先登录，或把供应商换成维基百科",
    );
  }
  if (status === 404 && code === "provider_not_configured") {
    return new SearchError(
      "not-configured",
      message === "" ? `${label}还没有在账号里配置，请到设置页保存密钥` : message,
    );
  }
  if (status === 429) {
    return new SearchError("rate-limit", message === "" ? "搜索服务限流，请稍后再试" : message);
  }
  if (status === 504) {
    return new SearchError("timeout", message === "" ? "服务端搜索超时，请稍后再试" : message);
  }
  if (status >= 500) {
    return new SearchError(
      "http",
      message === "" ? `${label}暂时不可用（HTTP ${status}）` : `${label}失败：${message}`,
    );
  }
  return new SearchError("http", message === "" ? `${label}失败（HTTP ${status}）` : message);
}

/** 服务端返回的 WebResult 形状与本地一致；仍然逐条校验，坏数据只丢这一条。 */
function normalizeServerResults(provider: WebProvider, raw: unknown): WebResult[] {
  if (!isRecord(raw) || !Array.isArray(raw.results)) {
    throw new SearchError("parse", "搜索代理返回了无法解析的数据");
  }

  const results: WebResult[] = [];
  const seen = new Set<string>();
  for (const item of raw.results) {
    if (!isRecord(item)) continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);

    const title = typeof item.title === "string" ? item.title.trim() : "";
    const snippet = typeof item.snippet === "string" ? item.snippet.trim() : "";
    results.push({
      title: title === "" ? url : title,
      url,
      snippet: snippet.slice(0, MAX_SNIPPET_CHARS),
      provider,
    });
    if (results.length === MAX_WEB_RESULTS) break;
  }

  if (results.length === 0) throw new SearchError("empty", "没有找到可用结果");
  return results;
}

/**
 * 经由本项目 POST /api/search 检索。
 *
 * 请求体只有 provider 与 query：baseUrl / 密钥 / 模型都来自账号配置，
 * 客户端连字段都不该有。
 */
export async function searchViaServer(
  provider: "deepseek" | "tavily",
  query: string,
  signal?: AbortSignal,
): Promise<WebResult[]> {
  const q = normalizeQuery(query);
  if (q === "") throw new SearchError("empty", "检索词为空，未发起搜索");

  const res = await fetchWithTimeout(
    SEARCH_PROXY_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, query: q }),
    },
    signal,
    SEARCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    const { code, message } = await readErrorBody(res);
    throw proxyFailure(provider, res.status, code, message);
  }

  return normalizeServerResults(provider, await readJson(res, providerText(provider)));
}

/** 按供应商分发。穷尽 switch：deepseek 恒走代理，tavily 看模式，维基百科直连。 */
async function dispatchSearch(
  provider: WebProvider,
  query: string,
  config: SearchConfig,
  runtime: SearchRuntime,
  signal: AbortSignal | undefined,
): Promise<WebResult[]> {
  switch (provider) {
    case "deepseek":
      return searchViaServer("deepseek", query, signal);
    case "tavily":
      return runtime.mode === "server"
        ? searchViaServer("tavily", query, signal)
        : searchTavily(query, config.tavilyApiKey, signal);
    case "wikipedia":
      return searchWikipedia(query, signal);
    default:
      return assertNeverProvider(provider);
  }
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
  runtime: SearchRuntime = DEFAULT_SEARCH_RUNTIME,
): Promise<SearchOutcome> {
  const { provider, notice } = resolveSearchProvider(config, runtime);
  const q = normalizeQuery(query);

  if (signal?.aborted) return failure(provider, notice, "aborted", "搜索已取消");
  if (q === "") return failure(provider, notice, "empty", "检索词为空，未发起搜索");

  const cached = readCache(provider, q);
  if (cached) {
    return { results: cached, provider, error: null, errorKind: null, fromCache: true, notice };
  }

  try {
    const results = await dispatchSearch(provider, q, config, runtime, signal);
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
