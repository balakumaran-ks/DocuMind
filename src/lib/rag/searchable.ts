import type { Db, Document, ObjectId } from "mongodb";
import { TEXT_INDEX_NAME } from "@/lib/db/search-index";
import { LIMITS } from "@/lib/limits";
import { vectorSearchStage } from "@/lib/rag/retrieve";

/**
 * Whether both search indexes see a document's chunks. Atlas indexes new rows
 * asynchronously, usually within seconds: the vector search must return as
 * many chunks as it can, and the keyword index must hold all of them.
 */
export async function isSearchable(db: Db, userId: string, documentId: ObjectId, chunkCount: number): Promise<boolean> {
  const probe = await db.collection("chunks").findOne({ userId, documentId, embedding: { $exists: true } });
  if (!probe) return chunkCount === 0;
  const search = { userId, documentIds: [documentId], queryVector: probe.embedding as number[], queryText: String(probe.text) };
  const keywordCount: Document[] = [
    {
      $searchMeta: {
        index: TEXT_INDEX_NAME,
        compound: {
          filter: [
            { equals: { path: "userId", value: userId } },
            { equals: { path: "documentId", value: documentId } },
          ],
        },
        count: { type: "total" },
      },
    },
  ];
  const [vector, [meta]] = await Promise.all([
    db.collection("chunks").aggregate([vectorSearchStage(search)]).toArray(),
    db.collection("chunks").aggregate<{ count?: { total?: number } }>(keywordCount).toArray(),
  ]);
  return vector.length >= Math.min(LIMITS.fusionCandidates, chunkCount) && meta?.count?.total === chunkCount;
}

/** Checks `isSearchable` about once a second until it is, or until the wait runs out; returns whether it became searchable. */
export async function waitUntilSearchable(
  db: Db,
  userId: string,
  documentId: ObjectId,
  chunkCount: number,
  waitSeconds: number = LIMITS.searchableWaitSeconds,
): Promise<boolean> {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    if (await isSearchable(db, userId, documentId, chunkCount)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
