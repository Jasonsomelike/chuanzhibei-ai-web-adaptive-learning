/** Keep the user's full text in the archive while bounding the current model prompt. */
export function buildTutorQuestion(
  question: string,
  imageCount: number,
): string {
  if (imageCount <= 0) return question.slice(0, 4000);
  const instructions = [
    `【图片】本次附带 ${imageCount} 张图片。`,
    "先看图片：用「【图中文字】」逐字转写与题目有关的文字；图片里没有可读文字就写「图片里没有可读文字」。",
    "再用「【解答】」回答。引用只来自解答段，转写段里的 [知识点ID] 不算引用；看不清就直说，不要猜。",
    "学生的问题：",
  ].join("\n");
  const text = question.trim() || "请按图片回答。";
  return instructions + text.slice(0, 4000 - instructions.length);
}
