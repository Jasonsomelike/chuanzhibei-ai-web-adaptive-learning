import type { UploadHit } from "./knowledge";
/** Explicit provider settings override these conservative defaults; no claims about inferred model capacity. */
export interface ContextBudgetConfig {
  contextWindowTokens?: number;
  responseReserveTokens?: number;
  retrievalMaxTokens?: number;
  thinking?: "off" | "standard" | "deep";
}
export function readContextBudget(value: object): ContextBudgetConfig {
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(
    ["contextWindowTokens", "responseReserveTokens", "retrievalMaxTokens"]
      .filter((k) => typeof raw[k] === "number")
      .map((k) => [k, raw[k]]),
  );
}
export function contextBudget(config: ContextBudgetConfig = {}) {
  const valid = (
    v: number | undefined,
    min: number,
    max: number,
    fallback: number,
  ) => (Number.isInteger(v) && v! >= min && v! <= max ? v! : fallback);
  const window = valid(config.contextWindowTokens, 4096, 2_000_000, 8192);
  const baseResponse = Math.min(
    valid(config.responseReserveTokens, 256, 128000, 2048),
    Math.floor(window / 2),
  );
  const thinkingReserve =
    config.thinking === "deep"
      ? 20480
      : config.thinking === "standard"
        ? 8192
        : 0;
  const thinking =
    thinkingReserve + 1024 < window ? (config.thinking ?? "off") : "off";
  const response =
    thinking === "off" ? baseResponse : Math.max(baseResponse, thinkingReserve);
  const retrieval = Math.min(
    valid(config.retrievalMaxTokens, 256, 128000, Math.floor(window / 4)),
    window - response - 1024,
  );
  return { window, response, retrieval, thinking };
}
/** Conservative estimate: ASCII ~3 chars/token, non-ASCII 2 tokens/codepoint, plus message overhead. */
export function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) n += ch.codePointAt(0)! < 128 ? 1 / 3 : 2;
  return Math.ceil(n) + 16;
}
export function budgetUploadHits(
  hits: readonly UploadHit[],
  config: ContextBudgetConfig = {},
  occupiedTokens = 0,
) {
  const budget = contextBudget(config);
  const available = Math.max(
    0,
    Math.min(
      budget.retrieval,
      budget.window - budget.response - 1024 - Math.max(0, occupiedTokens),
    ),
  );
  let used = 0;
  const selected: UploadHit[] = [];
  for (const hit of hits) {
    const cost =
      estimateTokens(hit.chunk.text) + estimateTokens(hit.chunk.title) + 40;
    if (used + cost <= available) {
      selected.push(hit);
      used += cost;
    }
  }
  return {
    hits: selected,
    budget: {
      ...budget,
      available,
      used,
      omitted: hits.length - selected.length,
      estimator: "conservative-v1",
    },
  };
}
