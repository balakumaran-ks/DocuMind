# 002 — Chunker

**Goal:** split each page's text into overlapping chunks that never cross a page boundary ([ADR-0004](../adr/0004-page-bounded-chunking.md)).

## API

```ts
chunkPage({ pageNumber, text }, { size?, overlap? }): PageChunk[]   // { pageNumber, start, end, text }
chunkDocument(pages, { size?, overlap? }): Chunk[]                  // PageChunk + chunkIndex
contentHash(text, model): string                                    // 64 hex chars
```

`size` and `overlap` default to `LIMITS.chunkSize` (1,200 characters) and `LIMITS.chunkOverlap` (200). Input text is already normalised by `normalizeText`.

## Acceptance criteria

- `start`/`end` are offsets into the page text and `text === pageText.slice(start, end)`, with no leading or trailing whitespace.
- Every chunk is at most `size` characters; empty pages give no chunks; a page that fits gives exactly one chunk.
- No gaps: everything between two chunks, if anything, is whitespace. The first chunk starts at the first character, the last ends at the last.
- Consecutive chunks overlap by at most `overlap` characters, and do overlap in normal prose when `overlap > 0`. Each chunk starts after the previous one starts.
- A chunk ends at the latest **paragraph** break that fits, otherwise the latest **sentence** end, otherwise the latest **word** boundary, and splits a word only when one word is longer than `size`. The next chunk starts at a word start.
- A hard split never cuts an emoji or other surrogate pair in half.
- `size <= 0`, `overlap < 0` or `overlap >= size` throw `RangeError`.
- Deterministic: same input, same output.
- `chunkDocument` numbers chunks `0…n-1` across pages in page order, skips empty pages, and never mixes pages in one chunk.
- `contentHash` is SHA-256 of the normalised text and the model name, so whitespace differences don't change it but a different model does.

## Tests first

`src/lib/chunking/chunker.test.ts`, plus `LIMITS.chunkSize` / `LIMITS.chunkOverlap` in `src/lib/limits.test.ts`.

## Files

`src/lib/chunking/chunker.ts`, `src/lib/chunking/chunker.test.ts`, `src/lib/limits.ts`
