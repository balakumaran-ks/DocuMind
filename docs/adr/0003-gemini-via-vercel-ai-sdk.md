# 0003. Gemini behind the Vercel AI SDK

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

The app needs an embedding model and a chat model with a free tier, streaming, and the freedom to switch providers if quotas change.

## Decision

Call Gemini through the Vercel AI SDK (`ai` + `@ai-sdk/google`): `embedMany` with `gemini-embedding-2` at 768 dimensions, and `streamText` with `gemini-3.5-flash`. Both model names come from environment variables (`src/lib/env.ts`).

## Alternatives considered

- **Google's own SDK directly** — slightly more features, but switching providers would touch every call site.
- **OpenAI / Anthropic** — no comparable free tier for a portfolio project.
- **Local models via Ollama** — free and private, but cannot run on Vercel; kept as a development fallback.

## Consequences

- Switching the chat provider is a one-line change.
- Switching the **embedding** model is not free: vectors from different models are not comparable. Each document records its `embeddingModel`, and a change means re-embedding. The dimension count must match the Atlas index.
- 768 dimensions is Google's recommended smaller size: a quarter of the storage of 3072 with a small quality cost. Revisit with evals in Week 4.
