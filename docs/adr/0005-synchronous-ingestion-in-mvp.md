# 0005. Ingest inside the upload request for the MVP

- **Status:** Accepted, to be superseded in V1
- **Date:** 2026-09-30

## Context

Ingestion (parse, chunk, embed, store) for a 50-page PDF takes seconds to tens of seconds, mostly embedding calls. A queue and worker add Redis, a second process and a second deploy target.

## Decision

In the MVP, run ingestion inside `POST /api/documents` and return when the document is `ready`. Cap documents at 50 pages and 4 MB (ADR-0006) to stay under the function time limit, and set the route's `maxDuration` explicitly.

## Alternatives considered

- **BullMQ + Upstash Redis worker from day one** — the right end state, but it delays the first end-to-end demo by several days.
- **Next.js `after()` to finish work post-response** — still bound by the same function lifetime, and gives no retries or progress.

## Consequences

- Simple to build and to test; the user waits on a spinner during upload.
- A timeout leaves a document in `processing`; the route marks it `failed` on error, and the UI offers a retry.
- V1 moves the same `src/lib/ingest` function into a BullMQ worker with retries and a progress bar, and the route returns `202 Accepted`. Measure upload response time before and after for the resume bullet.
