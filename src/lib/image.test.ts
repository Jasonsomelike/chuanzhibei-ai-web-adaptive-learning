import { describe, expect, it } from "vitest";

import {
  IMAGE_JPEG_QUALITY,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_COUNT,
  base64BytesOfDataUrl,
  fitToLongEdge,
  imageCountMessage,
  isJpegDataUrl,
  prepareImage,
  remainingImageSlots,
  unsupportedTypeMessage,
  type DecodedImage,
  type ImageCodec,
} from "@/lib/image";

function jpegOf(bytes: number): string {
  return `data:image/jpeg;base64,${Buffer.alloc(Math.max(1, bytes)).toString("base64")}`;
}

function pngFile(name = "shot.png", type = "image/png", size = 2048): File {
  return new File([new Uint8Array(size)], name, { type });
}

interface EncodeCall {
  readonly width: number;
  readonly height: number;
  readonly quality: number;
}

function fakeCodec(options: {
  readonly width?: number;
  readonly height?: number;
  readonly sizes: readonly number[];
}): { codec: ImageCodec; calls: EncodeCall[]; released: () => number } {
  const calls: EncodeCall[] = [];
  const queue = [...options.sizes];
  let releases = 0;
  const codec: ImageCodec = {
    async decode(): Promise<DecodedImage | null> {
      return {
        width: options.width ?? 3000,
        height: options.height ?? 2000,
        source: "bitmap",
      };
    },
    async encode(_decoded, width, height, quality) {
      calls.push({ width, height, quality });
      const size = queue.length > 0 ? queue.shift() ?? 0 : IMAGE_MAX_BYTES + 1;
      return jpegOf(size);
    },
    release() {
      releases += 1;
    },
  };
  return { codec, calls, released: () => releases };
}

describe("fitToLongEdge", () => {
  it("横图按长边缩到 1568，比例不变", () => {
    expect(fitToLongEdge(3000, 2000)).toEqual({ width: 1568, height: 1045 });
    expect(fitToLongEdge(3136, 1568)).toEqual({ width: 1568, height: 784 });
  });

  it("竖图按高度缩，小图不放大", () => {
    expect(fitToLongEdge(1000, 2000)).toEqual({ width: 784, height: 1568 });
    expect(fitToLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("0 尺寸退到 1px，避免画布 0 宽抛异常", () => {
    expect(fitToLongEdge(0, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe("base64BytesOfDataUrl / isJpegDataUrl", () => {
  it("按 base64 长度与填充反推字节数", () => {
    expect(base64BytesOfDataUrl("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(base64BytesOfDataUrl("data:image/jpeg;base64,AAA=")).toBe(2);
    expect(base64BytesOfDataUrl("data:image/jpeg;base64,AA==")).toBe(1);
    expect(base64BytesOfDataUrl("不是 data url")).toBe(0);
  });

  it("只接受 image/jpeg 的 data URI", () => {
    expect(isJpegDataUrl(jpegOf(10))).toBe(true);
    expect(isJpegDataUrl("https://example.com/a.jpg")).toBe(false);
    expect(isJpegDataUrl("data:image/png;base64,AAAA")).toBe(false);
  });
});

describe("prepareImage", () => {
  it("首轮就是长边 1568 + q0.82，成功后不再降档", async () => {
    const { codec, calls, released } = fakeCodec({ sizes: [120 * 1024] });
    const result = await prepareImage(pngFile(), codec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.image.width).toBe(1568);
    expect(result.image.height).toBe(1045);
    expect(result.image.quality).toBe(IMAGE_JPEG_QUALITY);
    expect(result.image.bytes).toBe(120 * 1024);
    expect(calls).toEqual([{ width: 1568, height: 1045, quality: IMAGE_JPEG_QUALITY }]);
    expect(released()).toBe(1);
  });

  it("超过 400KB 先降质量，再缩尺寸；最终返回实际质量", async () => {
    const big = IMAGE_MAX_BYTES + 1024;
    const { codec, calls } = fakeCodec({ sizes: [big, big, big, 90 * 1024] });
    const result = await prepareImage(pngFile(), codec);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.map((call) => call.quality)).toEqual([0.82, 0.72, 0.62, 0.62]);
    expect(calls[3]?.width).toBeLessThan(1568);
    expect(result.image.quality).toBe(0.62);
    expect(result.image.bytes).toBe(90 * 1024);
  });

  it("怎么压都超限时返回 oversize，而不是把超限图片发出去", async () => {
    const { codec, calls } = fakeCodec({ width: 1000, height: 1000, sizes: [IMAGE_MAX_BYTES + 1] });
    const result = await prepareImage(pngFile(), codec);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("oversize");
    expect(result.message).toContain("400KB");
    expect(calls.length).toBeLessThanOrEqual(12);
  });

  it("不支持的格式直接拒绝，不调用编解码器", async () => {
    const { codec, calls } = fakeCodec({ sizes: [10] });
    const result = await prepareImage(pngFile("a.heic", "image/heic"), codec);

    expect(result).toMatchObject({ ok: false, reason: "type" });
    if (result.ok) return;
    expect(result.message).toContain("HEIC");
    expect(calls).toHaveLength(0);
  });

  it("解码失败给出「改用文字提问」级别的明确原因", async () => {
    const result = await prepareImage(pngFile(), {
      async decode() {
        return null;
      },
      async encode() {
        return jpegOf(10);
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "decode" });
    if (result.ok) return;
    expect(result.message).toContain("浏览器无法解码");
  });

  it("空文件与编码失败都不抛异常", async () => {
    const { codec } = fakeCodec({ sizes: [10] });
    const empty = await prepareImage(pngFile("empty.png", "image/png", 0), codec);
    expect(empty).toMatchObject({ ok: false, reason: "empty" });

    const encoded = await prepareImage(pngFile(), {
      async decode() {
        return { width: 100, height: 100, source: null };
      },
      async encode() {
        return null;
      },
    });
    expect(encoded).toMatchObject({ ok: false, reason: "encode" });
  });
});

describe("张数限制", () => {
  it("最多 3 张，剩余槽位夹在 0..3", () => {
    expect(IMAGE_MAX_COUNT).toBe(3);
    expect(remainingImageSlots(0)).toBe(3);
    expect(remainingImageSlots(2)).toBe(1);
    expect(remainingImageSlots(3)).toBe(0);
    expect(remainingImageSlots(9)).toBe(0);
    expect(imageCountMessage()).toContain("最多附带 3 张");
  });

  it("HEIC / SVG 的拒绝原因可执行", () => {
    expect(unsupportedTypeMessage("image/heic")).toContain("转成 JPEG");
    expect(unsupportedTypeMessage("image/svg+xml")).toContain("SVG");
    expect(unsupportedTypeMessage("application/pdf")).toContain("JPEG / PNG / WebP / GIF");
  });
});
