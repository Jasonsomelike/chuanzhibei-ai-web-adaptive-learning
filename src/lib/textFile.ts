/**
 * 浏览器侧的纯文本读取：只负责 File → Uint8Array，再交给 knowledge.ts 解码。
 *
 * 这里刻意不实现第二套编码探测：UTF-8 / GB18030 / UTF-16LE 的判定顺序
 * 只存在于 knowledge.ts 的 decodeTextFile，单测也集中在那里。
 * 本模块的单测只覆盖字节读取，不重复测三种编码。
 */

import { decodeTextFile, type TextEncoding } from "@/lib/knowledge";

/** 读取原始字节。File 属于浏览器 API，SSR 阶段不要调用。 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export interface TextFileContent {
  readonly fileName: string;
  /** 原始字节，供上传前计算大小或后续重试。 */
  readonly bytes: Uint8Array;
  readonly text: string;
  /** 实际命中的编码，界面据此显示「按 GB18030 读取」。 */
  readonly encoding: TextEncoding;
}

/** 读取并解码 md / txt；编码探测复用 knowledge.ts 的 decodeTextFile。 */
export async function readTextFile(file: File): Promise<TextFileContent> {
  const bytes = await readFileBytes(file);
  const decoded = decodeTextFile(bytes);
  return { fileName: file.name, bytes, ...decoded };
}
