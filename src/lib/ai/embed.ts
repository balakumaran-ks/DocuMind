import { createGoogle, type GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { embedMany, type EmbeddingModel } from "ai";
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

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export function createEmbedder(options: {
  model: EmbeddingModel;
  modelName: string;
  dimensions: number;
  maxParallelCalls?: number;
}): Embedder {
  const { model, modelName, dimensions, maxParallelCalls = LIMITS.embedMaxParallelCalls } = options;

  async function embed(values: string[], taskType: TaskType): Promise<number[][]> {
    if (values.length === 0) return [];

    let embeddings: number[][];
    try {
      // embedMany splits the values into batches the model accepts and keeps their order.
      ({ embeddings } = await embedMany({
        model,
        values,
        maxParallelCalls,
        providerOptions: {
          google: { taskType, outputDimensionality: dimensions } satisfies GoogleEmbeddingModelOptions,
        },
      }));
    } catch (cause) {
      throw new EmbeddingError({ cause });
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
