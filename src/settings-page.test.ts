/**
 * 设置页新增分区（语气 / MCP / 向量检索）的纯函数测试。
 *
 * 页面本身是客户端组件，没有 DOM 测试环境；因此把可判定的部分抽成纯函数，
 * 在这里覆盖「解析、掩码、错误翻译、降级文案、常量对齐」。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TUTOR_TONE,
  TONE_LABELS,
  TUTOR_TONES,
} from "@/lib/tutorPersona";
import { MAX_ALLOWED_TOOLS as STORE_MAX_ALLOWED_TOOLS } from "@/lib/mcpStore";
import { KB_LOCAL_VECTOR_DIM, KB_LOCAL_VECTOR_MODEL } from "@/lib/vectorContracts";
import {
  LOCAL_EMBED_DIM_LABEL,
  LOCAL_EMBED_MODEL_LABEL,
  MCP_MAX_ALLOWED_TOOLS,
  TONE_NOTES,
  TUTOR_TONE_KEY,
  embedFailureText,
  formatBytesText,
  isValidMcpServerIdInput,
  mcpAuthSummary,
  mcpAvailabilityNote,
  mcpErrorText,
  parseAllowedToolsInput,
  parseKbChunksPayload,
  parseMcpServerPayload,
  parseMcpServersPayload,
  parseTutorTone,
  parseVectorChunkIdsPayload,
  summarizeModelProbe,
  vectorSyncPercent,
  vectorSyncText,
  type ModelFileProbe,
} from "../app/settings/sections";

describe("语气：三选一与本机存储", () => {
  it("三种语气都能解析，未知值回落到默认", () => {
    for (const tone of TUTOR_TONES) {
      expect(parseTutorTone(tone)).toBe(tone);
      expect(TONE_LABELS[tone]).not.toBe("");
    }
    expect(parseTutorTone("rude")).toBe(DEFAULT_TUTOR_TONE);
    expect(parseTutorTone(null)).toBe(DEFAULT_TUTOR_TONE);
    expect(parseTutorTone(undefined)).toBe(DEFAULT_TUTOR_TONE);
    expect(parseTutorTone("")).toBe(DEFAULT_TUTOR_TONE);
  });

  it("存储键固定，避免与 provider / search / tts 的键混用", () => {
    expect(TUTOR_TONE_KEY).toBe("alp.tutor.tone.v1");
    expect(TUTOR_TONE_KEY).not.toBe("alp.provider.v1");
  });

  it("三种语气都有说明文案，界面不会出现空按钮", () => {
    for (const tone of TUTOR_TONES) {
      expect(TONE_NOTES[tone].trim()).not.toBe("");
    }
  });
});

describe("MCP：serverId 与工具白名单", () => {
  it("serverId 与 mcpClient 的字符集一致", () => {
    expect(isValidMcpServerIdInput("my-server_1")).toBe(true);
    expect(isValidMcpServerIdInput("a")).toBe(true);
    expect(isValidMcpServerIdInput("-bad")).toBe(false);
    expect(isValidMcpServerIdInput("bad id")).toBe(false);
    expect(isValidMcpServerIdInput("中文")).toBe(false);
    expect(isValidMcpServerIdInput("a".repeat(32))).toBe(true);
    expect(isValidMcpServerIdInput("a".repeat(33))).toBe(false);
  });

  it("白名单支持逗号与换行、去重保序，非法名直接报错", () => {
    expect(parseAllowedToolsInput("search, fetch_page\nsearch")).toEqual({
      ok: true,
      tools: ["search", "fetch_page"],
    });
    expect(parseAllowedToolsInput("   ")).toEqual({ ok: true, tools: [] });

    const bad = parseAllowedToolsInput("search, bad name");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain("工具名不合法");

    const tooMany = parseAllowedToolsInput(
      Array.from({ length: MCP_MAX_ALLOWED_TOOLS + 1 }, (_, index) => `tool_${index}`).join(","),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.message).toContain("最多");
  });

  it("上限与 mcpStore 保持一致", () => {
    expect(MCP_MAX_ALLOWED_TOOLS).toBe(STORE_MAX_ALLOWED_TOOLS);
  });
});

describe("MCP：列表解析与鉴权掩码", () => {
  it("解析公开条目：坏条目丢弃、白名单清洗、label 回落到 serverId", () => {
    const servers = parseMcpServersPayload({
      servers: [
        {
          serverId: "my-mcp",
          label: "",
          url: "https://mcp.example.com/mcp",
          enabled: true,
          allowedTools: ["search", "bad name", "search"],
          authConfigured: true,
          authHint: "••••abcd",
          createdAt: "2026-10-30T00:00:00.000Z",
          updatedAt: "2026-10-30T00:00:00.000Z",
        },
        { serverId: "-bad", url: "https://evil.example.com" },
        { serverId: "no-url", url: "  " },
        "not-an-object",
      ],
    });

    expect(servers).not.toBeNull();
    expect(servers).toHaveLength(1);
    const server = servers?.[0];
    expect(server?.serverId).toBe("my-mcp");
    expect(server?.label).toBe("my-mcp");
    expect(server?.enabled).toBe(true);
    expect(server?.allowedTools).toEqual(["search"]);
    expect(server?.authHint).toBe("••••abcd");
    // 公开形状不能夹带任何密文字段
    expect(Object.keys(server ?? {})).not.toContain("auth");
    expect(Object.keys(server ?? {})).not.toContain("auth_ct");
  });

  it("形状不对时返回 null，调用方必须显示错误而不是空列表", () => {
    expect(parseMcpServersPayload({})).toBeNull();
    expect(parseMcpServersPayload({ servers: "nope" })).toBeNull();
    expect(parseMcpServersPayload(null)).toBeNull();
    expect(parseMcpServerPayload({ server: { serverId: "s1", url: "https://x.example" } })?.serverId).toBe(
      "s1",
    );
    expect(parseMcpServerPayload({})).toBeNull();
  });

  it("鉴权头只显示服务端给的掩码，未配置时明确写未配置", () => {
    expect(mcpAuthSummary({ authConfigured: false, authHint: "" })).toBe("未配置鉴权头");
    expect(mcpAuthSummary({ authConfigured: true, authHint: "" })).toBe("已配置鉴权头");
    const masked = mcpAuthSummary({ authConfigured: true, authHint: "••••abcd" });
    expect(masked).toBe("已配置鉴权头（••••abcd）");
    expect(masked).not.toContain("Bearer");
  });
});

describe("MCP：不可用原因与错误翻译", () => {
  it("未登录与本机模式各有明确原因，服务端模式可用", () => {
    const anonymous = mcpAvailabilityNote(false, "local");
    expect(anonymous).toContain("未登录");
    expect(anonymous).toContain("401");

    const local = mcpAvailabilityNote(true, "local");
    expect(local).toContain("本机模式");
    expect(local).toContain("服务端 Agent");

    expect(mcpAvailabilityNote(true, "server")).toBeNull();
  });

  it("路由错误体翻成人话，401/403 有固定提示", () => {
    expect(
      mcpErrorText(409, {
        error: { code: "TOO_MANY_SERVERS", message: "最多只能配置 20 个 MCP 服务器。" },
      }),
    ).toContain("20");
    expect(
      mcpErrorText(400, { error: { code: "INVALID_URL", message: "MCP 服务器地址不被允许：内网地址" } }),
    ).toContain("内网");
    expect(mcpErrorText(401, null)).toContain("登录已过期");
    expect(mcpErrorText(403, null)).toContain("跨站");
    expect(mcpErrorText(500, null)).toContain("HTTP 500");
  });
});

describe("向量检索：模型文件、降级文案与同步进度", () => {
  const files: ModelFileProbe[] = [
    { label: "模型权重", path: "/models/a", ok: true, status: 200, bytes: 24_010_842 },
    { label: "分词器", path: "/models/b", ok: true, status: 200, bytes: 439_125 },
    { label: "模型配置", path: "/models/c", ok: true, status: 200, bytes: 1024 },
  ];

  it("全部存在才算就绪，缺失文件要列出来", () => {
    const ready = summarizeModelProbe(files);
    expect(ready.ready).toBe(true);
    expect(ready.missing).toEqual([]);
    expect(ready.totalBytes).toBe(24_010_842 + 439_125 + 1024);

    const missing = summarizeModelProbe([
      ...files,
      { label: "推理库", path: "/embed/x.js", ok: false, status: 404, bytes: null },
    ]);
    expect(missing.ready).toBe(false);
    expect(missing.missing.map((file) => file.label)).toEqual(["推理库"]);
  });

  it("字节格式化对用户可读，且不会把缺失写成 0 MB", () => {
    expect(formatBytesText(0)).toBe("0 B");
    expect(formatBytesText(512)).toBe("512 B");
    expect(formatBytesText(2048)).toBe("2.0 KB");
    expect(formatBytesText(24_010_842)).toBe("22.9 MB");
  });

  it("Worker 失败原因都有对应的人话，未知原因不吞消息", () => {
    expect(embedFailureText("model-missing", "加载模型失败")).toBe(
      "本地模型或推理库文件缺失：加载模型失败",
    );
    expect(embedFailureText("unsupported", "")).toContain("Web Worker");
    expect(embedFailureText("something-new", "细节")).toBe("本地嵌入失败：细节");
  });

  it("同步状态文案与百分比覆盖 idle/loading/embedding/uploading/ready/unavailable", () => {
    expect(vectorSyncText(null)).toBe("未开始");
    expect(vectorSyncText({ status: "idle", done: 0, total: 0, message: null })).toBe("未开始");
    expect(vectorSyncText({ status: "loading", done: 0, total: 0, message: null })).toContain(
      "远端已有向量",
    );
    expect(vectorSyncText({ status: "embedding", done: 8, total: 16, message: null })).toBe(
      "本地嵌入 8/16",
    );
    expect(vectorSyncText({ status: "uploading", done: 4, total: 8, message: null })).toBe(
      "上传向量 4/8",
    );
    expect(vectorSyncText({ status: "ready", done: 0, total: 0, message: null })).toBe(
      "没有需要补建的片段",
    );
    expect(vectorSyncText({ status: "ready", done: 8, total: 8, message: null })).toBe(
      "已就绪（8/8）",
    );
    expect(
      vectorSyncText({ status: "unavailable", done: 0, total: 0, message: "模型缺失" }),
    ).toBe("不可用：模型缺失");

    expect(vectorSyncPercent({ status: "embedding", done: 8, total: 16, message: null })).toBe(50);
    expect(vectorSyncPercent({ status: "ready", done: 0, total: 0, message: null })).toBeNull();
    expect(vectorSyncPercent(null)).toBeNull();
  });

  it("/api/kb 的片段列表只保留可重建的字段，坏 id 与空正文丢弃", () => {
    const chunks = parseKbChunksPayload({
      docs: [{ id: "doc-1" }],
      chunks: [
        { id: "doc-1:0", title: "讲义", text: "第一段正文", embedding: [0.1] },
        { id: "bad id", title: "坏 id", text: "正文" },
        { id: "doc-1:1", title: "空正文", text: "   " },
        { id: "doc-1:2", title: "", text: "第二段正文" },
        "not-an-object",
      ],
    });
    expect(chunks).toEqual([
      { id: "doc-1:0", title: "讲义", text: "第一段正文" },
      { id: "doc-1:2", title: "", text: "第二段正文" },
    ]);
    expect(parseKbChunksPayload({ docs: [] })).toBeNull();
  });

  it("/api/kb/vectors 的 chunkIds 去重并挡掉非法 id", () => {
    expect(
      parseVectorChunkIdsPayload({
        model: KB_LOCAL_VECTOR_MODEL,
        dim: KB_LOCAL_VECTOR_DIM,
        chunkIds: ["doc-1:0", "doc-1:0", "bad id", 3],
      }),
    ).toEqual(["doc-1:0"]);
    expect(parseVectorChunkIdsPayload({})).toBeNull();
  });

  it("页面常量与向量契约保持一致，防止模型名/维度漂移", () => {
    expect(LOCAL_EMBED_MODEL_LABEL).toBe(KB_LOCAL_VECTOR_MODEL);
    expect(LOCAL_EMBED_DIM_LABEL).toBe(KB_LOCAL_VECTOR_DIM);
  });
});
