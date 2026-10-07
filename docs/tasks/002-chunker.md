# 002 — Chunker

**Goal:** split each page's text into overlapping chunks that never cross a page boundary ([ADR-0004](../adr/0004-page-bounded-chunking.md)).

## Acceptance criteria

- `chunkPage({ pageNumber, text }, { size: 1200, overlap: 200 }): Chunk[]`
- Splits on paragraph breaks first, then sentence ends, and only mid-sentence when a single sentence exceeds `size`.
- Consecutive chunks share about `overlap` characters.
- Empty or whitespace-only pages produce zero chunks; short pages produce exactly one.
- Deterministic: same input, same output, same `chunkIndex` order.
- `contentHash` = SHA-256 of normalised text + embedding model name.

## Tests first

Edge cases: empty page, one short line, exactly `size` characters, one giant sentence with no punctuation, Unicode (Tamil, emoji), Windows line endings, `overlap >= size` (throws).

## Files

`src/lib/chunking/chunker.ts`, `src/lib/chunking/chunker.test.ts`
