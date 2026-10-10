import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../limits";
import { describeWait, isDailyQuota, quotaRetrySeconds } from "./quota";

const quotaError = (message: string) =>
  new APICallError({ message, url: "https://generativelanguage.googleapis.com", requestBodyValues: {}, statusCode: 429, isRetryable: false });

describe("quotaRetrySeconds", () => {
  it.each([
    ["Please retry in 32.918780451s.", 33],
    ["Please retry in 3.3s.", 4],
    ["Please retry in 2m59.56s.", 180],
    ["Please retry in 22h19m12.169709167s.", 80_353],
    ["Please retry in 1h.", 3_600],
    ["Please retry in 5m.", 300],
  ])("reads the wait from %s", (message, seconds) => {
    expect(quotaRetrySeconds(quotaError(`You exceeded your current quota. ${message}`))).toBe(seconds);
  });

  it("waits a minute when Gemini doesn't say how long", () => {
    expect(quotaRetrySeconds(quotaError("You exceeded your current quota."))).toBe(60);
  });

  it("reads the last error inside the SDK's RetryError", () => {
    const wrapped = new RetryError({
      message: "Failed after 3 attempts.",
      reason: "maxRetriesExceeded",
      errors: [quotaError("Please retry in 3s."), quotaError("Please retry in 22h19m12s.")],
    });
    expect(quotaRetrySeconds(wrapped)).toBe(80_352);
  });

  it("returns null for anything that isn't a 429", () => {
    expect(quotaRetrySeconds(new APICallError({ message: "boom", url: "x", requestBodyValues: {}, statusCode: 500 }))).toBeNull();
    expect(quotaRetrySeconds(new Error("Please retry in 30s."))).toBeNull();
    expect(quotaRetrySeconds("quota")).toBeNull();
  });
});

describe("isDailyQuota", () => {
  it(`treats waits over ${LIMITS.quotaWaitMaxSeconds} seconds as a daily quota, not a per-minute one`, () => {
    expect(LIMITS.quotaWaitMaxSeconds).toBe(300);
    expect(isDailyQuota(60)).toBe(false);
    expect(isDailyQuota(300)).toBe(false);
    expect(isDailyQuota(301)).toBe(true);
    expect(isDailyQuota(80_353)).toBe(true);
  });
});

describe("describeWait", () => {
  it.each([
    [1, "1 second"],
    [30, "30 seconds"],
    [60, "1 minute"],
    [90, "2 minutes"],
    [3_600, "about 1 hour"],
    [80_353, "about 22 hours"],
  ])("describes %i seconds as %s", (seconds, text) => {
    expect(describeWait(seconds)).toBe(text);
  });
});
