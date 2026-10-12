import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createChat, latestChatAcross } from "@/lib/db/chats";
import { startMongo } from "./helpers/mongo";

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

const USER_ID = "google:test-user";

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db("documind_chats_repo_test");
});

beforeEach(async () => {
  await db.collection("chats").deleteMany({});
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("latestChatAcross", () => {
  it("returns the user's most recently active chat across documents", async () => {
    const [a, b, c] = [new ObjectId(), new ObjectId(), new ObjectId()];
    const older = await createChat(db, { userId: USER_ID, documentIds: [a, b], title: "older" });
    const newer = await createChat(db, { userId: USER_ID, documentIds: [b, c], title: "newer" });
    await db.collection("chats").updateOne({ _id: older._id }, { $set: { updatedAt: new Date(Date.now() - 60_000) } });

    expect((await latestChatAcross(db, USER_ID))?._id).toEqual(newer._id);
  });

  it("ignores single-document chats and other users' chats", async () => {
    await createChat(db, { userId: USER_ID, documentId: new ObjectId(), title: "single" });
    await createChat(db, { userId: "google:someone-else", documentIds: [new ObjectId(), new ObjectId()], title: "theirs" });

    expect(await latestChatAcross(db, USER_ID)).toBeNull();
  });
});
