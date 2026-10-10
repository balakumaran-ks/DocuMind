import type { Db, ObjectId } from "mongodb";

/** A retrievable slice of one page, with its embedding once it has been computed. */
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
  /** Missing while the chunk waits for its batch; the vector index skips such chunks. */
  embedding?: number[];
  createdAt: Date;
};

const chunks = (db: Db) => db.collection<StoredChunk>("chunks");
const pending = { embedding: { $exists: false } };

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
 * Stored vectors for the given content hashes, from this user's embedded chunks
 * only. Reuse never crosses users, so every query stays filtered by owner.
 */
export async function findEmbeddingsByHash(db: Db, userId: string, hashes: string[]): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  const unique = [...new Set(hashes)];
  if (unique.length === 0) return found;

  const rows = chunks(db).find(
    { userId, contentHash: { $in: unique }, embedding: { $exists: true } },
    { projection: { _id: 0, contentHash: 1, embedding: 1 } },
  );
  for await (const row of rows) {
    if (row.embedding && !found.has(row.contentHash)) found.set(row.contentHash, row.embedding);
  }
  return found;
}

/** Up to `limit` distinct texts still waiting for a vector, in reading order. */
export async function findPendingTexts(
  db: Db,
  userId: string,
  documentId: ObjectId,
  limit: number,
): Promise<{ contentHash: string; text: string }[]> {
  const texts = new Map<string, string>();
  const rows = chunks(db)
    .find({ userId, documentId, ...pending }, { projection: { _id: 0, contentHash: 1, text: 1 } })
    .sort({ chunkIndex: 1 });
  for await (const row of rows) {
    if (texts.size >= limit) break;
    if (!texts.has(row.contentHash)) texts.set(row.contentHash, row.text);
  }
  return [...texts].map(([contentHash, text]) => ({ contentHash, text }));
}

/** Gives every waiting chunk of the document with one of these hashes its vector. */
export async function setEmbeddings(db: Db, userId: string, documentId: ObjectId, vectors: Map<string, number[]>) {
  if (vectors.size === 0) return;
  await chunks(db).bulkWrite(
    [...vectors].map(([contentHash, embedding]) => ({
      updateMany: { filter: { userId, documentId, contentHash, ...pending }, update: { $set: { embedding } } },
    })),
  );
}

/** How many of the document's chunks exist, and how many have their vector. */
export async function countChunks(db: Db, userId: string, documentId: ObjectId) {
  const [total, embedded] = await Promise.all([
    chunks(db).countDocuments({ userId, documentId }),
    chunks(db).countDocuments({ userId, documentId, embedding: { $exists: true } }),
  ]);
  return { total, embedded };
}
