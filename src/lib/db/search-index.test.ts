import { describe, expect, it } from "vitest";
import { VECTOR_INDEX_NAME, vectorIndexDefinition } from "./search-index";

describe("vector search index", () => {
  it("is named as documented in docs/ARCHITECTURE.md", () => {
    expect(VECTOR_INDEX_NAME).toBe("chunks_vector");
  });

  it("indexes chunk embeddings by cosine similarity and allows filtering by owner and document", () => {
    expect(vectorIndexDefinition(768)).toEqual({
      fields: [
        { type: "vector", path: "embedding", numDimensions: 768, similarity: "cosine" },
        { type: "filter", path: "userId" },
        { type: "filter", path: "documentId" },
      ],
    });
  });

  it("uses the configured number of dimensions", () => {
    expect(vectorIndexDefinition(1536).fields[0]).toMatchObject({ numDimensions: 1536 });
  });
});
