/**
 * 主题常量。
 *
 * 单独成文件是因为它要被服务端组件（关于页）和客户端组件（设置页）同时引用，
 * 而 theme.ts 带 "use client" 指令，服务端组件不能从那里导入值。
 */

export const THEMES = [
  { id: "sand", name: "暖砂", note: "暖纸底，沉稳阅读" },
  { id: "forest", name: "森林", note: "冷绿灰，专注沉静" },
  { id: "indigo", name: "深蓝", note: "蓝灰底，专业理性" },
  { id: "violet", name: "紫罗兰", note: "淡紫底，创意探索" },
  { id: "contrast", name: "高对比", note: "极限对比，无障碍优先" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export type ModeId = "light" | "dark" | "system";

export const THEME_KEY = "alp.theme";
export const MODE_KEY = "alp.mode";

export const MODES: readonly { id: ModeId; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
];

/** 解析实际生效的模式。 */
export function resolveMode(mode: ModeId): "light" | "dark" {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 把主题与模式写到 <html> 上。 */
export function applyTheme(theme: ThemeId, mode: ModeId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.mode = resolveMode(mode);
}
