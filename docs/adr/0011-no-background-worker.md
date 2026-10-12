# 0011. No background worker: ingestion stays batched and browser-driven

- **Status:** Accepted
- **Date:** 2026-10-12

## Context

The V1 plan was to move ingestion out of the upload request into a queue (BullMQ on Upstash Redis) with a worker process, for retries and a progress bar. Since then, [ADR-0008](0008-batched-ingestion-for-the-free-tier.md) solved the problem that motivated it: every chunk is stored at upload, embedded in batches that fit the Gemini free tier, with progress shown and indexing resumable after a quota pause or a closed tab. What a worker would add is indexing that continues with no browser open.

A BullMQ worker is a long-running process. Vercel functions can't host one, and the remaining free container hosts either sleep when idle or no longer have a free tier. The project has no budget for hosting.

## Decision

Don't build the worker. Ingestion stays as in ADR-0008: the upload stores everything and embeds the first batch, and the document list drives the remaining batches, one request each, showing progress and resuming where it stopped.

## Alternatives considered

- **BullMQ + Upstash Redis + a worker container** — needs an always-on host, which is paid or sleeps; one more service and deployment to run.
- **Upstash QStash calling the ingest route** — a hosted HTTP queue that could call `POST /api/documents/:id/ingest` until the document is ready, with no worker to host. Free for a few hundred messages a day, but it adds an external dependency and a signing secret, and the route would have to accept server-to-server calls.
- **Vercel Cron** — the Hobby plan runs jobs at most once a day, far too slowly to finish a document.

## Consequences

- Indexing a large document needs the document list open; closing the tab pauses it, and "Resume indexing" continues. With a 50-page cap this is at most a few minutes on the free tier.
- No queue, worker, Redis or extra secret to run or secure.
- Revisit with QStash if users report documents left half-indexed, or if the page cap is raised enough that indexing takes long enough for people to leave.
