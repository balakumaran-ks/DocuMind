import { MockEmbeddingModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedder, EmbeddingError, getEmbedder } from "./embed";

const DIMS = 4;

/** A fake model that returns, for the i-th value of each call, a vector filled with i. */
function mockModel(options: { dims?: number; maxEmbeddingsPerCall?: number } = {}) {
  const dims = options.dims ?? DIMS;
  return new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: options.maxEmbeddingsPerCall ?? 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map((_, i) => Array.from({ length: dims }, () => i)),
      warnings: [],
    }),
  });
}

const embedderWith = (model: MockEmbeddingModelV4) =>
  createEmbedder({ model, modelName: "test-embedding-model", dimensions: DIMS });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createEmbedder", () => {
  it("exposes the model name and dimensions it embeds with", () => {
    const embedder = embedderWith(mockModel());
    expect(embedder.model).toBe("test-embedding-model");
    expect(embedder.dimensions).toBe(DIMS);
  });

  it("returns one vector per text, in order", async () => {
    const vectors = await embedderWith(mockModel()).embedDocuments(["a", "b", "c"]);
    expect(vectors).toEqual([
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [2, 2, 2, 2],
    ]);
  });

  it("embeds documents as RETRIEVAL_DOCUMENT at the configured dimensions", async () => {
    const model = mockModel();
    await embedderWith(model).embedDocuments(["Refunds within 30 days."]);
    expect(model.doEmbedCalls[0].providerOptions?.google).toMatchObject({
      taskType: "RETRIEVAL_DOCUMENT",
      outputDimensionality: DIMS,
    });
  });

  it("embeds a question as RETRIEVAL_QUERY and returns a single vector", async () => {
    const model = mockModel();
    const vector = await embedderWith(model).embedQuery("How long is the refund window?");
    expect(vector).toHaveLength(DIMS);
    expect(model.doEmbedCalls[0].providerOptions?.google).toMatchObject({
      taskType: "RETRIEVAL_QUERY",
      outputDimensionality: DIMS,
    });
  });

  it("does not call the model for an empty list", async () => {
    const model = mockModel();
    expect(await embedderWith(model).embedDocuments([])).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
  });

  it("splits large batches into calls the model accepts", async () => {
    const model = mockModel({ maxEmbeddingsPerCall: 100 });
    const vectors = await embedderWith(model).embedDocuments(Array.from({ length: 250 }, (_, i) => `text ${i}`));
    expect(vectors).toHaveLength(250);
    expect(model.doEmbedCalls.map((call) => call.values.length)).toEqual([100, 100, 50]);
  });

  it("rejects vectors of the wrong size, so they never reach the index", async () => {
    const embedder = embedderWith(mockModel({ dims: DIMS + 1 }));
    await expect(embedder.embedDocuments(["a"])).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("wraps provider failures in EmbeddingError", async () => {
    const model = new MockEmbeddingModelV4({
      doEmbed: async () => {
        throw new Error("quota exceeded");
      },
    });
    const error = await embedderWith(model).embedDocuments(["a"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EmbeddingError);
    expect((error as EmbeddingError).cause).toBeInstanceOf(Error);
  });
});

describe("getEmbedder", () => {
  it("uses the embedding model and dimensions from the environment", () => {
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:27017/");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
    vi.stubEnv("AUTH_SECRET", "s");
    vi.stubEnv("AUTH_GOOGLE_ID", "id");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "gs");
    vi.stubEnv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2");
    vi.stubEnv("EMBEDDING_DIMENSIONS", "768");

    const embedder = getEmbedder();
    expect(embedder.model).toBe("gemini-embedding-2");
    expect(embedder.dimensions).toBe(768);
  });
});
