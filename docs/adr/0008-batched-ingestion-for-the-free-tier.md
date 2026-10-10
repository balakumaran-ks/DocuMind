# 0008. Index large documents in batches driven by the browser

- **Status:** Accepted (supersedes 0005 for documents larger than one batch)
- **Date:** 2026-10-10

## Context

The Gemini free tier embeds at most 100 texts per minute, counted per text rather than per request. Ingesting inside the upload request (ADR-0005) embeds every chunk at once, so any document over about 100 chunks (roughly 15 dense pages; IRS Publication 501 needs 220) fails with a quota error. Waiting out the quota inside one request would exceed the function time limit, and the project has no budget for a paid tier or a hosted queue.

## Decision

The upload request stores every chunk at once, reusing vectors the user already has, and embeds only the first batch of `LIMITS.embedBatchSize` (80) texts. Documents that fit are `ready` immediately, as before. Larger ones are returned as `processing` with `202`, and the browser calls `POST /api/documents/:id/ingest` to embed one batch per request. When Gemini reports the quota is used up, the route answers `429` with the wait Gemini asks for, the document stays `processing` with nothing lost, and the browser resumes after the wait. A short lock on the document (`ingestLockedUntil`, 90 seconds) keeps two requests from embedding the same chunks.

## Alternatives considered

- **Enable billing on the Gemini API** — removes the limit for pennies per document, but the project runs on free tiers only.
- **Wait out the quota inside the upload request** — a 220-chunk document needs over two minutes, beyond the function time limit.
- **BullMQ + Upstash Redis worker** — the planned V1 design; adds infrastructure, and the worker would still be bound by the same quota.
- **Larger chunks** — fewer embeddings (about 40% fewer at double the size), but coarser retrieval; left for the eval to judge.

## Consequences

- Small documents behave exactly as before; a 220-chunk document indexes in about three minutes instead of failing.
- Indexing progresses only while a browser tab drives it. A document left `processing` resumes from where it stopped when the user returns, because every stored chunk without a vector is simply the next work.
- Chunks without a vector are skipped by the vector index, and questions are blocked until the document is `ready`, so answers never draw on half a document.
- A V1 worker can reuse the same `continueIngestion` function unchanged, calling it in a loop instead of the browser.
- The free tier also has daily quotas; Gemini then asks for a wait of hours ("retry in 22h19m12s"). Waits longer than `LIMITS.quotaWaitMaxSeconds` (five minutes) are reported as "the free daily quota is used up" instead of counted down, and the document stays resumable.
