"use client";

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
 *
 * 生成/保存逻辑与诊断页共用 useDirectionDraft，不各写一份——
 * 两份实现必然出现「这里能生成、那里生成不了」的错位。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useAuth } from "@/lib/useAuth";
import { useDirectionDraft } from "@/lib/useDirectionDraft";
import { ensureAllItems, fetchItems } from "@/lib/directionItems";
import { kcEvidenceTarget, type ItemSource } from "@/lib/itemgen";
import type { DirectionDraft } from "@/lib/direction";

interface DirectionSummary {
  id: string;
  title: string;
  description: string;
  isPublic: boolean;
  updatedAt: string;
  graph?: {
    concepts: { id: string; name: string; summary: string }[];
    edges: { before: string; after: string }[];
  };
}

/** 每个方向的题目覆盖度。null 表示还没拉取。 */
type Coverage = Record<
  string,
  { accepted: number; practice: number; sources: ItemSource[] }
>;

export default function DirectionsPage() {
  const { user, loading } = useAuth();
  const draftState = useDirectionDraft();

  const [mine, setMine] = useState<DirectionSummary[]>([]);
  const [fetching, setFetching] = useState(false);
  const [publishNow, setPublishNow] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [coverage, setCoverage] = useState<Record<string, Coverage>>({});
  const [genAll, setGenAll] = useState<{ id: string; done: number; total: number; name: string } | null>(
    null,
  );
  const [genAllError, setGenAllError] = useState<Record<string, string>>({});

  const [manualFor, setManualFor] = useState<string | null>(null);

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

  /** 拉每个方向的题目覆盖度。串行即可，方向数量是个位数。 */
  const loadCoverage = useCallback(async (dirs: DirectionSummary[]) => {
    const next: Record<string, Coverage> = {};
    for (const d of dirs) {
      const items = await fetchItems(d.id, "");
      const cov: Coverage = {};
      for (const it of items) {
        const bucket = (cov[it.kcId] ??= { accepted: 0, practice: 0, sources: [] });
        if (it.status === "accepted") {
          bucket.accepted += 1;
          bucket.sources.push(it.source);
        } else if (it.status === "practice") bucket.practice += 1;
      }
      next[d.id] = cov;
    }
    setCoverage(next);
  }, []);

  useEffect(() => {
    if (mine.length > 0) void loadCoverage(mine);
  }, [mine, loadCoverage]);

  const save = async () => {
    setSaveMessage(null);
    const id = await draftState.save({ isPublic: publishNow });
    if (!id) return;
    setSaveMessage("已保存。可以去诊断页为它出题。");
    setPublishNow(false);
    await loadMine();
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

  /** 一次备齐某个方向的所有题目。给老师/答辩演示用，不是默认路径。 */
  const generateAll = async (d: DirectionSummary) => {
    if (!d.graph) return;
    const provider = draftState.provider;
    if (!provider) {
      setGenAllError((prev) => ({
        ...prev,
        [d.id]: "未配置模型供应商，无法生成题目。到设置页配置后再试。",
      }));
      return;
    }

    setGenAllError((prev) => ({ ...prev, [d.id]: "" }));
    setGenAll({ id: d.id, done: 0, total: d.graph.concepts.length, name: "" });

    const result = await ensureAllItems({
      directionId: d.id,
      graph: {
        version: `custom-${d.id}`,
        concepts: d.graph.concepts.map((c) => ({ ...c, chapter: "自定义" })),
        edges: d.graph.edges,
      },
      provider,
      onProgress: (done, total, name) => setGenAll({ id: d.id, done, total, name }),
    });

    setGenAll(null);
    if (result.failed.length > 0) {
      setGenAllError((prev) => ({
        ...prev,
        [d.id]: `${result.failed.length} 个知识点生成失败：${result.failed
          .map((f) => f.name)
          .slice(0, 3)
          .join("、")}${result.failed.length > 3 ? " 等" : ""}`,
      }));
    }
    await loadCoverage(mine);
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
            描述你想学什么，系统把它拆成带先修关系的知识点图谱，可直接用于路径规划与诊断。
          </p>
        </div>

        {/* ── 创建 ── */}
        <section className="mb-8">
          <SectionTitle
            hint={
              draftState.provider
                ? `将使用 ${draftState.provider.label} · ${draftState.provider.model} 生成`
                : "未配置模型，将从现有学科中挑选相关知识点"
            }
          >
            新建方向
          </SectionTitle>

          <Card>
            <label className="block">
              <span className="block text-sm font-medium">你想学什么</span>
              <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                越具体越好。例如「我想搞懂数据库索引为什么用 B+ 树」
              </span>
              <textarea
                value={draftState.description}
                onChange={(e) => draftState.setDescription(e.target.value)}
                rows={3}
                maxLength={500}
                className="mt-1.5 w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                placeholder="例如：我想系统学一遍树结构，从基本概念到平衡树"
              />
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void draftState.generate()}
                disabled={draftState.generating || draftState.description.trim() === ""}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {draftState.generating ? "生成中…" : "生成方向"}
              </button>
              {!draftState.provider ? (
                <span className="text-xs text-[var(--ink-faint)]">
                  <Link href="/settings" className="underline">
                    配置模型
                  </Link>{" "}
                  后可用任意主题
                </span>
              ) : null}
            </div>

            {draftState.error ? (
              <div className="mt-3 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-3 text-sm">
                <p className="text-[var(--bad)]">{draftState.error}</p>
                {draftState.issues.length > 0 ? (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--ink-soft)]">
                    {draftState.issues.map((i) => (
                      <li key={i}>· {i}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {saveMessage ? (
              <p className="mt-3 rounded-lg border border-[var(--good)] bg-[var(--good-soft)] p-3 text-sm text-[var(--good)]">
                {saveMessage}
              </p>
            ) : null}

            {/* ── 预览 ── */}
            {draftState.draft ? (
              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Pill tone={draftState.source === "llm" ? "good" : "warn"}>
                    {draftState.source === "llm" ? "模型生成" : "从现有学科挑选"}
                  </Pill>
                  <span className="text-xs text-[var(--ink-faint)]">
                    {draftState.draft.concepts.length} 个知识点 ·{" "}
                    {draftState.draft.edges.length} 条先修关系
                  </span>
                </div>

                <p className="font-medium">{draftState.draft.title}</p>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">
                  {draftState.draft.description}
                </p>

                <ol className="mt-3 space-y-1.5">
                  {draftState.draft.concepts.map((c, i) => (
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

                {draftState.draft.edges.length > 0 ? (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-[var(--ink-soft)]">
                      查看 {draftState.draft.edges.length} 条先修关系
                    </summary>
                    <ul className="mt-2 space-y-0.5 text-xs text-[var(--ink-soft)]">
                      {draftState.draft.edges.map((e, i) => (
                        <li key={i}>
                          · {nameOf(draftState.draft!, e.before)} → {nameOf(draftState.draft!, e.after)}
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
                    disabled={draftState.saving}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
                  >
                    {draftState.saving ? "保存中…" : "保存这个方向"}
                  </button>
                  <button
                    type="button"
                    onClick={draftState.reset}
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
              {mine.map((d) => {
                const cov = coverage[d.id] ?? {};
                const totalKcs = d.graph?.concepts.length ?? 0;
                /*
                 * 门槛与诊断页共用 kcEvidenceTarget：
                 * 生成题要 4 道、手动/借用只要 3 道。
                 * 写死 4 会让「手动录了 3 道、已可诊断」的方向显示「未就绪」。
                 */
                const readyKcs = d.graph
                  ? d.graph.concepts.filter((c) => {
                      const bucket = cov[c.id];
                      const accepted = bucket?.accepted ?? 0;
                      return accepted >= kcEvidenceTarget(bucket?.sources ?? []);
                    }).length
                  : 0;
                const isGenerating = genAll?.id === d.id;

                return (
                  <div key={d.id} id={d.id}>
                    <Card>
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
                          {d.graph ? (
                            <Pill tone={readyKcs === totalKcs ? "good" : "warn"}>
                              题目 {readyKcs}/{totalKcs} 个知识点就绪
                            </Pill>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[var(--ink-soft)]">{d.description}</p>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            href={`/diagnose?direction=${encodeURIComponent(d.id)}`}
                            className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs font-medium text-[var(--on-accent)]"
                          >
                            开始诊断
                          </Link>
                          <Link
                            href={`/path?direction=${encodeURIComponent(d.id)}`}
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs"
                          >
                            查看路径
                          </Link>
                          <button
                            type="button"
                            onClick={() => void generateAll(d)}
                            disabled={isGenerating}
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs disabled:opacity-40"
                          >
                            {isGenerating
                              ? `生成中 ${genAll.done}/${genAll.total}${genAll.name ? ` · ${genAll.name}` : ""}`
                              : "生成全部题目"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setManualFor(manualFor === d.id ? null : d.id)}
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs"
                          >
                            手动录题
                          </button>
                        </div>

                        {genAllError[d.id] ? (
                          <p className="mt-2 text-xs text-[var(--bad)]">{genAllError[d.id]}</p>
                        ) : null}
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

                    {manualFor === d.id && d.graph ? (
                      <ManualItemForm
                        directionId={d.id}
                        concepts={d.graph.concepts}
                        onSaved={() => void loadCoverage(mine)}
                      />
                    ) : null}
                    </Card>
                  </div>
                );
              })}
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

/** 手动录题。只跑 L2 结构检查（用户自己保证答案正确），source=manual。 */
function ManualItemForm({
  directionId,
  concepts,
  onSaved,
}: {
  directionId: string;
  concepts: readonly { id: string; name: string }[];
  onSaved: () => void;
}) {
  const [kcId, setKcId] = useState(concepts[0]?.id ?? "");
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [answerText, setAnswerText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [difficulty, setDifficulty] = useState<"basic" | "advanced" | "challenge">("advanced");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/directions/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directionId,
          kcId,
          items: [
            {
              difficulty,
              stem,
              options,
              answerText,
              explanation,
              source: "manual",
              status: "accepted",
            },
          ],
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        inserted?: number;
        rejected?: { issues: string[] }[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "保存失败");
        return;
      }
      if ((data.inserted ?? 0) === 0) {
        const issues = data.rejected?.[0]?.issues ?? ["未通过结构检查"];
        setError(`未保存：${issues.join("；")}`);
        return;
      }
      setMessage("已保存。手动录入的题不做机器答案校验，请自行确认正确性。");
      setStem("");
      setOptions(["", "", "", ""]);
      setAnswerText("");
      setExplanation("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4">
      <p className="text-sm font-medium">手动录入题目</p>
      <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
        手动题只做结构检查，不做答案校验——正确性由你保证，界面上会如实标注。
      </p>

      <label className="mt-3 block text-sm">
        <span>知识点</span>
        <select
          value={kcId}
          onChange={(e) => setKcId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {concepts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-2 block text-sm">
        <span>题干</span>
        <textarea
          value={stem}
          onChange={(e) => setStem(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((o, i) => (
          <label key={i} className="block text-sm">
            <span className="text-xs text-[var(--ink-faint)]">选项 {String.fromCharCode(65 + i)}</span>
            <input
              value={o}
              onChange={(e) => {
                const next = [...options];
                next[i] = e.target.value;
                setOptions(next);
              }}
              className="mt-0.5 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-sm">
          <span>正确答案（从上面四个选项里选）</span>
          <select
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">请选择</option>
            {options
              .filter((o) => o.trim() !== "")
              .map((o, i) => (
                <option key={`${o}-${i}`} value={o}>
                  {o}
                </option>
              ))}
          </select>
        </label>

        <label className="block text-sm">
          <span>难度</span>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
            className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="basic">基础</option>
            <option value="advanced">进阶</option>
            <option value="challenge">挑战</option>
          </select>
        </label>
      </div>

      <label className="mt-2 block text-sm">
        <span>解析（至少 20 字）</span>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || stem.trim() === "" || answerText === ""}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
        >
          {busy ? "保存中…" : "保存这道题"}
        </button>
        {message ? <span className="text-xs text-[var(--good)]">{message}</span> : null}
        {error ? <span className="text-xs text-[var(--bad)]">{error}</span> : null}
      </div>
    </div>
  );
}
