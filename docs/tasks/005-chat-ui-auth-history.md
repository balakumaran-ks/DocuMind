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

## Dependencies to request

`next-auth` (Auth.js v5), `@testing-library/react`, `jsdom`
