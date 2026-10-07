# 003 — Embed chunks and create the vector index

**Goal:** after upload, every chunk has a 768-dimension vector stored with it, the document becomes `ready`, and the Atlas vector index can search it per user.

## Acceptance criteria

- `src/lib/ai/embed.ts`: an `Embedder` with `embedDocuments(texts)` (task type `RETRIEVAL_DOCUMENT`) and `embedQuery(text)` (`RETRIEVAL_QUERY`), at `EMBEDDING_DIMENSIONS`. Returns one vector per text in order, rejects vectors of the wrong size, and wraps provider failures in `EmbeddingError`. Batches are split by the AI SDK; at most `LIMITS.embedMaxParallelCalls` calls run at once.
- `src/lib/ingest.ts`: `ingestDocument` chunks the pages, hashes each chunk with `contentHash`, reuses stored vectors **for the same user** with the same hash, embeds only new chunks, stores all chunks, and marks the document `ready` with `chunkCount` and `embeddingModel`. On failure it marks the document `failed` with a message and stores no chunks.
- `src/lib/db/chunks.ts`: chunk rows with `userId`, `documentId`, `pageNumber`, `chunkIndex`, `start`, `end`, `text`, `contentHash`, `embedding`. Indexes: unique `{ documentId, chunkIndex }`, and `{ userId, contentHash }` for reuse.
- `POST /api/documents` runs ingestion after storing pages and returns `status` and `chunkCount`. If embedding fails it responds `502 embedding_failed` with the `documentId`, and the document stays `failed` for a later retry.
- `src/lib/db/search-index.ts` + `npm run db:indexes`: create the `chunks_vector` Atlas Vector Search index (768 dims, cosine, filters `userId` and `documentId`) if it doesn't exist.

## Tests first

- Unit: embedder against the AI SDK's mock model; index definition; `LIMITS.embedMaxParallelCalls`.
- Integration (mongodb-memory-server, fake embedder): chunk fields; document marked ready; vectors reused for the same user and never across users; only new chunks embedded; failure leaves no chunks; chunk indexes; the route's `201` and `502` responses.
- Manual (Atlas only, since the memory server has no vector search): run `npm run db:indexes`, wait until the index is queryable, and check that a search as user A never returns user B's chunks.

## Files

`src/lib/ai/embed.ts`, `src/lib/ingest.ts`, `src/lib/db/chunks.ts`, `src/lib/db/documents.ts`, `src/lib/db/search-index.ts`, `src/lib/db/client.ts`, `src/app/api/documents/route.ts`, `scripts/create-indexes.ts`, `src/lib/limits.ts`

## New dependencies

`ai`, `@ai-sdk/google`, `zod` (peer dependency of `ai`)
