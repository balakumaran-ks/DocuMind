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

/** Atlas Search (keyword) index over chunk text. */
export const TEXT_INDEX_NAME = "chunks_text";

/**
 * Only `text` is searchable, analysed with English stemming so "backups"
 * matches "backup". `userId` and `documentId` are indexed for exact `equals`
 * filters, so keyword search is restricted to one user's document too.
 */
export function textIndexDefinition() {
  return {
    mappings: {
      dynamic: false,
      fields: {
        text: { type: "string", analyzer: "lucene.english" },
        userId: { type: "token" },
        documentId: { type: "objectId" },
      },
    },
  };
}

/** The parts of a search-index listing we read; the driver types the listing as just `{ name }`. */
type SearchIndexInfo = {
  name: string;
  queryable?: boolean;
  latestDefinition?: { fields?: Array<{ type?: string; numDimensions?: unknown }> };
};

const listSearchIndex = async (db: Db, name: string) =>
  (await db.collection("chunks").listSearchIndexes(name).toArray()) as SearchIndexInfo[];

const listVectorIndex = (db: Db) => listSearchIndex(db, VECTOR_INDEX_NAME);

async function ensureChunksCollection(db: Db) {
  const collections = await db.listCollections({ name: "chunks" }, { nameOnly: true }).toArray();
  if (collections.length === 0) await db.createCollection("chunks");
}

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
  await ensureChunksCollection(db);

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

/** Creates the keyword index if it doesn't exist (Atlas only). */
export async function ensureTextIndex(db: Db): Promise<{ status: "created" | "exists" }> {
  await ensureChunksCollection(db);

  const [existing] = await listSearchIndex(db, TEXT_INDEX_NAME);
  if (existing) return { status: "exists" };

  await db.collection("chunks").createSearchIndex({
    name: TEXT_INDEX_NAME,
    type: "search",
    definition: textIndexDefinition(),
  });
  return { status: "created" };
}

/** Resolves once Atlas reports both search indexes as queryable; index builds are asynchronous. */
export async function waitUntilQueryable(db: Db, timeoutMs = 120_000, pollMs = 3_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const indexes = await Promise.all([VECTOR_INDEX_NAME, TEXT_INDEX_NAME].map((name) => listSearchIndex(db, name)));
    if (indexes.every(([index]) => index?.queryable === true)) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}
