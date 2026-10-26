"use client";

/**
 * 登录态与进度同步的客户端 hook。
 *
 * 数据分两层：
 *   - 未登录：进度存 localStorage（沿用原有行为）
 *   - 已登录：进度存服务端，localStorage 作为离线缓存
 *
 * 同步策略刻意是「写穿」而不是「双向合并」：
 * 登录后以服务端为准拉一次，之后每次变更都推服务端。
 * 双向合并需要处理冲突（同一学科在两处都有更新），
 * 对一个学习应用来说复杂度不划算，且容易把进度弄乱。
 */

import { useCallback, useEffect, useState } from "react";
import type { LearnerState } from "@/lib/learner";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      const data = (await res.json()) as { user: AuthUser | null };
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", email, password }),
    });
    const data = (await res.json()) as { ok?: boolean; user?: AuthUser; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error ?? "登录失败");
    setUser(data.user ?? null);
    return data.user!;
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", email, password, displayName }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        user?: AuthUser;
        error?: string;
        field?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "注册失败");
      setUser(data.user ?? null);
      return data.user!;
    },
    [],
  );

  const logout = useCallback(async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setUser(null);
  }, []);

  return { user, loading, login, register, logout, refresh };
}

/**
 * 服务端进度。
 *
 * pull：拉全部进度（登录后调一次）
 * push：把某学科进度推上去（每次变更后调）
 */
export function useServerProgress(enabled: boolean) {
  const [loaded, setLoaded] = useState(false);

  const pull = useCallback(async (): Promise<Record<string, LearnerState> | null> => {
    if (!enabled) return null;
    try {
      const res = await fetch("/api/progress", { cache: "no-store" });
      if (!res.ok) return null;
      const data = (await res.json()) as { progress?: Record<string, LearnerState> };
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
        const res = await fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId, progress }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [enabled],
  );

  return { pull, push, loaded };
}
