/**
 * What the usage report reads from one stored message: dates, timings, model,
 * token counts, the rating, and whether an answer was a refusal. No question
 * or answer text, and no user.
 */
export type UsageRow = {
  role: "user" | "assistant";
  createdAt: Date;
  latencyMs?: number;
  model?: string;
  usage?: { inputTokens: number | null; outputTokens: number | null };
  rating?: "up" | "down";
  refused?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** The value at quantile `q` of sorted numbers (nearest rank), as the eval reports answer times. */
function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

/** Aggregates over the messages since `since`: questions per UTC day, answers, timing, models, ratings and tokens. */
export function summarizeUsage(rows: UsageRow[], period: { since: Date; now: Date }) {
  const inPeriod = rows.filter((row) => row.createdAt >= period.since && row.createdAt <= period.now);
  const questions = inPeriod.filter((row) => row.role === "user");
  const answers = inPeriod.filter((row) => row.role === "assistant");

  const perDay = new Map<string, number>();
  for (let day = period.since.getTime(); day <= period.now.getTime(); day += DAY_MS) {
    perDay.set(new Date(day).toISOString().slice(0, 10), 0);
  }
  for (const row of questions) {
    const date = row.createdAt.toISOString().slice(0, 10);
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }

  const times = answers
    .map((row) => row.latencyMs)
    .filter((ms): ms is number => typeof ms === "number")
    .sort((a, b) => a - b);
  const models: Record<string, number> = {};
  for (const row of answers) {
    const model = row.model ?? "unknown";
    models[model] = (models[model] ?? 0) + 1;
  }

  return {
    days: [...perDay].map(([date, count]) => ({ date, questions: count })),
    questions: questions.length,
    answers: answers.length,
    refusals: answers.filter((row) => row.refused).length,
    answerTime: times.length > 0 ? { medianMs: quantile(times, 0.5), p90Ms: quantile(times, 0.9) } : null,
    models,
    ratings: {
      up: answers.filter((row) => row.rating === "up").length,
      down: answers.filter((row) => row.rating === "down").length,
    },
    tokens: {
      input: answers.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0),
      output: answers.reduce((sum, row) => sum + (row.usage?.outputTokens ?? 0), 0),
    },
  };
}
