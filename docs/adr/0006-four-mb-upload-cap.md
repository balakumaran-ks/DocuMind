# 0006. 4 MB upload cap in the MVP

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

The PRD promised uploads of up to 10 MB. Vercel Functions reject any request body over 4.5 MB with a `413` before our code runs, and that limit applies to route handlers and Server Actions alike. Uploads between 4.5 and 10 MB would work locally and fail in production.

## Decision

Cap uploads at **4 MB** (`LIMITS.maxUploadBytes`) for the MVP, checked on the server like every other limit. Extract text with `unpdf` (PDF.js packaged for serverless) inside the route.

## Alternatives considered

- **Client upload straight to Vercel Blob, then read it in the route.** Removes the body limit, but adds `@vercel/blob`, a storage service and upload tokens to the first slice.
- **Keep 10 MB and decide later.** Silently broken in production; not acceptable for a demo.

## Consequences

- A 50-page text PDF is almost always well under 4 MB; image-heavy PDFs are usually scanned, and OCR is out of scope anyway.
- The limit has a clear error message that names the cap.
- Revisit in V1: when ingestion moves to a worker (ADR-0005), upload directly to storage and let the worker fetch the file, which lifts the cap.
