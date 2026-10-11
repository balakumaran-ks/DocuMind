import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as rate } from "@/app/api/messages/[id]/feedback/route";
import { createChat, saveMessage } from "@/lib/db/chats";
import { closeDb } from "@/lib/db/client";
import { startMongo, stubServerEnv } from "./helpers/mongo";

const USER_ID = "google:test-user";
const OTHER_USER = "google:someone-else";

// The signed-in user; set to null to test requests without a session.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/user", () => ({ getUserId: async () => session.userId }));

const DB_NAME = "documind_feedback_test";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("missing test data");
  return value;
}

/** A chat with one question and its answer; returns both messages' ids. */
async function seedExchange(userId = USER_ID) {
  const chat = await createChat(db, { userId, documentId: new ObjectId(), title: "When are fees due?" });
  await saveMessage(db, { chatId: chat._id, userId, role: "user", content: "When are fees due?" });
  await saveMessage(db, {
    chatId: chat._id,
    userId,
    role: "assistant",
    content: "Monthly [p. 2].",
    citations: [],
    retrievedChunkIds: [],
    latencyMs: 900,
    usage: { inputTokens: 100, outputTokens: 10 },
  });
  const rows = await db.collection("messages").find({ chatId: chat._id }).sort({ createdAt: 1, _id: 1 }).toArray();
  return { question: must(rows[0])._id.toHexString(), answer: must(rows[1])._id.toHexString() };
}

function post(id: string, body: unknown) {
  const request = new Request(`http://localhost/api/messages/${id}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return rate(request, { params: Promise.resolve({ id }) });
}

async function read(response: Response) {
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const message = (id: string) => db.collection("messages").findOne({ _id: new ObjectId(id) });

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  session.userId = USER_ID;
  await Promise.all(["chats", "messages"].map((name) => db.collection(name).deleteMany({})));
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("POST /api/messages/:id/feedback", () => {
  it("rates an answer and stores the rating with when it was given", async () => {
    const { answer } = await seedExchange();

    const { status, body } = await read(await post(answer, { rating: "up" }));

    expect(status).toBe(200);
    expect(body).toEqual({ rating: "up" });
    expect((await message(answer))?.feedback).toEqual({ rating: "up", updatedAt: expect.any(Date) });
  });

  it("changes a rating, and clears it with null", async () => {
    const { answer } = await seedExchange();

    await post(answer, { rating: "up" });
    expect((await read(await post(answer, { rating: "down" }))).body).toEqual({ rating: "down" });
    expect((await message(answer))?.feedback).toMatchObject({ rating: "down" });

    const cleared = await read(await post(answer, { rating: null }));
    expect(cleared).toEqual({ status: 200, body: { rating: null } });
    expect(await message(answer)).not.toHaveProperty("feedback");
  });

  it("changes nothing else on the message or its chat", async () => {
    const { answer } = await seedExchange();
    const before = must(await message(answer));
    const chatBefore = await db.collection("chats").findOne({ _id: before.chatId });

    await post(answer, { rating: "down" });

    const { feedback, ...after } = must(await message(answer));
    expect(feedback).toBeDefined();
    expect(after).toEqual(before);
    expect(await db.collection("chats").findOne({ _id: before.chatId })).toEqual(chatBefore);
  });

  it("404 for another user's answer, which stays unrated", async () => {
    const { answer } = await seedExchange(OTHER_USER);

    const { status, body } = await read(await post(answer, { rating: "down" }));

    expect(status).toBe(404);
    expect(body.error.code).toBe("message_not_found");
    expect(await message(answer)).not.toHaveProperty("feedback");
  });

  it("404 for a question: only answers can be rated", async () => {
    const { question } = await seedExchange();

    const { status, body } = await read(await post(question, { rating: "up" }));

    expect(status).toBe(404);
    expect(body.error.code).toBe("message_not_found");
    expect(await message(question)).not.toHaveProperty("feedback");
  });

  it.each(["not-an-id", new ObjectId().toHexString()])("404 for a missing or malformed id (%s)", async (id) => {
    const { status, body } = await read(await post(id, { rating: "up" }));
    expect(status).toBe(404);
    expect(body.error.code).toBe("message_not_found");
  });

  it.each([
    ["an unknown rating", { rating: "meh" }],
    ["a missing rating", {}],
    ["a number", { rating: 1 }],
    ["a body that isn't JSON", "thumbs up"],
  ])("400 for %s", async (_label, body) => {
    const { answer } = await seedExchange();

    const response = await read(await post(answer, body));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("invalid_request");
    expect(await message(answer)).not.toHaveProperty("feedback");
  });

  it("401 without a session, rating nothing", async () => {
    const { answer } = await seedExchange();
    session.userId = null;

    const response = await post(answer, { rating: "up" });

    expect(response.status).toBe(401);
    expect(await message(answer)).not.toHaveProperty("feedback");
  });
});
