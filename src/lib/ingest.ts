import type { Db, ObjectId } from "mongodb";
import { EmbeddingRateLimitError, type Embedder } from "@/lib/ai/embed";
import { chunkDocument, contentHash, type PageInput } from "@/lib/chunking/chunker";
import {
  countChunks,
  deleteChunksForDocument,
  findEmbeddingsByHash,
  findPendingTexts,
  insertChunks,
  setEmbeddings,
} from "@/lib/db/chunks";
import {
  claimForIngestion,
  getDocument,
  markDocumentFailed,
  markDocumentProgress,
  markDocumentReady,
  releaseIngestion,
} from "@/lib/db/documents";
import { LIMITS } from "@/lib/limits";

/** Where a document's indexing stands. `retryAfterSeconds` is set when the quota stopped this batch. */
export type IngestProgress = {
  status: "ready" | "processing";
  chunkCount: number;
  embeddedChunks: number;
  retryAfterSeconds?: number;
};

export type IngestResult = {
  chunkCount: number;
  /** Chunks whose vectors were computed now. */
  embedded: number;
  /** Chunks that reused a vector this user already had for the same text and model. */
  reused: number;
};

/** Another request is embedding this document right now. */
export class IngestionBusyError extends Error {
  constructor() {
    super("This document is already being indexed.");
    this.name = "IngestionBusyError";
  }
}

type Target = { db: Db; embedder: Embedder; userId: string; documentId: ObjectId };

/** Marks the document failed with none of its chunks kept (best effort: if the database is down, the original error wins). */
async function fail({ db, userId, documentId }: Target, error: unknown) {
  await deleteChunksForDocument(db, userId, documentId).catch(() => undefined);
  const reason = error instanceof Error ? error.message : "Ingestion failed.";
  await markDocumentFailed(db, userId, documentId, reason).catch(() => undefined);
}

/**
 * Embeds up to `batchSize` waiting texts and records the progress, marking the
 * document ready after the last one. A quota error pauses instead of failing;
 * any other error marks the document failed and is rethrown.
 */
async function embedNextBatch(target: Target, batchSize: number): Promise<IngestProgress> {
  const { db, embedder, userId, documentId } = target;
  try {
    const waiting = await findPendingTexts(db, userId, documentId, batchSize);
    // Another of the user's documents may have embedded the same text since this one was stored.
    const vectors = await findEmbeddingsByHash(db, userId, waiting.map((w) => w.contentHash));
    const toEmbed = waiting.filter((w) => !vectors.has(w.contentHash));

    let retryAfterSeconds: number | undefined;
    try {
      const fresh = await embedder.embedDocuments(toEmbed.map((w) => w.text));
      toEmbed.forEach((w, i) => {
        const vector = fresh[i];
        if (!vector) throw new Error(`No vector for "${w.contentHash}".`);
        vectors.set(w.contentHash, vector);
      });
    } catch (error) {
      if (!(error instanceof EmbeddingRateLimitError)) throw error;
      retryAfterSeconds = error.retryAfterSeconds;
    }
    await setEmbeddings(db, userId, documentId, vectors);

    const { total, embedded } = await countChunks(db, userId, documentId);
    // Only an upload that died before storing its chunks leaves a document with none.
    if (total === 0) throw new Error("This document has no stored text. Delete it and upload it again.");
    if (embedded === total) {
      await markDocumentReady(db, userId, documentId, { chunkCount: total, embeddingModel: embedder.model });
      return { status: "ready", chunkCount: total, embeddedChunks: total };
    }
    await markDocumentProgress(db, userId, documentId, { chunkCount: total, embeddedChunks: embedded, embeddingModel: embedder.model });
    return { status: "processing", chunkCount: total, embeddedChunks: embedded, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) };
  } catch (error) {
    await fail(target, error);
    throw error;
  }
}

/**
 * Chunks a stored document's pages and stores every chunk at once, reusing
 * vectors the user already has for the same text, then embeds the first
 * batch. Small documents come back ready; larger ones come back processing
 * and are finished by `continueIngestion`, one batch per request.
 */
export async function startIngestion(input: Target & { pages: PageInput[]; batchSize?: number }): Promise<IngestProgress> {
  await storeChunks(input);
  return embedNextBatch(input, input.batchSize ?? LIMITS.embedBatchSize);
}

/** Stores every chunk, with a reused vector where the user already has one; returns how many were reused. */
async function storeChunks(input: Target & { pages: PageInput[] }): Promise<number> {
  const { db, embedder, userId, documentId, pages } = input;
  try {
    const chunks = chunkDocument(pages).map((chunk) => ({ ...chunk, contentHash: contentHash(chunk.text, embedder.model) }));
    const vectors = await findEmbeddingsByHash(db, userId, chunks.map((c) => c.contentHash));
    const createdAt = new Date();
    await insertChunks(
      db,
      chunks.map((chunk) => {
        const embedding = vectors.get(chunk.contentHash);
        return {
          userId,
          documentId,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          text: chunk.text,
          contentHash: chunk.contentHash,
          ...(embedding ? { embedding } : {}),
          createdAt,
        };
      }),
    );
    return chunks.filter((c) => vectors.has(c.contentHash)).length;
  } catch (error) {
    await fail(input, error);
    throw error;
  }
}

/**
 * Embeds the next batch of a processing document. Returns null if the
 * document isn't the user's or has failed, reports a ready document as ready,
 * and throws IngestionBusyError while another request holds the document.
 */
export async function continueIngestion(input: Target & { batchSize?: number }): Promise<IngestProgress | null> {
  const { db, userId, documentId, batchSize = LIMITS.embedBatchSize } = input;
  const claimed = await claimForIngestion(db, userId, documentId, LIMITS.ingestLockSeconds);
  if (!claimed) {
    const document = await getDocument(db, userId, documentId.toHexString());
    if (!document || document.status === "failed") return null;
    if (document.status === "ready") {
      const chunkCount = document.chunkCount ?? 0;
      return { status: "ready", chunkCount, embeddedChunks: chunkCount };
    }
    throw new IngestionBusyError();
  }
  try {
    return await embedNextBatch(input, batchSize);
  } finally {
    await releaseIngestion(db, userId, documentId).catch(() => undefined);
  }
}

/**
 * Indexes a whole document in one go (for scripts such as the eval, whose
 * embedder paces itself). Throws if the quota stops it partway.
 */
export async function ingestDocument(input: Target & { pages: PageInput[] }): Promise<IngestResult> {
  const reused = await storeChunks(input);
  const progress = await embedNextBatch(input, Number.POSITIVE_INFINITY);
  if (progress.status !== "ready") {
    throw new EmbeddingRateLimitError({ retryAfterSeconds: progress.retryAfterSeconds ?? 60 });
  }
  return { chunkCount: progress.chunkCount, embedded: progress.chunkCount - reused, reused };
}
