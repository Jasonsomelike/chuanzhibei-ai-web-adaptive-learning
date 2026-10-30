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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useStaggerIn } from "@/components/motion";
import { KnowledgeBasePanel, type KbCounts } from "@/components/knowledge-base-panel";
import { useAuth } from "@/lib/useAuth";
import { useDirectionDraft } from "@/lib/useDirectionDraft";
import {
  ensureAllItems,
  fetchItems,
  MAX_VERIFIED_CONCEPTS,
  type EnsureAllItemsResult,
  type ItemTraceStep,
} from "@/lib/directionItems";
import { kcEvidenceTarget, type ItemSource } from "@/lib/itemgen";
import { useMaterialPack } from "@/lib/materialStore";
import { getKbStorageForUser, loadDirectionKb } from "@/lib/kbStore";
import { uploadsToPack } from "@/lib/knowledge";
import type { MaterialPack } from "@/lib/materials";
import type { ProviderConfig } from "@/lib/provider";
import type { KnowledgeGraph } from "@/lib/graph";
import { MAX_TITLE_LENGTH, validateTitle, type DirectionDraft } from "@/lib/direction";

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
  /** 生成失败原因，按方向 id 记。进度由每个方向的按钮自己持有。 */
  const [genAllError, setGenAllError] = useState<Record<string, string>>({});

  const [manualFor, setManualFor] = useState<string | null>(null);

  /*
   * 知识库面板只在展开时挂载：useKnowledgeBase 会读该方向的 docs 与 chunks，
   * 一次读全部方向会让首屏为每个方向付一次 IndexedDB 查询。
   * 计数由面板回传，收起后仍能显示上次读到的「N 份 · M 段」。
   */
  const [kbOpen, setKbOpen] = useState<Record<string, boolean>>({});
  const [kbCounts, setKbCounts] = useState<Record<string, KbCounts>>({});

  /* 页面入场与「方向卡片到达」都走同一个一次性 stagger；reduced-motion 下不播。 */
  const mainRef = useRef<HTMLElement>(null);
  useStaggerIn(mainRef);

  const handleKbCounts = useCallback((id: string, counts: KbCounts) => {
    setKbCounts((prev) => {
      const current = prev[id];
      if (current && current.docs === counts.docs && current.chunks === counts.chunks) {
        return prev;
      }
      return { ...prev, [id]: counts };
    });
  }, []);

  /*
   * 字数与校验都按 trim 后的值：与服务端 validateTitle / validateDraft 的口径一致，
   * 否则「输入 60 个空格 + 一个字」会在本地显示合规、保存时才被 422。
   */
  const titleLength = draftState.titleDraft.trim().length;
  const titleIssue = draftState.draft
    ? (validateTitle(draftState.titleDraft)[0] ?? null)
    : null;

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

  if (loading) {
    return (
      <>
        <Nav />
        <main id="main" ref={mainRef} className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--ink-soft)]" data-motion="loading">
            正在加载…
          </p>
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Nav />
        <main id="main" ref={mainRef} className="mx-auto max-w-3xl px-5 py-10">
          <Card motion="login-required">
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
      <main id="main" ref={mainRef} className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6" data-motion="hero">
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

          <Card motion="create">
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

                <label className="mt-2 block">
                  <span className="text-sm font-medium">方向名</span>
                  <span className="ml-2 text-xs text-[var(--ink-faint)]">
                    保存时使用；最多 {MAX_TITLE_LENGTH} 字
                  </span>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      value={draftState.titleDraft}
                      onChange={(e) => draftState.setTitleDraft(e.target.value)}
                      maxLength={MAX_TITLE_LENGTH}
                      placeholder={draftState.draft.title}
                      aria-label="方向名"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm font-medium"
                    />
                    <span className="tabular shrink-0 text-xs text-[var(--ink-faint)]">
                      {titleLength}/{MAX_TITLE_LENGTH}
                    </span>
                    <button
                      type="button"
                      onClick={() => draftState.setTitleDraft(draftState.draft!.title)}
                      disabled={draftState.titleDraft === draftState.draft.title}
                      className="shrink-0 rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs disabled:opacity-40"
                    >
                      恢复建议名
                    </button>
                  </div>
                  <span className="mt-1 block text-xs text-[var(--ink-faint)]">
                    建议名：{draftState.draft.title}。改名只影响这个方向，知识点不变。
                  </span>
                  {titleIssue !== null ? (
                    <span className="mt-1 block text-xs text-[var(--bad)]">{titleIssue}</span>
                  ) : null}
                </label>
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
            <Card motion="empty">
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

                return (
                  <div key={d.id} id={d.id} data-motion="direction">
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
                          <GenerateAllButton
                            direction={d}
                            provider={draftState.provider}
                            userId={user?.id ?? null}
                            onError={(message) =>
                              setGenAllError((prev) => ({ ...prev, [d.id]: message ?? "" }))
                            }
                            onFinished={() => void loadCoverage(mine)}
                          />
                          <button
                            type="button"
                            onClick={() => setManualFor(manualFor === d.id ? null : d.id)}
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs"
                          >
                            手动录题
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setKbOpen((prev) => ({ ...prev, [d.id]: !prev[d.id] }))
                            }
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs"
                          >
                            {kbOpen[d.id] ? "收起知识库" : "知识库"}
                            {kbCounts[d.id]
                              ? ` ${kbCounts[d.id].docs} 份 · ${kbCounts[d.id].chunks} 段`
                              : ""}
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

                    {kbOpen[d.id] ? (
                      <KnowledgeBasePanel
                        directionId={d.id}
                        concepts={d.graph?.concepts ?? []}
                        userId={user?.id ?? null}
                        onCounts={(counts) => handleKbCounts(d.id, counts)}
                      />
                    ) : null}

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

const TRACE_STATUS_LABEL: Record<ItemTraceStep["status"], string> = {
  ok: "通过",
  warn: "注意",
  fail: "失败",
  skip: "跳过",
};

function traceTone(status: ItemTraceStep["status"]): string {
  if (status === "ok") return "text-[var(--good)]";
  if (status === "warn") return "text-[var(--warn)]";
  if (status === "fail") return "text-[var(--bad)]";
  return "text-[var(--ink-faint)]";
}

/**
 * 「生成全部题目」按钮。给老师/答辩演示用，不是默认路径。
 *
 * 单独成组件是因为 useMaterialPack：它一次只服务一个 targetId，
 * 而列表要在同一页渲染多个方向，父组件不能在 map 里循环调 hook。
 * 进度、轨迹与失败原因都归这个方向自己，父组件只负责刷新覆盖度与显示错误。
 *
 * 上传资料在点击时才读：面板不展开也要能出题，但不能为了让按钮可用
 * 就给每个方向在首屏读一遍 IndexedDB。
 */
function GenerateAllButton({
  direction,
  provider,
  userId,
  onError,
  onFinished,
}: {
  direction: DirectionSummary;
  provider: ProviderConfig | null;
  /** 有账号时读「本地 + 账号」复合知识库；为空只读本机。 */
  userId?: string | null;
  /** 失败原因交给父组件显示在按钮行下方；null 表示清除。 */
  onError: (message: string | null) => void;
  onFinished: () => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(
    null,
  );
  const [traces, setTraces] = useState<
    { name: string; steps: readonly ItemTraceStep[] }[]
  >([]);
  const [verification, setVerification] = useState<
    EnsureAllItemsResult["verification"] | null
  >(null);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [aborting, setAborting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  /*
   * 卸载时必须 abort：页面切走后组件不会再更新，
   * 但 ensureItems 的模型请求仍会继续跑、继续计费。
   */
  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  /*
   * 与原先即时构造的图保持一致：方向列表接口不带 chapter，统一标成「自定义」。
   * 资料片段按知识点 id 命中，章节只影响同优先级片段的排序。
   */
  const graph = useMemo<KnowledgeGraph | null>(() => {
    if (!direction.graph) return null;
    return {
      version: `custom-${direction.id}`,
      concepts: direction.graph.concepts.map((c) => ({ ...c, chapter: "自定义" })),
      edges: direction.graph.edges,
    };
  }, [direction]);

  /*
   * 资料口径：内置资料包 + 我的笔记。自定义方向通常没有内置资料，
   * 但笔记仍可挂上来；没选来源时 ensureAllItems 不会注入，行为与旧版一致。
   */
  const { pack, selection } = useMaterialPack(direction.id, graph ?? undefined);

  const stop = (): void => {
    if (controllerRef.current === null) return;
    setAborting(true);
    controllerRef.current.abort();
  };

  const start = async () => {
    if (!graph) return;
    if (!provider) {
      onError("未配置模型供应商，无法生成题目。到设置页配置后再试。");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    onError(null);
    setTraces([]);
    setVerification(null);
    setUploadNote(null);
    setStopped(false);
    setAborting(false);
    setProgress({ done: 0, total: graph.concepts.length, name: "" });

    try {
      /*
       * 读当前方向的上传资料。uploadsToPack 只收绑定了知识点的文档，
       * 未绑定的只服务导师检索，不会混进出题与依据核对。
       * 登录用户走 getKbStorageForUser：本地 + 账号并集，换设备后仍能出题。
       */
      let uploadedPack: MaterialPack | undefined;
      const storage = getKbStorageForUser(userId);
      if (storage !== null) {
        try {
          const kb = await loadDirectionKb(storage, direction.id);
          uploadedPack = uploadsToPack(kb.docs, kb.chunks);
        } catch {
          // 读不到上传资料不阻塞出题；教材与笔记仍然可用
          uploadedPack = undefined;
        }
      }
      if (uploadedPack !== undefined && uploadedPack.chunks.length > 0) {
        setUploadNote(
          `本次生成带上了上传资料 ${uploadedPack.chunks.length} 段（${
            userId ? "含账号同步" : "仅本浏览器"
          }；未绑定知识点的文档不参与出题）。`,
        );
      }

      if (controller.signal.aborted) {
        setStopped(true);
        onError("已停止：尚未开始调用模型。");
        return;
      }

      const result = await ensureAllItems({
        directionId: direction.id,
        graph,
        provider,
        signal: controller.signal,
        material: { pack, selection, uploadedPack },
        verification: provider.verification !== false,
        onProgress: (done, total, name) => setProgress({ done, total, name }),
        onTrace: (_kcId, kcName, trace) =>
          setTraces((prev) => [...prev, { name: kcName, steps: trace }]),
      });
      setVerification(result.verification);

      if (controller.signal.aborted) {
        setStopped(true);
        onError("已停止：已完成的题目已保存，未完成的不会继续生成。");
      } else if (result.failed.length > 0) {
        /*
         * 只列知识点名没法判断是「模型质量差」还是「系统坏了」：
         * 实测里 46 次调用全 200、落了 52 道题，失败其实是没到 4 题门槛。
         * 把去重后的原因带上（最多两条），用户才知道该重试还是该换模型。
         */
        const reasons = [...new Set(result.failed.map((f) => f.error))].slice(0, 2);
        onError(
          `${result.failed.length} 个知识点未就绪：${result.failed
            .map((f) => f.name)
            .slice(0, 3)
            .join("、")}${result.failed.length > 3 ? " 等" : ""}。原因：${reasons.join("；")}`,
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        setStopped(true);
        onError("已停止：已完成的题目已保存，未完成的不会继续生成。");
      } else {
        onError(`生成中断：${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      controllerRef.current = null;
      setProgress(null);
      setAborting(false);
      onFinished();
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void start()}
        disabled={!graph || progress !== null}
        className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs disabled:opacity-40"
      >
        {progress
          ? `生成中 ${progress.done}/${progress.total}${progress.name ? ` · ${progress.name}` : ""}`
          : stopped
            ? "继续生成全部题目"
            : "生成全部题目"}
      </button>

      {progress !== null ? (
        <button
          type="button"
          onClick={stop}
          disabled={aborting}
          className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs text-[var(--bad)] disabled:opacity-40"
        >
          {aborting ? "停止中…" : "停止"}
        </button>
      ) : null}

      {provider !== null && provider.verification === false ? (
        <span className="basis-full text-xs text-[var(--ink-faint)]">
          设置页已关闭依据核对：本次只做生成与双解校验，不会发出 L6 核对请求。
        </span>
      ) : null}

      {uploadNote !== null ? (
        <span className="basis-full text-xs text-[var(--ink-faint)]">{uploadNote}</span>
      ) : null}

      {traces.length > 0 ? (
        <details className="basis-full rounded-lg border border-[var(--line)] p-2 text-xs">
          <summary className="cursor-pointer text-[var(--ink-soft)]">
            生成过程（L1–L6）：{traces.length} 个知识点
            {verification !== null ? ` · 依据核对 ${verification.checked} 个` : ""}
            {stopped ? " · 已停止" : ""}
          </summary>
          <p className="mt-1 text-[var(--ink-faint)]">
            这是每层校验的执行记录，不是模型的原始思维链；只存在于本次页面，不落库。
          </p>
          <ul className="mt-2 space-y-1.5">
            {traces.map((entry, index) => (
              <li key={`${entry.name}-${index}`}>
                <span className="font-medium">{entry.name}</span>
                <ul className="mt-0.5 space-y-0.5 pl-3">
                  {entry.steps.map((step, stepIndex) => (
                    <li key={`${step.key}-${stepIndex}`} className={traceTone(step.status)}>
                      {step.label}：{TRACE_STATUS_LABEL[step.status]}
                      {step.detail ? ` — ${step.detail}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {verification !== null && verification.capped.length > 0 ? (
            <p className="mt-1 text-[var(--warn)]">
              其余 {verification.capped.length} 个知识点因每批最多核对{" "}
              {MAX_VERIFIED_CONCEPTS} 个而未核对；题目照常生成。
            </p>
          ) : null}
        </details>
      ) : null}
    </>
  );
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
