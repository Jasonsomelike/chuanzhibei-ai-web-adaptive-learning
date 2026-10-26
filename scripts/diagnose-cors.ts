/**
 * 复现「HTTPS 页面 fetch HTTP 地址」的失败，确认根因。
 *
 * 在 https 页面里请求 http:// 地址，浏览器按 Mixed Content 规则
 * 直接在发出前拦截，抛 TypeError: Failed to fetch，耗时极短（几毫秒）。
 * 这与 CORS 错误的表面现象相同，但原因完全不同：
 *   - CORS：请求发出去了，服务器回了响应但缺少 Access-Control-Allow-Origin
 *   - Mixed Content：请求根本没发出，控制台会有专门的警告
 */

import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();

const consoleMessages: string[] = [];
page.on("console", (m) => consoleMessages.push(`[${m.type()}] ${m.text()}`));

// 用 https 页面做宿主
await page.goto("https://chuanzhibei-adaptive-learning.vercel.app/settings", {
  waitUntil: "domcontentloaded",
});

console.log("页面协议:", await page.evaluate(() => location.protocol));

// 复现：从 https 页面 fetch http:// 地址
const result = await page.evaluate(async () => {
  const started = performance.now();
  try {
    await fetch("http://1.92.81.144:8788/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
      body: JSON.stringify({ model: "x", messages: [] }),
    });
    return { ok: true, ms: Math.round(performance.now() - started), err: "" };
  } catch (e) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      err: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }
});

console.log("fetch 结果:", JSON.stringify(result, null, 2));
console.log("\n控制台消息:");
for (const m of consoleMessages.slice(-12)) console.log(" ", m);

await browser.close();
