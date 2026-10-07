# 0002. MongoDB Atlas Vector Search for vectors

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

The app needs to store users, documents, page text, chat history and ~1–2k embedding vectors per user, and run filtered nearest-neighbour search. The stack goal is MERN, and everything must fit a free tier.

## Decision

Store everything in MongoDB Atlas (M0 free cluster) and use Atlas Vector Search on `chunks.embedding` (768 dims, cosine), with `userId` and `documentId` declared as filter fields.

## Alternatives considered

- **Dedicated vector DB (Pinecone, Qdrant)** — a second datastore to keep in sync with MongoDB; deletes and per-user filtering become two-phase.
- **Postgres + pgvector** — excellent, but leaves the MERN stack the project is meant to demonstrate.
- **In-memory / local FAISS** — does not survive serverless cold starts.

## Consequences

- Vectors and metadata live in one document, so deleting a document deletes its vectors in the same place, and `userId` pre-filtering happens inside the search.
- Keyword search for the Week 4 hybrid experiment can use Atlas Search on the same collection.
- M0 limits (storage, index count) must be checked; per-user caps keep usage well inside them.
