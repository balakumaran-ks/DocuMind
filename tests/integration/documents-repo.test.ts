import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  countDocuments,
  ensureIndexes,
  getDocumentWithPages,
  insertDocumentWithPages,
} from "@/lib/db/documents";
import type { ExtractedPage } from "@/lib/pdf/extract";
import { startMongo } from "./helpers/mongo";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const page = (pageNumber: number, text: string): ExtractedPage => ({
  pageNumber,
  text,
  charCount: text.length,
  isEmpty: text.length === 0,
});

const upload = (userId: string, pages: ExtractedPage[] = [page(1, "First page."), page(2, "")]) => ({
  userId,
  filename: "handbook.pdf",
  sizeBytes: 1234,
  sha256: "a".repeat(64),
  pages,
});

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("documind_repo_test");
  await ensureIndexes(db);
});

beforeEach(async () => {
  await db.collection("documents").deleteMany({});
  await db.collection("pages").deleteMany({});
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("insertDocumentWithPages", () => {
  it("stores the document as processing, with one row per page, all owned by the user", async () => {
    const id = await insertDocumentWithPages(db, upload("user-a"));

    const document = await db.collection("documents").findOne({ _id: id });
    expect(document).toMatchObject({
      userId: "user-a",
      filename: "handbook.pdf",
      sizeBytes: 1234,
      sha256: "a".repeat(64),
      pageCount: 2,
      status: "processing",
    });
    expect(document?.createdAt).toBeInstanceOf(Date);

    const pages = await db.collection("pages").find({ documentId: id }).sort({ pageNumber: 1 }).toArray();
    expect(pages).toHaveLength(2);
    expect(pages.map((p) => [p.pageNumber, p.userId, p.isEmpty])).toEqual([
      [1, "user-a", false],
      [2, "user-a", true],
    ]);
  });

  it("leaves nothing behind when the pages cannot be written", async () => {
    // Two pages with the same number violate the unique { documentId, pageNumber } index.
    const broken = upload("user-a", [page(1, "one"), page(1, "duplicate")]);
    await expect(insertDocumentWithPages(db, broken)).rejects.toThrow();

    expect(await db.collection("documents").countDocuments({ userId: "user-a" })).toBe(0);
    expect(await db.collection("pages").countDocuments({ userId: "user-a" })).toBe(0);
  });
});

describe("getDocumentWithPages", () => {
  it("returns the document with its pages in page order", async () => {
    const id = await insertDocumentWithPages(
      db,
      upload("user-a", [page(3, "Third."), page(1, "First."), page(2, "Second.")]),
    );

    const result = await getDocumentWithPages(db, "user-a", id.toHexString());
    expect(result?.document._id.equals(id)).toBe(true);
    expect(result?.pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(result?.pages[0].text).toBe("First.");
  });

  it("never returns another user's document", async () => {
    const id = await insertDocumentWithPages(db, upload("user-a"));
    expect(await getDocumentWithPages(db, "user-b", id.toHexString())).toBeNull();
  });

  it.each([
    ["a malformed id", "not-an-object-id"],
    ["an id that does not exist", new ObjectId().toHexString()],
  ])("returns null for %s", async (_name, id) => {
    expect(await getDocumentWithPages(db, "user-a", id)).toBeNull();
  });
});

describe("countDocuments", () => {
  it("counts only the given user's documents", async () => {
    await insertDocumentWithPages(db, upload("user-a"));
    await insertDocumentWithPages(db, upload("user-a"));
    await insertDocumentWithPages(db, upload("user-b"));

    expect(await countDocuments(db, "user-a")).toBe(2);
    expect(await countDocuments(db, "user-b")).toBe(1);
    expect(await countDocuments(db, "user-c")).toBe(0);
  });
});

describe("ensureIndexes", () => {
  it("is safe to run more than once", async () => {
    await expect(ensureIndexes(db)).resolves.toBeUndefined();
  });

  it("indexes documents by owner and recency, and pages uniquely by document and page number", async () => {
    const documentIndexes = await db.collection("documents").indexes();
    expect(documentIndexes.map((i) => i.key)).toContainEqual({ userId: 1, createdAt: -1 });

    const pageIndexes = await db.collection("pages").indexes();
    const pageKey = pageIndexes.find((i) => i.key.documentId === 1 && i.key.pageNumber === 1);
    expect(pageKey?.unique).toBe(true);
  });
});
