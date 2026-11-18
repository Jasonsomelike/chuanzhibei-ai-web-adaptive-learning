import { Graph, layout } from "@dagrejs/dagre";
import type { LearningGraphNode } from "./learningGraph";

export type GraphDirection = "horizontal" | "vertical" | "compact";
export type GraphPoint = { x: number; y: number };
export const learningNodeSize = (direction: GraphDirection) => ({ width: direction === "compact" ? 168 : 206, height: 76 });

/** Stable input ordering gives stable ranks even when search/filter returns a different order. */
export function arrangeLearningNodes(nodes: readonly LearningGraphNode[], direction: GraphDirection): LearningGraphNode[] {
  if (!nodes.length) return [];
  const size = learningNodeSize(direction);
  const graph = new Graph().setGraph({ rankdir: direction === "horizontal" ? "LR" : "TB", ranksep: direction === "horizontal" ? 88 : 58, nodesep: 28, edgesep: 18, marginx: 16, marginy: 16 }).setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map(n => n.id));
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (const node of sorted) graph.setNode(node.id, { ...size });
  for (const node of sorted) for (const before of [...node.prerequisites].sort()) if (ids.has(before)) graph.setEdge(before, node.id);
  layout(graph);
  return nodes.map(node => { const point = graph.node(node.id); return { ...node, position: { x: point.x - size.width / 2, y: point.y - size.height / 2 } }; });
}

export type GraphRect = GraphPoint & { width: number; height: number };

/** A cubic stays inside its control points' bounding box. Use the clear gap
 * between ranks when possible, otherwise soften the obstacle router's bends. */
export function learningEdgePath(points: readonly GraphPoint[], obstacles: readonly GraphRect[], direction: GraphDirection): string {
  if (points.length < 2) return "";
  const from = points[0], to = points[points.length - 1];
  const xy = (p: GraphPoint) => `${p.x},${p.y}`;
  const horizontal = direction === "horizontal";
  const forward = horizontal ? to.x > from.x : to.y > from.y;
  let path = `M${xy(from)}`;
  if (forward) {
    const mid = horizontal ? (from.x + to.x) / 2 : (from.y + to.y) / 2;
    const c1 = horizontal ? { x: mid, y: from.y } : { x: from.x, y: mid };
    const c2 = horizontal ? { x: mid, y: to.y } : { x: to.x, y: mid };
    const overlaps = (a: GraphPoint, b: GraphPoint, box: GraphRect, pad: number) =>
      box.x - pad < Math.max(a.x, b.x) && box.x + box.width + pad > Math.min(a.x, b.x) &&
      box.y - pad < Math.max(a.y, b.y) && box.y + box.height + pad > Math.min(a.y, b.y);
    const nearby = obstacles.filter(box => overlaps(from, to, box, 0));
    // Both coordinates are monotone, so each subcurve lies inside its two
    // endpoints' rectangle. This also admits clear curves spanning several ranks.
    let previous = from, clear = true;
    for (let i = 1; nearby.length && clear && i <= 16; i++) {
      const t = i / 16, u = 1 - t;
      const coord = (k: keyof GraphPoint) => u ** 3 * from[k] + 3 * u ** 2 * t * c1[k] + 3 * u * t ** 2 * c2[k] + t ** 3 * to[k];
      const next = { x: coord("x"), y: coord("y") };
      clear = !nearby.some(box => overlaps(previous, next, box, 5));
      previous = next;
    }
    if (clear) return `${path} C${xy(c1)} ${xy(c2)} ${xy(to)}`;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1];
    // Stay within the router's 12px obstacle clearance even on tight corners.
    const trim = Math.min(10, Math.hypot(a.x - b.x, a.y - b.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const toward = (p: GraphPoint) => ({ x: b.x + Math.sign(p.x - b.x) * trim, y: b.y + Math.sign(p.y - b.y) * trim });
    path += ` L${xy(toward(a))} Q${xy(b)} ${xy(toward(c))}`;
  }
  return `${path} L${xy(to)}`;
}
/** Open-interior intersection: travelling on the padded boundary is safe. */
export function segmentCrossesRect(a: GraphPoint, b: GraphPoint, rect: GraphRect): boolean {
  if (a.x === b.x) return a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height;
  if (a.y === b.y) return a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
  throw new Error("Graph routes must be orthogonal");
}

/** Orthogonal visibility grid around padded node boxes. No line crosses a label,
 * including long edges that skip several ranks. Does not alter prerequisite data. */
export function routeLearningEdges(nodes: readonly LearningGraphNode[], direction: GraphDirection): Map<string, GraphPoint[]> {
  const size = learningNodeSize(direction), pad = 12, vertical = direction !== "horizontal";
  const byId = new Map(nodes.map(n => [n.id, n]));
  const boxes = nodes.map(n => ({ x: n.position.x - pad, y: n.position.y - pad, width: size.width + 2 * pad, height: size.height + 2 * pad }));
  const sorted = (values: number[]) => [...new Set(values)].sort((a,b) => a-b);
  const xs = sorted(nodes.flatMap(n => [n.position.x - pad, n.position.x + size.width / 2, n.position.x + size.width + pad]));
  const ys = sorted(nodes.flatMap(n => [n.position.y - pad, n.position.y + size.height / 2, n.position.y + size.height + pad]));
  const point = (id: number): GraphPoint => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
  const index = (p: GraphPoint) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
  const adjacency = new Map<number, { id: number; cost: number }[]>();
  const neighbors = (id: number) => {
    const cached = adjacency.get(id); if (cached) return cached;
    const x = id % xs.length, y = Math.floor(id / xs.length), start = point(id);
    const candidates = [x > 0 ? id - 1 : -1, x < xs.length - 1 ? id + 1 : -1, y > 0 ? id - xs.length : -1, y < ys.length - 1 ? id + xs.length : -1];
    const result = candidates.filter(n => n >= 0 && !boxes.some(box => segmentCrossesRect(start, point(n), box))).map(n => ({ id: n, cost: Math.abs(start.x - point(n).x) + Math.abs(start.y - point(n).y) }));
    adjacency.set(id, result); return result;
  };
  const routes = new Map<string, GraphPoint[]>();
  for (const target of nodes) for (const sourceId of target.prerequisites) {
    const source = byId.get(sourceId); if (!source) continue;
    const from = vertical ? { x: source.position.x + size.width / 2, y: source.position.y + size.height } : { x: source.position.x + size.width, y: source.position.y + size.height / 2 };
    const to = vertical ? { x: target.position.x + size.width / 2, y: target.position.y } : { x: target.position.x, y: target.position.y + size.height / 2 };
    const start = index(vertical ? { x: from.x, y: from.y + pad } : { x: from.x + pad, y: from.y });
    const end = index(vertical ? { x: to.x, y: to.y - pad } : { x: to.x - pad, y: to.y });
    const distance = new Map([[start, 0]]), previous = new Map<number, number>(), open = new Set([start]);
    const goal = point(end);
    while (open.size) {
      let current = -1, best = Infinity;
      for (const id of open) { const p = point(id); const score = distance.get(id)! + Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y); if (score < best) { current = id; best = score; } }
      open.delete(current);
      if (current === end) break;
      for (const next of neighbors(current)) {
        const cost = distance.get(current)! + next.cost;
        if (cost >= (distance.get(next.id) ?? Infinity)) continue;
        distance.set(next.id, cost); previous.set(next.id, current); open.add(next.id);
      }
    }
    if (!distance.has(end)) throw new Error(`No safe route for ${sourceId} → ${target.id}`);
    const points = [point(end)];
    for (let id = end; id !== start;) { id = previous.get(id)!; points.unshift(point(id)); }
    const raw = [from, ...points, to];
    routes.set(`${sourceId}-${target.id}`, raw.filter((p, i) => i === 0 || i === raw.length - 1 || !(raw[i-1].x === p.x && p.x === raw[i+1].x || raw[i-1].y === p.y && p.y === raw[i+1].y)));
  }
  return routes;
}
