# 007 — Index large documents within the free tier

**Goal:** documents larger than the Gemini free tier's per-minute embedding quota index successfully instead of failing, at no cost.

## Acceptance criteria

- Upload stores every chunk at once and embeds at most `LIMITS.embedBatchSize` (80) texts; documents that fit are `ready` with `201` as before, larger ones answer `202` with `status: "processing"`, `chunkCount` and `embeddedChunks`.
- `POST /api/documents/:id/ingest` embeds the next batch and marks the document `ready` after the last one.
- A Gemini quota error (`429`) becomes `EmbeddingRateLimitError` with the wait Gemini asks for. Ingestion pauses without losing work; the route answers `429 rate_limited` with `retryAfterSeconds` and `Retry-After`.
- Only one request indexes a document at a time (`409 ingest_in_progress`); an expired lock doesn't block it forever.
- The ask route answers `429 rate_limited` when the question can't be embedded because of the quota.
- The document list shows indexing progress, waits out the quota, and can resume a document left `processing`.

## Tests first

- Unit: quota detection in the embedder, including errors wrapped by the SDK's retries.
- Integration: batch-by-batch progress to `ready`, reuse, pausing at the quota, failure on other errors, the lock and races, user isolation, and the routes' status codes.
- Component: progress text, the quota countdown, and resuming.

## Delivery

- **007a:** server side (embedder, ingestion, upload and ingest routes, ask route). See [ADR-0008](../adr/0008-batched-ingestion-for-the-free-tier.md).
- **007b:** the document list drives indexing, shows progress and resumes.
