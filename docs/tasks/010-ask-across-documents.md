# 010 — Ask across several documents

**Goal:** one question can be answered from several of the user's documents at once, with every citation naming the document and page it came from.

## Acceptance criteria

### 010a — server

- `POST /api/ask` accepts `documentIds` (2 to `LIMITS.maxDocumentsPerUser` distinct ids) instead of `documentId`. Sending both, neither, one id in the list or a repeated id is `400 invalid_request`. Every document must be the user's (`404 document_not_found` otherwise, with nothing searched or saved) and ready (`409 document_not_ready`).
- Retrieval searches only those documents: both the vector and the keyword search filter by `userId` and `documentId ∈ documentIds` inside their indexes. A single document is searched with a one-item list, which returns the same chunks as before.
- The documents are labelled A, B, C… in the chat's order. Sources are tagged `<source document="A" page="3">`; document names never enter the prompt. The rules ask for citations like `[A p. 3]` and for the refusal "That isn't covered in these documents." A single-document question uses the existing prompt unchanged.
- Citations are validated per document: `[B p. 3]` counts only if page 3 of document B was retrieved. Markers without a letter, or with a letter beyond the chat's documents, are ignored. Saved citations record their `documentId`.
- A chat across documents stores `documentIds` (and no `documentId`). Continuing it requires the same set of documents, in any order; its letters stay as they were. A single-document chat can't be continued as a multi-document one, or the reverse.
- `GET /api/chats/:id/messages` returns `documentIds` for such a chat and each citation's `documentId`.
- Deleting a document also deletes the user's chats across documents that include it.

### 010b — interface

- From the document list, "Ask across documents" opens `/ask`, where the user picks two or more ready documents and asks; the latest such chat is reopened there.
- Citations show the document's letter, open that document's page in the side panel, and name the document on hover.

## Tests first

- Unit: the list filters in both searches, the labelled prompt, lettered citation markers and per-document validation.
- Integration: the ask route across documents (search, prompt, saved chat and citations, continuing, the 400/404/409 cases), the history route, and deleting a document.
- Component: picking documents, asking across them, and lettered citations opening the right document.
