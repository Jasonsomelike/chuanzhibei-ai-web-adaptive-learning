"use client";

/**
 * 登录态与账号级浏览器存档的切换。
 *
 * 数据分两层：
 *   - 未登录：进度存 localStorage（沿用原有行为）
 *   - 已登录：进度存服务端，localStorage 作为离线缓存
 *
 * 换账号时必须先处理「浏览器级」的存档：它们不分账号，留着就会让 B 读到 A 的
 * 进度、笔记、上传资料与密钥。清哪些由 accountTransition.planAccountTransition
 * 统一决定（登录、注册、refresh 检测到换人、登出走同一份规则），
 * 本文件只负责执行计划，不再手写 if。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LearnerState } from "@/lib/learner";
import { MATERIALS_STORAGE_KEY } from "@/lib/materials";
import { CHAPTERS_STORAGE_KEY } from "@/lib/chapters";
import { MATERIALS_CHANGED_EVENT } from "@/lib/materialStore";
import { clearKbDatabase } from "@/lib/kbStore";
import { resetKbStorageCache } from "@/lib/kbRemote";
import {
  clearProvider,
  hydrateProviderFromServer,
} from "@/lib/provider";
import { SEARCH_CONFIG_KEY } from "@/lib/searchClient";
import { CALL_MODE_KEY } from "@/lib/serverConfig";
import { TTS_STORAGE_KEY } from "@/lib/tts";
import {
  ACCOUNT_OWNER_KEY,
  planAccountTransition,
  type AccountTransitionPlan,
} from "@/lib/accountTransition";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
}

/** 与 learner.ts 的存储键保持一致；该常量没有导出，这里单独写一份并加注释。 */
const LEARNER_STORAGE_KEY = "alp.learner.v2";
/** 当前选中的目标（学科/方向）。登出时清掉，避免下一位用户看到上一位的界面状态。 */
const SUBJECT_STORAGE_KEY = "alp.subject";

function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(ACCOUNT_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(owner: string | null): void {
  try {
    if (owner === null) window.localStorage.removeItem(ACCOUNT_OWNER_KEY);
    else window.localStorage.setItem(ACCOUNT_OWNER_KEY, owner);
  } catch {
    /* 存不进去就算了，本次会话仍按内存里的 user 工作 */
  }
}

/** 搜索与语音的密钥同样是浏览器级的，而且不在 provider 配置里。 */
function clearBrowserSecrets(): void {
  clearProvider();
  removeLocal(SEARCH_CONFIG_KEY);
  removeLocal(TTS_STORAGE_KEY);
  /*
   * 调用模式（服务端代发 / 本机直连）跟随账号：A 选了本机直连后，
   * B 登录时若继承这个值，会在没有本机 key 的情况下被当成「未配置」。
   */
  removeLocal(CALL_MODE_KEY);
}

/** 清掉资料存档并通知已挂载的面板重读；同标签页的 removeItem 不会触发 storage 事件。 */
function clearMaterialsAndChapters(): void {
  try {
    window.localStorage.removeItem(MATERIALS_STORAGE_KEY);
    window.localStorage.removeItem(CHAPTERS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(MATERIALS_CHANGED_EVENT));
  } catch {
    /* SSR 或隐私模式下没有 window.dispatchEvent */
  }
}

function forceClearPlan(nextOwner: string | null): AccountTransitionPlan {
  return {
    clearLearner: true,
    clearKb: true,
    clearSecrets: true,
    clearMaterials: true,
    nextOwner,
  };
}

/** 执行一份切换计划；任何一步失败都不影响其余步骤。 */
function applyAccountTransition(plan: AccountTransitionPlan): void {
  if (typeof window === "undefined") return;

  if (plan.clearLearner) removeLocal(LEARNER_STORAGE_KEY);
  if (plan.clearSecrets) clearBrowserSecrets();
  if (plan.clearMaterials) clearMaterialsAndChapters();
  if (plan.clearKb) {
    // 实例缓存里带着 firstSynced：复用旧实例会漏推登出期间新增的文档
    resetKbStorageCache();
    void clearKbDatabase();
  }

  writeOwner(plan.nextOwner);
}

/**
 * 登录/注册/refresh 成功后调用：按归属键判断是否换人。
 *
 * prev 只为一种情况存在：user.id 变了但邮箱没变（账号被重建）。
 * 归属键只记邮箱，planAccountTransition 会当成同一人，本地数据就留下了；
 * 这里显式补一次全清，服务端进度是按 user.id 存的，不补会串号。
 */
function applyUserTransition(prev: AuthUser | null, next: AuthUser | null): void {
  /*
   * 归属键是首选来源；旧存档可能没有它，此时用内存里的上一位用户兜底。
   * 两者都没有才是真正的匿名态（null→B 要保留本机数据）。
   */
  const prevOwner = readOwner() ?? prev?.email ?? null;
  const plan = planAccountTransition(prevOwner, next?.email ?? null);
  const idChanged = prev !== null && next !== null && prev.id !== next.id;
  applyAccountTransition(
    idChanged && !plan.clearLearner ? forceClearPlan(plan.nextOwner) : plan,
  );
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  /** 最新账号的同步副本：flush 定时器与 refresh 回调不能依赖闭包里的旧值。 */
  const userRef = useRef<AuthUser | null>(null);

  const commitUser = useCallback((next: AuthUser | null) => {
    userRef.current = next;
    setUser(next);
  }, []);

  /**
   * 挂载时读取会话。
   *
   * 只有拿到 200 响应才算「知道了当前账号」；5xx/网络失败按未知处理，
   * 不执行切换计划——一次断网不能把本机进度与资料清空。
   */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth", { cache: "no-store" });
      if (!res.ok) return;

      const data = (await res.json()) as { user: AuthUser | null };
      const next = data.user ?? null;
      applyUserTransition(userRef.current, next);
      commitUser(next);

      // 新设备本地没有 apiKey：服务端若已保存 llm 配置，靠这次水合生成本地状态。
      if (next !== null) void hydrateProviderFromServer();
    } catch {
      /* 网络失败：保留当前 user 与本机数据 */
    } finally {
      setLoading(false);
    }
  }, [commitUser]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", email, password }),
      });
      const data = (await res.json()) as { ok?: boolean; user?: AuthUser; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "登录失败");

      const next = data.user ?? null;
      applyUserTransition(userRef.current, next);
      commitUser(next);
      if (next !== null) void hydrateProviderFromServer();
      return data.user!;
    },
    [commitUser],
  );

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

      const next = data.user ?? null;
      applyUserTransition(userRef.current, next);
      commitUser(next);
      if (next !== null) void hydrateProviderFromServer();
      return data.user!;
    },
    [commitUser],
  );

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      /* 网络失败也要清本地：共享电脑上残留比服务端会话更危险 */
    }

    /*
     * 登出必须无条件清：即使归属键丢了（旧存档、手工清过），
     * 也不能把 learner / 密钥 / 上传资料留给下一位用户。
     */
    applyAccountTransition(forceClearPlan(null));
    removeLocal(SUBJECT_STORAGE_KEY);
    commitUser(null);
  }, [commitUser]);

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
