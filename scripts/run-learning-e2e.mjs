/** 启动独立生产测试服务，强制内存库和临时主密钥，绝不继承 .env.local 的数据库。 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.ALP_E2E_PORT ?? 3218);
const mockPort = Number(process.env.ALP_E2E_MOCK_PORT ?? (port === 65535 ? 65534 : port + 1));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("非法 E2E 端口");
if (!Number.isInteger(mockPort) || mockPort < 1024 || mockPort > 65535 || mockPort === port) throw new Error("非法模型测试端口");
if (!existsSync(".next/BUILD_ID")) throw new Error("请先执行 npm run build，再运行 npm run test:e2e");
const occupied = await new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port });
  socket.once("connect", () => { socket.destroy(); resolve(true); });
  socket.once("error", () => resolve(false));
});
if (occupied) throw new Error(`端口 ${port} 已被占用，请关闭该开发服务或设置 ALP_E2E_PORT`);
const env = { ...process.env, DATABASE_URL: "", ALP_SECRET_KEY: randomBytes(32).toString("base64"),
  ALP_ALLOW_MEMORY_SECRETS: "1", ALP_ALLOW_HTTP_PROVIDER_HOSTS: `127.0.0.1:${mockPort}`,
  ALP_E2E_MOCK_PORT: String(mockPort),
  ALP_EMBED_BASE_URL: "", ALP_EMBED_API_KEY: "", ALP_EMBED_MODEL: "", NEXT_TELEMETRY_DISABLED: "1",
  BASE_URL: `http://localhost:${port}` };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port)], { env, stdio: "inherit", windowsHide: true });
let child;
async function stopServer() {
  if (server.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => spawn("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).once("close", resolve));
  } else server.kill("SIGTERM");
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error("隔离测试服务提前退出");
    try { const response = await fetch(env.BASE_URL, { signal: AbortSignal.timeout(2000) }); if (response.ok) { ready = true; break; } } catch { /* 服务尚未监听 */ }
    await delay(250);
  }
  if (!ready) throw new Error("隔离测试服务启动超时");
  for (const script of ["scripts/learning-smoke.ts", "scripts/editorial-smoke.ts", "scripts/conversation-smoke.ts", "scripts/conversation-ui-smoke.ts", "scripts/auth-smoke.ts", "scripts/mcp-smoke.ts", "scripts/document-smoke.ts", "scripts/workspace-smoke.ts"]) {
    child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], { env, stdio: "inherit", windowsHide: true });
    const code = await new Promise((resolve) => child.once("exit", (value) => resolve(value ?? 1)));
    if (code !== 0) { process.exitCode = code; break; }
  }
} finally { await stopServer(); }
