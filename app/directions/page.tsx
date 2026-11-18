"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ArrowUpRight } from "lucide-react";
import { CourseCatalog } from "@/components/course-catalog";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useStaggerIn } from "@/components/motion";
import { KnowledgeBasePanel } from "@/components/knowledge-base-panel";
import { useAuth } from "@/lib/useAuth";
import { useClientSnapshot } from "@/lib/useClientSnapshot";
import { DirectionStudio } from "@/components/direction-studio";
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
import { loadProvider, type ProviderConfig } from "@/lib/provider";
import type { KnowledgeGraph } from "@/lib/graph";


interface DirectionSummary {
  id: string;
  title: string;
  description: string;
  isPublic: boolean;
  updatedAt: string;
  graph?: {
    concepts: { id: string; name: string; summary: string; chapter?: string }[];
    edges: { before: string; after: string }[];
  };
}

/** 每个方向的题目覆盖度。null 表示还没拉取。 */
type Coverage = Record<
  string,
  { accepted: number; practice: number; sources: ItemSource[] }
>;

export default function DirectionsPage() {
  const { user } = useAuth();
  return <DirectionsWorkspace key={user?.id ?? "anonymous"} />;
}

function DirectionsWorkspace() {
  const { user, loading } = useAuth();
  const provider = useClientSnapshot(loadProvider, null);

  const [mine, setMine] = useState<DirectionSummary[]>([]);
  const [fetching, setFetching] = useState(false);

  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /*
   * 深链只在客户端可读（useClientSnapshot）：#custom-courses 决定初始分区，
   * ?create=1 在登录态就绪后展开创建面板，?kb=open 展开第一个方向的知识库。
   */
  const deepLink = useClientSnapshot(
    () => ({
      hash: window.location.hash === "#custom-courses",
      create: new URLSearchParams(window.location.search).get("create") === "1",
      kbOpen: new URLSearchParams(window.location.search).get("kb") === "open",
    }),
    { hash: false, create: false, kbOpen: false },
  );
  /** 顶部两个页签：课程目录与自定义方向分视图展示，不再同页堆叠。 */
  const [sectionOverride, setSection] = useState<"catalog" | "custom" | null>(null);
  const [kbDeepLinked, setKbDeepLinked] = useState(false);
  const section = sectionOverride ?? (deepLink.hash || deepLink.kbOpen || kbDeepLinked ? "custom" : "catalog");
  // 登录态就绪后消费 ?create=1（渲染期 adjust-on-change，只消费一次）
  const [createHandled, setCreateHandled] = useState(false);
  if (user && deepLink.create && !createHandled) {
    setCreateHandled(true);
    setSection("custom");
    setCreateOpen(true);
  }
  const switchSection = (next: "catalog" | "custom") => {
    setSection(next);
    requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  };

  const [coverage, setCoverage] = useState<Record<string, Coverage>>({});
  /** 生成失败原因，按方向 id 记。进度由每个方向的按钮自己持有。 */
  const [genAllError, setGenAllError] = useState<Record<string, string>>({});

  const [panels, setPanels] = useState<Record<string, "kb" | "manual" | null>>({});
  const togglePanel = (id: string, panel: "kb" | "manual") =>
    setPanels(prev => ({ ...prev, [id]: prev[id] === panel ? null : panel }));
  // ?kb=open 深链：还没有方向时保持未消费，列表加载完再展开（渲染期 adjust-on-change）
  const [kbConsumed, setKbConsumed] = useState(false);
  if (!kbConsumed && deepLink.kbOpen && mine.length > 0) {
    setKbConsumed(true);
    setKbDeepLinked(true);
    setPanels({ [mine[0].id]: "kb" });
  }
  // 消费后清掉参数，刷新后不再自动展开（副作用留在 effect）
  useEffect(() => {
    if (!kbConsumed) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("kb");
    window.history.replaceState(null, "", url.toString());
  }, [kbConsumed]);

  /* 页面入场与「方向卡片到达」都走同一个一次性 stagger；reduced-motion 下不播。 */
  const mainRef = useRef<HTMLElement>(null);
  useStaggerIn(mainRef);

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

  // 拉取推迟到宏任务：loadMine 的同步前缀会 setState，直接在 effect 里调用触发级联渲染告警
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMine(), 0);
    return () => window.clearTimeout(timer);
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
    if (mine.length === 0) return;
    const timer = window.setTimeout(() => void loadCoverage(mine), 0);
    return () => window.clearTimeout(timer);
  }, [mine, loadCoverage]);

  const onDirectionSaved = (id: string) => {
    setSaveMessage("方向已保存，可以查看路径或开始诊断。");
    setCreateOpen(false);
    setPanels(prev => ({ ...prev, [id]: "kb" }));
    void loadMine();
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

  const openCreate = () => {
    setSection("custom");
    setCreateOpen(true);
    requestAnimationFrame(() => {
      document.getElementById("course-create")?.scrollIntoView({ block:"start" });
      document.querySelector<HTMLTextAreaElement>("#course-create textarea")?.focus({ preventScroll:true });
    });
  };
  const pageChrome = <>
    <header className="courses-page-heading"><h1>我的课程</h1><div><Link href="/market">探索公开课程<ArrowUpRight size={18} /></Link>{user ? <button type="button" onClick={openCreate}><Plus size={18} />创建学习方向</button> : <Link className="course-create-link" href="/login?next=%2Fdirections%3Fcreate%3D1"><Plus size={18} />创建学习方向</Link>}</div></header>
    <nav className="course-section-nav" aria-label="课程分类"><button type="button" aria-current={section === "catalog" ? "true" : undefined} onClick={() => switchSection("catalog")}>课程目录</button><button type="button" aria-current={section === "custom" ? "true" : undefined} onClick={() => switchSection("custom")}>自定义方向</button></nav>
  </>;
  if (loading) {
    return (
      <>
        <Nav />
        <main id="main" ref={mainRef} className="courses-page">
          {pageChrome}
          {section === "catalog" ? <CourseCatalog /> : <div className="courses-loading" aria-label="正在读取自定义方向"><i /><i /></div>}
        </main>
      </>
    );
  }

  if (!user) {
    return (
      <>
        <Nav />
        <main id="main" ref={mainRef} className="courses-page">
          {pageChrome}
          {section === "catalog" ? <CourseCatalog /> : (
          <section id="custom-courses" className="custom-courses"><h2>自定义学习方向</h2>
            <div className="courses-anonymous"><h3>围绕你的教材和目标学习</h3><p>登录后可以创建学习方向，保存图谱并上传自己的资料。</p>
            <Link
              href="/login?next=%2Fdirections%3Fcreate%3D1"
              className="inline-flex rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
            >
              登录并创建方向
            </Link>
            </div>
          </section>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main id="main" ref={mainRef} className="courses-page">
        {pageChrome}
        {section === "catalog" ? <CourseCatalog /> : (<section id="custom-courses" className="custom-courses"><h2>自定义学习方向</h2>

        {/* ── 创建 ── */}
        <details id="course-create" className="course-create" open={createOpen} onToggle={event => setCreateOpen(event.currentTarget.open)}>
          <summary><Plus size={18} />{createOpen ? "收起规划工作台" : "打开规划工作台"}</summary>
          {createOpen && <DirectionStudio owner={user.id} onSaved={onDirectionSaved} />}
        </details>

        {saveMessage && <p role="status" className="direction-saved">{saveMessage}</p>}
        <section>
          <SectionTitle hint={fetching ? "加载中…" : `共 ${mine.length} 个`}>
            已创建的方向
          </SectionTitle>

          {mine.length === 0 && !fetching ? (
            <Card motion="empty">
              <p className="text-sm text-[var(--ink-soft)]">
                还没有自定义方向。可以围绕你的教材或学习目标创建一个。
              </p>
              <button type="button" onClick={openCreate} className="mt-3 text-sm text-[var(--accent)] underline">创建方向</button>
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
                          <h3 className="saved-direction-title">{d.title}</h3>
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

                        <div className="action-row direction-actions mt-2">
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
                            onClick={() => togglePanel(d.id, "kb")}
                            aria-controls={`direction-panel-${d.id}`} aria-expanded={panels[d.id] === "kb"}
                            className="rounded-lg border border-[var(--line-strong)]"
                          >知识库
                          </button>
                        </div>

                        <details className="direction-item-tools"><summary>管理题目</summary><div className="action-row">
                          <GenerateAllButton
                            direction={d}
                            provider={provider}
                            userId={user?.id ?? null}
                            onError={(message) =>
                              setGenAllError((prev) => ({ ...prev, [d.id]: message ?? "" }))
                            }
                            onFinished={() => void loadCoverage(mine)}
                          />
                          <button
                            type="button"
                            onClick={() => togglePanel(d.id, "manual")}
                            aria-controls={`direction-panel-${d.id}`} aria-expanded={panels[d.id] === "manual"}
                            className="rounded-lg border border-[var(--line-strong)] px-3 py-1 text-xs"
                          >
                            手动录题
                          </button>
                        </div></details>
                        {genAllError[d.id] ? (
                          <p className="mt-2 text-xs text-[var(--bad)]">{genAllError[d.id]}</p>
                        ) : null}
                      </div>

                      <div className="action-row">
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

                    <div id={`direction-panel-${d.id}`}>
                    {panels[d.id] === "kb" ? (
                      <KnowledgeBasePanel
                        directionId={d.id}
                        concepts={d.graph?.concepts ?? []}
                        userId={user?.id ?? null}
                      />
                    ) : null}

                    {panels[d.id] === "manual" && d.graph ? (
                      <ManualItemForm
                        directionId={d.id}
                        concepts={d.graph.concepts}
                        onSaved={() => void loadCoverage(mine)}
                      />
                    ) : null}
                    </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </section>)}
      </main>
    </>
  );
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
      concepts: direction.graph.concepts.map((c) => ({ ...c, chapter: c.chapter || "自定义" })),
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
