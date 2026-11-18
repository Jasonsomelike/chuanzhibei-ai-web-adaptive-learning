"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BaseEdge, type Edge, type EdgeProps, Controls, Handle, MarkerType, Position, ReactFlow, getNodesBounds, getViewportForBounds, useUpdateNodeInternals, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import { ArrowRight, BookOpen, Check, Circle, CircleDot, Diamond, ListOrdered, Network, Search } from "lucide-react";
import "@xyflow/react/dist/style.css";
import { Hint } from "@/components/primitives/hint";
import { prefersReducedMotion } from "@/components/motion";
import { useAppearance } from "@/lib/appearance";
import { chaptersOf } from "@/lib/chapters";
import { LEARNING_STATUS_LABELS, layoutLearningNodes, learningEdgeVisual, learningGraphFileName, learningGraphNodes, relatedLearningNodes, type LearningGraphNode } from "@/lib/learningGraph";
import { learningEdgePath, learningNodeSize, routeLearningEdges } from "@/lib/learningGraphLayout";
import type { KnowledgeGraph } from "@/lib/graph";
import type { MasteryState } from "@/lib/mastery";
import type { PathStep, PlanResult } from "@/lib/plan";

type ConceptNode = Node<{ concept: LearningGraphNode; added: boolean; vertical: boolean; compact: boolean }, "concept">;
const Concept = memo(function Concept({ id, data, selected }: NodeProps<ConceptNode>) {
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals(id); }, [id, data.vertical, data.compact, updateInternals]);
  const item = data.concept;
  const Symbol = item.status === "blocked" ? Diamond : item.status === "mastered" ? CircleDot : Circle;
  return <div style={learningNodeSize(data.compact ? "compact" : data.vertical ? "vertical" : "horizontal")} data-new-step={data.added || undefined} className={`knowledge-node node-${item.status} ${selected ? "node-selected" : ""}`}>
    <Handle id="left" type="target" position={Position.Left} isConnectable={false}  />
    <Handle id="top" type="target" position={Position.Top} isConnectable={false}  />
    <span className="concept-mark"><Symbol className="concept-anchor" size={30} strokeWidth={selected ? 2.8 : 2} />{item.order ? <span className="concept-order">{item.order}</span> : null}</span>
    <div className="concept-label"><span title={item.name}>{item.name}</span><small>{item.mean === null ? (item.order ? "本次学习" : "") : <>{Math.round(item.mean * 100)}%<span className="node-mastery-sd">±{Math.round((item.sd ?? 0) * 100)}</span> · {item.evidenceN} 条证据</>}{data.added ? " · 新增" : ""}</small></div>
    <Handle id="right" type="source" position={Position.Right} isConnectable={false}  />
    <Handle id="bottom" type="source" position={Position.Bottom} isConnectable={false}  />
  </div>;
});
const nodeTypes = { concept: Concept };
type PrerequisiteEdge = Edge<{ path: string }>;
function RoutedEdge({ id, data, style, markerEnd }: EdgeProps<PrerequisiteEdge>) {
  return <BaseEdge id={id} path={data?.path ?? ""} style={style} markerEnd={markerEnd} />;
}
const edgeTypes = { prerequisite: RoutedEdge };

/** 导出画布的固定尺寸：竖向章节列在 1600×1000 内足够放下一屏全科关系。 */
const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 1000;

export default function LearningGraph({ graph, mastery, plan, steps, query, selectedId, addedKcIds, targetName, onSelect, onLocate }: {
  graph: KnowledgeGraph; mastery: readonly MasteryState[]; plan: PlanResult; steps: readonly PathStep[]; query: string; addedKcIds: readonly string[]; targetName: string; selectedId: string | null; onSelect: (id: string) => void; onLocate: (id: string) => void;
}) {
  const { layout } = useAppearance();
  const vertical = layout === "chapters";
  const [showAll, setShowAll] = useState(false);
  const [compact, setCompact] = useState(false);
  const [mobileView, setMobileView] = useState<"map" | "list">("map");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [flow, setFlow] = useState<ReactFlowInstance<ConceptNode> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const onNodesChange = useCallback((changes: NodeChange<ConceptNode>[]) => {
    for (const change of changes) if (change.type === "select" && change.selected) onSelect(change.id);
    setDimensions(previous => {
      let next = previous;
      for (const change of changes) if (change.type === "dimensions" && change.dimensions) {
        const size = change.dimensions;
        if (previous[change.id]?.width === size.width && previous[change.id]?.height === size.height) continue;
        if (next === previous) next = { ...previous };
        next[change.id] = { width: size.width, height: size.height };
      }
      return next;
    });
  }, [onSelect]);
  const searchId = useId();
  const added = useMemo(() => new Set(addedKcIds), [addedKcIds]);
  const models = useMemo(() => learningGraphNodes(graph, mastery, plan, steps), [graph, mastery, plan, steps]);
  const byId = useMemo(() => new Map(models.map(item => [item.id, item])), [models]);
  const selected = models.find(item => item.id === selectedId) ?? models.find(item => item.order === 1) ?? models[0];
  const selectedNodeId = selected?.id;
  const related = useMemo(() => relatedLearningNodes(graph, steps, selectedNodeId), [graph, steps, selectedNodeId]);
  const direction = compact ? "compact" : vertical ? "vertical" : "horizontal";
  const nodeSize = learningNodeSize(direction);
  const visibleModels = useMemo(() => {
    const visible = models.filter(item => showAll || related.size === 0 || related.has(item.id));
    return layoutLearningNodes(visible, direction);
  }, [models, showAll, related, direction]);
  // Retain measurements: controlled React Flow nodes need handle bounds after a resize.
  const nodes = useMemo<ConceptNode[]>(() => visibleModels.map(item => ({ id: item.id, type: "concept", position: item.position, initialWidth: nodeSize.width, initialHeight: nodeSize.height, measured: dimensions[item.id], data: { concept: item, added: added.has(item.id), vertical: direction !== "horizontal", compact }, selected: item.id === selectedNodeId, draggable: false, ariaLabel: `${item.name}，${LEARNING_STATUS_LABELS[item.status]}${added.has(item.id) ? "，新增安排" : ""}，${item.evidenceN ? `${item.evidenceN} 条作答证据` : "尚未测评"}` })), [visibleModels, dimensions, selectedNodeId, added, direction, compact, nodeSize.width, nodeSize.height]);
  const stepSignature = steps.map(step => step.kcId).join(",");
  useEffect(() => {
    if (!flow || !canvas.current) return;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout>;
    const fit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
      const duration = prefersReducedMotion() ? 0 : 220;
      if (canvas.current && canvas.current.clientWidth < 600 && !showAll) {
        const node = flow.getNodes().find(item => item.selected) ?? flow.getNodes()[0];
        if (node) void flow.setCenter(node.position.x + nodeSize.width / 2, node.position.y + nodeSize.height / 2 + (compact ? 60 : 0), { zoom: .95, duration });
      } else {
        const all = flow.getNodes();
        const selected = all.find(node => node.selected);
        const neighborhood = selected ? all.filter(node => node.id === selected.id || selected.data.concept.prerequisites.includes(node.id) || node.data.concept.prerequisites.includes(selected.id)) : all;
        void flow.fitView({ nodes: showAll ? all : neighborhood, padding: .15, minZoom: showAll ? .15 : .65, maxZoom: 1, duration });
      }
    }); };
    const observer = new ResizeObserver(() => { setCompact((canvas.current?.clientWidth ?? 0) < 450); clearTimeout(settle); settle = setTimeout(fit, 160); });
    observer.observe(canvas.current);
    fit();
    return () => { clearTimeout(settle); cancelAnimationFrame(frame); observer.disconnect(); };
  }, [flow, showAll, stepSignature, layout, compact, nodeSize.width, nodeSize.height]);
  const paths = useMemo(() => {
    const size = learningNodeSize(direction);
    const obstacles = visibleModels.map(node => ({ ...node.position, ...size }));
    const routes = routeLearningEdges(visibleModels, direction);
    return new Map(Array.from(routes, ([id, points]) => [id, learningEdgePath(points, obstacles, direction)]));
  }, [visibleModels, direction]);
  const edges = useMemo(() => {
    const visible = new Set(visibleModels.map(item => item.id));
    const blockedTargets = new Set(visibleModels.filter(item => item.status === "blocked").map(item => item.id));
    const strokeVar = { accent: "var(--accent)", warn: "var(--warn)", plain: "var(--ink-faint)" } as const;
    return graph.edges.filter(edge => visible.has(edge.before) && visible.has(edge.after)).map(edge => {
      const visual = learningEdgeVisual(edge.before, edge.after, { selectedId: selectedNodeId, showAll, isBlockedTarget: id => blockedTargets.has(id) });
      const color = strokeVar[visual.tone];
      const downward = direction !== "horizontal";
      return { id: `${edge.before}-${edge.after}`, source: edge.before, target: edge.after, sourceHandle: downward ? "bottom" : "right", targetHandle: downward ? "top" : "left", type: "prerequisite", data: { path: paths.get(`${edge.before}-${edge.after}`) ?? "" }, markerEnd: { type: MarkerType.ArrowClosed, color, markerUnits: "userSpaceOnUse", width: 22, height: 22 }, style: { stroke: color, strokeWidth: visual.emphasized ? 2.2 : 1.65, opacity: visual.opacity, ...(visual.dashed ? { strokeDasharray: "6 4" } : {}) }, ariaLabel: `${byId.get(edge.before)?.name} 是 ${byId.get(edge.after)?.name} 的先修知识${visual.dashed ? "（阻塞来源）" : ""}` };
    });
  }, [graph, visibleModels, byId, direction, selectedNodeId, showAll, paths]);

  /**
   * 导出当前画布为 PNG。
   *
   * html-to-image 动态导入：不进首屏包。用固定尺寸 + getViewportForBounds
   * 重新取景，导出的是完整图谱，与屏幕上的缩放无关。
   */
  const exportPng = useCallback(async () => {
    if (!flow || !canvas.current || visibleModels.length === 0 || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const [{ toPng }] = await Promise.all([import("html-to-image")]);
      const viewportElement = canvas.current.querySelector<HTMLElement>(".react-flow__viewport");
      if (!viewportElement) throw new Error("画布尚未渲染完成");
      const viewport = getViewportForBounds(getNodesBounds(flow.getNodes()), EXPORT_WIDTH, EXPORT_HEIGHT, 0.2, 1.5, 0.14);
      const style = getComputedStyle(document.documentElement);
      const surface = style.getPropertyValue("--surface").trim() || "#ffffff";
      const dataUrl = await toPng(viewportElement, {
        backgroundColor: surface,
        width: EXPORT_WIDTH,
        height: EXPORT_HEIGHT,
        style: { width: `${EXPORT_WIDTH}px`, height: `${EXPORT_HEIGHT}px`, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` },
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = learningGraphFileName(targetName, new Date().toISOString());
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      setExportError(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  }, [flow, visibleModels.length, exporting, targetName]);
  const sequence = useRef<HTMLElement>(null);
  useEffect(() => {
    const row = [...(sequence.current?.querySelectorAll<HTMLElement>("[data-kc]") ?? [])].find(el => el.dataset.kc === selectedNodeId);
    if (row && sequence.current) { const parent = sequence.current; if (row.offsetTop < parent.scrollTop || row.offsetTop + row.offsetHeight > parent.scrollTop + parent.clientHeight) parent.scrollTo({ top: row.offsetTop - parent.clientHeight / 2, behavior: prefersReducedMotion() ? "instant" : "smooth" }); }
  }, [selectedNodeId]);
  const focus = (value: string) => {
    onSelect(value);
    setSearchOpen(false);
    if (mobileView === "list") {
      setMobileView("map");
      requestAnimationFrame(() => canvas.current?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "instant" : "smooth" }));
    }
  };
  useEffect(() => {
    if (!selectedId || !flow || !canvas.current) return;
    const item = visibleModels.find(node => node.id === selectedId);
    if (!item) return;
    const frame = requestAnimationFrame(() => {
      if (!canvas.current) return;
      const viewport = flow.getViewport();
      const x = item.position.x * viewport.zoom + viewport.x + 16;
      const y = item.position.y * viewport.zoom + viewport.y + 28;
      if (viewport.zoom >= .65 && x > 16 && x < canvas.current.clientWidth - 100 && y > 16 && y < canvas.current.clientHeight - 60) return;
      void flow.setCenter(item.position.x + (compact ? 70 : 90), item.position.y + 38, { zoom: Math.max(.9, Math.min(1, viewport.zoom)), duration: prefersReducedMotion() ? 0 : 220 });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, flow, visibleModels, compact, showAll]);
  const keyword = search.trim().toLocaleLowerCase();
  const relevance = (item: LearningGraphNode) => item.name.toLocaleLowerCase() === keyword ? 0 : item.name.toLocaleLowerCase().includes(keyword) ? 1 : 2;
  const results = models.filter(item => `${item.name} ${item.chapter}`.toLocaleLowerCase().includes(keyword)).sort((a,b) => relevance(a) - relevance(b)).slice(0, 8);
  const queryPrefix = query ? `${query}&` : "?";
  const studyHref = selected ? `/tutor${queryPrefix}kc=${encodeURIComponent(selected.id)}&q=${encodeURIComponent(`请引导我理解${selected.name}，先给一个思考问题。`)}` : `/tutor${query}`;
  const chapterIndex = chaptersOf(graph);

  return <section className="knowledge-workspace" data-compact={compact || undefined} data-mobile-view={mobileView} aria-label="交互先修图谱">
    <div className="knowledge-toolbar">
      <div className="concept-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
        <Search size={20} /><input type="search" role="combobox" aria-label="搜索知识点" placeholder="搜索知识点" aria-controls={searchId} aria-expanded={searchOpen} aria-autocomplete="list" aria-activedescendant={searchOpen && results.length ? `${searchId}-${activeResult}` : undefined} value={search} onFocus={() => setSearchOpen(Boolean(search.trim()))} onChange={event => { setSearch(event.target.value); setSearchOpen(Boolean(event.target.value.trim())); setActiveResult(0); }} onKeyDown={event => {
          if (event.key === "Escape") setSearchOpen(false);
          if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setSearchOpen(true); setActiveResult(current => results.length ? (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); }
          if (event.key === "Enter" && results[activeResult]) { event.preventDefault(); focus(results[activeResult].id); }
        }} />
        {searchOpen ? <ul id={searchId} role="listbox">{results.length ? results.map((item, index) => <li key={item.id} id={`${searchId}-${index}`} role="option" aria-selected={index === activeResult}><button type="button" onClick={() => focus(item.id)}><span>{item.name}</span><small>{item.chapter}</small></button></li>) : <li className="search-empty">没有找到匹配的知识点。</li>}</ul> : null}
      </div>
      <div className="segmented" role="group" aria-label="图谱范围"><button type="button" aria-pressed={!showAll} onClick={() => setShowAll(false)}>当前路径</button><button type="button" aria-pressed={showAll} onClick={() => setShowAll(true)}>全科关系</button></div>
      <span className="knowledge-visible-count">{visibleModels.length} / {models.length} 个知识点</span>
      <button type="button" onClick={() => void exportPng()} disabled={exporting || !flow || visibleModels.length === 0} title="把当前图谱导出为 PNG 图片" className="cursor-interaction rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40">{exporting ? "导出中…" : "导出 PNG"}</button>
      {exportError !== null ? <span role="alert" className="text-xs text-[var(--bad)]">{exportError}</span> : null}
    </div>
    <aside className="knowledge-chapter-index" aria-label="课程目录"><h2>课程目录</h2>{chapterIndex.map(chapter => <button key={chapter.name} type="button" aria-current={selected?.chapter === chapter.name ? "true" : undefined} onClick={() => focus(chapter.kcIds[0])}>{chapter.name}</button>)}</aside>
    <div className="knowledge-canvas" ref={canvas} role="region" aria-label="可缩放的课程先修关系图">
      <ReactFlow<ConceptNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlow} onNodeClick={(_event, node) => onSelect(node.id)} onNodesChange={onNodesChange} fitView fitViewOptions={{ padding: .1, maxZoom: 1 }} minZoom={.15} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} panOnScroll={false} zoomOnScroll={false} preventScrolling={false} attributionPosition="bottom-right" ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "放大图谱", "controls.zoomOut.ariaLabel": "缩小图谱", "controls.fitView.ariaLabel": "查看完整图谱", "controls.interactive.ariaLabel": "切换图谱交互" }}>
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="graph-mobile-switch" role="group" aria-label="图谱与学习清单">
      <button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}><Network size={19} />图谱</button>
      <button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")}><ListOrdered size={19} />学习清单</button>
    </div>
    <section ref={sequence} className="knowledge-sequence" aria-label="本次学习顺序"><div className="knowledge-sequence-heading"><h2>本次学习顺序</h2><span>{steps.reduce((sum, step) => sum + step.estMinutes, 0)} 分钟</span></div>
      {steps.length ? <ol>{steps.map((step, index) => <li key={step.kcId} data-kc={step.kcId}><button type="button" aria-pressed={selectedNodeId === step.kcId} onClick={() => focus(step.kcId)}><span className="sequence-number">{index + 1}</span><span>{byId.get(step.kcId)?.name ?? step.kcId}{added.has(step.kcId) ? <small>新增安排</small> : null}</span><span className="sequence-time">{step.estMinutes} 分钟</span></button></li>)}</ol> : <p className="text-sm text-[var(--ink-soft)]">本次范围没有待学步骤。</p>}
      <Link href={studyHref} className="graph-start-learning">开始学习<ArrowRight size={18} /></Link>
    </section>
    <aside className="knowledge-desktop-inspector" aria-label="知识点详情">{selected ? <div className="knowledge-inspector">
      <div className="knowledge-inspector-main"><p className="concept-chapter">{selected.chapter}</p><div className="concept-detail-heading"><h2>{selected.name}</h2><span>{selected.mean === null ? "尚未测评" : LEARNING_STATUS_LABELS[selected.status]}</span></div>
        <p className="concept-summary">{selected.summary}</p>
        <div className="concept-prerequisites"><span>前置知识：</span>{selected.prerequisites.length ? selected.prerequisites.map(item => <button type="button" key={item} onClick={() => focus(item)}>{byId.get(item)?.name ?? item}</button>) : <span>无，可以从这里建立基础。</span>}</div>
        <details className="concept-evidence"><summary>作答证据与安排依据</summary><p>{selected.mean === null ? "尚无作答证据，未测评不代表不会。" : `当前估计 ${Math.round(selected.mean * 100)}% ±${Math.round((selected.sd ?? 0) * 100)}%，基于 ${selected.evidenceN} 条证据。`}</p><p>{selected.reason ?? (selected.status === "blocked" ? `先修知识尚未排入预算：${selected.blockedBy.map(item => byId.get(item)?.name ?? item).join("、")}。` : selected.status === "deferred" ? "本次预算不足，暂未安排。" : selected.status === "mastered" ? "现有作答证据达到学习阈值。" : selected.status === "removed" ? "已从本次清单手动移除，可重置顺序恢复。" : "当前目标范围内没有安排这一知识点。")}</p>{steps.some(step => step.kcId === selected.id) ? <button type="button" onClick={() => onLocate(selected.id)}>在清单中定位<ArrowRight size={15} /></button> : null}</details>
      </div>
      <div className="knowledge-actions"><Link href={studyHref} className="graph-start-learning">开始学习<ArrowRight size={17} /></Link><Link href={`/diagnose${queryPrefix}kc=${encodeURIComponent(selected.id)}`}>用一道题检查理解</Link><Link href={`${studyHref}&materials=1`}><BookOpen size={18} />阅读教材</Link></div>
    </div> : <p>当前方向还没有知识点。</p>}</aside>
    <footer className="knowledge-legend"><div><span><CircleDot size={16} className="text-[var(--warn)]" />本次学习</span><span><Circle size={16} />尚未测评</span><span><Check size={16} />有掌握证据</span><span><Circle size={16} strokeDasharray="3 2" />预算暂缓</span><span><Diamond size={15} />先修阻塞</span><span><svg width="18" height="6" viewBox="0 0 18 6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke="var(--warn)" strokeWidth="1.6" strokeDasharray="4 3" /></svg>阻塞来源</span></div><Hint label="沿箭头方向学习；选中知识点会高亮它的先修边，橙色虚线边指向被阻塞的知识点；拖动画布移动视野，使用按钮缩放。Tab 聚焦节点，Enter 选中。"><button type="button">操作说明</button></Hint></footer>
  </section>;
}
