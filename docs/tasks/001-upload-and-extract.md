# 001 — Upload a PDF and extract text per page

**Goal:** a POST to `/api/documents` with a PDF stores one `documents` row and one `pages` row per page, all with `userId`, and a throwaway page shows the extracted text.

Split into two PRs to stay under ~300 changed lines each.

## 001a — validation and extraction (no database)

- `validateUpload({ size, head, documentCount })` returns `{ ok: true }` or `{ ok: false, status, code, message }`. Checks run in this order: over `LIMITS.maxUploadBytes` → 413 `too_large` (message names the limit); first bytes are not `%PDF-` → 415 `not_pdf`; at `LIMITS.maxDocumentsPerUser` → 409 `too_many_documents`.
- `countPages(bytes)` and `extractPages(bytes)` use `unpdf`. Each page becomes `{ pageNumber, text, charCount, isEmpty }`. Text goes through `normalizeText` (LF line endings, collapsed spaces, trimmed lines, at most one blank line). Unreadable input throws `PdfReadError`. Callers may reuse the same bytes for both calls.
- `readServerEnv` rejects, and `/api/health` reports by name, any required variable that still holds a `<placeholder>` from a template.
- `LIMITS.maxUploadBytes` is 4 MB ([ADR-0006](../adr/0006-four-mb-upload-cap.md)).
- Fixture PDFs come from `tests/fixtures/make-fixtures.mjs` (zero dependencies, committed output).

**Tests:** `src/lib/upload/validate.test.ts`, `src/lib/pdf/extract.test.ts`, additions to `src/lib/env.test.ts`, `src/app/api/health/route.test.ts` and `src/lib/limits.test.ts`.

## 001b — storage and route

- `POST /api/documents` (`multipart/form-data`, one `file` field) responds in this order: no user → 401; no file → 400; `validateUpload` → 413/415/409; over `LIMITS.maxPagesPerDocument` or unreadable → 422; every page empty → 422 ("looks scanned; OCR is not supported yet"); otherwise store and return `201 { documentId, pageCount, emptyPages }`.
- Stores the document with `status: "processing"` (embedding comes in 003), `sha256` of the file, `pageCount`, and one `pages` row per page.
- `getUserId()` returns a fixed dev user in development and test only, and `null` in production, so the route answers 401 there until Auth.js lands in 005.
- A throwaway page at `/documents/[id]` shows each page's text (replaced in 005).
- CI caches the MongoDB binary used by `mongodb-memory-server`.

**Tests (integration, mongodb-memory-server):** the happy path writes the expected rows; a second user cannot read them; the 6th upload gets 409; a rejected upload writes nothing.

**Files likely touched:** `src/lib/db/client.ts`, `src/lib/db/documents.ts`, `src/lib/auth/user.ts`, `src/app/api/documents/route.ts`, `src/app/documents/[id]/page.tsx`, `.github/workflows/ci.yml`

## Dependencies (approved)

`unpdf` (001a); `mongodb`, `mongodb-memory-server` as a dev dependency (001b).
