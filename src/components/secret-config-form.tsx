"use client";

/**
 * 账号级密钥配置的通用表单。
 *
 * 一份表单对应 /api/config 的一个 kind（llm / search-deepseek / search-tavily / tts）：
 * 读回时只显示掩码 hint，保存后立刻清空输入框里的明文；
 * 已保存过时密钥留空表示「沿用已存的密文」，不会把明文再发一遍。
 *
 * 错误码必须翻成人话（KEY_ENC_UNAVAILABLE / PERSISTENCE_UNAVAILABLE /
 * CONFLICT_STALE …）：这些不是用户填错了，光看英文码不知道该改什么。
 *
 * 布局是「单列为主、语义成对的字段才两列」：SecretField.width === "half"
 * 只影响排版，不影响字段名、提交体与校验。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";

import {
  DangerButton,
  FormGrid,
  FormRow,
  Panel,
  Pill,
  inputClass,
  monoInputClass,
} from "@/components/ui";
import {
  deleteConfig,
  fetchConfigs,
  parseLlmOptions,
  saveConfig,
  type ConfigErrorCode,
  type ConfigKind,
  type SaveConfigInput,
  type ServerConfigEntry,
} from "@/lib/serverConfig";
import { RATE_MAX, RATE_MIN } from "@/lib/tts";
import type { ProviderKind } from "@/lib/provider";
import type { ThinkingStrength } from "@/lib/reasoning";

export interface SecretField {
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly type?: "text" | "password" | "url" | "number" | "select";
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly required?: boolean;
  /** "half" 只影响排版：与相邻的 half 字段并排，其余字段独占一行。 */
  readonly width?: "half";
}

export interface SecretConfigFormProps {
  readonly kind: ConfigKind;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly SecretField[];
  /** 固定说明，例如「这里的密钥只在服务端解密」。 */
  readonly statusHint?: string;
  readonly submitLabel?: string;
  /** 保存 / 删除成功后通知父组件重新 hydrate 当前状态卡片。 */
  readonly onChanged?: () => void;
}

type Notice =
  | { readonly tone: "good"; readonly text: string }
  | { readonly tone: "bad"; readonly text: string; readonly code?: ConfigErrorCode };

/*
 * useGSAP 官方推荐用 @gsap/react 的 useGSAP() 做 cleanup，但本项目只允许新增
 * gsap 一个依赖，所以按官方文档的同一套机制手写：
 * gsap.context() 收集动画 + 布局 effect 卸载时 revert()。
 * 参考 https://gsap.com/docs/v3/GSAP/gsap.context()/
 */
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * contextSafe 的手写版：事件回调里创建的动画登记进组件的 context，
 * 卸载（含路由切换）时统一 revert，避免残留 tween。
 * 同时在这里统一处理 prefers-reduced-motion：开启后不产生任何动画。
 */
export function useMotionSafe(): (run: () => void) => void {
  const contextRef = useRef<gsap.Context | null>(null);

  useIsoLayoutEffect(() => {
    const context = gsap.context(() => {});
    contextRef.current = context;
    return () => {
      context.revert();
      contextRef.current = null;
    };
  }, []);

  return useCallback((run: () => void) => {
    if (typeof window === "undefined") return;
    if (document.documentElement.dataset.reducedMotion === "true" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = contextRef.current;
    if (context !== null) context.add(run);
    else run();
  }, []);
}

/**
 * 保存成功的短确认态：轻微缩放脉冲，不改变颜色和对比度。
 * 必须在 useMotionSafe 的回调里调用，才能被 context 回收。
 */
export function confirmPulse(element: Element | null): void {
  if (element === null) return;
  gsap.killTweensOf(element);
  gsap.fromTo(
    element,
    { scale: 1 },
    {
      scale: 0.96,
      transformOrigin: "50% 50%",
      duration: 0.08,
      ease: "power2.out",
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        gsap.set(element, { clearProps: "transform" });
      },
    },
  );
}

function emptyEntry(): ServerConfigEntry {
  return {
    configured: false,
    hint: "",
    label: "",
    api: "",
    baseUrl: "",
    model: "",
    options: {},
    updatedAt: "",
  };
}

/** 从公开字段回填表单；secret 字段永远从空开始，浏览器不留明文。 */
function prefill(fields: readonly SecretField[], entry: ServerConfigEntry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (field.type === "password") {
      out[field.name] = "";
      continue;
    }
    if (field.type === "select") {
      const current = knownValue(field.name, entry);
      const allowed = field.options?.some((option) => option.value === current) === true;
      out[field.name] = allowed ? current : (field.options?.[0]?.value ?? "");
      continue;
    }
    out[field.name] = knownValue(field.name, entry);
  }
  return out;
}

function knownValue(name: string, entry: ServerConfigEntry): string {
  switch (name) {
    case "label":
      return entry.label;
    case "kind":
      return entry.api === "anthropic" ? "anthropic" : "openai-compatible";
    case "engine":
      return entry.api === "browser" ? "browser" : "openai-compatible";
    case "baseUrl":
      return entry.baseUrl;
    case "model":
      return entry.model;
    default: {
      const raw = entry.options[name];
      if (raw === undefined) return "";
      return String(raw);
    }
  }
}

function clearSecrets(
  fields: readonly SecretField[],
  values: Record<string, string>,
  entry: ServerConfigEntry,
): Record<string, string> {
  const out = prefill(fields, entry);
  for (const field of fields) {
    if (field.type !== "password") {
      out[field.name] = values[field.name] ?? out[field.name];
    }
  }
  return out;
}

function optionalText(values: Record<string, string>, name: string): string | undefined {
  const value = (values[name] ?? "").trim();
  return value === "" ? undefined : value;
}

function thinkingOf(value: string | undefined): ThinkingStrength {
  return value === "standard" || value === "deep" ? value : "off";
}

/**
 * 表单值 → 请求体。空密钥不放进请求：路由把缺省解释为「沿用已存密文」。
 * 非密钥字段仍整份发送，避免「只改模型」时其它字段被清空。
 *
 * current 用来保留表单上没有的字段（thinkingStatus 是探测结论，不该因为
 * 改一次模型名就被重置成 unknown）。
 */
export function toConfigInput(
  kind: ConfigKind,
  values: Record<string, string>,
  current?: ServerConfigEntry,
): SaveConfigInput {
  const text = (name: string): string => (values[name] ?? "").trim();
  const opt = (name: string): string | undefined => optionalText(values, name);

  switch (kind) {
    case "llm": {
      const label = opt("label");
      const apiKey = opt("apiKey");
      const extraHeaders = opt("extraHeaders");
      const embeddingBaseUrl = opt("embeddingBaseUrl");
      const embeddingModel = opt("embeddingModel");
      const embeddingApiKey = opt("embeddingApiKey");
      const thinkingStatus = parseLlmOptions(current?.options ?? {}).thinkingStatus;
      const kindValue: ProviderKind = text("kind") === "anthropic" ? "anthropic" : "openai-compatible";
      return {
        provider: "llm",
        ...(label !== undefined ? { label } : {}),
        kind: kindValue,
        baseUrl: text("baseUrl"),
        ...(apiKey !== undefined ? { apiKey } : {}),
        model: text("model"),
        ...(extraHeaders !== undefined ? { extraHeaders } : {}),
        thinking: thinkingOf(text("thinking")),
        thinkingStatus,
        verification: text("verification") !== "false",
        ...(embeddingBaseUrl !== undefined ? { embeddingBaseUrl } : {}),
        ...(embeddingModel !== undefined ? { embeddingModel } : {}),
        ...(embeddingApiKey !== undefined ? { embeddingApiKey } : {}),
      };
    }
    case "search-deepseek": {
      const apiKey = opt("apiKey");
      const baseUrl = opt("baseUrl");
      return {
        provider: "search-deepseek",
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      };
    }
    case "search-tavily": {
      const apiKey = opt("apiKey");
      return {
        provider: "search-tavily",
        ...(apiKey !== undefined ? { apiKey } : {}),
      };
    }
    case "tts": {
      const baseUrl = opt("baseUrl");
      const apiKey = opt("apiKey");
      const model = opt("model");
      const voice = opt("voice");
      const browserVoice = opt("browserVoice");
      const rateText = text("rate");
      // 空输入用默认 1.0；Number("") 是 0，直接夹紧会变成 0.8
      const parsedRate = rateText === "" ? Number.NaN : Number(rateText);
      const rate = Number.isFinite(parsedRate)
        ? Math.min(RATE_MAX, Math.max(RATE_MIN, parsedRate))
        : 1;
      return {
        provider: "tts",
        engine: text("engine") === "browser" ? "browser" : "openai-compatible",
        protocol: text("protocol") === "chat-audio" ? "chat-audio" : "speech",
        rate,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(apiKey !== undefined ? { apiKey } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(voice !== undefined ? { voice } : {}),
        ...(browserVoice !== undefined ? { browserVoice } : {}),
      };
    }
  }
}

function missingFields(
  fields: readonly SecretField[],
  values: Record<string, string>,
  configured: boolean,
): string[] {
  return fields
    .filter((field) => {
      if (field.required !== true) return false;
      if ((values[field.name] ?? "").trim() !== "") return false;
      // 已保存过时 secret 留空 = 沿用旧密文
      return !(field.type === "password" && configured);
    })
    .map((field) => field.label);
}

/** 连续两个 half 字段配成一行；其余字段单独一行（单列为主）。 */
function fieldRows(fields: readonly SecretField[]): readonly (readonly SecretField[])[] {
  const rows: SecretField[][] = [];
  for (const field of fields) {
    const last = rows[rows.length - 1];
    if (
      field.width === "half" &&
      last !== undefined &&
      last.length === 1 &&
      last[0].width === "half"
    ) {
      last.push(field);
    } else {
      rows.push([field]);
    }
  }
  return rows;
}

export function SecretConfigForm({
  kind,
  title,
  description,
  fields,
  statusHint,
  submitLabel = "保存到账号",
  onChanged,
}: SecretConfigFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState<ServerConfigEntry>(emptyEntry());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const saveRef = useRef<HTMLButtonElement | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runMotion = useMotionSafe();

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      const result = await fetchConfigs(controller.signal);
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setNotice({ tone: "bad", text: result.message, code: result.code });
        return;
      }
      const found = result.configs[kind];
      setEntry(found);
      setValues(prefill(fields, found));
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [kind, fields]);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    },
    [],
  );

  function update(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }));
    setNotice(null);
    setJustSaved(false);
  }

  const missing = missingFields(fields, values, entry.configured);
  const canSave = !loading && !busy && missing.length === 0;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setNotice(null);
    const result = await saveConfig(toConfigInput(kind, values, entry));
    setBusy(false);

    if (!result.ok) {
      setNotice({ tone: "bad", text: result.message, code: result.code });
      return;
    }

    setEntry(result.entry);
    setValues((prev) => clearSecrets(fields, prev, result.entry));
    setNotice({ tone: "good", text: `已加密保存（掩码 ${result.entry.hint || "—"}）` });
    setJustSaved(true);
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setJustSaved(false), 1800);
    runMotion(() => confirmPulse(saveRef.current));
    onChanged?.();
  }

  async function remove() {
    setBusy(true);
    setNotice(null);
    const result = await deleteConfig(kind);
    setBusy(false);

    if (!result.ok) {
      setNotice({ tone: "bad", text: result.message, code: result.code });
      return;
    }

    const empty = emptyEntry();
    setEntry(empty);
    setValues(prefill(fields, empty));
    setJustSaved(false);
    setNotice({
      tone: "good",
      text: result.deleted ? "已删除账号里的这份配置" : "账号里本来就没有这份配置",
    });
    onChanged?.();
  }

  const rows = fieldRows(fields);

  function renderField(field: SecretField) {
    return (
      <FormRow key={field.name} label={field.label} hint={field.hint}>
        {field.type === "select" ? (
          <select
            value={values[field.name] ?? ""}
            onChange={(event) => update(field.name, event.target.value)}
            className={inputClass}
          >
            {(field.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={values[field.name] ?? ""}
            onChange={(event) => update(field.name, event.target.value)}
            type={field.type === "password" ? "password" : field.type === "number" ? "number" : "text"}
            step={field.type === "number" ? 0.05 : undefined}
            className={
              field.type === "url" || field.type === "password" ? monoInputClass : inputClass
            }
            placeholder={
              field.type === "password" && entry.configured
                ? "已保存；留空表示不修改"
                : field.placeholder
            }
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </FormRow>
    );
  }

  return (
    <Panel className="max-w-3xl bg-[var(--surface)]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <Pill tone={entry.configured ? "good" : "neutral"}>
          {entry.configured ? "已保存" : "未保存"}
        </Pill>
        {entry.configured ? (
          <span className="font-mono text-xs text-[var(--ink-faint)]">
            掩码 {entry.hint || "—"}
            {entry.updatedAt !== "" ? ` · ${entry.updatedAt.replace("T", " ").slice(0, 16)}` : ""}
          </span>
        ) : null}
      </div>

      {description !== undefined ? (
        <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-[var(--ink-faint)]">
          {description}
        </p>
      ) : null}
      {statusHint !== undefined ? (
        <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-[var(--ink-faint)]">
          {statusHint}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-3 text-xs text-[var(--ink-faint)]">正在读取账号配置…</p>
      ) : (
        <div className="mt-4 max-w-2xl space-y-4">
          {rows.map((row) =>
            row.length === 2 ? (
              <FormGrid key={row[0].name}>{row.map(renderField)}</FormGrid>
            ) : (
              <div key={row[0].name}>{renderField(row[0])}</div>
            ),
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-4">
        <button
          ref={saveRef}
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "处理中…" : justSaved ? "已保存" : submitLabel}
        </button>
        <span role="status" className="max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
          {missing.length > 0
            ? `还缺：${missing.join("、")}`
            : entry.configured
              ? "密钥留空表示沿用已保存的密文"
              : "保存后浏览器只显示掩码"}
        </span>
      </div>

      {entry.configured ? (
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3">
          <p className="max-w-[56ch] text-xs leading-relaxed text-[var(--ink-faint)]">
            删除后，依赖这份配置的功能会明确报「未配置」，不会静默回退到其他端点。
          </p>
          <DangerButton onClick={() => void remove()} disabled={busy}>
            删除账号配置
          </DangerButton>
        </div>
      ) : null}

      {notice !== null ? (
        <div
          className={`mt-3 rounded-lg border p-3 text-sm ${
            notice.tone === "good"
              ? "border-[var(--good)] bg-[var(--good-soft)]"
              : "border-[var(--bad)] bg-[var(--bad-soft)]"
          }`}
          role="status"
        >
          <p className="text-[var(--ink-soft)]">{notice.text}</p>
          {notice.tone === "bad" && notice.code !== undefined ? (
            <p className="mt-1 font-mono text-xs text-[var(--ink-faint)]">{notice.code}</p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
