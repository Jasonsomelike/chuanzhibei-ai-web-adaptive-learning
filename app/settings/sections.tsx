"use client";

/**
 * 设置页的三个新分区：语气 / 智能体与工具 / 向量检索。
 *
 * 为什么单独成文件：这三个分区带着 MCP CRUD、模型文件检查与向量重建的交互，
 * 静态写进 page.tsx 会把 /settings 首屏 JS 推过预算门禁（scripts/check-bundle.ts
 * 的 279.3KB 上限）。page.tsx 用 next/dynamic 在用户第一次切到这三个分区时
 * 才加载本模块，首屏不受影响。面板外框、标题与 aria 仍留在 page.tsx。
 *
 * 数据边界：
 * - 语气只存本机；账号契约缺 tone 字段（见 TUTOR_TONE_KEY 注释）。
 * - MCP 走 /api/mcp/servers 的 GET/PUT/DELETE，鉴权头只写不读。
 * - 向量索引走 /api/kb 与 /api/kb/vectors；模型推理在浏览器 Worker 里。
 */

import { useEffect, useRef, useState } from "react";

import { useClientSnapshot } from "@/lib/useClientSnapshot";
import {
  FormRow,
  Pill,
  SettingsGroup,
  inputClass,
  monoInputClass,
} from "@/components/ui";
import type { KbVectorSyncState } from "@/lib/kbRemote";
import type { PublicMcpServer } from "@/lib/mcpStore";
import type { CallMode } from "@/lib/serverConfig";
import { loadTutorTone, TUTOR_TONE_KEY } from "@/lib/tutorPreferences";
import {
  DEFAULT_TUTOR_TONE,
  TONE_LABELS,
  TUTOR_TONES,
  isTutorTone,
  type TutorTone,
} from "@/lib/tutorPersona";

// ── 语气：存储键与纯函数 ────────────────────────────────────────

/**
 * 语气只存这个浏览器。
 *
 * 服务端账号暂时存不了：PUT /api/config 的 llm 契约是 strictObject，没有 tone
 * 字段；userSecrets 的 options 白名单也不含 tone。要同步到账号，必须先扩展
 * src/lib/apiContracts.ts 与 src/lib/userSecrets.ts（不在设置页的改动范围）。
 */
export { TUTOR_TONE_KEY } from "@/lib/tutorPreferences";

export const TONE_NOTES: Readonly<Record<TutorTone, string>> = {
  companion: "先接住卡点，再讲知识；不夸「太棒了」，只指出具体做对的那一步。",
  senior: "平辈口吻，可以直接说「这里我当时也卡过」；先给答案再补为什么。",
  strict: "直接指出问题在哪，要求复述定义 / 跑一遍 / 说出依据页码，不替学生做完。",
};

/** 未知值一律回落到默认语气，不让坏存档把界面卡在无选项状态。 */
export function parseTutorTone(raw: string | null | undefined): TutorTone {
  return isTutorTone(raw) ? raw : DEFAULT_TUTOR_TONE;
}

function storeTutorTone(tone: TutorTone): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TUTOR_TONE_KEY, tone);
  } catch {
    // 隐私模式或配额满：本次会话仍按内存里的选择显示
  }
}

// ── MCP：/api/mcp/servers 的客户端形状与纯函数 ──────────────────

/**
 * 与 src/lib/mcpClient.ts:39 的 SERVER_ID_PATTERN 一致。
 *
 * 不直接 import mcpClient：那是服务端模块（ssrfGuard / node:dns），
 * 进客户端 chunk 会把网络栈打进设置页。两处常量由测试对齐。
 */
export const MCP_SERVER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;

/** 与 mcpStore.normalizeAllowedTools 的单段字符集一致。 */
export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/** 与 mcpStore.MAX_ALLOWED_TOOLS 一致。 */
export const MCP_MAX_ALLOWED_TOOLS = 50;

export function isValidMcpServerIdInput(value: string): boolean {
  return MCP_SERVER_ID_PATTERN.test(value.trim());
}

export type AllowedToolsParse =
  | { readonly ok: true; readonly tools: string[] }
  | { readonly ok: false; readonly message: string };

/**
 * 把文本框里的白名单拆成数组：逗号 / 换行都能分隔，去空白、去重保序。
 *
 * 非法名字直接报错而不是静默丢弃：用户会以为「勾了但没生效」，
 * 而服务端最终也会在 tools/list 取交集时剔掉它。
 */
export function parseAllowedToolsInput(raw: string): AllowedToolsParse {
  const seen = new Set<string>();
  const tools: string[] = [];
  for (const part of raw.split(/[\n,]/u)) {
    const name = part.trim();
    if (name === "") continue;
    if (!MCP_TOOL_NAME_PATTERN.test(name)) {
      return {
        ok: false,
        message: `工具名不合法：${name}（只允许字母、数字、下划线与连字符，≤64 字符）。`,
      };
    }
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push(name);
    if (tools.length > MCP_MAX_ALLOWED_TOOLS) {
      return { ok: false, message: `工具白名单最多 ${MCP_MAX_ALLOWED_TOOLS} 条。` };
    }
  }
  return { ok: true, tools };
}

/** 鉴权头只显示服务端给的掩码（末 4 位）；明文永远不会进这个函数。 */
export function mcpAuthSummary(
  server: Pick<PublicMcpServer, "authConfigured" | "authHint">,
): string {
  if (!server.authConfigured) return "未配置鉴权头";
  const hint = server.authHint.trim();
  return hint === "" ? "已配置鉴权头" : `已配置鉴权头（${hint}）`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 读侧宽容：非法条目丢弃，不让一条坏配置拖垮整张列表。 */
function asAllowedTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!MCP_TOOL_NAME_PATTERN.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= MCP_MAX_ALLOWED_TOOLS) break;
  }
  return out;
}

export function parseMcpServer(raw: unknown): PublicMcpServer | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const serverId = asText(record.serverId).trim();
  if (!isValidMcpServerIdInput(serverId)) return null;
  const url = asText(record.url).trim();
  if (url === "") return null;
  const label = asText(record.label).trim();
  return {
    serverId,
    label: label === "" ? serverId : label,
    url,
    enabled: record.enabled === true,
    allowedTools: asAllowedTools(record.allowedTools),
    authConfigured: record.authConfigured === true,
    authHint: asText(record.authHint),
    createdAt: asText(record.createdAt),
    updatedAt: asText(record.updatedAt),
  };
}

/** GET /api/mcp/servers → {servers: PublicMcpServer[]}。形状不对返回 null。 */
export function parseMcpServersPayload(raw: unknown): PublicMcpServer[] | null {
  const record = asRecord(raw);
  if (record === null || !Array.isArray(record.servers)) return null;
  const out: PublicMcpServer[] = [];
  for (const entry of record.servers) {
    const server = parseMcpServer(entry);
    if (server !== null) out.push(server);
  }
  return out;
}

/** PUT /api/mcp/servers → {server: PublicMcpServer}。 */
export function parseMcpServerPayload(raw: unknown): PublicMcpServer | null {
  const record = asRecord(raw);
  return record === null ? null : parseMcpServer(record.server);
}

/**
 * 未登录 / 本机模式为什么用不了 MCP。
 *
 * 返回 null 表示可用；返回字符串时界面必须原样说明原因，不能只把按钮置灰。
 */
export function mcpAvailabilityNote(loggedIn: boolean, mode: CallMode): string | null {
  if (!loggedIn) {
    return "未登录：鉴权头必须用账号主密钥加密存进数据库，工具也由服务端 Agent 调用；未登录时 /api/mcp/servers 直接返回 401。登录后才能在这里添加服务器。";
  }
  if (mode === "local") {
    return "本机模式：请求由浏览器直连供应商，服务端 Agent 不参与，MCP 工具不会被加载。配置可以先保存到账号；要实际调用请到「调用模式」切到服务端，并在「模型供应商」保存服务端模型配置。";
  }
  return null;
}

/** 路由错误体 {error:{code,message}} → 人话；没有 message 时按状态码兜底。 */
export function mcpErrorText(status: number, body: unknown): string {
  const record = asRecord(body);
  const nested = record === null ? null : asRecord(record.error);
  const code = nested === null ? "" : asText(nested.code);
  const message = nested === null ? "" : asText(nested.message).trim();

  switch (code) {
    case "TOO_MANY_SERVERS":
      return message === "" ? "MCP 服务器数量已达上限。" : message;
    case "INVALID_URL":
      return message === "" ? "服务器地址不被允许（需公网 https）。" : message;
    case "PERSISTENCE_UNAVAILABLE":
      return message === "" ? "服务端当前使用内存存储，拒绝写入密钥。" : message;
    case "KEY_ENC_UNAVAILABLE":
      return message === "" ? "服务端没有配置主密钥（ALP_SECRET_KEY），无法加密保存鉴权头。" : message;
    case "SECRET_UNREADABLE":
      return message === "" ? "已保存的鉴权头无法解密，请重新填写。" : message;
    default:
      break;
  }

  if (status === 401) return "登录已过期，请重新登录后再试。";
  if (status === 403) return "跨站请求被拒绝：请从本站页面操作。";
  return message === "" ? `请求失败（HTTP ${status}）。` : message;
}

// ── 向量检索：模型文件、账号知识库与同步状态 ───────────────────

/** 与 src/lib/vectorContracts.ts:23 的 KB_LOCAL_VECTOR_MODEL 一致（测试对齐）。 */
export const LOCAL_EMBED_MODEL_LABEL = "bge-small-zh-v1.5-q8";
/** 与 src/lib/vectorContracts.ts:26 的 KB_LOCAL_VECTOR_DIM 一致（测试对齐）。 */
export const LOCAL_EMBED_DIM_LABEL = 512;

/** 本地推理分批（与 kbRemote.ts 的 VECTOR_EMBED_BATCH_MAX 一致）。 */
const VECTOR_EMBED_BATCH = 16;
/** 上传分批（与 vectorContracts.KB_VECTOR_BATCH_MAX 一致）。 */
const VECTOR_UPLOAD_BATCH = 32;

/** 与 /api/kb 的 entityId 同一条安全字符集（含 120 字符上限）。 */
const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;

export interface ModelFileProbe {
  readonly label: string;
  readonly path: string;
  readonly ok: boolean;
  readonly status: number;
  readonly bytes: number | null;
}

/**
 * 本地模型与推理库的静态文件。
 *
 * Worker 把 allowRemoteModels 设为 false（src/workers/embed.worker.ts:79），
 * 所以运行时不会下载模型；这些文件只能由部署者用 scripts/fetch-model.mjs 预置。
 */
export const LOCAL_MODEL_FILES: ReadonlyArray<{ readonly label: string; readonly path: string }> = [
  { label: "模型权重（q8）", path: "/models/bge-small-zh-v1.5/onnx/model_quantized.onnx" },
  { label: "分词器", path: "/models/bge-small-zh-v1.5/tokenizer.json" },
  { label: "模型配置", path: "/models/bge-small-zh-v1.5/config.json" },
  { label: "transformers.js", path: "/embed/transformers.web.min.js" },
  { label: "onnxruntime wasm", path: "/embed/ort-wasm-simd-threaded.jsep.wasm" },
];

export interface ModelProbeSummary {
  readonly ready: boolean;
  readonly missing: readonly ModelFileProbe[];
  readonly totalBytes: number;
}

export function summarizeModelProbe(files: readonly ModelFileProbe[]): ModelProbeSummary {
  const missing = files.filter((file) => !file.ok);
  const totalBytes = files.reduce(
    (sum, file) => (file.bytes !== null && file.bytes > 0 ? sum + file.bytes : sum),
    0,
  );
  return { ready: files.length > 0 && missing.length === 0, missing, totalBytes };
}

export function formatBytesText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Worker 的失败 reason → 人话。与 embedLocal.EmbedLocalFailureReason 一一对应。 */
export const EMBED_FAILURE_TEXT: Readonly<Record<string, string>> = {
  unsupported: "当前环境不支持 Web Worker，本地嵌入不可用",
  "worker-error": "本地嵌入 Worker 出错",
  timeout: "本地嵌入超时",
  aborted: "本地嵌入已取消",
  "invalid-output": "本地模型输出的向量不合法",
  "model-missing": "本地模型或推理库文件缺失",
};

export function embedFailureText(reason: string, message: string): string {
  const label = EMBED_FAILURE_TEXT[reason] ?? "本地嵌入失败";
  const detail = message.trim();
  return detail === "" ? label : `${label}：${detail}`;
}

export function vectorSyncText(state: KbVectorSyncState | null): string {
  if (state === null) return "未开始";
  switch (state.status) {
    case "idle":
      return "未开始";
    case "loading":
      return "正在读取远端已有向量…";
    case "embedding":
      return `本地嵌入 ${state.done}/${state.total}`;
    case "uploading":
      return `上传向量 ${state.done}/${state.total}`;
    case "ready":
      return state.total === 0
        ? "没有需要补建的片段"
        : `已就绪（${state.done}/${state.total}）`;
    case "unavailable":
      return state.message === null ? "不可用，检索退回 BM25" : `不可用：${state.message}`;
  }
}

export function vectorSyncPercent(state: KbVectorSyncState | null): number | null {
  if (state === null || state.total <= 0) return null;
  const ratio = state.done / state.total;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

/** /api/kb?directionId= 里重建索引真正需要的三个字段。 */
export interface KbChunkRef {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** GET /api/kb?directionId= → {docs, chunks}。形状不对返回 null。 */
export function parseKbChunksPayload(raw: unknown): KbChunkRef[] | null {
  const record = asRecord(raw);
  if (record === null || !Array.isArray(record.chunks)) return null;
  const out: KbChunkRef[] = [];
  for (const entry of record.chunks) {
    const item = asRecord(entry);
    if (item === null) continue;
    const id = asText(item.id).trim();
    if (id === "" || !ENTITY_ID_PATTERN.test(id)) continue;
    const text = asText(item.text);
    if (text.trim() === "") continue;
    out.push({ id, title: asText(item.title), text });
  }
  return out;
}

/** GET /api/kb/vectors → {model, dim, chunkIds}。形状不对返回 null。 */
export function parseVectorChunkIdsPayload(raw: unknown): string[] | null {
  const record = asRecord(raw);
  if (record === null || !Array.isArray(record.chunkIds)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of record.chunkIds) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!ENTITY_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ── 语气分区 ──────────────────────────────────────────────────

export function ToneSection() {
  // localStorage 只能在挂载后读（useClientSnapshot）；用户选择进 chosen 覆盖层
  const storedTone = useClientSnapshot(loadTutorTone, DEFAULT_TUTOR_TONE);
  const [chosen, setChosen] = useState<TutorTone | null>(null);
  const tone = chosen ?? storedTone;
  const [notice, setNotice] = useState<string | null>(null);

  function choose(next: TutorTone) {
    setChosen(next);
    storeTutorTone(next);
    setNotice(`已保存「${TONE_LABELS[next]}」到本浏览器。`);
  }

  return (
    <>
      <SettingsGroup
        title="回答语气"
        hint="三套语气共用 tutorPersona 的固定身份、12 条安全规则与回答结构，只有口吻不同。"
      >
        <div role="group" aria-label="导师语气" className="grid gap-2 sm:grid-cols-3">
          {TUTOR_TONES.map((id) => {
            const selected = tone === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                onClick={() => choose(id)}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  selected
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line-strong)] hover:bg-[var(--line)]"
                }`}
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {TONE_LABELS[id]}
                  {selected ? <Pill tone="accent">当前</Pill> : null}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-faint)]">
                  {TONE_NOTES[id]}
                </span>
              </button>
            );
          })}
        </div>
        <p role="status" className="mt-3 max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
          {notice ?? `当前：${TONE_LABELS[tone]}。选择立即保存在本浏览器。`}
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="保存位置与生效范围"
        hint="本机保存已生效；账号同步与导师页读取尚未接通，这里如实写清。"
      >
        <ul className="max-w-[68ch] space-y-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">
          <li>
            · 本机：写入 localStorage 的 <code className="font-mono">{TUTOR_TONE_KEY}</code>
            ，刷新后仍在。
          </li>
          <li>
            · 账号：服务端 /api/config 的 llm 配置目前没有语气字段，options 白名单也不含它，
            所以这份选择不会同步到账号；换设备需要重新选。
          </li>
          <li>· 导师页：目前使用固定提示词、尚未读取这份选择；接通后才会改变回答口吻。</li>
        </ul>
      </SettingsGroup>
    </>
  );
}

// ── MCP 分区 ──────────────────────────────────────────────────

interface McpSectionProps {
  readonly userId: string | null;
  readonly effectiveMode: CallMode;
  readonly serverConfigured: boolean | null;
  readonly authLoading: boolean;
}

interface McpFormState {
  readonly serverId: string;
  readonly label: string;
  readonly url: string;
  readonly enabled: boolean;
  /** 原始文本，提交时再用 parseAllowedToolsInput 拆。 */
  readonly allowedTools: string;
  readonly authName: string;
  /** 明文只活在这次输入里；保存成功后立即清空。 */
  readonly authValue: string;
  readonly clearAuth: boolean;
}

const EMPTY_MCP_FORM: McpFormState = {
  serverId: "",
  label: "",
  url: "",
  enabled: true,
  allowedTools: "",
  authName: "",
  authValue: "",
  clearAuth: false,
};

export function McpSection({
  userId,
  effectiveMode,
  serverConfigured,
  authLoading,
}: McpSectionProps) {
  const [servers, setServers] = useState<readonly PublicMcpServer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM);
  /** null 表示「新增」；非 null 表示正在编辑该 serverId（id 不可改）。 */
  const [editingId, setEditingId] = useState<string | null>(null);

  const unavailable = mcpAvailabilityNote(userId !== null, effectiveMode);

  /*
   * 换账号时必须清掉上一位用户的草稿与列表：组件在登出/登录之间不会卸载，
   * 不清的话上一位用户填了一半的鉴权头会留在下一位用户的表单里。
   * （渲染期 adjust-on-change；未登录时的列表清空也在这里完成）
   */
  const [lastUserId, setLastUserId] = useState(userId);
  if (lastUserId !== userId) {
    setLastUserId(userId);
    setForm(EMPTY_MCP_FORM);
    setEditingId(null);
    setError(null);
    setNotice(null);
    setBusyId(null);
    setServers(null);
    setLoading(false);
  }

  // 只在已登录时读列表；未登录不发请求——/api/mcp/servers 必然 401。
  // 拉取推迟到宏任务：effect 里同步 setLoading/setError 会触发级联渲染告警。
  useEffect(() => {
    if (authLoading || userId === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void (async () => {
      try {
        const res = await fetch("/api/mcp/servers", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setServers(null);
          setError(mcpErrorText(res.status, body));
          return;
        }
        const parsed = parseMcpServersPayload(body);
        if (parsed === null) {
          setServers(null);
          setError("服务端返回的服务器列表无法识别（缺少 servers 数组）。");
          return;
        }
        setServers(parsed);
      } catch (err) {
        if (controller.signal.aborted) return;
        setServers(null);
        setError(`读取 MCP 服务器失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
      })();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [userId, authLoading]);

  function upsert(next: PublicMcpServer): void {
    setServers((prev) => {
      if (prev === null) return [next];
      const index = prev.findIndex((item) => item.serverId === next.serverId);
      if (index < 0) return [...prev, next].sort((a, b) => a.serverId.localeCompare(b.serverId));
      const copy = [...prev];
      copy[index] = next;
      return copy;
    });
  }

  async function putServer(
    serverId: string,
    body: Record<string, unknown>,
  ): Promise<PublicMcpServer | null> {
    setBusyId(serverId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/mcp/servers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(mcpErrorText(res.status, payload));
        return null;
      }
      const server = parseMcpServerPayload(payload);
      if (server === null) {
        setError("保存成功，但服务端返回的服务器条目无法识别。");
        return null;
      }
      upsert(server);
      return server;
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const serverId = form.serverId.trim();
    if (!isValidMcpServerIdInput(serverId)) {
      setError(
        "serverId 只允许字母、数字、下划线与连字符，以字母或数字开头，最长 32 字符。",
      );
      return;
    }
    if (form.url.trim() === "") {
      setError("服务器地址不能为空；服务端只接受能通过 SSRF 校验的公网 https 地址。");
      return;
    }
    const tools = parseAllowedToolsInput(form.allowedTools);
    if (!tools.ok) {
      setError(tools.message);
      return;
    }

    let auth: { readonly name: string; readonly value: string } | null | undefined;
    if (form.clearAuth) {
      auth = null;
    } else if (form.authName.trim() !== "" || form.authValue !== "") {
      if (form.authName.trim() === "" || form.authValue.trim() === "") {
        setError("鉴权头的名字和值要么都填，要么都留空；留空表示保留已存的鉴权头。");
        return;
      }
      auth = { name: form.authName.trim(), value: form.authValue };
    }

    const body: Record<string, unknown> = {
      serverId,
      label: form.label.trim(),
      url: form.url.trim(),
      enabled: form.enabled,
      allowedTools: tools.tools,
    };
    // undefined = 保留已存鉴权头；null = 清除；对象 = 重新加密保存。
    if (auth !== undefined) body.auth = auth;

    const saved = await putServer(serverId, body);
    if (saved === null) return;
    setNotice(`已保存「${saved.label}」。`);
    setForm(EMPTY_MCP_FORM);
    setEditingId(null);
  }

  async function toggle(server: PublicMcpServer) {
    const saved = await putServer(server.serverId, {
      serverId: server.serverId,
      label: server.label,
      url: server.url,
      enabled: !server.enabled,
      // 必须重发白名单：服务端把缺省 allowedTools 当成空数组，否则一开关就清空。
      allowedTools: [...server.allowedTools],
      // auth 缺省 = 保留已存鉴权头
    });
    if (saved !== null) {
      setNotice(`${saved.enabled ? "已启用" : "已停用"}「${saved.label}」。`);
    }
  }

  function startEdit(server: PublicMcpServer) {
    setEditingId(server.serverId);
    setForm({
      serverId: server.serverId,
      label: server.label,
      url: server.url,
      enabled: server.enabled,
      allowedTools: server.allowedTools.join(", "),
      authName: "",
      authValue: "",
      clearAuth: false,
    });
    setError(null);
    setNotice(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_MCP_FORM);
    setError(null);
  }

  async function remove(server: PublicMcpServer) {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`删除 MCP 服务器「${server.label}」？已保存的鉴权头会一起删除。`)
    ) {
      return;
    }
    setBusyId(server.serverId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/mcp/servers?serverId=${encodeURIComponent(server.serverId)}`,
        { method: "DELETE" },
      );
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(mcpErrorText(res.status, payload));
        return;
      }
      setServers((prev) =>
        prev === null ? null : prev.filter((item) => item.serverId !== server.serverId),
      );
      if (editingId === server.serverId) resetForm();
      setNotice(`已删除「${server.label}」。`);
    } catch (err) {
      setError(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {unavailable !== null ? (
        <div className="mb-4 rounded-lg border-l-2 border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2.5 text-sm">
          <p className="font-medium text-[var(--warn)]">当前不可用</p>
          <p className="mt-1 max-w-[68ch] leading-relaxed text-[var(--ink-soft)]">{unavailable}</p>
          {userId === null ? (
            <>
              {" "}
              <a href="/login" className="mt-1 inline-block underline">
                去登录
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {effectiveMode === "server" && serverConfigured === false ? (
        <p className="mb-4 max-w-[68ch] text-xs leading-relaxed text-[var(--warn)]">
          账号里还没有保存模型配置：服务端 Agent 跑不起来，MCP 工具不会被调用。
          先到「模型供应商」保存一次服务端配置。
        </p>
      ) : null}

      {userId !== null ? (
        <>
          <SettingsGroup
            title="MCP 服务器"
            hint="地址只能来自这里的配置，模型不能临时指定；保存时服务端会做 SSRF 校验。"
          >
            {loading ? (
              <p className="text-xs text-[var(--ink-faint)]">正在读取账号里的服务器…</p>
            ) : null}
            {error !== null ? (
              <p role="alert" className="max-w-[68ch] text-xs leading-relaxed text-[var(--bad)]">
                {error}
              </p>
            ) : null}
            {notice !== null ? (
              <p role="status" className="max-w-[68ch] text-xs leading-relaxed text-[var(--good)]">
                {notice}
              </p>
            ) : null}

            {servers !== null && servers.length === 0 ? (
              <p className="max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                还没有配置服务器。下面添加一个；工具白名单为空时默认拒绝，不会调用该服务器的任何工具。
              </p>
            ) : null}

            {servers !== null && servers.length > 0 ? (
              <ul className="divide-y divide-[var(--line)]">
                {servers.map((server) => {
                  const busy = busyId === server.serverId;
                  return (
                    <li key={server.serverId} className="py-3 first:pt-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{server.label}</span>
                        <span className="font-mono text-xs text-[var(--ink-faint)]">
                          {server.serverId}
                        </span>
                        <Pill tone={server.enabled ? "good" : "neutral"}>
                          {server.enabled ? "已启用" : "已停用"}
                        </Pill>
                        <Pill tone={server.authConfigured ? "accent" : "neutral"}>
                          {mcpAuthSummary(server)}
                        </Pill>
                      </div>
                      <p className="mt-1 break-all font-mono text-xs text-[var(--ink-soft)]">
                        {server.url}
                      </p>
                      <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                        工具白名单：
                        {server.allowedTools.length === 0
                          ? "空（默认拒绝，不会调用该服务器的任何工具）"
                          : server.allowedTools.join("、")}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(server)}
                          disabled={busy}
                          className="rounded border border-[var(--line-strong)] px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggle(server)}
                          disabled={busy}
                          className="rounded border border-[var(--line-strong)] px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {server.enabled ? "停用" : "启用"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(server)}
                          disabled={busy}
                          className="rounded px-1.5 py-1 text-xs font-medium text-[var(--bad)] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          删除
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </SettingsGroup>

          <SettingsGroup
            title={editingId === null ? "添加服务器" : `编辑 ${editingId}`}
            hint="鉴权头只写不读：保存后界面只显示末 4 位掩码，明文既不回显也不进响应。"
          >
            <form onSubmit={(event) => void submit(event)} className="max-w-2xl space-y-4">
              <FormRow
                label="serverId"
                hint="字母或数字开头，只允许字母、数字、下划线、连字符；≤32 字符。保存后不可改；与已有 serverId 重名会覆盖那条配置。"
              >
                <input
                  value={form.serverId}
                  onChange={(event) => setForm({ ...form, serverId: event.target.value })}
                  disabled={editingId !== null}
                  className={`${monoInputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                  placeholder="my-search-server"
                  spellCheck={false}
                  autoComplete="off"
                />
              </FormRow>

              <FormRow label="显示名" hint="只用于界面标识；留空就用 serverId。">
                <input
                  value={form.label}
                  onChange={(event) => setForm({ ...form, label: event.target.value })}
                  className={inputClass}
                  placeholder="我的搜索服务器"
                />
              </FormRow>

              <FormRow
                label="服务器地址"
                hint="Streamable HTTP 单端点，需公网 https；本地 http 必须由部署者加入 ALP_ALLOW_HTTP_PROVIDER_HOSTS。"
              >
                <input
                  value={form.url}
                  onChange={(event) => setForm({ ...form, url: event.target.value })}
                  className={monoInputClass}
                  placeholder="https://mcp.example.com/mcp"
                  spellCheck={false}
                  autoComplete="off"
                />
              </FormRow>

              <FormRow
                label="工具白名单"
                hint="逗号或换行分隔；只允许只读工具，留空 = 默认拒绝；最多 50 条。"
              >
                <textarea
                  value={form.allowedTools}
                  onChange={(event) => setForm({ ...form, allowedTools: event.target.value })}
                  rows={3}
                  className={monoInputClass}
                  placeholder={"search\nfetch_page"}
                  spellCheck={false}
                />
              </FormRow>

              <FormRow
                label="鉴权头名字（可选）"
                hint="例如 Authorization 或 X-API-Key；名字和值都填才会保存。"
              >
                <input
                  value={form.authName}
                  onChange={(event) => setForm({ ...form, authName: event.target.value })}
                  className={monoInputClass}
                  placeholder="Authorization"
                  spellCheck={false}
                  autoComplete="off"
                />
              </FormRow>

              <FormRow
                label="鉴权头值（只写）"
                hint={
                  editingId === null
                    ? "保存后立即清空，只显示掩码。"
                    : "留空 = 保留已存鉴权头；要替换才填。"
                }
              >
                <input
                  value={form.authValue}
                  onChange={(event) => setForm({ ...form, authValue: event.target.value })}
                  type="password"
                  className={monoInputClass}
                  placeholder="Bearer … / sk-…"
                  spellCheck={false}
                  autoComplete="off"
                />
              </FormRow>

              {editingId !== null ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.clearAuth}
                    onChange={(event) => setForm({ ...form, clearAuth: event.target.checked })}
                  />
                  清除已保存的鉴权头（勾选后不再发送鉴权头）
                </label>
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
                />
                启用这个服务器
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={busyId !== null}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {editingId === null ? "添加服务器" : "保存修改"}
                </button>
                {editingId !== null ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium"
                  >
                    取消编辑
                  </button>
                ) : null}
                <span className="max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                  保存只写账号；未登录或跨站请求会被服务端直接拒绝，不会假装成功。
                </span>
              </div>
            </form>
          </SettingsGroup>

          <SettingsGroup
            title="测试连接（tools/list）"
            hint="必须由服务端代握手：浏览器不能替用户带鉴权头访问第三方地址，也绕不过 SSRF 校验。"
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled
                title="后端缺少 tools/list 探测接口"
                className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
              >
                测试连接
              </button>
              <span className="max-w-[60ch] text-xs leading-relaxed text-[var(--warn)]">
                暂不可用：/api/mcp/servers 目前只有 GET / PUT / DELETE，没有 tools/list 探测入口。
              </span>
            </div>
            <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
              需要的新接口：
              <code className="font-mono"> POST /api/mcp/servers/test</code>
              ，请求体 <code className="font-mono">{'{"serverId":"my-search-server"}'}</code>
              ，返回{" "}
              <code className="font-mono">
                {'{"ok":true,"tools":[{"name":"search"}],"latencyMs":123}'}
              </code>
              ；失败时返回{" "}
              <code className="font-mono">
                {'{"ok":false,"error":{"code":"MCP_UNREACHABLE","message":"…"}}'}
              </code>
              。实现必须复用 mcpClient 的 initialize + tools/list（带 Mcp-Session-Id 与协议版本头），
              并且只回工具名，不回第三方描述。
            </p>
          </SettingsGroup>
        </>
      ) : null}
    </>
  );
}

// ── 向量检索分区 ──────────────────────────────────────────────

interface VectorSectionProps {
  readonly userId: string | null;
}

export function VectorSection({ userId }: VectorSectionProps) {
  const [modelCheck, setModelCheck] = useState<"idle" | "checking" | "done">("idle");
  const [modelFiles, setModelFiles] = useState<readonly ModelFileProbe[] | null>(null);
  const modelCheckRunning = useRef(false);
  const [embedCheck, setEmbedCheck] = useState<{
    readonly status: "idle" | "running" | "ready" | "unavailable";
    readonly message: string | null;
    readonly elapsedMs: number | null;
  }>({ status: "idle", message: null, elapsedMs: null });
  const [state, setState] = useState<KbVectorSyncState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 方向沿用导师 / 诊断页的选择（src/lib/subject.tsx:28 的 alp.subject）；
  // localStorage 只能在挂载后读（useClientSnapshot），用户改选进 override 覆盖层
  const storedDirection = useClientSnapshot(() => {
    try {
      const stored = window.localStorage.getItem("alp.subject");
      return stored !== null && stored.trim() !== "" ? stored.trim() : "data-structures";
    } catch {
      // 隐私模式或配额异常：保留默认方向
      return "data-structures";
    }
  }, "data-structures");
  const [directionOverride, setDirection] = useState<string | null>(null);
  const direction = directionOverride ?? storedDirection;

  // 换账号：上一位用户的同步状态不能留给下一位用户（渲染期 adjust-on-change）
  const [lastVectorUserId, setLastVectorUserId] = useState(userId);
  if (lastVectorUserId !== userId) {
    setLastVectorUserId(userId);
    setState(null);
    setError(null);
  }

  async function checkModelFiles() {
    if (modelCheckRunning.current) return;
    modelCheckRunning.current = true;
    setModelCheck("checking");
    const results: ModelFileProbe[] = [];
    try {
      for (const file of LOCAL_MODEL_FILES) {
        try {
          const res = await fetch(file.path, { method: "HEAD", cache: "no-store" });
          const declared = Number(res.headers.get("content-length") ?? "");
          results.push({
            label: file.label,
            path: file.path,
            ok: res.ok,
            status: res.status,
            bytes: Number.isFinite(declared) && declared > 0 ? declared : null,
          });
        } catch {
          results.push({
            label: file.label,
            path: file.path,
            ok: false,
            status: 0,
            bytes: null,
          });
        }
      }
    } finally {
      modelCheckRunning.current = false;
    }
    setModelFiles(results);
    setModelCheck("done");
  }

  useEffect(() => {
    void checkModelFiles();
    // 只在挂载时检查一次；手动按钮走同一个函数
  }, []);

  async function fetchChunks(target: string): Promise<KbChunkRef[]> {
    const res = await fetch(`/api/kb?directionId=${encodeURIComponent(target)}`, {
      cache: "no-store",
    });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(mcpErrorText(res.status, body));
    const chunks = parseKbChunksPayload(body);
    if (chunks === null) throw new Error("知识库返回的片段列表无法识别。");
    return chunks;
  }

  async function fetchExistingVectorIds(target: string): Promise<string[]> {
    const params = new URLSearchParams({
      directionId: target,
      model: LOCAL_EMBED_MODEL_LABEL,
    });
    const res = await fetch(`/api/kb/vectors?${params.toString()}`, { cache: "no-store" });
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw new Error(mcpErrorText(res.status, body));
    const ids = parseVectorChunkIdsPayload(body);
    if (ids === null) throw new Error("账号里的向量列表无法识别。");
    return ids;
  }

  async function embedAndUpload(chunks: readonly KbChunkRef[]): Promise<void> {
    const [{ embedLocal }, { embeddingInput }] = await Promise.all([
      import("@/lib/embedLocal"),
      import("@/lib/embedding"),
    ]);

    const vectors: Array<{ readonly chunkId: string; readonly vec: number[] }> = [];
    setState({ status: "embedding", done: 0, total: chunks.length, message: null });
    for (let start = 0; start < chunks.length; start += VECTOR_EMBED_BATCH) {
      const batch = chunks.slice(start, start + VECTOR_EMBED_BATCH);
      const result = await embedLocal(
        batch.map((chunk) => embeddingInput({ title: chunk.title, text: chunk.text })),
      );
      if (!result.ok) {
        setState({
          status: "unavailable",
          done: start,
          total: chunks.length,
          message: embedFailureText(result.reason, result.message),
        });
        return;
      }
      for (let index = 0; index < batch.length; index += 1) {
        const chunk = batch[index];
        const vec = result.vectors[index];
        if (chunk === undefined || !Array.isArray(vec) || vec.length !== LOCAL_EMBED_DIM_LABEL) {
          continue;
        }
        vectors.push({ chunkId: chunk.id, vec: [...vec] });
      }
      setState({
        status: "embedding",
        done: Math.min(chunks.length, start + batch.length),
        total: chunks.length,
        message: null,
      });
    }

    if (vectors.length === 0) {
      setState({
        status: "unavailable",
        done: 0,
        total: 0,
        message: "本地模型没有返回可用的 512 维向量。",
      });
      return;
    }

    let uploaded = 0;
    setState({ status: "uploading", done: 0, total: vectors.length, message: null });
    for (let start = 0; start < vectors.length; start += VECTOR_UPLOAD_BATCH) {
      const batch = vectors.slice(start, start + VECTOR_UPLOAD_BATCH);
      const res = await fetch("/api/kb/vectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: LOCAL_EMBED_MODEL_LABEL, vectors: batch }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setState({
          status: "unavailable",
          done: uploaded,
          total: vectors.length,
          message: `上传失败：${mcpErrorText(res.status, payload)}`,
        });
        return;
      }
      uploaded += batch.length;
      setState({
        status: "uploading",
        done: uploaded,
        total: vectors.length,
        message: null,
      });
    }

    const skipped = chunks.length - vectors.length;
    setState({
      status: "ready",
      done: uploaded,
      total: uploaded,
      message: skipped > 0 ? `${skipped} 条片段没有产出 512 维向量，已跳过。` : null,
    });
  }

  async function rebuildMissing() {
    const target = direction.trim();
    if (userId === null) {
      setError("向量索引写在账号里（POST /api/kb/vectors 要求登录）；未登录只能走本机 BM25。");
      return;
    }
    if (target === "") {
      setError("请先填写方向 id（例如导师页当前目标）。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [chunks, existing] = await Promise.all([
        fetchChunks(target),
        fetchExistingVectorIds(target),
      ]);
      const existingSet = new Set(existing);
      const missing = chunks.filter((chunk) => !existingSet.has(chunk.id));
      if (missing.length === 0) {
        setState({
          status: "ready",
          done: 0,
          total: 0,
          message: "账号里没有缺失的片段向量。",
        });
        return;
      }
      await embedAndUpload(missing);
    } catch (err) {
      setError(`补建索引失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function rebuildAll() {
    const target = direction.trim();
    if (userId === null) {
      setError("向量索引写在账号里（POST /api/kb/vectors 要求登录）；未登录只能走本机 BM25。");
      return;
    }
    if (target === "") {
      setError("请先填写方向 id（例如导师页当前目标）。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chunks = await fetchChunks(target);
      if (chunks.length === 0) {
        setState({
          status: "ready",
          done: 0,
          total: 0,
          message: "这个方向没有可重建的上传片段。",
        });
        return;
      }
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `将重新嵌入并覆盖 ${chunks.length} 个片段的 512 维向量，可能需要几分钟。继续？`,
        )
      ) {
        return;
      }
      await embedAndUpload(chunks);
    } catch (err) {
      setError(`重建索引失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runEmbedSelfTest() {
    setEmbedCheck({ status: "running", message: null, elapsedMs: null });
    const startedAt = Date.now();
    try {
      // 动态 import：模型 Worker 只在用户点「自检」时才进页面
      const { embedLocal } = await import("@/lib/embedLocal");
      const result = await embedLocal(["设置页本地模型自检：栈是后进先出。"], undefined, {
        timeoutMs: 120_000,
      });
      const elapsedMs = Date.now() - startedAt;
      if (result.ok) {
        setEmbedCheck({
          status: "ready",
          message: `返回 ${result.vectors.length} 条 ${LOCAL_EMBED_DIM_LABEL} 维向量。`,
          elapsedMs,
        });
      } else {
        setEmbedCheck({
          status: "unavailable",
          message: embedFailureText(result.reason, result.message),
          elapsedMs,
        });
      }
    } catch (err) {
      setEmbedCheck({
        status: "unavailable",
        message: `自检失败：${err instanceof Error ? err.message : String(err)}`,
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  const summary = modelFiles === null ? null : summarizeModelProbe(modelFiles);
  const percent = vectorSyncPercent(state);

  return (
    <>
      <SettingsGroup
        title="本地模型状态"
        hint="模型在 Web Worker 里跑，推理不离开浏览器；运行时不会下载模型。"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Pill
            tone={
              modelCheck === "checking"
                ? "neutral"
                : summary === null
                  ? "neutral"
                  : summary.ready
                    ? "good"
                    : "warn"
            }
          >
            {modelCheck === "checking"
              ? "检查文件…"
              : summary === null
                ? "未检查"
                : summary.ready
                  ? "文件已就绪"
                  : `未下载（缺 ${summary.missing.length} 个文件）`}
          </Pill>
          <Pill
            tone={
              embedCheck.status === "ready"
                ? "good"
                : embedCheck.status === "unavailable"
                  ? "bad"
                  : embedCheck.status === "running"
                    ? "accent"
                    : "neutral"
            }
          >
            {embedCheck.status === "running"
              ? "自检中"
              : embedCheck.status === "ready"
                ? "推理就绪"
                : embedCheck.status === "unavailable"
                  ? "不可用"
                  : "未自检"}
          </Pill>
          <span className="text-xs text-[var(--ink-faint)]">
            {summary === null
              ? "打开本分区时会自动检查 public/ 下的模型文件。"
              : summary.missing.length === 0
                ? `5 个文件都在，合计约 ${formatBytesText(summary.totalBytes)}；模型 ${LOCAL_EMBED_MODEL_LABEL}（${LOCAL_EMBED_DIM_LABEL} 维）。`
                : `缺失：${summary.missing.map((file) => file.label).join("、")}。`}
          </span>
        </div>

        {summary !== null && !summary.ready ? (
          <div className="mt-3 rounded-lg border-l-2 border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2.5 text-sm">
            <p className="font-medium text-[var(--warn)]">模型文件缺失，语义检索不可用</p>
            <p className="mt-1 max-w-[68ch] leading-relaxed text-[var(--ink-soft)]">
              在部署机仓库根目录运行 <code className="font-mono">node scripts/fetch-model.mjs</code>
              ，把模型与推理库放进 public/ 后刷新本页。缺失期间上传资料只走 BM25，问答与路径不受影响。
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void checkModelFiles()}
            disabled={modelCheck === "checking"}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            重新检查文件
          </button>
          <button
            type="button"
            onClick={() => void runEmbedSelfTest()}
            disabled={embedCheck.status === "running"}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {embedCheck.status === "running" ? "自检中…" : "运行本地模型自检"}
          </button>
          <span className="max-w-[56ch] text-xs leading-relaxed text-[var(--ink-faint)]">
            {embedCheck.status === "running"
              ? "首次要加载约 24 MB 模型与 wasm，通常 5–30 秒；这一步没有百分比。"
              : embedCheck.status === "ready"
                ? `${embedCheck.message ?? "推理可用。"}${
                    embedCheck.elapsedMs === null ? "" : ` 用时 ${embedCheck.elapsedMs} ms。`
                  }`
                : embedCheck.status === "unavailable"
                  ? embedCheck.message ?? "本地模型不可用。"
                  : "自检会真的跑一次推理，确认 Worker、wasm 与模型都可用。"}
          </span>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="下载进度"
        hint="这里没有百分比不是界面偷懒：浏览器端确实没有下载过程。"
      >
        <p className="max-w-[68ch] text-xs leading-relaxed text-[var(--ink-soft)]">
          本地 Worker 把 <code className="font-mono">env.allowRemoteModels</code> 设为{" "}
          <code className="font-mono">false</code>，模型只能由部署者用{" "}
          <code className="font-mono">scripts/fetch-model.mjs</code> 预置到{" "}
          <code className="font-mono">public/models/</code>。因此状态只有「文件已放置 / 缺失」与「自检通过 /
          不可用」，不存在「下载中」或百分比进度；要支持运行时下载，必须先改 Worker 的加载策略并回报
          progress 事件（不在设置页的改动范围）。
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="补建与重建向量索引"
        hint="补建只读远端已有 chunkId、给缺口算向量；重建全部会重新嵌入并覆盖账号向量。片段必须已在账号知识库里（先完成上传同步）。"
      >
        <FormRow
          label="方向 id"
          hint="默认取导师 / 诊断页当前目标（alp.subject）；自定义方向要填它的 id。"
        >
          <input
            value={direction}
            onChange={(event) => {
              setDirection(event.target.value);
              setError(null);
            }}
            className={monoInputClass}
            placeholder="data-structures"
            spellCheck={false}
          />
        </FormRow>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void rebuildMissing()}
            disabled={busy || userId === null || direction.trim() === ""}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "处理中…" : "补建缺失向量索引"}
          </button>
          <button
            type="button"
            onClick={() => void rebuildAll()}
            disabled={busy || userId === null || direction.trim() === ""}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "处理中…" : "重建全部向量索引"}
          </button>
          <span role="status" className="max-w-[60ch] text-xs leading-relaxed text-[var(--ink-faint)]">
            {userId === null
              ? "未登录：向量索引写在账号里（POST /api/kb/vectors 要求登录），现在只能做本机 BM25 检索。"
              : state === null
                ? "尚未触发；补建会先读远端已有 chunkId，再只嵌入缺失的片段。"
                : vectorSyncText(state)}
          </span>
        </div>

        {percent !== null ? (
          <div className="mt-2 max-w-md">
            <progress
              className="h-1.5 w-full"
              value={percent}
              max={100}
              aria-label="向量补建进度"
            />
            <p className="mt-1 text-xs text-[var(--ink-faint)]">{percent}%</p>
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="mt-2 max-w-[68ch] text-xs leading-relaxed text-[var(--bad)]">
            {error}
          </p>
        ) : null}

        <p className="mt-3 max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
          两个按钮的区别：<strong>补建</strong>只读远端已有 chunkId，给缺口做向量；
          <strong>重建全部</strong>会把该方向所有片段重新嵌入并按 32 条一批覆盖写入账号
          （服务端是 upsert，不需要先删除）。重建更慢，但能修掉模型换版本后的旧向量；
          任何一批失败都会标成不可用，已上传的部分保留，重试即可覆盖。
        </p>
      </SettingsGroup>

      <SettingsGroup
        title="降级说明"
        hint="任何一步失败都退回 BM25，不阻断上传、问答与路径。"
      >
        <ul className="max-w-[68ch] space-y-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">
          <li>· 模型文件缺失或自检不可用 → 上传资料只用 BM25，界面会保留「本次未使用语义检索」的提示。</li>
          <li>· 未登录 → 不写账号向量表，只用本机资料的 BM25 检索。</li>
          <li>· 方向里没有上传片段 → 没有可建索引的内容；内置教材检索仍按原有 BM25 路径。</li>
          <li>
            · 导师页生成查询向量仍依赖「模型供应商」里的向量模型配置；未配置时即使账号里有 512 维索引，
            查询也不会走向量路，检索退回 BM25。
          </li>
        </ul>
      </SettingsGroup>

      <SettingsGroup
        title="隐私：图片与资料"
        hint="查看会话图片、教材资料和模型请求的保存范围。"
      >
        <ul className="max-w-[68ch] space-y-1.5 text-xs leading-relaxed text-[var(--ink-soft)]">
          <li>
            · 问题图片经过上传压缩后随会话保存。登录后存入当前账号，匿名时保存在本机 IndexedDB。
            模型只接收当前轮附图，本机模式直连供应商，服务端模式由本项目转发。
          </li>
          <li>
            · 上传资料：正文留在本机 IndexedDB，同时按知识库同步规则写进账号；建索引会产生 512 维向量
            存进账号的 kb_chunk_vectors 表。
          </li>
          <li>· 本地模型推理在浏览器内完成；它不会把模型文件或推理过程发到第三方。</li>
        </ul>
      </SettingsGroup>
    </>
  );
}
