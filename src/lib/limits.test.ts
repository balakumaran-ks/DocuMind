import { describe, expect, it } from "vitest";
import { formatBytes, LIMITS, PDF_MAGIC_BYTES } from "./limits";

describe("LIMITS", () => {
  it("matches the MVP scope in docs/PRD.md", () => {
    // 4 MB, under Vercel's 4.5 MB request body limit for functions (ADR-0006).
    expect(LIMITS.maxUploadBytes).toBe(4 * 1024 * 1024);
    expect(LIMITS.maxPagesPerDocument).toBe(50);
    expect(LIMITS.maxDocumentsPerUser).toBe(5);
    expect(LIMITS.maxQuestionsPerDay).toBe(50);
    expect(LIMITS.retrievalTopK).toBe(5);
  });

  it("embeds with at most two parallel calls, to stay inside free-tier rate limits", () => {
    expect(LIMITS.embedMaxParallelCalls).toBe(2);
  });

  it("matches the chunking sizes in ADR-0004", () => {
    expect(LIMITS.chunkSize).toBe(1200);
    expect(LIMITS.chunkOverlap).toBe(200);
  });

  it("uses the %PDF- signature for server-side type checks", () => {
    expect(String.fromCharCode(...PDF_MAGIC_BYTES)).toBe("%PDF-");
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1536, "1.5 KB"],
    [10 * 1024 * 1024, "10.0 MB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
