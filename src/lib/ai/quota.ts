import { LIMITS } from "@/lib/limits";

// Shared by the server and the browser, so it checks error shapes instead of importing the AI SDK.

/** Gemini says how long to wait ("Please retry in 22h19m12.17s"); a minute if it doesn't. */
const DEFAULT_RETRY_SECONDS = 60;
const UNIT_SECONDS: Record<string, number> = { h: 3600, m: 60, s: 1 };

/** Seconds to wait if `error` is a provider 429 (possibly wrapped in the SDK's RetryError), otherwise null. */
export function quotaRetrySeconds(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  if ("lastError" in error) return quotaRetrySeconds(error.lastError);
  if (!("statusCode" in error) || error.statusCode !== 429) return null;

  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const wait = /retry in ((?:\d+(?:\.\d+)?[hms])+)/i.exec(message)?.[1];
  if (!wait) return DEFAULT_RETRY_SECONDS;
  let seconds = 0;
  for (const [, amount, unit] of wait.matchAll(/(\d+(?:\.\d+)?)([hms])/gi)) {
    seconds += Number(amount) * (UNIT_SECONDS[(unit ?? "s").toLowerCase()] ?? 1);
  }
  return Math.ceil(seconds);
}

/** A wait this long means a daily quota: say so instead of counting down. */
export function isDailyQuota(seconds: number): boolean {
  return seconds > LIMITS.quotaWaitMaxSeconds;
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** "30 seconds", "2 minutes", "about 22 hours". */
export function describeWait(seconds: number): string {
  if (seconds < 60) return plural(seconds, "second");
  if (seconds < 3600) return plural(Math.ceil(seconds / 60), "minute");
  return `about ${plural(Math.round(seconds / 3600), "hour")}`;
}

/** The user-facing message for a used-up quota, per-minute or daily. */
export function quotaMessage(kind: "indexing" | "questions", seconds: number): string {
  const wait = describeWait(seconds);
  if (kind === "indexing") {
    return isDailyQuota(seconds)
      ? `The free daily indexing quota is used up. Indexing can resume in ${wait}.`
      : `The free indexing quota is used up for this minute. Indexing continues in ${wait}.`;
  }
  return isDailyQuota(seconds)
    ? `The free daily question quota is used up. Try again in ${wait}.`
    : `Too many questions this minute for the free quota. Try again in ${wait}.`;
}
