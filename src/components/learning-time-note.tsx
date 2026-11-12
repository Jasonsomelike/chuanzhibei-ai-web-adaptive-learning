import type { useLearningTime } from "@/lib/useLearningTime";
export function LearningTimeNote({
  timing,
}: {
  timing: ReturnType<typeof useLearningTime>;
}) {
  return (
    <div className="my-2 text-xs leading-relaxed text-[var(--ink-soft)]">
      <p role="status">
        {timing.pending
          ? "正在结合课程内容和学习证据估算用时，先显示规则初估…"
          : timing.source === "llm"
            ? `用时由 ${timing.model} 估算并校验；实际进度可调整。`
            : "用时按内容与学习证据初估；配置模型后会结合学情估算。"}
        {timing.notice ? ` ${timing.notice}` : ""}
        {!timing.pending ? (
          <button
            type="button"
            className="ml-2 underline"
            onClick={timing.refresh}
          >
            更新估算
          </button>
        ) : null}
      </p>
      <details className="mt-1">
        <summary className="w-fit cursor-pointer underline">
          用时如何估算
        </summary>
        <ul className="mt-2 max-h-64 space-y-3 overflow-auto rounded border border-[var(--line)] p-3">
          {timing.estimates.map((e) => (
            <li key={e.kcId}>
              <strong className="text-[var(--ink)]">
                {timing.names?.find((c) => c.id === e.kcId)?.name ?? e.kcId}
              </strong>
              <p>
                新学 {e.learnMinutes} 分钟 · 复习 {e.reviewMinutes} 分钟 ·
                参考区间 {e.lowMinutes}–{e.highMinutes} 分钟
              </p>
              <p>{e.reason}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
