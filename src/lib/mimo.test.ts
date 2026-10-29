import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MIMO_AUDIO_MIME,
  buildMimoTtsBody,
  decodeBase64Audio,
  mimoEndpoint,
  parseMimoTtsResponse,
} from "@/lib/mimo";

describe("mimoEndpoint", () => {
  it("在 API 根地址后拼接 /chat/completions", () => {
    expect(mimoEndpoint("https://api.mimo.example/v1")).toBe(
      "https://api.mimo.example/v1/chat/completions",
    );
  });

  it("去掉尾部斜杠，不会拼出双斜杠", () => {
    expect(mimoEndpoint(" https://api.mimo.example/v1/// ")).toBe(
      "https://api.mimo.example/v1/chat/completions",
    );
  });

  it("已以 /chat/completions 结尾时原样返回，不重复拼接", () => {
    const endpoint = "https://api.mimo.example/v1/chat/completions";
    expect(mimoEndpoint(endpoint)).toBe(endpoint);
    expect(mimoEndpoint(`${endpoint}/`)).toBe(endpoint);
    expect(mimoEndpoint("https://api.mimo.example/v1/Chat/Completions")).toBe(
      "https://api.mimo.example/v1/Chat/Completions",
    );
  });

  it("空地址返回空串，调用方不应据此发请求", () => {
    expect(mimoEndpoint("")).toBe("");
    expect(mimoEndpoint("   ")).toBe("");
  });

  it("任何输入都不会指向 OpenAI 的语音端点", () => {
    const samples = [
      "https://api.mimo.example/v1",
      "https://api.mimo.example/v1/",
      "https://api.mimo.example/v1/chat/completions",
      "https://api.mimo.example/v1/audio",
      "",
    ];
    for (const sample of samples) {
      expect(mimoEndpoint(sample)).not.toContain("/audio/speech");
    }
  });

  it("源码里不存在 OpenAI 语音路径，防止回归时被重新引入", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./mimo.ts", import.meta.url)),
      "utf8",
    );
    expect(source.toLowerCase()).not.toContain("audio/speech");
  });
});

describe("buildMimoTtsBody", () => {
  it("严格产出 MiMo 音频模态的请求体", () => {
    const body = buildMimoTtsBody({
      model: "mimo-audio",
      text: "后进先出。",
      voice: "female-cn",
    });

    expect(body).toEqual({
      model: "mimo-audio",
      messages: [{ role: "assistant", content: "后进先出。" }],
      modalities: ["audio"],
      audio: { voice: "female-cn", format: "mp3" },
    });
    expect(Object.keys(body)).toEqual(["model", "messages", "modalities", "audio"]);
    expect(Object.keys(body.messages[0])).toEqual(["role", "content"]);
    expect(Object.keys(body.audio)).toEqual(["voice", "format"]);
  });

  it("显式传 format=mp3 时输出不变，且不出现其它格式", () => {
    const body = buildMimoTtsBody({
      model: "m",
      text: "t",
      voice: "v",
      format: "mp3",
    });

    expect(body.audio.format).toBe("mp3");
    expect(JSON.stringify(body)).not.toMatch(/wav|opus|aac|flac/);
  });

  it("正文原样作为 assistant 内容，不裁剪、不改写标点", () => {
    const text = " 第一行\n第二行：带引号「内容」 ";
    const body = buildMimoTtsBody({ model: "m", text, voice: "v" });

    expect(body.messages[0].content).toBe(text);
    expect(body.messages[0].role).toBe("assistant");
  });
});

describe("parseMimoTtsResponse", () => {
  it("从 choices[0].message.audio.data 取 base64", () => {
    const raw = {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "",
            audio: { data: "UklGRg==", format: "mp3" },
          },
        },
      ],
    };

    expect(parseMimoTtsResponse(raw)).toBe("UklGRg==");
  });

  it("去掉 base64 两侧空白", () => {
    expect(
      parseMimoTtsResponse({
        choices: [{ message: { audio: { data: "  SGVsbG8=\n" } } }],
      }),
    ).toBe("SGVsbG8=");
  });

  it("层级缺失或类型不对时返回 null", () => {
    expect(parseMimoTtsResponse(null)).toBeNull();
    expect(parseMimoTtsResponse("文本")).toBeNull();
    expect(parseMimoTtsResponse({})).toBeNull();
    expect(parseMimoTtsResponse({ choices: [] })).toBeNull();
    expect(parseMimoTtsResponse({ choices: "不是数组" })).toBeNull();
    expect(parseMimoTtsResponse({ choices: [null] })).toBeNull();
    expect(parseMimoTtsResponse({ choices: [{ message: null }] })).toBeNull();
    expect(parseMimoTtsResponse({ choices: [{ message: {} }] })).toBeNull();
    expect(
      parseMimoTtsResponse({ choices: [{ message: { audio: { data: 42 } } }] }),
    ).toBeNull();
    expect(
      parseMimoTtsResponse({ choices: [{ message: { audio: { data: "   " } } }] }),
    ).toBeNull();
  });
});

describe("decodeBase64Audio", () => {
  it("解出音频字节", () => {
    const bytes = decodeBase64Audio("SGVsbG8=");

    expect(bytes).not.toBeNull();
    expect(Array.from(bytes ?? [])).toEqual([72, 101, 108, 108, 111]);
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe("Hello");
  });

  it("容忍 data URI 前缀、换行与缺失的补位", () => {
    expect(new TextDecoder().decode(decodeBase64Audio("data:audio/mpeg;base64,SGVsbG8=") ?? new Uint8Array())).toBe(
      "Hello",
    );
    expect(new TextDecoder().decode(decodeBase64Audio("SGVs\nbG8=") ?? new Uint8Array())).toBe(
      "Hello",
    );
    expect(new TextDecoder().decode(decodeBase64Audio("SGVsbG8") ?? new Uint8Array())).toBe(
      "Hello",
    );
  });

  it("非法输入返回 null 而不是抛错", () => {
    expect(decodeBase64Audio("")).toBeNull();
    expect(decodeBase64Audio("   ")).toBeNull();
    expect(decodeBase64Audio("!!!!")).toBeNull();
    expect(decodeBase64Audio("SGVs=bG8=")).toBeNull();
    expect(decodeBase64Audio("A")).toBeNull();
  });

  it("MIME 与 mp3 格式一致", () => {
    expect(MIMO_AUDIO_MIME).toBe("audio/mpeg");
  });
});
