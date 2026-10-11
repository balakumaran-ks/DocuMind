import type { Db, Document, ObjectId } from "mongodb";
import { TEXT_INDEX_NAME, VECTOR_INDEX_NAME } from "@/lib/db/search-index";
import { LIMITS } from "@/lib/limits";

/** A chunk returned by hybrid search, with its fused rank score (higher is better). */
export type RetrievedChunk = {
  _id: ObjectId;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  score: number;
};

type SearchInput = { userId: string; documentId: ObjectId; queryVector: number[]; queryText: string };

/**
 * Nearest neighbours of the question vector in one user's document. The filter
 * runs inside the index, before the nearest-neighbour search, so other users'
 * chunks are never candidates.
 */
export function vectorSearchStage({ userId, documentId, queryVector }: SearchInput): Document {
  return {
    $vectorSearch: {
      index: VECTOR_INDEX_NAME,
      path: "embedding",
      queryVector,
      numCandidates: LIMITS.vectorNumCandidates,
      limit: LIMITS.fusionCandidates,
      filter: { userId, documentId },
    },
  };
}

/**
 * Chunks of one user's document that share words with the question, ranked by
 * relevance (BM25). Catches exact names and phrases that vectors can rank low.
 */
export function keywordSearchStage({ userId, documentId, queryText }: SearchInput): Document {
  return {
    $search: {
      index: TEXT_INDEX_NAME,
      compound: {
        filter: [
          { equals: { path: "userId", value: userId } },
          { equals: { path: "documentId", value: documentId } },
        ],
        must: [{ text: { query: queryText, path: "text" } }],
      },
    },
  };
}

/**
 * Hybrid search: the vector and keyword rankings are merged by reciprocal rank
 * fusion (`$rankFusion`), so a chunk ranked well by both comes first. Input
 * pipelines may only select and order, so fields are projected afterwards; the
 * stored vector is not returned.
 */
export function hybridSearchPipeline(search: SearchInput): Document[] {
  return [
    {
      $rankFusion: {
        input: {
          pipelines: {
            vector: [vectorSearchStage(search)],
            keyword: [keywordSearchStage(search), { $limit: LIMITS.fusionCandidates }],
          },
        },
      },
    },
    { $limit: LIMITS.retrievalTopK },
    { $project: { _id: 1, pageNumber: 1, chunkIndex: 1, text: 1, score: { $meta: "score" } } },
  ];
}

/** The chunks of one document that best match the question, best first. */
export async function retrieveChunks(input: SearchInput & { db: Db }): Promise<RetrievedChunk[]> {
  const { db, ...search } = input;
  return db.collection("chunks").aggregate<RetrievedChunk>(hybridSearchPipeline(search)).toArray();
}
