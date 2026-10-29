import { describe, it, expect } from "vitest";

import {
  EMBEDDING_PRESETS,
  MAX_EMBEDDING_CHARS,
  embeddingInput,
  embeddingModelFor,
  fnv1a,
} from "@/lib/embedding";

describe("EMBEDDING_PRESETS", () => {
  it("只收录 OpenAI 与阿里云两个维度确定的预设", () => {
    expect(EMBEDDING_PRESETS.map((p) => p.id)).toEqual(["openai", "dashscope"]);
  });

  it("OpenAI：text-embedding-3-small / 1536", () => {
    const preset = EMBEDDING_PRESETS.find((p) => p.id === "openai")!;
    expect(preset.model).toBe("text-embedding-3-small");
    expect(preset.dim).toBe(1536);
    expect(preset.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("阿里云：text-embedding-v3 / 1024", () => {
    const preset = EMBEDDING_PRESETS.find((p) => p.id === "dashscope")!;
    expect(preset.model).toBe("text-embedding-v3");
    expect(preset.dim).toBe(1024);
    expect(preset.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });
});

describe("embeddingModelFor", () => {
  it("按 baseUrl 识别 OpenAI，并去掉末尾斜杠", () => {
    const model = embeddingModelFor({ baseUrl: "https://api.openai.com/v1/" });
    expect(model).toEqual({
      preset: "openai",
      label: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
      dim: 1536,
    });
  });

  it("host 大小写不敏感", () => {
    expect(embeddingModelFor({ baseUrl: "https://API.OPENAI.COM/v1" })?.preset).toBe("openai");
  });

  it("按 baseUrl 识别阿里云（含国际站）", () => {
    expect(
      embeddingModelFor({ baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" }),
    ).toMatchObject({ preset: "dashscope", model: "text-embedding-v3", dim: 1024 });
    expect(
      embeddingModelFor({ baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" }),
    ).toMatchObject({ preset: "dashscope", dim: 1024 });
  });

  it("baseUrl 为空时按 api 标识回落到预设官方地址", () => {
    expect(embeddingModelFor({ api: "OpenAI" })).toMatchObject({
      preset: "openai",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(embeddingModelFor({ api: "阿里云" })).toMatchObject({ preset: "dashscope" });
    expect(embeddingModelFor({ api: "dashscope" })).toMatchObject({ preset: "dashscope" });
    expect(embeddingModelFor({ api: "通义千问" })).toMatchObject({ preset: "dashscope" });
  });

  it("用户填了代理地址时保留用户的 baseUrl", () => {
    const model = embeddingModelFor({
      api: "openai",
      baseUrl: "https://my-proxy.example.com/v1/",
    });
    expect(model).toMatchObject({
      preset: "openai",
      baseUrl: "https://my-proxy.example.com/v1",
      model: "text-embedding-3-small",
      dim: 1536,
    });
  });

  it("显式模型可以在自定义代理上解析出维度", () => {
    const model = embeddingModelFor({
      baseUrl: "https://my-proxy.example.com/v1",
      embeddingModel: "text-embedding-3-small",
    });
    expect(model).toMatchObject({
      preset: "openai",
      baseUrl: "https://my-proxy.example.com/v1",
      dim: 1536,
    });
  });

  it("模型优先于 api 标识：模型决定维度", () => {
    const model = embeddingModelFor({ api: "openai", embeddingModel: "text-embedding-v3" });
    expect(model).toMatchObject({ preset: "dashscope", model: "text-embedding-v3", dim: 1024 });
  });

  it("未知维度的模型返回 null，而不是猜一个维度", () => {
    expect(embeddingModelFor({ embeddingModel: "bge-m3" })).toBeNull();
    expect(embeddingModelFor({ api: "openai", embeddingModel: "text-embedding-3-large" })).toBeNull();
  });

  it("DeepSeek / 自定义兼容端点没有 embedding 预设时返回 null", () => {
    expect(embeddingModelFor({ baseUrl: "https://api.deepseek.com/v1" })).toBeNull();
    expect(embeddingModelFor({ api: "deepseek", baseUrl: "https://api.deepseek.com/v1" })).toBeNull();
    expect(
      embeddingModelFor({ api: "openai-compatible", baseUrl: "https://api.moonshot.cn/v1" }),
    ).toBeNull();
    expect(embeddingModelFor({})).toBeNull();
  });

  it("baseUrl 非法时仍可按 api 标识识别", () => {
    expect(embeddingModelFor({ api: "openai", baseUrl: "not a url" })).toMatchObject({
      preset: "openai",
      baseUrl: "not a url",
    });
  });

  it("host 后缀伪装不会命中预设", () => {
    expect(embeddingModelFor({ baseUrl: "https://api.openai.com.evil.test/v1" })).toBeNull();
  });
});

describe("embeddingInput", () => {
  it("标题与正文用空行分隔", () => {
    expect(embeddingInput({ title: "栈", text: "后进先出" })).toBe("栈\n\n后进先出");
  });

  it("两端空白被去掉", () => {
    expect(embeddingInput({ title: "  栈  ", text: "  后进先出  " })).toBe("栈\n\n后进先出");
  });

  it("标题为空时不留空行", () => {
    expect(embeddingInput({ title: "", text: "后进先出" })).toBe("后进先出");
    expect(embeddingInput({ text: "后进先出" })).toBe("后进先出");
  });

  it("正文为空时只返回标题", () => {
    expect(embeddingInput({ title: "栈", text: "" })).toBe("栈");
    expect(embeddingInput({ title: "栈", text: "   " })).toBe("栈");
  });

  it("全空输入返回空串", () => {
    expect(embeddingInput({ title: "", text: "" })).toBe("");
  });

  it("超过 2000 码点时按码点截断", () => {
    const result = embeddingInput({ text: "字".repeat(MAX_EMBEDDING_CHARS + 500) });
    expect(Array.from(result)).toHaveLength(MAX_EMBEDDING_CHARS);
  });

  it("截断不会把代理对切成半个字符", () => {
    const result = embeddingInput({ text: "😀".repeat(MAX_EMBEDDING_CHARS + 100) });
    expect(Array.from(result)).toHaveLength(MAX_EMBEDDING_CHARS);
    expect(result.length).toBe(MAX_EMBEDDING_CHARS * 2);
    expect(result.isWellFormed()).toBe(true);
  });

  it("标题也计入 2000 码点预算", () => {
    const title = "标".repeat(10);
    const result = embeddingInput({ title, text: "正".repeat(3000) });
    expect(Array.from(result)).toHaveLength(MAX_EMBEDDING_CHARS);
    expect(result.startsWith(`${title}\n\n`)).toBe(true);
  });
});

describe("fnv1a", () => {
  it("与 FNV-1a 32 位标准测试向量一致", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
  });

  it("固定输出 8 位小写十六进制", () => {
    for (const text of ["", "栈", "时间复杂度", "😀", "O(n log n)"]) {
      expect(fnv1a(text)).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it("同一输入稳定，不同输入不同", () => {
    expect(fnv1a("栈与队列")).toBe(fnv1a("栈与队列"));
    expect(fnv1a("栈")).not.toBe(fnv1a("队列"));
    expect(fnv1a("栈")).not.toBe(fnv1a("栈 "));
  });
});
