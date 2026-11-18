"use client";

/**
 * 某个方向的上传知识库面板。
 *
 * 只在用户展开时挂载：useKnowledgeBase 会读取该方向的 docs 与 chunks，
 * 一次把所有方向都读出来会让首屏为每个方向付一次 IndexedDB 查询。
 *
 * 面板本身不解析文件、不做检索：解析在 knowledge-upload.tsx，
 * 检索在 tutor / directionItems 侧用 knowledge.ts 的纯函数完成。
 * 这里只展示、绑定与删除，并在变更后 reload 让检索侧重新读取。
 */

import { useEffect, useMemo, useRef, useState } from "react";

import {
  deleteDocument,
  directionCapacity,
  getKbStorageForUser,
  updateDocKcIds,
  useKnowledgeBase,
} from "@/lib/kbStore";
import type { UploadDoc } from "@/lib/knowledge";
import { KnowledgeUpload } from "@/components/knowledge-upload";

export interface KbCounts {
  readonly docs: number;
  readonly chunks: number;
}

function formatNumber(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function KnowledgeBasePanel({
  directionId,
  concepts,
  userId,
  onCounts,
  onChanged,
}: {
  directionId: string;
  /** 方向图谱里的知识点；用于展示与编辑绑定。 */
  concepts: readonly { id: string; name: string }[];
  /** 有账号时读/写「本地 + 账号」复合存储；为空表示只看本浏览器。 */
  userId?: string | null;
  /** 首次读取或变更后把「N 份 · M 段」回传给卡片上的按钮。 */
  onCounts?: (counts: KbCounts) => void;
  /** 导入 / 删除 / 绑定变更后通知父组件（例如刷新覆盖度）。 */
  onChanged?: () => void;
}) {
  const { docs, chunks, loading, error, syncWarning, reload } = useKnowledgeBase(
    directionId,
    userId,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  /*
   * 统计与列表前再按 directionId 过滤一次：复合存储返回的是「本地 + 远端」并集，
   * 远端快照理论上只含该方向，但任何一条越界的行都不该影响容量与计数。
   */
  const directionDocs = useMemo(
    () => docs.filter((doc) => doc.directionId === directionId),
    [docs, directionId],
  );
  const directionChunks = useMemo(
    () => chunks.filter((chunk) => chunk.directionId === directionId),
    [chunks, directionId],
  );

  const onCountsRef = useRef(onCounts);
  useEffect(() => {
    onCountsRef.current = onCounts;
  }, [onCounts]);

  useEffect(() => {
    onCountsRef.current?.({ docs: directionDocs.length, chunks: directionChunks.length });
  }, [directionDocs.length, directionChunks.length]);

  const capacity = directionCapacity(directionDocs);
  const totalChars = directionDocs.reduce((sum, doc) => sum + doc.charCount, 0);
  const nameById = new Map(concepts.map((concept) => [concept.id, concept.name] as const));
  const hasAccount = userId !== undefined && userId !== null && userId.trim() !== "";

  const afterChange = (): void => {
    reload();
    onChanged?.();
  };

  const remove = async (doc: UploadDoc): Promise<void> => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `删除《${doc.title}》及其 ${doc.chunkCount} 段？删除后导师检索、出题与依据核对都不会再引用它。`,
      )
    ) {
      return;
    }

    const storage = getKbStorageForUser(userId);
    if (storage === null) {
      setActionError("当前浏览器不支持 IndexedDB，无法删除上传资料。");
      return;
    }

    setBusyDocId(doc.id);
    setActionError(null);
    const result = await deleteDocument(storage, doc.id);
    setBusyDocId(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    afterChange();
  };

  const saveBinding = async (doc: UploadDoc, kcIds: readonly string[]): Promise<boolean> => {
    const storage = getKbStorageForUser(userId);
    if (storage === null) {
      setActionError("当前浏览器不支持 IndexedDB，无法保存绑定。");
      return false;
    }

    setBusyDocId(doc.id);
    setActionError(null);
    const result = await updateDocKcIds(storage, doc.id, kcIds);
    setBusyDocId(null);
    if (!result.ok) {
      setActionError(result.error);
      return false;
    }
    afterChange();
    return true;
  };

  return (
    <div className="mt-4 rounded-lg border border-[var(--line)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            知识库{hasAccount ? "（已开启账号同步）" : "（仅本浏览器）"}
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
            {hasAccount ? "资料随账号保存，导师可检索原文并标注出处。" : "资料仅保存在当前浏览器。"}
          </p>
        </div>
        <span className="tabular shrink-0 text-xs text-[var(--ink-soft)]">
          {loading
            ? "读取中…"
            : `${directionDocs.length} 份 · ${directionChunks.length} 段 · ${formatNumber(totalChars)} 字`}
        </span>
      </div>

      <details className="knowledge-import-limits"><summary>存储用量</summary>
        已用 {capacity.usedChunks} / {formatNumber(capacity.maxChunks)} 段，{formatNumber(capacity.usedChars)} / {formatNumber(capacity.maxChars)} 字。
      </details>
      {syncWarning !== null ? (
        <p role="status" className="mt-2 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] p-2 text-xs text-[var(--warn)]">
          {syncWarning}
        </p>
      ) : null}

      {error !== null ? (
        <p role="alert" className="mt-2 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-2 text-xs text-[var(--bad)]">
          {error}
        </p>
      ) : null}

      {actionError !== null ? (
        <p role="alert" className="mt-2 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-2 text-xs text-[var(--bad)]">
          {actionError}
        </p>
      ) : null}

      <KnowledgeUpload
        directionId={directionId}
        concepts={concepts}
        userId={userId}
        onImported={afterChange}
      />

      {loading && directionDocs.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">正在读取知识库…</p>
      ) : null}

      {!loading && directionDocs.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">
          还没有上传资料。可以上传讲义、笔记或教材节选；没有绑定知识点的文档只会用于导师问答检索。
        </p>
      ) : null}

      {directionDocs.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {directionDocs.map((doc) => {
            const boundNames = doc.kcIds.map((id) => nameById.get(id) ?? id);
            return (
              <li key={doc.id} className="rounded-lg border border-[var(--line)] p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{doc.title}</p>
                    <p className="tabular mt-0.5 text-xs text-[var(--ink-soft)]">
                      {doc.kind.toUpperCase()} · {doc.chunkCount} 段 ·{" "}
                      {formatNumber(doc.charCount)} 字
                      {doc.pageCount !== undefined ? ` · ${doc.pageCount} 页` : ""} ·{" "}
                      {formatCreatedAt(doc.createdAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                      绑定知识点：
                      {boundNames.length === 0 ? "未绑定（只在导师问答中检索）" : boundNames.join("、")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove(doc)}
                    disabled={busyDocId !== null}
                    className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--bad)] disabled:opacity-40"
                  >
                    {busyDocId === doc.id ? "处理中…" : "删除"}
                  </button>
                </div>

                {concepts.length > 0 ? (
                  <DocBindingEditor
                    key={`${doc.id}:${doc.kcIds.join(",")}`}
                    doc={doc}
                    concepts={concepts}
                    disabled={busyDocId !== null}
                    onSave={(kcIds) => saveBinding(doc, kcIds)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function DocBindingEditor({
  doc,
  concepts,
  disabled,
  onSave,
}: {
  doc: UploadDoc;
  concepts: readonly { id: string; name: string }[];
  disabled: boolean;
  onSave: (kcIds: readonly string[]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>(doc.kcIds);
  const [saving, setSaving] = useState(false);

  const dirty =
    selected.length !== doc.kcIds.length ||
    selected.some((id) => !doc.kcIds.includes(id));

  const toggle = (id: string): void => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    const ok = await onSave(selected);
    setSaving(false);
    if (ok) setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setSelected(doc.kcIds);
          setOpen(true);
        }}
        disabled={disabled}
        className="mt-2 rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs disabled:opacity-40"
      >
        编辑绑定
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--line)] p-2">
      <p className="text-xs text-[var(--ink-soft)]">
        绑定后，这些知识点出题与依据核对会引用本文件的段落；不绑定只用于导师问答检索。
      </p>
      <div className="mt-1.5 grid gap-1 text-xs sm:grid-cols-2">
        {concepts.map((concept) => (
          <label key={concept.id} className="flex items-start gap-1.5">
            <input
              type="checkbox"
              checked={selected.includes(concept.id)}
              onChange={() => toggle(concept.id)}
              disabled={saving || disabled}
              className="mt-0.5"
            />
            <span className="min-w-0">{concept.name}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || disabled || !dirty}
          className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--on-accent)] disabled:opacity-40"
        >
          {saving ? "保存中…" : "保存绑定"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSelected(doc.kcIds);
            setOpen(false);
          }}
          disabled={saving}
          className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs"
        >
          取消
        </button>
      </div>
    </div>
  );
}
