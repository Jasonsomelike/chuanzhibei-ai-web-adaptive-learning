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

// 1b. 版本协商：支持列表内的旧版本回显客户端值，未知版本回落最新 2025-06-18
const legacyInit = await rpc("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
const legacyProtocol = (legacyInit.result as { protocolVersion?: string })?.protocolVersion;
const unknownInit = await rpc("initialize", {
  protocolVersion: "1999-01-01",
  capabilities: {},
  clientInfo: { name: "smoke", version: "0" },
});
const unknownProtocol = (unknownInit.result as { protocolVersion?: string })?.protocolVersion;
check(
  "initialize 按客户端版本协商（2024-11-05 回显 / 未知版本回落 2025-06-18）",
  legacyProtocol === "2024-11-05" && unknownProtocol === "2025-06-18",
  `${legacyProtocol} / ${unknownProtocol}`,
);

// 2. tools/list
const list = await rpc("tools/list");
const tools = (list.result as { tools?: { name: string }[] })?.tools ?? [];
const toolNames = tools.map((t) => t.name);
check(
  "tools/list 返回全部工具",
  tools.length === 5 && toolNames.includes("list_subjects"),
  toolNames.join(", "),
);

// 2b. 多学科：list_subjects
const subjectsCall = await rpc("tools/call", { name: "list_subjects", arguments: {} });
const subjectsData = JSON.parse(
  (subjectsCall.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "[]",
) as { id: string; concepts: number; edges: number; questions: number }[];
check(
  "list_subjects 返回全部学科且规模正确",
  subjectsData.length >= 9 &&
    subjectsData.every((s) => s.concepts === 40 && s.edges === 60 && s.questions === 120),
  subjectsData.map((s) => `${s.id}(${s.concepts}/${s.edges}/${s.questions})`).join(" "),
);

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
check(
  "resources/list 返回全学科资源（学科数 x 2）",
  resources.length >= 18 &&
    resources.some((r) => r.uri === "kg://network/graph") &&
    resources.some((r) => r.uri === "kg://python/questions"),
  `${resources.length} 个资源`,
);

const resRead = await rpc("resources/read", { uri: "kg://data-structures/graph" });
const graphText = (resRead.result as { contents?: { text?: string }[] })?.contents?.[0]?.text ?? "{}";
const graphData = JSON.parse(graphText) as { concepts?: unknown[]; edges?: unknown[] };
check(
  "resources/read 能读到完整图谱",
  graphData.concepts?.length === 40 && graphData.edges?.length === 60,
  `${graphData.concepts?.length} 点 / ${graphData.edges?.length} 边`,
);

// 7b. 跨学科资源读取
const osRead = await rpc("resources/read", { uri: "kg://os/graph" });
const osGraph = JSON.parse(
  (osRead.result as { contents?: { text?: string }[] })?.contents?.[0]?.text ?? "{}",
) as { version?: string; concepts?: unknown[] };
check(
  "能读取其他学科的资源",
  osGraph.version === "kg-os-v1" && osGraph.concepts?.length === 40,
  `${osGraph.version} / ${osGraph.concepts?.length} 点`,
);

// 7c. 跨学科 plan_path
const osPlan = await rpc("tools/call", {
  name: "plan_path",
  arguments: { subject: "os", budgetMinutes: 120 },
});
const osPlanData = JSON.parse(
  (osPlan.result as { content?: { text?: string }[] })?.content?.[0]?.text ?? "{}",
) as { subject?: string; pathHash?: string; steps?: { kcId: string }[] };
check(
  "plan_path 支持 subject 参数",
  osPlanData.subject === "os" &&
    typeof osPlanData.pathHash === "string" &&
    (osPlanData.steps?.[0]?.kcId ?? "").startsWith("o"),
  `${osPlanData.subject} / 首步 ${osPlanData.steps?.[0]?.kcId} / hash ${osPlanData.pathHash?.slice(0, 12)}`,
);

// 7d. 未知学科不再静默回落成 data-structures
const unknownSubjectPlan = await rpc("tools/call", {
  name: "plan_path",
  arguments: { subject: "operating-systems", budgetMinutes: 30 },
});
const unknownSubjectPrompt = await rpc("prompts/get", {
  name: "explain_path_step",
  arguments: { subject: "operating-systems", kcId: "o01", masteryMean: "0.4" },
});
check(
  "未知学科返回 -32602（tools/call 与 prompts/get）",
  unknownSubjectPlan.error?.code === -32602 &&
    unknownSubjectPlan.result === undefined &&
    unknownSubjectPrompt.error?.code === -32602,
  `plan=${unknownSubjectPlan.error?.code} prompt=${unknownSubjectPrompt.error?.code}`,
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
