import { describe, expect, it } from "vitest";
import { ENV_DEFAULTS, EnvError, missingServerEnv, placeholderServerEnv, readServerEnv } from "./env";

const complete = {
  MONGODB_URI: "mongodb+srv://user:pass@cluster.example.mongodb.net",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-key",
  AUTH_SECRET: "test-secret",
  AUTH_GOOGLE_ID: "test-client-id",
  AUTH_GOOGLE_SECRET: "test-client-secret",
};

describe("readServerEnv", () => {
  it("returns typed config with defaults when only required vars are set", () => {
    const env = readServerEnv(complete);
    expect(env.mongodbUri).toBe(complete.MONGODB_URI);
    expect(env.mongodbDb).toBe(ENV_DEFAULTS.MONGODB_DB);
    expect(env.chatModel).toBe(ENV_DEFAULTS.GEMINI_CHAT_MODEL);
    expect(env.embeddingModel).toBe(ENV_DEFAULTS.GEMINI_EMBEDDING_MODEL);
    expect(env.embeddingDimensions).toBe(768);
  });

  it("lets optional vars override defaults", () => {
    const env = readServerEnv({
      ...complete,
      MONGODB_DB: "documind_test",
      GEMINI_CHAT_MODEL: "some-other-model",
      EMBEDDING_DIMENSIONS: "1536",
    });
    expect(env.mongodbDb).toBe("documind_test");
    expect(env.chatModel).toBe("some-other-model");
    expect(env.embeddingDimensions).toBe(1536);
  });

  it("lists every missing required var in one error", () => {
    const { MONGODB_URI: _uri, AUTH_SECRET: _secret, ...partial } = complete;
    try {
      readServerEnv(partial);
      expect.fail("expected readServerEnv to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as EnvError).missing).toEqual(["MONGODB_URI", "AUTH_SECRET"]);
    }
  });

  it("treats blank strings as missing", () => {
    expect(() => readServerEnv({ ...complete, GOOGLE_GENERATIVE_AI_API_KEY: "   " })).toThrow(
      /GOOGLE_GENERATIVE_AI_API_KEY/,
    );
  });

  it("rejects a value still holding a template placeholder, naming the variable", () => {
    const uri = "mongodb+srv://<db_username>:realpass@cluster0.example.mongodb.net/";
    expect(() => readServerEnv({ ...complete, MONGODB_URI: uri })).toThrow(/MONGODB_URI.*placeholder/);
  });

  it("does not echo the offending value in the error", () => {
    const uri = "mongodb+srv://<db_username>:s3cret-pass@cluster0.example.mongodb.net/";
    expect(() => readServerEnv({ ...complete, MONGODB_URI: uri })).not.toThrow(/s3cret-pass/);
  });

  it.each(["abc", "64", "4096", "768.5"])("rejects EMBEDDING_DIMENSIONS=%s", (value) => {
    expect(() => readServerEnv({ ...complete, EMBEDDING_DIMENSIONS: value })).toThrow(
      /EMBEDDING_DIMENSIONS/,
    );
  });
});

describe("missingServerEnv", () => {
  it("returns an empty list when configured", () => {
    expect(missingServerEnv(complete)).toEqual([]);
  });

  it("returns names only, never values", () => {
    const missing = missingServerEnv({ MONGODB_URI: complete.MONGODB_URI });
    expect(missing).not.toContain("MONGODB_URI");
    expect(missing).toContain("AUTH_SECRET");
    expect(missing.join(" ")).not.toContain(complete.MONGODB_URI);
  });
});

describe("placeholderServerEnv", () => {
  it("returns an empty list for real values", () => {
    expect(placeholderServerEnv(complete)).toEqual([]);
  });

  it.each([
    ["the Atlas username placeholder", "mongodb+srv://<db_username>:pw@c.example.mongodb.net/"],
    ["the .env.example password placeholder", "mongodb+srv://user:<password>@c.example.mongodb.net/"],
  ])("flags %s by variable name", (_name, uri) => {
    expect(placeholderServerEnv({ ...complete, MONGODB_URI: uri })).toEqual(["MONGODB_URI"]);
  });

  it.each([
    ["a URL-encoded angle bracket", "mongodb+srv://user:p%3Cx%3E@c.example.mongodb.net/"],
    ["a lone < inside a password", "mongodb+srv://user:a<b@c.example.mongodb.net/"],
  ])("does not flag %s", (_name, uri) => {
    expect(placeholderServerEnv({ ...complete, MONGODB_URI: uri })).toEqual([]);
  });

  it("checks every required variable, not just the database", () => {
    expect(placeholderServerEnv({ ...complete, AUTH_GOOGLE_ID: "<client-id>" })).toEqual(["AUTH_GOOGLE_ID"]);
  });

  it("ignores missing variables (missingServerEnv reports those)", () => {
    expect(placeholderServerEnv({})).toEqual([]);
  });
});
