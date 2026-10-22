"use client";

/**
 * 主题切换的客户端 hook。
 *
 * 常量与纯函数在 themes.ts（无 "use client"），这里只做状态与副作用。
 * 首屏防闪烁由 layout.tsx 的同步脚本负责，这里管交互后的切换与持久化。
 */

import { useCallback, useEffect, useState } from "react";
import {
  THEMES,
  THEME_KEY,
  MODE_KEY,
  applyTheme,
  resolveMode,
  type ThemeId,
  type ModeId,
} from "@/lib/themes";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>("sand");
  const [mode, setModeState] = useState<ModeId>("system");
  const [ready, setReady] = useState(false);

  // 首次挂载：读 localStorage，与首屏脚本保持一致
  useEffect(() => {
    try {
      const t = window.localStorage.getItem(THEME_KEY);
      const m = window.localStorage.getItem(MODE_KEY);
      const validTheme = (THEMES.some((x) => x.id === t) ? t : "sand") as ThemeId;
      const validMode: ModeId = m === "light" || m === "dark" ? m : "system";
      setThemeState(validTheme);
      setModeState(validMode);
      applyTheme(validTheme, validMode);
    } catch {
      applyTheme("sand", "system");
    }
    setReady(true);
  }, []);

  // 系统主题变化时，若用户选的是「跟随系统」则实时响应
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(theme, "system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode, theme]);

  const setTheme = useCallback(
    (next: ThemeId) => {
      setThemeState(next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        /* ignore */
      }
      applyTheme(next, mode);
    },
    [mode],
  );

  const setMode = useCallback(
    (next: ModeId) => {
      setModeState(next);
      try {
        window.localStorage.setItem(MODE_KEY, next);
      } catch {
        /* ignore */
      }
      applyTheme(theme, next);
    },
    [theme],
  );

  return { theme, mode, setTheme, setMode, ready, resolvedMode: resolveMode(mode) };
}
