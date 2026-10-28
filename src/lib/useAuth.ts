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
import { MATERIALS_STORAGE_KEY } from "@/lib/materials";
import { CHAPTERS_STORAGE_KEY } from "@/lib/chapters";
import { MATERIALS_CHANGED_EVENT } from "@/lib/materialStore";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
}

/**
 * 资料存档属于谁。
 *
 * 教材、口径选择、讲义正文与章节勾选都是浏览器级的键，不分账号。
 * 只在登出时清不够：A 不登出、B 直接在登录页登录时，A 的笔记会被 B 的
 * 出题与导师讲解读到。所以登录时也要比对上一次的账号。
 */
const MATERIALS_OWNER_KEY = "alp.materials.owner";

/** 清掉资料存档并通知已挂载的面板重读；同标签页的 removeItem 不会触发 storage 事件。 */
function clearMaterialsAndChapters(): void {
  window.localStorage.removeItem(MATERIALS_STORAGE_KEY);
  window.localStorage.removeItem(CHAPTERS_STORAGE_KEY);
  window.dispatchEvent(new Event(MATERIALS_CHANGED_EVENT));
}

/** 登录成功后调：换了账号就丢弃上一位用户的资料，并把归属改成当前账号。 */
function adoptAccount(email: string | null): void {
  const owner = window.localStorage.getItem(MATERIALS_OWNER_KEY);
  const next = email ?? "";
  if (owner !== null && owner !== next) clearMaterialsAndChapters();
  if (next === "") window.localStorage.removeItem(MATERIALS_OWNER_KEY);
  else window.localStorage.setItem(MATERIALS_OWNER_KEY, next);
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
    adoptAccount(data.user?.email ?? null);
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
      adoptAccount(data.user?.email ?? null);
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

    /*
     * 必须清掉本浏览器的进度与密钥。
     *
     * 不清的后果是真实的：同一台机器上 A 登出、B 注册登录后，
     * B 会把 A 留在 localStorage 的进度合并进来，看到「历史累计作答 3 题」，
     * 下一次写回还可能把 A 的数据写进 B 的账号；A 的模型 key 也留在浏览器里。
     * 会话是服务端的，本地残留却是浏览器级的，两者必须一起清。
     */
    try {
      window.localStorage.removeItem("alp.learner.v2");
      window.localStorage.removeItem("alp.provider.v1");
      window.localStorage.removeItem("alp.subject");
      // 教材正文与章节勾选同样是浏览器级的：不清的话下一位用户会直接看到上一位的笔记
      clearMaterialsAndChapters();
      window.localStorage.removeItem(MATERIALS_OWNER_KEY);
    } catch {
      /* 隐私模式下可能不可用，忽略 */
    }
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
