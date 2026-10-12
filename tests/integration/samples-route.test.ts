import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as addSample } from "@/app/api/documents/samples/route";
import { closeDb } from "@/lib/db/client";
import { insertDocumentWithPages } from "@/lib/db/documents";
import { reserveUpload } from "@/lib/db/uploads";
import { ingestDocument } from "@/lib/ingest";
import { LIMITS } from "@/lib/limits";
import { waitUntilSearchable } from "@/lib/rag/searchable";
import { SAMPLES_USER } from "@/lib/samples/catalog";
import { fakeEmbedder } from "./helpers/fake-embedder";
import { startMongo, stubServerEnv } from "./helpers/mongo";

const USER_ID = "google:test-user";

// The signed-in user; set to null to test requests without a session.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/user", () => ({ getUserId: async () => session.userId }));

// Adding a sample must never embed anything; the fake records any call.
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

// mongodb-memory-server has no search indexes, so "searchable" is decided by the test.
vi.mock("@/lib/rag/searchable", () => ({ waitUntilSearchable: vi.fn(async () => true) }));

const DB_NAME = "documind_samples_test";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const PAGES = ["The six CSF Functions are GOVERN, IDENTIFY and more.", "Tiers describe rigor.", "Profiles describe outcomes."];

/** The indexed template for the "nist-csf" sample, the way `npm run samples` stores it. */
async function seedTemplate(embedder = fakeEmbedder().embedder): Promise<ObjectId> {
  const pages = PAGES.map((text, i) => ({ pageNumber: i + 1, text, charCount: text.length, isEmpty: false }));
  const documentId = await insertDocumentWithPages(db, {
    userId: SAMPLES_USER,
    filename: "NIST Cybersecurity Framework 2.0.pdf",
    sizeBytes: 1_000_000,
    sha256: "a".repeat(64),
    pages,
  });
  await ingestDocument({ db, embedder, userId: SAMPLES_USER, documentId, pages });
  await db.collection("documents").updateOne({ _id: documentId }, { $set: { sampleKey: "nist-csf" } });
  return documentId;
}

function post(body: unknown) {
  const request = new Request("http://localhost/api/documents/samples", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return addSample(request);
}

async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const rows = (name: string, filter: Record<string, unknown>) => db.collection(name).find(filter).sort({ pageNumber: 1, chunkIndex: 1 }).toArray();

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  session.userId = USER_ID;
  fake.current = fakeEmbedder();
  await Promise.all(["documents", "pages", "chunks", "uploadCounts"].map((name) => db.collection(name).deleteMany({})));
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("POST /api/documents/samples", () => {
  it("copies the sample's document, pages and chunks, vectors included, into the user's library, ready, embedding nothing", async () => {
    const template = await seedTemplate();

    const { status, body } = await read(await post({ sample: "nist-csf" }));

    expect(status).toBe(201);
    expect(body.document).toMatchObject({
      filename: "NIST Cybersecurity Framework 2.0.pdf",
      pageCount: 3,
      status: "ready",
      chunkCount: 3,
      embeddedChunks: 3,
    });
    const copyId = new ObjectId(String(body.document.id));
    expect(await db.collection("documents").findOne({ _id: copyId })).toMatchObject({ userId: USER_ID, sampleKey: "nist-csf" });

    const [templatePages, copyPages] = [await rows("pages", { documentId: template }), await rows("pages", { documentId: copyId })];
    expect(copyPages.map((p) => [p.userId, p.pageNumber, p.text])).toEqual(templatePages.map((p) => [USER_ID, p.pageNumber, p.text]));

    const [templateChunks, copyChunks] = [await rows("chunks", { documentId: template }), await rows("chunks", { documentId: copyId })];
    expect(copyChunks).toHaveLength(templateChunks.length);
    expect(copyChunks.map((c) => [c.userId, c.text, c.contentHash, c.embedding])).toEqual(
      templateChunks.map((c) => [USER_ID, c.text, c.contentHash, c.embedding]),
    );
    expect(fake.current?.embeddedTexts()).toEqual([]);
  });

  it("answers only once search can see the copy, so a first question finds it", async () => {
    await seedTemplate();
    vi.mocked(waitUntilSearchable).mockClear();

    const { body } = await read(await post({ sample: "nist-csf" }));

    expect(waitUntilSearchable).toHaveBeenCalledTimes(1);
    expect(waitUntilSearchable).toHaveBeenCalledWith(expect.anything(), USER_ID, new ObjectId(String(body.document.id)), 3);
  });

  it("still adds the sample if search takes longer than the wait", async () => {
    await seedTemplate();
    vi.mocked(waitUntilSearchable).mockResolvedValueOnce(false);

    const { status, body } = await read(await post({ sample: "nist-csf" }));

    expect(status).toBe(201);
    expect(body.document.status).toBe("ready");
  });

  it("leaves the template where it was, still owned by the samples user", async () => {
    const template = await seedTemplate();
    await post({ sample: "nist-csf" });

    expect(await db.collection("documents").findOne({ _id: template })).toMatchObject({ userId: SAMPLES_USER, status: "ready" });
    expect(await db.collection("chunks").countDocuments({ documentId: template, userId: SAMPLES_USER })).toBe(3);
  });

  it("409 sample_already_added the second time", async () => {
    await seedTemplate();
    await post({ sample: "nist-csf" });

    const { status, body } = await read(await post({ sample: "nist-csf" }));

    expect(status).toBe(409);
    expect(body.error.code).toBe("sample_already_added");
    expect(await db.collection("documents").countDocuments({ userId: USER_ID })).toBe(1);
  });

  it("409 too_many_documents when the library is full", async () => {
    await seedTemplate();
    for (let i = 0; i < LIMITS.maxDocumentsPerUser; i++) {
      const pages = [{ pageNumber: 1, text: "x", charCount: 1, isEmpty: false }];
      await insertDocumentWithPages(db, { userId: USER_ID, filename: `d${i}.pdf`, sizeBytes: 1, sha256: "b", pages });
    }

    const { status, body } = await read(await post({ sample: "nist-csf" }));

    expect(status).toBe(409);
    expect(body.error.code).toBe("too_many_documents");
  });

  it("counts toward the daily upload cap, and is refused at it", async () => {
    await seedTemplate();
    for (let i = 0; i < LIMITS.maxUploadsPerDay; i++) await reserveUpload(db, USER_ID, new Date(), LIMITS.maxUploadsPerDay);

    const { status, body } = await read(await post({ sample: "nist-csf" }));

    expect(status).toBe(429);
    expect(body.error.code).toBe("daily_upload_limit_reached");
    expect(await db.collection("documents").countDocuments({ userId: USER_ID })).toBe(0);
  });

  it("503 sample_unavailable when the sample hasn't been indexed, or was indexed with another embedding model", async () => {
    expect((await read(await post({ sample: "nist-csf" }))).body.error.code).toBe("sample_unavailable");

    await seedTemplate({ ...fakeEmbedder().embedder, model: "an-older-model" });
    const { status, body } = await read(await post({ sample: "nist-csf" }));

    expect(status).toBe(503);
    expect(body.error.code).toBe("sample_unavailable");
    expect(await db.collection("documents").countDocuments({ userId: USER_ID })).toBe(0);
  });

  it.each([
    ["an unknown sample", { sample: "nope" }],
    ["no sample", {}],
    ["a body that isn't JSON", "nist-csf"],
  ])("400 for %s", async (_label, body) => {
    const { status, body: response } = await read(await post(body));
    expect(status).toBe(400);
    expect(response.error.code).toBe("invalid_request");
  });

  it("401 without a session, copying nothing", async () => {
    await seedTemplate();
    session.userId = null;

    expect((await post({ sample: "nist-csf" })).status).toBe(401);
    expect(await db.collection("documents").countDocuments({ userId: { $ne: SAMPLES_USER } })).toBe(0);
  });
});
