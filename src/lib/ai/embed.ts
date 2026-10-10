import { createGoogle, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { embedMany, type EmbeddingModel } from "ai";
import { describeWait, quotaRetrySeconds } from "@/lib/ai/quota";
import { readServerEnv } from "@/lib/env";
import { LIMITS } from "@/lib/limits";

/** Turns text into vectors. Swappable, so tests never call a real provider. */
export interface Embedder {
  /** Model name; stored with every document and part of every chunk's content hash. */
  readonly model: string;
  readonly dimensions: number;
  /** Vectors for document chunks, one per text, in order. */
  embedDocuments(texts: string[]): Promise<number[][]>;
  /** The vector for a user's question. */
  embedQuery(text: string): Promise<number[]>;
}

/** Embedding failed (provider error, quota, or an unexpected response). */
export class EmbeddingError extends Error {
  constructor(options?: { cause?: unknown; message?: string }) {
    super(options?.message ?? "Embedding failed. Please try again in a minute.", { cause: options?.cause });
    this.name = "EmbeddingError";
  }
}

/** The provider's quota is used up for now; try again after `retryAfterSeconds`. */
export class EmbeddingRateLimitError extends EmbeddingError {
  readonly retryAfterSeconds: number;

  constructor(options: { retryAfterSeconds: number; cause?: unknown }) {
    super({ cause: options.cause, message: `The free embedding quota is used up. Try again in ${describeWait(options.retryAfterSeconds)}.` });
    this.name = "EmbeddingRateLimitError";
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export function createEmbedder(options: {
  model: EmbeddingModel;
  modelName: string;
  dimensions: number;
  maxParallelCalls?: number;
  /** Retries for transient failures; the SDK's default when omitted. */
  maxRetries?: number;
}): Embedder {
  const { model, modelName, dimensions, maxParallelCalls = LIMITS.embedMaxParallelCalls, maxRetries } = options;

  async function embed(values: string[], taskType: TaskType): Promise<number[][]> {
    if (values.length === 0) return [];

    let embeddings: number[][];
    try {
      // embedMany splits the values into batches the model accepts and keeps their order.
      ({ embeddings } = await embedMany({
        model,
        values,
        maxParallelCalls,
        ...(maxRetries === undefined ? {} : { maxRetries }),
        providerOptions: {
          google: { taskType, outputDimensionality: dimensions } satisfies GoogleEmbeddingModelOptions,
        },
      }));
    } catch (cause) {
      const retryAfterSeconds = quotaRetrySeconds(cause);
      throw retryAfterSeconds === null ? new EmbeddingError({ cause }) : new EmbeddingRateLimitError({ retryAfterSeconds, cause });
    }

    // A vector of the wrong size would be silently unsearchable in the index.
    if (embeddings.length !== values.length || embeddings.some((vector) => vector.length !== dimensions)) {
      throw new EmbeddingError({
        message: `Expected ${values.length} vectors of ${dimensions} dimensions from ${modelName}.`,
      });
    }
    return embeddings;
  }

  return {
    model: modelName,
    dimensions,
    embedDocuments: (texts) => embed(texts, "RETRIEVAL_DOCUMENT"),
    embedQuery: async (text) => (await embed([text], "RETRIEVAL_QUERY"))[0],
  };
}

/** The app's embedder: Gemini, with the model and dimensions from the environment. */
export function getEmbedder(): Embedder {
  const env = readServerEnv();
  const google = createGoogle({ apiKey: env.googleApiKey });
  return createEmbedder({
    model: google.embedding(env.embeddingModel),
    modelName: env.embeddingModel,
    dimensions: env.embeddingDimensions,
  });
}
