"use client";

/**
 * 当前学习目标的客户端状态（内置学科或自定义方向）。
 *
 * 选择优先级：URL 参数 > localStorage > 默认学科。
 * URL 优先是为了让「分享/刷新带方向 id 的链接」稳定复现同一目标——
 * 诊断页的「保存并开始诊断」会 history.replaceState 写 ?direction=，
 * 用户刷新后仍停在这个方向上。
 *
 * 读 URL 用 window.location.search 而不是 useSearchParams：
 * Next 16 下 useSearchParams 会强制页面进 Suspense 边界，
 * 静态页构建时会报「missing suspense boundary」，代价大于收益。
 *
 * 自定义方向的失败（404/403/网络）会回落默认学科并**显式提示**。
 * 旧版静默回落到 data-structures，导致用户的自定义方向被当成数据结构来测。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SUBJECTS, DEFAULT_SUBJECT_ID, getSubject } from "@/data/subjects";
import type { KnowledgeGraph } from "@/lib/graph";
import {
  targetFromSubject,
  targetFromDirection,
  type LearningTarget,
} from "@/lib/target";

const SUBJECT_KEY = "alp.subject";

export interface UseTargetResult {
  readonly target: LearningTarget | null;
  readonly targetId: string;
  readonly setTarget: (t: LearningTarget) => void;
  /** 按 id 切换：内置学科直接切，方向需要拉取图谱。 */
  readonly setTargetId: (id: string) => void;
  readonly ready: boolean;
  readonly loadingTarget: boolean;
  /** 方向加载失败时的提示。非空时界面必须显示。 */
  readonly targetError: string | null;
}

function isBuiltin(id: string): boolean {
  return SUBJECTS.some((s) => s.id === id);
}

export function useSubject(): UseTargetResult {
  const [target, setTargetState] = useState<LearningTarget | null>(null);
  const [targetId, setTargetIdState] = useState<string>(DEFAULT_SUBJECT_ID);
  const [ready, setReady] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const cancelPending = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setLoadingTarget(false);
  }, []);

  const updateUrl = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("subject");
    url.searchParams.delete("direction");
    url.searchParams.set(isBuiltin(id) ? "subject" : "direction", id);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const persist = useCallback((id: string) => {
    try {
      window.localStorage.setItem(SUBJECT_KEY, id);
    } catch {
      /* 存不进去不影响当前会话 */
    }
  }, []);

  const applyBuiltin = useCallback((id: string) => {
    const subject = getSubject(id);
    setTargetState(targetFromSubject(subject));
    setTargetIdState(subject.id);
    setTargetError(null);
  }, []);

  const loadDirection = useCallback(
    async (id: string) => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      setReady(false);
      setLoadingTarget(true);
      setTargetError(null);
      try {
        const res = await fetch(`/api/directions?id=${encodeURIComponent(id)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          const reason =
            res.status === 403
              ? "这个方向是私有的，当前账号无权访问"
              : res.status === 404
                ? "方向不存在或已被删除"
                : (data.error ?? `加载失败（HTTP ${res.status}）`);
          throw new Error(reason);
        }
        const data = (await res.json()) as {
          id: string;
          title: string;
          description?: string;
          graph: KnowledgeGraph;
        };
        if (controller.signal.aborted) return;
        setTargetState(
          targetFromDirection({
            id: data.id,
            title: data.title,
            description: data.description,
            graph: data.graph,
          }),
        );
        setTargetIdState(data.id);
        persist(data.id);
        setTargetError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        const reason = err instanceof Error ? err.message : String(err);
        // 先回落再设错误：applyBuiltin 会清空 targetError，顺序反了提示就永远不显示
        applyBuiltin(DEFAULT_SUBJECT_ID);
        setTargetIdState(DEFAULT_SUBJECT_ID);
        persist(DEFAULT_SUBJECT_ID);
        updateUrl(DEFAULT_SUBJECT_ID);
        setTargetError(`自定义方向加载失败：${reason}。已回到默认学科。`);
      } finally {
        if (pending.current === controller) {
          pending.current = null;
          setLoadingTarget(false);
          setReady(true);
        }
      }
    },
    [applyBuiltin, persist, updateUrl],
  );

  const setTarget = useCallback(
    (t: LearningTarget) => {
      cancelPending();
      setTargetState(t);
      setTargetIdState(t.id);
      setTargetError(null);
      persist(t.id);
      updateUrl(t.id);
      setReady(true);
    },
    [cancelPending, persist, updateUrl],
  );

  const setTargetId = useCallback(
    (id: string) => {
      updateUrl(id);
      if (isBuiltin(id)) {
        cancelPending();
        applyBuiltin(id);
        persist(id);
        setReady(true);
        return;
      }
      // 方向 id 是 UUID；只有传了非内置 id 才去拉
      persist(id);
      void loadDirection(id);
    },
    [applyBuiltin, cancelPending, loadDirection, persist, updateUrl],
  );

  useEffect(() => {
    return () => pending.current?.abort();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("direction") ?? params.get("subject");

    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(SUBJECT_KEY);
    } catch {
      saved = null;
    }

    const wanted = fromUrl ?? saved;

    if (!wanted || isBuiltin(wanted)) {
      const id = isBuiltin(wanted ?? "") ? (wanted as string) : DEFAULT_SUBJECT_ID;
      applyBuiltin(id);
      persist(id);
      setReady(true);
      return;
    }

    // 图谱到达前不展示默认学科，避免读取或作答到另一学科的进度。
    void loadDirection(wanted);
    return () => pending.current?.abort();
  }, [applyBuiltin, loadDirection, persist]);

  return { target, targetId, setTarget, setTargetId, ready, loadingTarget, targetError };
}
