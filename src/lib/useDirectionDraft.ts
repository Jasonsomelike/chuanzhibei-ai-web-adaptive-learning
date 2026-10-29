"use client";

/**
 * 方向草稿的生成与保存。方向页与诊断页共用。
 *
 * 抽出来的原因：两处都要「描述 → 模型生成 → 校验 → 预览 → 保存」，
 * 复制一份必然出现「诊断页能生成、方向页生成不了」这类错位。
 *
 * 生成仍在浏览器直连供应商：key 不经过服务器。
 * 校验在服务端重跑（/api/directions/generate 与 /api/directions），
 * 所以前端的校验结论只影响预览，不影响落库。
 */

import { useCallback, useState } from "react";
import { runStructuredCall, type StructuredValidation } from "@/lib/chat";
import {
  extractJson,
  validateTitle,
  withTitle,
  type DirectionDraft,
} from "@/lib/direction";
import { loadProvider, type ProviderConfig } from "@/lib/provider";

export interface DirectionDraftState {
  readonly description: string;
  readonly setDescription: (s: string) => void;
  readonly draft: DirectionDraft | null;
  /** 用户在预览里编辑的方向名；生成成功时预填草稿标题。 */
  readonly titleDraft: string;
  readonly setTitleDraft: (s: string) => void;
  readonly source: "llm" | "existing" | null;
  readonly issues: readonly string[];
  readonly error: string | null;
  readonly generating: boolean;
  readonly saving: boolean;
  /** 生成草稿。配了模型走浏览器直连，否则走服务端规则拼装。 */
  readonly generate: () => Promise<void>;
  /** 保存草稿。成功返回方向 id，失败返回 null。 */
  readonly save: (opts?: { readonly isPublic?: boolean }) => Promise<string | null>;
  readonly reset: () => void;
  readonly provider: ProviderConfig | null;
}

export function useDirectionDraft(initialDescription = ""): DirectionDraftState {
  const [description, setDescription] = useState(initialDescription);
  const [draft, setDraft] = useState<DirectionDraft | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [source, setSource] = useState<"llm" | "existing" | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provider] = useState<ProviderConfig | null>(() =>
    typeof window === "undefined" ? null : loadProvider(),
  );

  const reset = useCallback(() => {
    setDraft(null);
    setTitleDraft("");
    setSource(null);
    setIssues([]);
    setError(null);
  }, []);

  const generateFallback = useCallback(async (text: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/directions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      const data = (await res.json()) as {
        draft?: DirectionDraft;
        source?: "llm" | "existing";
        error?: string;
        issues?: string[];
      };
      if (res.ok && data.draft) {
        setDraft(data.draft);
        setTitleDraft(data.draft.title);
        setSource("existing");
        return true;
      }
      setError((prev) => prev ?? data.error ?? "生成失败");
      setIssues(data.issues ?? []);
      return false;
    } catch {
      return false;
    }
  }, []);

  const generate = useCallback(async () => {
    const text = description.trim();
    if (text === "") return;

    setGenerating(true);
    setError(null);
    setIssues([]);
    setDraft(null);
    setTitleDraft("");
    setSource(null);

    try {
      if (provider) {
        const metaRes = await fetch("/api/directions/generate", { cache: "no-store" });
        const meta = (await metaRes.json()) as { systemPrompt: string };

        /*
         * 推理模型的思考 token 也计入 max_tokens。实测 2000 会被推理吃光、
         * finish_reason=length，整条链路退化成规则拼装，用户以为模型不会用。
         * 先给 4096；截断或返回的不是 JSON 时由 runStructuredCall 重试一次，
         * 预算翻倍（8192）——截断是可恢复的，直接降级才是浪费。
         */
        const outcome = await runStructuredCall(
          provider,
          {
            system: meta.systemPrompt,
            user: text,
            maxTokens: 4096,
            temperature: 0.4,
            jsonMode: true,
            timeoutMs: 120000,
            purpose: "direction",
          },
          (raw): StructuredValidation<string> =>
            extractJson(raw)
              ? { ok: true, value: raw }
              : { ok: false, reason: "返回内容不是合法 JSON（可能被截断或夹杂了解释文字）" },
          { maxTokens: 8192 },
        );

        // 两次都抽不出 JSON 时不必再浪费一次服务端往返
        if (outcome.value === null) {
          setError("模型返回的内容不是 JSON。可以重试，或到设置页换一个模型。");
          await generateFallback(text);
          return;
        }
        const raw = outcome.value;

        const checkRes = await fetch("/api/directions/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: text, rawModelOutput: raw }),
        });
        const data = (await checkRes.json()) as {
          draft?: DirectionDraft;
          source?: "llm" | "existing";
          error?: string;
          issues?: string[];
        };

        if (!checkRes.ok) {
          setError(data.error ?? "生成失败");
          setIssues(data.issues ?? []);
          // 模型生成的不可用时，退一步给规则拼装的结果
          await generateFallback(text);
          return;
        }
        const nextDraft = data.draft ?? null;
        setDraft(nextDraft);
        // data.draft 缺失时 titleDraft 与 draft 一起清空，避免标题残留成孤立值
        setTitleDraft(nextDraft?.title ?? "");
        setSource(data.source ?? "llm");
      } else {
        await generateFallback(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await generateFallback(text);
    } finally {
      setGenerating(false);
    }
  }, [description, provider, generateFallback]);

  const save = useCallback(
    async (opts?: { readonly isPublic?: boolean }): Promise<string | null> => {
      if (!draft) return null;

      /*
       * 标题不合格时服务端必然 422，先在本地拦下：
       * 不浪费一次往返，也避免用户看到「保存按钮没反应」。
       * 60 字上限服务端 validateDraft 仍会再校验一次。
       */
      const titleIssues = validateTitle(titleDraft);
      if (titleIssues.length > 0) {
        setError(titleIssues[0]);
        setIssues([]);
        return null;
      }

      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/directions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            draft: withTitle(draft, titleDraft),
            isPublic: opts?.isPublic === true,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          id?: string;
          error?: string;
          issues?: string[];
        };
        if (!res.ok || !data.ok || !data.id) {
          setError(data.error ?? "保存失败");
          setIssues(data.issues ?? []);
          return null;
        }
        setDraft(null);
        setTitleDraft("");
        setSource(null);
        setDescription("");
        return data.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [draft, description, titleDraft],
  );

  return {
    description,
    setDescription,
    draft,
    titleDraft,
    setTitleDraft,
    source,
    issues,
    error,
    generating,
    saving,
    generate,
    save,
    reset,
    provider,
  };
}
