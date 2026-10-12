import { MongoClient, type Db } from "mongodb";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAccountAction } from "@/app/documents/account-actions";
import { deleteAccount } from "@/lib/db/account";
import { createChat, saveMessage } from "@/lib/db/chats";
import { closeDb } from "@/lib/db/client";
import { insertDocumentWithPages } from "@/lib/db/documents";
import { reserveUpload } from "@/lib/db/uploads";
import { upsertUser } from "@/lib/db/users";
import { ingestDocument } from "@/lib/ingest";
import { SAMPLES_USER } from "@/lib/samples/catalog";
import { fakeEmbedder } from "./helpers/fake-embedder";
import { startMongo, stubServerEnv } from "./helpers/mongo";

const USER_ID = "google:test-user";
const OTHER_USER = "google:someone-else";

// The signed-in user; set to null to test requests without a session.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/user", () => ({ getUserId: async () => session.userId }));
const auth = vi.hoisted(() => ({ signOut: vi.fn(async (_options: { redirectTo: string }) => undefined) }));
vi.mock("@/auth", () => ({ signOut: auth.signOut }));

const DB_NAME = "documind_account_test";
const COLLECTIONS = ["users", "documents", "pages", "chunks", "chats", "messages", "uploadCounts"];

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;

/** A user with a profile, an indexed document, a chat with messages and today's upload count. */
async function seedUser(userId: string) {
  await upsertUser(db, { userId, email: `${userId}@example.com`, name: "Test", image: null });
  const pages = [{ pageNumber: 1, text: "Fees are due monthly.", charCount: 21, isEmpty: false }];
  const documentId = await insertDocumentWithPages(db, { userId, filename: "fees.pdf", sizeBytes: 100, sha256: "x", pages });
  await ingestDocument({ db, embedder: fakeEmbedder().embedder, userId, documentId, pages });
  const chat = await createChat(db, { userId, documentId, title: "When are fees due?" });
  await saveMessage(db, { chatId: chat._id, userId, role: "user", content: "When are fees due?" });
  await saveMessage(db, { chatId: chat._id, userId, role: "assistant", content: "Monthly [p. 1]." });
  await reserveUpload(db, userId, new Date(), 10);
}

/** How many rows each collection holds for a user (`_id` for users, `userId` elsewhere). */
async function rowsOf(userId: string) {
  const counts: Record<string, number> = {};
  for (const name of COLLECTIONS) {
    counts[name] = await db.collection(name).countDocuments(name === "users" ? { _id: userId as never } : { userId });
  }
  return counts;
}

const none = Object.fromEntries(COLLECTIONS.map((name) => [name, 0]));

beforeAll(async () => {
  mongo = await startMongo();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db(DB_NAME);
});

beforeEach(async () => {
  stubServerEnv(mongo.getUri(), DB_NAME);
  session.userId = USER_ID;
  auth.signOut.mockClear();
  await Promise.all(COLLECTIONS.map((name) => db.collection(name).deleteMany({})));
});

afterEach(async () => {
  await closeDb();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await client.close();
  await mongo.stop();
});

describe("deleteAccount", () => {
  it("removes every row of the user, and nobody else's, sample templates included", async () => {
    await seedUser(USER_ID);
    await seedUser(OTHER_USER);
    await seedUser(SAMPLES_USER);
    const othersBefore = await rowsOf(OTHER_USER);
    const samplesBefore = await rowsOf(SAMPLES_USER);
    expect(Object.values(await rowsOf(USER_ID)).every((n) => n > 0)).toBe(true);

    await deleteAccount(db, USER_ID);

    expect(await rowsOf(USER_ID)).toEqual(none);
    expect(await rowsOf(OTHER_USER)).toEqual(othersBefore);
    expect(await rowsOf(SAMPLES_USER)).toEqual(samplesBefore);
  });
});

describe("deleteAccountAction", () => {
  it("deletes the signed-in user's data, then signs them out to the home page", async () => {
    await seedUser(USER_ID);

    await deleteAccountAction();

    expect(await rowsOf(USER_ID)).toEqual(none);
    expect(auth.signOut).toHaveBeenCalledWith({ redirectTo: "/" });
  });

  it("does nothing without a session", async () => {
    await seedUser(USER_ID);
    session.userId = null;

    await deleteAccountAction();

    expect((await rowsOf(USER_ID)).documents).toBe(1);
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
