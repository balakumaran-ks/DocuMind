# 001 — Upload a PDF and extract text per page

**Goal:** a signed-in user can upload one PDF and see its extracted text, page by page.

## Acceptance criteria

- `POST /api/documents` accepts `multipart/form-data` with one `file` field.
- Rejects on the server, with a clear `4xx` JSON error: no session (401), not a PDF by magic bytes (415), over `LIMITS.maxUploadBytes` (413), over `LIMITS.maxPagesPerDocument` (422), over `LIMITS.maxDocumentsPerUser` (409).
- Extracts text per page with `pdfjs-dist`; normalises whitespace; flags pages with no text as `isEmpty`.
- Stores one `documents` row and one `pages` row per page, all with `userId`.
- Returns `201 { documentId, pageCount, emptyPages }`.
- A throwaway page at `/documents/[id]` shows each page's text (replaced in 005).

Until Auth.js lands in 005, the route reads a fixed dev `userId` behind a `getUserId()` helper, so swapping in the real session is a one-line change.

## Tests first

- Unit: `extractPages(buffer)` on two small fixture PDFs in `tests/fixtures/` (one text, one with a blank page).
- Unit: `validateUpload()` for each rejection case.
- Integration (mongodb-memory-server): the happy path writes the expected rows; a second user cannot read them.

## Files likely touched

`src/lib/pdf/extract.ts`, `src/lib/upload/validate.ts`, `src/lib/db/*.ts`, `src/app/api/documents/route.ts`, `tests/fixtures/*.pdf`

## Dependencies to request

`pdfjs-dist`, `mongodb`, `mongodb-memory-server` (dev)
