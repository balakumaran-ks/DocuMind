# 005 — Chat UI, Google sign-in, chat history

**Goal:** the full MVP flow in the browser.

## Acceptance criteria

- Auth.js with Google; every page except `/` requires a session; routes read `userId` from the session (replacing the dev helper from 001).
- Document list with upload button, status and delete.
- Chat view using the AI SDK `useChat` hook: streaming answer, `[p. N]` rendered as buttons that open a side panel with that page's text.
- Reopening a document loads its previous messages.
- Empty state, loading state, upload errors and the "not in the document" answer all look deliberate.

## Tests first

Component tests (Vitest + Testing Library) for citation rendering and the upload error states.

## New dependencies

`next-auth` (Auth.js v5), `@testing-library/react`, `jsdom`

## Delivery

Four pull requests, to keep each under ~300 changed lines:

- **005a:** Google sign-in, the session-based `getUserId()`, `src/proxy.ts`, the `users` collection, the sign-in page and header.
- **005b:** `GET /api/documents`, `DELETE /api/documents/:id`, `GET /api/documents/:id/pages/:n`, `GET /api/chats?documentId=`, `GET /api/chats/:id/messages`.
- **005c:** the document list with upload, status and delete; component tests for the upload error states.
- **005d:** the chat view with streaming, citation buttons and the page panel; component tests for citation rendering.

Decisions made during the task:

- The user id is `google:<Google account id>`, set in the `jwt` callback at sign-in. Without a database adapter Auth.js gives every sign-in a random id, which would separate users from their documents.
- The development user is removed: local development signs in with Google too, and tests mock `getUserId`.
- The chat view uses a small streaming hook over `fetch` instead of `useChat`. It keeps the ask route's plain text stream and `X-Chat-Id` header, avoids `@ai-sdk/react`, and shows only validated citations by reading the saved answer once the stream ends.
