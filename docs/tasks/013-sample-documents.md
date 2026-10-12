# 013 — Sample documents

**Goal:** anyone trying DocuMind can add a ready-to-ask public document in one click, without having a PDF to hand and without using the shared free embedding quota (about 1,000 embedded passages a day for all users together).

## Acceptance criteria

### 013a — server

- A catalog (`src/lib/samples/catalog.ts`) lists the samples: the NIST Cybersecurity Framework 2.0 and IRS Publication 501, both US-government public domain and already in `evals/docs`. Two samples let a tester try asking across documents straight away.
- `npm run samples` indexes each sample once as a template owned by the user `samples`, which no sign-in can produce, and skips templates already indexed from the same file with the current embedding model. It uses the same batched ingestion as uploads and waits out per-minute quota pauses.
- `POST /api/documents/samples` with `{ "sample": "<key>" }` copies the template's document, pages and chunks, vectors included, into the user's library, ready at once, with no embedding calls. It answers `201 { document }`. The template is left untouched.
- Refusals: `400` unknown sample, `401` signed out, `409 sample_already_added`, `409 too_many_documents`, `429 daily_upload_limit_reached` (a sample counts as an upload), `503 sample_unavailable` when no template exists for the current embedding model.

### 013b — interface

- The document list offers each sample with a "Try a sample" button while the library has room; adding one shows it as ready, and errors show the server's message.
- The landing page says a sample is available, so no PDF is needed to try it.

## Tests first

- Unit: the catalog.
- Integration: the copy (rows, vectors, ownership, no embedding), the template left untouched, and each refusal.
- Component: the sample buttons in the document list.
