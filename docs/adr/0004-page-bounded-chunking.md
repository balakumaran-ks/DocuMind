# 0004. Page-bounded chunks with overlap

- **Status:** Accepted (sizes are provisional until the Week 4 eval)
- **Date:** 2026-09-30

## Context

Answers must cite a page. If a chunk spans two pages, a citation to it is ambiguous. Chunks also need to be small enough that the top 5 are specific, and large enough to hold a complete idea.

## Decision

Chunk **each page separately**. Within a page, split on paragraph, then sentence boundaries into chunks of about **1,200 characters (~300 tokens) with 200 characters of overlap**. A page shorter than one chunk becomes a single chunk. Every chunk stores exactly one `pageNumber`.

## Alternatives considered

- **Chunk the whole document as one stream** — better for ideas that cross page breaks, but citations need a page range and become harder to verify.
- **One chunk per page** — simplest, but long pages dilute retrieval and waste context.
- **Fixed token windows ignoring sentences** — cuts sentences in half and hurts both retrieval and readability of the cited text.

## Consequences

- Citations are always exact pages.
- A sentence split across a page break is split in two; overlap cannot fix that. Measure how often it matters in the eval set.
- Week 4 tries 2–3 sizes (e.g. 800 / 1,200 / 2,000 chars) and keeps the best hit@5. Record the numbers here or in a superseding ADR.
