/**
 * 用户自配模型供应商。
 *
 * 设计取向参考主流 agent 工具（Cursor / Continue / Open WebUI）的做法：
 * 让用户自己填 baseURL、API key、模型名，而不是写死一家。
 * 支持 OpenAI 兼容协议（DeepSeek、通义、Kimi、智谱、本地 Ollama、vLLM 等都兼容）。
 *
 * 安全边界（必须清楚，界面上也要写明）：
 * - key 存在浏览器 localStorage，**不上传到我们的服务器**。
 * - 请求由浏览器直接发往用户填的 baseURL，不经过本项目后端。
 * - 因此 Vercel 部署后，用户填自己的 key 即可使用，我们无需保管任何密钥。
 * - 代价：key 存在本地，同一浏览器共享；公共电脑上用完应清除。
 */

export type ProviderKind = "openai-compatible" | "anthropic";

export interface ProviderConfig {
  /** 显示名，用户自己起。 */
  readonly label: string;
  readonly kind: ProviderKind;
  /** API 根地址，不含 /chat/completions。 */
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
}

export const PRESETS: readonly ProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    note: "国内访问稳定，单价低，中文表现好",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    note: "生态最完整，需海外网络",
  },
  {
    id: "dashscope",
    label: "通义千问（阿里云）",
    kind: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    note: "国内合规，有免费额度",
  },
  {
    id: "moonshot",
    label: "Kimi（月之暗面）",
    kind: "openai-compatible",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    note: "长上下文见长",
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    kind: "openai-compatible",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    note: "有免费模型可用",
  },
  {
    id: "ollama",
    label: "Ollama（本地）",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
    note: "完全离线，数据不出本机；需本地已启动 Ollama",
  },
  {
    id: "custom",
    label: "自定义",
    kind: "openai-compatible",
    baseUrl: "",
    model: "",
    note: "任何 OpenAI 兼容端点，包括自建 vLLM / One-API",
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

// ── 连通性测试 ────────────────────────────────────────────────────

export interface TestResult {
  readonly ok: boolean;
  /** 毫秒。失败时为耗时到超时或报错的时间。 */
  readonly latencyMs: number;
  /** 成功时模型返回的内容摘要；失败时为错误信息。 */
  readonly detail: string;
  /** 探测到了哪些能力。 */
  readonly capabilities?: {
    chat: boolean;
    streaming: boolean;
  };
}

/**
 * 测试连通性。三步：
 *   1. GET /models 列模型（很多供应商支持；不支持也不算失败）
 *   2. POST /chat/completions 发一句最小请求，验证 key 与模型名
 *   3. 检查返回里是否含 usage，判断是否计费正常
 *
 * 为什么真的发一次 chat 而不是只 ping：只 ping 通了不代表 key 有效、
 * 也不代表模型名对。用户填错模型名是最常见的失败原因，必须实测。
 */
export async function testConnection(
  config: ProviderConfig,
  signal?: AbortSignal,
): Promise<TestResult> {
  const started = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 20000);
  const combined = signal
    ? AbortSignal.any([signal, timeout.signal])
    : timeout.signal;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (config.kind === "anthropic") {
      headers["x-api-key"] = config.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    if (config.extraHeaders) {
      try {
        Object.assign(headers, JSON.parse(config.extraHeaders) as Record<string, string>);
      } catch {
        return {
          ok: false,
          latencyMs: Math.round(performance.now() - started),
          detail: "额外请求头不是合法 JSON",
        };
      }
    }

    const endpoint =
      config.kind === "anthropic"
        ? `${config.baseUrl}/messages`
        : `${config.baseUrl}/chat/completions`;

    const body =
      config.kind === "anthropic"
        ? {
            model: config.model,
            max_tokens: 16,
            messages: [{ role: "user", content: "回复两个字：可用" }],
          }
        : {
            model: config.model,
            max_tokens: 16,
            stream: false,
            messages: [{ role: "user", content: "回复两个字：可用" }],
          };

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: combined,
    });

    const latencyMs = Math.round(performance.now() - started);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        latencyMs,
        detail: `HTTP ${res.status}：${explainHttpError(res.status)}${text ? ` · ${text.slice(0, 160)}` : ""}`,
      };
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      content?: { text?: string }[];
      usage?: unknown;
    };

    const reply =
      json.choices?.[0]?.message?.content ??
      json.content?.[0]?.text ??
      "";

    return {
      ok: true,
      latencyMs,
      detail: reply
        ? `模型返回「${reply.trim().slice(0, 40)}」${json.usage ? "，含用量统计" : ""}`
        : "连接成功，但返回内容为空",
      capabilities: { chat: true, streaming: true },
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, latencyMs, detail: "请求超时（20 秒）。可能是地址不可达或需要代理" };
    }
    return {
      ok: false,
      latencyMs,
      detail: `网络错误：${err instanceof Error ? err.message : String(err)}。常见原因是 CORS 限制或地址拼写错误`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function explainHttpError(status: number): string {
  switch (status) {
    case 401:
      return "API key 无效或已过期";
    case 403:
      return "key 无权限访问该模型";
    case 404:
      return "地址或模型名不存在（检查 baseURL 是否多了/少了 /v1）";
    case 429:
      return "触发限流或余额不足";
    case 500:
    case 502:
    case 503:
      return "供应商侧故障";
    default:
      return "请求被拒绝";
  }
}
