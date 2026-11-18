/**
 * 进程内固定窗口限流（best-effort）。
 *
 * 用途：拦截单实例内的突发滥用与客户端误循环（匿名搜索、模型调用、
 * 文档上传/检索、知识库写入与向量入库等）。
 *
 * 边界：serverless / 多实例部署时每个实例独立计数，公网部署仍应在
 * 平台或反向代理层配置分布式限流；同源检查不能替代频率限制。
 *
 * 键 = 桶名 + 可信代理提供的客户端 IP；直连部署不信任任意请求头。
 * 按账号限流要先解析会话（昂贵且各路由鉴权方式不同），本轮不做：
 * 这只是单实例保护，不能替代平台层的分布式与账号限流。
 */

const WINDOW_MS = 60_000;
/** 超过这个条目数就顺手清掉过期窗口，防止 Map 无界增长。 */
const PRUNE_THRESHOLD = 1000;
const MAX_BUCKETS = 10_000;

interface BucketEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, BucketEntry>();

export interface RateLimitResult {
  readonly ok: boolean;
  /** 超限时建议的重试等待秒数；未超限为 0。 */
  readonly retryAfterSeconds: number;
}

/** 纯计数（可注入时钟，便于测试）。窗口过期后自动重置。 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number = WINDOW_MS,
  now: number = Date.now(),
): RateLimitResult {
  const entry = buckets.get(key);
  if (entry === undefined || now >= entry.resetAt) {
    if (buckets.size >= MAX_BUCKETS) {
      prune(now);
      if (entry === undefined && buckets.size >= MAX_BUCKETS) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > PRUNE_THRESHOLD) prune(now);
    return { ok: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  entry.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

function prune(now: number): void {
  for (const [key, entry] of buckets) {
    if (now >= entry.resetAt) buckets.delete(key);
  }
}

/** 取客户端 IP：优先代理头，本地开发统一记 unknown（共享一个桶，可接受）。 */
export function clientIpOf(request: Request, trustProxy = process.env.VERCEL === "1" || process.env.ALP_TRUST_PROXY === "1"): string {
  if (!trustProxy) return "unknown";
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real && real.length <= 64) return real;
  return "unknown";
}

/**
 * 路由守卫：超限返回 429 响应（JSON 扁平错误 + Retry-After），未超限返回 null。
 * 在 handler 最前面调用：
 *   const limited = enforceRateLimit(request, "search", 30);
 *   if (limited !== null) return limited;
 */
export function enforceRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs: number = WINDOW_MS,
): Response | null {
  const result = rateLimit(`${bucket}:${clientIpOf(request)}`, limit, windowMs);
  if (result.ok) return null;
  return new Response(
    JSON.stringify({ error: "请求过于频繁，请稍后再试。", code: "rate_limited" }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

/** 测试用：清空计数。 */
export function resetRateLimits(): void {
  buckets.clear();
}
