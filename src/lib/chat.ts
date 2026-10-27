/**
 * 浏览器直连模型供应商的统一客户端。
 *
 * 为什么统一：方向页与导师页原先各有一份几乎相同的 callProvider，
 * 两份都在处理「OpenAI 兼容 vs Anthropic」「超时」「空返回」，
 * 任何一处漏改都会让某条路径的行为和另一条不一致。
 *
 * 为什么仍然在浏览器直连：用户的 key 不该经过我们的服务器。
 * 代价是受 CORS 与混合内容约束（见 provider.ts 的说明）。
 */

import type { ProviderConfig } from "@/lib/provider";

export interface ChatRequest {
  readonly system?: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** 要求模型返回 JSON 对象。Anthropic 无此参数，靠提示词与 extractJson 兜底。 */
  readonly jsonMode?: boolean;
  /** 超时毫秒数，默认 60 秒。 */
  readonly timeoutMs?: number;
  /**
   * 外部取消信号。诊断页「取消并跳过」必须能真正中断已发出的请求，
   * 否则用户以为停了，请求仍在跑、仍在计费。
   */
  readonly signal?: AbortSignal;
}

export interface ChatResult {
  readonly text: string;
  /** 供应商报告的结束原因。length 表示被截断，调用方应判失败而不是硬解析。 */
  readonly finishReason: string | null;
}

/** 调用失败。区分「被截断」与其它错误，因为前者重试更可能成功。 */
export class ChatError extends Error {
  readonly kind: "truncated" | "empty" | "http" | "timeout" | "network" | "aborted";
  constructor(kind: ChatError["kind"], message: string) {
    super(message);
    this.name = "ChatError";
    this.kind = kind;
  }
}

function buildHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.kind === "anthropic") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    // Anthropic 官方要求浏览器直连时显式声明，否则会被拒
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (provider.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(provider.extraHeaders) as Record<string, string>);
    } catch {
      // 非法 JSON 由设置页拦截，这里忽略
    }
  }
  return headers;
}

export async function callChat(
  provider: ProviderConfig,
  req: ChatRequest,
): Promise<ChatResult> {
  const isAnthropic = provider.kind === "anthropic";
  const endpoint = isAnthropic
    ? `${provider.baseUrl}/messages`
    : `${provider.baseUrl}/chat/completions`;

  const maxTokens = req.maxTokens ?? 600;
  const temperature = req.temperature ?? 0.3;

  const body = isAnthropic
    ? {
        model: provider.model,
        max_tokens: maxTokens,
        temperature,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.user }],
      }
    : {
        model: provider.model,
        temperature,
        max_tokens: maxTokens,
        ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          ...(req.system ? [{ role: "system", content: req.system }] : []),
          { role: "user", content: req.user },
        ],
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 60000);
  // 外部取消与超时任一触发都要中断请求
  const signal = req.signal
    ? AbortSignal.any([req.signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(provider),
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new ChatError("http", `HTTP ${res.status}${t ? ` · ${t.slice(0, 120)}` : ""}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      content?: { text?: string }[];
      stop_reason?: string;
    };

    const text = json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? "";
    const finishReason = json.choices?.[0]?.finish_reason ?? json.stop_reason ?? null;

    // 截断的 JSON 不能硬解析：parse 失败后的重试比「解析出半截对象」安全得多
    if (finishReason === "length" || finishReason === "max_tokens") {
      throw new ChatError("truncated", "模型输出被截断（达到 max_tokens），请重试或换更短的批次");
    }
    if (!text.trim()) throw new ChatError("empty", "模型返回空内容");

    return { text: text.trim(), finishReason };
  } catch (err) {
    if (err instanceof ChatError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      // 外部取消与超时都是 AbortError，按 signal 状态区分，避免把「用户取消」报成超时
      if (req.signal?.aborted) throw new ChatError("aborted", "请求已取消");
      throw new ChatError("timeout", `请求超时（${Math.round((req.timeoutMs ?? 60000) / 1000)} 秒）`);
    }
    throw new ChatError("network", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 一次 repair 重试：第一次失败（结构不合格/截断）后，把失败原因拼进提示词再问一次。
 *
 * 只重试一次。第二次还不行就交给调用方降级——
 * 无限重试会把「模型不稳定」变成「页面卡住」。
 */
export async function callChatWithRepair(
  provider: ProviderConfig,
  req: ChatRequest,
  validate: (text: string) => { ok: true } | { ok: false; reason: string },
): Promise<ChatResult> {
  const first = await callChat(provider, req);
  const check = validate(first.text);
  if (check.ok) return first;

  const repairUser = `${req.user}

上一次的输出有以下问题：${check.reason}
请严格按要求的 JSON 格式重新输出，不要任何解释文字。`;

  return callChat(provider, { ...req, user: repairUser });
}
