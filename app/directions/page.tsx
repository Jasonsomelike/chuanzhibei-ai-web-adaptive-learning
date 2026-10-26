"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useAuth } from "@/lib/useAuth";
import { loadProvider, type ProviderConfig } from "@/lib/provider";
import type { DirectionDraft } from "@/lib/direction";

/**
 * 我的自定义方向。
 *
 * 创建流程：
 *   1. 用户描述想学什么
 *   2. 配了模型 → 浏览器直连生成；没配 → 服务端用规则从现有学科拼装
 *   3. 预览生成的知识点与先修关系，用户确认后才落库
 *   4. 可选公开到方向市场
 *
 * 第 3 步是刻意的：模型生成的东西不能不经确认就变成用户的课程。
 */

interface DirectionSummary {
  id: string;
  title: string;
  description: string;
  isPublic: boolean;
  updatedAt: string;
  graph?: { concepts: { id: string; name: string; summary: string }[]; edges: { before: string; after: string }[] };
}

export default function DirectionsPage() {
  const { user, loading } = useAuth();

  const [mine, setMine] = useState<DirectionSummary[]>([]);
  const [fetching, setFetching] = useState(false);

  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<DirectionDraft | null>(null);
  const [draftSource, setDraftSource] = useState<"llm" | "existing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [publishNow, setPublishNow] = useState(false);
  const [saving, setSaving] = useState(false);

  const [provider, setProvider] = useState<ProviderConfig | null>(null);

  useEffect(() => {
    setProvider(loadProvider());
  }, []);

  const loadMine = useCallback(async () => {
    if (!user) return;
    setFetching(true);
    try {
      const res = await fetch("/api/directions?scope=mine", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { directions: DirectionSummary[] };
        setMine(data.directions ?? []);
      }
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  /** 生成草稿。配了模型就走浏览器直连，否则走服务端规则。 */
  const generate = async () => {
    const text = description.trim();
    if (text === "") return;

    setGenerating(true);
    setError(null);
    setIssues([]);
    setDraft(null);
    setDraftSource(null);

    try {
      if (provider) {
        // 取系统提示词，在浏览器里直连供应商
        const metaRes = await fetch("/api/directions/generate", { cache: "no-store" });
        const meta = (await metaRes.json()) as { systemPrompt: string };

        const raw = await callProvider(provider, meta.systemPrompt, text);

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
        setDraft(data.draft ?? null);
        setDraftSource(data.source ?? "llm");
      } else {
        await generateFallback(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // 直连失败也退回规则拼装，保证功能不空转
      await generateFallback(text);
    } finally {
      setGenerating(false);
    }
  };

  async function generateFallback(text: string) {
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
        setDraftSource("existing");
      } else {
        setError((prev) => prev ?? data.error ?? "生成失败");
        setIssues(data.issues ?? []);
      }
    } catch {
      /* 已在上层处理 */
    }
  }

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, draft, isPublic: publishNow }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; issues?: string[] };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "保存失败");
        setIssues(data.issues ?? []);
        return;
      }
      setDraft(null);
      setDescription("");
      setPublishNow(false);
      await loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const togglePublic = async (id: string, next: boolean) => {
    await fetch("/api/directions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isPublic: next }),
    });
    await loadMine();
  };

  const remove = async (id: string) => {
    await fetch(`/api/directions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMine();
  };

  if (loading) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">正在加载…</p>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <Card>
            <SectionTitle hint="自定义方向需要账号才能保存，这样换设备也不会丢。">
              需要先登录
            </SectionTitle>
            <Link
              href="/login"
              className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
            >
              去登录
            </Link>
            <p className="mt-3 text-sm text-[var(--ink-soft)]">
              也可以直接看{" "}
              <Link href="/market" className="underline">
                方向市场
              </Link>
              ，那里的公开方向无需登录即可浏览。
            </p>
          </Card>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">我的学习方向</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            描述你想学什么，系统把它拆成带先修关系的知识点图谱，可直接用于路径规划。
          </p>
        </div>

        {/* ── 创建 ── */}
        <section className="mb-8">
          <SectionTitle hint={provider ? `将使用 ${provider.label} · ${provider.model} 生成` : "未配置模型，将从现有学科中挑选相关知识点"}>
            新建方向
          </SectionTitle>

          <Card>
            <label className="block">
              <span className="block text-sm font-medium">你想学什么</span>
              <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                越具体越好。例如「我想搞懂数据库索引为什么用 B+ 树」
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1.5 w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                placeholder="例如：我想系统学一遍树结构，从基本概念到平衡树"
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void generate()}
                disabled={generating || description.trim() === ""}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? "生成中…" : "生成方向"}
              </button>
              {!provider ? (
                <span className="text-xs text-[var(--ink-faint)]">
                  <Link href="/settings" className="underline">
                    配置模型
                  </Link>{" "}
                  后可用任意主题
                </span>
              ) : null}
            </div>

            {error ? (
              <div className="mt-3 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-3 text-sm">
                <p className="text-[var(--bad)]">{error}</p>
                {issues.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--ink-soft)]">
                    {issues.map((i) => (
                      <li key={i}>· {i}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {/* ── 预览 ── */}
            {draft ? (
              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone={draftSource === "llm" ? "good" : "warn"}>
                    {draftSource === "llm" ? "模型生成" : "从现有学科挑选"}
                  </Pill>
                  <span className="text-xs text-[var(--ink-faint)]">
                    {draft.concepts.length} 个知识点 · {draft.edges.length} 条先修关系
                  </span>
                </div>

                <p className="font-medium">{draft.title}</p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">{draft.description}</p>

                <ol className="mt-3 space-y-1.5">
                  {draft.concepts.map((c, i) => (
                    <li key={c.id} className="flex gap-2 text-sm">
                      <span className="tabular shrink-0 text-[var(--ink-faint)]">{i + 1}.</span>
                      <span className="min-w-0">
                        <span className="font-medium">{c.name}</span>
                        {c.summary ? (
                          <span className="ml-1.5 text-[var(--ink-soft)]">— {c.summary}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>

                {draft.edges.length > 0 ? (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-[var(--ink-soft)]">
                      查看 {draft.edges.length} 条先修关系
                    </summary>
                    <ul className="mt-2 space-y-0.5 text-xs text-[var(--ink-soft)]">
                      {draft.edges.map((e, i) => (
                        <li key={i}>
                          · {nameOf(draft, e.before)} → {nameOf(draft, e.after)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <label className="mt-4 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={publishNow}
                    onChange={(e) => setPublishNow(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    公开到方向市场
                    <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                      其他人能看到并选用这个方向。不勾选则只有你自己可见，之后可随时改。
                    </span>
                  </span>
                </label>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
                  >
                    {saving ? "保存中…" : "保存这个方向"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setDraftSource(null);
                    }}
                    className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
                  >
                    重新生成
                  </button>
                </div>
              </div>
            ) : null}
          </Card>
        </section>

        {/* ── 我的方向 ── */}
        <section>
          <SectionTitle hint={fetching ? "加载中…" : `共 ${mine.length} 个`}>
            已创建的方向
          </SectionTitle>

          {mine.length === 0 && !fetching ? (
            <Card>
              <p className="text-sm text-[var(--ink-soft)]">
                还没有创建方向。上面输入一句描述就能生成第一个。
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {mine.map((d) => (
                <Card key={d.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.title}</span>
                        <Pill tone={d.isPublic ? "good" : "neutral"}>
                          {d.isPublic ? "已公开" : "私有"}
                        </Pill>
                        {d.graph ? (
                          <span className="tabular text-xs text-[var(--ink-faint)]">
                            {d.graph.concepts.length} 点 / {d.graph.edges.length} 边
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{d.description}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => void togglePublic(d.id, !d.isPublic)}
                        className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs"
                      >
                        {d.isPublic ? "设为私有" : "公开"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(d.id)}
                        className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--bad)]"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function nameOf(draft: DirectionDraft, id: string): string {
  return draft.concepts.find((c) => c.id === id)?.name ?? id;
}

/** 浏览器直连供应商生成方向草稿。失败抛错，由调用方降级。 */
async function callProvider(
  provider: ProviderConfig,
  systemPrompt: string,
  userDescription: string,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (provider.kind === "anthropic") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (provider.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(provider.extraHeaders) as Record<string, string>);
    } catch {
      /* 忽略 */
    }
  }

  const isAnthropic = provider.kind === "anthropic";
  const endpoint = isAnthropic
    ? `${provider.baseUrl}/messages`
    : `${provider.baseUrl}/chat/completions`;

  const body = isAnthropic
    ? {
        model: provider.model,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: "user", content: userDescription }],
      }
    : {
        model: provider.model,
        temperature: 0.4,
        max_tokens: 2000,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userDescription },
        ],
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${t ? ` · ${t.slice(0, 120)}` : ""}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      content?: { text?: string }[];
    };
    const text = json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? "";
    if (!text.trim()) throw new Error("模型返回空内容");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
