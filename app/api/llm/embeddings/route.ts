/**
 * POST /api/llm/embeddings —— 服务端批量向量化，供知识库检索的向量召回使用。
 *
 * 模型、地址、密钥全部来自 /api/config 保存的 llm 配置（或 ALP_EMBED_* 环境变量），
 * 请求体只有待嵌入的文本。没有可用的 embedding 能力时回 503：这是正常降级信号，
 * 客户端据此继续只用 BM25，不是错误弹窗。
 */

import { NextResponse } from "next/server";

import { apiErrorCodes, embeddings } from "@/lib/apiContracts";
import { assertMutationOrigin, jsonError, readJsonObject, requireApiUser } from "@/lib/routeAuth";
import { embedTextsForUser } from "@/lib/serverEmbedding";

export const runtime = "nodejs";

/** 64 条 × 8000 字符的 JSON 约 0.5MB，给两倍余量。 */
const MAX_EMBED_BODY_BYTES = 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;

  const crossSite = assertMutationOrigin(request);
  if (crossSite) return crossSite;

  const raw = await readJsonObject(request, MAX_EMBED_BODY_BYTES);
  if (!raw.ok) return raw.response;

  const parsed = embeddings.safeParse(raw.value);
  if (!parsed.success) {
    return jsonError(
      400,
      apiErrorCodes.badRequest,
      "texts 必须是 1–64 条、每条不超过 8000 字符的字符串数组",
    );
  }

  const result = await embedTextsForUser(auth.user.id, parsed.data.texts, request.signal);
  if (result === null) {
    return jsonError(503, "EMBEDDING_UNAVAILABLE", "当前没有可用的向量化配置");
  }

  return NextResponse.json({
    model: result.model,
    dim: result.dim,
    vectors: result.vectors,
  });
}
