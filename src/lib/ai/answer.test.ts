import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAnswerModels } from "./answer";

beforeEach(() => {
  vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:27017/");
  vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  vi.stubEnv("AUTH_SECRET", "s");
  vi.stubEnv("AUTH_GOOGLE_ID", "id");
  vi.stubEnv("AUTH_GOOGLE_SECRET", "gs");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAnswerModels", () => {
  it("returns the main model, then the backup, in the order they are tried", () => {
    vi.stubEnv("GEMINI_CHAT_MODEL", "gemma-4-31b-it");
    vi.stubEnv("GEMINI_FALLBACK_CHAT_MODEL", "gemini-3.5-flash");

    const models = getAnswerModels();
    expect(models.map((m) => m.name)).toEqual(["gemma-4-31b-it", "gemini-3.5-flash"]);
    expect(models.map((m) => (typeof m.model === "string" ? m.model : m.model.modelId))).toEqual([
      "gemma-4-31b-it",
      "gemini-3.5-flash",
    ]);
  });

  it("returns only the main model when no backup is set", () => {
    vi.stubEnv("GEMINI_CHAT_MODEL", "gemma-4-31b-it");
    expect(getAnswerModels().map((m) => m.name)).toEqual(["gemma-4-31b-it"]);
  });
});
