"use client";

/**
 * 图片输入条：粘贴截图 / 选择文件 / 拍照 → 压缩 → 预览 → 交给导师页发送。
 *
 * 三件事在这里收口：
 * - 粘贴：window 的 paste 事件只在剪贴板里真的有图片时才 preventDefault，
 *   粘贴文字仍落到输入框；
 * - 张数：最多 IMAGE_MAX_COUNT 张，超出的明确提示「已忽略几张」，不静默吞掉；
 * - 失败：压缩失败逐张显示原因（HEIC、解码失败、仍超 400KB），
 *   调用方据此提示「改为文字提问」，绝不静默去图。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  IMAGE_ACCEPT,
  IMAGE_HELP_TEXT,
  IMAGE_MAX_COUNT,
  browserImageCodec,
  imageCountMessage,
  prepareImage,
  remainingImageSlots,
  type PreparedImage,
} from "@/lib/image";

export interface AttachedImage extends PreparedImage {
  /** 列表内的稳定 id；只用它做 key 与删除。 */
  readonly id: string;
  /** 原始文件名；粘贴的图片可能没有名字。 */
  readonly name: string;
}

export interface ImageInputProps {
  readonly images: readonly AttachedImage[];
  readonly onChange: (images: AttachedImage[]) => void;
  readonly disabled?: boolean;
  readonly max?: number;
}

/** 压缩结果的展示信息：尺寸、体积、质量。 */
export function formatImageMeta(image: PreparedImage): string {
  const kb = image.bytes >= 1024 * 1024
    ? `${(image.bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(image.bytes / 1024))}KB`;
  return `${image.width}×${image.height} · ${kb} · q${image.quality.toFixed(2)}`;
}

/**
 * 合并新图片并卡住上限。
 *
 * 返回被拒绝的张数，调用方必须把它显示出来——「粘贴了 5 张只发 3 张」
 * 如果不说，用户会以为另外两张也发出去了。
 */
export function appendAttachedImages(
  current: readonly AttachedImage[],
  incoming: readonly AttachedImage[],
  max: number = IMAGE_MAX_COUNT,
): { readonly images: AttachedImage[]; readonly rejected: number } {
  const slots = remainingImageSlots(current.length, max);
  const accepted = incoming.slice(0, slots);
  return {
    images: [...current, ...accepted],
    rejected: incoming.length - accepted.length,
  };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ImageInput({
  images,
  onChange,
  disabled = false,
  max = IMAGE_MAX_COUNT,
}: ImageInputProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const idRef = useRef(0);

  const addFiles = useCallback(
    async (incoming: Iterable<File>): Promise<void> => {
      if (disabled || busy) return;

      const list = Array.from(incoming);
      const imageFiles = list.filter(
        (file) => file.type === "" || file.type.startsWith("image/"),
      );
      const skippedNonImage = list.length - imageFiles.length;

      if (imageFiles.length === 0) {
        if (skippedNonImage > 0) setNotice("只能添加图片文件。");
        return;
      }

      const slots = remainingImageSlots(images.length, max);
      if (slots <= 0) {
        setNotice(imageCountMessage(max));
        return;
      }

      const taken = imageFiles.slice(0, slots);
      const skippedByLimit = imageFiles.length - taken.length;
      setBusy(true);
      setNotice(null);

      const prepared: AttachedImage[] = [];
      const problems: string[] = [];
      const codec = browserImageCodec();
      for (const file of taken) {
        try {
          const result = await prepareImage(file, codec);
          if (result.ok) {
            idRef.current += 1;
            prepared.push({
              ...result.image,
              id: `img-${idRef.current}`,
              name: file.name.trim() === "" ? "粘贴的图片" : file.name,
            });
          } else {
            problems.push(`${file.name.trim() === "" ? "图片" : file.name}：${result.message}`);
          }
        } catch (err) {
          problems.push(
            `${file.name.trim() === "" ? "图片" : file.name}：压缩失败（${messageOf(err)}）`,
          );
        }
      }

      setBusy(false);
      const merged = appendAttachedImages(images, prepared, max);
      if (merged.images.length !== images.length) onChange(merged.images);

      const notes = [...problems];
      if (skippedByLimit > 0) {
        notes.push(`最多 ${max} 张，已忽略多出的 ${skippedByLimit} 张。`);
      }
      if (skippedNonImage > 0) {
        notes.push(`已忽略 ${skippedNonImage} 个非图片文件。`);
      }
      setNotice(notes.length > 0 ? notes.join("；") : null);
    },
    [busy, disabled, images, max, onChange],
  );

  /*
   * 粘贴是全局监听：用户通常直接 Ctrl+V，而不是先点「选择文件」。
   * 只有剪贴板里真的有图片才拦截，否则粘贴文字照常进入输入框。
   */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (disabled) return;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length === 0) return;
      event.preventDefault();
      void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, disabled]);

  const pick = (input: HTMLInputElement | null): void => {
    if (disabled || busy || input === null) return;
    input.value = "";
    input.click();
  };

  const remove = (id: string): void => {
    setNotice(null);
    onChange(images.filter((image) => image.id !== id));
  };

  const full = images.length >= max;

  return (
    <div className="mb-2 rounded-lg border border-[var(--line)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-[var(--ink-soft)]">
          图片 {images.length}/{max}
        </span>
        <button
          type="button"
          onClick={() => pick(fileRef.current)}
          disabled={disabled || busy || full}
          className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--line)] disabled:opacity-40"
        >
          选择图片
        </button>
        <button
          type="button"
          onClick={() => pick(cameraRef.current)}
          disabled={disabled || busy || full}
          className="rounded-lg border border-[var(--line-strong)] px-2.5 py-1 text-xs text-[var(--ink-soft)] hover:bg-[var(--line)] disabled:opacity-40"
        >
          拍照
        </button>
        {busy ? <span className="text-[var(--ink-faint)]">正在压缩…</span> : null}
        <span className="text-[var(--ink-faint)]">
          {full ? `已达 ${max} 张上限` : IMAGE_HELP_TEXT}
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files !== null && files.length > 0) void addFiles(files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept={IMAGE_ACCEPT}
        capture="environment"
        hidden
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files !== null && files.length > 0) void addFiles(files);
          event.currentTarget.value = "";
        }}
      />

      {images.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {images.map((image) => (
            <li
              key={image.id}
              className="flex max-w-full items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1.5"
            >
              {/* 缩略图就是用户刚选的本地 data URI；不走 next/image 优化器 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.dataUrl}
                alt={image.name}
                className="h-12 w-12 rounded object-cover"
              />
              <span className="min-w-0">
                <span className="block max-w-[12em] truncate text-xs text-[var(--ink-soft)]">
                  {image.name}
                </span>
                <span className="block text-[0.7rem] text-[var(--ink-faint)]">
                  {formatImageMeta(image)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(image.id)}
                disabled={disabled || busy}
                aria-label={`移除图片 ${image.name}`}
                className="rounded px-1.5 py-0.5 text-xs text-[var(--ink-faint)] hover:text-[var(--bad)] disabled:opacity-40"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {notice !== null ? (
        <p role="status" className="mt-1 text-xs leading-relaxed text-[var(--warn)]">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
