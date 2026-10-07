import type { Db, ObjectId } from "mongodb";
import type { Embedder } from "@/lib/ai/embed";
import { chunkDocument, contentHash, type PageInput } from "@/lib/chunking/chunker";
import { deleteChunksForDocument, findEmbeddingsByHash, insertChunks } from "@/lib/db/chunks";
import { markDocumentFailed, markDocumentReady } from "@/lib/db/documents";

export type IngestResult = {
  chunkCount: number;
  /** Chunks whose vectors were computed now. */
  embedded: number;
  /** Chunks that reused a vector this user already had for the same text and model. */
  reused: number;
};

/**
 * Chunks a stored document's pages, embeds what isn't already embedded, stores
 * the chunks and marks the document ready. On any failure the document is
 * marked failed and none of its chunks are kept, then the error is rethrown.
 */
export async function ingestDocument(input: {
  db: Db;
  embedder: Embedder;
  userId: string;
  documentId: ObjectId;
  pages: PageInput[];
}): Promise<IngestResult> {
  const { db, embedder, userId, documentId, pages } = input;

  try {
    const chunks = chunkDocument(pages).map((chunk) => ({
      ...chunk,
      contentHash: contentHash(chunk.text, embedder.model),
    }));

    // Reuse vectors this user already has; embed each new text once.
    const vectors = await findEmbeddingsByHash(db, userId, chunks.map((c) => c.contentHash));
    const isNew = (hash: string) => !vectors.has(hash);
    const embedded = chunks.filter((c) => isNew(c.contentHash)).length;

    const toEmbed = new Map<string, string>();
    for (const chunk of chunks) if (isNew(chunk.contentHash)) toEmbed.set(chunk.contentHash, chunk.text);
    const fresh = await embedder.embedDocuments([...toEmbed.values()]);
    [...toEmbed.keys()].forEach((hash, i) => vectors.set(hash, fresh[i]));

    const createdAt = new Date();
    await insertChunks(
      db,
      chunks.map((chunk) => {
        const embedding = vectors.get(chunk.contentHash);
        if (!embedding) throw new Error(`No vector for chunk ${chunk.chunkIndex}.`);
        return {
          userId,
          documentId,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          start: chunk.start,
          end: chunk.end,
          text: chunk.text,
          contentHash: chunk.contentHash,
          embedding,
          createdAt,
        };
      }),
    );
    await markDocumentReady(db, userId, documentId, { chunkCount: chunks.length, embeddingModel: embedder.model });

    return { chunkCount: chunks.length, embedded, reused: chunks.length - embedded };
  } catch (error) {
    // Best effort: if the database itself is down, these fail too and the original error wins.
    await deleteChunksForDocument(db, userId, documentId).catch(() => undefined);
    const reason = error instanceof Error ? error.message : "Ingestion failed.";
    await markDocumentFailed(db, userId, documentId, reason).catch(() => undefined);
    throw error;
  }
}
