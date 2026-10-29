import { describe, expect, it } from "vitest";

import { PATTERNS, scanText } from "@/lib/secretScan";

/**
 * 扫描器自身的回归。
 *
 * 所有「疑似口令」都用运行时拼接：如果写成字面量，测试文件本身就会出现在
 * `npm run check:secrets` 的命中列表里，CI 会因为测试而红。
 * 这里验证的三件事对应 docs/review/2026-10-29-full-review.md 的 P0-1：
 * - Playwright `page.fill` 里的 15 位口令必须命中（通用规则从 16 位起跳，漏的正是它）；
 * - 通用阈值不能为了它降到会误报 fake-key-5678 这类测试占位符；
 * - 正常文档/提示文案不命中。
 */

describe("scanText", () => {
  it("命中 page.fill 里的 15 位明文口令（低于通用 16 位阈值）", () => {
    const pw = "1234567890" + "12345";
    expect(pw).toHaveLength(15);

    const call =
      "await page" + ".fill('input[type=" + "pass" + "word]', '" + pw + "');";
    const hits = scanText(call);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.pattern).toBe("page.fill 明文口令");
    expect(hits[0]?.line).toBe(1);
  });

  it("page.fill 的 selector 不含口令语义时不误报", () => {
    const call = "await page" + ".fill('#email', 'someone@example.com');";
    expect(scanText(call)).toEqual([]);
  });

  it("通用阈值仍是 16 位：fake-key-5678 不报，16 位赋值照报", () => {
    const placeholder = "fake" + "-key-5678";
    expect(placeholder).toHaveLength(13);
    expect(scanText(`const API_KEY = "${placeholder}";`)).toEqual([]);

    const secretValue = "abcdefghijklmn" + "op";
    expect(secretValue).toHaveLength(16);
    const hits = scanText(`const API_KEY = "${secretValue}";`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.pattern).toBe("赋了值的密钥变量");
  });

  it("正常文案与占位符不命中", () => {
    expect(scanText("请在设置页填写密码，长度至少 8 位；口令只保存在服务端。")).toEqual([]);
    expect(scanText("password 字段必填，错误时提示「密码不正确」。")).toEqual([]);
    expect(scanText("DEEPSEEK_API_KEY=your_api_key_here")).toEqual([]);
    expect(scanText("Authorization: Bearer <REDACTED>")).toEqual([]);
  });

  it("规则模块自身不含会被自己命中的字面量（否则 check:secrets 会扫到自己）", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./secretScan.ts", import.meta.url), "utf8");
    expect(scanText(source)).toEqual([]);
  });

  it("PATTERNS 覆盖 page.fill 规则", () => {
    expect(PATTERNS.some((p) => p.name === "page.fill 明文口令")).toBe(true);
  });
});
