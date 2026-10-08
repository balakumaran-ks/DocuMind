import type { Db, Document, ObjectId } from "mongodb";
import { VECTOR_INDEX_NAME } from "@/lib/db/search-index";
import { LIMITS } from "@/lib/limits";

/** A chunk returned by vector search, with its similarity to the question. */
export type RetrievedChunk = {
  _id: ObjectId;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
};

type SearchInput = { userId: string; documentId: ObjectId; queryVector: number[] };

/**
 * Atlas Vector Search over one user's document. The filter runs inside the
 * index, before the nearest-neighbour search, so other users' chunks are never
 * candidates. The stored vector is not returned.
 */
export function vectorSearchPipeline({ userId, documentId, queryVector }: SearchInput): Document[] {
  return [
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector,
        numCandidates: LIMITS.vectorNumCandidates,
        limit: LIMITS.retrievalTopK,
        filter: { userId, documentId },
      },
    },
    { $project: { _id: 1, pageNumber: 1, chunkIndex: 1, text: 1, score: { $meta: "vectorSearchScore" } } },
  ];
}

/** The chunks of one document closest to the question vector, best first. */
export async function retrieveChunks(input: SearchInput & { db: Db }): Promise<RetrievedChunk[]> {
  const { db, ...search } = input;
  return db.collection("chunks").aggregate<RetrievedChunk>(vectorSearchPipeline(search)).toArray();
}
