"use client";

import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  type ArchiveContent,
  type ArchivedMessage,
  type ConversationSummary,
} from "./conversationContracts";
import {
  conversationRepository,
  type ConversationMode,
  type ConversationPatch,
} from "./conversationClient";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  streaming: boolean;
  checking: boolean;
}
export interface ConversationCodec<M> {
  hydrate: (record: ArchivedMessage) => M;
  content: (message: M) => ArchiveContent;
}
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "会话未能保存，请重试。";
function setUrl(id: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.delete("q");
  if (id) url.searchParams.set("chat", id);
  else url.searchParams.delete("chat");
  window.history.replaceState(window.history.state, "", url);
}

/** All async writes and UI dispatches are bound to the account and selected-conversation epoch. */
export function useConversations<M extends ChatMessage>({
  owner,
  ready,
  targetId,
  targetName,
  codec,
}: {
  owner: string | null;
  ready: boolean;
  targetId: string;
  targetName: string;
  codec: ConversationCodec<M>;
}) {
  const ownerKey = owner ?? "anonymous";
  const repo = conversationRepository(!!owner);
  const [messages, setVisibleMessages] = useState<M[]>([]);
  const [active, setActive] = useState<ConversationSummary | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [mode, setMode] = useState<ConversationMode>("active");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [storage, setStorage] = useState(owner ? "persistent" : "local");
  const [visibleOwner, setVisibleOwner] = useState(ownerKey);
  const [epoch, setEpoch] = useState(0);
  const [records, setRecords] = useState(new Map<string, ArchivedMessage>());
  const control = useRef({
    owner: ownerKey,
    epoch: 0,
    initialized: false,
    active: null as ConversationSummary | null,
    messages: [] as M[],
    records: new Map<string, ArchivedMessage>(),
    dirty: new Set<string>(),
    serverRunning: new Set<string>(),
    queue: Promise.resolve(),
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const scope = control.current;
  const publishRecords = () => setRecords(new Map(scope.records));
  const isCurrent = () => scope.owner === ownerKey && scope.epoch === epoch;
  const publishMessages = (next: M[]) => {
    scope.messages = next;
    setVisibleMessages(next);
  };
  const publishActive = (next: ConversationSummary | null) => {
    scope.active = next;
    setActive(next);
  };
  const setMessages = (action: SetStateAction<M[]>) => {
    if (!isCurrent()) return;
    const next = typeof action === "function" ? action(scope.messages) : action;
    for (const message of next) {
      if (scope.messages.find((item) => item.id === message.id) === message)
        continue;
      const record = scope.records.get(message.id);
      if (
        message.role === "assistant" &&
        record &&
        !record.inheritedFrom &&
        JSON.stringify(codec.content(message)) !==
          JSON.stringify(record.content)
      )
        scope.dirty.add(message.id);
    }
    publishMessages(next);
  };
  const flush = async () => {
    if (!isCurrent()) return;
    clearTimeout(scope.timer);
    const work = async () => {
      if (!isCurrent()) return;
      for (const id of [...scope.dirty]) {
        if (!isCurrent()) return;
        if (scope.serverRunning.has(id)) continue;
        const record = scope.records.get(id),
          message = scope.messages.find((item) => item.id === id);
        if (!record || !message || record.inheritedFrom) {
          scope.dirty.delete(id);
          continue;
        }
        const content = codec.content(message),
          serialized = JSON.stringify(content);
        setSaveState("saving");
        try {
          const saved = await repo.save(
            record,
            content,
            message.streaming
              ? "pending"
              : record.state === "interrupted"
                ? "interrupted"
                : "complete",
          );
          if (!isCurrent()) return;
          scope.records.set(id, saved);
          publishRecords();
          const latest = scope.messages.find((item) => item.id === id);
          if (latest && JSON.stringify(codec.content(latest)) === serialized)
            scope.dirty.delete(id);
          setError(null);
        } catch (failure) {
          if (isCurrent()) {
            setError(errorText(failure));
            setSaveState("error");
          }
          throw failure;
        }
      }
      if (isCurrent()) setSaveState(scope.dirty.size ? "saving" : "saved");
    };
    const queued = scope.queue.catch(() => undefined).then(work);
    scope.queue = queued;
    return queued;
  };
  const refresh = async (append = false) => {
    const stamp = scope.epoch;
    setListLoading(true);
    try {
      const result = await repo.list(
        mode,
        query,
        append ? (cursor ?? undefined) : undefined,
      );
      if (scope.owner !== ownerKey || scope.epoch !== stamp) return;
      setConversations((previous) =>
        append
          ? [
              ...previous,
              ...result.conversations.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : result.conversations,
      );
      setCursor(result.nextCursor);
      if (result.storage) setStorage(result.storage);
    } catch (failure) {
      if (scope.owner === ownerKey && scope.epoch === stamp)
        setError(errorText(failure));
    } finally {
      if (scope.owner === ownerKey && scope.epoch === stamp)
        setListLoading(false);
    }
  };
  const open = async (conversation: Pick<ConversationSummary, "id">) => {
    await flush();
    if (!isCurrent()) return;
    const stamp = ++scope.epoch;
    setEpoch(stamp);
    setLoading(true);
    setError(null);
    scope.serverRunning.clear();
    scope.dirty.clear();
    // Clear the previous conversation before waiting for the next account-bound response.
    publishMessages([]);
    publishActive(null);
    scope.records.clear();
    setBefore(null);
    try {
      const page = await repo.page(conversation.id);
      if (scope.owner !== ownerKey || scope.epoch !== stamp) return;
      scope.records = new Map(
        page.messages.map((record) => [record.id, record]),
      );
      publishRecords();
      publishActive(page.conversation);
      publishMessages(page.messages.map(codec.hydrate));
      setBefore(page.before);
      setSaveState("saved");
      setUrl(page.conversation.id);
      try {
        sessionStorage.setItem(
          `alp.tutor.last.${ownerKey}`,
          page.conversation.id,
        );
      } catch {
        /* URL still works */
      }
    } catch (failure) {
      if (scope.owner === ownerKey && scope.epoch === stamp)
        setError(errorText(failure));
    } finally {
      if (scope.owner === ownerKey && scope.epoch === stamp) setLoading(false);
    }
  };
  const newDraft = async () => {
    await flush();
    if (!isCurrent()) return;
    scope.epoch++;
    scope.records.clear();
    scope.dirty.clear();
    scope.serverRunning.clear();
    setEpoch(scope.epoch);
    publishRecords();
    publishActive(null);
    publishMessages([]);
    setBefore(null);
    setError(null);
    setSaveState("saved");
    setUrl(null);
  };
  useEffect(() => {
    if (!ready) return;
    if (scope.owner === ownerKey && scope.initialized) return;
    scope.owner = ownerKey;
    scope.epoch++;
    scope.initialized = true;
    scope.records.clear();
    scope.dirty.clear();
    scope.serverRunning.clear();
    clearTimeout(scope.timer);
    const stamp = scope.epoch;
    setEpoch(stamp);
    publishRecords();
    scope.messages = [];
    scope.active = null;
    setVisibleOwner(ownerKey);
    setVisibleMessages([]);
    setActive(null);
    setConversations([]);
    setLoading(true);
    setError(null);
    setBefore(null);
    setMode("active");
    setQuery("");
    setSaveState("saved");
    void (async () => {
      try {
        const list = await repo.list("active", "");
        if (scope.owner !== ownerKey || scope.epoch !== stamp) return;
        setConversations(list.conversations);
        setCursor(list.nextCursor);
        setStorage(list.storage ?? (owner ? "persistent" : "local"));
        const params = new URLSearchParams(window.location.search);
        let last: string | null = null;
        try {
          last = sessionStorage.getItem(`alp.tutor.last.${ownerKey}`);
        } catch {
          /* optional */
        }
        const wanted =
          params.get("chat") ??
          (params.has("q")
            ? null
            : (list.conversations.find(
                (item) => item.id === last && item.targetId === targetId,
              )?.id ??
              list.conversations.find((item) => item.targetId === targetId)
                ?.id));
        if (wanted) {
          const page = await repo.page(wanted);
          if (scope.owner !== ownerKey || scope.epoch !== stamp) return;
          scope.records = new Map(
            page.messages.map((record) => [record.id, record]),
          );
          scope.active = page.conversation;
          scope.messages = page.messages.map(codec.hydrate);
          publishRecords();
          setActive(page.conversation);
          setVisibleMessages(scope.messages);
          setBefore(page.before);
          setUrl(page.conversation.id);
        }
      } catch (failure) {
        if (scope.owner === ownerKey && scope.epoch === stamp)
          setError(errorText(failure));
      } finally {
        if (scope.owner === ownerKey && scope.epoch === stamp)
          setLoading(false);
      }
    })();
    // Target changes are explicit new drafts. Initial selection runs once per authenticated owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, ready]);
  useEffect(() => {
    if (!ready || !scope.initialized || scope.owner !== ownerKey) return;
    const timer = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, mode, query]);
  useEffect(() => {
    if (visibleOwner !== ownerKey || !scope.dirty.size) return;
    scope.timer = setTimeout(() => void flush().catch(() => undefined), 1000);
    return () => clearTimeout(scope.timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, ownerKey]);
  useEffect(() => {
    const save = () => {
      if (document.visibilityState === "hidden")
        void flush().catch(() => undefined);
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if (scope.dirty.size) {
        event.preventDefault();
        void flush().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", save);
    window.addEventListener("beforeunload", leaving);
    return () => {
      document.removeEventListener("visibilitychange", save);
      window.removeEventListener("beforeunload", leaving);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, ownerKey]);
  const begin = async (
    question: ArchiveContent,
    userId: string,
    assistantId: string,
  ) => {
    await flush();
    if (!isCurrent()) throw new Error("会话已切换，本次未发送。");
    let conversation = scope.active;
    if (conversation && conversation.targetId !== targetId)
      throw new Error("该会话课程暂不可用，请选择新会话。");
    if (!conversation) {
      conversation = await repo.create(targetId, targetName);
      if (!isCurrent()) throw new Error("会话已切换，本次未发送。");
      publishActive(conversation);
      setUrl(conversation.id);
    }
    const result = await repo.append(
      conversation,
      userId,
      assistantId,
      question,
    );
    if (!isCurrent()) throw new Error("会话已切换。");
    publishActive(result.conversation);
    scope.records.set(userId, result.user);
    scope.records.set(assistantId, result.assistant);
    publishRecords();
    publishMessages([
      ...scope.messages,
      codec.hydrate(result.user),
      { ...codec.hydrate(result.assistant), streaming: true },
    ]);
    setConversations((previous) => [
      result.conversation,
      ...previous.filter((item) => item.id !== result.conversation.id),
    ]);
    return result.conversation.id;
  };
  const serverFinished = async (id: string) => {
    const current = scope.active;
    if (!isCurrent() || !current) return;
    const record = await repo.message(current.id, id);
    if (!isCurrent()) return;
    const preserveContent = scope.serverRunning.has(id) || scope.dirty.has(id);
    scope.records.set(id, record);
    scope.serverRunning.delete(id);
    publishRecords();
    // Keep richer client verification text, but only the server supplies the teaching proof.
    publishMessages(
      scope.messages.map((item) =>
        item.id === id
          ? codec.hydrate(
              preserveContent
                ? { ...record, content: codec.content(item) }
                : record,
            )
          : item,
      ),
    );
  };
  const stop = async (id?: string) => {
    if (!isCurrent() || !scope.active) return;
    const pending = id
      ? scope.records.get(id)
      : [...scope.records.values()]
          .reverse()
          .find(
            (item) =>
              item.role === "assistant" &&
              item.state === "pending" &&
              !item.inheritedFrom,
          );
    if (!pending) return;
    const record = await repo.interrupt(scope.active.id, pending.id);
    if (!isCurrent()) return;
    scope.records.set(record.id, record);
    scope.serverRunning.delete(record.id);
    publishRecords();
    publishMessages(
      scope.messages.map((item) =>
        item.id === record.id
          ? { ...item, streaming: false, checking: false }
          : item,
      ),
    );
    scope.dirty.add(record.id);
    await flush();
  };
  const loadEarlier = async () => {
    if (!scope.active || !before || !isCurrent()) return;
    setLoading(true);
    try {
      const page = await repo.page(scope.active.id, before);
      if (!isCurrent()) return;
      for (const record of page.messages) scope.records.set(record.id, record);
      publishRecords();
      publishMessages([
        ...page.messages
          .filter((item) => !scope.messages.some((old) => old.id === item.id))
          .map(codec.hydrate),
        ...scope.messages,
      ]);
      setBefore(page.before);
    } catch (failure) {
      if (isCurrent()) setError(errorText(failure));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };
  const update = async (
    conversation: ConversationSummary,
    patch: ConversationPatch,
  ) => {
    try {
      await flush();
      if (!isCurrent()) return;
      const updated = await repo.update(conversation, patch);
      if (!isCurrent()) return;
      if (scope.active?.id === updated.id) publishActive(updated);
      await refresh();
    } catch (failure) {
      if (isCurrent()) setError(errorText(failure));
      throw failure;
    }
  };
  const branch = async (id: string) => {
    await flush();
    if (!isCurrent() || !scope.active) return;
    const fork = await repo.branch(scope.active.id, id);
    if (!isCurrent()) return;
    await open(fork); // open advances the epoch; refresh is handled by its caller after the new render.
    setConversations((previous) => [
      fork,
      ...previous.filter((item) => item.id !== fork.id),
    ]);
  };
  const currentOwner = visibleOwner === ownerKey;
  return {
    messages: currentOwner ? messages : [],
    setMessages,
    active: currentOwner ? active : null,
    conversations: currentOwner ? conversations : [],
    mode,
    setMode,
    query,
    setQuery,
    cursor,
    before,
    loading: !currentOwner || loading,
    listLoading,
    error: currentOwner ? error : null,
    saveState,
    storage,
    epoch,
    isCurrent,
    open,
    newDraft,
    begin,
    flush,
    refresh,
    loadEarlier,
    update,
    branch,
    stop,
    serverFinished,
    serverStarted: (id: string) => {
      if (isCurrent()) scope.serverRunning.add(id);
    },
    record: (id: string) => (currentOwner ? records.get(id) : undefined),
    writable:
      !active ||
      (!active.archived && !active.deletedAt && active.targetId === targetId),
  };
}
