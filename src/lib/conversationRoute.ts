import { z } from "zod";
import { assertMutationOrigin, readLimitedText } from "./routeAuth";
import { ConversationError } from "./conversationStore";
import { LearningContextError } from "./learningContext";

export const archiveResponse = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", Vary: "Cookie" } });
export function archiveFailure(error: unknown) {
  if (error instanceof ConversationError || error instanceof LearningContextError) return archiveResponse({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return archiveResponse({ error: "会话参数不合法，现有记录未被修改。" }, 400);
  return archiveResponse({ error: "会话保存或读取失败，请重试。" }, 500);
}
export async function archiveJson(request: Request, maxBytes: number): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  const origin = assertMutationOrigin(request);
  if (origin) return { ok: false, response: origin };
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return { ok: false, response: archiveResponse({ error: "请求体必须是 application/json" }, 415) };
  const body = await readLimitedText(request, maxBytes);
  if (!body.ok) return body;
  try { return { ok: true, data: JSON.parse(body.text) }; }
  catch { return { ok: false, response: archiveResponse({ error: "请求体不是 JSON" }, 400) }; }
}
