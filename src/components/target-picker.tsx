"use client";

/**
 * 目标选择器：内置学科 + 我的自定义方向。
 *
 * 三页（诊断、路径、导师）共用同一个选择器。
 * 不做「诊断页能选方向、路径页选不了」的两套并存——
 * 那正是「自定义方向被当成数据结构来测」这个 bug 的成因。
 *
 * 未登录时不隐藏「我的方向」分组，而是显示一行登录提示：
 * 隐藏会让用户不知道有这个功能。
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SUBJECTS } from "@/data/subjects";
import { useAuth } from "@/lib/useAuth";
import type { LearningTarget } from "@/lib/target";

interface DirectionSummary {
  id: string;
  title: string;
  conceptCount: number;
  edgeCount: number;
}

/** 内置学科按钮组。原先的 SubjectPicker 原样搬进来，props 不变。 */
export function SubjectPicker({
  current,
  onChange,
  compact = false,
}: {
  current: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SUBJECTS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          aria-pressed={current === s.id}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            current === s.id
              ? "bg-[var(--accent)] text-[var(--on-accent)]"
              : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
          }`}
        >
          {s.name}
          {!compact ? (
            <span className="tabular ml-1.5 text-xs opacity-70">
              {s.graph.concepts.length}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function TargetPicker({
  current,
  onChange,
  onNewDirection,
  showNew = true,
  compact = false,
}: {
  /** 当前目标 id：内置学科 id 或方向 uuid。 */
  current: string;
  onChange: (id: string) => void;
  /** 点「＋ 新建方向」时展开内联面板（由调用方渲染）。 */
  onNewDirection?: () => void;
  showNew?: boolean;
  compact?: boolean;
}) {
  const { user, loading } = useAuth();
  const [mine, setMine] = useState<DirectionSummary[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    if (!user) {
      setMine([]);
      return;
    }
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/directions?scope=mine", { cache: "no-store" });
      if (!res.ok) {
        setError("方向列表加载失败");
        return;
      }
      const data = (await res.json()) as {
        directions: { id: string; title: string; graph?: { concepts: unknown[]; edges: unknown[] }; conceptCount?: number; edgeCount?: number }[];
      };
      setMine(
        (data.directions ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          conceptCount: d.graph?.concepts.length ?? d.conceptCount ?? 0,
          edgeCount: d.graph?.edges.length ?? d.edgeCount ?? 0,
        })),
      );
    } catch {
      setError("方向列表加载失败");
    } finally {
      setFetching(false);
    }
  }, [user]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-[var(--ink-faint)]">内置学科</p>
        <SubjectPicker current={current} onChange={onChange} compact={compact} />
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-[var(--ink-faint)]">我的方向</p>

        {loading ? (
          <p className="text-sm text-[var(--ink-soft)]">正在读取账号…</p>
        ) : !user ? (
          <p className="text-sm text-[var(--ink-soft)]">
            <Link href="/login" className="underline">
              登录
            </Link>{" "}
            后可保存并诊断自定义方向。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {mine.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onChange(d.id)}
                  aria-pressed={current === d.id}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    current === d.id
                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  }`}
                >
                  {d.title}
                  <span className="tabular ml-1.5 text-xs opacity-70">
                    {d.conceptCount} 点
                  </span>
                </button>
              ))}

              {showNew && onNewDirection ? (
                <button
                  type="button"
                  onClick={onNewDirection}
                  className="rounded-lg border border-dashed border-[var(--line-strong)] px-3 py-1.5 text-sm text-[var(--ink-soft)] hover:bg-[var(--line)]"
                >
                  ＋ 新建方向
                </button>
              ) : null}
            </div>

            {fetching ? (
              <p className="mt-1 text-xs text-[var(--ink-faint)]">加载中…</p>
            ) : mine.length === 0 ? (
              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                还没有自定义方向。点「＋ 新建方向」用一句话描述你想学什么。
              </p>
            ) : null}
            {error ? <p className="mt-1 text-xs text-[var(--bad)]">{error}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** 目标的一句话说明，三页共用，避免各写一份措辞。 */
export function targetCaption(target: LearningTarget): string {
  if (target.kind === "subject") {
    return `${target.tagline ?? ""}${target.syllabus ? ` · ${target.syllabus}` : ""}。各学科的掌握度独立计算。`;
  }
  return `自定义方向 · ${target.graph.concepts.length} 个知识点 / ${target.graph.edges.length} 条先修关系。掌握度按方向单独计算。`;
}
