import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const folder = fileURLToPath(
  new URL(
    "../out/recut/" +
      (process.env.NATIVE_DETAIL === "1" ? "live-hd/" : "live/"),
    import.meta.url,
  ),
);
export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function installPointer(ctx) {
  await ctx.addInitScript(() => {
    addEventListener(
      "DOMContentLoaded",
      () => {
        if (innerWidth >= 2200 || (innerWidth >= 680 && innerWidth < 700))
          document.body.style.zoom = "1.6";
        const host = document.createElement("div");
        host.style.cssText =
          "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden";
        document.documentElement.append(host);
        const shadow = host.attachShadow({ mode: "closed" });
        shadow.innerHTML =
          '<style>svg{position:absolute;left:0;top:0;width:24px;height:31px;filter:drop-shadow(0 2px 2px #252b2055);transition:transform .40s cubic-bezier(.2,.65,.25,1);visibility:hidden}.ring{position:absolute;width:18px;height:18px;margin:-10px;border:2px solid #c27825;background:#e9b76044;border-radius:50%;animation:ping .58s ease-out forwards}@keyframes ping{to{transform:scale(2.8);opacity:0}}</style><svg viewBox="0 0 26 34"><path d="M2 2 22 18 13 19 18 29 13 32 8 21 2 26Z" fill="#263e37" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>';
        const arrow = shadow.querySelector("svg");
        addEventListener(
          "pointermove",
          (e) => {
            arrow.style.visibility = "visible";
            arrow.style.transform =
              "translate(" + e.clientX + "px," + e.clientY + "px)";
          },
          true,
        );
        addEventListener(
          "pointerdown",
          (e) => {
            const ring = document.createElement("i");
            ring.className = "ring";
            ring.style.left = e.clientX + "px";
            ring.style.top = e.clientY + "px";
            shadow.append(ring);
            setTimeout(() => ring.remove(), 650);
          },
          true,
        );
      },
      { once: true },
    );
  });
}
export async function take(page, name, seconds, action) {
  await fs.mkdir(folder, { recursive: true });
  const view = page.viewportSize();
  const pixelRatio = await page.evaluate(() => devicePixelRatio);
  const size = {
    width: Math.round(view.width * pixelRatio),
    height: Math.round(view.height * pixelRatio),
  };
  const output = path.join(folder, name + ".webm");
  const partial = path.join(folder, name + ".recording.webm");
  const cues = [];
  let swaps = 0,
    firstBytes = 0;
  await page.screencast.start({
    path: partial,
    size,
    quality: 98,
    fps: 60,
    onFrame: ({ data }) => {
      swaps++;
      if (!firstBytes) firstBytes = data.length;
    },
  });
  const start = performance.now();
  const time = () => (performance.now() - start) / 1000;
  const at = (sec) => pause(Math.max(0, (sec - time()) * 1000));
  async function focus(loc, zoom = 1.5) {
    await loc.scrollIntoViewIfNeeded();
    await pause(120);
    const b = await loc.boundingBox();
    if (!b) throw Error("Focus target hidden in " + name);
    cues.push({
      t: +time().toFixed(2),
      x: (b.x + b.width / 2) / view.width,
      y: (b.y + b.height / 2) / view.height,
      z: zoom,
    });
  }
  async function click(loc, zoom = 1.5) {
    await focus(loc, zoom);
    await loc.hover();
    await pause(540);
    await loc.click();
  }
  function wide() {
    cues.push({ t: +time().toFixed(2), x: 0.5, y: 0.5, z: 1 });
  }
  try {
    await action({ at, click, focus, wide, time });
    await at(seconds + 0.25);
  } finally {
    await page.screencast.stop();
  }
  await fs.rename(partial, output);
  await fs.writeFile(
    path.join(folder, name + ".json"),
    JSON.stringify({ view, size, cues, swaps, firstBytes }, null, 2),
  );
  console.log(name, "录毕", swaps, "次浏览器画面更新", size);
}
