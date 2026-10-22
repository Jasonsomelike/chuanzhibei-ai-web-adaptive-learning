/**
 * MCP 端点的真实协议测试。
 *
 * 不用 mock：直接向运行中的服务发 JSON-RPC 请求，
 * 验证三种原语（tools / resources / prompts）都能按 MCP 规范工作。
 *
 * 用法：BASE_URL=http://127.0.0.1:3211 npx tsx scripts/mcp-smoke.ts
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3211";
const ENDPOINT = `${BASE}/api/mcp`;

export {};

interface RpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

let seq = 1;

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: seq++, method, params }),
  });
  return (await res.json()) as RpcResponse;
}

const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

// 1. initialize
const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
const initResult = init.result as {
  protocolVersion?: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: { name?: string };
};
check(
  "initialize 返回协议版本与服务信息",
  initResult?.protocolVersion === "2025-06-18" && initResult?.serverInfo?.name === "adaptive-learning-path",
  `${initResult?.protocolVersion} / ${initResult?.serverInfo?.name}`,
);
check(
  "声明三种原语能力",
  Boolean(initResult?.capabilities?.tools) &&
    Boolean(initResult?.capabilities?.resources) &&
    Boolean(initResult?.capabilities?.prompts),
  Object.keys(initResult?.capabilities ?? {}).join(", "),
);

// 2. tools/list
const list = await rpc("tools/list");
const tools = (list.result as { tools?: { name: string }[] })?.tools ?? [];
check("tools/list 返回 4 个工具", tools.length === 4, tools.map((t) => t.name).join(", "));

// 3. tools/call: plan_path
const planCall = await rpc("tools/call", {
  name: "plan_path",
  arguments: { budgetMinutes: 120 },
});
const planText = (planCall.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "{}";
const planData = JSON.parse(planText) as { pathHash?: string; steps?: unknown[] };
check(
  "tools/call plan_path 返回路径与指纹",
  typeof planData.pathHash === "string" && planData.pathHash.length === 64,
  `hash=${planData.pathHash?.slice(0, 16)}… steps=${planData.steps?.length}`,
);

// 4. 复现性：同参数两次调用 hash 必须一致
const planAgain = await rpc("tools/call", {
  name: "plan_path",
  arguments: { budgetMinutes: 120 },
});
const againData = JSON.parse(
  (planAgain.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "{}",
) as { pathHash?: string };
check(
  "同参数两次调用指纹一致（可复现）",
  planData.pathHash === againData.pathHash,
  `${planData.pathHash?.slice(0, 12)} == ${againData.pathHash?.slice(0, 12)}`,
);

// 5. tools/call: search_knowledge
const searchCall = await rpc("tools/call", {
  name: "search_knowledge",
  arguments: { query: "快速排序", topK: 3 },
});
const searchData = JSON.parse(
  (searchCall.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "[]",
) as { kcId: string; title: string }[];
check(
  "tools/call search_knowledge 返回带 kcId 的结果",
  searchData.length > 0 && /^c\d+$/.test(searchData[0].kcId),
  searchData.map((d) => `${d.kcId}:${d.title}`).join(", "),
);

// 6. tools/call: get_prerequisites
const prereqCall = await rpc("tools/call", {
  name: "get_prerequisites",
  arguments: { kcId: "c40" },
});
const prereqData = JSON.parse(
  (prereqCall.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "{}",
) as { prerequisites?: unknown[] };
check(
  "tools/call get_prerequisites 返回闭包",
  (prereqData.prerequisites?.length ?? 0) > 5,
  `${prereqData.prerequisites?.length} 个先修`,
);

// 7. resources
const resList = await rpc("resources/list");
const resources = (resList.result as { resources?: { uri: string }[] })?.resources ?? [];
check("resources/list 返回 2 个资源", resources.length === 2, resources.map((r) => r.uri).join(", "));

const resRead = await rpc("resources/read", { uri: "kg://data-structures/graph" });
const graphText = (resRead.result as { contents?: { text?: string }[] })?.contents?.[0]?.text ?? "{}";
const graphData = JSON.parse(graphText) as { concepts?: unknown[]; edges?: unknown[] };
check(
  "resources/read 能读到完整图谱",
  graphData.concepts?.length === 40 && graphData.edges?.length === 60,
  `${graphData.concepts?.length} 点 / ${graphData.edges?.length} 边`,
);

// 8. prompts
const promptsList = await rpc("prompts/list");
const prompts = (promptsList.result as { prompts?: { name: string }[] })?.prompts ?? [];
check("prompts/list 返回 2 个模板", prompts.length === 2, prompts.map((p) => p.name).join(", "));

const promptGet = await rpc("prompts/get", {
  name: "explain_path_step",
  arguments: { kcId: "c09", masteryMean: "0.68" },
});
const promptMessages = (promptGet.result as { messages?: { content?: { text?: string } }[] })
  ?.messages;
check(
  "prompts/get 生成带参数的提示",
  (promptMessages?.[0]?.content?.text ?? "").includes("0.68"),
  promptMessages?.[0]?.content?.text?.slice(0, 50) ?? "无内容",
);

// 9. 错误处理
const badMethod = await rpc("nonexistent/method");
check(
  "未知方法返回 -32601",
  badMethod.error?.code === -32601,
  `code=${badMethod.error?.code}`,
);

const badTool = await rpc("tools/call", { name: "no_such_tool", arguments: {} });
check(
  "未知工具返回错误而非崩溃",
  typeof badTool.error?.code === "number",
  `code=${badTool.error?.code}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exit(1);
