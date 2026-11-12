import type { TextBlock } from "./knowledge";
const MD_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * 按 Markdown 标题分段。
 *
 * 标题行保留在正文里：导师检索与出题核对都按片段文本匹配，
 * 只把标题放进 section 会让「这一节叫什么」检索不到。
 */
export function markdownBlocks(
  text: string,
  fallbackSection: string,
): TextBlock[] {
  const fallback = fallbackSection.trim();
  const blocks: TextBlock[] = [];
  let section = fallback;
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join("\n").trim();
    if (body !== "") blocks.push({ text: body, section });
    buffer = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const heading = MD_HEADING.exec(line);
    if (heading !== null) {
      flush();
      const title = heading[2]?.trim() ?? "";
      if (title !== "") section = title;
    }
    buffer.push(line);
  }
  flush();

  return blocks;
}

/** 纯文本只有一段，小节名用文件名兜底（不编页码）。 */
export function plainBlocks(text: string, section: string): TextBlock[] {
  return text.trim() === "" ? [] : [{ text, section }];
}
