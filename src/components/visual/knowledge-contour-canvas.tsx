"use client";

import { useEffect, useRef } from "react";

// A fixed, decorative motif from the V3 reference, independent of learner data.
const POINTS = [[0.52, 0.76], [0.69, 0.47], [0.83, 0.62], [0.94, 0.33], [0.63, 0.23], [0.97, 0.81], [0.81, 0.13]] as const;
const EDGES = [[0, 1], [1, 2], [1, 3], [4, 1], [2, 5], [4, 6]] as const;
const FRAME_INTERVAL = 1000 / 30;

/** Nonessential illustration: all learning information and controls remain in HTML. */
export default function KnowledgeContourCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null;
    try { context = canvas.getContext("2d"); } catch { return; }
    if (!context) return;
    const ctx = context;
    const backdrop = document.createElement("canvas");
    const background = backdrop.getContext("2d");
    if (!background) return;
    const ink = background;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const lowPower = Boolean(connection?.saveData) || (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 2);
    let visible = false;
    let frame: number | null = null;
    let last = 0;
    let width = 1;
    let height = 1;
    let accent = "";
    let ratio = 1;

    function draw(time = 0) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(backdrop, 0, 0, width, height);
      if (!time) return;
      // Follow the same cubic curve as the visible edge, rather than cutting across it.
      const t = (time % 6000) / 6000;
      const u = 1 - t;
      const [a, b] = POINTS;
      const middle = (a[0] + b[0]) / 2;
      const x = (u ** 3 * a[0] + 3 * u * u * t * middle + 3 * u * t * t * middle + t ** 3 * b[0]) * width;
      const y = (u ** 3 * a[1] + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t ** 3 * b[1]) * height;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = accent; ctx.fill();
    }
    function stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
    function tick(time: number) {
      frame = null;
      if (!visible || document.hidden || motion.matches || lowPower) return;
      const elapsed = time - last;
      if (elapsed >= FRAME_INTERVAL) { last = time - elapsed % FRAME_INTERVAL; draw(time); }
      frame = requestAnimationFrame(tick);
    }
    function start() {
      if (visible && !document.hidden && !motion.matches && !lowPower && frame === null) frame = requestAnimationFrame(tick);
    }
    function refresh() {
      const rect = canvas!.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = backdrop.width = Math.round(width * ratio);
      canvas!.height = backdrop.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ink.setTransform(ratio, 0, 0, ratio, 0, 0);
      const style = getComputedStyle(document.documentElement);
      accent = style.getPropertyValue("--accent").trim();
      const line = style.getPropertyValue("--line-strong").trim();
      // Cache the static artwork; animation redraws only the bitmap and one marker.
      for (let row = 0; row < 6; row++) {
        ink.beginPath();
        for (let x = 0; x <= width; x += 4) {
          const y = height * (0.14 + row * 0.14) + Math.sin(x * 0.008 + row * 0.64) * 10;
          if (!x) ink.moveTo(x, y); else ink.lineTo(x, y);
        }
        ink.globalAlpha = 0.1; ink.strokeStyle = line; ink.lineWidth = 1; ink.stroke();
      }
      EDGES.forEach(([from, to], index) => {
        const a = POINTS[from]; const b = POINTS[to]; const middle = (a[0] + b[0]) / 2 * width;
        ink.beginPath(); ink.moveTo(a[0] * width, a[1] * height);
        ink.bezierCurveTo(middle, a[1] * height, middle, b[1] * height, b[0] * width, b[1] * height);
        ink.globalAlpha = index < 3 ? 0.3 : 0.18;
        ink.strokeStyle = index < 3 ? accent : line; ink.lineWidth = index < 3 ? 1.5 : 1; ink.stroke();
      });
      POINTS.forEach(([x, y], index) => {
        ink.beginPath(); ink.arc(x * width, y * height, index === 1 ? 6 : 3.5, 0, Math.PI * 2);
        ink.globalAlpha = index === 1 ? 0.75 : 0.4; ink.fillStyle = index === 1 ? accent : line; ink.fill();
        if (index === 1) {
          ink.beginPath(); ink.arc(x * width, y * height, 16, 0, Math.PI * 2);
          ink.globalAlpha = 0.08; ink.strokeStyle = accent; ink.lineWidth = 7; ink.stroke();
        }
      });
      ink.globalAlpha = 1;
      draw(); start();
    }
    function updateMotion() { stop(); draw(); start(); }
    function updateVisibility() { if (document.hidden) stop(); else start(); }
    const resize = new ResizeObserver(refresh);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start(); else stop();
    }, { threshold: 0.02 });
    const theme = new MutationObserver(refresh);
    resize.observe(canvas); intersection.observe(canvas);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode"] });
    document.addEventListener("visibilitychange", updateVisibility);
    motion.addEventListener("change", updateMotion);
    refresh();
    return () => {
      stop(); resize.disconnect(); intersection.disconnect(); theme.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
      motion.removeEventListener("change", updateMotion);
    };
  }, []);
  return <canvas ref={ref} data-knowledge-contour aria-hidden="true" className="knowledge-contour" />;
}
