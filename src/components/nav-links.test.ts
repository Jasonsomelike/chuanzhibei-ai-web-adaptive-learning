import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NAV_LINK_CLASS,
  NAV_LOGIN_CLASS,
  NAV_LOGOUT_CLASS,
} from "@/components/nav-links";

/**
 * F4 / P1-8：移动端可点目标 24–34px，低于 44px 拇指目标。
 * 这里锁住导航三个可点元素的类名常量；页面结构由人工复核，
 * 「登出按钮走常量」用源码断言，避免以后又写回一套内联小尺寸。
 */
const CLASS_CONSTANTS: Array<[string, string]> = [
  ["NAV_LINK_CLASS", NAV_LINK_CLASS],
  ["NAV_LOGOUT_CLASS", NAV_LOGOUT_CLASS],
  ["NAV_LOGIN_CLASS", NAV_LOGIN_CLASS],
];

describe("导航点击目标", () => {
  it.each(CLASS_CONSTANTS)("%s 在移动端给到 44px 触控高度", (_name, className) => {
    expect(className).toContain("min-h-11");
    expect(className).toContain("inline-flex");
    expect(className).toContain("items-center");
  });

  it.each(CLASS_CONSTANTS)("%s 不再使用 py-1* 这类小内边距", (_name, className) => {
    expect(className).not.toContain("py-1");
  });

  it.each(CLASS_CONSTANTS)("%s 在 sm 以上收回最小高度，桌面密度不变", (_name, className) => {
    expect(className).toContain("sm:min-h-0");
  });

  it.each(CLASS_CONSTANTS)("%s 带 pointer:coarse 的兜底标记", (_name, className) => {
    expect(className.split(/\s+/)).toContain("touch-target");
  });

  it("登出按钮复用导出常量，而不是另写一套小尺寸类名", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./nav-links.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toMatch(/className=\{NAV_LOGOUT_CLASS\}/);
  });
});
