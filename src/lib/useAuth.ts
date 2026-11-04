"use client";

/**
 * 登录态与账号级浏览器存档的切换。
 *
 * 数据分两层：
 *   - 未登录：进度存 localStorage（沿用原有行为）
 *   - 已登录：进度存服务端，localStorage 作为离线缓存
 *
 * 登录态本身在 authStore.ts 的模块级 store 里：所有 useAuth 实例订阅同一份
 * snapshot，导航栏登录后导师页 / 设置页会同时更新，不再各存一份 useState。
 * 本文件只保留 React 绑定与「服务端进度」这个与登录态无关的读写 hook。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { sanitizeProgress, type SubjectProgress } from "@/lib/learner";
import { pushProgress, rememberProgressRevisions } from "@/lib/progressClient";
import { authStore } from "@/lib/authStore";

export type { AuthUser } from "@/lib/authStore";

/**
 * 登录态。
 *
 * 返回形状保持不变（{ user, loading, login, register, logout, refresh }），
 * 调用方无需改动；变化只发生在数据来源——现在是共享 store。
 */
export function useAuth() {
  const snapshot = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );

  /*
   * 每个实例挂载时都可以放心调用：authStore.refresh 会对并发请求去重，
   * 多个组件同时挂载也只会发一次 /api/auth。
   */
  useEffect(() => {
    void authStore.refresh();
  }, []);

  return {
    user: snapshot.user,
    loading: snapshot.loading,
    login: authStore.login,
    register: authStore.register,
    logout: authStore.logout,
    refresh: authStore.refresh,
  };
}

/**
 * 服务端进度。
 *
 * pull：拉全部进度（登录后调一次）
 * push：把某学科进度推上去（每次变更后调）
 */
export function useServerProgress(enabled: boolean) {
  const [loaded, setLoaded] = useState(false);

  const pull = useCallback(async (): Promise<Record<string, SubjectProgress> | null> => {
    if (!enabled) return null;
    try {
      const res = await fetch("/api/progress", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { progress?: Record<string, SubjectProgress>; revisions?: unknown };
      const owner = authStore.getSnapshot().user?.id;
      if (owner) rememberProgressRevisions(owner, data.revisions);
      setLoaded(true);
      return data.progress ?? {};
    } catch {
      return null;
    }
  }, [enabled]);

  const push = useCallback(
    async (subjectId: string, progress: unknown): Promise<boolean> => {
      if (!enabled) return false;
      try {
        const owner = authStore.getSnapshot().user?.id;
        const clean = sanitizeProgress(progress);
        if (!owner || !clean) return false;
        return await pushProgress(owner, subjectId, clean, () => authStore.getSnapshot().user?.id === owner) !== null;
      } catch {
        return false;
      }
    },
    [enabled],
  );

  return { pull, push, loaded };
}
