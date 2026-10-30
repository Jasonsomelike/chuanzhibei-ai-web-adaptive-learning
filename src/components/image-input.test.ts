import { describe, expect, it } from "vitest";

import {
  appendAttachedImages,
  formatImageMeta,
  type AttachedImage,
} from "@/components/image-input";

function attached(id: string, bytes = 100 * 1024): AttachedImage {
  return {
    id,
    name: `${id}.png`,
    dataUrl: "data:image/jpeg;base64,AAAA",
    bytes,
    width: 1568,
    height: 1045,
    quality: 0.82,
  };
}

describe("appendAttachedImages", () => {
  it("未满 3 张时全部接收", () => {
    const result = appendAttachedImages([attached("a")], [attached("b"), attached("c")]);
    expect(result.images.map((image) => image.id)).toEqual(["a", "b", "c"]);
    expect(result.rejected).toBe(0);
  });

  it("已满 3 张时全部拒绝，并报出被拒张数", () => {
    const current = [attached("a"), attached("b"), attached("c")];
    const result = appendAttachedImages(current, [attached("d")]);
    expect(result.images).toHaveLength(3);
    expect(result.rejected).toBe(1);
  });

  it("剩余 1 个槽位时只接收第一张", () => {
    const result = appendAttachedImages(
      [attached("a"), attached("b")],
      [attached("c"), attached("d")],
    );
    expect(result.images.map((image) => image.id)).toEqual(["a", "b", "c"]);
    expect(result.rejected).toBe(1);
  });
});

describe("formatImageMeta", () => {
  it("展示尺寸、体积与实际质量", () => {
    expect(formatImageMeta(attached("a", 100 * 1024))).toBe("1568×1045 · 100KB · q0.82");
    expect(formatImageMeta(attached("b", 1.5 * 1024 * 1024))).toBe("1568×1045 · 1.5MB · q0.82");
  });
});
