import { MongoClient, type Db, type ObjectId } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingError, EmbeddingRateLimitError, type Embedder } from "@/lib/ai/embed";
import { contentHash } from "@/lib/chunking/chunker";
import { ensureChunkIndexes, findEmbeddingsByHash } from "@/lib/db/chunks";
import { ensureIndexes, insertDocumentWithPages } from "@/lib/db/documents";
import { continueIngestion, ingestDocument, IngestionBusyError, startIngestion } from "@/lib/ingest";
import type { ExtractedPage } from "@/lib/pdf/extract";
import { fakeEmbedder } from "./helpers/fake-embedder";
import { startMongo } from "./helpers/mongo";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const sentence = (i: number) => `Sentence ${i} explains how refunds, deliveries and warranties work for customers.`;
const paragraph = (sentences: number, from = 0) =>
  Array.from({ length: sentences }, (_, i) => sentence(from + i)).join(" ");

const page = (pageNumber: number, text: string): ExtractedPage => ({
  pageNumber,
  text,
  charCount: text.length,
  isEmpty: text.length === 0,
});

// Page 1 is long enough for several chunks; page 2 is empty; page 3 is one chunk.
const pages = [page(1, paragraph(40)), page(2, ""), page(3, paragraph(3, 100))];

async function storeDocument(userId: string, docPages: ExtractedPage[] = pages): Promise<ObjectId> {
  return insertDocumentWithPages(db, { userId, filename: "handbook.pdf", sizeBytes: 1000, sha256: "a".repeat(64), pages: docPages });
}

const chunksOf = (documentId: ObjectId) =>
  db.collection("chunks").find({ documentId }).sort({ chunkIndex: 1 }).toArray();

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("documind_ingest_test");
  await ensureIndexes(db);
  await ensureChunkIndexes(db);
});

beforeEach(async () => {
  await Promise.all(["documents", "pages", "chunks"].map((name) => db.collection(name).deleteMany({})));
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("ingestDocument", () => {
  it("stores every chunk with its vector, owner, document, page and position", async () => {
    const { embedder } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await ingestDocument({ db, embedder, userId: "user-a", documentId, pages });

    const chunks = await chunksOf(documentId);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    for (const chunk of chunks) {
      expect(chunk.userId).toBe("user-a");
      expect(chunk.documentId.equals(documentId)).toBe(true);
      expect([1, 3]).toContain(chunk.pageNumber);
      expect(chunk.embedding).toHaveLength(embedder.dimensions);
      expect(chunk.contentHash).toBe(contentHash(chunk.text, embedder.model));
      expect(chunk.end - chunk.start).toBe(chunk.text.length);
    }
  });

  it("marks the document ready with its chunk count and embedding model", async () => {
    const { embedder } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    const result = await ingestDocument({ db, embedder, userId: "user-a", documentId, pages });

    const document = await db.collection("documents").findOne({ _id: documentId });
    expect(document).toMatchObject({
      status: "ready",
      chunkCount: result.chunkCount,
      embeddedChunks: result.chunkCount,
      embeddingModel: "fake-embedding-model",
    });
    expect(result).toEqual({ chunkCount: (await chunksOf(documentId)).length, embedded: result.chunkCount, reused: 0 });
  });

  it("reuses stored vectors for text the same user has already embedded", async () => {
    const first = fakeEmbedder();
    const a1 = await storeDocument("user-a");
    await ingestDocument({ db, embedder: first.embedder, userId: "user-a", documentId: a1, pages });

    const second = fakeEmbedder();
    const a2 = await storeDocument("user-a");
    const result = await ingestDocument({ db, embedder: second.embedder, userId: "user-a", documentId: a2, pages });

    expect(second.embeddedTexts()).toEqual([]);
    expect(result).toMatchObject({ embedded: 0, reused: result.chunkCount });
    expect((await chunksOf(a2)).map((c) => c.embedding)).toEqual((await chunksOf(a1)).map((c) => c.embedding));
  });

  it("embeds only the chunks that are new", async () => {
    const { embedder } = fakeEmbedder();
    await ingestDocument({ db, embedder, userId: "user-a", documentId: await storeDocument("user-a"), pages });

    const changed = [pages[0], page(2, paragraph(2, 500))];
    const later = fakeEmbedder();
    const result = await ingestDocument({
      db,
      embedder: later.embedder,
      userId: "user-a",
      documentId: await storeDocument("user-a", changed),
      pages: changed,
    });
    expect(result.embedded).toBe(1);
    expect(later.embeddedTexts()).toEqual([paragraph(2, 500)]);
  });

  it("never reuses another user's vectors", async () => {
    const a = fakeEmbedder();
    await ingestDocument({ db, embedder: a.embedder, userId: "user-a", documentId: await storeDocument("user-a"), pages });

    const b = fakeEmbedder();
    const result = await ingestDocument({ db, embedder: b.embedder, userId: "user-b", documentId: await storeDocument("user-b"), pages });
    expect(result).toMatchObject({ embedded: result.chunkCount, reused: 0 });
  });

  it("marks the document failed and stores no chunks when embedding fails", async () => {
    const { embedder, state } = fakeEmbedder();
    state.failWith = new Error("quota exceeded");
    const documentId = await storeDocument("user-a");

    await expect(ingestDocument({ db, embedder, userId: "user-a", documentId, pages })).rejects.toBeInstanceOf(
      EmbeddingError,
    );
    const document = await db.collection("documents").findOne({ _id: documentId });
    expect(document?.status).toBe("failed");
    expect(document?.error).toEqual(expect.any(String));
    expect(await chunksOf(documentId)).toHaveLength(0);
  });
});

describe("batched ingestion (free-tier friendly)", () => {
  const BATCH = 2;
  const rateLimited = () => new EmbeddingRateLimitError({ retryAfterSeconds: 30 });
  const documentRow = (documentId: ObjectId) => db.collection("documents").findOne({ _id: documentId });
  const embeddedCount = async (documentId: ObjectId) =>
    db.collection("chunks").countDocuments({ documentId, embedding: { $exists: true } });

  /** Continues until the document is ready, returning how many calls it took. */
  async function finish(embedder: Embedder, documentId: ObjectId, userId = "user-a") {
    for (let calls = 1; calls <= 20; calls++) {
      const progress = await continueIngestion({ db, embedder, userId, documentId, batchSize: BATCH });
      if (progress?.status === "ready") return calls;
    }
    throw new Error("never became ready");
  }

  it("stores every chunk at once but embeds only the first batch", async () => {
    const { embedder, state } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    const progress = await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    const total = (await chunksOf(documentId)).length;
    expect(total).toBeGreaterThan(BATCH);
    expect(progress).toEqual({ status: "processing", chunkCount: total, embeddedChunks: BATCH });
    expect(state.calls.map((texts) => texts.length)).toEqual([BATCH]);
    expect(await embeddedCount(documentId)).toBe(BATCH);
    expect(await documentRow(documentId)).toMatchObject({
      status: "processing",
      chunkCount: total,
      embeddedChunks: BATCH,
      embeddingModel: "fake-embedding-model",
    });
  });

  it("finishes at once when the document fits in one batch", async () => {
    const { embedder } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    const progress = await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: 100 });

    const total = (await chunksOf(documentId)).length;
    expect(progress).toEqual({ status: "ready", chunkCount: total, embeddedChunks: total });
    expect(await documentRow(documentId)).toMatchObject({ status: "ready", chunkCount: total, embeddedChunks: total });
  });

  it("continues batch by batch, in reading order, until the document is ready", async () => {
    const { embedder, state, embeddedTexts } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });
    await finish(embedder, documentId);

    const chunks = await chunksOf(documentId);
    expect(state.calls.every((texts) => texts.length <= BATCH)).toBe(true);
    expect(embeddedTexts()).toEqual(chunks.map((c) => c.text));
    expect(chunks.every((c) => Array.isArray(c.embedding) && c.embedding.length === embedder.dimensions)).toBe(true);
    const document = await documentRow(documentId);
    expect(document).toMatchObject({ status: "ready", chunkCount: chunks.length, embeddedChunks: chunks.length });
    expect(document?.ingestLockedUntil).toBeUndefined();
  });

  it("counts vectors reused from the user's other documents as already embedded", async () => {
    await ingestDocument({ db, embedder: fakeEmbedder().embedder, userId: "user-a", documentId: await storeDocument("user-a"), pages });

    const again = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    const progress = await startIngestion({ db, embedder: again.embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    expect(progress.status).toBe("ready");
    expect(again.embeddedTexts()).toEqual([]);
  });

  it("stops at the quota without losing work, and carries on afterwards", async () => {
    const { embedder, state } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    state.failWith = rateLimited();
    const paused = await continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH });

    expect(paused).toMatchObject({ status: "processing", embeddedChunks: BATCH, retryAfterSeconds: 30 });
    expect(await documentRow(documentId)).toMatchObject({ status: "processing", embeddedChunks: BATCH });
    expect(await embeddedCount(documentId)).toBe(BATCH);

    state.failWith = null;
    await finish(embedder, documentId);
    expect((await documentRow(documentId))?.status).toBe("ready");
  });

  it("keeps the document processing, with all chunks stored, when the quota is hit on the first batch", async () => {
    const { embedder, state } = fakeEmbedder();
    state.failWith = rateLimited();
    const documentId = await storeDocument("user-a");
    const progress = await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    expect(progress).toMatchObject({ status: "processing", embeddedChunks: 0, retryAfterSeconds: 30 });
    expect((await chunksOf(documentId)).length).toBe(progress.chunkCount);
    expect((await documentRow(documentId))?.status).toBe("processing");
  });

  it("marks the document failed and removes its chunks when embedding fails for another reason", async () => {
    const { embedder, state } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    state.failWith = new Error("invalid request");
    await expect(continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH })).rejects.toBeInstanceOf(
      EmbeddingError,
    );
    expect((await documentRow(documentId))?.status).toBe("failed");
    expect(await chunksOf(documentId)).toHaveLength(0);
  });

  it("lets only one request index a document at a time", async () => {
    const { embedder } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    await db.collection("documents").updateOne({ _id: documentId }, { $set: { ingestLockedUntil: new Date(Date.now() + 60_000) } });
    await expect(continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH })).rejects.toBeInstanceOf(
      IngestionBusyError,
    );

    // An expired lock (a request that died mid-batch) doesn't block the document forever.
    await db.collection("documents").updateOne({ _id: documentId }, { $set: { ingestLockedUntil: new Date(Date.now() - 1) } });
    expect((await continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH }))?.embeddedChunks).toBeGreaterThan(BATCH);
  });

  it("never embeds the same chunk twice when two requests race", async () => {
    const { embedder, embeddedTexts } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    const results = await Promise.allSettled([
      continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH }),
      continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH }),
    ]);

    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected.length).toBeLessThanOrEqual(1);
    rejected.forEach((r) => expect(r.status === "rejected" && r.reason).toBeInstanceOf(IngestionBusyError));
    expect(new Set(embeddedTexts()).size).toBe(embeddedTexts().length);
  });

  it("reports a ready document as ready without embedding anything", async () => {
    const { embedder, state } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: 100 });
    const calls = state.calls.length;

    expect((await continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH }))?.status).toBe("ready");
    expect(state.calls).toHaveLength(calls);
  });

  it("returns null for another user's document or a failed one", async () => {
    const { embedder } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    expect(await continueIngestion({ db, embedder, userId: "user-b", documentId, batchSize: BATCH })).toBeNull();
    await db.collection("documents").updateOne({ _id: documentId }, { $set: { status: "failed" } });
    expect(await continueIngestion({ db, embedder, userId: "user-a", documentId, batchSize: BATCH })).toBeNull();
  });

  it("never offers a chunk that is still waiting for its vector for reuse", async () => {
    const { embedder } = fakeEmbedder();
    const documentId = await storeDocument("user-a");
    await startIngestion({ db, embedder, userId: "user-a", documentId, pages, batchSize: BATCH });

    const pending = await db.collection("chunks").findOne({ documentId, embedding: { $exists: false } });
    expect(pending).not.toBeNull();
    expect((await findEmbeddingsByHash(db, "user-a", [String(pending?.contentHash)])).size).toBe(0);
  });
});

describe("chunk storage", () => {
  it("looks up stored vectors by hash for one user only", async () => {
    const { embedder } = fakeEmbedder();
    await ingestDocument({ db, embedder, userId: "user-a", documentId: await storeDocument("user-a"), pages });
    const hash = contentHash(paragraph(3, 100), embedder.model);

    expect((await findEmbeddingsByHash(db, "user-a", [hash])).get(hash)).toHaveLength(embedder.dimensions);
    expect((await findEmbeddingsByHash(db, "user-b", [hash])).size).toBe(0);
    expect((await findEmbeddingsByHash(db, "user-a", [])).size).toBe(0);
  });

  it("indexes chunks uniquely by position in a document, and by owner and hash for reuse", async () => {
    const keys = (await db.collection("chunks").indexes()).map((i) => ({ key: i.key, unique: i.unique ?? false }));
    expect(keys).toContainEqual({ key: { documentId: 1, chunkIndex: 1 }, unique: true });
    expect(keys).toContainEqual({ key: { userId: 1, contentHash: 1 }, unique: false });
  });
});
