"use client";

import { Pill } from "@/components/ui";
import type { WebHit } from "@/lib/websearch";
import { webUsageNote } from "@/components/tutor-logic";

/**
 * 网络来源块。
 *
 * 网络结果与教材 / 讲义是两套命名空间：网页只是外部线索，未核对，
 * 不能出现在「出处」里假装成教材依据。检索失败只在这里显示一条提示，
 * 不阻塞回答——回答仍由课程资料完成。
 */
export function WebEvidence({
  hits,
  used,
  error,
  notice,
  fromCache,
}: {
  readonly hits: readonly WebHit[];
  /** 回答里实际出现的 [网络n] 序号（1 起）。 */
  readonly used: readonly number[];
  readonly error: string | null;
  /** 不是失败：例如 Tavily 没填 key，已回退维基百科。 */
  readonly notice: string | null;
  readonly fromCache: boolean;
}) {
  if (hits.length === 0 && error === null && notice === null) return null;

  const usedSet = new Set(used);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--line)]/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-[var(--ink-soft)]">
          网络来源（外部网页，未核对）
        </p>
        {fromCache ? <Pill tone="neutral">会话缓存</Pill> : null}
        {hits.length > 0 ? (
          <Pill tone={used.length > 0 ? "accent" : "neutral"}>
            {used.length > 0 ? `已引用 ${used.length}/${hits.length}` : "未采用"}
          </Pill>
        ) : null}
      </div>

      {notice !== null && notice !== "" ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">{notice}</p>
      ) : null}

      {error !== null ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--warn)]">
          联网检索失败：{error}。回答未使用网络结果，课程资料检索不受影响。
        </p>
      ) : null}

      {hits.length > 0 ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
            {webUsageNote(used.length, hits.length)}
          </p>
          <ul className="mt-2 space-y-2">
            {hits.map((hit) => (
              <li key={hit.url} className={usedSet.has(hit.ref) ? "" : "opacity-70"}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[var(--ink-faint)]">[网络{hit.ref}]</span>
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium underline"
                  >
                    {hit.label}
                  </a>
                  <Pill tone="neutral">
                    {hit.provider === "wikipedia" ? "维基百科 · CC BY-SA 4.0" : "Tavily 摘要"}
                  </Pill>
                  {usedSet.has(hit.ref) ? <Pill tone="accent">已引用</Pill> : null}
                </div>
                {hit.snippet !== "" ? (
                  <p className="mt-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                    {hit.snippet}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
