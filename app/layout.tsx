import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "可解释的自适应学习路径 · 数据结构",
  description:
    "掌握度用难度加权 Beta 后验建模，路径由纯函数算出、可逐位复现，LLM 只解释不排序。传智杯 AI WEB 网页开发挑战赛作品。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-[var(--color-accent)] focus:px-4 focus:py-2 focus:text-white"
        >
          跳到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
