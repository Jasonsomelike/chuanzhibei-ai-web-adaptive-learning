/**
 * 记忆卡：错题与易混点的复习队列。
 *
 * 纯函数模块：所有时间由调用方通过 `now` 传入，不读系统时钟、不调随机数，
 * 也不接触网络与存储。记忆卡只记录「错过什么、何时再看」，
 * 不参与掌握度的贝叶斯更新。
 */

export type MemoryKind = "error" | "confusion";
export type MemoryStatus = "open" | "resolved";

/** 一张记忆卡。错题与易混共用同一形状，用 kind 区分。 */
export interface MemoryItem {
  /** 错题 `mem-error-<questionId>`；易混 `mem-conf-<kcId>-<withKcId>`。 */
  readonly id: string;
  readonly kind: MemoryKind;
  readonly kcId: string;
  /** 仅易混卡：与之混淆的知识点。 */
  readonly withKcId?: string;
  /** 仅错题卡。 */
  readonly questionId?: string;
  /** 题干，最多 200 个码点。 */
  readonly prompt: string;
  /** 学生选错的选项文本。 */
  readonly chosen?: string;
  /** 正确答案 + 解析，最多 600 个码点。 */
  readonly correction: string;
  readonly note?: string;
  /** ISO 时间戳。 */
  readonly createdAt: string;
  /** ISO 时间戳；复习或重做都会刷新。 */
  readonly lastSeenAt: string;
  readonly status: MemoryStatus;
  readonly resolvedAt?: string;
  /** 连续「记住了」的次数，0–4。 */
  readonly streak: number;
  /** 总复习/重做次数，仅展示。 */
  readonly reviewCount: number;
}

/** 每学科最多保留的记忆卡数。满时先清理已解决卡，全 open 才拒绝新增。 */
export const MAX_MEMORIES = 200;

/** 到期阶梯：按 streak 取对应天数。 */
export const REVIEW_INTERVALS_DAYS = [1, 3, 7, 21] as const;

/** 连续答对（自评「记住了」）多少次后毕业。 */
export const GRADUATION_STREAK = 4;

/** 已解决的卡片保留多久后再参与容量清理。 */
export const RESOLVED_RETENTION_DAYS = 90;

export const MAX_PROMPT_CHARS = 200;
export const MAX_CORRECTION_CHARS = 600;

const MS_PER_DAY = 86_400_000;

export interface ErrorMemoryInput {
  readonly questionId: string;
  readonly kcId: string;
  readonly prompt: string;
  readonly chosen?: string;
  readonly correction: string;
  readonly note?: string;
  readonly now: string;
}

export interface ConfusionMemoryInput {
  readonly kcId: string;
  readonly withKcId: string;
  /** 卡片正面展示的提示，例如「把导数与微分搞混」。 */
  readonly prompt: string;
  /** 两者的区别；缺省为空串。 */
  readonly correction?: string;
  readonly note?: string;
  readonly now: string;
}

/** 写入结果。容量拒绝时 memories 原样返回，warning 由页面展示。 */
export interface MemoryWriteResult {
  readonly memories: readonly MemoryItem[];
  readonly warning?: string;
}

export interface MemoryStats {
  /** 状态为 open 的卡片数。 */
  readonly open: number;
  /** 其中已经到期的张数。 */
  readonly due: number;
  readonly resolved: number;
  /** 按 kind 统计全部卡片（含已解决）。 */
  readonly error: number;
  readonly confusion: number;
}

export function errorMemoryId(questionId: string): string {
  return `mem-error-${questionId}`;
}

export function confusionMemoryId(kcId: string, withKcId: string): string {
  return `mem-conf-${kcId}-${withKcId}`;
}

/**
 * 写入一张错题卡。同一道题再次答错只更新原卡（lapse：streak 归零、状态回到 open），
 * 不占新容量，也不会因为容量已满而被拒绝。
 */
export function upsertErrorMemory(
  memories: readonly MemoryItem[],
  input: ErrorMemoryInput,
): MemoryWriteResult {
  const id = errorMemoryId(input.questionId);
  const existing = memories.find((item) => item.id === id);
  if (existing) {
    return {
      memories: memories.map((item) =>
        item.id === id
          ? redoItem(
              item,
              {
                kcId: input.kcId,
                prompt: input.prompt,
                correction: input.correction,
                chosen: input.chosen,
                note: input.note,
              },
              input.now,
            )
          : item,
      ),
    };
  }

  const item: MemoryItem = {
    id,
    kind: "error",
    kcId: input.kcId,
    questionId: input.questionId,
    prompt: truncateChars(input.prompt, MAX_PROMPT_CHARS),
    ...(input.chosen !== undefined ? { chosen: input.chosen } : {}),
    correction: truncateChars(input.correction, MAX_CORRECTION_CHARS),
    ...(input.note !== undefined ? { note: input.note } : {}),
    createdAt: input.now,
    lastSeenAt: input.now,
    status: "open",
    streak: 0,
    reviewCount: 0,
  };
  return insertWithCapacity(memories, item, input.now);
}

/**
 * 写入一张易混卡。同一对知识点（不论先后顺序）只保留一张；
 * 再次标记视为一次重做：更新 lastSeenAt、回到 open、streak 归零。
 */
export function addConfusionMemory(
  memories: readonly MemoryItem[],
  input: ConfusionMemoryInput,
): MemoryWriteResult {
  if (
    input.kcId.trim() === "" ||
    input.withKcId.trim() === "" ||
    input.kcId === input.withKcId
  ) {
    return { memories, warning: "易混卡需要两个不同的知识点，这次没有新增。" };
  }

  const existing = memories.find(
    (item) =>
      item.kind === "confusion" &&
      ((item.kcId === input.kcId && item.withKcId === input.withKcId) ||
        (item.kcId === input.withKcId && item.withKcId === input.kcId)),
  );
  if (existing) {
    return {
      memories: memories.map((item) =>
        item.id === existing.id
          ? redoItem(
              item,
              {
                kcId: existing.kcId,
                prompt: input.prompt,
                correction: input.correction ?? existing.correction,
                chosen: existing.chosen,
                note: input.note ?? existing.note,
              },
              input.now,
            )
          : item,
      ),
    };
  }

  const item: MemoryItem = {
    id: confusionMemoryId(input.kcId, input.withKcId),
    kind: "confusion",
    kcId: input.kcId,
    withKcId: input.withKcId,
    prompt: truncateChars(input.prompt, MAX_PROMPT_CHARS),
    correction: truncateChars(input.correction ?? "", MAX_CORRECTION_CHARS),
    ...(input.note !== undefined ? { note: input.note } : {}),
    createdAt: input.now,
    lastSeenAt: input.now,
    status: "open",
    streak: 0,
    reviewCount: 0,
  };
  return insertWithCapacity(memories, item, input.now);
}

/**
 * 一次复习自评。「记住了」推进 streak，连续 4 次即毕业；
 * 「没记住」重置 streak 并回到 open，1 天后再到期。
 * 无论哪种都刷新 lastSeenAt，否则到期时间会一直基于旧日期。
 */
export function reviewMemory(
  memories: readonly MemoryItem[],
  id: string,
  remembered: boolean,
  now: string,
): readonly MemoryItem[] {
  const index = memories.findIndex((item) => item.id === id);
  if (index < 0) return memories;

  const item = memories[index];
  const streak = remembered
    ? Math.min(item.streak + 1, GRADUATION_STREAK)
    : 0;
  const status: MemoryStatus = remembered
    ? streak >= GRADUATION_STREAK
      ? "resolved"
      : item.status
    : "open";
  const resolvedAt =
    status === "resolved" ? item.resolvedAt ?? now : undefined;

  const next = rebuild(item, {
    lastSeenAt: now,
    status,
    resolvedAt,
    streak,
    reviewCount: item.reviewCount + 1,
  });
  return memories.map((entry, i) => (i === index ? next : entry));
}

/** 答对同一道题：直接毕业，不再等到期阶梯走完。 */
export function resolveMemory(
  memories: readonly MemoryItem[],
  id: string,
  now: string,
): readonly MemoryItem[] {
  const index = memories.findIndex((item) => item.id === id);
  if (index < 0) return memories;

  const item = memories[index];
  if (item.status === "resolved") return memories;

  const next = rebuild(item, {
    lastSeenAt: now,
    status: "resolved",
    resolvedAt: now,
    streak: GRADUATION_STREAK,
    reviewCount: item.reviewCount + 1,
  });
  return memories.map((entry, i) => (i === index ? next : entry));
}

/**
 * 下次到期时间；已解决或时间戳损坏时返回 null。
 * 到期时间全部读时派生，不落库，避免存档里的 dueAt 与 streak 不一致。
 */
export function dueAt(item: MemoryItem): string | null {
  if (item.status === "resolved") return null;
  const days =
    REVIEW_INTERVALS_DAYS[
      Math.min(item.streak, REVIEW_INTERVALS_DAYS.length - 1)
    ];
  return addDays(item.lastSeenAt, days);
}

/** 到期的 open 卡片，最久未复习的排在前面。 */
export function dueMemories(
  memories: readonly MemoryItem[],
  now: string,
): readonly MemoryItem[] {
  const nowMs = parseTime(now);
  if (nowMs === null) return [];

  const due: { item: MemoryItem; at: number }[] = [];
  for (const item of memories) {
    const dueIso = dueAt(item);
    if (dueIso === null) continue;
    const at = parseTime(dueIso);
    if (at === null || at > nowMs) continue;
    due.push({ item, at });
  }
  due.sort((a, b) => a.at - b.at || compareIds(a.item.id, b.item.id));
  return due.map((entry) => entry.item);
}

export function memoryStats(
  memories: readonly MemoryItem[],
  now: string,
): MemoryStats {
  let open = 0;
  let resolved = 0;
  let error = 0;
  let confusion = 0;
  for (const item of memories) {
    if (item.status === "open") open += 1;
    else resolved += 1;
    if (item.kind === "error") error += 1;
    else confusion += 1;
  }
  return {
    open,
    due: dueMemories(memories, now).length,
    resolved,
    error,
    confusion,
  };
}

/**
 * 清洗存档：逐条校验形状，丢弃坏记录，按 id 去重，最多保留 MAX_MEMORIES 张。
 * 服务端进度是不可信输入，容量与字段范围都在这里收口。
 */
export function parseMemories(raw: unknown): readonly MemoryItem[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: MemoryItem[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_MEMORIES) break;
    if (!isRecord(entry)) continue;

    const { id, kind, kcId, prompt, correction, createdAt, lastSeenAt, status } =
      entry;
    if (!isNonEmptyString(id) || seen.has(id)) continue;
    if (kind !== "error" && kind !== "confusion") continue;
    if (!isNonEmptyString(kcId)) continue;
    if (typeof prompt !== "string" || typeof correction !== "string") continue;
    if (!isTimestamp(createdAt) || !isTimestamp(lastSeenAt)) continue;
    if (status !== "open" && status !== "resolved") continue;

    const questionId = optionalString(entry.questionId);
    const withKcId = optionalString(entry.withKcId);
    if (kind === "error" && !isNonEmptyString(questionId)) continue;
    if (kind === "confusion" && !isNonEmptyString(withKcId)) continue;

    const resolvedAt =
      status === "resolved"
        ? isTimestamp(entry.resolvedAt)
          ? entry.resolvedAt
          : lastSeenAt
        : undefined;

    out.push({
      id,
      kind,
      kcId,
      ...(kind === "confusion" && withKcId !== undefined ? { withKcId } : {}),
      ...(kind === "error" && questionId !== undefined ? { questionId } : {}),
      prompt: truncateChars(prompt, MAX_PROMPT_CHARS),
      ...(typeof entry.chosen === "string" ? { chosen: entry.chosen } : {}),
      correction: truncateChars(correction, MAX_CORRECTION_CHARS),
      ...(typeof entry.note === "string" ? { note: entry.note } : {}),
      createdAt,
      lastSeenAt,
      status,
      ...(resolvedAt !== undefined ? { resolvedAt } : {}),
      streak: normalizeCount(entry.streak, GRADUATION_STREAK),
      reviewCount: normalizeCount(entry.reviewCount, Number.MAX_SAFE_INTEGER),
    });
    seen.add(id);
  }
  return out;
}

/** 复习/解决时只改五个字段，其余原样保留；resolvedAt 必须显式删除而不是留 undefined。 */
function rebuild(
  item: MemoryItem,
  patch: {
    readonly lastSeenAt: string;
    readonly status: MemoryStatus;
    readonly resolvedAt?: string;
    readonly streak: number;
    readonly reviewCount: number;
  },
): MemoryItem {
  return {
    id: item.id,
    kind: item.kind,
    kcId: item.kcId,
    ...(item.withKcId !== undefined ? { withKcId: item.withKcId } : {}),
    ...(item.questionId !== undefined ? { questionId: item.questionId } : {}),
    prompt: item.prompt,
    ...(item.chosen !== undefined ? { chosen: item.chosen } : {}),
    correction: item.correction,
    ...(item.note !== undefined ? { note: item.note } : {}),
    createdAt: item.createdAt,
    lastSeenAt: patch.lastSeenAt,
    status: patch.status,
    ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
    streak: patch.streak,
    reviewCount: patch.reviewCount,
  };
}

/** 重做一张已有卡：刷新 lastSeenAt、回到 open、streak 归零（课程里的一次 lapse）。 */
function redoItem(
  item: MemoryItem,
  patch: {
    readonly kcId: string;
    readonly prompt: string;
    readonly correction: string;
    readonly chosen?: string;
    readonly note?: string;
  },
  now: string,
): MemoryItem {
  const note = patch.note ?? item.note;
  return {
    id: item.id,
    kind: item.kind,
    kcId: patch.kcId,
    ...(item.withKcId !== undefined ? { withKcId: item.withKcId } : {}),
    ...(item.questionId !== undefined ? { questionId: item.questionId } : {}),
    prompt: truncateChars(patch.prompt, MAX_PROMPT_CHARS),
    ...(patch.chosen !== undefined ? { chosen: patch.chosen } : {}),
    correction: truncateChars(patch.correction, MAX_CORRECTION_CHARS),
    ...(note !== undefined ? { note } : {}),
    createdAt: item.createdAt,
    lastSeenAt: now,
    status: "open",
    streak: 0,
    reviewCount: item.reviewCount + 1,
  };
}

function insertWithCapacity(
  memories: readonly MemoryItem[],
  item: MemoryItem,
  now: string,
): MemoryWriteResult {
  const nowMs = parseTime(now);
  let next =
    nowMs === null
      ? [...memories]
      : memories.filter(
          (entry) =>
            entry.status !== "resolved" ||
            resolvedTime(entry) >=
              nowMs - RESOLVED_RETENTION_DAYS * MS_PER_DAY,
        );

  while (next.length >= MAX_MEMORIES) {
    const index = earliestResolvedIndex(next);
    if (index < 0) {
      return {
        memories,
        warning: `记忆卡已达上限 ${MAX_MEMORIES} 张，且没有可清理的已解决卡片；这次没有新增。请先复习解决旧卡或手动删除。`,
      };
    }
    next = next.filter((_, i) => i !== index);
  }

  return { memories: [...next, item] };
}

function earliestResolvedIndex(memories: readonly MemoryItem[]): number {
  let best = -1;
  let bestAt = Number.POSITIVE_INFINITY;
  memories.forEach((item, index) => {
    if (item.status !== "resolved") return;
    const at = resolvedTime(item);
    if (at < bestAt) {
      best = index;
      bestAt = at;
    }
  });
  return best;
}

function resolvedTime(item: MemoryItem): number {
  return (
    parseTime(item.resolvedAt ?? item.lastSeenAt) ??
    parseTime(item.createdAt) ??
    0
  );
}

function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}

function parseTime(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function addDays(iso: string, days: number): string | null {
  const ms = parseTime(iso);
  return ms === null ? null : new Date(ms + days * MS_PER_DAY).toISOString();
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** 非法或负数按 0 处理，超过上限则夹紧，避免坏存档把阶梯索引撑破。 */
function normalizeCount(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(Math.floor(value), max);
}
