import { DEFAULT_TUTOR_TONE, isTutorTone, type TutorTone } from "@/lib/tutorPersona";

export const TUTOR_TONE_KEY = "alp.tutor.tone.v1";
export type HelpLevel = "hint" | "steps" | "explain";
export function tutoringPolicy(level: HelpLevel): string {
  if (level === "hint") return "【本轮教学方式：只给提示】本轮不使用先给答案的段落结构。只给一个思考方向和一个反问，不揭示最终答案、正确选项或完整解法。等学生独立尝试后再继续。";
  if (level === "steps") return "【本轮教学方式：引导步骤】只指出关键步骤及检验方法，保留最后一步让学生独立完成，不直接给最终答案。";
  return "【本轮教学方式：完整讲解】学生已主动请求完整讲解，可以给出答案、依据、例子和一个迁移练习。不要把一次答错断言为固定的认知缺陷。";
}
export function offlineTutoringText(level: HelpLevel, answer: string, topic?: string): string {
  if (level === "explain") return answer;
  const focus = topic ? `「${topic}」` : "当前问题";
  return level === "hint"
    ? `思考方向：先用自己的话描述${focus}涉及的对象与条件。\n\n试着回答：题目中哪一个关键词决定了你要用的概念？先写出理由，再请求下一层提示。\n\n当前未使用模型，这是通用学习引导；选择「完整讲解」可查看检索到的资料解析。`
    : `引导步骤：\n1. 找出${focus}的定义和适用条件。\n2. 对照题目，逐项检查条件是否满足。\n3. 自己给出判断，并用一个例子检验。\n\n当前未使用模型，以上是通用步骤；选择「完整讲解」可查看资料解析。`;
}
export function loadTutorTone(): TutorTone {
  try {
    const tone = window.localStorage.getItem(TUTOR_TONE_KEY);
    return isTutorTone(tone) ? tone : DEFAULT_TUTOR_TONE;
  } catch { return DEFAULT_TUTOR_TONE; }
}
