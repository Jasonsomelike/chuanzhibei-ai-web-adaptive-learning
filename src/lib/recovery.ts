export const recoveryQuestions = ["哪一本书对你影响最大？", "你给第一个学习项目起了什么名字？", "你想记住的一个地方叫什么？"] as const;
export type RecoveryProof = { question: string; answer: string; code: string };

export function recoverySecret(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const { question, answer, code } = input as Partial<RecoveryProof>;
  if (!recoveryQuestions.some(item => item === question) || typeof answer !== "string" || typeof code !== "string") return null;
  const normalized = answer.normalize("NFKC").trim().toLowerCase();
  const key = code.trim().toLowerCase();
  if (!normalized || normalized.length > 120 || !/^[0-9a-f]{32}$/.test(key)) return null;
  return JSON.stringify([question, normalized, key]);
}
