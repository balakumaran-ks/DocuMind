# DocuMind — Product Requirements

> **Version 1.0** · Scope for the MVP and what follows it.

## Problem

Finding one fact in a long PDF is slow. General-purpose chatbots answer from what they already know rather than from the document in front of the reader, and give no way to check where an answer came from. People who work from documents (students with a textbook chapter, engineers with a specification, employees with a policy) need answers they can **verify in one click**.

## User

A signed-in individual working with their own text PDFs: course notes, papers, manuals, policies. They care more about "is this answer really in my document?" than about speed or polish.

## Success criteria

- A 30-page PDF can be uploaded and asked its first question in under 30 seconds.
- Every answer cites the page or pages it came from, and each citation opens that page's text.
- When the answer is not in the document, DocuMind says so instead of guessing.
- On the eval set: retrieval hit@5 ≥ 85%, citation accuracy ≥ 90%, refusal on not-in-document questions ≥ 90%.

## MVP features

| # | Feature | Acceptance |
| --- | --- | --- |
| 1 | Upload a text PDF | Up to 4 MB and 50 pages ([ADR-0006](adr/0006-four-mb-upload-cap.md)). Type, size and page count are checked on the server. Text is stored per page. Pages with no text (usually scans) are detected and reported. |
| 2 | Ask questions about one document | The top 5 chunks are retrieved from that document only, and the answer is grounded in them. |
| 3 | Page-level citations | Answers contain `[p. N]` markers; each one is clickable and opens that page's text. |
| 4 | Refusal | If the retrieved text does not contain the answer, the reply says it is not in the document. |
| 5 | Streaming answers | The first words appear while the rest is still being generated. |
| 6 | Sign in with Google | Nothing is accessible when signed out, and users never see each other's data. |
| 7 | Chat history per document | Reopening a document shows its earlier questions and answers. |

**Limits** (enforced in `src/lib/limits.ts`): 5 documents per user, 50 questions per user per day.

## After the MVP

- **V1:** ask across several documents (workspaces), background ingestion with a progress bar, thumbs up/down on answers.
- **Retrieval quality:** hybrid vector + keyword search, reranking and chunk-size experiments, each kept only if the eval set improves.
- **Later:** scanned PDFs (OCR), DOCX files and web pages, document summaries and quizzes, shared workspaces.

## Non-goals

- Payments or plans, a mobile app, fine-tuning a model.
- Editing or annotating PDFs: DocuMind reads documents, it does not change them.
- Answers from general knowledge: if it is not in the document, DocuMind does not answer.

## Risks

| Risk | Mitigation |
| --- | --- |
| The free Gemini quota is too small for evals | The model sits behind the Vercel AI SDK, so Groq, OpenRouter or a local Ollama model can replace it; embeddings are cached by content hash. |
| Large PDFs exceed serverless time or size limits | 4 MB and 50-page caps in the MVP; a queue and worker in V1. |
| Prompt injection inside uploaded documents | Document text is wrapped and labelled as data, and the system prompt forbids following it; guard tests are part of hardening. |
| Scanned PDFs return no text | Empty pages are detected and the user is told; OCR is a later feature. |
| One chat per document may be too limiting | Enough for the MVP; the data model already allows several chats per document. |
