# 008 — Better answers, measured

**Goal:** improve answer quality with changes that are each kept only if the eval improves.

## Acceptance criteria

- **008a:** the eval set grows to 30 questions (7 not answerable), targeting single lines in long lists, answers that span pages and exact identifiers. `npm run eval` prints per-question changes since the previous run, saves partial results when a daily quota runs out, records provider failures without ending the run, and can re-score a saved run with `--rescore`. A new baseline is recorded in the README.
- **008b:** hit@5 is measured at the passage level: each answerable question names an evidence phrase that a retrieved chunk on an expected page must contain. `npm run eval -- --retrieval` measures retrieval alone and flags evidence that isn't on the expected pages.
- **008c:** page headers and footers that repeat across a document are removed before chunking, kept only if passage-level hit@5 improves.
- **008d:** hybrid search (vector + keyword, merged with `$rankFusion`), kept only if hit@5 and citation accuracy improve.

The original 008b (rewording the refusal rule) was dropped: the one "false refusal" was a retrieval miss hidden by page-level scoring, since the chunk holding the answer was never retrieved.

## Results

- **008c, not adopted.** Removing repeated headers, footers and page numbers before chunking (NIST: 84 → 77 chunks; IRS: 220 → 219) lowered passage-level hit@5 from 87% to 83% (page level 96% → 91%), measured with `npm run eval -- --retrieval` ([result](../../evals/results/retrieval/2026-10-11-0812.json)). The three existing misses stayed, and "Which CSF subcategory covers maintaining inventories of hardware?" was lost: without the header, page 23 split into different chunks and the passage ranked lower. Chunk boundaries matter more than the header text, so the change was dropped. The eval now re-indexes its documents whenever extracted text or chunk settings change, reusing vectors for unchanged chunks.

## Tests first

- Unit: per-question correctness and run comparison in `src/lib/eval/metrics.ts`.
- 008b and 008c: eval runs before and after, committed with the change.

## Notes

- The Gemini free tier's daily limit for `gemini-3.5-flash` (20 answers) cut the first 30-question run short; answers now use `gemma-4-26b-a4b-it` with Gemini 3.5 Flash as backup ([ADR-0009](../adr/0009-gemma-answers-with-gemini-backup.md)).
- Two expected-page labels were corrected after review (page 12 discusses both profile types; page 10 holds the head-of-household qualifying-person table).
