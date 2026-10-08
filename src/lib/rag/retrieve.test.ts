import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { VECTOR_INDEX_NAME } from "../db/search-index";
import { LIMITS } from "../limits";
import { retrieveChunks, vectorSearchPipeline } from "./retrieve";

const documentId = new ObjectId();
const queryVector = [0.1, 0.2, 0.3];

describe("vectorSearchPipeline", () => {
  const pipeline = vectorSearchPipeline({ userId: "user-a", documentId, queryVector });

  it("searches the chunk vector index, filtered to one user's document", () => {
    expect(pipeline[0]).toEqual({
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: "embedding",
        queryVector,
        numCandidates: LIMITS.vectorNumCandidates,
        limit: LIMITS.retrievalTopK,
        filter: { userId: "user-a", documentId },
      },
    });
  });

  it("returns the fields the prompt and citations need, with the similarity score, and never the vector", () => {
    expect(pipeline[1]).toEqual({
      $project: { _id: 1, pageNumber: 1, chunkIndex: 1, text: 1, score: { $meta: "vectorSearchScore" } },
    });
    expect(pipeline).toHaveLength(2);
  });
});

describe("retrieveChunks", () => {
  it("runs the pipeline on the chunks collection and returns the rows", async () => {
    const rows = [{ _id: new ObjectId(), pageNumber: 2, chunkIndex: 1, text: "t", score: 0.9 }];
    const calls: { collection: string; pipeline: unknown }[] = [];
    const db = {
      collection: (name: string) => ({
        aggregate: (pipeline: unknown) => {
          calls.push({ collection: name, pipeline });
          return { toArray: async () => rows };
        },
      }),
    } as unknown as Db;

    const result = await retrieveChunks({ db, userId: "user-a", documentId, queryVector });

    expect(result).toEqual(rows);
    expect(calls).toEqual([
      { collection: "chunks", pipeline: vectorSearchPipeline({ userId: "user-a", documentId, queryVector }) },
    ]);
  });
});
