# 006 — First eval set and deploy

**Goal:** measure quality from day one, and put the MVP online.

## Acceptance criteria

- `evals/questions.jsonl`: 15 questions over 2–3 public PDFs, each `{ question, documentFile, expectedPages, answerable }`; at least 3 are not answerable from the documents.
- `npm run eval` ingests the PDFs into a test database, asks every question, prints hit@5, citation accuracy and refusal rate, and writes `evals/results/<date>.json`.
- The README eval table is filled with the first baseline.
- Deployed to Vercel with env vars set; the Google OAuth redirect URI updated for the production domain.

## MVP gate (end of Week 2)

On the live URL: upload → ask → click a citation → ask something not in the document → see the refusal.
