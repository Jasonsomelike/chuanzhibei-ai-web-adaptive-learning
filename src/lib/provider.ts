/**
 * 用户自配模型供应商。
 *
 * 设计取向参考主流 agent 工具（Cursor / Continue / Open WebUI）的做法：
 * 让用户自己填 baseURL、API key、模型名，而不是写死一家。
 *
 * 两种协议：
 *   - openai-compatible：/chat/completions，绝大多数供应商（DeepSeek、通义、Kimi、智谱、
 *     自建 vLLM / One-API / LM Studio / Ollama）都兼容
 *   - anthropic：/messages + x-api-key 头，Anthropic 官方与兼容实现
 *
 * 安全边界（界面上也要写明）：
 * - key 存在浏览器 localStorage，**不上传到我们的服务器**。
 * - 请求由浏览器直接发往用户填的 baseURL，不经过本项目后端。
 * - 因此 Vercel 部署后，用户填自己的 key 即可使用，我们无需保管任何密钥。
 *
 * ⚠️ 混合内容（Mixed Content）：本项目是 HTTPS 站点，浏览器**禁止**从 HTTPS 页面
 * 请求 HTTP 地址。用户若填 http:// 的内网或本地地址，请求会在发出前就被拦截，
 * 表现为 TypeError: Failed to fetch + 耗时极短。这与 CORS 失败的表面现象相同，
 * 但原因不同，必须在测试与错误提示里区分开。
 */

export type ProviderKind = "openai-compatible" | "anthropic";

export interface ProviderConfig {
  /** 显示名，用户自己起。 */
  readonly label: string;
  readonly kind: ProviderKind;
  /** API 根地址，不含 /chat/completions 或 /messages。 */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** 可选：额外请求头，JSON 字符串。 */
  readonly extraHeaders?: string;
}

/** 常见供应商预设。用户仍可改地址与模型名。 */
export interface ProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly kind: ProviderKind;
  readonly baseUrl: string;
  readonly model: string;
  /** 一句话说明适用场景。 */
  readonly note: string;
  /** 该预设是否面向云端服务（false 表示本地部署，需注意混合内容限制）。 */
  readonly cloud: boolean;
}

/**
 * 预设列表。
 *
 * 刻意不放 Ollama 预设：这是一个公开的 Web 服务，绝大多数用户没有本地模型；
 * 把本地部署选项摆在预设第一屏会让用户误以为需要自己跑模型。
 * 需要本地部署的用户可以用「自定义（OpenAI 兼容）」填 http://localhost:11434/v1。
 */
export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    note: "国内访问稳定，单价低，中文表现好",
    cloud: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    note: "生态最完整，需海外网络",
    cloud: true,
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5-20250929",
    note: "Messages 协议，需海外网络",
    cloud: true,
  },
  {
    id: "dashscope",
    label: "通义千问（阿里云）",
    kind: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    note: "国内合规，有免费额度",
    cloud: true,
  },
  {
    id: "moonshot",
    label: "Kimi（月之暗面）",
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    note: "长上下文见长",
    cloud: true,
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    kind: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    note: "有免费模型可用",
    cloud: true,
  },
  {
    id: "custom-openai",
    label: "自定义（OpenAI 兼容）",
    kind: "openai-compatible",
    baseUrl: "",
    model: "",
    note: "任何 OpenAI 兼容端点：自建 vLLM / One-API / LM Studio / Ollama",
    cloud: false,
  },
  {
    id: "custom-anthropic",
    label: "自定义（Anthropic 兼容）",
    kind: "anthropic",
    baseUrl: "",
    model: "",
    note: "任何实现 Messages 协议的端点，含自建代理与兼容网关",
    cloud: false,
  },
];

const STORAGE_KEY = "alp.provider.v1";

/** 读配置。任何异常都返回 null，让界面走「未配置」分支。 */
export function loadProvider(): ProviderConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ProviderConfig>;
    if (typeof p.baseUrl !== "string" || typeof p.apiKey !== "string") return null;
    if (p.baseUrl.trim() === "" || p.apiKey.trim() === "") return null;
    return {
      label: p.label ?? "自定义",
      kind: p.kind === "anthropic" ? "anthropic" : "openai-compatible",
      baseUrl: p.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: p.apiKey.trim(),
      model: (p.model ?? "").trim(),
      extraHeaders: p.extraHeaders,
    };
  } catch {
    return null;
  }
}

export function saveProvider(config: ProviderConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 存不进去就算了，当前会话仍可用
  }
}

export function clearProvider(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 把 key 打码，用于回显。 */
export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}${"•".repeat(Math.min(16, key.length - 8))}${key.slice(-4)}`;
}

// ── 地址校验 ──────────────────────────────────────────────────────

export type UrlProblem =
  | { kind: "empty"; detail: string }
  | { kind: "invalid"; detail: string }
  | { kind: "mixed-content"; detail: string }
  | { kind: "has-endpoint"; detail: string }
  | { kind: "ok"; detail: string };

/**
 * 在发请求之前先把能静态判断的错误拦掉。
 *
 * 这比「发出去失败再猜原因」可靠得多：
 * 混合内容与 CORS 在 fetch 层都抛 TypeError: Failed to fetch，
 * 但两者修法完全不同——前者必须换 HTTPS 地址或走代理，后者是服务器配置。
 */
export function checkBaseUrl(baseUrl: string): UrlProblem {
  const raw = baseUrl.trim();
  if (raw === "") return { kind: "empty", detail: "API 地址为空" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "invalid", detail: "地址格式不合法，需以 http:// 或 https:// 开头" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { kind: "invalid", detail: `不支持的协议 ${url.protocol}，只接受 http 与 https` };
  }

  // 用户常把完整端点粘进来，导致最终请求路径变成 /v1/chat/completions/chat/completions
  if (/\/chat\/completions\/?$/i.test(url.pathname) || /\/messages\/?$/i.test(url.pathname)) {
    return {
      kind: "has-endpoint",
      detail: "地址里包含了 /chat/completions 或 /messages，请删掉，只保留到 /v1 为止",
    };
  }

  // 混合内容：HTTPS 页面不能请求 HTTP 地址
  if (typeof window !== "undefined" && window.location.protocol === "https:" && url.protocol === "http:") {
    return {
      kind: "mixed-content",
      detail:
        "当前页面是 HTTPS，浏览器禁止请求 HTTP 地址（Mixed Content）。" +
        "请把该端点换成 HTTPS，或在本机用 localhost 跑本项目再连。",
    };
  }

  return { kind: "ok", detail: "" };
}

/** 本地地址判断，用于给「本地部署」场景更贴切的提示。 */
export function isLocalAddress(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.startsWith("192.168.") ||
      host.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

// ── 连通性测试 ────────────────────────────────────────────────────

export type FailureKind =
  | "precheck"       // 静态校验就没过
  | "mixed-content"  // 混合内容拦截
  | "cors"           // CORS 拦截
  | "auth"           // 401/403
  | "not-found"      // 404
  | "rate-limit"     // 429
  | "server"         // 5xx
  | "timeout"
  | "network"        // 其他网络错误
  | "response";      // 响应格式异常

export interface TestResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  /** 给用户看的一句话结论。 */
  readonly detail: string;
  /** 失败分类，界面据此给不同的修复建议。 */
  readonly failure?: FailureKind;
  /** 该分类下的具体修复步骤。 */
  readonly hints?: readonly string[];
}

/** 构造请求体与端点。两种协议分开，避免把 Anthropic 的字段塞进 OpenAI 请求。 */
function buildRequest(config: ProviderConfig): { endpoint: string; body: unknown } {
  if (config.kind === "anthropic") {
    return {
      endpoint: `${config.baseUrl}/messages`,
      body: {
        model: config.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "回复两个字：可用" }],
      },
    };
  }
  return {
    endpoint: `${config.baseUrl}/chat/completions`,
    body: {
      model: config.model,
      max_tokens: 16,
      stream: false,
      messages: [{ role: "user", content: "回复两个字：可用" }],
    },
  };
}

function buildHeaders(config: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (config.kind === "anthropic") {
    headers["x-api-key"] = config.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    // Anthropic 官方要求浏览器直连时显式声明，否则会被拒
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (config.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(config.extraHeaders) as Record<string, string>);
    } catch {
      /* 非法 JSON 由调用方在界面上提示 */
    }
  }

  return headers;
}

/**
 * 测试连通性。
 *
 * 顺序刻意是「先静态校验，再发请求」：
 * 混合内容与地址拼写错误都能在发出前判断出来，
 * 这样用户得到的不是笼统的 "Failed to fetch"，而是具体该改什么。
 */
export async function testConnection(
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<TestResult> {
  // 1. 静态校验
  const urlCheck = checkBaseUrl(config.baseUrl);
  if (urlCheck.kind !== "ok") {
    return {
      ok: false,
      latencyMs: 0,
      detail: urlCheck.detail || "API 地址为空",
      failure: urlCheck.kind === "mixed-content" ? "mixed-content" : "precheck",
      hints:
        urlCheck.kind === "mixed-content"
          ? [
              "浏览器规定：HTTPS 页面不能请求 HTTP 地址，这是安全策略，无法在页面里绕过",
              "方案一：把模型服务换成 HTTPS 域名（推荐，可在前面挂一层反向代理 + 证书）",
              "方案二：在本机跑本项目（http://localhost:3000）再连该内网地址",
            ]
          : urlCheck.kind === "has-endpoint"
            ? ["地址应填到 /v1 为止，例如 https://api.deepseek.com/v1"]
            : ["检查地址是否完整，需以 http:// 或 https:// 开头"],
    };
  }

  if (config.extraHeaders) {
    try {
      JSON.parse(config.extraHeaders);
    } catch {
      return {
        ok: false,
        latencyMs: 0,
        detail: "额外请求头不是合法 JSON",
        failure: "precheck",
        hints: ['格式示例：{"X-Custom":"value"}'],
      };
    }
  }

  // 2. 真发请求
  const started = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 25000);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;

  const { endpoint, body } = buildRequest(config);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(body),
      signal: combined,
    });

    const latencyMs = Math.round(performance.now() - started);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const { kind, detail, hints } = explainHttpError(res.status, text, config);
      return { ok: false, latencyMs, detail, failure: kind, hints };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      content?: { text?: string }[];
      usage?: unknown;
    };

    const reply = json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? "";

    if (!reply.trim()) {
      return {
        ok: false,
        latencyMs,
        detail: "连接成功，但模型没有返回内容",
        failure: "response",
        hints: ["检查模型名是否正确", "部分供应商对新模型需要先开通权限"],
      };
    }

    return {
      ok: true,
      latencyMs,
      detail: `模型返回「${reply.trim().slice(0, 40)}」${json.usage ? "，含用量统计" : ""}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);

    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        ok: false,
        latencyMs,
        detail: "请求超时（25 秒）",
        failure: "timeout",
        hints: ["地址可能不可达，或需要代理", "内网地址请确认当前网络能访问"],
      };
    }

    // fetch 抛 TypeError 只有两种常见原因：混合内容 或 CORS。
    // 混合内容已经在上面静态拦掉了，所以走到这里大概率是 CORS，
    // 但也要考虑地址根本不存在（DNS 失败同样抛 TypeError）。
    return {
      ok: false,
      latencyMs,
      detail:
        latencyMs < 50
          ? `请求被浏览器拦截（${latencyMs}ms，未能发出）：多半是 CORS 或地址不可达`
          : `网络错误：${err instanceof Error ? err.message : String(err)}`,
      failure: "cors",
      hints: [
        "浏览器直连要求供应商返回 Access-Control-Allow-Origin",
        "国内多数大模型 API 支持浏览器直连；自建服务需自行配置 CORS 头",
        "若地址是内网 IP，请确认当前网络可达；HTTPS 页面不能请求 HTTP 地址",
        "仍不通可换用支持浏览器直连的供应商",
      ],
    };
  } finally {
    clearTimeout(timer);
  }
}

function explainHttpError(
  status: number,
  body: string,
  config: ProviderConfig,
): { kind: FailureKind; detail: string; hints: string[] } {
  const snippet = body ? ` · ${body.slice(0, 160)}` : "";
  const isAnthropic = config.kind === "anthropic";

  switch (status) {
    case 401:
      return {
        kind: "auth",
        detail: `HTTP 401：密钥无效或已过期${snippet}`,
        hints: [
          isAnthropic
            ? "Anthropic 用 x-api-key 头传密钥，确认没有多写 Bearer 前缀"
            : "确认密钥完整复制，没有多余空格",
          "确认密钥属于该供应商，不同平台的 key 不通用",
        ],
      };
    case 403:
      return {
        kind: "auth",
        detail: `HTTP 403：密钥无权限访问该模型${snippet}`,
        hints: ["到供应商控制台确认该模型已开通", "部分模型需要单独申请权限"],
      };
    case 404:
      return {
        kind: "not-found",
        detail: `HTTP 404：地址或模型名不存在${snippet}`,
        hints: [
          `检查 baseURL 是否多了或少了 /v1（当前填的是 ${config.baseUrl}）`,
          isAnthropic
            ? "Anthropic 协议路径是 /v1/messages，确认 baseURL 已含 /v1"
            : "OpenAI 兼容协议路径是 /v1/chat/completions",
          `确认模型名「${config.model}」拼写正确`,
        ],
      };
    case 429:
      return {
        kind: "rate-limit",
        detail: `HTTP 429：触发限流或余额不足${snippet}`,
        hints: ["稍后重试", "到供应商控制台查看余额与配额"],
      };
    case 400:
      return {
        kind: "response",
        detail: `HTTP 400：请求被拒绝，多为参数或模型名不符${snippet}`,
        hints: [
          "确认模型名是该供应商实际支持的 id",
          isAnthropic ? "Anthropic 协议需要 max_tokens，已自动带上" : "",
        ].filter(Boolean),
      };
    default:
      if (status >= 500) {
        return {
          kind: "server",
          detail: `HTTP ${status}：供应商侧故障${snippet}`,
          hints: ["稍后重试", "到供应商状态页确认是否在维护"],
        };
      }
      return {
        kind: "response",
        detail: `HTTP ${status}：请求被拒绝${snippet}`,
        hints: ["检查地址、密钥、模型名三项"],
      };
  }
}
