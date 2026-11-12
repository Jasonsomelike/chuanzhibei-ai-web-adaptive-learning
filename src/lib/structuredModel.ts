import { assertUpstreamAllowed, guardedRequest } from "./ssrfGuard";
import {
  buildUpstreamChatBody,
  endpointFor,
  filterExtraHeaders,
  type LlmConfig,
} from "./upstream";
import { extractNonStreamingText } from "./reasoning";
import { contextBudget } from "./contextBudget";
/** Shared guarded transport for bounded internal agents. Never returns raw upstream errors. */
export async function callStructuredModel(
  config: LlmConfig,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const target = await assertUpstreamAllowed(
    endpointFor(config.api, config.options.baseUrl),
  );
  const headers: Record<string, string> = {
    ...filterExtraHeaders(config.options.extraHeaders),
    "content-type": "application/json",
  };
  if (config.api === "anthropic") {
    headers["x-api-key"] = config.payload.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else headers.authorization = `Bearer ${config.payload.apiKey}`;
  const body = buildUpstreamChatBody(
    config.api,
    config.options.model,
    {
      messages: [{ role: "user", content: prompt }],
      stream: false,
      maxTokens: Math.min(
        12000,
        contextBudget({ ...config.options, thinking: "off" }).response,
      ),
      jsonMode: true,
    },
    "off",
  );
  const response = await guardedRequest(target, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    timeoutMs: 60_000,
    maxBytes: 512 * 1024,
    signal,
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error("估算模型暂时不可用。");
  try {
    return extractNonStreamingText(
      config.api,
      JSON.parse(response.body.toString("utf8")),
    );
  } catch {
    throw new Error("估算模型未返回可解析内容。");
  }
}
