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
 * 两种运行模式（ProviderConfig.mode）：
 * - local（默认，旧存档即此模式）：key 存在浏览器 localStorage，
 *   **不上传到我们的服务器**；请求由浏览器直接发往用户填的 baseURL，不经过本项目后端。
 *   因此 Vercel 部署后，用户填自己的 key 即可使用，我们无需保管任何密钥。
 * - server：key 加密存在服务端（user_secrets），浏览器只发消息、由服务端代发；
 *   配置以 GET /api/config 的 llm 行水合进本地状态，本地**永远不写 apiKey**。
 *   这条路径解决 CORS / 混合内容限制，也让新设备登录后无需重填密钥。
 *
 * ⚠️ 混合内容（Mixed Content）：本项目是 HTTPS 站点，浏览器**禁止**从 HTTPS 页面
 * 请求 HTTP 地址。用户若填 http:// 的内网或本地地址，请求会在发出前就被拦截，
 * 表现为 TypeError: Failed to fetch + 耗时极短。这与 CORS 失败的表面现象相同，
 * 但原因不同，必须在测试与错误提示里区分开。server 模式不受此限制（请求发往本站）。
 */

import {
  buildThinkingBody,
  extractNonStreamingReasoning,
  extractNonStreamingText,
  type ThinkingStrength,
} from "@/lib/reasoning";

export type ProviderKind = "openai-compatible" | "anthropic";

/** 设置页探测思考参数的结论。unknown 表示没探测过或探测未完成。 */
export type ThinkingStatus = "unknown" | "verified" | "verified-empty" | "unsupported";

/**
 * 配置来源。
 * - local：浏览器直连（BYOK），key 只在 localStorage；
 * - server：服务端代发，key 在服务端密文里，本地 apiKey 恒为空。
 *
 * 旧存档没有 mode 字段：只要存过 apiKey 就按 local 解释（见 loadProvider）。
 */
export type ProviderMode = "local" | "server";

/** 向量化能力状态。unsupported 表示服务端明确回了 404/503，而不是网络抖动。 */
export type EmbeddingStatus = "unknown" | "available" | "unsupported";

export interface ProviderConfig {
  /** 显示名，用户自己起。 */
  readonly label: string;
  readonly kind: ProviderKind;
  /** API 根地址，不含 /chat/completions 或 /messages。 */
  readonly baseUrl: string;
  /**
   * local 模式必填；server 模式恒为空串——密钥只在服务端密文里，
   * 浏览器不持有，也不从 GET /api/config 读回。
   */
  readonly apiKey: string;
  readonly model: string;
  /** 可选：额外请求头，JSON 字符串。 */
  readonly extraHeaders?: string;
  /**
   * 思考强度。只作用于导师流式问答（callChatStream）；
   * callChat 故意不读，避免出题 JSON 被思考 token 吃光。
   * server 模式下由服务端配置决定，客户端发送的档位不生效。
   */
  readonly thinking?: ThinkingStrength;
  /** 探测结论。写回只发生在调用方（设置页/导师页），本模块不自己改。 */
  readonly thinkingStatus?: ThinkingStatus;
  /** 依据核对开关，默认开。 */
  readonly verification?: boolean;
  /** 缺省按 local 解释，兼容没有该字段的旧存档。 */
  readonly mode?: ProviderMode;
  /** server 模式下服务端是否已有 llm 配置；其它模式无意义。 */
  readonly serverConfigured?: boolean;
  /** 服务端保存的向量模型名；空表示没有向量能力，检索退化为纯 BM25。 */
  readonly embeddingModel?: string;
  /** 向量能力状态，只由 404/503 这类明确拒绝写成 unsupported。 */
  readonly embeddingStatus?: EmbeddingStatus;
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
    if (typeof p.baseUrl !== "string") return null;

    /*
     * 旧存档没有 mode：存过 apiKey 就是 local（历史行为）。
     * server 模式反过来——apiKey 本来就不落盘，用「key 为空」判模式会把
     * 服务端代发误判成「没配置」，因此这里只认显式的 mode 字段。
     */
    const mode: ProviderMode = p.mode === "server" ? "server" : "local";
    const storedKey = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
    if (mode === "server") {
      // 服务端没有 llm 行时 serverConfigured=false：配置记住了但不可用
      if (p.serverConfigured !== true) return null;
    } else {
      if (p.baseUrl.trim() === "" || storedKey === "") return null;
    }

    return {
      label: p.label ?? (mode === "server" ? "服务端配置" : "自定义"),
      kind: p.kind === "anthropic" ? "anthropic" : "openai-compatible",
      baseUrl: p.baseUrl.trim().replace(/\/+$/, ""),
      // server 模式即使旧存档里残留过 key，也不读回内存
      apiKey: mode === "server" ? "" : storedKey,
      model: (p.model ?? "").trim(),
      extraHeaders: p.extraHeaders,
      /*
       * 三项必须显式读出并补默认值。只靠 saveProvider 写入是不够的：
       * 旧存档、别处构造的 config、以及 save() 漏字段，都会让
       * 「保存 → 刷新 → 再读」丢掉 unsupported 与核对开关。
       */
      thinking: p.thinking === "standard" || p.thinking === "deep" ? p.thinking : "off",
      thinkingStatus:
        p.thinkingStatus === "verified" ||
        p.thinkingStatus === "verified-empty" ||
        p.thinkingStatus === "unsupported"
          ? p.thinkingStatus
          : "unknown",
      verification: p.verification !== false,
      mode,
      serverConfigured: p.serverConfigured === true,
      ...(typeof p.embeddingModel === "string" && p.embeddingModel.trim() !== ""
        ? { embeddingModel: p.embeddingModel.trim() }
        : {}),
      embeddingStatus:
        p.embeddingStatus === "available" || p.embeddingStatus === "unsupported"
          ? p.embeddingStatus
          : "unknown",
    };
  } catch {
    return null;
  }
}

export function saveProvider(config: ProviderConfig): void {
  if (typeof window === "undefined") return;
  try {
    const mode = effectiveProviderMode(config);
    // 三项显式落盘：调用方构造的 config 可能没有它们，读回时才能区分
    // 「用户显式关掉」与「从来没存过」。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...config,
        mode,
        /*
         * server 模式不写 key：密钥只存在服务端密文里。
         * 写空串而不是省略字段，保证从 local 切到 server 时旧 key 被覆盖掉。
         */
        apiKey: mode === "server" ? "" : config.apiKey,
        thinking: config.thinking ?? "off",
        thinkingStatus: config.thinkingStatus ?? "unknown",
        verification: config.verification !== false,
      }),
    );
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

// ── 运行模式与就绪判定 ────────────────────────────────────────────

/** 缺省按 local：旧存档、设置页构造的 config 都不带 mode。 */
export function effectiveProviderMode(config: ProviderConfig): ProviderMode {
  return config.mode === "server" ? "server" : "local";
}

/**
 * 「能不能发起模型调用」的唯一判定。
 *
 * local 需要用户填齐三项（key 在浏览器）；server 只看服务端有没有 llm 行——
 * 本地 apiKey 恒为空，拿它判就绪会让每个新设备都掉进「未配置」分支。
 * 注意与 `provider !== null` 的区别：serverConfigured=false 的配置对象存在，但不可用。
 */
export function isProviderReady(config: ProviderConfig | null | undefined): boolean {
  if (config === null || config === undefined) return false;
  if (effectiveProviderMode(config) === "server") return config.serverConfigured === true;
  return (
    config.baseUrl.trim() !== "" &&
    config.apiKey.trim() !== "" &&
    config.model.trim() !== ""
  );
}

// ── 从服务端水合 ──────────────────────────────────────────────────

/** GET /api/config 里 llm 槽位的公开字段；只取这里列出的键。 */
interface ServerLlmEntry {
  readonly configured: boolean;
  readonly label: string;
  readonly api: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly options: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readLlmEntry(json: unknown): ServerLlmEntry | null {
  const llm = asRecord(asRecord(json)["config"])["llm"];
  if (typeof llm !== "object" || llm === null) return null;
  const record = llm as Record<string, unknown>;
  return {
    configured: record["configured"] === true,
    label: textOf(record["label"]),
    api: textOf(record["api"]),
    baseUrl: textOf(record["baseUrl"]),
    model: textOf(record["model"]),
    options: asRecord(record["options"]),
  };
}

function thinkingOf(value: unknown): ThinkingStrength {
  return value === "standard" || value === "deep" ? value : "off";
}

function thinkingStatusOf(value: unknown): ThinkingStatus {
  return value === "verified" || value === "verified-empty" || value === "unsupported"
    ? value
    : "unknown";
}

function embeddingStatusOf(value: unknown): EmbeddingStatus {
  return value === "available" || value === "unsupported" ? value : "unknown";
}

/** 服务端确认没有 llm 行：更新标记，但绝不覆盖一份可用的本地配置。 */
function withoutServerConfig(): ProviderConfig {
  const current = loadProvider();
  if (current !== null && effectiveProviderMode(current) === "local") {
    return { ...current, serverConfigured: false };
  }

  const base: ProviderConfig = current ?? {
    label: "服务端配置",
    kind: "openai-compatible",
    baseUrl: "",
    apiKey: "",
    model: "",
  };
  const next: ProviderConfig = {
    ...base,
    apiKey: "",
    mode: "server",
    serverConfigured: false,
  };
  saveProvider(next);
  return next;
}

/**
 * 用服务端保存的 llm 配置水合本地状态。
 *
 * 返回 null 表示**什么都没变**：未登录（401）、网络错误、响应形状不对。
 * 只有服务端明确回答「有」或「没有」时才写本地存档，避免一次网络抖动
 * 把一份能用的配置清成「未配置」。
 *
 * 有 llm 行时 apiKey 恒为空：密钥只留在服务端密文里，浏览器不持有。
 * 无 llm 行时保留已有 local 配置——用户自带的 key 仍是可用路径。
 */
export async function hydrateProviderFromServer(signal?: AbortSignal): Promise<ProviderConfig | null> {
  if (typeof window === "undefined") return null;

  let response: Response;
  try {
    response = await fetch("/api/config", { cache: "no-store", signal });
  } catch {
    return null;
  }
  if (response.status === 401) return null;
  if (!response.ok) return null;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return null;
  }

  const entry = readLlmEntry(json);
  if (entry === null) return null;
  if (!entry.configured) return withoutServerConfig();

  const embeddingModel = textOf(entry.options["embeddingModel"]);
  const next: ProviderConfig = {
    label: entry.label !== "" ? entry.label : "服务端配置",
    kind: entry.api === "anthropic" ? "anthropic" : "openai-compatible",
    baseUrl: entry.baseUrl.replace(/\/+$/, ""),
    apiKey: "",
    model: entry.model,
    thinking: thinkingOf(entry.options["thinking"]),
    thinkingStatus: thinkingStatusOf(entry.options["thinkingStatus"]),
    verification: entry.options["verification"] !== false,
    ...(embeddingModel !== "" ? { embeddingModel } : {}),
    embeddingStatus: embeddingStatusOf(entry.options["embeddingStatus"]),
    mode: "server",
    serverConfigured: true,
  };
  saveProvider(next);
  return next;
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

// ── 请求构造（chat.ts 与本文件的连通性测试共用） ──────────────────

/** 文本片段。system 里的 parts 只取这些片段拼接，图片不会进 system。 */
export interface ChatTextPart {
  readonly type: "text";
  readonly text: string;
}

/** 图片片段。只接受 data:image/...;base64，不接受 http(s) URL。 */
export interface ChatImagePart {
  readonly type: "image_url";
  readonly image_url: {
    readonly url: string;
    readonly detail?: "auto" | "low" | "high";
  };
}

export type ChatContentPart = ChatTextPart | ChatImagePart;
/** 一条消息的正文：旧字符串，或「文本/图片」parts 数组。 */
export type ChatContent = string | readonly ChatContentPart[];

/** OpenAI 兼容协议的函数工具定义。 */
export interface ChatToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: Record<string, unknown>;
  };
}

/** auto/none/required，或指定某个函数。 */
export type ChatToolChoice =
  | "auto"
  | "none"
  | "required"
  | { readonly type: "function"; readonly function: { readonly name: string } };

export type ProviderCapability = "tools" | "image";

/**
 * 请求里带了当前协议发不出的能力。
 *
 * 单独成类是为了让 chat.ts 能把它折成 ChatError("unsupported")，
 * 而不是伪装成网络错误；调用方据此给「换协议 / 改为文字提问」的明确提示。
 */
export class ProviderCapabilityError extends Error {
  readonly capability: ProviderCapability;

  constructor(capability: ProviderCapability, message: string) {
    super(message);
    this.name = "ProviderCapabilityError";
    this.capability = capability;
  }
}

export interface ChatBodyRequest {
  readonly system?: ChatContent;
  readonly user: ChatContent;
  /** Bounded prompt history; the complete conversation is stored separately. */
  readonly history?: readonly { role: "user" | "assistant"; content: string }[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** 要求模型返回 JSON 对象。Anthropic 无此参数，靠提示词与 extractJson 兜底。 */
  readonly jsonMode?: boolean;
  /** 函数工具定义。只有 OpenAI 兼容协议会写进请求体。 */
  readonly tools?: readonly ChatToolDefinition[];
  /** 工具选择策略。Anthropic 协议收到它（或 tools）会抛 ProviderCapabilityError。 */
  readonly toolChoice?: ChatToolChoice;
}
export function chatHistoryOf(request: ChatBodyRequest) {
  return (request.history ?? []).slice(-8).filter(message => message.content.trim()).map(message => ({ role:message.role,content:message.content.slice(0,1500) }));
}

/** data URI 的严格形式；http(s) 地址在这里天然不匹配。 */
const DATA_IMAGE_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u;

/**
 * 取消息里的可读文本。
 *
 * system 与结构化重试的提示词只需要文本；图片在文本位置上没有意义。
 * 逐片段拼接而不是 String(part)，否则会得到 "[object Object]"。
 */
export function contentTextOf(content: ChatContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is ChatTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * 把正文转成 Anthropic 的 content 形状。
 * 字符串原样返回；parts 里的图片转成 base64 image block（去掉 data: 前缀）。
 */
export function anthropicContentOf(content: ChatContent): unknown {
  if (typeof content === "string") return content;
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const match = DATA_IMAGE_URL.exec(part.image_url.url);
    if (match === null) {
      throw new ProviderCapabilityError(
        "image",
        "Anthropic 协议只接受 data:image/(jpeg|png|webp|gif);base64 图片，不接受 http(s) URL",
      );
    }
    return {
      type: "image",
      source: { type: "base64", media_type: match[1], data: match[2] },
    };
  });
}

export interface BuiltChatBody {
  readonly body: Record<string, unknown>;
  readonly maxTokens: number;
  /** 是否写入了思考字段；400 降级只对这类请求重发一次。 */
  readonly thinkingFields: boolean;
}

export function buildProviderHeaders(config: ProviderConfig): Record<string, string> {
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
 * 两种协议的请求体在这里统一构造。
 *
 * system/messages/jsonMode/temperature 的规则只写一份：chat.ts 的
 * callChat 与 callChatStream、本文件的 testConnection 都走这里，
 * 避免「流式会删 temperature、非流式忘了删」这类分支漂移。
 *
 * 思考字段由 buildThinkingBody 按档位矩阵增删：关档字段完全不出现，
 * 开档删采样参数并抬高 max_tokens。
 */
export function buildChatBody(
  kind: ProviderKind,
  provider: Pick<ProviderConfig, "model">,
  req: ChatBodyRequest,
  strength: ThinkingStrength,
): BuiltChatBody {
  /*
   * Anthropic 的 Messages 协议也有 tool_use，但本项目的 Anthropic 分支不实现
   * 「发 tools → 收 tool_use」的循环。静默丢掉 tools 会让调用方以为工具轮成功了，
   * 实际拿到一段没有工具依据的正文，所以这里必须显式失败。
   */
  const hasTools = req.tools !== undefined && req.tools.length > 0;
  if (kind === "anthropic" && (hasTools || req.toolChoice !== undefined)) {
    throw new ProviderCapabilityError(
      "tools",
      "Anthropic 协议不支持工具调用：请不要向 kind=anthropic 的请求传 tools / toolChoice",
    );
  }

  const maxTokens = req.maxTokens ?? 600;
  const temperature = req.temperature ?? 0.3;
  const systemText = req.system === undefined ? "" : contentTextOf(req.system);

  const base: Record<string, unknown> =
    kind === "anthropic"
      ? {
          model: provider.model,
          max_tokens: maxTokens,
          temperature,
          // Anthropic 的 system 只能是字符串；parts 只拼文本，图片不进 system。
          ...(systemText !== "" ? { system: systemText } : {}),
          messages: [...chatHistoryOf(req),{ role: "user", content: anthropicContentOf(req.user) }],
        }
      : {
          model: provider.model,
          temperature,
          max_tokens: maxTokens,
          ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
          // 只有 OpenAI 兼容协议能直接透传 tools；图片 parts 也原样交给上游。
          ...(hasTools ? { tools: req.tools } : {}),
          ...(req.toolChoice !== undefined ? { tool_choice: req.toolChoice } : {}),
          messages: [
            ...(systemText !== "" ? [{ role: "system", content: systemText }] : []),
            ...chatHistoryOf(req),
            { role: "user", content: req.user },
          ],
        };

  return buildThinkingBody(kind, strength, base, maxTokens);
}

/** 构造连通性测试的请求体与端点。 */
function buildRequest(config: ProviderConfig): { endpoint: string; body: unknown } {
  const anthropic = config.kind === "anthropic";
  /*
   * 不能只给 16：推理模型（deepseek-v4、o 系列等）的思考 token 也计入
   * max_tokens，16 会被推理吃光、content 为空，于是连通性被误判成失败。
   * 64 仍是一个可以忽略的成本，但足够让多数推理模型走到正文。
   */
  const built = buildChatBody(
    config.kind,
    config,
    { user: "回复两个字：可用", maxTokens: 64 },
    "off",
  );
  return {
    endpoint: `${config.baseUrl}${anthropic ? "/messages" : "/chat/completions"}`,
    body: anthropic ? built.body : { ...built.body, stream: false },
  };
}

/** 结束原因：OpenAI 在 choices[0].finish_reason，Anthropic 在顶层 stop_reason。 */
function finishReasonOf(json: Record<string, unknown>): string {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const first = choices[0];
  if (typeof first === "object" && first !== null) {
    const reason = (first as Record<string, unknown>).finish_reason;
    if (typeof reason === "string" && reason !== "") return reason;
  }
  return typeof json.stop_reason === "string" ? json.stop_reason : "";
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
      headers: buildProviderHeaders(config),
      body: JSON.stringify(body),
      signal: combined,
    });

    const latencyMs = Math.round(performance.now() - started);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const { kind, detail, hints } = explainHttpError(res.status, text, config);
      return { ok: false, latencyMs, detail, failure: kind, hints };
    }

    const json = (await res.json()) as Record<string, unknown>;
    // 与 callChat 共用解析：Anthropic 的 thinking 块在前时，正文仍要取到 type=text
    const reply = extractNonStreamingText(config.kind, json);
    const reasoning = extractNonStreamingReasoning(config.kind, json);
    const finishReason = finishReasonOf(json);
    const hasUsage = typeof json.usage === "object" && json.usage !== null;

    /*
     * 200 + 合法响应体 + finish_reason=length 但正文为空，说明端点、密钥、模型名都对，
     * 只是 token 预算被推理内容吃掉。这属于「连得上」，不能报成响应异常——
     * 否则每个推理模型第一次测连通性都会红，用户会以为地址填错了。
     */
    if (!reply.trim() && (finishReason === "length" || reasoning.trim() !== "")) {
      return {
        ok: true,
        latencyMs,
        detail: "连接成功（模型把 token 先用在了推理上，未输出正文；提问不受影响）",
      };
    }

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
      detail: `模型返回「${reply.trim().slice(0, 40)}」${hasUsage ? "，含用量统计" : ""}`,
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
