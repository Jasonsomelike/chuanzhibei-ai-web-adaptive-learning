/**
 * 400 归因：这次失败到底是不是「思考参数不被接受」。
 *
 * 只有确认是思考字段被拒，调用方才应该去掉 thinking/reasoning_effort 重发；
 * 模型名写错、上下文超长这类 400 重发一次也不会好，归到 other。
 *
 * 边界：
 * - 只看结构化错误字段（error.code/message/type/param 等）与纯文本错误体；
 *   有些网关会在错误响应里回显整个请求，若回显里带了 reasoning_effort，
 *   全文匹配会把「模型不存在」误判成思考被拒，所以结构化字段优先、命中即停。
 * - 大小写不敏感。
 */

export type ThinkingRejection = "thinking" | "other";

/**
 * 命中任一关键词即认为思考参数被拒：thinking / reasoning_effort / reasoning /
 * budget_tokens / enable_thinking。
 */
const THINKING_KEYWORDS = /thinking|reasoning_effort|reasoning|budget_tokens|enable_thinking/i;

/**
 * 模型不存在/不受支持属于「换参数也没用」的 400。模型名本身可能带 thinking
 * （如 qwen3-thinking），只靠关键词会把这类错误误判成思考参数被拒，所以先排除。
 */
const MODEL_ERROR =
  /(?:invalid|unknown|unrecognized|unsupported)\s+model|model[\s\S]{0,80}?not[\s_-]*(?:found|exist)|no\s+such\s+model/i;

/** 错误体里承载原因的结构化字段，按优先级取用。 */
const REASON_FIELDS = [
  "code",
  "type",
  "param",
  "message",
  "msg",
  "detail",
  "error_description",
] as const;

export function classifyThinkingRejection(
  status: number,
  body: string | null | undefined,
): ThinkingRejection {
  if (status !== 400) return "other";

  const reason = extractReason(body);
  if (reason === null) return "other";
  if (MODEL_ERROR.test(reason)) return "other";
  return THINKING_KEYWORDS.test(reason) ? "thinking" : "other";
}

/**
 * 取出用于归因的文本：优先结构化字段，取不到再退回原文。
 * 空体返回 null（无从判断，按 other 处理）。
 */
function extractReason(body: string | null | undefined): string | null {
  const raw = (body ?? "").trim();
  if (raw === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }

  const parts: string[] = [];
  if (typeof parsed === "string") {
    parts.push(parsed);
  } else if (isRecord(parsed)) {
    collectReasonFields(parsed, parts);
    const error = parsed["error"];
    if (typeof error === "string") {
      parts.push(error);
    } else if (isRecord(error)) {
      collectReasonFields(error, parts);
    }
  }

  return parts.length > 0 ? parts.join("\n") : raw;
}

function collectReasonFields(record: Record<string, unknown>, out: string[]): void {
  for (const field of REASON_FIELDS) {
    const value = record[field];
    if (typeof value === "string" && value !== "") out.push(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
