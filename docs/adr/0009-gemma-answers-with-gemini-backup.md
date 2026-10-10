# 0009. Answer with Gemma 4, backed up by Gemini 3.5 Flash

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

On the free tier, `gemini-3.5-flash` allows 20 answer requests per day for the whole app, which the eval alone can use up and which leaves real users unable to ask anything for the rest of the day. The project has no budget for billing. Free-tier quotas are counted per model, and the same API key also serves the open Gemma 4 models, whose free allowance is far larger. On the 30-question eval, `gemma-4-31b-it` matched or beat Gemini 3.5 Flash, but Google's free Gemma endpoint often answered with "Internal error", so about one question in four needed a retry.

## Decision

Answer with `gemma-4-31b-it` (`GEMINI_CHAT_MODEL`). If it fails or its quota is used up before producing any text, retry the same prompt with `gemini-3.5-flash` (`GEMINI_FALLBACK_CHAT_MODEL`). Each saved answer records which model wrote it.

## Alternatives considered

- **Stay on Gemini 3.5 Flash** — the best-known model, but 20 answers a day for everyone.
- **Gemma 4 alone** — enough quota, but its errors would reach users as "try again" on a noticeable share of questions.
- **Groq's free `gpt-oss-120b`** — reliable and about 60 questions a day within its token limits, but a second provider, account and dependency.
- **Grok (xAI)** — no free tier beyond promotional credits.

## Consequences

Eval, 30 questions (2026-10-10, after correcting two expected-page labels):

| Metric | Gemini 3.5 Flash (15-question baseline) | Gemma 4 |
| --- | --- | --- |
| Retrieval hit@5 | 91% | 96% |
| Citation accuracy | 82% | 91% |
| Refusal on not-in-document questions | 100% | 100% |
| False refusals | 18% | 9% |

- Most questions use Gemma's allowance; Gemini's 20 a day only cover Gemma's failures, so users rarely see an error.
- Gemma has no separate system instruction; the AI SDK folds the rules into the first user message, and the eval shows the rules are still followed (refusals stay at 100%).
- The `model` field on saved answers shows how often the backup is used. If it covers more than a handful of questions a day, revisit: Groq is the next option.
