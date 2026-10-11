# 0010. Hybrid search: vector and keyword, merged with `$rankFusion`

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

With passage-level scoring (task 008b), vector search missed the passage holding the answer for 3 of 23 answerable eval questions. In each miss the question shares exact words with the passage ("called … before version 2.0", "backups of data", "five filing statuses") but the embedding ranked other chunks of the same topic higher. Vectors match meaning; they blur exact terms, identifiers and short lines inside long lists. Removing repeated headers and footers (008c) did not help.

Atlas free clusters allow three search indexes in total, of any type, and the cluster already used all three (the app's vector index, the eval database's vector index, and a sample dataset's index).

## Decision

Retrieve with two searches over the same chunks, each filtered by `userId` and `documentId` inside its index: `$vectorSearch` on the question's embedding and Atlas Search (`$search`, BM25, English analyzer) on the question's words, 20 results each. `$rankFusion` merges the two rankings by reciprocal rank fusion with equal weights, and the top 5 chunks are kept. The keyword index is `chunks_text`. The eval's documents move into the app database under the user `eval`, so the eval no longer needs a vector index of its own.

## Alternatives considered

- **Vector search only, tuned** (more candidates, smaller chunks) — doesn't address exact-term misses, and chunk changes shifted other questions (008c).
- **Fuse the two result lists in application code** — two round trips and more code; `$rankFusion` does it in one query on the cluster's MongoDB 8.0.
- **Weighted fusion or score thresholds** — more knobs to tune against a 23-question set, which risks fitting the eval rather than the documents.
- **A reranking model** — another model call per question on a free tier with daily limits; revisit if hybrid search plateaus.

## Consequences

Eval, 23 answerable and 7 unanswerable questions, answers by `gemma-4-26b-a4b-it` (2026-10-11):

| Metric | Vector only | Hybrid |
| --- | --- | --- |
| Retrieval hit@5, passage level | 87% | 96% |
| Retrieval hit@5, page level | 96% | 100% |
| Citation accuracy | 87% | 96% |
| Refusal on not-in-document questions | 100% | 100% |
| False refusals | 4% | 0% |

The two retrieval misses fixed are the exact-wording ones ("called … before version 2.0", "backups of data"); no question was lost. The remaining miss is a list whose opening sentence is on the previous page.

- Each question runs one aggregation instead of one vector search; the keyword half adds no model calls.
- Retrieval scores are now fused ranks (around 0.016–0.033), not cosine similarities. They are only compared with each other (to link a cited page to its best chunk), so nothing depends on their scale.
- A new deployment needs `npm run db:indexes` to create the keyword index. Without it, `$search` returns nothing and retrieval falls back to the vector ranking alone.
- The eval writes to the app database, but only as the user `eval`, which no sign-in can produce (app users are `google:<id>`).
- Revisit if documents in other languages are supported (the English analyzer stems English only), or when a fourth search index is needed on the free cluster.
