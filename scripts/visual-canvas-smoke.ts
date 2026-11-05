import type { Page } from "playwright";

type Capture = Window & { __contourFrames: number[]; __contourDrawCosts: number[] };

/** Instrument the decorative canvas only, without adding production diagnostics. */
export async function instrumentContour(page: Page) {
  await page.addInitScript(() => {
    const capture = window as unknown as Capture;
    capture.__contourFrames = []; capture.__contourDrawCosts = [];
    const originalClear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.hasAttribute("data-knowledge-contour")) capture.__contourFrames.push(performance.now());
      return originalClear.apply(this, args);
    };
    const originalDraw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: unknown[]) {
      const start = performance.now();
      Reflect.apply(originalDraw, this, args);
      if (this.canvas.hasAttribute("data-knowledge-contour")) capture.__contourDrawCosts.push(performance.now() - start);
    };
  });
}

export async function auditContour(page: Page, check: (condition: unknown, name: string) => void) {
  const canvas = page.locator("canvas[data-knowledge-contour]");
  await canvas.waitFor();
  const attributes = await canvas.evaluate(el => ({ hidden: el.getAttribute("aria-hidden"), pointer: getComputedStyle(el).pointerEvents, ratio: (el as HTMLCanvasElement).width / el.getBoundingClientRect().width }));
  check(attributes.hidden === "true" && attributes.pointer === "none", "Canvas 不进入无障碍树且不拦截点击");
  check(attributes.ratio <= 2.01, "Canvas 采样率不超过 DPR 2");
  const frameCount = () => page.evaluate(() => (window as unknown as Capture).__contourFrames.length);
  const staticFrames = await frameCount();
  await page.waitForTimeout(300);
  check(await frameCount() === staticFrames, "减少动态效果时 Canvas 保持静态");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => (window as unknown as Capture).__contourFrames.length > 5);
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.evaluate(() => { const capture = window as unknown as Capture; capture.__contourFrames = []; capture.__contourDrawCosts = []; });
  await page.waitForTimeout(2000);
  const metrics = await page.evaluate(() => {
    const capture = window as unknown as Capture;
    const samples = capture.__contourFrames;
    const span = (samples.at(-1) ?? 0) - (samples[0] ?? 0);
    return { frames: samples.length, fps: span > 0 ? (samples.length - 1) * 1000 / span : 0, maxBitmapCopyMs: Math.max(0, ...capture.__contourDrawCosts) };
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await session.detach();
  check(metrics.frames >= 10 && metrics.fps <= 33, "6 倍 CPU 降速下装饰画布可运行且帧率受限");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => document.querySelector("canvas[data-knowledge-contour]")!.getBoundingClientRect().bottom < 0);
  await page.waitForTimeout(120);
  const offscreenFrames = await frameCount();
  await page.waitForTimeout(300);
  check(await frameCount() === offscreenFrames, "Canvas 离开视口后停止绘制");
  const beforeReduction = await frameCount();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(before => matchMedia("(prefers-reduced-motion: reduce)").matches && (window as unknown as Capture).__contourFrames.length > before, beforeReduction);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => document.querySelector("canvas[data-knowledge-contour]")!.getBoundingClientRect().top >= 0);
  const restoredFrames = await frameCount();
  await page.waitForTimeout(300);
  check(await frameCount() === restoredFrames, "重新进入视口仍遵守减少动态效果");
  return { ...metrics, environment: "Chromium, 6x CPU throttling; not a physical low-end device", samplingMs: 2000 };
}
