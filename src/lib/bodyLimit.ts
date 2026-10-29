/**
 * 各路由的请求体上限（字节）。
 *
 * 只放常量：计数与读取在 routeAuth.readLimitedText 里，避免每个路由复制一份实现，
 * 也避免「这个路由到底有没有上限」需要逐个 handler 读一遍才能回答。
 * 数值按「该路由正常请求的最大体积 × 数倍余量」定，不追求全站统一：
 * 统一成一个大值等于给所有入口放宽，统一成一个小值会把合法的模型输出挡在门外。
 */

/** /api/auth：邮箱、口令、显示名，正常只有几百字节，32KB 仅用于兜底。 */
export const MAX_AUTH_BODY_BYTES = 32 * 1024;

/**
 * /api/directions/generate：rawModelOutput 是前端直连模型后原样回传的整段 JSON，
 * 比普通表单大，但一份 20 个知识点的草稿也只有几 KB；256KB 留足余量。
 */
export const MAX_DIRECTIONS_GENERATE_BODY_BYTES = 256 * 1024;

/** /api/search：provider + query（上限 120 字）+ count，16KB 已是数量级余量。 */
export const MAX_SEARCH_BODY_BYTES = 16 * 1024;

/** /api/tts：正文上限 2000 字，UTF-8 最多 3 字节/字，32KB 足够。 */
export const MAX_TTS_BODY_BYTES = 32 * 1024;
