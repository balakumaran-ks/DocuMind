import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  ensureTextIndex,
  TEXT_INDEX_NAME,
  textIndexDefinition,
  VECTOR_INDEX_NAME,
  vectorIndexDefinition,
  waitUntilQueryable,
} from "./search-index";

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

describe("keyword search index", () => {
  it("is named as documented in docs/ARCHITECTURE.md", () => {
    expect(TEXT_INDEX_NAME).toBe("chunks_text");
  });

  it("indexes only chunk text, with English stemming, and owner and document for exact filtering", () => {
    expect(textIndexDefinition()).toEqual({
      mappings: {
        dynamic: false,
        fields: {
          text: { type: "string", analyzer: "lucene.english" },
          userId: { type: "token" },
          documentId: { type: "objectId" },
        },
      },
    });
  });
});

/** A stand-in for the parts of Db the index helpers use, with search indexes by name. */
function fakeDb(indexes: Record<string, { queryable: boolean }>) {
  const created: unknown[] = [];
  const collection = {
    listSearchIndexes: (name: string) => ({
      toArray: async () => (indexes[name] ? [{ name, ...indexes[name] }] : []),
    }),
    createSearchIndex: async (spec: unknown) => {
      created.push(spec);
      return "name";
    },
  };
  const db = {
    listCollections: () => ({ toArray: async () => [{ name: "chunks" }] }),
    createCollection: async () => collection,
    collection: () => collection,
  } as unknown as Db;
  return { db, created };
}

describe("ensureTextIndex", () => {
  it("creates the keyword index when it doesn't exist", async () => {
    const { db, created } = fakeDb({});
    await expect(ensureTextIndex(db)).resolves.toEqual({ status: "created" });
    expect(created).toEqual([{ name: TEXT_INDEX_NAME, type: "search", definition: textIndexDefinition() }]);
  });

  it("leaves an existing keyword index alone", async () => {
    const { db, created } = fakeDb({ [TEXT_INDEX_NAME]: { queryable: true } });
    await expect(ensureTextIndex(db)).resolves.toEqual({ status: "exists" });
    expect(created).toEqual([]);
  });
});

describe("waitUntilQueryable", () => {
  it("resolves true once both search indexes are queryable", async () => {
    const { db } = fakeDb({ [VECTOR_INDEX_NAME]: { queryable: true }, [TEXT_INDEX_NAME]: { queryable: true } });
    await expect(waitUntilQueryable(db, 50, 5)).resolves.toBe(true);
  });

  it("resolves false while the keyword index is still building", async () => {
    const { db } = fakeDb({ [VECTOR_INDEX_NAME]: { queryable: true }, [TEXT_INDEX_NAME]: { queryable: false } });
    await expect(waitUntilQueryable(db, 50, 5)).resolves.toBe(false);
  });
});
