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

import { useEffect, useRef, useState } from "react";

import {
  deleteDocument,
  directionCapacity,
  getDefaultKbStorage,
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
  onCounts,
  onChanged,
}: {
  directionId: string;
  /** 方向图谱里的知识点；用于展示与编辑绑定。 */
  concepts: readonly { id: string; name: string }[];
  /** 首次读取或变更后把「N 份 · M 段」回传给卡片上的按钮。 */
  onCounts?: (counts: KbCounts) => void;
  /** 导入 / 删除 / 绑定变更后通知父组件（例如刷新覆盖度）。 */
  onChanged?: () => void;
}) {
  const { docs, chunks, loading, error, reload } = useKnowledgeBase(directionId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  const onCountsRef = useRef(onCounts);
  useEffect(() => {
    onCountsRef.current = onCounts;
  }, [onCounts]);

  useEffect(() => {
    onCountsRef.current?.({ docs: docs.length, chunks: chunks.length });
  }, [docs.length, chunks.length]);

  const capacity = directionCapacity(docs);
  const totalChars = docs.reduce((sum, doc) => sum + doc.charCount, 0);
  const nameById = new Map(concepts.map((concept) => [concept.id, concept.name] as const));

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

    const storage = getDefaultKbStorage();
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
    const storage = getDefaultKbStorage();
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
          <p className="text-sm font-medium">知识库（仅本浏览器）</p>
          <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
            上传资料只存在本浏览器的 IndexedDB：不上传到服务器，不随方向公开、复制或换设备同步，
            方向市场里的副本默认是空库。只保存抽取后的文本与片段，不保存原始文件；本版本不做 OCR。
            引用抬头按实际来源显示，例如 [讲义·《文件名》·上传资料·第3页]（md / txt 没有页码时不带页码）。
          </p>
        </div>
        <span className="tabular shrink-0 text-xs text-[var(--ink-soft)]">
          {loading
            ? "读取中…"
            : `${docs.length} 份 · ${chunks.length} 段 · ${formatNumber(totalChars)} 字`}
        </span>
      </div>

      <p className="tabular mt-1 text-xs text-[var(--ink-faint)]">
        容量：{capacity.usedChunks}/{capacity.maxChunks} 段 ·{" "}
        {formatNumber(capacity.usedChars)}/{formatNumber(capacity.maxChars)} 字；剩余{" "}
        {capacity.remainingChunks} 段 · {formatNumber(capacity.remainingChars)} 字。装不下时整份文件会被拒绝，
        不会只导入一半。
      </p>

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
        onImported={afterChange}
      />

      {loading && docs.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">正在读取本地知识库…</p>
      ) : null}

      {!loading && docs.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">
          还没有上传资料。可以上传讲义、笔记或教材节选；没有绑定知识点的文档只会用于导师问答检索。
        </p>
      ) : null}

      {docs.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {docs.map((doc) => {
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
