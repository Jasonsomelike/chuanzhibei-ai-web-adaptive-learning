"use client";

/**
 * 当前学科的客户端状态。
 *
 * 学科选择存在 localStorage，所有页面共用。
 * 切换学科后，掌握度是**分学科独立**的——数据结构答过的题不会影响网络。
 * 这一点必须如此：不同学科的知识点没有可比性。
 */

import { useCallback, useEffect, useState } from "react";
import { SUBJECTS, DEFAULT_SUBJECT_ID, getSubject, type Subject } from "@/data/subjects";

const SUBJECT_KEY = "alp.subject";

export function useSubject() {
  const [subjectId, setSubjectId] = useState<string>(DEFAULT_SUBJECT_ID);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SUBJECT_KEY);
      const valid = SUBJECTS.some((s) => s.id === saved) ? saved : DEFAULT_SUBJECT_ID;
      setSubjectId(valid as string);
    } catch {
      setSubjectId(DEFAULT_SUBJECT_ID);
    }
    setReady(true);
  }, []);

  const setSubject = useCallback((id: string) => {
    setSubjectId(id);
    try {
      window.localStorage.setItem(SUBJECT_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const subject: Subject = getSubject(subjectId);

  return { subject, subjectId, setSubject, ready };
}

/** 学科切换器。放在诊断页与路径页顶部。 */
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
