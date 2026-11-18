export function modelInfoUrl(baseUrl: string, model: string): string {
  return baseUrl.replace(/\/+$/, "") + "/models/" + encodeURIComponent(model);
}

/** The Messages protocol requires max_tokens; prefer the exact per-model value advertised by the provider. */
export function anthropicOutputCapacity(metadata: unknown, configured?: number): number {
  const value = metadata && typeof metadata === "object" && "max_tokens" in metadata ? metadata.max_tokens : null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (configured !== undefined && Number.isSafeInteger(configured) && configured > 0) return configured;
  throw new Error("Anthropic Messages 需要模型输出容量。请检查模型信息接口或在模型设置中填写该模型的输出容量。");
}
