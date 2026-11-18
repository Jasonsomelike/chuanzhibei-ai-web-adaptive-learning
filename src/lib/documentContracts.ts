import { z } from "zod";
import { MAX_FILE_BYTES } from "./knowledge";
export const DOCUMENT_PART_BYTES = 512 * 1024;
export const documentReference = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(250),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  pageCount: z.number().int().nonnegative(),
  chunkCount: z.number().int().positive(),
  ocrPages: z.number().int().nonnegative(),
});
export type DocumentReference = z.infer<typeof documentReference>;
export const documentRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    draftKey: z.string().uuid().optional(),
    targetId: z.string().min(1).max(100),
    name: z.string().min(1).max(250),
    size: z.number().int().positive().max(MAX_FILE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  z.strictObject({
    action: z.literal("part"),
    id: z.string().uuid(),
    index: z
      .number()
      .int()
      .min(0)
      .max(Math.ceil(MAX_FILE_BYTES / DOCUMENT_PART_BYTES)),
    data: z
      .string()
      .max(Math.ceil(DOCUMENT_PART_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  }),
  z.strictObject({ action: z.literal("process"), id: z.string().uuid() }),
]);
export interface DocumentProgress {
  id: string;
  status: "uploading" | "processing" | "ready" | "failed";
  received: number[];
  pagesDone: number;
  pageCount: number;
  ocrPages: number;
  document?: DocumentReference;
  error?: string;
  reused?: boolean;
}
