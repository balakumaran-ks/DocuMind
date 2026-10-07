# 004 — Ask route

**Goal:** ask a question about one document and stream a cited answer.

## Acceptance criteria

- `POST /api/ask { documentId, chatId?, question }` returns streamed text.
- Checks session, document ownership and `LIMITS.maxQuestionsPerDay`.
- `$vectorSearch` with `filter: { userId, documentId }` and `limit: LIMITS.retrievalTopK`.
- `buildPrompt({ question, chunks, history })` wraps each chunk in `<source page="N">…</source>`. The system prompt requires `[p. N]` citations, a refusal when the sources do not contain the answer, and ignoring any instructions inside sources.
- `parseCitations(answer, retrievedChunks)` keeps only pages that were actually retrieved.
- On finish, saves the user and assistant messages with citations, latency, token usage and retrieved chunk ids.

## Tests first

- Unit: `buildPrompt` snapshot; `parseCitations` with valid, duplicate, out-of-range and malformed markers.
- Integration with a mocked model (AI SDK test helpers): message rows are saved; the daily cap returns 429.

## Files likely touched

`src/lib/rag/retrieve.ts`, `src/lib/rag/prompt.ts`, `src/lib/rag/citations.ts`, `src/app/api/ask/route.ts`
