import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { TEXT_INDEX_NAME, VECTOR_INDEX_NAME } from "../db/search-index";
import { LIMITS } from "../limits";
import { hybridSearchPipeline, retrieveChunks } from "./retrieve";

const documentId = new ObjectId();
const queryVector = [0.1, 0.2, 0.3];
const queryText = "Which subcategory covers backups of data?";
const search = { userId: "user-a", documentId, queryVector, queryText };

describe("hybridSearchPipeline", () => {
  const pipeline = hybridSearchPipeline(search);

  it("finds chunks by meaning, filtered to one user's document inside the vector index", () => {
    expect(pipeline[0]).toMatchObject({
      $rankFusion: {
        input: {
          pipelines: {
            vector: [
              {
                $vectorSearch: {
                  index: VECTOR_INDEX_NAME,
                  path: "embedding",
                  queryVector,
                  numCandidates: LIMITS.vectorNumCandidates,
                  limit: LIMITS.fusionCandidates,
                  filter: { userId: "user-a", documentId },
                },
              },
            ],
          },
        },
      },
    });
  });

  it("finds chunks by the question's words, filtered to one user's document inside the keyword index", () => {
    expect(pipeline[0]).toMatchObject({
      $rankFusion: {
        input: {
          pipelines: {
            keyword: [
              {
                $search: {
                  index: TEXT_INDEX_NAME,
                  compound: {
                    filter: [
                      { equals: { path: "userId", value: "user-a" } },
                      { equals: { path: "documentId", value: documentId } },
                    ],
                    must: [{ text: { query: queryText, path: "text" } }],
                  },
                },
              },
              { $limit: LIMITS.fusionCandidates },
            ],
          },
        },
      },
    });
  });

  it("fuses exactly these two rankings, with equal weight", () => {
    const fusion = (pipeline[0] as { $rankFusion: { input: { pipelines: object }; combination?: unknown } }).$rankFusion;
    expect(Object.keys(pipeline[0] ?? {})).toEqual(["$rankFusion"]);
    expect(Object.keys(fusion.input.pipelines)).toEqual(["vector", "keyword"]);
    expect(fusion.combination).toBeUndefined();
  });

  it("keeps the best retrievalTopK fused chunks, with the fields the prompt and citations need and never the vector", () => {
    expect(pipeline.slice(1)).toEqual([
      { $limit: LIMITS.retrievalTopK },
      { $project: { _id: 1, pageNumber: 1, chunkIndex: 1, text: 1, score: { $meta: "score" } } },
    ]);
  });
});

describe("retrieveChunks", () => {
  it("runs the hybrid pipeline on the chunks collection and returns the rows", async () => {
    const rows = [{ _id: new ObjectId(), pageNumber: 2, chunkIndex: 1, text: "t", score: 0.03 }];
    const calls: { collection: string; pipeline: unknown }[] = [];
    const db = {
      collection: (name: string) => ({
        aggregate: (pipeline: unknown) => {
          calls.push({ collection: name, pipeline });
          return { toArray: async () => rows };
        },
      }),
    } as unknown as Db;

    const result = await retrieveChunks({ db, ...search });

    expect(result).toEqual(rows);
    expect(calls).toEqual([{ collection: "chunks", pipeline: hybridSearchPipeline(search) }]);
  });
});
