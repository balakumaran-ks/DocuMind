# 009 — Thumbs up/down on answers

**Goal:** users can rate each answer, so poor answers on the live site can be found and traced back to retrieval or generation (each answer already stores the chunks it was built from).

## Acceptance criteria

- `POST /api/messages/:id/feedback` with `{ "rating": "up" | "down" | null }` rates one of the signed-in user's answers; `null` clears the rating. It answers `200 { rating }`, `400 invalid_request` for any other body, `404 message_not_found` for another user's message, a question or a malformed id, and `401` without a session.
- The rating is stored on the answer as `feedback: { rating, updatedAt }`; clearing removes it. Nothing else on the message or its chat changes.
- `GET /api/chats/:id/messages` and the document page return each message's `rating` (`null` for questions and unrated answers), so a rating survives a reload.
- Each saved answer, refusals included, shows "Good answer" and "Bad answer" buttons with the current rating pressed. Clicking the pressed one clears it. Questions, answers still streaming and answers that couldn't be reloaded have no buttons.
- A new rating shows at once and the buttons wait until it is saved; if saving fails, the previous rating comes back with the server's message.

## Tests first

- Integration: the feedback route (set, change, clear, nothing else changed, the 404/400/401 cases) and ratings in the messages route.
- Component: `FeedbackButtons` (pressed state, saving, clearing, reverting on errors) and where `ChatView` shows it.
