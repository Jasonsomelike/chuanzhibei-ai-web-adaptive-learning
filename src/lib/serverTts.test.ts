import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AllowedTarget, GuardedResponse } from "@/lib/ssrfGuard";

/**
 * 这里 mock 掉 ssrfGuard 的传输层：本文件只验证「请求怎么拼、响应怎么解析、
 * 错误怎么分类」。SSRF 判定与 60s/10MB 的真实执行由 ssrfGuard.test.ts 覆盖，
 * 这里的断言确保调用方确实把这两个上限传了下去。
 */

const g = vi.hoisted(() => ({
  assertUpstreamAllowed: vi.fn(),
  guardedRequest: vi.fn(),
}));

vi.mock("@/lib/ssrfGuard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssrfGuard")>();
  return {
    ...actual,
    assertUpstreamAllowed: g.assertUpstreamAllowed,
    guardedRequest: g.guardedRequest,
  };
});

import { SsrfGuardError, UpstreamRequestError } from "@/lib/ssrfGuard";
import {
  DEFAULT_MIMO_VOICE,
  MAX_TTS_RESPONSE_BYTES,
  resolveTtsApi,
  synthesizeMimo,
  synthesizeSpeech,
  TTS_TIMEOUT_MS,
  TtsUpstreamError,
  type TtsRow,
} from "@/lib/serverTts";

interface CapturedRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

function allowedTarget(raw: string): AllowedTarget {
  const url = new URL(raw);
  return {
    url,
    hostname: url.hostname,
    pinned: "93.184.216.34",
    servername: url.hostname,
  };
}

function response(
  body: Buffer,
  status = 200,
  contentType = "application/json",
): GuardedResponse {
  return { status, headers: { "content-type": contentType }, body };
}

function base64(bytes: readonly number[]): string {
  return Buffer.from(bytes).toString("base64");
}

function mimoRow(overrides: Partial<TtsRow> = {}): TtsRow {
  return {
    baseUrl: "https://mimo.example.com/v1",
    apiKey: "sk-mimo-secret",
    model: "mimo-v2-flash",
    voice: "茉莉",
    api: "mimo",
    ...overrides,
  };
}

function firstCall(): { target: AllowedTarget; options: CapturedRequest } {
  const call = g.guardedRequest.mock.calls[0];
  return {
    target: call[0] as AllowedTarget,
    options: call[1] as CapturedRequest,
  };
}

beforeEach(() => {
  g.assertUpstreamAllowed.mockReset();
  g.guardedRequest.mockReset();
  g.assertUpstreamAllowed.mockImplementation(async (raw: string) => allowedTarget(raw));
  g.guardedRequest.mockResolvedValue(response(Buffer.from("{}")));
});

describe("synthesizeMimo", () => {
  it("只走 {baseUrl}/chat/completions，绝不出现 /audio/speech", async () => {
    g.guardedRequest.mockResolvedValue(
      response(
        Buffer.from(
          JSON.stringify({
            choices: [{ message: { audio: { data: base64([0x49, 0x44, 0x33, 0x04]) } } }],
          }),
        ),
      ),
    );

    const audio = await synthesizeMimo(mimoRow(), "你好，世界", "茉莉");

    const { target, options } = firstCall();
    expect(target.url.toString()).toBe("https://mimo.example.com/v1/chat/completions");
    expect(target.url.toString()).not.toContain("/audio/speech");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer sk-mimo-secret");
    expect(JSON.parse(options.body)).toEqual({
      model: "mimo-v2-flash",
      messages: [{ role: "assistant", content: "你好，世界" }],
      modalities: ["audio"],
      audio: { voice: "茉莉", format: "mp3" },
    });
    // 60 秒与 10MB 是调用方必须传下去的上限，不在传输层临时改。
    expect(options.timeoutMs).toBe(TTS_TIMEOUT_MS);
    expect(options.maxBytes).toBe(MAX_TTS_RESPONSE_BYTES);
    expect(audio.contentType).toBe("audio/mpeg");
    expect([...audio.bytes]).toEqual([0x49, 0x44, 0x33, 0x04]);
  });

  it("没传 voice 时用行里的音色，再缺省用茉莉", async () => {
    g.guardedRequest.mockResolvedValue(
      response(
        Buffer.from(
          JSON.stringify({ choices: [{ message: { audio: { data: base64([0x49, 0x44, 0x33]) } } }] }),
        ),
      ),
    );

    await synthesizeMimo(mimoRow({ voice: "小爱" }), "读一下", undefined);
    expect(
      (JSON.parse(firstCall().options.body) as { audio: { voice: string } }).audio.voice,
    ).toBe("小爱");

    g.guardedRequest.mockClear();
    await synthesizeMimo(mimoRow({ voice: undefined }), "读一下", undefined);
    expect(
      (JSON.parse(firstCall().options.body) as { audio: { voice: string } }).audio.voice,
    ).toBe(DEFAULT_MIMO_VOICE);
  });

  it("响应里没有音频字段归为 parse", async () => {
    g.guardedRequest.mockResolvedValue(response(Buffer.from(JSON.stringify({ choices: [] }))));

    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({ kind: "parse" });
  });

  it("base64 非法与空字段都归为 parse", async () => {
    g.guardedRequest.mockResolvedValue(
      response(
        Buffer.from(JSON.stringify({ choices: [{ message: { audio: { data: "!!!!" } } }] })),
      ),
    );
    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({ kind: "parse" });

    g.guardedRequest.mockResolvedValue(
      response(Buffer.from(JSON.stringify({ choices: [{ message: { audio: { data: "" } } }] }))),
    );
    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({ kind: "parse" });
  });

  it("401 归为 auth，500 的正文脱敏后截断", async () => {
    g.guardedRequest.mockResolvedValue(
      response(Buffer.from("bad key sk-mimo-secret"), 401, "text/plain"),
    );
    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });

    const longBody = `sk-mimo-secret ${"x".repeat(500)}`;
    g.guardedRequest.mockResolvedValue(response(Buffer.from(longBody), 500, "text/plain"));
    const error = await synthesizeMimo(mimoRow(), "你好").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TtsUpstreamError);
    expect((error as TtsUpstreamError).kind).toBe("http");
    expect((error as TtsUpstreamError).message).not.toContain("sk-mimo-secret");
    expect((error as TtsUpstreamError).message).toContain("***");
    // 前缀 + 200 字截断；不允许把整个 500 字正文搬进响应
    expect((error as TtsUpstreamError).message.length).toBeLessThan(280);
  });

  it("缺模型名归为 config，不发请求", async () => {
    await expect(synthesizeMimo(mimoRow({ model: "" }), "你好")).rejects.toMatchObject({
      kind: "config",
    });
    expect(g.assertUpstreamAllowed).not.toHaveBeenCalled();
    expect(g.guardedRequest).not.toHaveBeenCalled();
  });
});

describe("synthesizeSpeech", () => {
  it("旧协议走 {baseUrl}/audio/speech 并原样返回音频字节", async () => {
    g.guardedRequest.mockResolvedValue(
      response(Buffer.from([0xff, 0xfb, 0x90]), 200, "audio/mpeg"),
    );

    const audio = await synthesizeSpeech(
      {
        baseUrl: "https://tts.example.com/v1",
        apiKey: "sk-tts-secret",
        model: "tts-1",
        voice: "alloy",
        api: "speech",
      },
      "朗读文本",
    );

    const { target, options } = firstCall();
    expect(target.url.toString()).toBe("https://tts.example.com/v1/audio/speech");
    expect(JSON.parse(options.body)).toEqual({
      model: "tts-1",
      voice: "alloy",
      input: "朗读文本",
      response_format: "mp3",
      speed: 1,
    });
    expect(options.timeoutMs).toBe(TTS_TIMEOUT_MS);
    expect(audio.contentType).toBe("audio/mpeg");
    expect([...audio.bytes]).toEqual([0xff, 0xfb, 0x90]);
  });

  it("返回 JSON 说明不是音频，归为 parse", async () => {
    g.guardedRequest.mockResolvedValue(
      response(Buffer.from(JSON.stringify({ error: "boom" })), 200, "application/json"),
    );

    await expect(
      synthesizeSpeech(
        { baseUrl: "https://tts.example.com/v1", apiKey: "k", model: "tts-1" },
        "朗读文本",
      ),
    ).rejects.toMatchObject({ kind: "parse" });
  });
});

describe("传输层错误分类", () => {
  it("地址被 SSRF 守卫拒绝时归为 blocked，不发请求", async () => {
    g.assertUpstreamAllowed.mockRejectedValue(
      new SsrfGuardError("blocked-address", "目标是内网地址 127.0.0.1（loopback）"),
    );

    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({ kind: "blocked" });
    expect(g.guardedRequest).not.toHaveBeenCalled();
  });

  it("超时与超限分别归为 timeout / too-large", async () => {
    g.guardedRequest.mockRejectedValue(
      new UpstreamRequestError("timeout", "上游在 60000ms 内没有完成响应"),
    );
    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({ kind: "timeout" });

    g.guardedRequest.mockRejectedValue(
      new UpstreamRequestError("too-large", "上游响应超过 10485760 字节"),
    );
    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({
      kind: "too-large",
    });
  });

  it("3xx 不跟随", async () => {
    g.guardedRequest.mockResolvedValue(response(Buffer.from(""), 302, "text/plain"));
    await expect(synthesizeMimo(mimoRow(), "你好")).rejects.toMatchObject({
      kind: "http",
      status: 302,
    });
  });

  it("常量是 60 秒与 10MB", () => {
    expect(TTS_TIMEOUT_MS).toBe(60_000);
    expect(MAX_TTS_RESPONSE_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("resolveTtsApi", () => {
  it("只认 mimo | speech，兼容 protocol 与地址推断", () => {
    expect(resolveTtsApi({ api: "mimo", baseUrl: "https://x/v1" })).toBe("mimo");
    expect(resolveTtsApi({ api: "speech", baseUrl: "https://x/v1" })).toBe("speech");
    expect(resolveTtsApi({ protocol: "chat-audio", baseUrl: "https://x/v1" })).toBe("mimo");
    expect(resolveTtsApi({ protocol: "speech", baseUrl: "https://x/v1" })).toBe("speech");
    expect(resolveTtsApi({ baseUrl: "https://mimo.example.com/v1" })).toBe("mimo");
    expect(resolveTtsApi({ baseUrl: "https://tts.example.com/v1" })).toBe("speech");
  });

  it("api 列是引擎名时以 protocol 为准（/api/config 的真实存法）", () => {
    // config 里 tts.api = engine，MiMo 的真实协议在 options.protocol=chat-audio。
    expect(
      resolveTtsApi({
        api: "openai-compatible",
        protocol: "chat-audio",
        baseUrl: "https://api.example.com/v1",
      }),
    ).toBe("mimo");
    expect(
      resolveTtsApi({
        api: "openai-compatible",
        protocol: "speech",
        baseUrl: "https://api.example.com/v1",
      }),
    ).toBe("speech");
    // 没有 protocol 时才退回地址推断。
    expect(
      resolveTtsApi({
        api: "openai-compatible",
        baseUrl: "https://mimo.example.com/v1",
      }),
    ).toBe("mimo");
  });
});
