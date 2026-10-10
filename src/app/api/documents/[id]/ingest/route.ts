import { EmbeddingError, getEmbedder } from "@/lib/ai/embed";
import { errorResponse, rateLimited, unauthorized, withDatabaseErrors } from "@/lib/api/responses";
import { getUserId } from "@/lib/auth/user";
import { getDb } from "@/lib/db/client";
import { getDocument } from "@/lib/db/documents";
import { continueIngestion, IngestionBusyError } from "@/lib/ingest";

// One batch of embeddings plus storage; well under a minute.
export const maxDuration = 60;

/**
 * Index the next batch of a large document's chunks. The browser calls this
 * until the document is ready, waiting out the free-tier quota when told to.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/documents/[id]/ingest">) {
  return withDatabaseErrors(async () => {
    const userId = await getUserId();
    if (!userId) return unauthorized("Sign in to index documents.");

    const { id } = await ctx.params;
    const db = await getDb();
    const document = await getDocument(db, userId, id);
    if (!document) return errorResponse(404, "document_not_found", "That document doesn't exist.");
    if (document.status === "failed") {
      return errorResponse(409, "document_failed", "Indexing this document failed. Delete it and upload it again.");
    }

    try {
      const progress = await continueIngestion({ db, embedder: getEmbedder(), userId, documentId: document._id });
      if (!progress) return errorResponse(404, "document_not_found", "That document doesn't exist.");

      const { retryAfterSeconds, ...counts } = progress;
      if (retryAfterSeconds) {
        return rateLimited(
          `The free indexing quota is used up for this minute. Indexing continues in ${retryAfterSeconds} seconds.`,
          retryAfterSeconds,
          { chunkCount: counts.chunkCount, embeddedChunks: counts.embeddedChunks },
        );
      }
      return Response.json(counts);
    } catch (cause) {
      if (cause instanceof IngestionBusyError) {
        return errorResponse(409, "ingest_in_progress", "This document is already being indexed. Try again in a moment.");
      }
      if (cause instanceof EmbeddingError) {
        return errorResponse(502, "embedding_failed", "Indexing this document failed. Delete it and upload it again.");
      }
      throw cause;
    }
  });
}
