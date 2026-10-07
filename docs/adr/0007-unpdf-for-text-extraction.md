# 0007. unpdf for PDF text extraction

- **Status:** Accepted
- **Date:** 2026-10-01

## Context

Citations need text **per page**, extracted on the server inside a Vercel Function. The extractor must run in Node without a browser, a worker thread or native modules, and stay small enough not to slow cold starts.

## Decision

Use `unpdf`, a serverless build of Mozilla's PDF.js. `extractText(pdf, { mergePages: false })` returns one string per page, and `getDocumentProxy` gives the page count without extracting text, so the 50-page cap is enforced before the expensive step. `src/lib/pdf/extract.ts` wraps it so the rest of the app never imports the library directly.

## Alternatives considered

- **`pdfjs-dist` directly** — the same engine, but 35 MB installed, with a legacy Node build, worker setup and bundler configuration (`serverExternalPackages`) to manage.
- **`pdf-parse`** — popular and simple, but returns one string for the whole document, which loses page boundaries.
- **A hosted parsing API** — better at tables and scans, but adds cost, latency and a third party that sees every document.

## Consequences

- About 2 MB with no dependencies; nothing to configure in Next.js.
- PDF.js takes ownership of the buffer it is given, so the wrapper passes a copy; callers can reuse their bytes.
- Text-only extraction: scanned pages come back empty and are flagged, and tables lose their layout. OCR is a later feature.
- Behind the wrapper, swapping extractors later touches one file.
