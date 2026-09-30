# DocuMind — Product Requirements

> Status: **Draft v0.1** (Setup phase). Owner: Balakumaran. Challenge it before the MVP starts.

## Problem

Reading a long PDF to find one fact is slow, and general chatbots answer from memory instead of from the document in front of you, with no way to check them. People who work from documents (students with a textbook chapter, engineers with a spec, anyone with a policy) need answers they can **verify in one click**.

## User

One signed-in person working with their own text PDFs: course notes, papers, manuals, policies. They care more about "is this answer really in my document?" than about speed or polish.

## What success looks like

- Upload a 30-page PDF and ask the first question in under 30 seconds.
- Every answer cites the page(s) it came from; clicking a citation shows that page's text.
- When the answer is not in the document, DocuMind says so instead of guessing.
- Measured on our eval set: retrieval hit@5 ≥ 85%, citation accuracy ≥ 90%, refusal on not-in-document questions ≥ 90%.

## MVP features (end of Week 2)

| # | Feature | Acceptance |
| --- | --- | --- |
| 1 | Upload a text PDF | Up to 10 MB and 50 pages. Type, size and page count checked on the server. Text stored per page. Empty (scanned) pages are detected and reported. |
| 2 | Ask questions about one document | Top 5 chunks retrieved from that document only; answer grounded in them. |
| 3 | Page-level citations | Answer contains `[p. N]` markers; each one is clickable and opens that page's text. |
| 4 | Refusal | If the retrieved text does not contain the answer, the reply says it is not in the document. |
| 5 | Streaming answers | First tokens appear while the rest is generated. |
| 6 | Sign in with Google | Nothing is accessible signed-out; users never see each other's data. |
| 7 | Chat history per document | Reopening a document shows its previous questions and answers. |

**Limits (enforced in `src/lib/limits.ts`):** 5 documents per user, 50 questions per user per day.

## Later (not MVP)

- **V1 (Week 3):** ask across several documents (workspace), background ingestion with a progress bar, thumbs up/down on answers.
- **Retrieval quality (Week 4):** hybrid vector + keyword search, reranking, chunk-size experiments, all decided by evals.
- **Later:** scanned PDFs (OCR), DOCX and web URLs, auto-summary and quiz, shared workspaces.

## Non-goals

- Payments or plans, a mobile app, fine-tuning a model.
- Editing or annotating PDFs; DocuMind reads, it does not write.
- Answers from general knowledge. If it is not in the document, DocuMind does not answer.

## Risks and open questions

| Question | Current answer |
| --- | --- |
| Free-tier Gemini quota may be too small for evals | Model is behind the AI SDK; Groq / OpenRouter / Ollama are fallbacks. Embedding results are cached by content hash. |
| Large PDFs may exceed serverless time limits | 50-page cap in the MVP; queue + worker in V1. |
| Prompt injection inside uploaded documents | Document text is wrapped and labelled as data; system prompt forbids following it. Guard tests in Hardening. |
| Is one chat per document enough? | Yes for the MVP; the data model allows several chats per document later. |
