// 可复现基准：拓扑排序 + 先修约束下的 ZPD 贪心路径 + Beta 掌握度更新
// 运行：node bench/bench-path.mjs
// 环境：Node 24.15.0 / Windows 10.0.26300 x64
// 说明：这是 JS 侧基准，用于替代 02-learning-theory.md §6 的 CPython 数字。
//       图规模与 06-synthesis.md §1.2 一致（40 概念 / 60 边），另跑 60 节点与 500 节点做对照。

const N_SMALL = 40, E_SMALL = 60;
const N_MID = 60, E_MID = 90;
const N_LARGE = 500, E_LARGE = 984;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 构造一个 DAG：节点 i 的边只指向 j>i，天然无环
function buildDag(n, m, seed) {
  const rnd = mulberry32(seed);
  const edges = [];
  const seen = new Set();
  while (edges.length < m) {
    const u = Math.floor(rnd() * (n - 1));
    const v = u + 1 + Math.floor(rnd() * Math.min(6, n - u - 1));
    if (v >= n) continue;
    const k = u * n + v;
    if (seen.has(k)) continue;
    seen.add(k);
    edges.push([u, v]);
  }
  const out = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  for (const [u, v] of edges) { out[u].push(v); indeg[v]++; }
  return { n, edges, out, indeg };
}

function topoSort(g) {
  const indeg = Int32Array.from(g.indeg);
  const q = [];
  for (let i = 0; i < g.n; i++) if (indeg[i] === 0) q.push(i);
  const order = [];
  for (let h = 0; h < q.length; h++) {
    const u = q[h]; order.push(u);
    for (const v of g.out[u]) if (--indeg[v] === 0) q.push(v);
  }
  if (order.length !== g.n) throw new Error("cycle detected");
  return order;
}

// 先修闭包（迭代，避免深递归）
function closureOf(g, targets) {
  const rev = Array.from({ length: g.n }, () => []);
  for (const [u, v] of g.edges) rev[v].push(u);
  const seen = new Uint8Array(g.n);
  const stack = [...targets];
  while (stack.length) {
    const v = stack.pop();
    for (const u of rev[v]) if (!seen[u]) { seen[u] = 1; stack.push(u); }
  }
  return seen;
}

// 先修约束下的 ZPD 贪心：只在「所有先修已掌握」的候选里选 |p-0.80| 最小者
function greedyPath(g, mastery, targetP = 0.8, maxSteps = 40) {
  const order = topoSort(g);
  const done = new Uint8Array(g.n);
  const ready = [];
  const indeg = Int32Array.from(g.indeg);
  for (let i = 0; i < g.n; i++) if (indeg[i] === 0) ready.push(i);
  const path = [];
  while (path.length < maxSteps && ready.length) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < ready.length; i++) {
      const d = Math.abs(mastery[ready[i]] - targetP);
      if (d < bestD) { bestD = d; best = i; }
    }
    const u = ready[best];
    ready[best] = ready[ready.length - 1]; ready.pop();
    path.push(u);
    for (const v of g.out[u]) if (--indeg[v] === 0) ready.push(v);
  }
  return path;
}

// 校验：路径内每条边的起点必须排在终点之前
function assertTopoRespected(g, path) {
  const pos = new Int32Array(g.n).fill(-1);
  path.forEach((u, i) => { pos[u] = i; });
  for (const [u, v] of g.edges) {
    if (pos[u] >= 0 && pos[v] >= 0 && pos[u] > pos[v]) {
      throw new Error(`prereq violated: ${u}->${v}`);
    }
  }
  return true;
}

// Beta 后验：均值与标准差
function betaUpdate(alpha, beta, correct) {
  if (correct) alpha += 1; else beta += 1;
  const mean = alpha / (alpha + beta);
  const varr = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
  return [alpha, beta, mean, Math.sqrt(varr)];
}

function bench(label, fn, reps) {
  for (let i = 0; i < Math.min(50, reps); i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < reps; i++) fn();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6 / reps;
  console.log(`${label.padEnd(46)} ${ms.toFixed(4)} ms/次  (${reps} 次)`);
  return ms;
}

const small = buildDag(N_SMALL, E_SMALL, 42);
const large = buildDag(N_LARGE, E_LARGE, 7);
const rnd = mulberry32(2026);
const mastery = Float64Array.from({ length: N_SMALL }, () => rnd());
const masteryLarge = Float64Array.from({ length: N_LARGE }, () => rnd());

console.log(`node ${process.version} / ${process.platform} ${process.arch}`);
console.log(`图 A：${N_SMALL} 节点 / ${E_SMALL} 边；图 B：${N_LARGE} 节点 / ${E_LARGE} 边`);
console.log("");

const tTopoSmall = bench(`拓扑排序 ${N_SMALL} 节点`, () => topoSort(small), 2000);
const tTopoLarge = bench(`拓扑排序 ${N_LARGE} 节点`, () => topoSort(large), 2000);
const tPathSmall = bench(`ZPD 贪心路径 ${N_SMALL} 节点 / 40 步`, () => greedyPath(small, mastery), 2000);
const tPathLarge = bench(`ZPD 贪心路径 ${N_LARGE} 节点 / 40 步`, () => greedyPath(large, masteryLarge), 500);
const tClosure = bench(`先修闭包 ${N_SMALL} 节点`, () => closureOf(small, [N_SMALL - 1]), 2000);

let a = 1.0, b = 1.0;
const tBeta = bench("Beta 掌握度更新（单次作答）", () => {
  [a, b] = betaUpdate(a, b, rnd() > 0.4).slice(0, 2);
}, 100000);

// 正确性断言
const p = greedyPath(small, mastery);
assertTopoRespected(small, p);
const pL = greedyPath(large, masteryLarge);
assertTopoRespected(large, pL);
console.log("");
console.log(`先修约束校验：${N_SMALL} 节点路径 ${p.length} 步、${N_LARGE} 节点路径 ${pL.length} 步，全部满足`);
console.log(`Beta 示例：alpha=6 beta=3 -> mean=${(6 / 9).toFixed(3)} sd=${Math.sqrt((6 * 3) / (81 * 10)).toFixed(3)}`);
console.log("");
console.log("汇总（写进 06 §3.2 的 JS 侧数字）：");
console.log(`  topo(${N_SMALL}) = ${tTopoSmall.toFixed(3)} ms | topo(${N_LARGE}) = ${tTopoLarge.toFixed(3)} ms`);
console.log(`  path(${N_SMALL}) = ${tPathSmall.toFixed(3)} ms | path(${N_LARGE}) = ${tPathLarge.toFixed(3)} ms`);
console.log(`  closure(${N_SMALL}) = ${tClosure.toFixed(3)} ms | betaUpdate = ${tBeta.toFixed(5)} ms`);
