"use client";
import {
  DOCUMENT_PART_BYTES,
  type DocumentProgress,
  type DocumentReference,
} from "./documentContracts";
async function call(
  body: unknown,
  signal?: AbortSignal,
): Promise<DocumentProgress> {
  const r = await fetch("/api/documents", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message ?? "附件处理失败");
  return data as DocumentProgress;
}
export async function uploadDocument(
  file: File,
  targetId: string,
  onProgress: (message: string) => void,
  signal?: AbortSignal,
  draftKey?: string,
): Promise<DocumentReference> {
  const bytes = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(hash)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  let job = await call(
    { action: "create", targetId, draftKey, name: file.name, size: file.size, sha256 },
    signal,
  );
  for (
    let index = 0;
    index < Math.ceil(file.size / DOCUMENT_PART_BYTES) &&
    job.status === "uploading";
    index++
  ) {
    if (job.received.includes(index)) continue;
    const part = new Uint8Array(
      bytes.slice(
        index * DOCUMENT_PART_BYTES,
        (index + 1) * DOCUMENT_PART_BYTES,
      ),
    );
    let binary = "";
    for (let offset = 0; offset < part.length; offset += 8192)
      binary += String.fromCharCode(...part.subarray(offset, offset + 8192));
    onProgress(
      `正在上传 ${file.name} · ${Math.round(((index * DOCUMENT_PART_BYTES) / file.size) * 100)}%`,
    );
    job = await call(
      { action: "part", id: job.id, index, data: btoa(binary) },
      signal,
    );
  }
  while (job.status !== "ready" && job.status !== "failed") {
    onProgress(
      `正在解析 ${file.name}${job.pageCount ? ` · ${job.pagesDone}/${job.pageCount} 页` : ""}${job.ocrPages ? ` · OCR ${job.ocrPages} 页` : ""}`,
    );
    job = await call({ action: "process", id: job.id }, signal);
    if (job.status === "processing")
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, 350);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(id);
            reject(new DOMException("已取消", "AbortError"));
          },
          { once: true },
        );
      });
  }
  if (!job.document) throw new Error(job.error ?? "附件解析未完成");
  return job.document;
}
