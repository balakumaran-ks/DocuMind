import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as continueIndexing } from "@/app/api/documents/[id]/ingest/route";
import { POST as upload } from "@/app/api/documents/route";
import { EmbeddingRateLimitError } from "@/lib/ai/embed";
import { closeDb } from "@/lib/db/client";
import { fakeEmbedder } from "./helpers/fake-embedder";
import { startMongo, stubServerEnv } from "./helpers/mongo";

const USER_ID = "google:test-user";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/user", () => ({ getUserId: async () => session.userId }));

const fake = vi.hoisted(() => ({
  current: null as ReturnType<typeof import("./helpers/fake-embedder").fakeEmbedder> | null,
}));
vi.mock("@/lib/ai/embed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embed")>()),
  getEmbedder: () => {
    if (!fake.current) throw new Error("fake embedder not set");
    return fake.current.embedder;
  },
}));

// Two chunks per request, so the 3-chunk fixture needs two requests, as a large PDF would on the free tier.
vi.mock("@/lib/limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/limits")>();
  return { ...actual, LIMITS: { ...actual.LIMITS, embedBatchSize: 2 } };
});

const DB_NAME = "documind_ingest_route_test";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const fixture = readFileSync(join(process.cwd(), "tests", "fixtures", "text-3-pages.pdf"));

async function uploadFixture() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(fixture)], "handbook.pdf", { type: "application/pdf" }));
  const response = await upload(new Request("http://localhost/api/documents", { method: "POST", body: form }));
  return { status: response.status, body: await response.json() };
}

async function ingest(id: string) {
  const response = await continueIndexing(new Request(`http://localhost/api/documents/${id}/ingest`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

const documentRow = (id: string) => db.collection("documents").findOne({ _id: new ObjectId(id) });

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  session.userId = USER_ID;
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

describe("POST /api/documents — large documents", () => {
  it("answers 202 with progress when the document needs more than one batch", async () => {
    const { status, body } = await uploadFixture();

    expect(status).toBe(202);
    expect(body).toEqual({
      documentId: expect.any(String),
      pageCount: 3,
      emptyPages: [],
      status: "processing",
      chunkCount: 3,
      embeddedChunks: 2,
    });
    expect((await documentRow(body.documentId))?.status).toBe("processing");
  });

  it("answers 202 with the wait when the quota is hit during upload, keeping the document", async () => {
    if (fake.current) fake.current.state.failWith = new EmbeddingRateLimitError({ retryAfterSeconds: 30 });
    const { status, body } = await uploadFixture();

    expect(status).toBe(202);
    expect(body).toMatchObject({ status: "processing", chunkCount: 3, embeddedChunks: 0, retryAfterSeconds: 30 });
    expect((await documentRow(body.documentId))?.status).toBe("processing");
  });
});

describe("POST /api/documents/:id/ingest", () => {
  it("embeds the next batch and marks the document ready when it is the last", async () => {
    const { body: uploaded } = await uploadFixture();
    const { status, body } = await ingest(uploaded.documentId);

    expect(status).toBe(200);
    expect(body).toEqual({ status: "ready", chunkCount: 3, embeddedChunks: 3 });
    expect((await documentRow(uploaded.documentId))?.status).toBe("ready");
  });

  it("answers ready for a document that is already indexed, without embedding anything", async () => {
    const { body: uploaded } = await uploadFixture();
    await ingest(uploaded.documentId);
    const calls = fake.current?.state.calls.length;

    const { status, body } = await ingest(uploaded.documentId);
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ready", chunkCount: 3, embeddedChunks: 3 });
    expect(fake.current?.state.calls.length).toBe(calls);
  });

  it("429 with how long to wait when the free quota is used up", async () => {
    const { body: uploaded } = await uploadFixture();
    if (fake.current) fake.current.state.failWith = new EmbeddingRateLimitError({ retryAfterSeconds: 30 });

    const { status, headers, body } = await ingest(uploaded.documentId);
    expect(status).toBe(429);
    expect(headers.get("retry-after")).toBe("30");
    expect(body.error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 30, chunkCount: 3, embeddedChunks: 2 });
    expect(body.error.message).toMatch(/30 seconds/);
    expect((await documentRow(uploaded.documentId))?.status).toBe("processing");
  });

  it("409 while another request is indexing the document", async () => {
    const { body: uploaded } = await uploadFixture();
    await db
      .collection("documents")
      .updateOne({ _id: new ObjectId(uploaded.documentId) }, { $set: { ingestLockedUntil: new Date(Date.now() + 60_000) } });

    const { status, body } = await ingest(uploaded.documentId);
    expect(status).toBe(409);
    expect(body.error.code).toBe("ingest_in_progress");
  });

  it("409 for a document whose indexing failed", async () => {
    const { body: uploaded } = await uploadFixture();
    await db.collection("documents").updateOne({ _id: new ObjectId(uploaded.documentId) }, { $set: { status: "failed" } });

    const { status, body } = await ingest(uploaded.documentId);
    expect(status).toBe(409);
    expect(body.error.code).toBe("document_failed");
  });

  it("502 and marks the document failed when embedding fails for another reason", async () => {
    const { body: uploaded } = await uploadFixture();
    if (fake.current) fake.current.state.failWith = new Error("invalid request");

    const { status, body } = await ingest(uploaded.documentId);
    expect(status).toBe(502);
    expect(body.error.code).toBe("embedding_failed");
    expect((await documentRow(uploaded.documentId))?.status).toBe("failed");
  });

  it("404 for another user's document or a malformed id", async () => {
    const { body: uploaded } = await uploadFixture();
    session.userId = "google:someone-else";

    for (const id of [uploaded.documentId, "not-an-id"]) {
      const { status, body } = await ingest(id);
      expect(status).toBe(404);
      expect(body.error.code).toBe("document_not_found");
    }
    expect((await documentRow(uploaded.documentId))?.embeddedChunks).toBe(2);
  });

  it("401 without a session", async () => {
    session.userId = null;
    const { status } = await ingest(new ObjectId().toHexString());
    expect(status).toBe(401);
  });
});
