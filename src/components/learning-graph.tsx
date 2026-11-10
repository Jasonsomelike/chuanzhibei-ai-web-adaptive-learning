"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, getNodesBounds, getViewportForBounds, type Node, type NodeChange, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon } from "@/components/icons";
import { AppDialog } from "@/components/primitives/dialog";
import { Hint } from "@/components/primitives/hint";
import { prefersReducedMotion } from "@/components/motion";
import { LEARNING_STATUS_LABELS, layoutLearningNodes, learningEdgeVisual, learningGraphFileName, learningGraphNodes, relatedLearningNodes, type LearningGraphNode } from "@/lib/learningGraph";
import type { KnowledgeGraph } from "@/lib/graph";
import type { MasteryState } from "@/lib/mastery";
import type { PathStep, PlanResult } from "@/lib/plan";

type ConceptNode = Node<{ concept: LearningGraphNode; added: boolean }, "concept">;
const Concept = memo(function Concept({ data, selected }: NodeProps<ConceptNode>) {
  const item = data.concept;
  return <div data-new-step={data.added || undefined} className={`knowledge-node node-${item.status} ${selected ? "node-selected" : ""}`}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <span className="block text-sm font-semibold">{item.name}</span>
    <span className="mt-1.5 flex items-center gap-1.5 text-[11px]"><span className="status-dot" />{item.order ? `${item.order} · ` : ""}{LEARNING_STATUS_LABELS[item.status]}{data.added ? " · 新增" : ""}{item.mean !== null ? <span className="node-mastery tabular">{Math.round(item.mean * 100)}%<span className="node-mastery-sd">±{Math.round((item.sd ?? 0) * 100)}</span></span> : null}</span>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </div>;
});
const nodeTypes = { concept: Concept };

/** 导出画布的固定尺寸：竖向章节列在 1600×1000 内足够放下一屏全科关系。 */
const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 1000;

export default function LearningGraph({ graph, mastery, plan, steps, query, selectedId, addedKcIds, targetName, onSelect, onLocate }: {
  graph: KnowledgeGraph; mastery: readonly MasteryState[]; plan: PlanResult; steps: readonly PathStep[]; query: string; selectedId: string | null; addedKcIds: readonly string[]; targetName: string; onSelect: (id: string) => void; onLocate: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [flow, setFlow] = useState<ReactFlowInstance<ConceptNode> | null>(null);
  const [dimensions, setDimensions] = useState<Record<string, { width: number; height: number }>>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
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
  const id = useId();
  const added = useMemo(() => new Set(addedKcIds), [addedKcIds]);
  const models = useMemo(() => learningGraphNodes(graph, mastery, plan, steps), [graph, mastery, plan, steps]);
  const selected = models.find(item => item.id === selectedId) ?? models.find(item => item.order === 1) ?? models[0];
  const related = useMemo(() => relatedLearningNodes(graph, steps), [graph, steps]);
  const selectedNodeId = selected?.id;
  const visibleModels = useMemo(() => layoutLearningNodes(models.filter(item => showAll || related.size === 0 || related.has(item.id) || item.id === selectedNodeId)), [models, showAll, related, selectedNodeId]);
  const byId = useMemo(() => new Map(models.map(item => [item.id, item])), [models]);
  // Controlled nodes must retain measured dimensions so React Flow preserves handle bounds.
  // Recreating unmeasured nodes after a resize can otherwise erase every edge without an error.
  const nodes = useMemo<ConceptNode[]>(() => visibleModels.map(item => ({ id: item.id, type: "concept", position: item.position, initialWidth: 210, initialHeight: 78, measured: dimensions[item.id], data: { concept: item, added: added.has(item.id) }, selected: item.id === selectedNodeId, draggable: false, ariaLabel: `${item.name}，${LEARNING_STATUS_LABELS[item.status]}${added.has(item.id) ? "，新增安排" : ""}，${item.evidenceN ? `${item.evidenceN} 条作答证据，当前估计约 ${Math.round(item.mean! * 100)}%` : "尚未测评"}` })), [visibleModels, dimensions, selectedNodeId, added]);
  const stepSignature = steps.map(step => step.kcId).join(",");
  useEffect(() => { if (flow) { const frame = requestAnimationFrame(() => { void flow.fitView({ padding: 0.14, maxZoom: 1, duration: prefersReducedMotion() ? 0 : 300 }); }); return () => cancelAnimationFrame(frame); } }, [flow, showAll, stepSignature]);
  const edges = useMemo(() => {
    const visible = new Set(visibleModels.map(item => item.id));
    const blockedTargets = new Set(visibleModels.filter(item => item.status === "blocked").map(item => item.id));
    const strokeVar = { accent: "var(--accent)", warn: "var(--warn)", plain: "var(--ink-faint)" } as const;
    return graph.edges.filter(edge => visible.has(edge.before) && visible.has(edge.after)).map(edge => {
      const visual = learningEdgeVisual(edge.before, edge.after, { selectedId: selectedNodeId, showAll, isBlockedTarget: id => blockedTargets.has(id) });
      const color = strokeVar[visual.tone];
      const label = `${byId.get(edge.before)?.name} 是 ${byId.get(edge.after)?.name} 的先修知识${visual.tone === "warn" ? "（阻塞来源）" : ""}`;
      return {
        id: `${edge.before}-${edge.after}`,
        source: edge.before,
        target: edge.after,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: visual.emphasized ? 2.2 : 1.3, opacity: visual.opacity, ...(visual.dashed ? { strokeDasharray: "6 4" } : {}) },
        ariaLabel: label,
      };
    });
  }, [graph, visibleModels, byId, selectedNodeId, showAll]);

  /**
   * 导出当前画布为 PNG。
   *
   * html-to-image 动态导入：不进首屏包。用固定尺寸 + getViewportForBounds
   * 重新取景，而不是截当前视野——导出的是完整图谱，与屏幕上的缩放无关。
   */
  const exportPng = useCallback(async () => {
    if (!flow || !canvasRef.current || visibleModels.length === 0 || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const [{ toPng }] = await Promise.all([import("html-to-image")]);
      const viewportElement = canvasRef.current.querySelector<HTMLElement>(".react-flow__viewport");
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
  const focus = (value: string) => {
    onSelect(value);
    const item = layoutLearningNodes(models.filter(item => showAll || related.has(item.id) || item.id === value)).find(item => item.id === value);
    if (item) void flow?.setCenter(item.position.x + 100, item.position.y + 40, { zoom: 1, duration: prefersReducedMotion() ? 0 : 300 });
  };
  useEffect(() => {
    if (!selectedId || !flow) return;
    const item = visibleModels.find(node => node.id === selectedId);
    if (!item) return;
    const frame = requestAnimationFrame(() => { void flow.setCenter(item.position.x + 105, item.position.y + 39, { zoom: 1, duration: prefersReducedMotion() ? 0 : 300 }); });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, flow, visibleModels]);
  const inspector = selected ? <div className="knowledge-inspector">
    <div className="knowledge-inspector-main">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold">{selected.name}</h3><span className={`node-label node-${selected.status}`}>{LEARNING_STATUS_LABELS[selected.status]}</span></div>
    <p className="mt-2 text-xs text-[var(--ink-faint)]">{selected.chapter}</p>
    <dl className="mt-5 space-y-5 text-sm">
      <div className="border-t border-[var(--line)] pt-4"><dt className="font-medium">当前状态</dt><dd className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{selected.mean === null ? "尚无作答证据，未测评不代表不会。" : `当前估计 ${Math.round(selected.mean * 100)}% ±${Math.round((selected.sd ?? 0) * 100)}%，基于 ${selected.evidenceN} 条证据；仍需结合后续练习确认。`}</dd></div>
      <div className="border-t border-[var(--line)] pt-4"><dt className="font-medium">为什么这样安排</dt><dd className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">{selected.reason ?? (selected.status === "blocked" ? `先修知识尚未排入预算：${selected.blockedBy.map(item => byId.get(item)?.name ?? item).join("、")}。` : selected.status === "deferred" ? "本次预算不足，暂未安排；增加预算可以查看是否排入。" : selected.status === "mastered" ? "现有作答证据达到学习阈值，可作为后续知识的基础。" : selected.status === "removed" ? "已从本次清单手动移除，可以重置顺序恢复算法安排。" : "当前目标范围内没有为本次安排这一知识点。")}</dd></div>
      <div className="border-t border-[var(--line)] pt-4"><dt className="font-medium">前置知识</dt><dd className="mt-2 flex flex-wrap gap-2">{selected.prerequisites.length ? selected.prerequisites.map(item => <button type="button" key={item} className="rounded-md border border-[var(--line)] px-2 py-1 text-xs text-[var(--accent)]" onClick={() => focus(item)}>{byId.get(item)?.name ?? item}</button>) : <span className="text-xs text-[var(--ink-soft)]">无，可以从这里建立基础。</span>}</dd></div>
    </dl>
    <p className="mt-5 text-xs leading-relaxed text-[var(--ink-faint)]">{selected.summary}</p>
    </div>
    <div className="knowledge-actions flex flex-wrap gap-2">{steps.some(step => step.kcId === selected.id) ? <button type="button" onClick={() => { setDetailsOpen(false); onLocate(selected.id); }} className="rounded-lg border border-[var(--line-strong)] px-3 py-2 text-xs text-[var(--accent)]">在清单中定位</button> : null}<Link className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-[var(--on-accent)]" href={`/diagnose${query}&kc=${encodeURIComponent(selected.id)}`}>开始练习</Link><Link className="rounded-lg border border-[var(--line-strong)] px-3 py-2 text-xs text-[var(--accent)]" href={`/tutor${query}&q=${encodeURIComponent(`请引导我理解${selected.name}，先给一个思考问题。`)}`}>询问导师</Link></div>
  </div> : <p className="p-5 text-sm">当前方向还没有知识点。</p>;

  return <section className="knowledge-workspace" aria-label="交互先修图谱">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><Icon name="graph" size={19} />先修图谱<span className="text-[11px] font-normal text-[var(--ink-faint)]">{visibleModels.length}/{models.length} 个知识点</span><a href="#learning-steps" className="ml-3 text-xs font-normal text-[var(--ink-faint)] underline">学习清单</a></div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void exportPng()} disabled={exporting || !flow || visibleModels.length === 0} title="把当前图谱导出为 PNG 图片" className="cursor-interaction rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-xs text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40">{exporting ? "导出中…" : "导出 PNG"}</button>
        <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} />全科关系</label>
        <label htmlFor={id} className="sr-only">定位知识点</label><select id={id} value={selected?.id ?? ""} onChange={event => focus(event.target.value)} className="max-w-48 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-xs">{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
    </div>
    {exportError !== null ? <p role="alert" className="border-b border-[var(--line)] px-4 py-2 text-xs text-[var(--bad)]">{exportError}</p> : null}
    {steps.length ? <section className="knowledge-path-outline" aria-label="本次学习顺序">
      <p>本次清单 · {steps.length} 步</p>
      <ol>{steps.map((step, index) => <li key={step.kcId}><button type="button" aria-pressed={selectedNodeId === step.kcId} onClick={() => focus(step.kcId)}><span className="tabular">{String(index + 1).padStart(2, "0")}</span><span>{byId.get(step.kcId)?.name ?? step.kcId}<small>{step.estMinutes} 分钟{added.has(step.kcId) ? " · 新增安排" : ""}</small></span></button></li>)}</ol>
    </section> : null}
    <div className="knowledge-layout">
      <div className="knowledge-canvas" ref={canvasRef} role="region" aria-label="可缩放的课程先修关系图">
        <ReactFlow<ConceptNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlow} onNodeClick={(_event, node) => { onSelect(node.id); if (window.matchMedia("(max-width: 1023px)").matches) setDetailsOpen(true); }} onNodesChange={onNodesChange} fitView fitViewOptions={{ padding: 0.14, maxZoom: 1 }} minZoom={0.2} maxZoom={1.5} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} panOnScroll={false} zoomOnScroll={false} preventScrolling={false} attributionPosition="bottom-right" ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "放大图谱", "controls.zoomOut.ariaLabel": "缩小图谱", "controls.fitView.ariaLabel": "查看完整图谱", "controls.interactive.ariaLabel": "切换图谱交互" }}>
          <Background color="var(--line-strong)" gap={20} size={0.7} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <aside className="knowledge-desktop-inspector" aria-label="知识点详情">{inspector}</aside>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-[var(--ink-faint)]">{(["planned", "mastered", "deferred", "blocked"] as const).map(status => <span key={status} className={`flex items-center gap-1.5 node-legend node-${status}`}><span className="status-dot" />{LEARNING_STATUS_LABELS[status]}</span>)}<span className="flex items-center gap-1.5 node-legend"><svg width="18" height="6" viewBox="0 0 18 6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke="var(--warn)" strokeWidth="1.6" strokeDasharray="4 3" /></svg>阻塞来源</span></div>
      <Hint label="拖动画布移动视野；选中知识点会高亮它的先修边，橙色虚线边指向被阻塞的知识点；使用左下角按钮缩放。Tab 聚焦知识点，Enter 选中。"><button type="button" className="text-[11px] text-[var(--ink-faint)] underline">操作说明</button></Hint>
    </div>
    <div className="knowledge-mobile-details"><AppDialog open={detailsOpen} onOpenChange={setDetailsOpen} drawer title="知识点详情" description="查看真实作答证据、先修条件与本次安排依据。" trigger={<button type="button" className="w-full border-t border-[var(--line)] px-4 py-3 text-left text-sm text-[var(--accent)]">查看「{selected?.name ?? "知识点"}」详情</button>}>{inspector}</AppDialog></div>
  </section>;
}
