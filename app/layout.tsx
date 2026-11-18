import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/app-shell";
import { THEMES } from "@/lib/themes";
import "@/components/direction-studio.css";
import "./globals.css";
import "./editorial.css";

export const metadata: Metadata = {
  title: "自适应学习路径 · 个性化学习规划",
  description:
    "诊断当前学习状态，按时间安排学习路径，结合教材向课程导师提问。支持 9 门课程、自定义学习方向与错题复习。",
};

export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#171b16" },
  ],
};

/**
 * 首屏防闪烁脚本。
 *
 * 必须在 CSS 绘制之前同步执行，否则深色用户会先看到一帧白色。
 * 所以这段脚本内联在 <head>，不用 next/script 的 defer。
 */
const themeInitScript = `
(function () {
  try {
    var storedTheme = localStorage.getItem('alp.theme');
    var theme = ${JSON.stringify(THEMES.map(t => t.id))}.includes(storedTheme) ? storedTheme : 'olive';
    var mode = localStorage.getItem('alp.mode');
    if (!['light', 'dark'].includes(mode)) mode = 'system';
    var resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = resolved;
    document.documentElement.dataset.colorPreference = mode;
    var layout = localStorage.getItem('alp.layout');
    document.documentElement.dataset.layout = ['paper','atlas','chapters'].includes(layout) ? layout : 'atlas';
    document.documentElement.dataset.reducedMotion = String(localStorage.getItem('alp.reducedMotion') === 'true');
  } catch (e) {
    document.documentElement.dataset.theme = 'olive';
    document.documentElement.dataset.mode = 'light';
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-theme="olive" data-mode="light" data-layout="atlas" data-reduced-motion="false" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-[var(--on-accent)]"
        >
          跳到主要内容
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
