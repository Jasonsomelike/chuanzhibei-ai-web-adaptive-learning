import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 上限常量的环境变量覆盖。
 *
 * 这些常量在模块加载时求值，必须 resetModules 后重新 import 才能看到新值；
 * 每个用例结束后恢复 env 与模块缓存，避免污染同进程的其它测试文件。
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("ALP_MAX_* 覆盖安全上限", () => {
  it("knowledge 的 PDF 页数/文件大小/字数/方向容量", async () => {
    vi.stubEnv("ALP_MAX_KB_FILE_BYTES", "12345678");
    vi.stubEnv("ALP_MAX_KB_PDF_PAGES", "1234");
    vi.stubEnv("ALP_MAX_KB_FILE_CHARS", "2345678");
    vi.stubEnv("ALP_MAX_KB_DIRECTION_CHUNKS", "4321");
    vi.stubEnv("ALP_MAX_KB_DIRECTION_CHARS", "8765432");
    vi.resetModules();

    const knowledge = await import("@/lib/knowledge");
    expect(knowledge.MAX_FILE_BYTES).toBe(12_345_678);
    expect(knowledge.MAX_PDF_PAGES).toBe(1_234);
    expect(knowledge.MAX_FILE_CHARS).toBe(2_345_678);
    expect(knowledge.MAX_DIRECTION_CHUNKS).toBe(4_321);
    expect(knowledge.MAX_DIRECTION_CHARS).toBe(8_765_432);
  });

  it("kbServer 的 MAX_KB_PUT_BYTES 读 ALP_MAX_KB_BYTES", async () => {
    vi.stubEnv("ALP_MAX_KB_BYTES", "1048576");
    vi.resetModules();

    const kbServer = await import("@/lib/kbServer");
    expect(kbServer.MAX_KB_PUT_BYTES).toBe(1_048_576);
  });

  it("非法值回落到默认安全上限", async () => {
    vi.stubEnv("ALP_MAX_KB_BYTES", "0");
    vi.stubEnv("ALP_MAX_KB_PDF_PAGES", "not-a-number");
    vi.resetModules();

    const [kbServer, knowledge] = await Promise.all([
      import("@/lib/kbServer"),
      import("@/lib/knowledge"),
    ]);
    expect(kbServer.MAX_KB_PUT_BYTES).toBe(32 * 1024 * 1024);
    expect(knowledge.MAX_PDF_PAGES).toBe(2_000);
  });
});
