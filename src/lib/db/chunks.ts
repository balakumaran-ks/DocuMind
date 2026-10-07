import type { Db, ObjectId } from "mongodb";

/** A retrievable slice of one page, with its embedding. */
export type StoredChunk = {
  _id?: ObjectId;
  userId: string;
  documentId: ObjectId;
  pageNumber: number;
  chunkIndex: number;
  /** Offsets into the page text, for highlighting the cited passage. */
  start: number;
  end: number;
  text: string;
  /** SHA-256 of normalised text + embedding model; reused vectors are found by it. */
  contentHash: string;
  embedding: number[];
  createdAt: Date;
};

const chunks = (db: Db) => db.collection<StoredChunk>("chunks");

/** Indexes for chunk storage and vector reuse. Idempotent. (The vector index is separate: search-index.ts.) */
export async function ensureChunkIndexes(db: Db): Promise<void> {
  await chunks(db).createIndex({ documentId: 1, chunkIndex: 1 }, { unique: true });
  await chunks(db).createIndex({ userId: 1, contentHash: 1 });
}

export async function insertChunks(db: Db, rows: StoredChunk[]): Promise<void> {
  if (rows.length > 0) await chunks(db).insertMany(rows);
}

export async function deleteChunksForDocument(db: Db, userId: string, documentId: ObjectId): Promise<void> {
  await chunks(db).deleteMany({ userId, documentId });
}

/**
 * Stored vectors for the given content hashes, from this user's chunks only.
 * Reuse never crosses users, so every query stays filtered by owner.
 */
export async function findEmbeddingsByHash(db: Db, userId: string, hashes: string[]): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return found;

  const rows = chunks(db).find(
    { userId, contentHash: { $in: unique } },
    { projection: { _id: 0, contentHash: 1, embedding: 1 } },
  );
  for await (const row of rows) {
    if (!found.has(row.contentHash)) found.set(row.contentHash, row.embedding);
  }
  return found;
}
