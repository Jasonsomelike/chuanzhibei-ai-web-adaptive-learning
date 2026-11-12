import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  __resetMemoryDbForTests,
  __setDbBackendForTests,
  getDb,
  SCHEMA,
  type Db,
} from "./db";
import {
  createDocumentImport,
  putDocumentPart,
  processDocumentImport,
  validateDocumentReferences,
} from "./documentStore";
import { ARTIFACT_SQL } from "./learningArtifacts";
import { DOCUMENT_PART_BYTES } from "./documentContracts";
import { listDirectionChunks } from "./kbServer";
import { retrieveDocuments } from "./documentRetrieval";
const insertUser =
  "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)";
describe.each(["memory", "postgres"] as const)(
  "server document ingestion · %s",
  (backend) => {
    let db: Db;
    let pg: PGlite | undefined;
    beforeAll(async () => {
      if (backend !== "postgres") return;
      pg = new PGlite();
      await pg.waitReady;
      await pg.exec(
        SCHEMA.filter((s) =>
          /CREATE TABLE IF NOT EXISTS (users|kb_docs|kb_chunks|learning_artifacts)\s/u.test(
            s,
          ),
        ).join(";\n"),
      );
    }, 30000);
    beforeEach(async () => {
      if (pg) {
        await pg.exec("TRUNCATE users CASCADE");
        const p = pg;
        db = {
          run: async (q, a = []) => (await p.query(q, a)).affectedRows ?? 0,
          all: async <T>(q: string, a: unknown[] = []) =>
            (await p.query<T>(q, a)).rows,
          one: async <T>(q: string, a: unknown[] = []) =>
            (await p.query<T>(q, a)).rows[0] ?? null,
        };
      } else {
        __setDbBackendForTests("memory");
        __resetMemoryDbForTests();
        db = await getDb();
      }
      for (const user of ["alice", "bob"])
        await db.run(insertUser, [
          user,
          `${user}@test.local`,
          "hash",
          user,
          "2026-11-12",
        ]);
    });
    afterAll(async () => {
      await pg?.close();
      __setDbBackendForTests(null);
    });
    async function upload(
      text = "栈采用后进先出。队列采用先进先出。".repeat(20),
      targetId = "data-structures",
    ) {
      const bytes = Buffer.from(text);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const input = { name: "讲义.txt", targetId, size: bytes.length, sha256 };
      const job = await createDocumentImport(db, "alice", input);
      for (let i = 0; i < Math.ceil(bytes.length / DOCUMENT_PART_BYTES); i++)
        await putDocumentPart(
          db,
          "alice",
          job.id,
          i,
          bytes
            .subarray(i * DOCUMENT_PART_BYTES, (i + 1) * DOCUMENT_PART_BYTES)
            .toString("base64"),
        );
      return { job, input, bytes };
    }
    it("persists full text once, reuses hash and returns only query hits", async () => {
      const { job, input } = await upload(
        "栈采用后进先出。".repeat(8000) + "\n队列采用先进先出。",
      );
      const ready = await processDocumentImport(db, "alice", job.id);
      expect(ready.document!.chunkCount).toBeGreaterThan(40);
      expect(
        await db.all(ARTIFACT_SQL.list, ["alice", `document-parts:${job.id}`]),
      ).toEqual([]);
      expect(await createDocumentImport(db, "alice", input)).toMatchObject({
        status: "ready",
        reused: true,
        id: job.id,
      });
      const result = await retrieveDocuments(
        db,
        "alice",
        input.targetId,
        "队列先进先出",
        [job.id],
        { retrievalMaxTokens: 1500 },
      );
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits.length).toBeLessThan(ready.document!.chunkCount);
      expect(result.budget.used).toBeLessThanOrEqual(1500);
      expect(
        await validateDocumentReferences(db, "alice", input.targetId, [job.id]),
      ).toEqual([ready.document]);
    });
    it("isolates owners, course references and missing documents", async () => {
      const { job, input } = await upload();
      await processDocumentImport(db, "alice", job.id);
      await expect(
        processDocumentImport(db, "bob", job.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        validateDocumentReferences(db, "alice", "linear-algebra", [job.id]),
      ).rejects.toMatchObject({ status: 409 });
      expect((await createDocumentImport(db, "bob", input)).status).toBe(
        "uploading",
      );
    });
    it("resumes parts idempotently and rejects incomplete or corrupt uploads", async () => {
      const { job, bytes } = await upload();
      expect(
        (
          await putDocumentPart(
            db,
            "alice",
            job.id,
            0,
            bytes.toString("base64"),
          )
        ).received,
      ).toEqual([0]);
      await expect(
        putDocumentPart(db, "alice", job.id, 1, "YQ=="),
      ).rejects.toMatchObject({ status: 400 });
      const fake = await createDocumentImport(db, "alice", {
        targetId: "data-structures",
        name: "x.txt",
        size: 1,
        sha256: "a".repeat(64),
      });
      await expect(
        processDocumentImport(db, "alice", fake.id),
      ).rejects.toMatchObject({ status: 409 });
      await putDocumentPart(db, "alice", fake.id, 0, "YQ==");
      await expect(
        processDocumentImport(db, "alice", fake.id),
      ).rejects.toMatchObject({ status: 422 });
      expect(await listDirectionChunks(db, "alice", "data-structures")).toEqual(
        [],
      );
    });
    it("checkpoints PDF pages and publishes all chunks atomically only when complete", async () => {
      const { job } = await upload();
      const first = await processDocumentImport(
        db,
        "alice",
        job.id,
        async () => ({
          blocks: [{ text: "栈的后进先出。".repeat(60), page: 1 }],
          next: 1,
          pageCount: 2,
          ocrPages: 1,
        }),
      );
      expect(first).toMatchObject({
        status: "processing",
        pagesDone: 1,
        ocrPages: 1,
      });
      expect(await listDirectionChunks(db, "alice", "data-structures")).toEqual(
        [],
      );
      const ready = await processDocumentImport(
        db,
        "alice",
        job.id,
        async (_b, _n, from) => {
          expect(from).toBe(1);
          return {
            blocks: [{ text: "队列先进先出。".repeat(60), page: 2 }],
            next: 2,
            pageCount: 2,
            ocrPages: 0,
          };
        },
      );
      expect(ready).toMatchObject({
        status: "ready",
        pageCount: 2,
        ocrPages: 1,
      });
      expect(
        new Set(
          (await listDirectionChunks(db, "alice", "data-structures")).map(
            (c) => c.pageFrom,
          ),
        ),
      ).toEqual(new Set([1, 2]));
    });
    it("failed parsing can be retried without retaining incompatible old parts", async () => {
      const { job, input, bytes } = await upload();
      await expect(
        processDocumentImport(db, "alice", job.id, async () => {
          throw new Error("临时解析失败");
        }),
      ).rejects.toMatchObject({ status: 422 });
      const reset = await createDocumentImport(db, "alice", input);
      expect(reset).toMatchObject({
        status: "uploading",
        received: [],
        pagesDone: 0,
      });
      await putDocumentPart(db, "alice", job.id, 0, bytes.toString("base64"));
      expect((await processDocumentImport(db, "alice", job.id)).status).toBe(
        "ready",
      );
    });
    it("concurrent processors share a lease and do not double parse", async () => {
      const { job } = await upload();
      let calls = 0;
      let release!: () => void;
      const wait = new Promise<void>((r) => {
        release = r;
      });
      let signalStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        signalStarted = resolve;
      });
      const parser = async () => {
        calls++;
        signalStarted();
        await wait;
        return {
          blocks: [{ text: "栈采用后进先出。".repeat(20) }],
          next: 1,
          pageCount: 1,
          ocrPages: 0,
        };
      };
      const one = processDocumentImport(db, "alice", job.id, parser);
      await started;
      const two = await processDocumentImport(db, "alice", job.id, parser);
      expect(two.status).toBe("processing");
      release();
      await one;
      expect(calls).toBe(1);
    });
  },
);
