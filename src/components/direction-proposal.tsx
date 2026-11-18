"use client";
import { useMemo, useState } from "react";
import { Graph, layout } from "@dagrejs/dagre";
import { Controls, MarkerType, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MAX_TITLE_LENGTH, type DirectionDraft } from "@/lib/direction";
import type { PlanSource } from "@/lib/directionPlanner";
import { topologicalOrder } from "@/lib/graph";

export function DirectionProposal({ draft, title, setTitle, references, sources }: {
  references?: Record<string, number[]>; sources?: PlanSource[];
  draft: DirectionDraft; title: string; setTitle: (value: string) => void;
}) {
  const [selected, select] = useState("");
  const { nodes, edges, ordered } = useMemo(() => {
    const g = new Graph().setGraph({ rankdir: "TB", ranksep: 44, nodesep: 24 }).setDefaultEdgeLabel(() => ({}));
    for (const c of draft.concepts) g.setNode(c.id, { width: 154, height: 52 });
    for (const e of draft.edges) g.setEdge(e.before, e.after);
    layout(g);
    const nodes = draft.concepts.map(c => ({ id: c.id, type: "default", data: { label: c.name },
      position: { x: g.node(c.id).x - 77, y: g.node(c.id).y - 26 }, sourcePosition: Position.Bottom,
      targetPosition: Position.Top, style: { width: 154, height: 52 } }));
    const edges = draft.edges.map(e => ({ id: e.before + "-" + e.after, source: e.before, target: e.after,
      markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent)" }, style: { stroke: "var(--accent)" } }));
    const order = topologicalOrder({ version: "draft", concepts: draft.concepts.map(c => ({ ...c, chapter: c.chapter ?? "" })), edges: draft.edges });
    return { nodes, edges, ordered: order.map(id => draft.concepts.find(c => c.id === id)!) };
  }, [draft]);
  const current = ordered.find(c => c.id === selected) ?? ordered[0];
  const basis = (references?.[current.id] ?? []).map(n => sources?.[n - 1]).filter(s => !!s);
  const parents = draft.edges.filter(e => e.after === current.id).map(e => ordered.find(c => c.id === e.before)!.name);
  return <section className="direction-proposal">
    <label>方向名<input aria-label="方向名" maxLength={MAX_TITLE_LENGTH} value={title} onChange={e => setTitle(e.target.value)} /></label>
    <p>{draft.description}</p>
    <h4>先修图谱 <small>{nodes.length} 个知识点 · {edges.length} 条关系</small></h4>
    <div className="direction-map" aria-label="先修图谱">
      <ReactFlow key={JSON.stringify(nodes.map(n => [n.id, n.position]))} nodes={nodes.map(n => ({ ...n, selected: n.id === current.id }))} edges={edges}
        nodesDraggable={false} nodesConnectable={false} fitView minZoom={0.12} maxZoom={2}
        zoomOnScroll={false} preventScrolling={false} onNodeClick={(_, node) => select(node.id)}>
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
    <div className="direction-node-detail" aria-live="polite"><strong>{current.name}</strong><p>{current.summary}</p>
      <small>{parents.length ? "先学 " + parents.join("、") : "可以从这里开始"}</small>
      {basis.length > 0 && <details><summary>本知识点的依据 · {basis.length} 处</summary>
        {basis.map((s, i) => <blockquote key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}<p>{s.excerpt}</p></blockquote>)}</details>}</div>
    <details className="direction-sequence"><summary>学习流程 · 按先修顺序</summary><ol>
      {ordered.map(c => <li key={c.id}><button type="button" onClick={() => select(c.id)} aria-pressed={current.id === c.id}>
        {c.chapter && <small>{c.chapter} · </small>}{c.name}</button><p>{c.summary}</p></li>)}
    </ol></details>
  </section>;
}
