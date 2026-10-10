# 0009. Answer with Gemma 4 (26B A4B), backed up by Gemini 3.5 Flash

- **Status:** Accepted
- **Date:** 2026-10-10

## Context

On the free tier, `gemini-3.5-flash` allows 20 answer requests per day for the whole app, which the eval alone can use up and which leaves real users unable to ask anything for the rest of the day. The project has no budget for billing. Free-tier quotas are counted per model, and the same API key also serves the open Gemma 4 models, whose free allowance is far larger.

## Decision

Answer with `gemma-4-26b-a4b-it` (`GEMINI_CHAT_MODEL`). If it fails or its quota is used up before producing any text, retry the same prompt with `gemini-3.5-flash` (`GEMINI_FALLBACK_CHAT_MODEL`). Each saved answer records which model wrote it.

## Alternatives considered

- **Stay on Gemini 3.5 Flash** — 20 answers a day for everyone.
- **`gemma-4-31b-it`** — slightly better citations, but it reasons before answering (31 seconds to the first word in a direct test, and its thinking can't be turned off), and Google's free endpoint failed often (8 retried calls in 30 questions).
- **Groq's free `gpt-oss-120b`** — fast and about 60 questions a day within its token limits, but a second provider, account and dependency.
- **Grok (xAI)** — no free tier beyond promotional credits.

## Consequences

Eval, 30 questions (2026-10-10):

| Metric | Gemini 3.5 Flash (15-question baseline) | `gemma-4-31b-it` | `gemma-4-26b-a4b-it` |
| --- | --- | --- | --- |
| Retrieval hit@5 | 91% | 96% | 96% |
| Citation accuracy | 82% | 91% | 87% |
| Refusal on not-in-document questions | 100% | 100% | 100% |
| False refusals | 18% | 9% | 4% |
| Provider errors | — | 8 retried calls, 1 unanswered | none |
| First word (direct test) | — | 31 s | 6 s |

- Most questions use Gemma's allowance; Gemini's 20 a day only cover Gemma's failures, so users rarely see an error.
- Gemma has no separate system instruction; the AI SDK folds the rules into the first user message, and the eval shows the rules are still followed (refusals stay at 100%).
- Some answers still take tens of seconds in total (median 10 s, 90th percentile 40 s in the eval), but they stream, so the first words appear sooner.
- The `model` field on saved answers shows how often the backup is used. If it covers more than a handful of questions a day, or answers stay slow, revisit: Groq is the next option.
