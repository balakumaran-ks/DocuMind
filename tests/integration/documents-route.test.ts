import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/documents/route";
import { DEV_USER_ID } from "@/lib/auth/user";
import { closeDb } from "@/lib/db/client";
import { LIMITS } from "@/lib/limits";
import { fakeEmbedder } from "./helpers/fake-embedder";
import { startMongo, stubServerEnv } from "./helpers/mongo";

// The route must never call the real embedding API in tests.
const fake = vi.hoisted(() => ({
  current: null as ReturnType<typeof import("./helpers/fake-embedder").fakeEmbedder> | null,
}));
vi.mock("@/lib/ai/embed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/embed")>();
  return {
    ...actual,
    getEmbedder: () => {
      if (!fake.current) throw new Error("fake embedder not set");
      return fake.current.embedder;
    },
  };
});

const DB_NAME = "documind_route_test";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const fixture = (name: string) => readFileSync(join(process.cwd(), "tests", "fixtures", name));

/** POST /api/documents with an optional `file` field, the way a browser form would send it. */
async function upload(file?: { name: string; bytes: Uint8Array; type?: string }) {
  const form = new FormData();
  // Copy into a plain ArrayBuffer-backed array, which is what File accepts.
  if (file) form.append("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type ?? "application/pdf" }));
  const response = await POST(new Request("http://localhost/api/documents", { method: "POST", body: form }));
  return { status: response.status, body: await response.json() };
}

const storedCounts = async () => ({
  documents: await db.collection("documents").countDocuments(),
  pages: await db.collection("pages").countDocuments(),
  chunks: await db.collection("chunks").countDocuments(),
});

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  vi.stubEnv("NODE_ENV", "test");
  fake.current = fakeEmbedder();
  await Promise.all(["documents", "pages", "chunks"].map((name) => db.collection(name).deleteMany({})));
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("POST /api/documents — success", () => {
  it("stores the document, its pages and its embedded chunks, and returns 201", async () => {
    const bytes = fixture("text-3-pages.pdf");
    const { status, body } = await upload({ name: "handbook.pdf", bytes });

    expect(status).toBe(201);
    expect(body).toEqual({
      documentId: expect.any(String),
      pageCount: 3,
      emptyPages: [],
      status: "ready",
      chunkCount: 3,
    });

    const document = await db.collection("documents").findOne({ _id: new ObjectId(String(body.documentId)) });
    expect(document).toMatchObject({
      userId: DEV_USER_ID,
      filename: "handbook.pdf",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      pageCount: 3,
      status: "ready",
      chunkCount: 3,
      embeddingModel: "fake-embedding-model",
    });
    const chunks = await db.collection("chunks").find({ documentId: document?._id }).toArray();
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.userId === DEV_USER_ID && c.embedding.length === 4)).toBe(true);

    const pages = await db.collection("pages").find({ documentId: document?._id }).sort({ pageNumber: 1 }).toArray();
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.userId === DEV_USER_ID)).toBe(true);
    expect(pages[0].text).toContain("Refunds are accepted within 30 days of delivery.");
  });

  it("accepts a PDF with some blank pages and reports which ones", async () => {
    const { status, body } = await upload({ name: "intro.pdf", bytes: fixture("blank-page-2.pdf") });
    expect(status).toBe(201);
    expect(body).toMatchObject({ pageCount: 3, emptyPages: [2] });
  });
});

describe("POST /api/documents — rejections write nothing", () => {
  it("401 when there is no signed-in user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { status, body } = await upload({ name: "a.pdf", bytes: fixture("text-3-pages.pdf") });
    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(await storedCounts()).toEqual({ documents: 0, pages: 0, chunks: 0 });
  });

  it("400 when the form has no file", async () => {
    const { status, body } = await upload();
    expect(status).toBe(400);
    expect(body.error.code).toBe("missing_file");
  });

  it("413 when the file is over the size limit", async () => {
    const bytes = new Uint8Array(LIMITS.maxUploadBytes + 1);
    bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
    const { status, body } = await upload({ name: "big.pdf", bytes });
    expect(status).toBe(413);
    expect(body.error.code).toBe("too_large");
    expect(await storedCounts()).toEqual({ documents: 0, pages: 0, chunks: 0 });
  });

  it("415 when the bytes are not a PDF, whatever the name and type claim", async () => {
    const { status, body } = await upload({ name: "fake.pdf", bytes: fixture("not-a-pdf.pdf") });
    expect(status).toBe(415);
    expect(body.error.code).toBe("not_pdf");
    expect(await storedCounts()).toEqual({ documents: 0, pages: 0, chunks: 0 });
  });

  it("409 when the user already has the maximum number of documents", async () => {
    for (let i = 0; i < LIMITS.maxDocumentsPerUser; i++) {
      expect((await upload({ name: `doc-${i}.pdf`, bytes: fixture("text-3-pages.pdf") })).status).toBe(201);
    }
    const { status, body } = await upload({ name: "one-too-many.pdf", bytes: fixture("text-3-pages.pdf") });
    expect(status).toBe(409);
    expect(body.error.code).toBe("too_many_documents");
    expect((await storedCounts()).documents).toBe(LIMITS.maxDocumentsPerUser);
  });

  it("422 when the PDF has more pages than allowed", async () => {
    const { status, body } = await upload({ name: "long.pdf", bytes: fixture("pages-51.pdf") });
    expect(status).toBe(422);
    expect(body.error.code).toBe("too_many_pages");
    expect(await storedCounts()).toEqual({ documents: 0, pages: 0, chunks: 0 });
  });

  it("422 when the PDF cannot be read", async () => {
    const { status, body } = await upload({ name: "broken.pdf", bytes: fixture("truncated.pdf") });
    expect(status).toBe(422);
    expect(body.error.code).toBe("unreadable_pdf");
    expect(await storedCounts()).toEqual({ documents: 0, pages: 0, chunks: 0 });
  });

  it("422 when no page has any text (likely a scan)", async () => {
    const { status, body } = await upload({ name: "scan.pdf", bytes: fixture("all-blank.pdf") });
    expect(status).toBe(422);
    expect(body.error.code).toBe("no_text");
    expect(body.error.message).toMatch(/scan/i);
    expect(await storedCounts()).toEqual({ documents: 0, pages: 0, chunks: 0 });
  });

  it("502 when embedding fails, keeping the document marked failed so it can be retried", async () => {
    if (!fake.current) throw new Error("fake embedder not set");
    fake.current.state.failWith = new Error("quota exceeded");

    const { status, body } = await upload({ name: "handbook.pdf", bytes: fixture("text-3-pages.pdf") });
    expect(status).toBe(502);
    expect(body.error.code).toBe("embedding_failed");
    expect(body.error.message).toMatch(/try again/i);
    expect(body.error.documentId).toEqual(expect.any(String));

    const document = await db.collection("documents").findOne({ _id: new ObjectId(String(body.error.documentId)) });
    expect(document?.status).toBe("failed");
    expect(await storedCounts()).toMatchObject({ documents: 1, chunks: 0 });
  });

  it("503 with a clear message when the database is unreachable, instead of hanging", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300");
    const started = Date.now();
    const { status, body } = await upload({ name: "a.pdf", bytes: fixture("text-3-pages.pdf") });
    expect(status).toBe(503);
    expect(body.error.code).toBe("database_unavailable");
    expect(body.error.message).toMatch(/try again/i);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("returns a human-readable message with every error", async () => {
    const { body } = await upload({ name: "fake.pdf", bytes: fixture("not-a-pdf.pdf") });
    expect(body.error.message).toEqual(expect.any(String));
    expect(body.error.message.length).toBeGreaterThan(0);
  });
});
