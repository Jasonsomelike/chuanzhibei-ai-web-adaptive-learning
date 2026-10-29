/**
 * 外部端点真机探测。
 *
 * 用法：
 *   npm run probe:external                    # 三个都探（缺凭据的标「未验证」）
 *   npm run probe:external -- --deepseek-search
 *   npm run probe:external -- --mimo
 *   npm run probe:external -- --embedding
 *
 * 输出纪律（写进 docs/verification 时同样遵守）：
 * - 只打印 status、content-type、顶层 keys、results 数、音频字节数与首 4 字节；
 * - 绝不打印密钥、Authorization、base64、完整响应正文或请求体；
 * - 没有凭据时打印「未验证：缺少 X」，退出码仍为 0——没测就是没测，不编结果；
 * - 有凭据但探测失败时退出码为 1，方便 CI 或人工发现。
 */

import { buildMimoTtsBody, decodeBase64Audio, mimoEndpoint, parseMimoTtsResponse } from "@/lib/mimo";
import { isDeepSeekBaseUrl } from "@/lib/serverSearch";

// tsx 不会自动读取 .env.local；shell 里直接给变量时 loadEnvFile 失败也无妨。
try {
  process.loadEnvFile(".env.local");
} catch {
  // 文件不存在或运行环境不支持
}

const TIMEOUT_MS = 30_000;
const DEEPSEEK_SEARCH_URL = "https://api.deepseek.com/v1/tools/search";

type ProbeName = "deepseek-search" | "mimo" | "embedding";
type ProbeStatus = "ok" | "failed" | "unverified";

interface ProbeResult {
  readonly name: ProbeName;
  readonly title: string;
  readonly status: ProbeStatus;
  readonly lines: readonly string[];
}

interface HttpResponse {
  readonly status: number;
  readonly contentType: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envText(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** 打印端点时去掉 userinfo 与 query，避免误把凭据带到记录里。 */
function safeEndpoint(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "<非法地址>";
  }
}

function topLevelKeys(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? Object.keys(parsed).sort() : [];
  } catch {
    return [];
  }
}

async function post(
  url: string,
  headers: Readonly<Record<string, string>>,
  body: string,
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
      signal: controller.signal,
    });
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return {
      status: res.status,
      contentType: (res.headers.get("content-type") ?? "").toLowerCase(),
      bytes,
      text: new TextDecoder().decode(bytes),
    };
  } finally {
    clearTimeout(timer);
  }
}

function firstBytes(bytes: Uint8Array, count: number): string {
  return [...bytes.subarray(0, count)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

function isId3(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
}

function result(
  name: ProbeName,
  title: string,
  status: ProbeStatus,
  lines: readonly string[],
): ProbeResult {
  return { name, title, status, lines };
}

// ── DeepSeek 搜索 ──────────────────────────────────────────────────

function deepseekKey(): { key: string; source: string } | null {
  const direct = envText("DEEPSEEK_API_KEY");
  if (direct !== "") return { key: direct, source: "DEEPSEEK_API_KEY" };

  const base = envText("ALP_E2E_LLM_BASE_URL");
  const key = envText("ALP_E2E_LLM_API_KEY");
  if (key !== "" && isDeepSeekBaseUrl(base)) {
    return { key, source: "ALP_E2E_LLM_API_KEY（base_url 是 api.deepseek.com）" };
  }
  return null;
}

function missingDeepseekReason(): string {
  const base = envText("ALP_E2E_LLM_BASE_URL");
  const key = envText("ALP_E2E_LLM_API_KEY");
  if (key !== "" && base !== "") {
    let host = "<非法地址>";
    try {
      host = new URL(base).host;
    } catch {
      // 保持原文
    }
    return `缺少 DeepSeek 官方搜索凭据：ALP_E2E_LLM_BASE_URL 的主机是 ${host}，不是 api.deepseek.com；也没有 DEEPSEEK_API_KEY`;
  }
  if (key !== "") return "缺少 DeepSeek 官方搜索凭据：只有 ALP_E2E_LLM_API_KEY，且没有可确认的 DeepSeek base_url";
  return "缺少 DEEPSEEK_API_KEY（或 base_url 为 api.deepseek.com 的 ALP_E2E_LLM_API_KEY）";
}

async function probeDeepseekSearch(): Promise<ProbeResult> {
  const credential = deepseekKey();
  if (credential === null) {
    return result("deepseek-search", "DeepSeek 搜索", "unverified", [
      `POST ${DEEPSEEK_SEARCH_URL}`,
      `未验证：${missingDeepseekReason()}`,
    ]);
  }

  const lines: string[] = [`POST ${DEEPSEEK_SEARCH_URL}`, `凭据：${credential.source}`];
  try {
    const res = await post(
      DEEPSEEK_SEARCH_URL,
      { Authorization: `Bearer ${credential.key}` },
      JSON.stringify({ query: "传智杯", count: 3, need_content: true }),
    );
    lines.push(`status: ${res.status}`);
    lines.push(`content-type: ${res.contentType === "" ? "<空>" : res.contentType}`);
    const keys = topLevelKeys(res.text);
    lines.push(`顶层 keys: ${keys.length === 0 ? "<非 JSON 或空对象>" : keys.join(", ")}`);

    let count = 0;
    try {
      const parsed = JSON.parse(res.text) as unknown;
      if (isRecord(parsed) && Array.isArray(parsed.results)) count = parsed.results.length;
    } catch {
      count = 0;
    }
    lines.push(`results: ${count}`);

    if (res.status >= 200 && res.status < 300 && count > 0) {
      return result("deepseek-search", "DeepSeek 搜索", "ok", [
        ...lines,
        "结论：通过（端点可达且返回了搜索结果）",
      ]);
    }
    return result("deepseek-search", "DeepSeek 搜索", "failed", [
      ...lines,
      `结论：失败（HTTP ${res.status}，未打印响应正文）`,
    ]);
  } catch (error) {
    return result("deepseek-search", "DeepSeek 搜索", "failed", [
      ...lines,
      `结论：失败（${error instanceof Error ? error.name : "网络错误"}，未打印响应正文）`,
    ]);
  }
}

// ── MiMo 语音 ─────────────────────────────────────────────────────

async function probeMimo(): Promise<ProbeResult> {
  const base = envText("MIMO_BASE_URL");
  const key = envText("MIMO_API_KEY");
  const model = envText("MIMO_MODEL");
  const voice = envText("MIMO_VOICE") || "茉莉";

  const missing: string[] = [];
  if (base === "") missing.push("MIMO_BASE_URL");
  if (key === "") missing.push("MIMO_API_KEY");
  if (model === "") missing.push("MIMO_MODEL");

  const endpoint = mimoEndpoint(base);
  if (missing.length > 0 || endpoint === "") {
    return result("mimo", "MiMo 语音合成", "unverified", [
      `端点：${endpoint === "" ? "<未配置>" : safeEndpoint(endpoint)}`,
      `未验证：缺少 ${missing.join(" / ")}`,
    ]);
  }

  const lines: string[] = [
    `POST ${safeEndpoint(endpoint)}`,
    "请求路径：chat/completions（不是 /audio/speech）",
  ];
  try {
    const res = await post(
      endpoint,
      { Authorization: `Bearer ${key}` },
      JSON.stringify(buildMimoTtsBody({ model, text: "你好，这是一次语音端点探测。", voice })),
    );
    lines.push(`status: ${res.status}`);
    lines.push(`content-type: ${res.contentType === "" ? "<空>" : res.contentType}`);
    const keys = topLevelKeys(res.text);
    lines.push(`顶层 keys: ${keys.length === 0 ? "<非 JSON 或空对象>" : keys.join(", ")}`);

    if (res.status < 200 || res.status >= 300) {
      return result("mimo", "MiMo 语音合成", "failed", [
        ...lines,
        `结论：失败（HTTP ${res.status}，未打印响应正文）`,
      ]);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.text) as unknown;
    } catch {
      return result("mimo", "MiMo 语音合成", "failed", [
        ...lines,
        "结论：失败（响应不是 JSON）",
      ]);
    }
    const data = parseMimoTtsResponse(parsed);
    if (data === null) {
      return result("mimo", "MiMo 语音合成", "failed", [
        ...lines,
        "结论：失败（响应里没有 choices[0].message.audio.data）",
      ]);
    }
    const audio = decodeBase64Audio(data);
    if (audio === null) {
      return result("mimo", "MiMo 语音合成", "failed", [
        ...lines,
        "结论：失败（audio.data 不是合法 base64）",
      ]);
    }
    lines.push(`audio 字节数: ${audio.byteLength}`);
    lines.push(`首 4 字节: ${firstBytes(audio, 4)}`);
    lines.push(`ID3 头: ${isId3(audio) ? "是" : "否"}`);
    return result("mimo", "MiMo 语音合成", audio.byteLength > 0 ? "ok" : "failed", [
      ...lines,
      audio.byteLength > 0
        ? "结论：通过（返回了非空 mp3 字节）"
        : "结论：失败（返回了空音频）",
    ]);
  } catch (error) {
    return result("mimo", "MiMo 语音合成", "failed", [
      ...lines,
      `结论：失败（${error instanceof Error ? error.name : "网络错误"}，未打印响应正文）`,
    ]);
  }
}

// ── Embedding ─────────────────────────────────────────────────────

function embeddingEndpoint(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  return /\/embeddings$/i.test(trimmed) ? trimmed : `${trimmed}/embeddings`;
}

async function probeEmbedding(): Promise<ProbeResult> {
  const base = envText("ALP_EMBED_BASE_URL");
  const key = envText("ALP_EMBED_API_KEY");
  const model = envText("ALP_EMBED_MODEL");

  const missing: string[] = [];
  if (base === "") missing.push("ALP_EMBED_BASE_URL");
  if (key === "") missing.push("ALP_EMBED_API_KEY");
  if (model === "") missing.push("ALP_EMBED_MODEL");

  const endpoint = embeddingEndpoint(base);
  if (missing.length > 0 || endpoint === "") {
    return result("embedding", "Embedding 向量", "unverified", [
      `端点：${endpoint === "" ? "<未配置>" : safeEndpoint(endpoint)}`,
      `未验证：缺少 ${missing.join(" / ")}`,
    ]);
  }

  const lines: string[] = [`POST ${safeEndpoint(endpoint)}`];
  try {
    const res = await post(
      endpoint,
      { Authorization: `Bearer ${key}` },
      JSON.stringify({ model, input: ["连接测试"] }),
    );
    lines.push(`status: ${res.status}`);
    lines.push(`content-type: ${res.contentType === "" ? "<空>" : res.contentType}`);
    const keys = topLevelKeys(res.text);
    lines.push(`顶层 keys: ${keys.length === 0 ? "<非 JSON 或空对象>" : keys.join(", ")}`);

    if (res.status < 200 || res.status >= 300) {
      return result("embedding", "Embedding 向量", "failed", [
        ...lines,
        `结论：失败（HTTP ${res.status}，未打印响应正文）`,
      ]);
    }

    let count = 0;
    let dimension = 0;
    try {
      const parsed = JSON.parse(res.text) as unknown;
      if (isRecord(parsed) && Array.isArray(parsed.data)) {
        count = parsed.data.length;
        const first = parsed.data[0];
        if (isRecord(first) && Array.isArray(first.embedding)) dimension = first.embedding.length;
      }
    } catch {
      // 上面的顶层 keys 已经说明不是 JSON
    }
    lines.push(`data 条数: ${count}`);
    lines.push(`维度: ${dimension}`);

    const ok = count > 0 && dimension > 0;
    return result("embedding", "Embedding 向量", ok ? "ok" : "failed", [
      ...lines,
      ok ? "结论：通过（返回了非空向量）" : "结论：失败（没有返回向量）",
    ]);
  } catch (error) {
    return result("embedding", "Embedding 向量", "failed", [
      ...lines,
      `结论：失败（${error instanceof Error ? error.name : "网络错误"}，未打印响应正文）`,
    ]);
  }
}

// ── 入口 ──────────────────────────────────────────────────────────

const PROBES: Record<ProbeName, () => Promise<ProbeResult>> = {
  "deepseek-search": probeDeepseekSearch,
  mimo: probeMimo,
  embedding: probeEmbedding,
};

function parseArgs(argv: readonly string[]): ProbeName[] {
  if (argv.length === 0) return ["deepseek-search", "mimo", "embedding"];
  const selected: ProbeName[] = [];
  for (const arg of argv) {
    if (arg === "--deepseek-search" || arg === "--mimo" || arg === "--embedding") {
      const name = arg.slice(2) as ProbeName;
      if (!selected.includes(name)) selected.push(name);
      continue;
    }
    throw new Error(
      `未知参数 ${arg}；只支持 --deepseek-search / --mimo / --embedding（不带参数表示全部）`,
    );
  }
  return selected;
}

async function main(): Promise<number> {
  let selected: ProbeName[];
  try {
    selected = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  console.log("外部端点真机探测");
  console.log("═".repeat(72));
  console.log("只打印 status / content-type / 顶层 keys / 结果数 / 音频头；不打印密钥与正文。");

  const results: ProbeResult[] = [];
  for (const name of selected) {
    const outcome = await PROBES[name]();
    results.push(outcome);
    console.log("");
    console.log(`== ${outcome.title} ==`);
    for (const line of outcome.lines) console.log(line);
  }

  const failed = results.filter((item) => item.status === "failed");
  const unverified = results.filter((item) => item.status === "unverified");
  console.log("");
  console.log("─".repeat(72));
  console.log(
    `汇总：通过 ${results.filter((item) => item.status === "ok").length} / ` +
      `失败 ${failed.length} / 未验证 ${unverified.length}`,
  );
  return failed.length > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`\nFAIL ${message}`);
  process.exitCode = 1;
}
