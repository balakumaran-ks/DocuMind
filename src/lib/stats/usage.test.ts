import { describe, expect, it } from "vitest";
import { summarizeUsage, type UsageRow } from "./usage";

const at = (iso: string) => new Date(iso);
const question = (iso: string): UsageRow => ({ role: "user", createdAt: at(iso) });
const answer = (iso: string, overrides: Partial<UsageRow> = {}): UsageRow => ({
  role: "assistant",
  createdAt: at(iso),
  latencyMs: 4000,
  model: "gemma-4-26b-a4b-it",
  usage: { inputTokens: 2000, outputTokens: 100 },
  refused: false,
  ...overrides,
});

const period = { since: at("2026-10-10T00:00:00Z"), now: at("2026-10-12T15:00:00Z") };

describe("summarizeUsage", () => {
  it("counts questions per UTC day across the period, including days with none", () => {
    const summary = summarizeUsage(
      [question("2026-10-10T08:00:00Z"), question("2026-10-10T23:59:59Z"), question("2026-10-12T01:00:00Z")],
      period,
    );
    expect(summary.days).toEqual([
      { date: "2026-10-10", questions: 2 },
      { date: "2026-10-11", questions: 0 },
      { date: "2026-10-12", questions: 1 },
    ]);
    expect(summary.questions).toBe(3);
  });

  it("totals answers, refusals, answers per model, ratings and tokens", () => {
    const summary = summarizeUsage(
      [
        answer("2026-10-10T08:00:00Z", { rating: "up" }),
        answer("2026-10-11T08:00:00Z", { refused: true, rating: "down" }),
        answer("2026-10-11T09:00:00Z", { model: "gemini-3.5-flash", usage: { inputTokens: null, outputTokens: 50 } }),
      ],
      period,
    );
    expect(summary).toMatchObject({
      answers: 3,
      refusals: 1,
      models: { "gemma-4-26b-a4b-it": 2, "gemini-3.5-flash": 1 },
      ratings: { up: 1, down: 1 },
      tokens: { input: 4000, output: 250 },
    });
  });

  it("reports the median and 90th-percentile answer time", () => {
    const times = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 30000];
    const summary = summarizeUsage(
      times.map((latencyMs, i) => answer(`2026-10-11T0${i}:00:00Z`, { latencyMs })),
      period,
    );
    expect(summary.answerTime).toEqual({ medianMs: 6000, p90Ms: 30000 });
  });

  it("has no answer time without answers, and counts an answer from before the model was recorded as unknown", () => {
    expect(summarizeUsage([], period)).toMatchObject({ answers: 0, answerTime: null, models: {} });
    expect(summarizeUsage([answer("2026-10-11T08:00:00Z", { model: undefined })], period).models).toEqual({ unknown: 1 });
  });

  it("ignores messages from before the period", () => {
    const summary = summarizeUsage([question("2026-10-09T23:59:59Z"), answer("2026-10-09T23:59:59Z")], period);
    expect(summary).toMatchObject({ questions: 0, answers: 0 });
  });
});
