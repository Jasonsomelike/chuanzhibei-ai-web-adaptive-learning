/**
 * 图片输入：格式校验、长边压缩、体积上限与张数限制。
 *
 * 边界：
 * - 纯逻辑与浏览器绘制分离：`prepareImage` 只依赖注入的 `ImageCodec`，
 *   单测用假编解码器就能覆盖「缩放到 1568 → JPEG q0.82 → 超过 400KB 再降」，
 *   不需要真实 Canvas。
 * - 只产出 JPEG data URI。上游只接受 data:image/(jpeg|png|webp|gif);base64，
 *   不接受 http(s) URL（否则等于让上游替我们抓取任意地址）。
 * - 失败必须显式返回 reason + 人话 message，调用方据此提示「改为文字提问」；
 *   绝不静默丢弃图片后重发。
 * - 不读 localStorage、不发请求、不落库：图片只在内存与当前消息里存活。
 */

/** 长边上限（px）。超过这个尺寸的截图对模型没有额外信息，只会多吃 token。 */
export const IMAGE_MAX_EDGE = 1568;

/** 首选 JPEG 质量。只有超过体积上限时才降到更低档。 */
export const IMAGE_JPEG_QUALITY = 0.82;

/** 单张压缩后的体积上限。 */
export const IMAGE_MAX_BYTES = 400 * 1024;

/** 一次提问最多附带的图片数。 */
export const IMAGE_MAX_COUNT = 3;

/** file input 的 accept 值：与上游接受的四种格式一致。 */
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/** 支持的 MIME；HEIC / SVG / BMP 一律拒绝（浏览器与上游都不保证能处理）。 */
export const IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

export const IMAGE_HELP_TEXT =
  "支持粘贴截图、选择文件或拍照；长边压到 1568px、JPEG q0.82、单张 ≤400KB。";

/** 质量降档顺序：先降质量，再缩尺寸。 */
const QUALITY_LADDER: readonly number[] = [IMAGE_JPEG_QUALITY, 0.72, 0.62];

/** 每次缩尺寸的倍率。 */
const SHRINK = 0.82;

/** 缩到这个长边以下仍超限就放弃：再压也看不清题目了。 */
const MIN_SCALED_EDGE = 320;

/** 编码尝试上限 = 3 档质量 × 多次缩小；防止极端输入让循环跑飞。 */
const MAX_ENCODE_ATTEMPTS = 12;

export type ImageFailureReason = "type" | "empty" | "decode" | "encode" | "oversize" | "count";

export interface ImageFailure {
  readonly ok: false;
  readonly reason: ImageFailureReason;
  readonly message: string;
}

/** 压缩成功后的图片。dataUrl 已是 data:image/jpeg;base64,...。 */
export interface PreparedImage {
  readonly dataUrl: string;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  /** 实际成功的 JPEG 质量；正常情况就是 0.82。 */
  readonly quality: number;
}

export type PrepareImageResult =
  | { readonly ok: true; readonly image: PreparedImage }
  | ImageFailure;

/** 解码后的图片；source 由编解码器自己解释（浏览器里是 ImageBitmap）。 */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  readonly source: unknown;
}

/**
 * 注入式编解码器。
 *
 * decode 返回 null 表示「浏览器解不了这张图」（HEIC、损坏文件、没有
 * createImageBitmap）；encode 返回 null 表示编码失败。两者都不是异常，
 * 调用方按显式失败处理。
 */
export interface ImageCodec {
  decode(file: Blob): Promise<DecodedImage | null>;
  encode(
    decoded: DecodedImage,
    width: number,
    height: number,
    quality: number,
  ): Promise<string | null>;
  /** 释放解码资源；浏览器实现会 close() ImageBitmap。 */
  release?(decoded: DecodedImage): void;
}

const JPEG_DATA_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/u;

export function isSupportedImageType(type: string): boolean {
  return IMAGE_TYPES.includes(type.trim().toLowerCase());
}

/** 不支持的格式给出可执行的原因，而不是只说「格式错误」。 */
export function unsupportedTypeMessage(type: string): string {
  const value = type.trim().toLowerCase();
  if (value === "image/heic" || value === "image/heif") {
    return "不支持 HEIC / HEIF 图片：多数浏览器自己就解不了。请先在相册里转成 JPEG 再上传。";
  }
  if (value === "image/svg+xml") {
    return "不支持 SVG：它可能引用外部资源，不能当截图发给模型。请转成 PNG 或 JPEG。";
  }
  return `不支持的图片格式${value === "" ? "" : `（${value}）`}：请使用 JPEG / PNG / WebP / GIF。`;
}

/**
 * 等比缩放到长边不超过 maxEdge；不放大。
 *
 * 尺寸按四舍五入取整，最小 1px——0 宽的画布会让 toDataURL 抛异常。
 */
export function fitToLongEdge(
  width: number,
  height: number,
  maxEdge: number = IMAGE_MAX_EDGE,
): { readonly width: number; readonly height: number } {
  const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  const h = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 0;
  if (w === 0 || h === 0) return { width: 1, height: 1 };

  const limit = Number.isFinite(maxEdge) && maxEdge >= 1 ? Math.floor(maxEdge) : IMAGE_MAX_EDGE;
  const longest = Math.max(w, h);
  if (longest <= limit) return { width: w, height: h };

  const scale = limit / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * data URI 里 base64 载荷的字节数（不算 data: 前缀）。
 *
 * 浏览器没有 Buffer，用 base64 长度反推：每 4 个字符 3 字节，减去 = 填充。
 */
export function base64BytesOfDataUrl(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const payload = dataUrl.slice(comma + 1).replace(/\s+/gu, "");
  if (payload === "") return 0;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function isJpegDataUrl(dataUrl: string): boolean {
  return JPEG_DATA_URL.test(dataUrl);
}

/** 剩余可添加张数；负数按 0 处理。 */
export function remainingImageSlots(current: number, max: number = IMAGE_MAX_COUNT): number {
  const cap = Number.isFinite(max) && max >= 0 ? Math.floor(max) : IMAGE_MAX_COUNT;
  const used = Number.isFinite(current) ? Math.max(0, Math.floor(current)) : 0;
  return Math.max(0, cap - used);
}

export function imageCountMessage(max: number = IMAGE_MAX_COUNT): string {
  return `一次最多附带 ${max} 张图片；请先移除一张再添加。`;
}

function failure(reason: ImageFailureReason, message: string): ImageFailure {
  return { ok: false, reason, message };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(0, Math.round(bytes / 1024))}KB`;
}

/**
 * 压缩一张图片。
 *
 * 顺序固定：格式 → 空文件 → 解码 → 长边 1568 → q0.82 → 超限降质量 → 再缩尺寸。
 * 全程最多 MAX_ENCODE_ATTEMPTS 次编码；最后一次仍超限返回 oversize，
 * 由调用方提示换图，而不是把超限图片塞进请求体。
 */
export async function prepareImage(
  file: File,
  codec: ImageCodec,
): Promise<PrepareImageResult> {
  if (!isSupportedImageType(file.type)) {
    return failure("type", unsupportedTypeMessage(file.type));
  }
  if (file.size <= 0) {
    return failure("empty", "这张图片是空文件（0 字节），无法发送。");
  }

  let decoded: DecodedImage | null = null;
  try {
    decoded = await codec.decode(file);
  } catch {
    decoded = null;
  }
  if (decoded === null || decoded.width <= 0 || decoded.height <= 0) {
    return failure(
      "decode",
      "浏览器无法解码这张图片（可能是损坏文件或浏览器不支持的编码）；请转成 JPEG / PNG 再试。",
    );
  }

  try {
    let size = fitToLongEdge(decoded.width, decoded.height);
    let qualityIndex = 0;
    let lastBytes = 0;

    for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt += 1) {
      const quality = QUALITY_LADDER[qualityIndex] ?? QUALITY_LADDER[QUALITY_LADDER.length - 1];
      const dataUrl = await codec.encode(decoded, size.width, size.height, quality);
      if (dataUrl === null) {
        return failure(
          "encode",
          "图片编码失败：当前浏览器没有可用的 Canvas 2D 上下文，请改用文字提问。",
        );
      }
      if (!isJpegDataUrl(dataUrl)) {
        return failure("encode", "图片编码结果不是 JPEG data URI，已拒绝发送。");
      }

      lastBytes = base64BytesOfDataUrl(dataUrl);
      if (lastBytes > 0 && lastBytes <= IMAGE_MAX_BYTES) {
        return {
          ok: true,
          image: {
            dataUrl,
            bytes: lastBytes,
            width: size.width,
            height: size.height,
            quality,
          },
        };
      }

      if (qualityIndex < QUALITY_LADDER.length - 1) {
        qualityIndex += 1;
        continue;
      }

      if (Math.max(size.width, size.height) <= MIN_SCALED_EDGE) break;
      size = {
        width: Math.max(1, Math.round(size.width * SHRINK)),
        height: Math.max(1, Math.round(size.height * SHRINK)),
      };
      // 尺寸变小后仍按最低质量编码：目标是过 400KB，不再追求画质
    }

    return failure(
      "oversize",
      `压缩后仍有 ${formatBytes(lastBytes)}，超过 ${formatBytes(IMAGE_MAX_BYTES)} 上限；请换一张更小的截图，或先裁剪掉无关区域。`,
    );
  } finally {
    codec.release?.(decoded);
  }
}

/**
 * 浏览器默认编解码器：createImageBitmap + Canvas 2D + toDataURL。
 *
 * 透明 PNG 先铺白底：JPEG 没有 alpha 通道，直接drawImage 会把透明区域变成黑色，
 * 截图里的浅色文字会整片看不见。
 */
export function browserImageCodec(): ImageCodec {
  return {
    async decode(file: Blob): Promise<DecodedImage | null> {
      if (typeof createImageBitmap !== "function") return null;
      try {
        const bitmap = await createImageBitmap(file);
        if (bitmap.width <= 0 || bitmap.height <= 0) {
          bitmap.close();
          return null;
        }
        return { width: bitmap.width, height: bitmap.height, source: bitmap };
      } catch {
        return null;
      }
    },
    async encode(
      decoded: DecodedImage,
      width: number,
      height: number,
      quality: number,
    ): Promise<string | null> {
      if (typeof document === "undefined") return null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context === null) return null;
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(decoded.source as CanvasImageSource, 0, 0, width, height);
        return canvas.toDataURL("image/jpeg", quality);
      } catch {
        return null;
      }
    },
    release(decoded: DecodedImage): void {
      const source = decoded.source as { close?: () => void };
      if (typeof source.close === "function") source.close();
    },
  };
}
