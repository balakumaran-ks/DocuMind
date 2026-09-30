# 0001. One Next.js app for UI and API

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

DocuMind is built by one person at about two hours a day. Every extra deployable unit costs setup, CI and debugging time. The UI needs streaming responses and the API is a handful of routes.

## Decision

Use a single Next.js (App Router) project: React pages for the UI and route handlers under `src/app/api` for the API. Business logic lives in framework-free modules in `src/lib` so it can be unit tested and moved later.

## Alternatives considered

- **Separate Express API + React SPA (classic MERN)** — two deploys, CORS and duplicated types for no MVP benefit.
- **Python (FastAPI) backend for RAG** — richer ML ecosystem, but a second language and service; nothing in the MVP needs it.

## Consequences

- One repo, one deploy on Vercel, shared TypeScript types end to end.
- Long-running work (ingestion) is bound by serverless time limits; see ADR-0005.
- If ingestion or retrieval outgrows serverless, `src/lib` can move into a worker without rewriting it.
