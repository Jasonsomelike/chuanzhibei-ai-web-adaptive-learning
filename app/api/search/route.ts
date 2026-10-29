/**
 * POST /api/search：服务端代发三家搜索。
 *
 * 边界：
 * - wikipedia 免密钥，允许匿名，且不读也不写用户配置；
 * - deepseek / tavily 需要登录（401）与对应配置行（缺失 404）；
 *   deepseek 在独立行缺失时，只有 llm 行的 base_url 主机是 api.deepseek.com
 *   才复用 llm 密钥；请求仍只发往官方固定端点，密钥不会被带去用户自填的中转域；
 * - 请求体里的 provider 必须显式指定，服务端不做静默换供应商：响应的 provider
 *   永远等于请求的 provider，客户端才能判断到底是谁失败；
 * - 错误响应只有 { error, code }，不含密钥；上游正文在 serverSearch 内脱敏后截断。
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { search, type ApiErrorCode } from "@/lib/apiContracts";
import { getCurrentUser } from "@/lib/auth";
import { MAX_SEARCH_BODY_BYTES } from "@/lib/bodyLimit";
import { getDb } from "@/lib/db";
import { sameOriginFromRequest } from "@/lib/origin";
import { readLimitedText } from "@/lib/routeAuth";
import { SecretCryptoError } from "@/lib/secretCrypto";
import {
  assertNeverProvider,
  isDeepSeekBaseUrl,
  MAX_SEARCH_COUNT,
  searchDeepSeek,
  searchTavily,
  searchWikipedia,
  SearchUpstreamError,
  type WebProvider,
  type WebResult,
} from "@/lib/serverSearch";
import { loadUserSecret, UserSecretError, type LoadedUserSecret, type SecretKind } from "@/lib/userSecrets";

export const runtime = "nodejs";

/**
 * 契约在 apiContracts.search 里，这里只追加可选的 count。
 * count 不放进公共契约，是因为它只对 DeepSeek 有意义；Tavily / Wikipedia
 * 的结果数由服务端常量决定。
 */
const searchRequest = search.extend({
  count: z.number().int().min(1).max(MAX_SEARCH_COUNT).optional(),
});

function failure(status: number, code: ApiErrorCode, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

type SecretLoad =
  | { readonly ok: true; readonly value: LoadedUserSecret | null }
  | { readonly ok: false; readonly response: NextResponse };

/**
 * 读一条配置。解密失败（没配 ALP_SECRET_KEY、密文损坏）必须报 500，
 * 不能当成「未配置」让用户去设置页重填——重填也救不了服务端缺主密钥。
 */
async function tryLoadSecret(userId: string, kind: SecretKind): Promise<SecretLoad> {
  try {
    const db = await getDb();
    return { ok: true, value: await loadUserSecret(db, userId, kind) };
  } catch (error) {
    // 密钥类错误（主密钥缺失/不对、密文损坏）与数据库故障要分开报：
    // 前者让运维去查 ALP_SECRET_KEY，后者不应把用户引向重填密钥。
    if (error instanceof SecretCryptoError || error instanceof UserSecretError) {
      return {
        ok: false,
        response: failure(
          500,
          "secret_key_missing",
          "无法读取已保存的搜索密钥，请检查服务端 ALP_SECRET_KEY",
        ),
      };
    }
    return {
      ok: false,
      response: failure(500, "internal", "读取搜索配置失败，请稍后再试"),
    };
  }
}

/** 把供应商错误映射成不泄露密钥的可展示响应。 */
function searchFailure(error: unknown, provider: WebProvider): NextResponse {
  if (error instanceof SearchUpstreamError) {
    switch (error.kind) {
      case "auth":
        return failure(502, "provider_error", error.message);
      case "rate-limit":
        return failure(429, "rate_limited", error.message);
      case "timeout":
        return failure(504, "provider_timeout", error.message);
      case "http":
      case "parse":
      case "empty":
        return failure(502, "provider_error", error.message);
    }
  }
  return failure(502, "provider_error", `${provider} 搜索失败，请稍后再试`);
}

async function runSearch(
  provider: WebProvider,
  operation: () => Promise<WebResult[]>,
): Promise<NextResponse> {
  try {
    const results = await operation();
    return NextResponse.json({ results, provider });
  } catch (error) {
    return searchFailure(error, provider);
  }
}

export async function POST(request: Request) {
  // 浏览器带 Origin 的跨站请求一律拒绝；服务端调用没有 Origin 时按同源放行。
  if (!sameOriginFromRequest(request)) {
    return failure(403, "forbidden", "请求来源不可信");
  }

  // 先限量读完再解析：chunked 请求没有 Content-Length，裸 request.json()
  // 会把任意大的包先收进内存。
  const raw = await readLimitedText(request, MAX_SEARCH_BODY_BYTES);
  if (!raw.ok) {
    // 保持本路由的 { error, code } 错误体，让 searchClient 仍能读到错误码。
    if (raw.response.status === 413) {
      return failure(413, "payload_too_large", `请求体超过 ${MAX_SEARCH_BODY_BYTES} 字节上限`);
    }
    return raw.response;
  }

  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return failure(400, "bad_request", "请求体不是合法 JSON");
  }

  const parsed = searchRequest.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return failure(400, "bad_request", issue?.message ?? "请求体不合法");
  }

  const { provider, query, count } = parsed.data;

  switch (provider) {
    case "wikipedia":
      // 免密钥、允许匿名；不查库、不写库。
      return runSearch("wikipedia", () => searchWikipedia(query));

    case "deepseek": {
      const user = await getCurrentUser();
      if (!user) return failure(401, "unauthorized", "请先登录");

      const own = await tryLoadSecret(user.id, "search-deepseek");
      if (!own.ok) return own.response;
      /*
       * 搜索行的 base_url 刻意不参与请求：DeepSeek 搜索按官方端点计费，
       * 代理固定 https://api.deepseek.com/v1/tools/search，避免密钥被带到
       * 用户自填的中转地址。base_url 只在 llm 行做「是否官方域」的判断。
       */
      let apiKey = (own.value?.payload.apiKey ?? "").trim();

      if (apiKey === "") {
        // 只有官方 DeepSeek 地址才复用 llm 密钥；中转地址的密钥不属于 DeepSeek。
        const llm = await tryLoadSecret(user.id, "llm");
        if (!llm.ok) return llm.response;
        if (llm.value !== null && isDeepSeekBaseUrl(llm.value.row.base_url)) {
          apiKey = (llm.value.payload.apiKey ?? "").trim();
        }
      }

      if (apiKey === "") {
        return failure(
          404,
          "provider_not_configured",
          "DeepSeek 搜索未配置，请到设置页填写搜索密钥",
        );
      }
      return runSearch("deepseek", () => searchDeepSeek(apiKey, query, count));
    }

    case "tavily": {
      const user = await getCurrentUser();
      if (!user) return failure(401, "unauthorized", "请先登录");

      const own = await tryLoadSecret(user.id, "search-tavily");
      if (!own.ok) return own.response;
      const apiKey = (own.value?.payload.apiKey ?? "").trim();
      if (apiKey === "") {
        return failure(404, "provider_not_configured", "Tavily 搜索未配置，请到设置页填写密钥");
      }
      return runSearch("tavily", () => searchTavily(apiKey, query));
    }

    default:
      return assertNeverProvider(provider);
  }
}
