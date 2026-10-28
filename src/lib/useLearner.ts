"use client";

/**
 * 学习进度的统一入口。
 *
 * 数据来源两层：
 *   - 未登录：localStorage（原有行为，换设备不同步）
 *   - 已登录：服务端（按用户 × 学科存），localStorage 作为离线缓存
 *
 * 登录后首次加载会从服务端拉全量进度覆盖本地，
 * 之后每次变更都写穿到服务端。不做双向合并——见 useAuth.ts 的说明。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadLearner,
  saveLearner,
  createLearner,
  progressOf,
  type LearnerState,
  type SubjectProgress,
} from "@/lib/learner";
import type { KnowledgeGraph } from "@/lib/graph";
import { useAuth } from "@/lib/useAuth";

const PUSH_DEBOUNCE_MS = 800;

export interface UseLearnerResult {
  readonly learner: LearnerState | null;
  readonly ready: boolean;
  /** 当前学科的进度。 */
  readonly progress: SubjectProgress | null;
  /** 整体替换学习者状态（内部用）。 */
  readonly setLearner: (next: LearnerState) => void;
  /** 是否已登录——界面据此提示「进度已同步」或「仅本机」。 */
  readonly synced: boolean;
  /** 清空当前学科进度。 */
  readonly resetSubject: () => void;
}

/**
 * 读取并同步学习者状态。
 *
 * @param subjectId 当前学科或自定义方向 id，用于取 progress 与推送到服务端
 * @param graph 自定义方向的图。不传则按内置学科建进度（向后兼容）；
 *              传了才能保证进度里的 kcId 属于这张图，而不是回落到数据结构。
 */
export function useLearner(subjectId: string, graph?: KnowledgeGraph): UseLearnerResult {
  const { user } = useAuth();
  const [learner, setLearnerState] = useState<LearnerState | null>(null);
  const [ready, setReady] = useState(false);
  const [synced, setSynced] = useState(false);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ subjectId: string; progress: SubjectProgress } | null>(null);

  // 首次加载：登录用户先拉服务端，未登录直接读本地
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const local = loadLearner();

      if (!user) {
        if (!cancelled) {
          setLearnerState(local);
          setSynced(false);
          setReady(true);
        }
        return;
      }

      try {
        const res = await fetch("/api/progress", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { progress?: Record<string, SubjectProgress> };
          const server = data.progress ?? {};
          const merged: LearnerState = {
            ...local,
            subjects: { ...local.subjects, ...server },
          };
          if (!cancelled) {
            setLearnerState(merged);
            setSynced(true);
            setReady(true);
            saveLearner(merged);
          }
          return;
        }
      } catch {
        /* 拉取失败就用本地 */
      }

      if (!cancelled) {
        setLearnerState(local);
        setSynced(false);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  /** 写穿：先更新本地与内存，再防抖推服务端。 */
  const setLearner = useCallback(
    (next: LearnerState) => {
      setLearnerState(next);
      saveLearner(next);

      if (!user) return;

      pending.current = { subjectId, progress: progressOf(next, subjectId, graph) };

      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        const payload = pending.current;
        if (!payload) return;
        void fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: payload.subjectId,
            progress: payload.progress,
          }),
        }).catch(() => {
          // 推送失败不阻塞界面：本地已有副本，下次变更会重试
        });
      }, PUSH_DEBOUNCE_MS);
    },
    [user, subjectId, graph],
  );

  /*
   * 只清当前目标（subjectId）这一格进度，别的学科与方向不动。
   * 仅供「清空当前目标记录」使用；「重新诊断」不得调用它——
   * 重新诊断应该保留已有掌握度当先验，而不是把当前目标的进度抹掉。
   */
  const resetSubject = useCallback(() => {
    if (!learner) return;
    const fresh = createLearner();
    const next: LearnerState = {
      ...learner,
      subjects: {
        ...learner.subjects,
        [subjectId]: progressOf(fresh, subjectId, graph),
      },
    };
    setLearner(next);
  }, [learner, subjectId, graph, setLearner]);

  // 卸载前把待推送的写掉，避免最后一次变更丢失
  useEffect(() => {
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
      const payload = pending.current;
      if (payload && user) {
        void fetch("/api/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subjectId: payload.subjectId,
            progress: payload.progress,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [user]);

  return {
    learner,
    ready,
    progress: learner ? progressOf(learner, subjectId, graph) : null,
    setLearner,
    synced,
    resetSubject,
  };
}
