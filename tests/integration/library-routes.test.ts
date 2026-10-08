import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getMessages } from "@/app/api/chats/[id]/messages/route";
import { GET as listChats } from "@/app/api/chats/route";
import { DELETE as deleteDocument } from "@/app/api/documents/[id]/route";
import { GET as getPage } from "@/app/api/documents/[id]/pages/[n]/route";
import { GET as listDocuments } from "@/app/api/documents/route";
import { createChat, saveMessage } from "@/lib/db/chats";
import { closeDb } from "@/lib/db/client";
import { insertDocumentWithPages, markDocumentFailed } from "@/lib/db/documents";
import { ingestDocument } from "@/lib/ingest";
import { fakeEmbedder } from "./helpers/fake-embedder";
import { startMongo, stubServerEnv } from "./helpers/mongo";

const USER_ID = "google:test-user";
const OTHER_USER = "google:someone-else";

// The signed-in user; set to null to test requests without a session.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/user", () => ({ getUserId: async () => session.userId }));

const DB_NAME = "documind_library_test";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const PAGES = ["Applications open in March.", "", "Late fees are 5 percent."];

/** A ready document with its pages and chunks, stored the way an upload stores it. */
async function seedDocument(userId = USER_ID, filename = "fees.pdf"): Promise<ObjectId> {
  const pages = PAGES.map((text, i) => ({ pageNumber: i + 1, text, charCount: text.length, isEmpty: text === "" }));
  const documentId = await insertDocumentWithPages(db, { userId, filename, sizeBytes: 2048, sha256: "x", pages });
  await ingestDocument({ db, embedder: fakeEmbedder().embedder, userId, documentId, pages });
  return documentId;
}

/** A chat with one question and one cited answer. */
async function seedChat(documentId: ObjectId, userId = USER_ID, title = "When do applications open?") {
  const chat = await createChat(db, { userId, documentId, title });
  const chunk = await db.collection("chunks").findOne({ documentId, pageNumber: 1 });
  await saveMessage(db, { chatId: chat._id, userId, role: "user", content: title });
  await saveMessage(db, {
    chatId: chat._id,
    userId,
    role: "assistant",
    content: "In March [p. 1].",
    citations: chunk ? [{ pageNumber: 1, chunkId: chunk._id }] : [],
    retrievedChunkIds: chunk ? [chunk._id] : [],
    latencyMs: 1200,
    usage: { inputTokens: 100, outputTokens: 10 },
  });
  return chat._id;
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const get = (url: string) => new Request(`http://localhost${url}`);

async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const count = (name: string, filter: Record<string, unknown> = {}) => db.collection(name).countDocuments(filter);

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  session.userId = USER_ID;
  await Promise.all(
    ["documents", "pages", "chunks", "chats", "messages"].map((name) => db.collection(name).deleteMany({})),
  );
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("GET /api/documents", () => {
  it("lists the user's documents, newest first, with their status", async () => {
    const older = await seedDocument(USER_ID, "older.pdf");
    const failed = await seedDocument(USER_ID, "broken.pdf");
    await markDocumentFailed(db, USER_ID, failed, "quota exceeded");
    await seedDocument(OTHER_USER, "theirs.pdf");

    const { status, body } = await read(await listDocuments(get("/api/documents")));

    expect(status).toBe(200);
    expect(body.documents).toEqual([
      {
        id: failed.toHexString(),
        filename: "broken.pdf",
        pageCount: 3,
        sizeBytes: 2048,
        status: "failed",
        chunkCount: 2,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
      expect.objectContaining({ id: older.toHexString(), filename: "older.pdf", status: "ready", chunkCount: 2 }),
    ]);
  });

  it("never exposes internal fields", async () => {
    await seedDocument();
    const { body } = await read(await listDocuments(get("/api/documents")));
    expect(Object.keys(body.documents[0]).sort()).toEqual(
      ["chunkCount", "createdAt", "filename", "id", "pageCount", "sizeBytes", "status"].sort(),
    );
  });

  it("returns an empty list for a new user", async () => {
    const { status, body } = await read(await listDocuments(get("/api/documents")));
    expect(status).toBe(200);
    expect(body).toEqual({ documents: [] });
  });

  it("401 without a session", async () => {
    session.userId = null;
    const { status, body } = await read(await listDocuments(get("/api/documents")));
    expect(status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
  });
});

describe("DELETE /api/documents/:id", () => {
  it("deletes the document with its pages, chunks, chats and messages, and nothing else", async () => {
    const doomed = await seedDocument();
    await seedChat(doomed);
    const kept = await seedDocument(USER_ID, "kept.pdf");
    await seedChat(kept);
    const theirs = await seedDocument(OTHER_USER);
    await seedChat(theirs, OTHER_USER);

    const response = await deleteDocument(get(`/api/documents/${doomed}`), params({ id: doomed.toHexString() }));

    expect(response.status).toBe(204);
    for (const name of ["pages", "chunks", "chats"]) {
      expect(await count(name, { documentId: doomed })).toBe(0);
    }
    expect(await count("documents", { _id: doomed })).toBe(0);
    expect(await count("messages", { userId: USER_ID })).toBe(2);
    expect(await count("documents")).toBe(2);
    expect(await count("chats")).toBe(2);
    expect(await count("messages")).toBe(4);
    expect(await count("chunks", { documentId: kept })).toBe(2);
  });

  it("404 for another user's document, which is left untouched", async () => {
    const theirs = await seedDocument(OTHER_USER);
    await seedChat(theirs, OTHER_USER);

    const { status, body } = await read(
      await deleteDocument(get(`/api/documents/${theirs}`), params({ id: theirs.toHexString() })),
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("document_not_found");
    expect(await count("documents")).toBe(1);
    expect(await count("chunks")).toBe(2);
    expect(await count("messages")).toBe(2);
  });

  it.each(["not-an-id", new ObjectId().toHexString()])("404 for a missing or malformed id (%s)", async (id) => {
    const { status, body } = await read(await deleteDocument(get(`/api/documents/${id}`), params({ id })));
    expect(status).toBe(404);
    expect(body.error.code).toBe("document_not_found");
  });

  it("401 without a session, deleting nothing", async () => {
    const documentId = await seedDocument();
    session.userId = null;
    const response = await deleteDocument(get(`/api/documents/${documentId}`), params({ id: documentId.toHexString() }));
    expect(response.status).toBe(401);
    expect(await count("documents")).toBe(1);
  });
});

describe("GET /api/documents/:id/pages/:n", () => {
  it("returns one page's text for the citation panel", async () => {
    const documentId = await seedDocument();
    const id = documentId.toHexString();
    const { status, body } = await read(await getPage(get(`/api/documents/${id}/pages/3`), params({ id, n: "3" })));
    expect(status).toBe(200);
    expect(body).toEqual({ pageNumber: 3, pageCount: 3, text: "Late fees are 5 percent.", isEmpty: false });
  });

  it("reports an empty page as empty", async () => {
    const id = (await seedDocument()).toHexString();
    const { body } = await read(await getPage(get(`/api/documents/${id}/pages/2`), params({ id, n: "2" })));
    expect(body).toMatchObject({ pageNumber: 2, text: "", isEmpty: true });
  });

  it.each(["0", "4", "-1", "1.5", "abc", "01x"])("404 for page %s", async (n) => {
    const id = (await seedDocument()).toHexString();
    const { status, body } = await read(await getPage(get(`/api/documents/${id}/pages/${n}`), params({ id, n })));
    expect(status).toBe(404);
    expect(body.error.code).toBe("page_not_found");
  });

  it("404 for another user's document", async () => {
    const id = (await seedDocument(OTHER_USER)).toHexString();
    const { status, body } = await read(await getPage(get(`/api/documents/${id}/pages/1`), params({ id, n: "1" })));
    expect(status).toBe(404);
    expect(body.error.code).toBe("document_not_found");
  });

  it("401 without a session", async () => {
    const id = (await seedDocument()).toHexString();
    session.userId = null;
    const response = await getPage(get(`/api/documents/${id}/pages/1`), params({ id, n: "1" }));
    expect(response.status).toBe(401);
  });
});

describe("GET /api/chats?documentId=", () => {
  it("lists the document's chats, most recently active first", async () => {
    const documentId = await seedDocument();
    const first = await seedChat(documentId, USER_ID, "First question");
    const second = await seedChat(documentId, USER_ID, "Second question");
    await db.collection("chats").updateOne({ _id: first }, { $set: { updatedAt: new Date(Date.now() + 60_000) } });
    await seedChat(await seedDocument(), USER_ID, "Another document");

    const { status, body } = await read(await listChats(get(`/api/chats?documentId=${documentId}`)));

    expect(status).toBe(200);
    expect(body.chats).toEqual([
      { id: first.toHexString(), title: "First question", createdAt: expect.any(String), updatedAt: expect.any(String) },
      expect.objectContaining({ id: second.toHexString(), title: "Second question" }),
    ]);
  });

  it("returns an empty list for a document without chats", async () => {
    const documentId = await seedDocument();
    const { body } = await read(await listChats(get(`/api/chats?documentId=${documentId}`)));
    expect(body).toEqual({ chats: [] });
  });

  it("404 for another user's document", async () => {
    const theirs = await seedDocument(OTHER_USER);
    await seedChat(theirs, OTHER_USER);
    const { status, body } = await read(await listChats(get(`/api/chats?documentId=${theirs}`)));
    expect(status).toBe(404);
    expect(body.error.code).toBe("document_not_found");
  });

  it.each(["", "?documentId=", "?documentId=abc"])("400 for a missing or malformed documentId (%s)", async (query) => {
    const { status, body } = await read(await listChats(get(`/api/chats${query}`)));
    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("401 without a session", async () => {
    session.userId = null;
    const response = await listChats(get(`/api/chats?documentId=${new ObjectId()}`));
    expect(response.status).toBe(401);
  });
});

describe("GET /api/chats/:id/messages", () => {
  it("returns the chat and its messages in order, with citations as plain ids", async () => {
    const documentId = await seedDocument();
    const chatId = await seedChat(documentId);
    const chunk = await db.collection("chunks").findOne({ documentId, pageNumber: 1 });
    const id = chatId.toHexString();

    const { status, body } = await read(await getMessages(get(`/api/chats/${id}/messages`), params({ id })));

    expect(status).toBe(200);
    expect(body).toEqual({
      chat: { id, documentId: documentId.toHexString(), title: "When do applications open?" },
      messages: [
        { id: expect.any(String), role: "user", content: "When do applications open?", citations: [], createdAt: expect.any(String) },
        {
          id: expect.any(String),
          role: "assistant",
          content: "In March [p. 1].",
          citations: [{ pageNumber: 1, chunkId: chunk?._id.toHexString() }],
          createdAt: expect.any(String),
        },
      ],
    });
  });

  it("404 for another user's chat", async () => {
    const chatId = await seedChat(await seedDocument(OTHER_USER), OTHER_USER);
    const id = chatId.toHexString();
    const { status, body } = await read(await getMessages(get(`/api/chats/${id}/messages`), params({ id })));
    expect(status).toBe(404);
    expect(body.error.code).toBe("chat_not_found");
  });

  it.each(["not-an-id", new ObjectId().toHexString()])("404 for a missing or malformed id (%s)", async (id) => {
    const { status, body } = await read(await getMessages(get(`/api/chats/${id}/messages`), params({ id })));
    expect(status).toBe(404);
    expect(body.error.code).toBe("chat_not_found");
  });

  it("401 without a session", async () => {
    session.userId = null;
    const id = new ObjectId().toHexString();
    const response = await getMessages(get(`/api/chats/${id}/messages`), params({ id }));
    expect(response.status).toBe(401);
  });
});
