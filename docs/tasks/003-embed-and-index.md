# 003 — Embed chunks and create the vector index

**Goal:** after upload, every chunk has a 768-dim vector, searchable per user.

## Acceptance criteria

- `embedChunks(chunks)` calls `embedMany` in batches and skips chunks whose `contentHash` already has a vector.
- The upload route runs extract → chunk → embed → store and sets `status: "ready"` (or `"failed"` with `error`).
- `scripts/create-indexes.ts` creates the normal indexes and the `chunks_vector` Atlas Vector Search index from `docs/ARCHITECTURE.md`. Safe to run twice.
- The model name and dimensions come from `readServerEnv()`; each document stores its `embeddingModel`.

## Tests first

- Unit with a mocked embedder: batching, hash-skip, and a failure marks the document `failed`.
- Integration: a vector search for user A never returns user B's chunks (needs Atlas; run manually and paste the output in the PR).

## Files likely touched

`src/lib/ai/embed.ts`, `src/lib/ingest.ts`, `scripts/create-indexes.ts`, `src/app/api/documents/route.ts`

## New dependencies

`ai`, `@ai-sdk/google`
