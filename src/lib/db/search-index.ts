import type { Db } from "mongodb";

// No "@/" imports here: scripts/create-indexes.ts runs this file directly with Node.

/** Atlas Vector Search index over chunk embeddings. */
export const VECTOR_INDEX_NAME = "chunks_vector";

/**
 * Cosine similarity over `embedding`, with `userId` and `documentId` declared
 * as filter fields so every search can be restricted to one user's document
 * *before* the nearest-neighbour search runs.
 */
export function vectorIndexDefinition(dimensions: number) {
  return {
    fields: [
      { type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine" },
      { type: "filter", path: "userId" },
      { type: "filter", path: "documentId" },
    ],
  };
}

/** The parts of a search-index listing we read; the driver types the listing as just `{ name }`. */
type SearchIndexInfo = {
  name: string;
  queryable?: boolean;
  latestDefinition?: { fields?: Array<{ type?: string; numDimensions?: unknown }> };
};

const listVectorIndex = async (db: Db) =>
  (await db.collection("chunks").listSearchIndexes(VECTOR_INDEX_NAME).toArray()) as SearchIndexInfo[];

export type EnsureVectorIndexResult =
  | { status: "created" }
  | { status: "exists" }
  | { status: "mismatch"; existingDimensions: unknown };

/**
 * Creates the vector index if it doesn't exist (Atlas only). An existing index
 * with a different dimension count is reported, not replaced: changing it
 * means re-embedding every chunk.
 */
export async function ensureVectorIndex(db: Db, dimensions: number): Promise<EnsureVectorIndexResult> {
  const collections = await db.listCollections({ name: "chunks" }, { nameOnly: true }).toArray();
  if (collections.length === 0) await db.createCollection("chunks");

  const [existing] = await listVectorIndex(db);
  if (existing) {
    const fields = existing.latestDefinition?.fields ?? [];
    const existingDimensions = fields.find((field) => field.type === "vector")?.numDimensions;
    return existingDimensions === dimensions ? { status: "exists" } : { status: "mismatch", existingDimensions };
  }

  await db.collection("chunks").createSearchIndex({
    name: VECTOR_INDEX_NAME,
    type: "vectorSearch",
    definition: vectorIndexDefinition(dimensions),
  });
  return { status: "created" };
}

/** Resolves once Atlas reports the index as queryable; index builds are asynchronous. */
export async function waitUntilQueryable(db: Db, timeoutMs = 120_000, pollMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [index] = await listVectorIndex(db);
    if (index?.queryable === true) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}
