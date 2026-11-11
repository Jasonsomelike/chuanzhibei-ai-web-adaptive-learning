"use client";

import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  GitBranch,
  History,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { AppDialog } from "./primitives/dialog";
import type { ConversationSummary } from "@/lib/conversationContracts";
import type {
  ConversationMode,
  ConversationPatch,
} from "@/lib/conversationClient";

export function ConversationSidebar({
  items,
  activeId,
  mode,
  query,
  loading,
  more,
  storage,
  disabled,
  onMode,
  onQuery,
  onOpen,
  onNew,
  onUpdate,
  onMore,
  onLegacy,
}: {
  items: ConversationSummary[];
  activeId?: string;
  mode: ConversationMode;
  query: string;
  loading: boolean;
  more: boolean;
  storage: string;
  disabled: boolean;
  onMode: (mode: ConversationMode) => void;
  onQuery: (query: string) => void;
  onOpen: (item: ConversationSummary) => void;
  onNew: () => void;
  onUpdate: (
    item: ConversationSummary,
    patch: ConversationPatch,
  ) => Promise<void>;
  onMore: () => void;
  onLegacy?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState<ConversationSummary | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manage = (item: ConversationSummary) => {
    setManaging(item);
    setTitle(item.title);
    setError(null);
  };
  const update = async (patch: ConversationPatch) => {
    if (!managing || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate(managing, patch);
      setManaging(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "会话操作失败。");
    } finally {
      setSaving(false);
    }
  };
  const contents = (
    <div className="conversation-sidebar-content">
      <button
        type="button"
        className="conversation-new"
        disabled={disabled}
        onClick={() => {
          onNew();
          setOpen(false);
        }}
      >
        <Plus size={20} />
        新建会话
      </button>
      <label className="conversation-search">
        <Search size={17} />
        <input
          aria-label="搜索会话"
          placeholder="搜索会话"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </label>
      <div className="conversation-list-heading">
        <h2>
          {mode === "active"
            ? "最近"
            : mode === "archived"
              ? "已归档"
              : "回收站"}
        </h2>
        <span>
          {items.length}
          {more ? "+" : ""}
        </span>
      </div>
      <div className="conversation-list" aria-busy={loading}>
        {loading && !items.length ? (
          <div className="conversation-skeleton" aria-label="正在读取会话">
            <i />
            <i />
            <i />
          </div>
        ) : null}
        {!loading && !items.length ? (
          <p className="conversation-empty-list">
            {query
              ? "没有匹配的会话。"
              : mode === "active"
                ? "从一个具体的问题开始，聊过的内容会留在这里。"
                : "这里还没有会话。"}
          </p>
        ) : null}
        {items.map((item) => (
          <div
            key={item.id}
            className={`conversation-row ${item.id === activeId ? "is-active" : ""}`}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                onOpen(item);
                setOpen(false);
              }}
              aria-current={item.id === activeId ? "page" : undefined}
              title={item.title}
            >
              <span>
                {item.parentId ? (
                  <GitBranch size={13} aria-label="分支" />
                ) : item.pinned ? (
                  <Pin size={13} aria-label="置顶" />
                ) : null}
                {item.title}
              </span>
              <small>{item.targetName}</small>
            </button>
            <button
              type="button"
              className="conversation-more"
              disabled={disabled}
              aria-label={`管理会话：${item.title}`}
              onClick={() => manage(item)}
            >
              <MoreHorizontal size={19} />
            </button>
          </div>
        ))}
        {more ? (
          <button
            type="button"
            className="conversation-load-more"
            disabled={loading}
            onClick={onMore}
          >
            加载更多会话
          </button>
        ) : null}
      </div>
      <div className="conversation-folders">
        {(
          [
            ["active", History, "最近会话"],
            ["archived", Archive, "已归档"],
            ["trash", Trash2, "回收站"],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onMode(value)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
        {onLegacy ? (
          <button type="button" onClick={onLegacy}>
            <History size={18} />
            旧版教学记录
          </button>
        ) : null}
      </div>
      <p className="conversation-storage">
        {storage === "local"
          ? "会话保存在此浏览器。登录后新建的会话随账号同步。"
          : storage === "temporary"
            ? "当前使用临时服务存储，服务重启后会清空；接入数据库后可长期同步。"
            : "会话随账号保存，可在其他设备继续。"}
      </p>
    </div>
  );
  return (
    <>
      <aside className="conversation-sidebar" aria-label="历史会话">
        {!open ? contents : null}
      </aside>
      <div className="conversation-mobile">
        <AppDialog
          open={open}
          onOpenChange={setOpen}
          drawer
          title="历史会话"
          description="选择历史继续聊，或管理会话与分支。"
          trigger={
            <button
              type="button"
              className="icon-button"
              aria-label="打开历史会话"
            >
              <History size={21} />
            </button>
          }
        >
          {open ? contents : null}
        </AppDialog>
      </div>
      <AppDialog
        open={!!managing}
        onOpenChange={(value) => {
          if (!value && !saving) setManaging(null);
        }}
        title="管理会话"
        description={
          managing?.targetName ?? "修改名称、置顶、归档或移入回收站。"
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void update({ title: title.trim() });
          }}
          className="conversation-manage-form"
        >
          <label>
            会话名称
            <input
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={saving || !title.trim()}>
            <Pencil size={17} />
            保存名称
          </button>
        </form>
        <div className="conversation-manage-actions">
          <button
            type="button"
            disabled={saving}
            onClick={() => void update({ pinned: !managing?.pinned })}
          >
            <Pin size={18} />
            {managing?.pinned ? "取消置顶" : "置顶会话"}
          </button>
          {!managing?.deletedAt ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void update({ archived: !managing?.archived })}
            >
              {managing?.archived ? (
                <ArchiveRestore size={18} />
              ) : (
                <Archive size={18} />
              )}
              {managing?.archived ? "取消归档" : "归档会话"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={() => void update({ trash: !managing?.deletedAt })}
          >
            {managing?.deletedAt ? (
              <ArchiveRestore size={18} />
            ) : (
              <Trash2 size={18} />
            )}
            {managing?.deletedAt ? "恢复会话" : "移入回收站"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[var(--bad)]">
            {error}
          </p>
        ) : null}
      </AppDialog>
    </>
  );
}
