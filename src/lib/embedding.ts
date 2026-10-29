/**
 * Embedding 预设与输入拼装。
 *
 * 边界：
 * - 只描述「用哪个模型、多少维、请求哪个地址」，不发请求、不读存储、不碰 localStorage。
 * - 不依赖 plan.ts / provider.ts：调用方把用户配置里的 api / baseUrl / embeddingModel
 *   原样传进来，这里做纯解析。
 * - 只收录两个维度确定的预设。模型名认不出来时返回 null，宁可退回 BM25，
 *   也不把维度不明的向量写进索引——维度错了不会报错，只会让排序永远错下去。
 */

export type EmbeddingPresetId = "openai" | "dashscope";

export interface EmbeddingPreset {
  readonly id: EmbeddingPresetId;
  readonly label: string;
  /** 官方根地址（含版本段），不含 /embeddings。 */
  readonly baseUrl: string;
  readonly model: string;
  readonly dim: number;
  /** baseUrl 的 host 命中这些值时归到本预设。 */
  readonly hosts: readonly string[];
  /** api / 供应商标识的别名，大小写不敏感。 */
  readonly aliases: readonly string[];
}

export const EMBEDDING_PRESETS: readonly EmbeddingPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dim: 1536,
    hosts: ["api.openai.com"],
    aliases: ["openai"],
  },
  {
    id: "dashscope",
    label: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "text-embedding-v3",
    dim: 1024,
    hosts: ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"],
    aliases: ["dashscope", "aliyun", "阿里云", "百炼", "通义", "通义千问"],
  },
];

/** 单条嵌入输入的码点上限。两个预设的上下文都远大于此，截断只为控制费用与延迟。 */
export const MAX_EMBEDDING_CHARS = 2000;

export interface EmbeddingConfig {
  /** 供应商标识：预设 id、显示名或协议名；大小写不敏感。 */
  readonly api?: string;
  readonly baseUrl?: string;
  /** 用户显式填写的 embedding 模型名；空串视为未填。 */
  readonly embeddingModel?: string;
}

export interface ResolvedEmbeddingModel {
  readonly preset: EmbeddingPresetId;
  readonly label: string;
  /** 实际请求根地址：用户填了就用用户的（去掉末尾斜杠），否则用预设官方地址。 */
  readonly baseUrl: string;
  readonly model: string;
  readonly dim: number;
}

export interface EmbeddingDoc {
  /** 标题，可省略；空标题只嵌正文。 */
  readonly title?: string;
  readonly text: string;
}

function normalizedBase(baseUrl: string | undefined): string {
  return (baseUrl ?? "").trim().replace(/\/+$/, "");
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesHost(host: string, presetHost: string): boolean {
  return host === presetHost || host.endsWith(`.${presetHost}`);
}

/** host 只是别名的一种：用户把请求指向代理时，host 不命中，但 api 标识仍可用。 */
function presetForHost(host: string): EmbeddingPreset | null {
  if (host === "") return null;
  for (const preset of EMBEDDING_PRESETS) {
    if (preset.hosts.some((h) => matchesHost(host, h))) return preset;
  }
  return null;
}

function presetForApi(api: string | undefined): EmbeddingPreset | null {
  const token = (api ?? "").trim().toLowerCase();
  if (token === "") return null;
  for (const preset of EMBEDDING_PRESETS) {
    if (token === preset.id) return preset;
    if (preset.aliases.some((alias) => token === alias.toLowerCase())) return preset;
  }
  return null;
}

/**
 * 解析出可用的 embedding 模型。
 *
 * 优先级：
 * 1. 显式 embeddingModel 且能在预设里找到 → 维度以模型为准（模型名决定维度，
 *    baseUrl 只决定走哪个代理）；
 * 2. baseUrl 的 host 命中预设 → 用预设默认模型；
 * 3. api 标识命中预设 id / 别名 → 用预设默认模型；
 * 4. 都不命中，或显式模型维度未知 → null。
 *
 * 配置自相矛盾（例如 api=openai 却填了 text-embedding-v3）时模型优先：
 * 请求实际发的是这个模型，维度必须跟着它。
 */
export function embeddingModelFor(config: EmbeddingConfig): ResolvedEmbeddingModel | null {
  const baseUrl = normalizedBase(config.baseUrl);
  const explicit = (config.embeddingModel ?? "").trim();

  if (explicit !== "") {
    const modelPreset = EMBEDDING_PRESETS.find((preset) => preset.model === explicit);
    if (!modelPreset) return null;
    return {
      preset: modelPreset.id,
      label: modelPreset.label,
      baseUrl: baseUrl !== "" ? baseUrl : modelPreset.baseUrl,
      model: explicit,
      dim: modelPreset.dim,
    };
  }

  const preset =
    presetForHost(hostOf(baseUrl)) ?? presetForApi(config.api);
  if (preset === null) return null;

  return {
    preset: preset.id,
    label: preset.label,
    baseUrl: baseUrl !== "" ? baseUrl : preset.baseUrl,
    model: preset.model,
    dim: preset.dim,
  };
}

/** 按码点截断，不把代理对切成半个字符。 */
function clampCodePoints(text: string, max: number): string {
  if (max <= 0) return "";
  let out = "";
  let count = 0;
  for (const char of text) {
    if (count === max) break;
    out += char;
    count += 1;
  }
  return out;
}

/**
 * 嵌入输入 = 标题 + 空行 + 正文，整体不超过 2000 码点。
 *
 * 标题单独一行，让模型能把「栈」与正文里的「栈顶」区分开；
 * 标题为空时不留空行，否则每次输入都以两个换行开头。
 */
export function embeddingInput(doc: EmbeddingDoc): string {
  const title = (doc.title ?? "").trim();
  const body = doc.text.trim();
  const combined = title === "" ? body : body === "" ? title : `${title}\n\n${body}`;
  return clampCodePoints(combined, MAX_EMBEDDING_CHARS);
}

/**
 * FNV-1a 32 位散列，返回 8 位小写十六进制。
 *
 * 只用于嵌入缓存键（同一段输入不必重复付费），不是安全散列。
 * 按 UTF-8 字节计算，中文与 emoji 都能得到稳定结果。
 */
export function fnv1a(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
