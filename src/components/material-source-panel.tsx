"use client";

/**
 * 设置页的「知识口径」面板：来源优先级、口径分歧裁定与我的讲义。
 *
 * 面板只读当前学习目标，绝不调用 setTargetId：
 * useSubject 在自定义方向失效时会回落到默认学科，此时若仍允许保存，
 * 用户会以为写进了原方向、实际却写到数据结构名下。所以 targetError 非空时
 * 两个保存入口都停用，并把原因直接写在按钮旁边。
 *
 * 笔记在 MaterialNote 里没有页码字段（见 materials.ts：笔记不分页，不能编造页码），
 * 用户填的页码作为正文末尾的标注保存；引用抬头仍然不会凭空生成页码。
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel, Pill } from "@/components/ui";
import { chaptersOf } from "@/lib/chapters";
import { useSubject } from "@/lib/subject";
import { loadMaterials, saveMaterials, useMaterialPack } from "@/lib/materialStore";
import {
  MAX_NOTE_CHARS,
  describeSelection,
  detectConflicts,
  normalizeSelection,
  selectableSources,
  unresolvedConflicts,
  type MaterialClaim,
  type MaterialNote,
  type MaterialSelection,
} from "@/lib/materials";
import type { KnowledgeConcept } from "@/lib/graph";

/** 模型通用知识等于「不选任何来源」；用常量保持引用稳定，避免 useMemo 每帧重算。 */
const MODEL_SELECTION: MaterialSelection = { sourceIds: [], resolutions: {} };

/** 正文末尾的页码标注。只用于回显，不参与 citationLabel 的页码生成。 */
const NOTE_PAGE_PATTERN = /\n*（笔记页码：第(\d+)(?:–(\d+))?页）\s*$/;

type Basis = "model" | "materials";

interface Notice {
  readonly tone: "good" | "bad";
  readonly text: string;
}

/** 笔记 id 只要求在本地唯一；没有 randomUUID 的旧浏览器退回时间戳加随机后缀。 */
function createNoteId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MaterialSourcePanel() {
  const { target, targetId, ready, loadingTarget, targetError } = useSubject();
  const { pack, selection, notes, error: readError } = useMaterialPack(targetId, target?.graph);

  const [basis, setBasis] = useState<Basis>("model");
  const [draft, setDraft] = useState<MaterialSelection>(MODEL_SELECTION);
  const [dirty, setDirty] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<Notice | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [notePageFrom, setNotePageFrom] = useState("");
  const [notePageTo, setNotePageTo] = useState("");
  const [noteKcIds, setNoteKcIds] = useState<readonly string[]>([]);
  const [noteNotice, setNoteNotice] = useState<Notice | null>(null);

  /*
   * 存储里的选择由 hook 在挂载后异步读出，因此草稿要跟着 selection 走；
   * 但用户正在编辑（dirty）时绝不能覆盖，否则每保存一条笔记都会把未保存的口径改动冲掉。
   */
  useEffect(() => {
    if (dirty) return;
    setDraft(selection);
    setBasis(selection.sourceIds.length > 0 ? "materials" : "model");
  }, [selection, dirty]);

  // 切换目标时清空草稿与编辑表单：上一个目标的绑定关系不能带过来
  useEffect(() => {
    setDirty(false);
    setSelectionNotice(null);
    setEditingId(null);
    setNoteTitle("");
    setNoteBody("");
    setNotePageFrom("");
    setNotePageTo("");
    setNoteKcIds([]);
    setNoteNotice(null);
  }, [targetId]);

  const conceptById = useMemo(() => {
    const map = new Map<string, KnowledgeConcept>();
    for (const concept of target?.graph.concepts ?? []) map.set(concept.id, concept);
    return map;
  }, [target]);

  const chapters = useMemo(() => (target ? chaptersOf(target.graph) : []), [target]);

  const selectionForDisplay = basis === "model" ? MODEL_SELECTION : draft;

  const conflicts = useMemo(() => detectConflicts(pack), [pack]);
  const pending = useMemo(
    () => unresolvedConflicts(pack, selectionForDisplay),
    [pack, selectionForDisplay],
  );
  const pendingKeys = useMemo(() => new Set(pending.map((c) => c.key)), [pending]);

  /*
   * 覆盖数只统计当前选中的内置来源。未覆盖的知识点会回退模型通用知识，
   * 所以这里必须按「选中的来源」而不是整个 pack 算，否则一艘来源都没选也会显示全覆盖。
   */
  const coverage = useMemo(() => {
    const selected = new Set(selectionForDisplay.sourceIds);
    const covered = new Set<string>();
    for (const chunk of pack.chunks) {
      if (!selected.has(chunk.sourceId)) continue;
      for (const kcId of chunk.kcIds) covered.add(kcId);
    }
    const concepts = target?.graph.concepts ?? [];
    const missing = concepts.filter((c) => !covered.has(c.id));
    return {
      coveredCount: concepts.length - missing.length,
      missingCount: missing.length,
      total: concepts.length,
      missingNames: missing.map((c) => c.name),
    };
  }, [pack, selectionForDisplay, target]);

  // 来源覆盖哪些章节，从片段里推；按章号排序，避免字符串把第10章排到第2章前面
  const sourceChapters = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const chunk of pack.chunks) {
      const list = map.get(chunk.sourceId);
      if (!list) {
        map.set(chunk.sourceId, [chunk.chapter]);
        continue;
      }
      if (!list.includes(chunk.chapter)) list.push(chunk.chapter);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const na = /第\s*(\d+)\s*章/.exec(a);
        const nb = /第\s*(\d+)\s*章/.exec(b);
        if (na && nb && na[1] !== nb[1]) return Number(na[1]) - Number(nb[1]);
        if (na && !nb) return -1;
        if (!na && nb) return 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
    }
    return map;
  }, [pack]);

  // 页码只在两个输入都合法时才拼进正文；非法输入就地提示，不生成半截标注
  const pageFromNum = /^\d+$/.test(notePageFrom.trim()) ? Number(notePageFrom.trim()) : null;
  const pageToNum = /^\d+$/.test(notePageTo.trim()) ? Number(notePageTo.trim()) : null;
  const pageError =
    notePageFrom.trim() !== "" && (pageFromNum === null || pageFromNum < 1)
      ? "起始页必须是正整数"
      : notePageTo.trim() !== "" && (pageToNum === null || pageToNum < 1)
        ? "结束页必须是正整数"
        : notePageTo.trim() !== "" && pageFromNum === null
          ? "填了结束页就要同时填起始页"
          : pageFromNum !== null && pageToNum !== null && pageToNum < pageFromNum
            ? "结束页不能早于起始页"
            : null;

  const pageLabel =
    pageError === null && pageFromNum !== null
      ? pageToNum !== null && pageToNum !== pageFromNum
        ? `（笔记页码：第${pageFromNum}–${pageToNum}页）`
        : `（笔记页码：第${pageFromNum}页）`
      : "";
  const bodyForSave =
    noteBody.trim() === "" || pageLabel === ""
      ? noteBody
      : `${noteBody.replace(/\s+$/, "")}\n\n${pageLabel}`;
  const bodyLength = Array.from(noteBody).length;
  const savedBodyLength = Array.from(bodyForSave).length;

  function markDirty(): void {
    setDirty(true);
    setSelectionNotice(null);
  }

  function chooseBasis(next: Basis): void {
    setBasis(next);
    setSelectionNotice(null);
    setDirty(true);
    // 教材口径必须先有来源才能保存；默认勾第一本，避免「选了教材却什么都没引用」
    if (next === "materials") {
      const first = selectableSources(pack)[0];
      if (first) {
        setDraft((prev) =>
          prev.sourceIds.length === 0 ? { ...prev, sourceIds: [first.id] } : prev,
        );
      }
    }
  }

  function toggleSource(id: string, checked: boolean): void {
    setDraft((prev) => {
      if (checked) {
        if (prev.sourceIds.includes(id)) return prev;
        return { ...prev, sourceIds: [...prev.sourceIds, id] };
      }
      return { ...prev, sourceIds: prev.sourceIds.filter((x) => x !== id) };
    });
    markDirty();
  }

  function moveSource(id: string, delta: -1 | 1): void {
    setDraft((prev) => {
      const ids = [...prev.sourceIds];
      const index = ids.indexOf(id);
      const next = index + delta;
      if (index < 0 || next < 0 || next >= ids.length) return prev;
      [ids[index], ids[next]] = [ids[next], ids[index]];
      return { ...prev, sourceIds: ids };
    });
    markDirty();
  }

  function chooseClaim(conflictKey: string, claimId: string): void {
    setDraft((prev) => ({
      ...prev,
      resolutions: { ...prev.resolutions, [conflictKey]: claimId },
    }));
    markDirty();
  }

  function clearClaim(conflictKey: string): void {
    setDraft((prev) => {
      const resolutions = { ...prev.resolutions };
      delete resolutions[conflictKey];
      return { ...prev, resolutions };
    });
    markDirty();
  }

  function saveSelection(): void {
    if (!target || targetError) return;
    const current = loadMaterials();
    const nextSelection = normalizeSelection(selectionForDisplay, pack);
    const result = saveMaterials({
      ...current,
      targets: { ...current.targets, [targetId]: nextSelection },
    });
    if (!result.ok) {
      setSelectionNotice({ tone: "bad", text: result.error });
      return;
    }
    setDraft(result.state.targets[targetId] ?? nextSelection);
    setDirty(false);
    setSelectionNotice({ tone: "good", text: "口径选择已保存到本浏览器。" });
  }

  function clearNoteForm(): void {
    setEditingId(null);
    setNoteTitle("");
    setNoteBody("");
    setNotePageFrom("");
    setNotePageTo("");
    setNoteKcIds([]);
  }

  function startNewNote(): void {
    clearNoteForm();
    setNoteNotice(null);
  }

  function editNote(note: MaterialNote): void {
    const match = NOTE_PAGE_PATTERN.exec(note.body);
    setEditingId(note.id);
    setNoteTitle(note.title);
    setNoteBody(match ? note.body.slice(0, match.index) : note.body);
    setNotePageFrom(match ? match[1] : "");
    setNotePageTo(match && match[2] ? match[2] : "");
    setNoteKcIds(note.kcIds);
    setNoteNotice(null);
  }

  function saveNote(): void {
    if (!target || targetError || pageError !== null) return;
    const title = noteTitle.trim();
    const id = editingId ?? createNoteId();
    const note: MaterialNote = { id, title, body: bodyForSave, kcIds: [...noteKcIds] };

    /*
     * 重新读一次存档再写：面板里可能只改了笔记，不能拿挂载时的旧快照
     * 覆盖另一个标签页刚保存的来源选择。校验与写入异常全部由 saveMaterials 返回，
     * 原文显示，不在这里吞掉。
     */
    const current = loadMaterials();
    const nextNotes = editingId
      ? current.notes.map((item) => (item.id === editingId ? note : item))
      : [...current.notes, note];
    const result = saveMaterials({ ...current, notes: nextNotes });
    if (!result.ok) {
      setNoteNotice({ tone: "bad", text: result.error });
      return;
    }
    setNoteNotice({
      tone: "good",
      text: `讲义《${title || "未命名"}》已保存，仅存在本浏览器。`,
    });
    clearNoteForm();
  }

  function deleteNote(note: MaterialNote): void {
    if (typeof window !== "undefined" && !window.confirm(`删除讲义《${note.title}》？`)) return;
    const current = loadMaterials();
    const result = saveMaterials({
      ...current,
      notes: current.notes.filter((item) => item.id !== note.id),
    });
    if (!result.ok) {
      setNoteNotice({ tone: "bad", text: result.error });
      return;
    }
    if (editingId === note.id) clearNoteForm();
    setNoteNotice({ tone: "good", text: `已删除讲义《${note.title}》。` });
  }

  function speakerOf(claim: MaterialClaim): string {
    if (claim.sourceId !== undefined) {
      const source = pack.sources.find((item) => item.id === claim.sourceId);
      if (source) return `《${source.title}》`;
    }
    return claim.basis === "model" ? "模型" : claim.basis === "textbook" ? "教材" : "讲义";
  }

  const saveDisabled = !ready || targetError !== null || target === null;

  return (
    <div className="space-y-4">
      {/* ── 当前目标（只读） ── */}
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-[var(--ink-soft)]">当前学习目标</span>
          {target ? (
            <>
              <Pill tone="accent">{target.name}</Pill>
              <span className="text-xs text-[var(--ink-faint)]">
                {target.kind === "subject" ? "内置学科" : "自定义方向"} ·{" "}
                {target.graph.concepts.length} 个知识点
              </span>
            </>
          ) : (
            <Pill tone="neutral">读取中</Pill>
          )}
          {loadingTarget ? (
            <span className="text-xs text-[var(--ink-faint)]">正在加载方向…</span>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-faint)]">
          这里只读显示当前目标，不会改动全局选择。要切换目标，请到诊断页重新选择。
        </p>

        {targetError ? (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-3 text-sm"
          >
            <p className="font-medium text-[var(--bad)]">目标加载失败，当前显示的是回落学科</p>
            <p className="mt-1 text-[var(--ink-soft)]">{targetError}</p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">
              下面显示的不是你以为的那个方向。为避免把选择写到错误目标名下，本面板的保存已停用。
            </p>
            <Link href="/diagnose" className="mt-2 inline-block text-sm underline">
              去诊断页重新选择目标
            </Link>
          </div>
        ) : null}

        {readError ? (
          <p role="alert" className="mt-2 text-xs text-[var(--bad)]">
            {readError}
          </p>
        ) : null}
      </Panel>

      {/* ── 口径基源 ── */}
      <Panel>
        <p className="text-sm font-medium">口径基源</p>
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          只影响生成时的引用与出处，不改变已经记录的学习进度。
        </p>

        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line-strong)] p-3">
            <input
              type="radio"
              name="material-basis"
              value="model"
              checked={basis === "model"}
              onChange={() => chooseBasis("model")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">模型通用知识（默认）</span>
              <span className="block text-xs text-[var(--ink-soft)]">
                不引用具体书目，行为与之前的生成完全一致。模型生成的说法只作为依据，不会伪装成《某教材》。
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--line-strong)] p-3">
            <input
              type="radio"
              name="material-basis"
              value="materials"
              checked={basis === "materials"}
              onChange={() => chooseBasis("materials")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">教材与讲义</span>
              <span className="block text-xs text-[var(--ink-soft)]">
                按来源优先级引用所选材料；未覆盖的知识点回退模型通用知识，不编造页码。
                目标有内置来源时，切换后会默认选中第一个，可以再自行增删。
              </span>
            </span>
          </label>
        </div>

        <p className="mt-3 rounded-lg bg-[var(--line)] px-3 py-2 text-sm">
          当前口径：{describeSelection(pack, selectionForDisplay)}
        </p>
        {basis === "materials" && pack.sources.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--warn)]">
            当前目标没有内置资料包，教材口径只能靠「我的讲义」。保存空来源后，口径基源会回到模型通用知识。
          </p>
        ) : basis === "materials" && selectionForDisplay.sourceIds.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--warn)]">
            还没有选中任何来源，保存后等同模型通用知识。
          </p>
        ) : null}
        {basis === "model" ? (
          <p className="mt-1 text-xs text-[var(--ink-faint)]">
            保存会把该目标的口径选择清空；已保存的讲义仍会保留，可随时切回教材口径继续使用。
          </p>
        ) : null}
      </Panel>

      {basis === "materials" ? (
        <>
          {/* ── 来源与优先级 ── */}
          <Panel>
            <p className="text-sm font-medium">内置资料包来源</p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              勾选参与引用的来源，用箭头调整优先级（越靠前越优先）。
            </p>

            {pack.sources.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--ink-soft)]">
                当前目标没有内置资料包。可以在下面「我的讲义」里粘贴自己的讲义，绑定知识点后同样能进入引用。
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {selectableSources(pack).map((source) => {
                  const checked = selectionForDisplay.sourceIds.includes(source.id);
                  const rank = selectionForDisplay.sourceIds.indexOf(source.id);
                  const cover = sourceChapters.get(source.id) ?? [];
                  return (
                    <li
                      key={source.id}
                      className={`rounded-lg border p-3 ${
                        checked
                          ? "border-[var(--accent)]"
                          : "border-[var(--line-strong)]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleSource(source.id, e.target.checked)}
                          aria-label={`选择来源《${source.title}》`}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">《{source.title}》</span>
                            <Pill tone={source.kind === "textbook" ? "accent" : "neutral"}>
                              {source.kind === "textbook" ? "教材" : "讲义"}
                            </Pill>
                            {source.edition ? (
                              <span className="text-xs text-[var(--ink-faint)]">
                                {source.edition}
                              </span>
                            ) : null}
                            {source.year ? (
                              <span className="text-xs text-[var(--ink-faint)]">
                                {source.year}
                              </span>
                            ) : null}
                            {checked ? (
                              <Pill tone="good">优先级 {rank + 1}</Pill>
                            ) : (
                              <span className="text-xs text-[var(--ink-faint)]">未选</span>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                            {[source.author, source.publisher].filter(Boolean).join(" · ") ||
                              "未提供作者与出版信息"}
                          </p>
                          <p className="mt-1 text-xs text-[var(--ink-soft)]">
                            覆盖章节：
                            {cover.length > 0 ? cover.join("、") : "未提供片段"}
                          </p>
                          {source.note ? (
                            <p className="mt-1 text-xs text-[var(--ink-faint)]">{source.note}</p>
                          ) : null}
                        </div>

                        {checked ? (
                          <div className="flex shrink-0 flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => moveSource(source.id, -1)}
                              disabled={rank === 0}
                              aria-label={`提高《${source.title}》的优先级`}
                              className="rounded border border-[var(--line-strong)] px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSource(source.id, 1)}
                              disabled={rank === selectionForDisplay.sourceIds.length - 1}
                              aria-label={`降低《${source.title}》的优先级`}
                              className="rounded border border-[var(--line-strong)] px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              ↓
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4 rounded-lg bg-[var(--line)] px-3 py-2 text-sm">
              {selectionForDisplay.sourceIds.length === 0 ? (
                <p>
                  尚未选择来源：全部 {coverage.total} 个知识点回退模型通用知识，不编造页码。
                </p>
              ) : (
                <p>
                  已覆盖 {coverage.coveredCount} / {coverage.total} 个知识点
                  {coverage.missingCount > 0
                    ? `，未覆盖 ${coverage.missingCount} 个`
                    : "，全部覆盖"}
                  。
                </p>
              )}
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                未覆盖的知识点回退模型通用知识，不编造页码。
                {notes.length > 0
                  ? " 「我的讲义」按绑定知识点另外补充，不计入上面的来源覆盖数。"
                  : ""}
              </p>
              {coverage.missingNames.length > 0 ? (
                <details className="mt-2 text-xs text-[var(--ink-soft)]">
                  <summary className="cursor-pointer">
                    查看未覆盖的知识点（{coverage.missingCount}）
                  </summary>
                  <p className="mt-1">{coverage.missingNames.join("、")}</p>
                </details>
              ) : null}
            </div>
          </Panel>

          {/* ── 口径分歧 ── */}
          <Panel>
            <p className="text-sm font-medium">口径分歧</p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              同一知识点在不同来源说法不一致时，由你决定按哪一家的口径。
              未选定时生成会同时给出两种说法，不替你做选择。
            </p>

            {conflicts.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--ink-soft)]">
                当前资料包没有检测到口径分歧。
              </p>
            ) : (
              <ul className="mt-3 space-y-4">
                {conflicts.map((conflict) => {
                  const unresolved = pendingKeys.has(conflict.key);
                  const chosen = unresolved
                    ? undefined
                    : conflict.claims.find(
                        (claim) => claim.id === selectionForDisplay.resolutions[conflict.key],
                      );
                  return (
                    <li
                      key={conflict.key}
                      className="rounded-lg border border-[var(--line-strong)] p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {conceptById.get(conflict.kcId)?.name ?? conflict.kcId}
                        </span>
                        <span className="text-xs text-[var(--ink-faint)]">
                          争议维度：{conflict.topic}
                        </span>
                        {unresolved ? (
                          <Pill tone="warn">待选定</Pill>
                        ) : (
                          <Pill tone="good">已选定</Pill>
                        )}
                      </div>

                      <div className="mt-2 space-y-2">
                        {conflict.claims.map((claim) => {
                          const speaker = speakerOf(claim);
                          const active = chosen?.id === claim.id;
                          const fromSelectedSource =
                            claim.sourceId !== undefined &&
                            selectionForDisplay.sourceIds.includes(claim.sourceId);
                          return (
                            <div
                              key={claim.id}
                              className={`rounded-lg border p-2 ${
                                active
                                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                                  : "border-[var(--line)]"
                              }`}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => chooseClaim(conflict.key, claim.id)}
                                  aria-pressed={active}
                                  className={`rounded-lg px-3 py-1 text-sm transition-colors ${
                                    active
                                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                                  }`}
                                >
                                  {active ? "✓ " : ""}按{speaker}口径
                                </button>
                                <span className="text-xs text-[var(--ink-faint)]">
                                  {claim.pageFrom !== undefined
                                    ? `第${claim.pageFrom}${
                                        claim.pageTo !== undefined &&
                                        claim.pageTo !== claim.pageFrom
                                          ? `–${claim.pageTo}`
                                          : ""
                                      }页`
                                    : "未标页码"}
                                  {claim.sourceId !== undefined && !fromSelectedSource
                                    ? " · 该来源未选入"
                                    : ""}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                                {speaker} 称「{claim.statement}」
                              </p>
                            </div>
                          );
                        })}
                      </div>

                      {chosen ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm text-[var(--good)]">
                            已按{speakerOf(chosen)}口径：{chosen.statement}
                          </p>
                          <button
                            type="button"
                            onClick={() => clearClaim(conflict.key)}
                            className="text-xs text-[var(--ink-soft)] underline"
                          >
                            改回未选定
                          </button>
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-[var(--warn)]">
                          尚未选定：生成时会同时列出两种说法，不替你做选择。
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </>
      ) : null}

      {/* ── 保存口径 ── */}
      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveSelection}
            disabled={saveDisabled || !dirty}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存口径选择
          </button>
          {dirty ? <Pill tone="warn">有未保存的改动</Pill> : <Pill tone="good">已保存</Pill>}
          {!targetError && !dirty ? (
            <span className="text-xs text-[var(--ink-faint)]">
              {basis === "model"
                ? "当前目标按模型通用知识生成。"
                : "来源顺序与分歧裁定会一起保存。"}
            </span>
          ) : null}
        </div>
        {targetError ? (
          <p className="mt-2 text-xs text-[var(--bad)]">保存已禁用：{targetError}</p>
        ) : null}
        {!ready ? (
          <p className="mt-2 text-xs text-[var(--ink-faint)]">
            正在读取当前学习目标，读完才能保存。
          </p>
        ) : null}
        <NoticeView notice={selectionNotice} />
      </Panel>

      {/* ── 我的讲义 ── */}
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">我的讲义</p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              粘贴自己的讲义并绑定知识点；本卡片只收粘贴文本，Markdown / TXT / PDF
              请用方向页的知识库上传（PDF 需自带文本层，扫描件不做 OCR）。
              正文只存本浏览器；出题或讲解时命中的段落会随请求直接发给你配置的模型供应商。
              保存后回上面的来源列表勾选《我的讲义》才会生效。
            </p>
          </div>
          <button
            type="button"
            onClick={startNewNote}
            className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm text-[var(--ink-soft)] hover:bg-[var(--line)]"
          >
            ＋ 新建讲义
          </button>
        </div>

        {notes.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">还没有讲义。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notes.map((note) => {
              const match = NOTE_PAGE_PATTERN.exec(note.body);
              const preview = (match ? note.body.slice(0, match.index) : note.body).trim();
              const kcNames = note.kcIds.map((id) => conceptById.get(id)?.name ?? id);
              return (
                <li
                  key={note.id}
                  className="rounded-lg border border-[var(--line-strong)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{note.title}</span>
                    {match ? (
                      <Pill tone="neutral">
                        页码 第{match[1]}
                        {match[2] ? `–${match[2]}` : ""}页
                      </Pill>
                    ) : null}
                    <span className="text-xs text-[var(--ink-faint)]">
                      绑定 {note.kcIds.length} 个知识点
                    </span>
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={() => editNote(note)}
                        className="text-xs text-[var(--ink-soft)] underline"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteNote(note)}
                        className="text-xs text-[var(--bad)] underline"
                      >
                        删除
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {kcNames.slice(0, 8).join("、")}
                    {kcNames.length > 8 ? ` 等 ${kcNames.length} 个` : ""}
                  </p>
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">
                    {preview === ""
                      ? "（正文为空）"
                      : `${preview.slice(0, 120)}${preview.length > 120 ? "…" : ""}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{editingId ? "编辑讲义" : "新建讲义"}</p>
            {editingId ? (
              <button
                type="button"
                onClick={clearNoteForm}
                className="text-xs text-[var(--ink-soft)] underline"
              >
                取消编辑
              </button>
            ) : null}
          </div>

          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="block text-sm font-medium">标题</span>
              <input
                value={noteTitle}
                onChange={(e) => {
                  setNoteTitle(e.target.value);
                  setNoteNotice(null);
                }}
                className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                placeholder="例如：第 3 章 栈与队列课堂笔记"
              />
            </label>

            <div>
              <p className="text-sm font-medium">绑定对象</p>
              <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                {target?.kind === "subject"
                  ? "内置学科按章节多选，保存时展开成该章全部知识点。"
                  : target?.kind === "direction"
                    ? "自定义方向按知识点多选。"
                    : "学习目标就绪后才能绑定。"}
              </p>

              {target?.kind === "subject" ? (
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {chapters.map((chapter) => {
                    const selectedCount = chapter.kcIds.filter((id) =>
                      noteKcIds.includes(id),
                    ).length;
                    return (
                      <label
                        key={chapter.name}
                        className="flex items-start gap-2 rounded-lg border border-[var(--line)] px-2 py-1.5 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedCount === chapter.count}
                          onChange={(e) => {
                            const ids = chapter.kcIds;
                            setNoteKcIds((prev) => {
                              const set = new Set(prev);
                              if (e.target.checked) {
                                for (const id of ids) set.add(id);
                              } else {
                                for (const id of ids) set.delete(id);
                              }
                              return [...set];
                            });
                            setNoteNotice(null);
                          }}
                          className="mt-1"
                        />
                        <span className="min-w-0">
                          <span className="block">{chapter.name}</span>
                          <span className="block text-xs text-[var(--ink-faint)]">
                            {selectedCount}/{chapter.count} 个知识点
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}

              {target?.kind === "direction" ? (
                <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-[var(--line)] p-2">
                  {chapters.map((chapter) => (
                    <div key={chapter.name}>
                      <p className="text-xs font-medium text-[var(--ink-faint)]">
                        {chapter.name}
                      </p>
                      {chapter.kcIds.map((kcId) => {
                        const concept = conceptById.get(kcId);
                        return (
                          <label key={kcId} className="flex items-start gap-2 py-0.5 text-sm">
                            <input
                              type="checkbox"
                              checked={noteKcIds.includes(kcId)}
                              onChange={(e) => {
                                setNoteKcIds((prev) => {
                                  if (!e.target.checked) {
                                    return prev.filter((id) => id !== kcId);
                                  }
                                  return prev.includes(kcId) ? prev : [...prev, kcId];
                                });
                                setNoteNotice(null);
                              }}
                              className="mt-1"
                            />
                            <span>
                              {concept?.name ?? kcId}
                              <span className="ml-1 text-xs text-[var(--ink-faint)]">
                                {concept?.summary}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : null}

              <p className="mt-1 text-xs text-[var(--ink-faint)]">
                已绑定 {noteKcIds.length} 个知识点
              </p>
              {noteKcIds.some((id) => !conceptById.has(id)) ? (
                <p className="mt-1 text-xs text-[var(--warn)]">
                  其中部分绑定属于其他学习目标，当前目标看不到对应选项；保存会原样保留它们。
                </p>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="block text-sm font-medium">起始页（可选）</span>
                <input
                  value={notePageFrom}
                  onChange={(e) => {
                    setNotePageFrom(e.target.value);
                    setNoteNotice(null);
                  }}
                  inputMode="numeric"
                  placeholder="例如 45"
                  className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium">结束页（可选）</span>
                <input
                  value={notePageTo}
                  onChange={(e) => {
                    setNotePageTo(e.target.value);
                    setNoteNotice(null);
                  }}
                  inputMode="numeric"
                  placeholder="不填则只记起始页"
                  className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </label>
            </div>
            {pageError ? <p className="text-xs text-[var(--bad)]">{pageError}</p> : null}
            <p className="text-xs text-[var(--ink-faint)]">
              笔记没有独立的页码字段，页码会作为正文末尾的标注保存；引用抬头不会因此编造页码。
            </p>

            <label className="block">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">正文</span>
                <span
                  className={`tabular text-xs ${
                    savedBodyLength > MAX_NOTE_CHARS
                      ? "text-[var(--bad)]"
                      : "text-[var(--ink-faint)]"
                  }`}
                >
                  {bodyLength} / {MAX_NOTE_CHARS} 字
                  {pageLabel !== "" ? `（含页码标注共 ${savedBodyLength} 字）` : ""}
                </span>
              </span>
              <textarea
                value={noteBody}
                onChange={(e) => {
                  setNoteBody(e.target.value);
                  setNoteNotice(null);
                }}
                rows={8}
                className="mt-1 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                placeholder="粘贴讲义或课堂笔记正文。首版不解析 PDF / PPT。"
              />
            </label>
            {savedBodyLength > MAX_NOTE_CHARS ? (
              <p className="text-xs text-[var(--bad)]">
                超过单条上限 {MAX_NOTE_CHARS} 字，保存会被 store 拒绝。
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveNote}
                disabled={!ready || targetError !== null || !target || pageError !== null}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {editingId ? "保存修改" : "保存讲义"}
              </button>
              {targetError ? (
                <span className="text-xs text-[var(--bad)]">保存已禁用：{targetError}</span>
              ) : null}
            </div>
            <NoticeView notice={noteNotice} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

/** 成功与失败共用一块提示；失败用 role="alert"，读屏不会漏掉。 */
function NoticeView({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  const tone =
    notice.tone === "good"
      ? "border-[var(--good)] bg-[var(--good-soft)] text-[var(--good)]"
      : "border-[var(--bad)] bg-[var(--bad-soft)] text-[var(--bad)]";
  return (
    <p
      role={notice.tone === "bad" ? "alert" : "status"}
      className={`mt-2 rounded-lg border px-3 py-2 text-sm ${tone}`}
    >
      {notice.text}
    </p>
  );
}
