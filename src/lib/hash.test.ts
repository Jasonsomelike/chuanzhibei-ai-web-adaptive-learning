import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Sync } from "@/lib/plan";

/**
 * plan.ts 里的 path_hash 依赖一个手写的纯 JS SHA-256。
 *
 * 为什么要手写：planPath 必须是同步纯函数，而 Web Crypto 的
 * subtle.digest 是异步的，浏览器里没有同步的哈希 API。
 *
 * 手写 SHA-256 最容易在消息填充边界出错（55/56/63/64/119/120 字节），
 * 所以这里用 Node 内置 crypto 逐条交叉验证，把每个边界都覆盖到。
 */

const nodeSha256 = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

describe("手写 SHA-256 与 Node crypto 一致", () => {
  const cases: Array<[string, string]> = [
    ["空串", ""],
    ["短串 abc", "abc"],
    ["含空格", "hello world"],
    ["中文", "中文测试"],
    ["恰好 55 字节（填充边界前）", "a".repeat(55)],
    ["恰好 56 字节（触发额外分组）", "b".repeat(56)],
    ["恰好 63 字节", "c".repeat(63)],
    ["恰好 64 字节", "d".repeat(64)],
    ["恰好 119 字节", "e".repeat(119)],
    ["恰好 120 字节", "f".repeat(120)],
    ["128 字节", "g".repeat(128)],
    ["1000 字节", "h".repeat(1000)],
    ["中英混合长串", "知识点".repeat(200)],
    ["JSON 形状的串", '{"steps":[],"algoVersion":"plan-v1","kgVersion":"kg-v1"}'],
  ];

  for (const [label, input] of cases) {
    it(label, () => {
      expect(sha256Sync(input)).toBe(nodeSha256(input));
    });
  }
});

describe("哈希的确定性", () => {
  it("同一输入永远得到同一输出", () => {
    const a = sha256Sync("plan-v1");
    const b = sha256Sync("plan-v1");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("不同输入得到不同输出", () => {
    expect(sha256Sync("plan-v1")).not.toBe(sha256Sync("plan-v2"));
  });

  it("单字符差异会改变全部输出（雪崩效应）", () => {
    const a = sha256Sync("kg-v1");
    const b = sha256Sync("kg-v2");
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
    expect(diff).toBeGreaterThan(50); // 64 个十六进制字符里应有大量不同
  });
});
