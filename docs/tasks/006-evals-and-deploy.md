# 006 — First eval set and deploy

**Goal:** measure quality from day one, and put the MVP online.

## Acceptance criteria

- `evals/questions.jsonl`: 15 questions over 2–3 public PDFs, each `{ question, documentFile, expectedPages, answerable }`; at least 3 are not answerable from the documents.
- `npm run eval` ingests the PDFs into a test database, asks every question, prints hit@5, citation accuracy and refusal rate, and writes `evals/results/<date>.json`.
- The README eval table is filled with the first baseline.
- Deployed to Vercel with env vars set; the Google OAuth redirect URI updated for the production domain.

## Delivery notes

- Corpus: the NIST Cybersecurity Framework 2.0 (32 pages, 84 chunks) and IRS Publication 501 for 2025 (31 pages, 220 chunks), both US-government works in the public domain. Expected pages are PDF page numbers, which is what the app cites.
- The Gemini free tier allows 100 embedded texts and 5 answer calls per minute. The eval paces both and reuses documents that are already indexed, so a rerun costs one embedding and one answer per question.
- The same embedding quota meant an upload of more than about 100 chunks (roughly 15 dense pages) failed to index on the free tier; [task 007](007-free-tier-ingestion.md) indexes large documents in batches instead.

## MVP gate (end of Week 2)

On the live URL: upload → ask → click a citation → ask something not in the document → see the refusal.

**Passed on 2026-10-10** at https://documind99.vercel.app: Google sign-in, upload, a cited answer, and the refusal for a question the document doesn't answer.
