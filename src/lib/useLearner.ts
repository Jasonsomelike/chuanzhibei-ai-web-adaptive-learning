"use client";

/**
 * 学习进度的统一入口。
 *
 * 数据来源两层：
 *   - 未登录：localStorage（原有行为，换设备不同步）
 *   - 已登录：服务端（按用户 × 学科存），localStorage 作为离线缓存
 *
 * 记忆卡单独同步：进度里的 memories 只在本地作为缓存，推送前一定剥掉；
 * 卡片走 /api/memories 的 LWW upsert（不删缺失卡），登录与切换学科时按学科拉回。
 * 这样「进度」与「记忆卡」各自只有一个写入点，不会出现两份互相覆盖的真相。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadLearner,
  saveLearner,
  createLearner,
  progressOf,
  mergeServerProgress,
  sanitizeProgress,
  type LearnerState,
  type SubjectProgress,
} from "@/lib/learner";
import type { KnowledgeGraph } from "@/lib/graph";
import type { MemoryItem } from "@/lib/memory";
import { useAuth } from "@/lib/useAuth";
import { authStore } from "@/lib/authStore";
import { pushProgress, rememberProgressRevisions, mergeProgressEvidence } from "@/lib/progressClient";
import { clearMemories, pullMemories, pushMemories } from "@/lib/memoryClient";
import {
  memoriesEqual,
  mergeMemories,
  stripMemories,
  withMemories,
} from "@/lib/memorySync";

const PUSH_DEBOUNCE_MS = 800;

interface ProgressPayload {
  readonly ownerId: string;
  readonly subjectId: string;
  readonly progress: SubjectProgress;
}

interface MemoriesPayload {
  readonly ownerId: string;
  readonly subjectId: string;
  readonly memories: readonly MemoryItem[];
}

/** 登录时必须等进度落地，记忆卡同步才能确定要合并哪一份本地状态。 */
type PendingProgressLoad = Promise<void>;

/**
 * 只摘当前学科的记忆卡。
 *
 * memorySync.stripMemories 作用于整份 LearnerState；这里借它处理单学科，
 * 避免再写一份「复制 SubjectProgress 并删 memories」的逻辑。
 */
function progressWithoutMemories(
  learner: LearnerState,
  subjectId: string,
  progress: SubjectProgress,
): SubjectProgress {
  const stripped = stripMemories({
    version: 2,
    learnerId: learner.learnerId,
    subjects: { [subjectId]: progress },
  });
  return stripped.subjects[subjectId] ?? progress;
}

/**
 * 把非当前学科的记忆卡合回已摘除的状态。
 *
 * 本机与拉回进度可能各有一份（匿名进度并入账号时尤其常见），按 LWW 取并集。
 * 当前学科跳过：它随后单独从 /api/memories 回填；别的学科等用户切换过去再拉，
 * 这里先保住已有的卡，避免一次登录把未访问学科的本地卡清掉。
 */
function restoreOtherSubjectMemories(
  stripped: LearnerState,
  local: LearnerState,
  pulled: LearnerState,
  currentSubjectId: string,
): LearnerState {
  let next = stripped;
  for (const [subjectId, progress] of Object.entries(pulled.subjects)) {
    if (subjectId === currentSubjectId) continue;
    const localMemories = local.subjects[subjectId]?.memories;
    if (progress.memories === undefined && localMemories === undefined) continue;
    next = withMemories(
      next,
      subjectId,
      mergeMemories(localMemories, progress.memories),
    );
  }
  return next;
}

async function postProgress(
  subjectId: string,
  progress: SubjectProgress,
  keepalive = false,
): Promise<SubjectProgress | null> {
  /*
   * 登出后立即停止推送：定时器可能在 React 重渲染之前触发，
   * 仅靠组件里的 userId 闭包不够。以共享 store 的当前账号为准，
   * 匿名态不再向 /api/progress 发请求（那里只会回 401）。
   */
  const owner = authStore.getSnapshot().user?.id;
  if (!owner) return null;
  return pushProgress(owner, subjectId, progress, () => authStore.getSnapshot().user?.id === owner, keepalive);
}

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
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const [learner, setLearnerState] = useState<LearnerState | null>(null);
  const [ready, setReady] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined);
  const [synced, setSynced] = useState(false);

  /** 最新状态的同步副本：异步回调不能读可能过期的 state。 */
  const learnerRef = useRef<LearnerState | null>(null);
  const progressLoaded = useRef<PendingProgressLoad | null>(null);
  /**
   * 登录时从进度里摘下来的卡，按学科暂存，等该学科的 /api/memories 回来再合并。
   * 用 Map 而不是单个值：进度尚未落地时用户就可能切换学科，种子不能串科。
   */
  const memorySeeds = useRef<Map<string, readonly MemoryItem[]>>(new Map());
  const subjectIdRef = useRef(subjectId);
  useEffect(() => {
    subjectIdRef.current = subjectId;
  }, [subjectId]);

  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgress = useRef<Map<string, ProgressPayload>>(new Map());
  const memoryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMemories = useRef<Map<string, MemoriesPayload>>(new Map());

  /** 丢掉所有待推送数据与定时器；账号变化与登出共用同一份清理逻辑。 */
  const clearPending = useCallback(() => {
    pendingProgress.current.clear();
    pendingMemories.current.clear();
    memorySeeds.current.clear();
    if (pushTimer.current) {
      clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    if (memoryTimer.current) {
      clearTimeout(memoryTimer.current);
      memoryTimer.current = null;
    }
  }, []);

  /*
   * 账号变了就丢弃上一位用户的待推送数据：定时器在新会话里触发时，
   * 绝不能把 A 的进度 / 卡片写进 B 的账号。
   */
  useEffect(() => {
    clearPending();
  }, [userId, clearPending]);

  /*
   * 直接订阅共享 store，而不是只靠 useAuth 的渲染结果：
   * 登出时必须**立即**停掉待推送（页面重渲染之前定时器就可能触发）。
   * 同时把「已同步」立刻改回 false，界面不能继续显示已同步。
   */
  useEffect(() => {
    return authStore.subscribe(() => {
      if (authStore.getSnapshot().user !== null) return;
      clearPending();
      setSynced(false);
    });
  }, [clearPending]);

  // 首次加载 / 账号变化：登录用户先拉服务端进度，未登录直接读本地
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    const run = async (): Promise<void> => {
      const local = loadLearner();

      if (userId === null) {
        if (cancelled) return;
        learnerRef.current = local;
        setLearnerState(local);
        setSynced(false);
        setLoadedFor(null);
        setReady(true);
        return;
      }

      try {
        const res = await fetch("/api/progress", { cache: "no-store" });
        if (res.ok) {
          /*
           * 服务端返回的是整块 JSON，可能来自旧版本或被篡改：
           * 超过 200 张 / 形状坏掉的 memories 不能原样进界面，
           * 所以统一走 mergeServerProgress（逐学科 sanitizeProgress）。
           */
          const data = (await res.json()) as { progress?: unknown; revisions?: unknown };
          rememberProgressRevisions(userId, data.revisions);
          let pulled = mergeServerProgress(local, data.progress);
          let allSynced = true;
          const remoteProgress = data.progress && typeof data.progress === "object" ? data.progress as Record<string, unknown> : {};
          for (const [id, localProgress] of Object.entries(local.subjects)) {
            if (localProgress.attempts.length === 0) continue;
            const remote = sanitizeProgress(remoteProgress[id]);
            const merged = remote ? mergeProgressEvidence(remote, localProgress) : localProgress;
            if (remote && JSON.stringify(merged.attempts) === JSON.stringify(remote.attempts)) continue;
            if (cancelled) return;
            const saved = await pushProgress(userId, id, progressWithoutMemories(local, id, merged),
              () => !cancelled && authStore.getSnapshot().user?.id === userId);
            if (cancelled) return;
            if (!saved) allSynced = false;
            pulled = { ...pulled, subjects: { ...pulled.subjects, [id]: { ...(saved ?? merged), memories: localProgress.memories } } };
          }
          const currentSubject = subjectIdRef.current;

          /*
           * 进度里的 memories 是旧版存法。记忆卡现在单独存 /api/memories，
           * 同一张卡不能有两个真相：先把卡从进度里摘掉，当前学科随后由记忆卡
           * 同步回填；其它学科保留本机/旧进度里的卡，等切换过去时再拉取。
           */
          const stripped = stripMemories(pulled);
          const next = restoreOtherSubjectMemories(stripped, local, pulled, currentSubject);
          memorySeeds.current.set(
            currentSubject,
            mergeMemories(
              local.subjects[currentSubject]?.memories,
              pulled.subjects[currentSubject]?.memories,
            ),
          );

          if (cancelled) return;
          learnerRef.current = next;
          setLearnerState(next);
          setSynced(allSynced);
          setLoadedFor(userId);
          setReady(true);
          saveLearner(next);
          return;
        }
      } catch {
        /* 拉取失败就用本地 */
      }

      if (cancelled) return;
      learnerRef.current = local;
      setLearnerState(local);
      setSynced(false);
      setLoadedFor(userId);
      setReady(true);
    };

    const loading = run();
    progressLoaded.current = loading;
    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  /*
   * 当前学科的记忆卡：登录后与每次切换学科时拉一次。
   *
   * 先等进度落地，再加进状态：进度里的 memories 已被摘掉，
   * 这里不回填的话界面会短暂（拉取失败时是永久）丢掉本机卡片。
   */
  useEffect(() => {
    if (authLoading || userId === null) return;
    let cancelled = false;

    const run = async (): Promise<void> => {
      await progressLoaded.current;
      if (cancelled) return;

      const seed = memorySeeds.current.get(subjectId) ?? [];

      const remote = await pullMemories(subjectId);
      if (cancelled) return;

      const current = learnerRef.current;
      if (current === null) return;

      const localMemories = current.subjects[subjectId]?.memories ?? [];
      const existing = mergeMemories(localMemories, seed);

      if (remote === null) {
        // 拉取失败只回填登录时摘下来的卡；不把 null 当成「服务端为空」而停手。
        if (!memoriesEqual(existing, localMemories)) {
          const next = withMemories(current, subjectId, existing);
          learnerRef.current = next;
          setLearnerState(next);
          saveLearner(next);
        }
        memorySeeds.current.delete(subjectId);
        return;
      }

      const merged = mergeMemories(existing, remote);
      if (!memoriesEqual(merged, localMemories)) {
        const next = withMemories(current, subjectId, merged);
        learnerRef.current = next;
        setLearnerState(next);
        saveLearner(next);
      }
      // 卡片已经装回本地；取消发生在回填之前时保留种子，下次进入该学科再合并。
      memorySeeds.current.delete(subjectId);

      /*
       * 升级迁移：旧版把卡存在进度里，服务端 /api/memories 还没有行。
       * 只在「登录时进度有卡 + 该学科服务端为空」时推一次。切换学科时 seed 为空，
       * 不会拿本机缓存去复活另一台设备明确删掉的卡（PUT 永不删行）。
       */
      if (seed.length > 0 && remote.length === 0) {
        void pushMemories(subjectId, merged);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [authLoading, subjectId, userId]);

  const flushProgress = useCallback((ownerId: string) => {
    // 以共享 store 的当前账号为准：登出后即使闭包里还留着 userId，也必须停
    if (authStore.getSnapshot().user?.id !== ownerId) {
      pendingProgress.current.clear();
      return;
    }
    const entries = [...pendingProgress.current.values()].filter(
      (entry) => entry.ownerId === ownerId,
    );
    pendingProgress.current.clear();
    for (const entry of entries) {
      void postProgress(entry.subjectId, entry.progress).then((saved) => {
        if (authStore.getSnapshot().user?.id !== ownerId) return;
        if (!saved) {
          setSynced(false);
          if (!pendingProgress.current.has(entry.subjectId)) pendingProgress.current.set(entry.subjectId, entry);
          return;
        }
        setSynced(pendingProgress.current.size === 0);
        const current = learnerRef.current;
        const local = current?.subjects[entry.subjectId];
        if (!current || !local || local.attempts !== entry.progress.attempts) return;
        const next = { ...current, subjects: { ...current.subjects, [entry.subjectId]: { ...saved, memories: local.memories } } };
        learnerRef.current = next;
        setLearnerState(next);
        saveLearner(next);
      });
    }
  }, []);

  useEffect(() => {
    const retry = () => {
      const owner = authStore.getSnapshot().user?.id;
      if (owner) flushProgress(owner);
    };
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", retry);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("pagehide", retry);
    };
  }, [flushProgress]);

  const flushMemories = useCallback((ownerId: string) => {
    if (authStore.getSnapshot().user?.id !== ownerId) {
      pendingMemories.current.clear();
      return;
    }
    const entries = [...pendingMemories.current.values()].filter(
      (entry) => entry.ownerId === ownerId,
    );
    pendingMemories.current.clear();
    for (const entry of entries) {
      void pushMemories(entry.subjectId, entry.memories);
    }
  }, []);

  /** 写穿：本地与内存先更新，再分别防抖推进度（剥卡）与记忆卡。 */
  const setLearner = useCallback(
    (next: LearnerState) => {
      learnerRef.current = next;
      setLearnerState(next);
      saveLearner(next);

      // 登出后组件还没重渲染时，旧闭包里的 userId 仍是旧值；以 store 为准
      const ownerId = authStore.getSnapshot().user?.id ?? null;
      if (ownerId === null) return;

      const progress = progressOf(next, subjectId, graph);

      pendingProgress.current.set(subjectId, {
        ownerId,
        subjectId,
        progress: progressWithoutMemories(next, subjectId, progress),
      });

      if (pushTimer.current) clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        pushTimer.current = null;
        flushProgress(ownerId);
      }, PUSH_DEBOUNCE_MS);

      pendingMemories.current.set(subjectId, {
        ownerId,
        subjectId,
        memories: progress.memories ?? [],
      });

      if (memoryTimer.current) clearTimeout(memoryTimer.current);
      memoryTimer.current = setTimeout(() => {
        memoryTimer.current = null;
        flushMemories(ownerId);
      }, PUSH_DEBOUNCE_MS);
    },
    [flushMemories, flushProgress, graph, subjectId],
  );

  /*
   * 只清当前目标（subjectId）这一格进度，别的学科与方向不动。
   * 仅供「清空当前目标记录」使用；「重新诊断」不得调用它——
   * 重新诊断应该保留已有掌握度当先验，而不是把当前目标的进度抹掉。
   */
  const resetSubject = useCallback(() => {
    const current = learnerRef.current;
    if (current === null) return;

    const fresh = createLearner();
    const next: LearnerState = {
      ...current,
      subjects: {
        ...current.subjects,
        [subjectId]: progressOf(fresh, subjectId, graph),
      },
    };

    const ownerId = authStore.getSnapshot().user?.id ?? null;
    if (ownerId !== null) {
      /*
       * 记忆卡在独立表里，清空进度不会删它们；不显式删除的话，
       * 下次拉取 /api/memories 会把刚清掉的卡原样装回来。
       * 先丢掉该学科待推送的旧快照，避免它与 DELETE 抢跑后复活卡片。
       */
      pendingMemories.current.delete(subjectId);
      memorySeeds.current.delete(subjectId);
      void clearMemories(subjectId);
    }

    setLearner(next);
  }, [graph, setLearner, subjectId]);

  // 卸载前把待推送的写掉，避免最后一次变更丢失；账号已变时按归属丢弃。
  useEffect(() => {
    // Map 实例整个生命周期不变，复制引用可让 cleanup 读到卸载时的内容。
    const progressQueue = pendingProgress.current;
    const memoriesQueue = pendingMemories.current;

    return () => {
      const ownerId = authStore.getSnapshot().user?.id ?? null;
      if (ownerId === null) return;

      for (const entry of progressQueue.values()) {
        if (entry.ownerId === ownerId) {
          void postProgress(entry.subjectId, entry.progress, true);
        }
      }
      for (const entry of memoriesQueue.values()) {
        if (entry.ownerId === ownerId) {
          void pushMemories(entry.subjectId, entry.memories);
        }
      }
      progressQueue.clear();
      memoriesQueue.clear();
    };
  }, []);

  return {
    learner,
    ready: ready && !authLoading && loadedFor === userId,
    progress: learner ? progressOf(learner, subjectId, graph) : null,
    setLearner,
    synced,
    resetSubject,
  };
}
