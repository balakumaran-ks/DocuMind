import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/ask/route";
import { DEV_USER_ID } from "@/lib/auth/user";
import { closeDb } from "@/lib/db/client";
import { insertDocumentWithPages } from "@/lib/db/documents";
import { ingestDocument } from "@/lib/ingest";
import { LIMITS } from "@/lib/limits";
import { REFUSAL, SYSTEM_PROMPT } from "@/lib/rag/prompt";
import { retrieveChunks } from "@/lib/rag/retrieve";
import { fakeAnswerModel } from "./helpers/fake-answer-model";
import { fakeEmbedder, vectorFor } from "./helpers/fake-embedder";
import { startMongo, stubServerEnv } from "./helpers/mongo";

// The route must never call the real embedding or answer APIs in tests.
const fakes = vi.hoisted(() => ({
  embedder: null as ReturnType<typeof import("./helpers/fake-embedder").fakeEmbedder> | null,
  answer: null as ReturnType<typeof import("./helpers/fake-answer-model").fakeAnswerModel> | null,
}));
vi.mock("@/lib/ai/embed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embed")>()),
  getEmbedder: () => {
    if (!fakes.embedder) throw new Error("fake embedder not set");
    return fakes.embedder.embedder;
  },
}));
vi.mock("@/lib/ai/answer", () => ({
  getAnswerModel: () => {
    if (!fakes.answer) throw new Error("fake answer model not set");
    return fakes.answer.model;
  },
}));

// mongodb-memory-server has no $vectorSearch. This stand-in keeps its contract:
// only the given user's chunks of the given document, at most retrievalTopK, best first.
vi.mock("@/lib/rag/retrieve", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rag/retrieve")>();
  const { LIMITS: limits } = await import("@/lib/limits");
  return {
    ...actual,
    retrieveChunks: vi.fn(async ({ db, userId, documentId }: Parameters<typeof actual.retrieveChunks>[0]) => {
      const rows = await db
        .collection("chunks")
        .find({ userId, documentId })
        .sort({ chunkIndex: 1 })
        .limit(limits.retrievalTopK)
        .toArray();
      return rows.map((row, i) => ({
        _id: row._id,
        pageNumber: row.pageNumber,
        chunkIndex: row.chunkIndex,
        text: row.text,
        score: 0.9 - i / 10,
      }));
    }),
  };
});

const DB_NAME = "documind_ask_test";
const OTHER_USER = "someone-else";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const PAGES = ["Applications open in March.", "Fees are due monthly.", "Late fees are 5 percent."];

/** A ready document with one chunk per page, stored the way an upload stores it. */
async function seedDocument(userId = DEV_USER_ID): Promise<ObjectId> {
  const pages = PAGES.map((text, i) => ({ pageNumber: i + 1, text, charCount: text.length, isEmpty: false }));
  const documentId = await insertDocumentWithPages(db, { userId, filename: "fees.pdf", sizeBytes: 1000, sha256: "x", pages });
  await ingestDocument({ db, embedder: fakeEmbedder().embedder, userId, documentId, pages });
  return documentId;
}

/** POST /api/ask with a JSON body (or a raw string), reading the whole streamed reply. */
async function ask(body: unknown, raw?: string) {
  const response = await POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    }),
  );
  const text = await response.text().catch(() => "");
  return { status: response.status, headers: response.headers, text, json: () => JSON.parse(text) };
}

const messages = () => db.collection("messages").find({}).sort({ createdAt: 1, _id: 1 }).toArray();
const chats = () => db.collection("chats").find({}).toArray();

function startOfTodayUtc(): Date {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight;
}

async function seedQuestions(count: number, userId: string, createdAt: Date) {
  const rows = Array.from({ length: count }, () => ({
    _id: new ObjectId(),
    chatId: new ObjectId(),
    userId,
    role: "user",
    content: "earlier question",
    createdAt,
  }));
  if (rows.length > 0) await db.collection("messages").insertMany(rows);
}

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  vi.stubEnv("NODE_ENV", "test");
  fakes.embedder = fakeEmbedder();
  fakes.answer = fakeAnswerModel();
  vi.mocked(retrieveChunks).mockClear();
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

describe("POST /api/ask — answering", () => {
  it("streams the answer as text and returns the chat id", async () => {
    const documentId = await seedDocument();
    const { status, headers, text } = await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });

    expect(status).toBe(200);
    expect(headers.get("content-type")).toMatch(/^text\/plain/);
    expect(text).toBe("Fees are due monthly [p. 2].");
    expect(headers.get("x-chat-id")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("embeds the question and retrieves only from this user's document", async () => {
    const documentId = await seedDocument();
    await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });

    expect(fakes.embedder?.state.queries).toEqual(["When are fees due?"]);
    expect(retrieveChunks).toHaveBeenCalledTimes(1);
    expect(retrieveChunks).toHaveBeenCalledWith(
      expect.objectContaining({ userId: DEV_USER_ID, documentId, queryVector: vectorFor("When are fees due?", 4) }),
    );
  });

  it("sends the system rules, the page-tagged sources and the question to the model", async () => {
    const documentId = await seedDocument();
    await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });

    const prompt = fakes.answer?.sentPrompt() ?? [];
    expect(prompt[0]).toEqual({ role: "system", text: SYSTEM_PROMPT });
    expect(prompt).toHaveLength(2);
    expect(prompt[1]?.role).toBe("user");
    expect(prompt[1]?.text).toContain('<source page="2">\nFees are due monthly.\n</source>');
    expect(prompt[1]?.text.endsWith("Question: When are fees due?")).toBe(true);
  });

  it("creates a chat and saves the question before the answer, with citations, chunks, latency and usage", async () => {
    const documentId = await seedDocument();
    const { headers } = await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });
    const chatId = new ObjectId(String(headers.get("x-chat-id")));

    await vi.waitFor(async () => expect(await messages()).toHaveLength(2));
    const [question, answer] = await messages();
    const chunks = await db.collection("chunks").find({ documentId }).sort({ chunkIndex: 1 }).toArray();

    expect(await chats()).toEqual([
      expect.objectContaining({
        _id: chatId,
        userId: DEV_USER_ID,
        documentId,
        title: "When are fees due?",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    ]);
    expect(question).toMatchObject({ chatId, userId: DEV_USER_ID, role: "user", content: "When are fees due?" });
    expect(answer).toMatchObject({
      chatId,
      userId: DEV_USER_ID,
      role: "assistant",
      content: "Fees are due monthly [p. 2].",
      citations: [{ pageNumber: 2, chunkId: chunks[1]?._id }],
      retrievedChunkIds: chunks.map((c) => c._id),
      usage: { inputTokens: 120, outputTokens: 15 },
    });
    expect(answer?.latencyMs).toEqual(expect.any(Number));
    expect(answer?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(answer?.createdAt.getTime()).toBeGreaterThanOrEqual(question?.createdAt.getTime());
  });

  it("keeps only citations of pages that were retrieved", async () => {
    const documentId = await seedDocument();
    if (fakes.answer) fakes.answer.state.reply = "Monthly [p. 2], with a grace period [p. 9].";
    await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });

    await vi.waitFor(async () => expect(await messages()).toHaveLength(2));
    const answer = (await messages())[1];
    expect(answer?.citations.map((c: { pageNumber: number }) => c.pageNumber)).toEqual([2]);
  });

  it("saves a refusal with no citations", async () => {
    const documentId = await seedDocument();
    if (fakes.answer) fakes.answer.state.reply = REFUSAL;
    const { text } = await ask({ documentId: documentId.toHexString(), question: "Who is the CEO?" });

    expect(text).toBe(REFUSAL);
    await vi.waitFor(async () => expect(await messages()).toHaveLength(2));
    expect((await messages())[1]).toMatchObject({ content: REFUSAL, citations: [] });
  });

  it("continues a chat: earlier turns go to the model and new messages join the same chat", async () => {
    const documentId = await seedDocument();
    const first = await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });
    const chatId = String(first.headers.get("x-chat-id"));
    await vi.waitFor(async () => expect(await messages()).toHaveLength(2));

    if (fakes.answer) fakes.answer.state.reply = "They are 5 percent [p. 3].";
    const second = await ask({ documentId: documentId.toHexString(), chatId, question: "And late fees?" });

    expect(second.status).toBe(200);
    expect(second.headers.get("x-chat-id")).toBe(chatId);
    const prompt = fakes.answer?.sentPrompt(1) ?? [];
    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(prompt[1]?.text).toBe("When are fees due?");
    expect(prompt[2]?.text).toBe("Fees are due monthly [p. 2].");
    expect(prompt[3]?.text).toContain("Question: And late fees?");

    await vi.waitFor(async () => expect(await messages()).toHaveLength(4));
    expect((await messages()).every((m) => m.chatId.toHexString() === chatId)).toBe(true);
    expect(await chats()).toHaveLength(1);
  });

  it("counts the question even when the model fails, and saves no answer", async () => {
    const documentId = await seedDocument();
    if (fakes.answer) fakes.answer.state.failWith = new Error("model overloaded");
    await ask({ documentId: documentId.toHexString(), question: "When are fees due?" });

    await vi.waitFor(async () => expect(await messages()).toHaveLength(1));
    expect((await messages())[0]).toMatchObject({ role: "user", content: "When are fees due?" });
  });
});

describe("POST /api/ask — rejections", () => {
  it("401 when there is no signed-in user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { status, json } = await ask({ documentId: new ObjectId().toHexString(), question: "q" });
    expect(status).toBe(401);
    expect(json().error.code).toBe("unauthorized");
  });

  it.each([
    ["the body is not JSON", undefined, "{not json"],
    ["the question is missing", { documentId: new ObjectId().toHexString() }, undefined],
    ["the question is blank", { documentId: new ObjectId().toHexString(), question: "   " }, undefined],
    ["the documentId is not an id", { documentId: "abc", question: "q" }, undefined],
    ["the chatId is not an id", { documentId: new ObjectId().toHexString(), chatId: "abc", question: "q" }, undefined],
  ])("400 when %s", async (_, body, raw) => {
    const { status, json } = await ask(body, raw);
    expect(status).toBe(400);
    expect(json().error.code).toBe("invalid_request");
    expect(json().error.message).toEqual(expect.any(String));
  });

  it(`400 when the question is longer than ${LIMITS.maxQuestionChars} characters`, async () => {
    const documentId = await seedDocument();
    const { status, json } = await ask({
      documentId: documentId.toHexString(),
      question: "a".repeat(LIMITS.maxQuestionChars + 1),
    });
    expect(status).toBe(400);
    expect(json().error.code).toBe("question_too_long");
  });

  it("404 for a document that does not exist", async () => {
    const { status, json } = await ask({ documentId: new ObjectId().toHexString(), question: "q" });
    expect(status).toBe(404);
    expect(json().error.code).toBe("document_not_found");
  });

  it("404 for another user's document, exactly as if it did not exist", async () => {
    const theirs = await seedDocument(OTHER_USER);
    const { status, json } = await ask({ documentId: theirs.toHexString(), question: "q" });
    expect(status).toBe(404);
    expect(json().error.code).toBe("document_not_found");
    expect(retrieveChunks).not.toHaveBeenCalled();
  });

  it("409 when the document is not ready", async () => {
    const documentId = await seedDocument();
    await db.collection("documents").updateOne({ _id: documentId }, { $set: { status: "failed" } });
    const { status, json } = await ask({ documentId: documentId.toHexString(), question: "q" });
    expect(status).toBe(409);
    expect(json().error.code).toBe("document_not_ready");
  });

  it("404 for a chat that belongs to another user or another document", async () => {
    const documentId = await seedDocument();
    const otherDocument = await seedDocument();
    const theirChat = { _id: new ObjectId(), userId: OTHER_USER, documentId, title: "t", createdAt: new Date(), updatedAt: new Date() };
    const otherDocChat = { ...theirChat, _id: new ObjectId(), userId: DEV_USER_ID, documentId: otherDocument };
    await db.collection("chats").insertMany([theirChat, otherDocChat]);

    for (const chat of [theirChat, otherDocChat]) {
      const { status, json } = await ask({ documentId: documentId.toHexString(), chatId: chat._id.toHexString(), question: "q" });
      expect(status).toBe(404);
      expect(json().error.code).toBe("chat_not_found");
    }
    expect(await messages()).toHaveLength(0);
  });

  it(`429 after ${LIMITS.maxQuestionsPerDay} questions today, without calling any model`, async () => {
    const documentId = await seedDocument();
    await seedQuestions(LIMITS.maxQuestionsPerDay, DEV_USER_ID, new Date());

    const { status, json } = await ask({ documentId: documentId.toHexString(), question: "One more?" });
    expect(status).toBe(429);
    expect(json().error.code).toBe("daily_limit_reached");
    expect(json().error.message).toMatch(/limit/i);
    expect(json().error.resetsAt).toBe(new Date(startOfTodayUtc().getTime() + 24 * 60 * 60 * 1000).toISOString());
    expect(fakes.embedder?.state.queries).toEqual([]);
    expect(fakes.answer?.model.doStreamCalls).toHaveLength(0);
    expect(await messages()).toHaveLength(LIMITS.maxQuestionsPerDay);
  });

  it("does not count yesterday's questions, answers, or other users' questions toward the cap", async () => {
    const documentId = await seedDocument();
    await seedQuestions(LIMITS.maxQuestionsPerDay, DEV_USER_ID, new Date(startOfTodayUtc().getTime() - 1));
    await seedQuestions(LIMITS.maxQuestionsPerDay, OTHER_USER, new Date());
    await seedQuestions(LIMITS.maxQuestionsPerDay - 1, DEV_USER_ID, new Date());
    await db.collection("messages").insertOne({
      _id: new ObjectId(),
      chatId: new ObjectId(),
      userId: DEV_USER_ID,
      role: "assistant",
      content: "an answer",
      createdAt: new Date(),
    });

    const { status } = await ask({ documentId: documentId.toHexString(), question: "Last one for today?" });
    expect(status).toBe(200);
  });

  it("502 when the question cannot be embedded, saving nothing", async () => {
    const documentId = await seedDocument();
    if (fakes.embedder) fakes.embedder.state.failWith = new Error("quota exceeded");
    const { status, json } = await ask({ documentId: documentId.toHexString(), question: "q" });
    expect(status).toBe(502);
    expect(json().error.code).toBe("embedding_failed");
    expect(await chats()).toHaveLength(0);
    expect(await messages()).toHaveLength(0);
  });

  it("503 with a clear message when the database is unreachable", async () => {
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300");
    const { status, json } = await ask({ documentId: new ObjectId().toHexString(), question: "q" });
    expect(status).toBe(503);
    expect(json().error.code).toBe("database_unavailable");
  });
});
